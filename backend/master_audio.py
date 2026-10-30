"""The master mix's files: names, the mix cache, and what the studio streams.

The mixer writes a WAV, which exports, renders and the waveform use. With
PREVIEW_AUDIO_FORMAT=aac the studio streams a compressed .m4a copy of it instead (about an
eighth of the size); without an AAC encoder, or if encoding fails, it streams the WAV.

/mix and re-separation reuse a rendered mix while it is newer than its stems and was made
by the current mixer version.
"""

import logging
import os
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


def mix_cache_epoch(output_dir) -> float:
    """When this mixer version started rendering into ``output_dir``: the modification time
    of a marker file holding MIX_CACHE_VERSION, written on first use. Older renders (from
    Karaoke Studio 1.x, say) are not reused."""
    marker = Path(output_dir) / MIX_CACHE_MARKER
    try:
        if marker.read_text(encoding="utf-8").strip() == MIX_CACHE_VERSION:
            return marker.stat().st_mtime
    except OSError:
        pass
    try:
        marker.write_text(MIX_CACHE_VERSION, encoding="utf-8")
        return marker.stat().st_mtime
    except OSError:
        return float("inf")  # nowhere to note the version: render every time


def reusable_mix_path(output_dir, output_filename: str, sources: list) -> str | None:
    """
    Return a previously rendered mix when it can be served again: it exists, is more
    than a bare WAV header, was made by this mixer version, and is newer than every source
    stem (a replaced instrumental or re-separated stems invalidate it).
    """
    if not isinstance(output_dir, (str, os.PathLike)):
        return None
    epoch = mix_cache_epoch(output_dir)
    candidate = Path(output_dir) / output_filename
    try:
        stat = candidate.stat()
    except OSError:
        return None
    if stat.st_size <= _MIN_MIX_BYTES or stat.st_mtime < epoch:
        return None
    for source in sources:
        try:
            if source and os.path.getmtime(source) > stat.st_mtime:
                return None
        except OSError:
            continue
    return str(candidate)


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
