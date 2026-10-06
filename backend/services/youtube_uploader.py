import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from backend.config import YOUTUBE_CLIENT_SECRETS_FILE

logger = logging.getLogger(__name__)

class YouTubeMetadataService:
    @staticmethod
    def generate_youtube_package(
        title: str,
        artist: str,
        lines: List[Dict[str, Any]],
        semitones: int = 0,
        has_guide_vocal: bool = False
    ) -> Dict[str, Any]:
        """
        Creates SEO-optimized metadata and description for YouTube upload.
        """
        key_note = f"Key: {'Original Key' if semitones == 0 else f'{semitones:+d} Semitones'}"
        vocal_type = "Instrumental with Backing/Guide" if has_guide_vocal else "Instrumental Backing Track"

        yt_title = f"{artist} - {title} (Karaoke Version / With Lyrics)"
        
        # Build clean lyrics text
        lyric_lines = [l.get("text", "") for l in lines if l.get("text")]
        lyrics_text = "\n".join(lyric_lines)

        # Build chapter markers if there are clear sections or timestamps
        chapters = ["00:00 - Intro"]
        if lines:
            first_lyric = lines[0].get("start_time", 0.0)
            mins = int(first_lyric // 60)
            secs = int(first_lyric % 60)
            chapters.append(f"{mins:02d}:{secs:02d} - Lyrics Start")

        description = (
            f"Sing along to \"{title}\" originally by {artist}!\n\n"
            f"🎵 Details:\n"
            f"• Song: {title}\n"
            f"• Original Artist: {artist}\n"
            f"• {key_note}\n"
            f"• Type: {vocal_type}\n\n"
            f"🕒 Timestamps:\n"
            f"{chr(10).join(chapters)}\n\n"
            f"📜 Lyrics:\n"
            f"{lyrics_text}\n\n"
            f"-----------------------------------------\n"
            f"Created with YouTube Karaoke Studio.\n"
            f"All rights belong to their respective copyright holders."
        )

        tags = [
            "karaoke",
            "karaoke version",
            "instrumental",
            "lyrics",
            "sing along",
            artist.lower(),
            title.lower(),
            f"{artist.lower()} karaoke",
            f"{title.lower()} karaoke",
            "backing track",
            "karaoke with lyrics"
        ]

        return {
            "title": yt_title,
            "description": description,
            "tags": tags,
            "key_note": key_note,
            "lyrics": lyrics_text,
            "privacy_status": "unlisted"
        }

    @staticmethod
    def is_oauth_configured() -> bool:
        return YOUTUBE_CLIENT_SECRETS_FILE.exists()
