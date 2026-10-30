"""What a song's stems tell the studio, decided in one place: when its chords and vocal range
are detected and stored, which key it is in, and what its YouTube kit says.

The chord and vocal-range routes, the exports, the render and the intake pipelines all
call these. Detection runs outside PROJECTS_LOCK (it takes seconds); the result is stored
under it. A backfill keeps whatever another request stored meanwhile (the first writer
wins), so it never overwrites a concurrent backfill or the user's own chord edits; a
forced re-detection overwrites.
"""

import logging
import os
from typing import Any

from backend.project_store import PROJECTS_LOCK, get_project_or_404, save_projects

logger = logging.getLogger("karaoke_backend")


class StemMissing(Exception):
    """The audio an analysis needs is missing or empty."""


def usable_file(path: str | None) -> bool:
    return bool(path) and os.path.isfile(path) and os.path.getsize(path) > 0


def chord_source(proj: dict) -> str | None:
    """The audio chords are detected from: the instrumental, else the original track."""
    for field in ("instrumental_path", "audio_path"):
        if usable_file(proj.get(field)):
            return proj[field]
    return None


def estimated_key(proj: dict) -> str | None:
    """The song's key: the vocal analysis's estimate, else a top-level key (older songs)."""
    vocal_range = proj.get("vocal_range")
    if isinstance(vocal_range, dict) and vocal_range.get("estimated_key"):
        return vocal_range["estimated_key"]
    return proj.get("estimated_key")


def detect_chords(audio_path: str) -> list[dict[str, Any]]:
    """The chord progression of a file, from the app's detector (tests replace it)."""
    import backend.main as main_mod

    detector = getattr(main_mod, "chord_detector", None)
    if detector is None:
        from backend.services.chord_detector import ChordDetector

        detector = ChordDetector()
    chords = detector.detect_chords(audio_path)
    if all(isinstance(chord, dict) for chord in chords):
        return chords
    return [chord.to_dict() if hasattr(chord, "to_dict") else dict(chord) for chord in chords]


def analyze_vocals(vocals_path: str) -> dict[str, Any]:
    """The vocal range and key of a vocal stem, from the app's analyser (tests replace it)."""
    import backend.main as main_mod

    return main_mod.vocal_analyzer.analyze_vocals(vocals_path)


def ensure_chords(
    project_id: str, *, force: bool = False, source: str | None = None
) -> list[dict[str, Any]]:
    """The song's chord progression: the stored one, else detected from `source` (default
    chord_source) and stored. With `force`, detected and stored again. Raises StemMissing
    when there is no usable audio."""
    proj = get_project_or_404(project_id)
    if not force and proj.get("chords") is not None:
        return proj["chords"]
    source = source or chord_source(proj)
    if not usable_file(source):
        raise StemMissing("instrumental stem missing or not ready")
    detected = detect_chords(source)
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        if force or proj.get("chords") is None:
            proj["chords"] = detected
            save_projects()
        return proj["chords"]


def chords_for_export(project_id: str, wanted: bool) -> list[dict[str, Any]]:
    """The chords an export or render passes on: the stored ones, else (when `wanted`)
    detected now. Without audio, or when detection fails, the export goes ahead without."""
    stored = get_project_or_404(project_id).get("chords")
    if stored is not None or not wanted:
        return stored if stored is not None else []
    try:
        return ensure_chords(project_id)
    except Exception as exc:
        logger.warning(f"Exporting {project_id} without chords: {exc}")
        return []


def ensure_vocal_range(
    project_id: str, *, force: bool = False, source: str | None = None
) -> dict[str, Any]:
    """The song's vocal range and key: the stored analysis, else analysed from `source`
    (default its vocal stem) and stored. With `force`, analysed and stored again. Raises
    StemMissing when there is no usable vocal stem."""
    proj = get_project_or_404(project_id)
    if not force and proj.get("vocal_range"):
        return proj["vocal_range"]
    source = source or proj.get("vocals_path")
    if not usable_file(source):
        raise StemMissing("isolated vocal stem missing or not ready")
    analysed = analyze_vocals(source)
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        if force or not proj.get("vocal_range"):
            proj["vocal_range"] = analysed
            save_projects()
        return proj["vocal_range"]


def youtube_package(proj: dict) -> dict[str, Any]:
    """The YouTube kit for the song's video. It describes the key and guide vocal of the
    last render (render_settings), else the song's current ones: changing the key and then
    editing a lyric must not relabel a video rendered in the old key."""
    import backend.main as main_mod

    settings = proj.get("render_settings") or {}
    return main_mod.youtube_service.generate_youtube_package(
        title=proj.get("title", "Karaoke Track"),
        artist=proj.get("artist", "Artist"),
        lines=proj.get("lines", []),
        semitones=settings.get("semitones", proj.get("semitones", 0)),
        has_guide_vocal=settings.get("guide_volume", proj.get("guide_volume", 0.0)) > 0.05,
    )


def refresh_youtube_package(proj: dict) -> None:
    """Rebuilds the stored YouTube kit after an edit, for a song that has one. Call with
    PROJECTS_LOCK held."""
    if "youtube_package" in proj:
        proj["youtube_package"] = youtube_package(proj)
