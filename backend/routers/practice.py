"""Practice API router: what the studio's practice view asks the server for.

The original singer is switched on and off at once there, without a new master: the browser
plays the song's vocals by themselves beside the master and changes their level. This router
says where those vocals are, and makes them at the master's key when that is not the
original (see ``master_audio.make_practice_vocal``).

A singer's pitch is drawn there against the song's melody, which this router also serves
(see ``services/melody``).
"""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from backend.background_jobs import BUSY_PIPELINE_STATES
from backend.config import OUTPUT_DIR
from backend.master_audio import (
    VocalsChanged,
    find_practice_vocal,
    make_practice_vocal,
    mix_version,
    preview_for,
    prune_mix_cache,
    streams_previews,
)
from backend.project_analysis import StemMissing, ensure_melody, usable_file
from backend.project_store import ensure_free_space, get_project_or_404
from backend.schemas import MelodyResponse, PracticeVocalRequest, PracticeVocalResponse

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["practice"])

NO_VOCALS_DETAIL = "This song has no separate vocal track."
VOCALS_CHANGED_DETAIL = "The song's vocals were just replaced. Try again."


def _stem_url(proj: dict, vocals: str) -> str:
    """Where the vocal stem itself is served: the song's own link to it (versioned after a
    re-separation), else the stem's place under /static/stems."""
    url = proj.get("vocals_url")
    if isinstance(url, str) and url:
        return url
    stem = Path(vocals)
    return f"/static/stems/{stem.parent.name}/{stem.name}"


@router.post(
    "/api/project/{project_id}/practice-vocal",
    response_model=PracticeVocalResponse,
    summary="The song's vocals alone, at a key",
)
def practice_vocal(project_id: str, req: PracticeVocalRequest):
    """Where the song's vocals by themselves are served at `semitones` from the original key,
    making the file first when it is not there. Practice plays it beside the master, so send
    the key the master was mixed at.

    At the original key on a server that streams WAVs, the answer is the vocal stem itself
    and nothing is made. Otherwise the file is kept with the song's cached mixes
    (`MIX_CACHE_PER_SONG`) and served in the master's format. Nothing is saved on the song.
    """
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    if proj.get("status") in BUSY_PIPELINE_STATES:
        raise HTTPException(status_code=409, detail="This song is still being processed")
    vocals = proj.get("vocals_path")
    if not usable_file(vocals):
        raise HTTPException(status_code=400, detail=NO_VOCALS_DETAIL)

    # The stem as it is: nothing to shift, and the master is a WAV too
    if req.semitones == 0 and not streams_previews():
        return {"status": "ok", "url": _stem_url(proj, vocals), "semitones": 0}

    path = find_practice_vocal(proj, req.semitones)
    if path is None:
        ensure_free_space()
        try:
            path = make_practice_vocal(proj, req.semitones)
        except VocalsChanged as exc:
            raise HTTPException(status_code=409, detail=VOCALS_CHANGED_DETAIL) from exc
        except Exception as exc:
            logger.error(f"Practice vocal failed for {project_id}: {exc}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail="Could not make the vocal track. See the server log for details.",
            ) from exc

    # The same format as the master, so the two play in step: a compressed copy starts a few
    # milliseconds late, and both must be late alike
    served = preview_for(path) or path
    output_dir = getattr(main_mod, "OUTPUT_DIR", OUTPUT_DIR)
    track_id = proj.get("track_id") or proj.get("id") or "track"
    prune_mix_cache(output_dir, track_id, proj.get("instrumental_path"), vocals, keep=path)
    return {
        "status": "ok",
        "url": f"/static/output/{Path(served).name}?v={mix_version(served)}",
        "semitones": req.semitones,
    }


@router.get(
    "/api/project/{project_id}/melody",
    response_model=MelodyResponse,
    summary="The pitch the song's singer holds, over time",
)
def song_melody(project_id: str):
    """The song's melody: one MIDI note number per frame of its vocals (`start` seconds in,
    then every `hop` seconds), null where nothing is sung, in the song's original key. `low`
    and `high` are the range to draw it in.

    It is read from the lead part when the vocals have been split into lead and backing,
    else from the whole vocal stem (`source`), worked out on the first request and kept
    beside the stems until the vocals change. Vocals with nothing sung in them, or that
    cannot be read, answer with `detected: false`."""
    try:
        return {"project_id": project_id, **ensure_melody(project_id)}
    except StemMissing as exc:
        raise HTTPException(status_code=400, detail=NO_VOCALS_DETAIL) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Melody analysis failed for {project_id}: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Could not work out the melody. See the server log for details.",
        ) from exc
