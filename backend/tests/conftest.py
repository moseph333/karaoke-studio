from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.main import active_cancellations, app, clear_all_login_failures, projects


@pytest.fixture(autouse=True)
def isolate_test_environment(tmp_path: Path, monkeypatch):
    """
    Isolates each test run in a temporary data directory so workspace_data is never touched.
    """
    test_data_dir = tmp_path / "workspace_data"
    test_downloads = test_data_dir / "downloads"
    test_stems = test_data_dir / "stems"
    test_output = test_data_dir / "output"
    test_assets = test_data_dir / "assets"
    test_backgrounds = test_data_dir / "backgrounds"
    test_store = test_data_dir / "projects.json"

    for d in [
        test_data_dir,
        test_downloads,
        test_stems,
        test_output,
        test_assets,
        test_backgrounds,
    ]:
        d.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(config, "DATA_DIR", test_data_dir)
    monkeypatch.setattr(config, "DOWNLOADS_DIR", test_downloads)
    monkeypatch.setattr(config, "STEMS_DIR", test_stems)
    monkeypatch.setattr(config, "OUTPUT_DIR", test_output)
    monkeypatch.setattr(config, "ASSETS_DIR", test_assets)
    monkeypatch.setattr(config, "BACKGROUNDS_DIR", test_backgrounds)

    import backend.main as main_mod

    monkeypatch.setattr(main_mod, "DATA_DIR", test_data_dir)
    monkeypatch.setattr(main_mod, "DOWNLOADS_DIR", test_downloads)
    monkeypatch.setattr(main_mod, "STEMS_DIR", test_stems)
    monkeypatch.setattr(main_mod, "OUTPUT_DIR", test_output)
    monkeypatch.setattr(main_mod, "BACKGROUNDS_DIR", test_backgrounds)
    monkeypatch.setattr(main_mod, "PROJECTS_STORE_FILE", test_store)
    monkeypatch.setattr(main_mod, "PROJECTS_BACKUP_FILE", test_data_dir / "projects.json.bak")

    # Set default test passphrase if unset so auth-gated fixtures and routes work in CI
    if not config.APP_PASSWORD:
        monkeypatch.setattr(config, "APP_PASSWORD", "sluggos")

    # Hermetic ML settings: the bundled engines only, no model downloads, models under tmp
    monkeypatch.setenv("SEPARATION_QUALITY", "fast")
    monkeypatch.setenv("SEPARATION_ALLOW_DOWNLOAD", "0")
    monkeypatch.setenv("AUDIO_SEPARATOR_MODEL_DIR", str(test_data_dir / "models" / "separator"))
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("ALIGNMENT_ENGINE", "dsp")
    monkeypatch.setenv("ALIGNMENT_ALLOW_DOWNLOAD", "0")
    monkeypatch.setenv("ALIGNMENT_MODEL_DIR", str(test_data_dir / "models" / "mms_fa"))
    for name in (
        "SEPARATION_TIMEOUT_SEC",
        "SEPARATION_STALL_SEC",
        "ALIGNMENT_TIMEOUT_SEC",
        "ALIGNMENT_STALL_SEC",
        "ALIGNMENT_MIN_CONFIDENCE",
        "ALIGN_REFINE_PLAIN",
        "SEPARATION_REMOTE",
        "SEPARATION_REMOTE_APP",
        "SEPARATION_REMOTE_QUEUE_SEC",
        "MODAL_TOKEN_ID",
        "MODAL_TOKEN_SECRET",
        "RENDER_REMOTE",
        "RENDER_REMOTE_QUEUE_SEC",
        "RENDER_REMOTE_TIMEOUT_SEC",
        "FFMPEG_PRESET",
    ):
        monkeypatch.delenv(name, raising=False)
    from backend.services import separator as separator_service
    from backend.services import sync_confidence

    sync_confidence.clear_cache()
    # Demucs commands must not depend on which Demucs version is installed; tests that cover
    # the 4.1 quality flags switch them on themselves
    monkeypatch.setattr(separator_service, "demucs_supports_quality_flags", lambda: False)

    # Re-target mounted Starlette StaticFiles directories to isolated test directories
    for route in app.routes:
        if hasattr(route, "name") and hasattr(route, "app"):
            if route.name == "downloads":
                monkeypatch.setattr(route.app, "directory", str(test_downloads))
                monkeypatch.setattr(route.app, "all_directories", [str(test_downloads)])
            elif route.name == "stems":
                monkeypatch.setattr(route.app, "directory", str(test_stems))
                monkeypatch.setattr(route.app, "all_directories", [str(test_stems)])
            elif route.name == "output":
                monkeypatch.setattr(route.app, "directory", str(test_output))
                monkeypatch.setattr(route.app, "all_directories", [str(test_output)])
            elif route.name == "backgrounds":
                monkeypatch.setattr(route.app, "directory", str(test_backgrounds))
                monkeypatch.setattr(route.app, "all_directories", [str(test_backgrounds)])

    projects.clear()
    active_cancellations.clear()
    clear_all_login_failures()

    yield

    projects.clear()
    active_cancellations.clear()
    clear_all_login_failures()


@pytest.fixture
def auth_headers():
    pwd = config.APP_PASSWORD or "sluggos"
    return {"X-App-Password": pwd}


@pytest.fixture
def auth_cookies():
    pwd = config.APP_PASSWORD or "sluggos"
    return {"karaoke_token": pwd}


@pytest.fixture
def client(auth_headers, auth_cookies):
    return TestClient(app, headers=auth_headers, cookies=auth_cookies)


@pytest.fixture
def unauth_client():
    return TestClient(app)
