"""Pydantic request and response schemas, validation models, and timestamp integrity validators for the Karaoke Studio API."""

import math
import re
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_serializer,
    model_validator,
)

from backend.services.downloader import TrackDownloader
from backend.services.separation_presets import PRESET_IDS, normalize_preset


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    password: str = Field(..., description="Studio password")
    username: str | None = Field(default="Friend", max_length=64)


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    query: str = Field(..., max_length=300, description="Search query")
    limit: int | None = Field(default=5, ge=1, le=50, description="Max results to return")


def parse_separation_quality(value: Any, optional: bool = False) -> str | None:
    """A preset id from user input such as " Best ", or a ValueError listing the choices."""
    if value is None or (isinstance(value, str) and not value.strip()):
        if optional:
            return None
        raise ValueError("Choose a separation quality: " + ", ".join(PRESET_IDS))
    preset = normalize_preset(value)
    if preset is None:
        raise ValueError("Separation quality must be one of: " + ", ".join(PRESET_IDS))
    return preset


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
    separation_quality: str | None = Field(
        default=None,
        description="Stem separation preset: 'fast', 'balanced' or 'best' (server default if unset)",
    )

    @field_validator("separation_quality", mode="before")
    @classmethod
    def validate_separation_quality(cls, v: Any) -> str | None:
        return parse_separation_quality(v, optional=True)

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


SINGER_ALIASES: dict[str, str] = {
    "singer1": "singer1",
    "singer 1": "singer1",
    "singer_1": "singer1",
    "lead": "singer1",
    "s1": "singer1",
    "part1": "singer1",
    "part 1": "singer1",
    "singer2": "singer2",
    "singer 2": "singer2",
    "singer_2": "singer2",
    "partner": "singer2",
    "s2": "singer2",
    "part2": "singer2",
    "part 2": "singer2",
    "both": "both",
    "unison": "both",
    "duet": "both",
    "all": "both",
    "together": "both",
}


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
    singer: str = Field(
        default="singer1",
        description="Singer part assignment: 'singer1' (Singer 1 / Lead), 'singer2' (Singer 2 / Partner), or 'both' (Both / Unison)",
    )
    confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        allow_inf_nan=False,
        description="How well the vocal stem supports this line's timing (0-1), when measured",
    )
    align_method: Literal["ctc", "dsp", "lrc", "fallback", "manual"] | None = Field(
        default=None,
        description="How the line was timed (neural, DSP, from the lyrics, fallback, by hand)",
    )

    @model_serializer(mode="wrap")
    def _drop_unset_timing_metadata(self, handler):
        data = handler(self)
        for key in ("confidence", "align_method"):
            if data.get(key) is None:
                data.pop(key, None)
        return data

    @field_validator("singer", mode="before")
    @classmethod
    def validate_singer_role(cls, v: Any) -> str:
        if v is None:
            return "singer1"
        s = str(v).strip().lower()
        if not s:
            return "singer1"
        if s in SINGER_ALIASES:
            return SINGER_ALIASES[s]
        raise ValueError(
            f"Invalid singer role '{v}'. Expected 'singer1' (lead), 'singer2' (partner), or 'both' (unison)."
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


class ChordSegmentSchema(BaseModel):
    """Timecoded musical chord segment with interval boundary validation."""

    model_config = ConfigDict(extra="ignore")

    id: str | None = Field(
        default=None,
        description="Optional unique identifier for the chord cue (e.g. 'c1', 'chord-0')",
    )
    start: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Chord segment start time in seconds (non-negative finite float)",
    )
    end: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Chord segment end time in seconds (strictly greater than start)",
    )
    chord: str = Field(
        ...,
        min_length=1,
        max_length=32,
        description="Chord symbol: root + quality (e.g. 'C', 'Am', 'G7', 'Cmaj7', 'Dm7', 'N', 'C/G')",
    )
    confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        allow_inf_nan=False,
        description="Optional detection confidence score between 0.0 and 1.0",
    )

    @field_validator("chord")
    @classmethod
    def validate_chord_symbol(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Chord symbol cannot be empty or whitespace")
        return v.strip()

    @model_validator(mode="after")
    def validate_segment_bounds(self) -> "ChordSegmentSchema":
        if not math.isfinite(self.start) or not math.isfinite(self.end):
            raise ValueError("Chord timestamps must be finite numbers")
        if self.start >= self.end:
            raise ValueError(
                f"Invalid chord interval: start ({self.start}s) must be strictly less than end ({self.end}s)"
            )
        return self


class ChordsUpdateRequest(BaseModel):
    """Request payload for updating project chord progression segments."""

    model_config = ConfigDict(extra="ignore")

    chords: list[ChordSegmentSchema] = Field(
        default_factory=list,
        description="List of timecoded chord segments to persist",
    )

    @field_validator("chords")
    @classmethod
    def validate_monotonicity_and_intervals(
        cls, chords: list[ChordSegmentSchema]
    ) -> list[ChordSegmentSchema]:
        """Enforces strict monotonicity (start < end) and non-overlapping intervals (end_i <= start_{i+1})."""
        for i in range(len(chords) - 1):
            curr = chords[i]
            nxt = chords[i + 1]
            if nxt.start < curr.end:
                raise ValueError(
                    f"Overlapping or non-monotonic chord intervals at indices {i} and {i + 1}: "
                    f"chord '{curr.chord}' ends at {curr.end}s, but next chord '{nxt.chord}' starts at {nxt.start}s "
                    f"(requires end_{i} <= start_{i + 1})"
                )
        return chords


class ProjectChordsResponse(BaseModel):
    """Result payload for project chord queries."""

    model_config = ConfigDict(extra="ignore")

    project_id: str = Field(..., description="Unique project identifier")
    chords: list[ChordSegmentSchema] = Field(
        default_factory=list,
        description="Timecoded harmonic chord segments",
    )
    estimated_key: str | None = Field(
        default=None,
        description="Estimated musical key of the track",
    )
    detected: bool = Field(
        default=True,
        description="Whether chords were successfully detected or populated",
    )


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
    include_visualizer: bool = Field(
        default=False,
        description="Composite beat-reactive audio visualizer into MP4",
    )
    include_countdown: bool = Field(
        default=True,
        description="Include instrumental gap countdown cues in subtitles",
    )
    include_chords: bool = Field(
        default=False,
        description="Include transposed chord progression cues in subtitles/video overlay",
    )
    sync_mode: Literal["word", "line"] = Field(
        default="word",
        description="Lyric synchronization display mode: 'word' (progressive \\kf sweep) or 'line' (instant solid line highlight)",
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
    lines: list[LyricLineSchema] | None = Field(
        default=None,
        max_length=5000,
        description="Re-time these lines (the studio's current lyrics) instead of new lyrics",
    )
    background: bool = Field(
        default=False,
        description="Queue the alignment as a background job (202) that may use the neural aligner",
    )


class RealignLineRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    line: LyricLineSchema = Field(..., description="The line as it is now in the studio")
    prev_end: float | None = Field(
        default=None,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="End of the line before it: the line will not move earlier than this",
    )
    next_start: float | None = Field(
        default=None,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Start of the line after it: the line will not move later than this",
    )
    engine: Literal["auto", "ctc", "dsp"] | None = Field(
        default=None,
        description="Aligner to try (server setting if unset; 'dsp' for the fast one only)",
    )
    search_window: float = Field(
        default=1.5,
        gt=0.0,
        le=3.0,
        allow_inf_nan=False,
        description="How far (seconds) to look either side of the line's current timing",
    )

    @model_validator(mode="after")
    def validate_neighbours(self) -> "RealignLineRequest":
        if (
            self.prev_end is not None
            and self.next_start is not None
            and self.next_start < self.prev_end
        ):
            raise ValueError("next_start cannot be earlier than prev_end")
        return self


class ReseparateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    quality: str = Field(..., description="Stem separation preset: 'fast', 'balanced' or 'best'")
    realign_lyrics: bool = Field(
        default=False, description="Re-time the words against the new vocal stem afterwards"
    )
    redetect_chords: bool = Field(
        default=False, description="Replace the chords with a fresh detection afterwards"
    )

    @field_validator("quality", mode="before")
    @classmethod
    def validate_quality(cls, v: Any) -> str:
        return parse_separation_quality(v)


# ==============================================================================
# Vocal Range & Smart Key Recommendation Schemas
# ==============================================================================

VOICE_PRESETS: set[str] = {
    "Bass",
    "Baritone",
    "Tenor",
    "Alto",
    "Mezzo-Soprano",
    "Soprano",
}

VOICE_PRESET_ALIASES: dict[str, str] = {
    "bass": "Bass",
    "baritone": "Baritone",
    "tenor": "Tenor",
    "alto": "Alto",
    "mezzo-soprano": "Mezzo-Soprano",
    "mezzosoprano": "Mezzo-Soprano",
    "mezzo_soprano": "Mezzo-Soprano",
    "mezzo": "Mezzo-Soprano",
    "soprano": "Soprano",
}

SPN_NOTE_REGEX = re.compile(r"^[A-Ga-g][#b]?[0-9]$")


class VocalRangeData(BaseModel):
    """Acoustic vocal range and key estimation metadata for an isolated vocal track."""

    model_config = ConfigDict(extra="ignore")

    is_voiced: bool = Field(
        default=False,
        description="Whether voiced singing frames were detected in the vocal track",
    )
    lowest_note: str | None = Field(
        default=None,
        description="Lowest sung note in Scientific Pitch Notation (e.g. 'C#3')",
    )
    highest_note: str | None = Field(
        default=None,
        description="Highest sung note in Scientific Pitch Notation (e.g. 'E4')",
    )
    lowest_hz: float | None = Field(
        default=None,
        description="Fundamental frequency of lowest sung note in Hertz",
    )
    highest_hz: float | None = Field(
        default=None,
        description="Fundamental frequency of highest sung note in Hertz",
    )
    tessitura_low_note: str | None = Field(
        default=None,
        description="Comfortable tessitura lower bound note (15th percentile)",
    )
    tessitura_high_note: str | None = Field(
        default=None,
        description="Comfortable tessitura upper bound note (85th percentile)",
    )
    tessitura_low_hz: float | None = Field(
        default=None,
        description="Comfortable tessitura lower bound frequency in Hertz",
    )
    tessitura_high_hz: float | None = Field(
        default=None,
        description="Comfortable tessitura upper bound frequency in Hertz",
    )
    median_note: str | None = Field(
        default=None,
        description="Median sung note (50th percentile)",
    )
    median_hz: float | None = Field(
        default=None,
        description="Median fundamental frequency in Hertz",
    )
    estimated_key: str = Field(
        default="Unknown",
        description="Estimated musical key (e.g. 'G Major', 'C# Minor', or 'Unknown')",
    )
    key_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Confidence score of key estimation between 0.0 and 1.0",
    )
    voiced_frames_count: int = Field(
        default=0,
        ge=0,
        description="Total count of voiced audio frames detected",
    )
    total_frames_count: int = Field(
        default=0,
        ge=0,
        description="Total count of audio frames evaluated",
    )


class KeyRecommendationRequest(BaseModel):
    """Request payload for smart key recommendation."""

    model_config = ConfigDict(extra="ignore")

    target_voice_preset: str | None = Field(
        default=None,
        description="Target voice type preset ('Bass', 'Baritone', 'Tenor', 'Alto', 'Mezzo-Soprano', 'Soprano')",
    )
    custom_low_note: str | None = Field(
        default=None,
        description="Optional custom lowest note in Scientific Pitch Notation (e.g. 'C3', 'F#2')",
    )
    custom_high_note: str | None = Field(
        default=None,
        description="Optional custom highest note in Scientific Pitch Notation (e.g. 'C5', 'A4')",
    )

    @field_validator("target_voice_preset")
    @classmethod
    def validate_preset(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            return None
        canonical = VOICE_PRESET_ALIASES.get(stripped.lower()) or stripped
        if canonical not in VOICE_PRESETS:
            raise ValueError(
                f"Invalid voice preset '{v}'. Must be one of: {', '.join(sorted(VOICE_PRESETS))}"
            )
        return canonical

    @field_validator("custom_low_note", "custom_high_note")
    @classmethod
    def validate_spn_note(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            return None
        if not SPN_NOTE_REGEX.match(stripped):
            raise ValueError(
                f"Invalid scientific pitch notation '{v}'. Expected format like 'C3', 'F#4', 'Bb2'."
            )
        return stripped[0].upper() + stripped[1:]

    @model_validator(mode="after")
    def validate_target_range(self) -> "KeyRecommendationRequest":
        has_preset = bool(self.target_voice_preset)
        has_custom_low = bool(self.custom_low_note)
        has_custom_high = bool(self.custom_high_note)

        if not has_preset and not (has_custom_low and has_custom_high):
            raise ValueError(
                "Must provide either 'target_voice_preset' or both 'custom_low_note' and 'custom_high_note'"
            )
        return self


class KeyRecommendationResponse(BaseModel):
    """Result payload from the smart key recommendation optimizer."""

    model_config = ConfigDict(extra="ignore")

    recommended_semitones: int = Field(
        ...,
        ge=-12,
        le=12,
        description="Recommended pitch shift in semitones (-12 to +12)",
    )
    projected_key: str = Field(
        ...,
        description="Projected musical key after semitone transposition",
    )
    projected_low_note: str | None = Field(
        default=None,
        description="Projected lowest note in SPN after transposition",
    )
    projected_high_note: str | None = Field(
        default=None,
        description="Projected highest note in SPN after transposition",
    )
    cost: float = Field(
        default=0.0,
        description="Optimization cost penalty score (lower is better, 0 is ideal fit)",
    )
    is_in_range: bool = Field(
        default=True,
        description="True if transposed vocal range fits within target singer bounds",
    )
    target_preset: str | None = Field(
        default=None,
        description="Echoed voice preset used for recommendation, if applicable",
    )
    original_key: str | None = Field(
        default=None,
        description="Original detected musical key of the vocal track",
    )


class KaraokeProject(BaseModel):
    """Fully typed project model with backward compatibility for existing projects."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(..., description="Unique project identifier")
    track_id: str | None = Field(default=None, description="Audio/video track identifier")
    status: str = Field(
        default="queued",
        description="Lifecycle status: 'queued', 'downloading', 'separating', 'fetching_lyrics', 'aligning', 'mixing', 'ready', 'error', 'cancelled'",
    )
    progress: int = Field(default=0, ge=0, le=100, description="Pipeline progress percentage")
    status_detail: str | None = Field(default=None, description="Human-readable status description")
    title: str | None = Field(default=None, description="Track title")
    artist: str | None = Field(default=None, description="Artist name")
    duration: float | None = Field(default=None, description="Track duration in seconds")
    semitones: int = Field(default=0, ge=-12, le=12, description="Pitch shift in semitones")
    guide_volume: float = Field(default=0.0, ge=0.0, le=1.0, description="Guide vocal blend level")
    audio_path: str | None = Field(default=None, description="Local path to source WAV audio")
    audio_url: str | None = Field(default=None, description="Static URL to source audio")
    thumbnail_path: str | None = Field(default=None, description="Local path to thumbnail image")
    thumbnail_url: str | None = Field(default=None, description="Static URL to thumbnail image")
    vocals_path: str | None = Field(default=None, description="Local path to isolated vocals stem")
    instrumental_path: str | None = Field(
        default=None, description="Local path to isolated instrumental stem"
    )
    vocals_url: str | None = Field(default=None, description="Static URL to vocals stem")
    instrumental_url: str | None = Field(
        default=None, description="Static URL to instrumental stem"
    )
    master_audio_path: str | None = Field(
        default=None, description="Local path to mixed master audio"
    )
    master_audio_url: str | None = Field(
        default=None, description="Static URL to mixed master audio"
    )
    lines: list[LyricLineSchema] = Field(default_factory=list, description="Timed lyric lines")
    lyric_source: str | None = Field(
        default=None, description="Source of lyrics ('lrclib', 'custom', etc.)"
    )
    is_synced: bool = Field(default=True, description="Whether lyrics are time-synchronized")
    created_by: str | None = Field(default="Friend", description="Creator username")
    created_at: int | None = Field(default=None, description="Creation epoch timestamp in seconds")
    vocal_range: VocalRangeData | None = Field(
        default=None,
        description="Acoustic vocal range and key estimation metadata",
    )
    chords: list[ChordSegmentSchema] | None = Field(
        default=None,
        description="Timecoded harmonic chord segments",
    )
