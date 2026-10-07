import pytest
from fastapi.testclient import TestClient
from backend.main import app
import backend.config as config

def test_auth_status_open():
    client = TestClient(app)
    # When APP_PASSWORD is empty
    orig_pwd = config.APP_PASSWORD
    try:
        config.APP_PASSWORD = ""
        res = client.get("/api/auth/status")
        assert res.status_code == 200
        assert res.json()["auth_required"] is False
    finally:
        config.APP_PASSWORD = orig_pwd

def test_auth_status_and_protected_routes():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    try:
        config.APP_PASSWORD = "secret_passphrase"
        
        # Auth status indicates required
        res = client.get("/api/auth/status")
        assert res.status_code == 200
        assert res.json()["auth_required"] is True

        # Unauthenticated request to protected route fails with 401
        res = client.get("/api/projects")
        assert res.status_code == 401

        # Incorrect password fails with 401
        res = client.post("/api/auth/login", json={"password": "wrong_password", "username": "Tester"})
        assert res.status_code == 401

        # Correct password succeeds
        res = client.post("/api/auth/login", json={"password": "secret_passphrase", "username": "Tester"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["username"] == "Tester"

        # Request with X-App-Password header succeeds
        res = client.get("/api/projects", headers={"X-App-Password": "secret_passphrase"})
        assert res.status_code == 200

        # Health endpoint remains open without auth
        res = client.get("/api/health")
        assert res.status_code == 200
    finally:
        config.APP_PASSWORD = orig_pwd
