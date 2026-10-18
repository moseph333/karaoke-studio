"""Upload validation utilities, byte-bounded streaming file writers, magic-byte header inspection, and allowed file extension rules."""

import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

# Upload security limits and allowed MIME extensions
MAX_BACKGROUND_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_IMAGE_BACKGROUND_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_INSTRUMENTAL_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_TRACK_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB
ALLOWED_BACKGROUND_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm"}
ALLOWED_AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"}


def sanitize_upload_filename(filename: str | None, default_stem: str = "upload") -> str:
    if not filename:
        return default_stem
    raw_name = Path(filename.replace("\x00", "")).name
    # Strip dangerous characters and allow only alphanumeric, underscore, dot, and dash
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]", "_", raw_name).strip("._-")
    return cleaned or default_stem


def validate_background_header(data: bytes, ext: str) -> bool:
    if len(data) < 2:
        return False
    ext = ext.lower()
    if ext in [".jpg", ".jpeg"]:
        return data.startswith(b"\xff\xd8")
    elif ext == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    elif ext == ".webp":
        return data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP"
    elif ext == ".mp4":
        return len(data) >= 8 and data[4:8] == b"ftyp"
    elif ext == ".webm":
        return len(data) >= 4 and data.startswith(b"\x1a\x45\xdf\xa3")
    return False


validate_image_header = validate_background_header


def validate_audio_header(data: bytes, ext: str) -> bool:
    if len(data) < 2:
        return False
    ext = ext.lower()
    if ext == ".wav":
        return data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WAVE"
    elif ext == ".mp3":
        return data.startswith(b"ID3") or (
            len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0
        )
    elif ext == ".flac":
        return data.startswith(b"fLaC")
    elif ext == ".ogg":
        return data.startswith(b"OggS")
    elif ext == ".m4a":
        return len(data) >= 8 and data[4:8] == b"ftyp"
    elif ext == ".aac":
        return (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xF6) == 0xF0) or (
            len(data) >= 8 and data[4:8] == b"ftyp"
        )
    return False


async def save_upload_file_bounded(
    file: UploadFile,
    target_path: Path,
    max_bytes: int,
    min_bytes: int = 1,
) -> int:
    """Streams and writes UploadFile content to disk with a strict byte ceiling.

    Avoids unbounded memory consumption and prevents DoS through large file payloads.
    """
    total_bytes = 0
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_suffix(f".tmp.{uuid.uuid4().hex}")
    try:
        with open(temp_path, "wb") as f:
            while chunk := await file.read(1024 * 64):
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Uploaded file exceeds maximum permitted size of {max_bytes // (1024 * 1024)}MB",
                    )
                f.write(chunk)
        if total_bytes < min_bytes:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty (0 bytes)",
            )
        temp_path.replace(target_path)
        return total_bytes
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
