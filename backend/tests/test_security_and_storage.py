import io
import json
import threading
from pathlib import Path
from fastapi.testclient import TestClient
from backend import config
import backend.main as main_mod
from backend.main import (
    app,
    projects,
    save_projects,
    load_projects,
)

def test_static_file_protection_unauthenticated(unauth_client):
    test_file = main_mod.DOWNLOADS_DIR / "sample_track.wav"
    test_file.write_bytes(b"RIFF dummy audio data")

    res = unauth_client.get("/static/downloads/sample_track.wav")
    assert res.status_code == 401
    assert "passphrase" in res.json().get("detail", "").lower()

def test_static_file_access_authenticated(client, auth_cookies, auth_headers):
    test_file = main_mod.DOWNLOADS_DIR / "sample_track.wav"
    test_file.write_bytes(b"RIFF dummy audio data")

    # Access using client fixture (which has both cookies and headers)
    res = client.get("/static/downloads/sample_track.wav")
    assert res.status_code == 200
    assert res.content == b"RIFF dummy audio data"

    # Access using standalone unauth client with ONLY cookie
    cookie_client = TestClient(app, cookies=auth_cookies)
    res_cookie = cookie_client.get("/static/downloads/sample_track.wav")
    assert res_cookie.status_code == 200
    assert res_cookie.content == b"RIFF dummy audio data"

    # Access using standalone unauth client with ONLY header
    header_client = TestClient(app, headers=auth_headers)
    res_header = header_client.get("/static/downloads/sample_track.wav")
    assert res_header.status_code == 200
    assert res_header.content == b"RIFF dummy audio data"

def test_cookie_lifecycle_login_logout(unauth_client):
    pwd = config.APP_PASSWORD
    login_res = unauth_client.post(
        "/api/auth/login",
        json={"password": pwd, "username": "TestSinger"}
    )
    assert login_res.status_code == 200
    assert "karaoke_token" in login_res.cookies
    assert login_res.cookies["karaoke_token"] == pwd

    # Logout
    logout_res = unauth_client.post("/api/auth/logout")
    assert logout_res.status_code == 200
    # Cookie is expired / deleted
    cookie_header = logout_res.headers.get("set-cookie", "")
    assert 'karaoke_token=""' in cookie_header or 'Max-Age=0' in cookie_header

def test_upload_filename_sanitization(client):
    # Test path traversal in upload-background
    malicious_filename = "../../../etc/cron.d/malicious.jpg"
    res = client.post(
        "/api/upload-background",
        files={"file": (malicious_filename, io.BytesIO(b"echo pwned"), "image/jpeg")}
    )
    assert res.status_code == 200
    bg_id = res.json()["bg_id"]

    assert ".." not in bg_id
    assert "/" not in bg_id
    assert "\\" not in bg_id

    # Ensure saved file is strictly in BACKGROUNDS_DIR
    saved_file = main_mod.BACKGROUNDS_DIR / bg_id
    assert saved_file.exists()
    assert saved_file.resolve().parent == main_mod.BACKGROUNDS_DIR.resolve()

def test_atomic_persistence_and_recovery():
    # Save a valid state
    projects["proj_recover"] = {"id": "proj_recover", "title": "Recovery Song"}
    save_projects()

    assert main_mod.PROJECTS_STORE_FILE.exists()
    assert "proj_recover" in main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8")

    # Save a second update so that PROJECTS_BACKUP_FILE is created
    projects["proj_recover_2"] = {"id": "proj_recover_2", "title": "Second Song"}
    save_projects()
    assert main_mod.PROJECTS_BACKUP_FILE.exists()

    # Corrupt the primary store
    main_mod.PROJECTS_STORE_FILE.write_text("{this is corrupted json!!", encoding="utf-8")

    # load_projects should smoothly recover from backup without raising an exception
    recovered = load_projects()
    assert "proj_recover" in recovered

def test_concurrent_atomic_saves():
    num_threads = 10
    errors = []

    def worker(worker_id: int):
        try:
            for i in range(5):
                pid = f"worker_{worker_id}_run_{i}"
                projects[pid] = {"id": pid, "status": "testing", "progress": i * 20}
                save_projects()
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(num_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Concurrent saves produced errors: {errors}"
    assert main_mod.PROJECTS_STORE_FILE.exists()

    # Verify JSON is completely intact and parsable
    content = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
    assert len(content) > 0


def test_http_security_headers_present(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


def test_upload_background_extension_validation(client):
    # Reject .html
    html_res = client.post(
        "/api/upload-background",
        files={"file": ("exploit.html", io.BytesIO(b"<script>alert(1)</script>"), "text/html")}
    )
    assert html_res.status_code == 400
    assert "Unsupported image format" in html_res.json()["detail"]

    # Reject .svg
    svg_res = client.post(
        "/api/upload-background",
        files={"file": ("vector.svg", io.BytesIO(b"<svg></svg>"), "image/svg+xml")}
    )
    assert svg_res.status_code == 400
    assert "Unsupported image format" in svg_res.json()["detail"]

    # Allow valid image extension
    valid_res = client.post(
        "/api/upload-background",
        files={"file": ("wallpaper.jpg", io.BytesIO(b"\xff\xd8\xff\xe0 dummy jpeg"), "image/jpeg")}
    )
    assert valid_res.status_code == 200
    assert "bg_id" in valid_res.json()


def test_upload_file_size_limit(client, monkeypatch):
    # Temporarily set upload limit to 100 bytes for testing
    monkeypatch.setattr(main_mod, "MAX_BACKGROUND_UPLOAD_BYTES", 100)
    large_payload = b"X" * 105

    res = client.post(
        "/api/upload-background",
        files={"file": ("big_image.png", io.BytesIO(large_payload), "image/png")}
    )
    assert res.status_code == 413
    assert "exceeds maximum permitted size" in res.json()["detail"]

