"""The master mix's files: names, the mix cache, and what the studio streams.

The mixer writes a WAV, which exports, renders and the waveform use. With
PREVIEW_AUDIO_FORMAT=aac the studio streams a compressed .m4a copy of it instead (about an
eighth of the size); without an AAC encoder, or if encoding fails, it streams the WAV.

/mix and re-separation reuse a rendered mix while it is newer than its stems and was made
by the current mixer version. Reusing one refreshes its access time, never its modification
time (which versions its URL and dates its .m4a copy). After each /mix and re-separation,
and once for every song in a background thread at startup, prune_mix_cache keeps the song's
MIX_CACHE_PER_SONG most recently used mixes: it deletes the mixes that can never be served
again, then the least recently used ones past the limit, each WAV with its .m4a. It never
deletes any song's current master, or a mix made or reused in the last minute. The files the
mixer was still writing when a restart stopped it (.tmp_) are deleted at startup instead.

Locks: prune_mix_cache copies the masters' names under PROJECTS_LOCK and releases it before it
takes _MIX_CACHE_LOCK, so the order is always PROJECTS_LOCK, then _MIX_CACHE_LOCK.
"""

import logging
import os
import re
import threading
import time
from pathlib import Path

from backend import config
from backend.services.audio_mixer import ffmpeg_has_encoder

logger = logging.getLogger("karaoke_backend")


def mix_filename(track_id: str, semitones: int, guide_volume: float) -> str:
    """The WAV name for a key and guide level; the level in whole percent (round, not int:
    int() named the 0.29 mix "_28")."""
    return f"{track_id}_mix_{semitones}_{round(guide_volume * 100)}.wav"


# Smallest plausible WAV render: anything at or below a bare RIFF header is a broken file
_MIN_MIX_BYTES = 44
# Bump when the mixer's sound changes, so that renders made by the older mixer are made again
MIX_CACHE_VERSION = "2"
MIX_CACHE_MARKER = ".mix-cache-version"
# Serialises a reuse check and its access-time touch with the pruning of the same mixes
_MIX_CACHE_LOCK = threading.Lock()
# A mix made or reused this recently is in use (a /mix reply or a download may be reading it)
_IN_USE_SEC = 60


def mix_cache_epoch(output_dir, *, create: bool = True) -> float:
    """When this mixer version started rendering into ``output_dir``: the modification time
    of a marker file holding MIX_CACHE_VERSION, written on first use. Older renders (from
    Karaoke Studio 1.x, say) are not reused. With ``create=False`` the marker is only read,
    and a missing or out-of-date one gives -inf, so no mix counts as made by an older mixer."""
    marker = Path(output_dir) / MIX_CACHE_MARKER
    try:
        if marker.read_text(encoding="utf-8").strip() == MIX_CACHE_VERSION:
            return marker.stat().st_mtime
    except OSError:
        pass
    if not create:
        return float("-inf")
    try:
        marker.write_text(MIX_CACHE_VERSION, encoding="utf-8")
        return marker.stat().st_mtime
    except OSError:
        return float("inf")  # nowhere to note the version: render every time


def _is_current(stat: os.stat_result, epoch: float, sources: list) -> bool:
    """Whether a mix with this ``stat`` can be served again: more than a bare WAV header, made
    by this mixer version (not older than ``epoch``) and newer than every source stem that
    exists."""
    if stat.st_size <= _MIN_MIX_BYTES or stat.st_mtime < epoch:
        return False
    for source in sources:
        try:
            if source and os.path.getmtime(source) > stat.st_mtime:
                return False
        except OSError:
            continue
    return True


def reusable_mix_path(output_dir, output_filename: str, sources: list) -> str | None:
    """
    Return a previously rendered mix when it can be served again: it exists, is more
    than a bare WAV header, was made by this mixer version, and is newer than every source
    stem (a replaced instrumental or re-separated stems invalidate it). A reused mix gets a
    new access time, so prune_mix_cache keeps it as recently used; its modification time
    stays as it was.
    """
    if not isinstance(output_dir, (str, os.PathLike)):
        return None
    epoch = mix_cache_epoch(output_dir)
    candidate = Path(output_dir) / output_filename
    with _MIX_CACHE_LOCK:
        try:
            stat = candidate.stat()
        except OSError:
            return None
        if not _is_current(stat, epoch, sources):
            return None
        try:
            os.utime(candidate, ns=(time.time_ns(), stat.st_mtime_ns))
        except OSError:
            pass  # a file this process does not own: pruning falls back to when it was made
    return str(candidate)


def _current_masters() -> set[str]:
    """The file names of every song's current master mix, copied under PROJECTS_LOCK.

    Names, not paths: the stored paths can spell the output folder differently (a relative or
    moved KARAOKE_DATA_DIR), and mix names are unique within it."""
    # At call time: backend.main imports the pipeline, which imports this module
    import backend.main as main_mod

    with main_mod.PROJECTS_LOCK:
        stored = [
            proj.get("master_audio_path")
            for proj in getattr(main_mod, "projects", {}).values()
            if isinstance(proj, dict)
        ]
    return {Path(path).name for path in stored if isinstance(path, str) and path}


def _last_used(wav: Path, stat: os.stat_result) -> float:
    """When a mix was last made, reused or read: the latest access or modification time of
    the WAV and its .m4a copy."""
    used = max(stat.st_atime, stat.st_mtime)
    try:
        preview = wav.with_suffix(".m4a").stat()
    except OSError:
        return used
    return max(used, preview.st_atime, preview.st_mtime)


def _delete_mix(wav: Path) -> bool:
    """Deletes a mix's WAV, then its .m4a copy; True when the WAV is gone. A WAV that cannot
    be deleted keeps its copy."""
    for path in (wav, wav.with_suffix(".m4a")):
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning(f"Could not remove the cached mix {path.name}: {exc}")
            if path == wav:
                return False
    return True


def prune_mix_cache(
    output_dir,
    track_id: str,
    instrumental: str | None,
    vocals: str | None,
    keep: str | None = None,
) -> list[str]:
    """Deletes a song's cached key and guide mixes that are no longer worth keeping, each
    ``{track_id}_mix_<semitones>_<guide %>.wav`` with its .m4a copy, and returns the names of
    the deleted WAVs.

    First the mixes that can never be served again (made by an older mixer, or older than the
    instrumental, or than the vocals when the guide vocal is mixed in), then, newest use
    first, those past the MIX_CACHE_PER_SONG most recently used. Mixes that are any song's
    current master (or ``keep``) or that were made or reused in the last minute are never
    deleted: such a mix takes one of those slots only when it is among the most recently
    used, and is otherwise kept on top of them, so the song can hold more mixes than the
    limit. MIX_CACHE_PER_SONG=0 deletes nothing. Never raises: a failure is logged and the
    mixes stay.
    """
    try:
        limit = config.MIX_CACHE_PER_SONG
        if limit <= 0 or not track_id or not isinstance(output_dir, (str, os.PathLike)):
            return []
        folder = Path(output_dir)
        if not folder.is_dir():
            return []
        protected = _current_masters()
        if keep:
            protected.add(Path(keep).name)
        pattern = re.compile(re.escape(track_id) + r"_mix_-?\d+_(\d+)\.wav")
        removed: list[str] = []
        with _MIX_CACHE_LOCK:
            epoch = mix_cache_epoch(folder, create=False)
            now = time.time()
            current: list[tuple[float, Path, bool]] = []
            with os.scandir(folder) as entries:
                # A strict match: never another song's mixes, its {id}_master.wav, or the
                # .tmp_ files of mixes still being written
                found = [
                    (Path(entry.path), match)
                    for entry in entries
                    if (match := pattern.fullmatch(entry.name)) and entry.is_file()
                ]
            for wav, match in found:
                try:
                    stat = wav.stat()
                except OSError:
                    continue
                used = _last_used(wav, stat)
                in_use = wav.name in protected or now - used < _IN_USE_SEC
                sources = [instrumental]
                if int(match.group(1)) > 0:
                    sources.append(vocals)
                if not in_use and not _is_current(stat, epoch, sources):
                    if _delete_mix(wav):
                        removed.append(wav.name)
                    continue
                current.append((used, wav, in_use))
            current.sort(key=lambda mix: mix[0], reverse=True)
            for _used, wav, in_use in current[limit:]:
                if not in_use and _delete_mix(wav):
                    removed.append(wav.name)
        if removed:
            logger.info(
                f"Removed {len(removed)} cached mix(es) of {track_id}: {', '.join(removed)}"
            )
        return removed
    except Exception as exc:
        logger.warning(f"Could not prune the cached mixes of {track_id}: {exc}")
        return []


def prune_mixes_of_every_song(output_dir) -> int:
    """Runs prune_mix_cache once for every song in the library and returns how many mixes it
    deleted, so mixes that piled up on songs no one has remixed or re-separated since (before
    the limit existed, or while it was higher) do not stay for good. Never raises."""
    import backend.main as main_mod

    try:
        # One entry per track: a song is stored under its id and its track_id, and songs that
        # share a track share its mixes
        stems_by_track: dict[str, set[tuple[str | None, str | None]]] = {}
        with main_mod.PROJECTS_LOCK:
            for proj in list(getattr(main_mod, "projects", {}).values()):
                if not isinstance(proj, dict):
                    continue
                track_id = proj.get("track_id") or proj.get("id")
                if not isinstance(track_id, str) or not track_id:
                    continue
                inst, vocals = proj.get("instrumental_path"), proj.get("vocals_path")
                stems_by_track.setdefault(track_id, set()).add(
                    (
                        inst if isinstance(inst, str) and inst else None,
                        vocals if isinstance(vocals, str) and vocals else None,
                    )
                )
        removed = trimmed = 0
        for track_id, stems in stems_by_track.items():
            # Songs that share a track but not its stems (one has its own backing track): no
            # stem dates the shared mixes, so only the mixer version and the limit apply
            instrumental, vocals = next(iter(stems)) if len(stems) == 1 else (None, None)
            deleted = prune_mix_cache(output_dir, track_id, instrumental, vocals)
            removed += len(deleted)
            trimmed += bool(deleted)
        if removed:
            logger.info(f"Removed {removed} cached mix(es) of {trimmed} song(s) at startup")
        return removed
    except Exception as exc:
        logger.warning(f"Could not prune the cached mixes of every song: {exc}")
        return 0


def start_pruning_mixes_of_every_song() -> threading.Thread:
    """Starts prune_mixes_of_every_song on a daemon thread, so startup does not wait for it,
    and returns the thread. The output folder is resolved now, in the caller's thread."""
    import backend.main as main_mod

    output_dir = getattr(main_mod, "OUTPUT_DIR", config.OUTPUT_DIR)
    thread = threading.Thread(
        target=prune_mixes_of_every_song,
        args=(output_dir,),
        name="mix-cache-prune",
        daemon=True,
    )
    thread.start()
    return thread


# What the mixer writes while it makes a mix (or the .m4a copy of one), renamed into place when
# FFmpeg ends: <name>.tmp_<hex>.wav and <name>.tmp_<hex>.m4a
UNFINISHED_MIX_GLOBS = ("*.tmp_*.wav", "*.tmp_*.m4a")


def remove_unfinished_mixes() -> int:
    """Deletes the files the mixer was still writing when a server restart stopped it, which
    prune_mix_cache never matches.

    Runs at startup, before any mix can start, so none of them belongs to a running mix.
    Returns how many were removed.
    """
    import backend.main as main_mod

    output_dir = Path(getattr(main_mod, "OUTPUT_DIR", config.OUTPUT_DIR))
    removed = 0
    for pattern in UNFINISHED_MIX_GLOBS:
        for leftover in output_dir.glob(pattern):
            try:
                leftover.unlink()
                removed += 1
            except FileNotFoundError:
                pass
            except OSError as exc:
                logger.warning(f"Could not remove the unfinished mix {leftover.name}: {exc}")
    return removed


def mix_version(path: str) -> int:
    """Millisecond modification stamp used to cache-bust the master audio URL."""
    try:
        return os.stat(path).st_mtime_ns // 1_000_000
    except OSError:
        return int(time.time() * 1000)


def preview_for(wav_path: str) -> str | None:
    """The .m4a copy of a master WAV to stream, or None to stream the WAV: in "wav" mode,
    without an AAC encoder, or when encoding fails. A copy newer than the WAV is reused."""
    if config.PREVIEW_AUDIO_FORMAT != "aac" or not ffmpeg_has_encoder("aac"):
        return None
    wav = Path(wav_path)
    preview = wav.with_suffix(".m4a")
    try:
        if preview.stat().st_size > 0 and preview.stat().st_mtime >= wav.stat().st_mtime:
            return str(preview)
    except OSError:
        pass
    import backend.main as main_mod

    try:
        return main_mod.audio_mixer.encode_preview(str(wav))
    except Exception as exc:
        logger.warning(f"Streaming {wav.name} uncompressed: the AAC preview failed ({exc})")
        return None


def master_fields(wav_path: str) -> dict[str, str]:
    """The project's master_audio_path (always the WAV) and master_audio_url (the preview when
    there is one), versioned so a mix re-made under the same name skips the browser cache."""
    served = preview_for(wav_path) or wav_path
    return {
        "master_audio_path": wav_path,
        "master_audio_url": f"/static/output/{Path(served).name}?v={mix_version(served)}",
    }
