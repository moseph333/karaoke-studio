"""Session tokens are signed with the passphrase keyed by a server-side secret, so a token
alone is no help in guessing the passphrase offline."""

import base64
import hashlib
import hmac
import os
import stat

from backend import auth, config
from backend.auth import create_session_token, session_signing_key, verify_session_token

PASSPHRASE = "signing-key-passphrase"


def _signature(token: str) -> str:
    return token.split(".")[1]


def _sign(key: bytes, payload_b64: str) -> str:
    digest = hmac.new(key, payload_b64.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def test_a_token_is_not_signed_with_the_passphrase_alone():
    token = create_session_token(PASSPHRASE, "singer")
    payload_b64 = token.split(".")[0]
    assert _signature(token) != _sign(PASSPHRASE.encode(), payload_b64)
    assert _signature(token) == _sign(session_signing_key(PASSPHRASE), payload_b64)
    # A token signed the old way (passphrase as the key) no longer verifies
    legacy = f"{payload_b64}.{_sign(PASSPHRASE.encode(), payload_b64)}"
    assert verify_session_token(legacy, PASSPHRASE) is False
    assert verify_session_token(token, PASSPHRASE) is True


def test_the_secret_file_is_created_private_and_reused():
    path = config.DATA_DIR / auth.SESSION_SECRET_FILE_NAME
    assert not path.exists()
    token = create_session_token(PASSPHRASE)
    assert path.is_file()
    if os.name == "posix":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    secret = path.read_text()
    assert len(secret) == 64
    # A new process (empty cache) reads the same file, so sessions survive a restart
    auth._session_secrets.clear()
    assert verify_session_token(token, PASSPHRASE) is True
    assert path.read_text() == secret


def test_a_new_secret_signs_everyone_out():
    token = create_session_token(PASSPHRASE)
    (config.DATA_DIR / auth.SESSION_SECRET_FILE_NAME).write_text("rotated")
    auth._session_secrets.clear()
    assert verify_session_token(token, PASSPHRASE) is False


def test_session_secret_env_wins_over_the_file(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "from-the-environment")
    token = create_session_token(PASSPHRASE)
    assert not (config.DATA_DIR / auth.SESSION_SECRET_FILE_NAME).exists()
    expected = hmac.new(b"from-the-environment", PASSPHRASE.encode(), hashlib.sha256).digest()
    assert session_signing_key(PASSPHRASE) == expected
    monkeypatch.setenv("SESSION_SECRET", "another")
    assert verify_session_token(token, PASSPHRASE) is False


def test_an_unwritable_data_folder_still_signs_tokens(monkeypatch, tmp_path, caplog):
    blocked = tmp_path / "not-a-folder"
    blocked.write_text("a file where the data folder should be")
    monkeypatch.setattr(config, "DATA_DIR", blocked)
    token = create_session_token(PASSPHRASE)
    assert verify_session_token(token, PASSPHRASE) is True
    assert "sessions will end when the server restarts" in caplog.text
