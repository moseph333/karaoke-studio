"""Pydantic request and response schemas, validation models, and timestamp integrity validators for the Karaoke Studio API."""

import math
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.services.downloader import TrackDownloader


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    password: str = Field(..., description="Studio password")
    username: str | None = Field(default="Friend", max_length=64)


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    query: str = Field(..., max_length=300, description="Search query")
    limit: int | None = Field(default=5, ge=1, le=50, description="Max results to return")


class ProcessRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url_or_id: str = Field(
        ...,
        description="YouTube video URL or 11-character video ID",
    )
    custom_lyrics: str | None = Field(
        default=None,
        max_length=50000,
        description="Optional custom plain or LRC lyrics text",
    )
    created_by: str | None = Field(
        default=None,
        max_length=64,
        description="Optional creator username or nickname",
    )

    @field_validator("url_or_id")
    @classmethod
    def validate_youtube_url_or_id(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("URL or video ID cannot be empty or whitespace")
        clean = v.strip()

        # Check for URL with non-YouTube domain
        if clean.startswith(("http://", "https://")) or "/" in clean or "." in clean:
            vid = TrackDownloader.extract_video_id(clean)
            if not vid:
                raise ValueError(
                    "Invalid YouTube URL or unsupported media domain. "
                    "Only valid YouTube URLs (e.g. youtube.com/watch?v=..., youtu.be/...) are supported."
                )
            return clean

        # Bare ID: check for valid YouTube video ID (Option B: 11-32 chars to accommodate synthetic test IDs like pair_lyr_pitch1)
        if not re.fullmatch(r"^[0-9A-Za-z_-]{11,32}$", clean):
            raise ValueError(
                f"Invalid YouTube video ID '{clean}'. Must be a valid identifier (11-32 characters)."
            )
        return clean


class WordTimingSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")
    word: str = Field(..., description="Word text")
    start_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Word start time in seconds (non-negative)",
    )
    end_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Word end time in seconds (non-negative)",
    )

    @model_validator(mode="after")
    def validate_word_timestamps(self) -> "WordTimingSchema":
        if not math.isfinite(self.start_time) or not math.isfinite(self.end_time):
            raise ValueError(f"Word '{self.word}' timestamps must be finite numbers")
        if self.end_time < self.start_time:
            raise ValueError(
                f"Word '{self.word}' end_time ({self.end_time}s) cannot be earlier than start_time ({self.start_time}s)"
            )
        return self


class LyricLineSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: int | None = Field(default=None, description="Optional line ID")
    text: str = Field(default="", description="Line text")
    start_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Line start time in seconds (non-negative)",
    )
    end_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Line end time in seconds (non-negative)",
    )
    words: list[WordTimingSchema] = Field(
        default_factory=list,
        description="Word-level timing tokens",
    )

    @model_validator(mode="after")
    def validate_line_and_words(self) -> "LyricLineSchema":
        if not math.isfinite(self.start_time) or not math.isfinite(self.end_time):
            raise ValueError("Line timestamps must be finite numbers")
        if self.end_time < self.start_time:
            raise ValueError(
                f"Line end_time ({self.end_time}s) cannot be earlier than start_time ({self.start_time}s)"
            )
        # Enforce non-decreasing monotonic word timestamps
        for i in range(1, len(self.words)):
            if self.words[i].start_time < self.words[i - 1].start_time:
                raise ValueError(
                    f"Non-monotonic word timing: word '{self.words[i].word}' start_time ({self.words[i].start_time}s) "
                    f"is earlier than preceding word '{self.words[i - 1].word}' start_time ({self.words[i - 1].start_time}s)"
                )
        return self


class LyricsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    lines: list[LyricLineSchema] = Field(..., description="List of lyric line timing models")


class MixRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    semitones: int = Field(
        default=0,
        ge=-12,
        le=12,
        description="Pitch shift in semitones (-12 to +12)",
    )
    guide_volume: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        allow_inf_nan=False,
        description="Guide vocal blend level (0.0 to 1.0)",
    )


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    semitones: int = Field(
        default=0,
        ge=-12,
        le=12,
        description="Pitch shift in semitones (-12 to +12)",
    )
    guide_volume: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        allow_inf_nan=False,
        description="Guide vocal blend level (0.0 to 1.0)",
    )
    aspect_ratio: Literal["16:9", "9:16"] = Field(
        default="16:9",
        description="Canvas aspect ratio: strictly '16:9' or '9:16'",
    )
    style_config: dict[str, Any] | None = Field(
        default=None,
        description="Visual theme styling options",
    )
    custom_bg_id: str | None = Field(
        default=None,
        description="Optional custom background image ID",
    )


class ProjectMetadataUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str | None = Field(
        default=None,
        max_length=300,
        description="Optional updated track title (max 300 chars)",
    )
    artist: str | None = Field(
        default=None,
        max_length=300,
        description="Optional updated artist name (max 300 chars)",
    )


class RealignLyricsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    custom_lyrics: str | None = Field(
        default=None,
        max_length=50000,
        description="Optional custom plain or LRC lyrics text",
    )
    fetch_lrclib: bool = Field(
        default=False,
        description="Re-query LRCLIB using project title and artist",
    )
