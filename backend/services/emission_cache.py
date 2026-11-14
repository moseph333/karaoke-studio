"""Saved neural listening passes: the MMS model's emission for one vocal stem.

The expensive part of neural lyric alignment is running the model over the whole stem (the
"emission", frames x letters log-probabilities, about 1.5 MB for a 4-minute song). It depends
only on the vocals, not on the lyrics, so it is kept and every later alignment of the same
stem (realign-lyrics, realign-line, a re-sync after edits) skips the model entirely
(backend.workers.ctc_align_worker reads and writes these files).

Files are keyed by the SHA-256 of the vocals' bytes, so stems can be moved, staged and
swapped (reseparation) without bookkeeping, and new stems never pick up an old emission. They
come from two places: the worker saves one after listening to a song itself, and a cloud
separation (gpu/modal_app.py) computes one on the GPU right after the stems and sends it back
with them (remote_separation calls store()). The folder keeps the MAX_FILES most recently
used files.
"""

import hashlib
import logging
import os
import tempfile
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# Part of every file name: bump it when the model, its labels or the chunking change, so
# emissions made the old way are no longer read (pruning removes them later)
CACHE_VERSION = 1
MAX_FILES = 200
_NPY_MAGIC = b"\x93NUMPY"
_DIGESTS: dict[tuple[str, int, int], str] = {}
_DIGESTS_MAX = 256
_LOCK = threading.Lock()


def cache_dir() -> Path:
    from backend import config

    return Path(config.DATA_DIR) / "alignment_cache"


def path_for_digest(digest: str) -> Path:
    return cache_dir() / f"mms_fa-v{CACHE_VERSION}-{digest}.npy"


def bytes_digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_digest(path: str | Path) -> str:
    """SHA-256 of the file's bytes, remembered by path, size and modification time."""
    resolved = Path(path).resolve()
    stat = resolved.stat()
    key = (str(resolved), stat.st_size, stat.st_mtime_ns)
    with _LOCK:
        known = _DIGESTS.get(key)
    if known:
        return known
    hasher = hashlib.sha256()
    with open(resolved, "rb") as handle:
        while chunk := handle.read(1 << 20):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    with _LOCK:
        if len(_DIGESTS) >= _DIGESTS_MAX:
            _DIGESTS.pop(next(iter(_DIGESTS)))
        _DIGESTS[key] = digest
    return digest


def path_for(vocals_path: str | Path) -> Path | None:
    """Where the emission of these vocals is (or would be) kept; None when the vocals cannot
    be read."""
    try:
        return path_for_digest(file_digest(vocals_path))
    except OSError as exc:
        logger.warning(f"Cannot key the neural listening pass for {vocals_path}: {exc}")
        return None


def store(vocals: bytes, emission: bytes) -> Path | None:
    """Keeps an emission computed elsewhere (a cloud separation) for these vocals' bytes.
    Returns its path, or None when it was not kept. Never raises."""
    if not vocals or not emission or not emission.startswith(_NPY_MAGIC):
        return None
    target = path_for_digest(bytes_digest(vocals))
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".emission-", suffix=".npy", dir=str(target.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(emission)
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
    except OSError as exc:
        logger.warning(f"Could not keep the neural listening pass: {exc}")
        return None
    prune()
    return target


def prune(keep: int = MAX_FILES) -> None:
    """Deletes all but the ``keep`` most recently used emissions. Never raises."""
    try:
        files = [p for p in cache_dir().glob("mms_fa-*.npy") if p.is_file()]
        if len(files) <= keep:
            return
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[keep:]:
            old.unlink(missing_ok=True)
    except OSError as exc:
        logger.warning(f"Could not prune the saved neural listening passes: {exc}")
