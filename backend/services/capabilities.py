"""What this server can do right now, for the UI's quality pickers: separation presets, the
splits of the vocal stem into parts, the lyric alignment engine, and song loops.

Detection only inspects installed package metadata and files on disk; it never imports
PyTorch, so the endpoint stays fast and safe to call on every page load. Presets that run on
the cloud GPU (SEPARATION_REMOTE) say so in "runs_on" and report the GPU's speed. Presets
the server does not offer (SEPARATION_PRESETS) are left out.
"""

from typing import Any

from backend.services.alignment_config import alignment_capabilities
from backend.services.separation_presets import (
    CPU_REALTIME_FACTORS,
    REMOTE_REALTIME_FACTORS,
    configured_preset,
    downloads_allowed,
    fallback_chain,
    offered_presets,
    plan_status,
    preset_plan,
    remote_backend,
    weights_cached,
)
from backend.services.show_videos import capability as show_capability
from backend.services.song_loops import capability as song_loop_capability
from backend.services.vocal_parts import split_capabilities


def separation_capabilities() -> dict[str, Any]:
    presets = []
    ready_by_id: dict[str, bool] = {}
    for preset in offered_presets():
        plan = preset_plan(preset)
        ready, reason = plan_status(plan)
        ready_by_id[preset] = ready
        remote = plan.engine == "roformer" and remote_backend() is not None
        presets.append(
            {
                "id": preset,
                "label": plan.label,
                "engine": plan.engine,
                "models": list(plan.models),
                "available": ready,
                "reason": reason,
                # Demucs fetches its own weights through torch.hub, and the cloud GPU keeps its
                # own; only local RoFormer weights are tracked
                "weights_cached": weights_cached(plan.models)
                if plan.engine == "roformer" and not remote
                else None,
                "cpu_realtime_factor": REMOTE_REALTIME_FACTORS[preset]
                if remote
                else CPU_REALTIME_FACTORS[preset],
                "gpu_recommended": preset == "best" and not remote,
                "runs_on": "cloud-gpu" if remote else None,
            }
        )

    default = configured_preset()
    effective = next(
        (p.preset for p in fallback_chain(preset_plan(default)) if ready_by_id.get(p.preset)),
        "fast",
    )
    return {
        "default": default,
        "effective_default": effective,
        "downloads_allowed": downloads_allowed(),
        "presets": presets,
        "vocal_parts": split_capabilities(),
    }


def get_capabilities() -> dict[str, Any]:
    return {
        "separation": separation_capabilities(),
        "alignment": alignment_capabilities(),
        "song_loop": song_loop_capability(),
        "show": show_capability(),
    }
