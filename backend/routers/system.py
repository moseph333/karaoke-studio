"""Server capability discovery for the studio UI."""

from fastapi import APIRouter

from backend.services.capabilities import get_capabilities

router = APIRouter(tags=["system"])


@router.get("/api/capabilities")
def capabilities():
    """Available stem separation presets (with reasons when one cannot run) and defaults."""
    return get_capabilities()
