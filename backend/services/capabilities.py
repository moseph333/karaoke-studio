"""What this server can do right now, for the UI's quality pickers: separation presets and
the lyric alignment engine.

Detection only inspects installed package metadata and files on disk; it never imports
PyTorch, so the endpoint stays fast and safe to call on every page load.
"""

from typing import Any

from backend.services.alignment_config import alignment_capabilities
from backend.services.separation_presets import (
    CPU_REALTIME_FACTORS,
    PRESET_IDS,
    configured_preset,
    downloads_allowed,
    fallback_chain,
    plan_status,
    preset_plan,
    weights_cached,
)


def separation_capabilities() -> dict[str, Any]:
    presets = []
    ready_by_id: dict[str, bool] = {}
    for preset in PRESET_IDS:
        plan = preset_plan(preset)
        ready, reason = plan_status(plan)
        ready_by_id[preset] = ready
        presets.append(
            {
                "id": preset,
                "label": plan.label,
                "engine": plan.engine,
                "models": list(plan.models),
                "available": ready,
                "reason": reason,
                # Demucs fetches its own weights through torch.hub; only RoFormer is tracked
                "weights_cached": weights_cached(plan.models)
                if plan.engine == "roformer"
                else None,
                "cpu_realtime_factor": CPU_REALTIME_FACTORS[preset],
                "gpu_recommended": preset == "best",
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
    }


def get_capabilities() -> dict[str, Any]:
    return {"separation": separation_capabilities(), "alignment": alignment_capabilities()}
