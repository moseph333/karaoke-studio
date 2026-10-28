"""Re-separate a finished song's stems at another quality without disturbing it.

The new stems are made under STEMS_DIR/.staging/<audio_id>/<job id> and swapped in only once
complete, so a cancelled or failed run leaves the song exactly as it was. Afterwards the
vocal range is refreshed, chords are re-detected when asked (or when there are none), the
words are re-timed when asked, and the current master mix is rendered again.

The job's state lives on the project as ``separation_job`` so the studio can poll it. Project
dicts can be replaced by fresh copies from disk at any time (see find_project), so every
write looks the project up again instead of holding on to one dict.
"""

import logging
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from backend.config import STEMS_DIR
from backend.project_store import PROJECTS_LOCK, find_project, save_projects
from backend.services.separation_presets import PRESET_LABELS

logger = logging.getLogger("karaoke_backend")

STAGING_DIRNAME = ".staging"
ACTIVE_JOB_STATES = ("queued", "running")
_SEPARATION_SHARE = 80  # the separation itself fills the first 80% of the job's progress
_BUSY_PIPELINE_STATES = {
    "queued",
    "processing",
    "downloading",
    "separating",
    "fetching_lyrics",
    "aligning",
    "mixing",
}


class ReseparationCancelled(Exception):
    """The user cancelled the job, or the song was deleted under it."""


def cancel_key(project_id: str) -> str:
    return f"{project_id}_reseparate"


def staging_dir(stems_dir: Path, audio_id: str) -> Path:
    return stems_dir / STAGING_DIRNAME / audio_id


def job_is_active(proj: dict) -> bool:
    job = proj.get("separation_job")
    return isinstance(job, dict) and job.get("status") in ACTIVE_JOB_STATES


def conflict_reason(proj: dict) -> str | None:
    """Why another job prevents a re-separation from starting now, or None."""
    if job_is_active(proj):
        return "The stems for this song are already being re-made"
    if proj.get("status") in _BUSY_PIPELINE_STATES:
        return "This song is still being processed"
    if proj.get("render_status") in ("queued", "rendering"):
        return "Wait for the video render to finish first"
    return None


def settle_stale_job(proj: dict, active_cancellations: dict) -> bool:
    """Ends a job that a previous server process left queued or running. True if changed."""
    if not job_is_active(proj) or cancel_key(proj.get("id", "")) in active_cancellations:
        return False
    proj["separation_job"].update(
        status="error",
        detail="Interrupted by a server restart; the song keeps its previous stems",
        error="Interrupted by a server restart",
        eta_seconds=None,
        finished_at=int(time.time()),
    )
    return True


def create_job(proj: dict, quality: str, realign_lyrics: bool, redetect_chords: bool) -> dict:
    job = {
        "id": uuid.uuid4().hex[:12],
        "status": "queued",
        "quality": quality,
        "label": PRESET_LABELS[quality],
        "realign_lyrics": realign_lyrics,
        "redetect_chords": redetect_chords,
        "progress": 0,
        "detail": "Waiting for other jobs to finish…",
        "eta_seconds": None,
        "error": None,
        "created_at": int(time.time()),
        "finished_at": None,
    }
    proj["separation_job"] = job
    return job


def _live(project_id: str, job_id: str) -> tuple[dict, dict]:
    """The project and this job as currently stored, or ReseparationCancelled if gone."""
    proj = find_project(project_id)
    job = proj.get("separation_job") if proj else None
    if not isinstance(job, dict) or job.get("id") != job_id:
        raise ReseparationCancelled()
    return proj, job


def _versioned(url: str, version: int) -> str:
    return f"{url.split('?', 1)[0]}?v={version}"


def run_reseparation(project_id: str, job_id: str) -> None:
    """Background worker for one re-separation job."""
    import backend.main as main_mod

    try:
        proj, job = _live(project_id, job_id)
    except ReseparationCancelled:
        return
    cancel_event = main_mod.active_cancellations.setdefault(
        cancel_key(project_id), threading.Event()
    )
    stems_dir = getattr(main_mod, "STEMS_DIR", STEMS_DIR)
    audio_id = proj.get("track_id") or proj.get("id") or project_id
    staging_root = staging_dir(stems_dir, audio_id)
    quality, label = job["quality"], job["label"]
    started = time.time()
    swapped = False

    def update(**fields: Any) -> None:
        # Once the new stems are in place the remaining steps are short; finish them
        if cancel_event.is_set() and not swapped:
            raise ReseparationCancelled()
        with PROJECTS_LOCK:
            _, current = _live(project_id, job_id)
            current.update(fields, heartbeat=int(time.time() * 1000))
            save_projects()

    acquired = False
    try:
        while not main_mod.WORKER_SEMAPHORE.acquire(timeout=0.25):
            if cancel_event.is_set():
                raise ReseparationCancelled()
        acquired = True

        audio_path = _live(project_id, job_id)[0].get("audio_path")
        if not audio_path or not os.path.isfile(audio_path):
            raise RuntimeError("The original song audio is missing, so the stems cannot be re-made")
        update(status="running", progress=1, detail=f"Starting {label}…")
        progress_floor = 1

        def on_progress(pct: float | None, detail: str, eta: int | None) -> None:
            nonlocal progress_floor
            share = min(_SEPARATION_SHARE, int((pct or 0.0) * _SEPARATION_SHARE / 100))
            progress_floor = max(progress_floor, share)
            update(progress=progress_floor, detail=detail, eta_seconds=eta)

        result = main_mod.separator.separate_stems(
            audio_path=audio_path,
            track_id=f"{STAGING_DIRNAME}/{audio_id}/{job_id}",
            model_name=quality,
            duration=proj.get("duration"),
            progress_callback=on_progress,
            cancel_event=cancel_event,
        )
        update(progress=_SEPARATION_SHARE, detail="Swapping in the new stems…", eta_seconds=None)
        _swap_in(project_id, job_id, result, stems_dir / audio_id, audio_id)
        swapped = True
        _refresh_song(main_mod, project_id, job_id, update)

        with PROJECTS_LOCK:
            proj, job = _live(project_id, job_id)
            separation = result.get("separation") or {
                "preset": quality,
                "label": label,
                "requested": quality,
            }
            proj["separation"] = separation
            proj["separation_quality"] = quality
            job.update(
                status="done",
                progress=100,
                detail=f"Stems re-made with {separation.get('label') or label}",
                eta_seconds=0,
                finished_at=int(time.time()),
                elapsed_seconds=int(time.time() - started),
            )
            save_projects()
        logger.info(f"Re-separated {project_id} with {quality}")
    except Exception as exc:
        cancelled = isinstance(exc, ReseparationCancelled) or (
            cancel_event.is_set() and not swapped
        )
        if not cancelled:
            logger.error(f"Re-separation failed for {project_id}: {exc}", exc_info=True)
        _record_failure(project_id, job_id, exc, cancelled, swapped)
    finally:
        if acquired:
            main_mod.WORKER_SEMAPHORE.release()
        main_mod.active_cancellations.pop(cancel_key(project_id), None)
        shutil.rmtree(staging_root / job_id, ignore_errors=True)
        for empty in (staging_root, staging_root.parent):
            try:
                empty.rmdir()
            except OSError:
                break


def _record_failure(
    project_id: str, job_id: str, exc: Exception, cancelled: bool, swapped: bool
) -> None:
    if swapped:
        status, detail = "error", "The new stems are in place, but updating the song failed"
    elif cancelled:
        status, detail = "cancelled", "Cancelled; the song keeps its previous stems"
    else:
        status, detail = "error", "Could not re-make the stems; the song keeps its previous stems"
    with PROJECTS_LOCK:
        try:
            _, job = _live(project_id, job_id)
        except ReseparationCancelled:
            return  # the song was deleted
        job.update(
            status=status,
            detail=detail,
            error=None if status == "cancelled" else str(exc),
            eta_seconds=None,
            finished_at=int(time.time()),
        )
        save_projects()


def _swap_in(project_id: str, job_id: str, result: dict, target_dir: Path, audio_id: str) -> None:
    """Moves the staged stems over the song's stems and points the project at them."""
    target_dir.mkdir(parents=True, exist_ok=True)
    vocals, instrumental = target_dir / "vocals.wav", target_dir / "instrumental.wav"
    os.replace(result["vocals_path"], vocals)
    os.replace(result["instrumental_path"], instrumental)

    version = int(time.time() * 1000)
    with PROJECTS_LOCK:
        proj, _ = _live(project_id, job_id)
        proj["vocals_path"] = str(vocals)
        proj["vocals_url"] = _versioned(f"/static/stems/{audio_id}/vocals.wav", version)
        current_inst = proj.get("instrumental_path")
        # A user-supplied backing track (custom_inst.*) stays the song's instrumental
        if not current_inst or Path(current_inst).name == "instrumental.wav":
            proj["instrumental_path"] = str(instrumental)
            proj["instrumental_url"] = _versioned(
                f"/static/stems/{audio_id}/instrumental.wav", version
            )
        save_projects()


def _refresh_song(main_mod, project_id: str, job_id: str, update) -> None:
    """Re-derives what depends on the stems: vocal range, chords, word timing, master mix."""
    proj, job = _live(project_id, job_id)
    vocals_path = proj["vocals_path"]
    separated_inst = str(Path(vocals_path).with_name("instrumental.wav"))

    def store(**fields: Any) -> None:
        with PROJECTS_LOCK:
            _live(project_id, job_id)[0].update(fields)
            save_projects()

    update(progress=84, detail="Analyzing the new vocal stem…")
    try:
        store(vocal_range=main_mod.vocal_analyzer.analyze_vocals(vocals_path))
    except ReseparationCancelled:
        raise
    except Exception as exc:
        logger.warning(f"Vocal analysis after re-separation failed: {exc}")

    if job.get("redetect_chords") or not proj.get("chords"):
        update(progress=88, detail="Detecting chords from the new instrumental…")
        try:
            store(chords=main_mod.chord_detector.detect_chords(separated_inst))
        except ReseparationCancelled:
            raise
        except Exception as exc:
            logger.warning(f"Chord detection after re-separation failed: {exc}")

    if job.get("realign_lyrics") and proj.get("lines"):
        update(progress=92, detail="Re-timing words against the new vocals…")
        try:
            lines = [dict(line) for line in _live(project_id, job_id)[0].get("lines") or []]
            store(lines=main_mod.aligner.align_lyrics(vocals_path, lines))
        except ReseparationCancelled:
            raise
        except Exception as exc:
            logger.warning(f"Re-timing lyrics after re-separation failed: {exc}")
            update(warnings=["Word timing was kept: re-timing failed"])

    update(progress=96, detail="Mixing the master track…")
    proj = _live(project_id, job_id)[0]
    semitones = int(proj.get("semitones") or 0)
    guide_volume = float(proj.get("guide_volume") or 0.0)
    track_id = proj.get("track_id") or proj.get("id") or "track"
    output_filename = f"{track_id}_mix_{semitones}_{int(guide_volume * 100)}.wav"
    master_path = main_mod.audio_mixer.mix_and_shift(
        instrumental_path=proj["instrumental_path"],
        vocals_path=vocals_path,
        semitones=semitones,
        guide_volume=guide_volume,
        output_filename=output_filename,
    )
    try:
        version = os.stat(master_path).st_mtime_ns // 1_000_000
    except (OSError, TypeError):
        version = int(time.time() * 1000)
    store(
        master_audio_path=master_path,
        master_audio_url=f"/static/output/{output_filename}?v={version}",
    )
