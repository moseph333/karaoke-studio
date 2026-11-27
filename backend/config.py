"""Central configuration for directory paths, authentication secrets, rate limits, worker concurrency limits, default video/audio specifications, and allowed CORS origins."""

import json
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Any

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_APP_VERSION = "v2.15.0"  # x-release-please-version

logger = logging.getLogger("karaoke_backend")
# git failures already reported, so a broken git behind every update check warns once each
_git_failures_logged: set[str] = set()


def _log_git_failure(args: list[str], reason: str) -> None:
    command = " ".join(args)
    key = f"{args[0] if args else ''}: {reason}"
    if key in _git_failures_logged:
        logger.debug(f"git {command} failed: {reason}")
        return
    _git_failures_logged.add(key)
    logger.warning(f"git {command} failed: {reason} (repeats are logged at DEBUG)")


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
        _log_git_failure(args, (res.stderr or "").strip()[-300:] or f"exit {res.returncode}")
    except Exception as exc:
        _log_git_failure(args, f"{type(exc).__name__}: {exc}")
    return ""


# What git says about the checkout, kept for the life of the server process. The process
# runs the code it started with, so its version and commit do not change until it restarts;
# asking git again on every GET /api/health (which browsers and health checks poll) spawned
# two git processes per request, and reported a commit the updater had only checked out.
_LOCAL_GIT: dict[str, str] = {}


def _local_git(what: str, args: list[str]) -> str:
    """The answer to a git question about the local checkout, asked once per process. An
    empty answer (git failed, or there is no checkout) is not kept, so it is asked again."""
    known = _LOCAL_GIT.get(what)
    if known:
        return known
    answer = _git_cmd(args, timeout=2.0)
    if answer:
        _LOCAL_GIT[what] = answer
    return answer


def get_app_version() -> str:
    """Resolve the running Karaoke Studio version from APP_VERSION env, git metadata, or default."""
    env_version = os.getenv("APP_VERSION", "").strip()
    if env_version:
        return env_version
    desc = _local_git("describe", ["describe", "--tags", "--always"])
    if desc:
        return desc
    return DEFAULT_APP_VERSION


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
    """Return True if an update trigger, a drain waiting for running jobs or an active update
    status file is present."""
    from backend.update_drain import is_draining

    if is_draining():
        return True
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


def self_update_enabled() -> bool:
    """SELF_UPDATE (default off): a host service applies updates requested through
    POST /api/system/update (the homelab's systemd path unit), so the studio may offer an
    "Update now" button. Read on each call; installs without such a service leave it unset."""
    return os.getenv("SELF_UPDATE", "").strip().lower() in ("1", "true", "yes", "on")


def check_for_updates(force_remote: bool = False) -> dict[str, Any]:
    """Check local version/commit against origin/main and tags."""
    current_version = get_app_version()
    local_commit = _local_git("commit", ["rev-parse", "HEAD"])
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
        "self_update": self_update_enabled(),
        "message": msg,
    }


def trigger_system_update() -> dict[str, Any]:
    """Write the host update trigger file and return current update status.

    The host builds the new image first and, with scripts/update_when_idle.sh, waits for
    running jobs before it restarts (backend.update_drain), so one user's request does not
    cut off another user's render."""
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

# After .env is read, so an APP_VERSION set there counts here too (the API docs show it)
APP_VERSION = get_app_version()

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
# The owner's passphrase for the Server settings page (/api/admin/*), asked for on top of
# APP_PASSWORD. Empty turns the page off: nobody can change a server setting from the studio.
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "").strip()
# A passphrase that only runs a show (the host screen of a karaoke night): it reads the
# library and plays it, and can change nothing. For a venue's host. Empty: a show is run with
# APP_PASSWORD like everything else.
SHOW_PASSWORD = os.getenv("SHOW_PASSWORD", "").strip()
LOGIN_RATE_LIMIT_MAX_ATTEMPTS = int(os.getenv("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", "5"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = float(os.getenv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "60.0"))
# How many reverse proxies in front of the app append to X-Forwarded-For. The rate limit keys
# on the entry that many places from the end (the one the outermost trusted proxy wrote); 0
# ignores the header and keys on the socket address.
try:
    FORWARDED_TRUSTED_HOPS = max(0, int(os.getenv("FORWARDED_TRUSTED_HOPS", "1").strip()))
except (ValueError, TypeError):
    FORWARDED_TRUSTED_HOPS = 1

# What the studio streams while you sing: "wav" (the master mix itself, the default) or
# "aac" (a 160 kbps .m4a copy, about an eighth of the size, which every new mix takes a few
# seconds longer to make). Exports, renders and the waveform always use the WAV.
PREVIEW_AUDIO_FORMAT = os.getenv("PREVIEW_AUDIO_FORMAT", "wav").strip().lower()
if PREVIEW_AUDIO_FORMAT not in ("wav", "aac"):
    PREVIEW_AUDIO_FORMAT = "wav"

# Key and guide mixes (each a WAV plus its .m4a copy) kept per song in OUTPUT_DIR; the least
# recently used go first. The song's current mix is always kept. 0 keeps every mix.
try:
    MIX_CACHE_PER_SONG = max(0, int(os.getenv("MIX_CACHE_PER_SONG", "6").strip()))
except (ValueError, TypeError):
    MIX_CACHE_PER_SONG = 6

# Worker Concurrency Configuration
try:
    MAX_CONCURRENT_JOBS = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2").strip()))
except (ValueError, TypeError):
    MAX_CONCURRENT_JOBS = 2


def _min_free_mb(raw: str | None) -> int:
    """DISK_MIN_FREE_MB from its setting: whole MB, at least 0; unset or unreadable is 1024."""
    try:
        return max(0, int((raw or "").strip()))
    except ValueError:
        return 1024


def _max_song_minutes(raw: str | None) -> int:
    """MAX_SONG_MINUTES from its setting: whole minutes, at least 0; unset or unreadable
    is 60."""
    try:
        return max(0, int((raw or "").strip()))
    except ValueError:
        return 60


# The longest recording a pasted link may download, in minutes. A link to an hours-long
# video or mix is refused before anything is downloaded; 0 lifts the limit. Uploaded files
# have their own size limit.
MAX_SONG_MINUTES = _max_song_minutes(os.getenv("MAX_SONG_MINUTES"))


def _max_album_minutes(raw: str | None) -> int:
    """MAX_ALBUM_MINUTES from its setting: whole minutes, at least 0; unset or unreadable
    is 120."""
    try:
        return max(0, int((raw or "").strip()))
    except ValueError:
        return 120


# The longest whole-album recording a pasted link may download to pick songs from, in
# minutes (kept compressed, as yt-dlp fetched it; each picked song is cut out of it). Albums
# are told apart from songs before anything downloads; 0 lifts the limit.
MAX_ALBUM_MINUTES = _max_album_minutes(os.getenv("MAX_ALBUM_MINUTES"))


def _song_search_sources(raw: str | None) -> tuple[str, ...]:
    """SONG_SEARCH_SOURCES from its setting: the known names in it, lower case, once each;
    unset is all of them, and "none" (or any text naming no known service) is none."""
    known = ("deezer", "itunes", "suggest")
    if raw is None or not raw.strip():
        return known
    asked = {part.strip().lower() for part in raw.split(",")}
    return tuple(name for name in known if name in asked)


def _song_search_country(raw: str | None) -> str:
    """SONG_SEARCH_COUNTRY from its setting: a two-letter store code, lower case; unset or
    unreadable is "us"."""
    code = (raw or "").strip().lower()
    return code if len(code) == 2 and code.isascii() and code.isalpha() else "us"


# The services the song search asks, comma-separated: "deezer" and "itunes" are the music
# catalogs the results come from, "suggest" is YouTube's search suggestions, used to respell
# a misspelled query. "none" turns the catalog search off; the studio then lists YouTube
# uploads, as it does when no catalog answers.
SONG_SEARCH_SOURCES = _song_search_sources(os.getenv("SONG_SEARCH_SOURCES"))
# The iTunes Store whose songs are searched (a two-letter country code)
SONG_SEARCH_COUNTRY = _song_search_country(os.getenv("SONG_SEARCH_COUNTRY"))


# Free space (MB) to keep on the data folder's disk. Below it, new songs, uploads, renders and
# re-separations are refused with HTTP 507; edits to existing songs are never blocked. 0 turns
# the check off.
DISK_MIN_FREE_MB = _min_free_mb(os.getenv("DISK_MIN_FREE_MB"))


# Allowed Origins for CORS (with support for comma-separated ALLOWED_ORIGINS env var)
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]


def parse_allowed_origins(raw: str | None) -> list[str]:
    """ALLOWED_ORIGINS from its setting; unset or empty gives the local dev origins.

    A "*" is dropped: with credentials allowed, Starlette answers it by echoing any Origin
    back, which would let every website read the API with the visitor's session."""
    origins = [orig.strip() for orig in (raw or "").split(",") if orig.strip()]
    if not origins:
        return list(DEFAULT_ALLOWED_ORIGINS)
    if "*" in origins:
        logger.warning(
            "ALLOWED_ORIGINS contains '*', which is ignored: list the studio's origins instead"
        )
        origins = [orig for orig in origins if orig != "*"]
    return origins


ALLOWED_ORIGINS = parse_allowed_origins(os.getenv("ALLOWED_ORIGINS"))


def parse_allowed_hosts(raw: str | None) -> list[str]:
    """ALLOWED_HOSTS from its setting: lower-cased host names, a leading "*." matching any
    subdomain. Empty means any Host header is answered."""
    return [h.strip().lower() for h in (raw or "").split(",") if h.strip()]


# Host names the server answers to. Empty answers any Host header. Setting it stops DNS
# rebinding, where a website points its own name at this server to reach an install that has
# no passphrase. localhost, 127.0.0.1 and ::1 are always answered (health checks).
ALLOWED_HOSTS = parse_allowed_hosts(os.getenv("ALLOWED_HOSTS"))


def _body_limit_mb(raw: str | None) -> float:
    """MAX_JSON_BODY_MB from its setting: MB above 0; unset or unreadable is 16."""
    try:
        value = float((raw or "").strip())
    except ValueError:
        return 16.0
    return value if value > 0 and value == value else 16.0


# Largest request body (MB) outside the upload routes, which have their own limits. Larger
# bodies get HTTP 413 before they are read.
MAX_JSON_BODY_MB = _body_limit_mb(os.getenv("MAX_JSON_BODY_MB"))


# YouTube API configuration
YOUTUBE_CLIENT_SECRETS_FILE = BASE_DIR / "client_secret.json"
