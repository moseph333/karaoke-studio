import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from backend import config
from backend.main import app, projects, active_cancellations

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

    for d in [test_data_dir, test_downloads, test_stems, test_output, test_assets, test_backgrounds]:
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

    projects.clear()
    active_cancellations.clear()

    yield

    projects.clear()
    active_cancellations.clear()

@pytest.fixture
def auth_headers():
    pwd = config.APP_PASSWORD
    if pwd:
        return {"X-App-Password": pwd}
    return {}

@pytest.fixture
def auth_cookies():
    pwd = config.APP_PASSWORD
    if pwd:
        return {"karaoke_token": pwd}
    return {}

@pytest.fixture
def client(auth_headers, auth_cookies):
    return TestClient(app, headers=auth_headers, cookies=auth_cookies)

@pytest.fixture
def unauth_client():
    return TestClient(app)
