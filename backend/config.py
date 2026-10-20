"""Central configuration for directory paths, authentication secrets, rate limits, worker concurrency limits, default video/audio specifications, and allowed CORS origins."""

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_APP_VERSION = "v1.6.0"


def _git_cmd(args: list[str], timeout: float = 3.0) -> str:
    """Run a git command safely against BASE_DIR and return stripped stdout."""
    git_dir = BASE_DIR / ".git"
    if not git_dir.exists():
        return ""
    try:
        res = subprocess.run(
            ["git", "-c", f"safe.directory={BASE_DIR}", *args],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if res.returncode == 0:
            return res.stdout.strip()
    except Exception:
        pass
    return ""


def get_app_version() -> str:
    """Resolve the running Karaoke Studio version from APP_VERSION env, git metadata, or default."""
    env_version = os.getenv("APP_VERSION", "").strip()
    if env_version:
        return env_version
    desc = _git_cmd(["describe", "--tags", "--always"], timeout=2.0)
    if desc:
        return desc
    return DEFAULT_APP_VERSION


APP_VERSION = get_app_version()
_UPDATE_CACHE: dict[str, Any] = {
    "checked_at": 0.0,
    "latest_version": None,
    "remote_commit": "",
    "local_commit": "",
    "update_available": False,
}


def _parse_semver_tag(tag: str) -> tuple[int, ...]:
    clean = tag.lstrip("v").split("-", 1)[0]
    parts = []
    for p in clean.split("."):
        if p.isdigit():
            parts.append(int(p))
        else:
            break
    return tuple(parts) if parts else (0,)


def is_update_in_progress() -> bool:
    """Return True if an update trigger or active update status file is present."""
    req_file = DATA_DIR / ".update_requested"
    status_file = DATA_DIR / ".update_status.json"
    now = time.time()
    if req_file.exists():
        try:
            if now - req_file.stat().st_mtime < 300:
                return True
        except OSError:
            pass
    if status_file.exists():
        try:
            payload = json.loads(status_file.read_text(encoding="utf-8"))
            if payload.get("updating") and now - float(payload.get("timestamp", 0)) < 300:
                return True
        except Exception:
            pass
    return False


def check_for_updates(force_remote: bool = False) -> dict[str, Any]:
    """Check local version/commit against origin/main and tags."""
    current_version = get_app_version()
    local_commit = _git_cmd(["rev-parse", "HEAD"], timeout=2.0)
    now = time.time()

    if force_remote or (
        _UPDATE_CACHE["latest_version"] is None and now - _UPDATE_CACHE["checked_at"] > 60
    ):
        remote_out = _git_cmd(
            ["ls-remote", "origin", "refs/heads/main", "refs/tags/*"], timeout=6.0
        )
        if not remote_out:
            remote_out = _git_cmd(
                [
                    "ls-remote",
                    "https://github.com/moseph333/karaoke-studio.git",
                    "refs/heads/main",
                    "refs/tags/*",
                ],
                timeout=6.0,
            )
        remote_main_sha = ""
        tag_shas: dict[str, str] = {}
        if remote_out:
            for line in remote_out.splitlines():
                parts = line.split()
                if len(parts) != 2:
                    continue
                sha, ref = parts
                if ref == "refs/heads/main":
                    remote_main_sha = sha
                elif ref.startswith("refs/tags/"):
                    tag_name = ref.removeprefix("refs/tags/")
                    if tag_name.endswith("^{}"):
                        tag_shas[tag_name[:-3]] = sha
                    elif tag_name not in tag_shas:
                        tag_shas[tag_name] = sha

        latest_tag = current_version
        if tag_shas:
            sorted_tags = sorted(tag_shas.keys(), key=_parse_semver_tag)
            latest_tag = sorted_tags[-1]

        update_avail = False
        latest_ver = latest_tag
        if remote_main_sha and local_commit:
            if remote_main_sha != local_commit:
                update_avail = True
                if tag_shas.get(latest_tag) == remote_main_sha:
                    latest_ver = latest_tag
                else:
                    latest_ver = f"{latest_tag} ({remote_main_sha[:7]})"
            else:
                latest_ver = current_version

        _UPDATE_CACHE.update(
            {
                "checked_at": now,
                "latest_version": latest_ver,
                "remote_commit": remote_main_sha[:7] if remote_main_sha else "",
                "local_commit": local_commit[:7] if local_commit else "",
                "update_available": update_avail,
            }
        )

    updating = is_update_in_progress()
    latest_version = _UPDATE_CACHE.get("latest_version") or current_version
    update_available = bool(_UPDATE_CACHE.get("update_available")) and not updating

    if updating:
        msg = f"Updating to {latest_version}..."
    elif update_available:
        msg = f"Update available: {latest_version}"
    else:
        msg = f"Up to date ({current_version})"

    return {
        "status": "updating" if updating else "ok",
        "service": "Karaoke Studio",
        "version": current_version,
        "latest_version": latest_version,
        "local_commit": _UPDATE_CACHE.get("local_commit")
        or (local_commit[:7] if local_commit else ""),
        "remote_commit": _UPDATE_CACHE.get("remote_commit") or "",
        "update_available": update_available,
        "updating": updating,
        "message": msg,
    }


def trigger_system_update() -> dict[str, Any]:
    """Write the host update trigger file and return current update status."""
    info = check_for_updates(force_remote=True)
    req_file = DATA_DIR / ".update_requested"
    payload = {
        "requested_at": time.time(),
        "from_version": info["version"],
        "target_version": info["latest_version"],
    }
    req_file.write_text(json.dumps(payload), encoding="utf-8")
    info["updating"] = True
    info["update_available"] = False
    info["status"] = "updating"
    info["message"] = f"Updating to {info['latest_version']}..."
    return info


# Automatically load local .env if present
env_file = BASE_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip("'\"")
        if k and k not in os.environ:
            os.environ[k] = v

DATA_DIR = Path(os.getenv("KARAOKE_DATA_DIR", BASE_DIR / "workspace_data"))
DOWNLOADS_DIR = DATA_DIR / "downloads"
STEMS_DIR = DATA_DIR / "stems"
OUTPUT_DIR = DATA_DIR / "output"
ASSETS_DIR = DATA_DIR / "assets"
BACKGROUNDS_DIR = DATA_DIR / "backgrounds"

for d in [DATA_DIR, DOWNLOADS_DIR, STEMS_DIR, OUTPUT_DIR, ASSETS_DIR, BACKGROUNDS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# Access Control
APP_PASSWORD = os.getenv("APP_PASSWORD", "").strip()
LOGIN_RATE_LIMIT_MAX_ATTEMPTS = int(os.getenv("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", "5"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = float(os.getenv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "60.0"))

# Worker Concurrency Configuration
try:
    MAX_CONCURRENT_JOBS = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2").strip()))
except (ValueError, TypeError):
    MAX_CONCURRENT_JOBS = 2


# Allowed Origins for CORS (with support for comma-separated ALLOWED_ORIGINS env var)
raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
if raw_origins:
    ALLOWED_ORIGINS = [orig.strip() for orig in raw_origins.split(",") if orig.strip()]
else:
    ALLOWED_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]


# Default Video Configuration
DEFAULT_VIDEO_CONFIG = {
    "width": 1920,
    "height": 1080,
    "fps": 60,
    "font_name": "Montserrat",
    "font_size": 52,
    "primary_color": "&H0000FFFF",  # Vibrant yellow fill when sung
    "secondary_color": "&H00FFFFFF",  # Crisp white unsung
    "outline_color": "&H00000000",  # Pure black outline
    "shadow_color": "&H80000000",  # Soft shadow
    "outline_width": 3,
    "shadow_width": 2,
    "lead_in_countdown_dots": 3,
}

# YouTube API configuration
YOUTUBE_CLIENT_SECRETS_FILE = BASE_DIR / "client_secret.json"
