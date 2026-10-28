"""Server capability discovery for the studio UI."""

from fastapi import APIRouter

from backend.services.capabilities import get_capabilities

router = APIRouter(tags=["system"])


@router.get("/api/capabilities")
def capabilities():
    """Separation presets and the lyric alignment engine, with reasons when one cannot run."""
    return get_capabilities()
