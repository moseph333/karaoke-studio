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

from backend.services.media_links import UnusableLink, parse_media_link, supported_sites_sentence
from backend.services.separation_presets import normalize_preset, offered_presets
from backend.services.vocal_mix import normalize_levels
from backend.shared_assets import load


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    password: str = Field(..., description="Studio password")
    username: str | None = Field(default="Friend", max_length=64)


class AdminLoginRequest(BaseModel):
    password: str = Field(..., max_length=256, description="The server's admin passphrase")


class AdminSettingsUpdate(BaseModel):
    values: dict[str, Any] = Field(
        ...,
        max_length=64,
        description="Changes by setting id: the value to save, or null to forget the saved one",
    )


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    query: str = Field(..., max_length=300, description="Search query")
    limit: int | None = Field(default=5, ge=1, le=50, description="Max results to return")


class SongSearchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    query: str = Field(
        ...,
        max_length=200,
        description="A song title, an artist, or both; misspellings are tolerated",
    )
    limit: int | None = Field(default=8, ge=1, le=25, description="Max songs to return")


def parse_separation_quality(value: Any, optional: bool = False) -> str | None:
    """A preset id from user input such as " Best ", or a ValueError listing the choices:
    the presets this server offers (SEPARATION_PRESETS)."""
    offered = offered_presets()
    if value is None or (isinstance(value, str) and not value.strip()):
        if optional:
            return None
        raise ValueError("Choose a separation quality: " + ", ".join(offered))
    preset = normalize_preset(value)
    if preset is None:
        raise ValueError("Separation quality must be one of: " + ", ".join(offered))
    if preset not in offered:
        raise ValueError(
            f"This server does not offer {preset.capitalize()} stems. "
            "Choose one of: " + ", ".join(offered)
        )
    return preset


class AlbumSongPick(BaseModel):
    model_config = ConfigDict(extra="ignore")
    number: int = Field(..., ge=1, le=999, description="The song's number on the album")
    title: str | None = Field(
        default=None,
        max_length=300,
        description="The song's name, when the one found is wrong or a stand-in (Track 3)",
    )


class AlbumSongsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    songs: list[AlbumSongPick] = Field(
        ..., min_length=1, max_length=99, description="The songs of the album to make"
    )
    artist: str | None = Field(
        default=None, max_length=300, description="The album's artist, when the one found is wrong"
    )
    created_by: str | None = Field(default=None, max_length=64)
    separation_quality: str | None = Field(
        default=None,
        description="Stem separation preset for the songs (the album's, else the server default)",
    )

    @field_validator("separation_quality", mode="before")
    @classmethod
    def validate_separation_quality(cls, v: Any) -> str | None:
        return parse_separation_quality(v, optional=True)


class AlbumWholeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    separation_quality: str | None = Field(default=None)

    @field_validator("separation_quality", mode="before")
    @classmethod
    def validate_separation_quality(cls, v: Any) -> str | None:
        return parse_separation_quality(v, optional=True)


class ProcessRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url_or_id: str = Field(
        ...,
        description=(
            "A song link (YouTube, SoundCloud, Bandcamp, Vimeo, Internet Archive, or Spotify, "
            "Apple Music, TIDAL or Deezer, matched to YouTube) or an 11-character YouTube video ID"
        ),
    )
    custom_lyrics: str | None = Field(
        default=None,
        max_length=50000,
        description="Optional custom plain or LRC lyrics text",
    )
    retry: bool = Field(
        default=False,
        description=(
            "Start a failed or cancelled song again as it was first asked for: the lyrics "
            "pasted for it then are used, unless custom_lyrics brings others"
        ),
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
    def validate_url_or_id(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("URL or video ID cannot be empty or whitespace")
        clean = v.strip()

        # A link: one song on a supported site
        if clean.startswith(("http://", "https://")) or "/" in clean or "." in clean:
            try:
                link = parse_media_link(clean)
            except UnusableLink as e:
                raise ValueError(str(e)) from e
            if link is None:
                raise ValueError(
                    f"Unsupported link. Paste a song link from {supported_sites_sentence()}. "
                    "For another site, download the audio and add it as a local file."
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


# The longest name a singer part may be given (the stage shows it in a badge)
PART_NAME_MAX = 40

# Every singer label a line may carry, mapped to its part (shared with the studio's stage)
SINGER_ALIASES: dict[str, str] = load("singer_aliases")


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
    romaji: str | None = Field(
        default=None,
        max_length=1000,
        description="The romanization of a CJK line, shown under it and used to time it",
    )
    added: Literal["repeat"] | None = Field(
        default=None,
        description="'repeat' for a line the server added: a repeat the lyric file left out",
    )

    @model_serializer(mode="wrap")
    def _drop_unset_timing_metadata(self, handler):
        data = handler(self)
        for key in ("confidence", "align_method", "added", "romaji"):
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


def _part_level(description: str) -> Any:
    return Field(default=None, ge=0.0, le=1.0, allow_inf_nan=False, description=description)


class VocalLevels(BaseModel):
    """Which of a song's vocals stay in the mix (see backend.services.vocal_mix). A level
    that is not set takes the guide vocal's."""

    model_config = ConfigDict(extra="ignore")
    backing: float | None = _part_level(
        "Level of the backing vocals, once the vocals are split into lead and backing"
    )
    by: Literal["lines", "voices"] | None = Field(
        default=None,
        description=(
            "'lines': the lead takes each singer's level during that singer's lines; "
            "'voices': the lead is its male and female voice, each at its level"
        ),
    )
    singer1: float | None = _part_level("Level of the lead during Singer 1's lines")
    singer2: float | None = _part_level("Level of the lead during Singer 2's lines")
    both: float | None = _part_level("Level of the lead during lines sung together")
    male: float | None = _part_level("Level of the male voice, once the voices are split")
    female: float | None = _part_level("Level of the female voice, once the voices are split")

    def stored(self) -> dict[str, Any]:
        """What a song keeps: only what was set, rounded as the mix names it."""
        return normalize_levels(self.model_dump(exclude_none=True))


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
    vocal_levels: VocalLevels | None = Field(
        default=None,
        description="Which vocal parts stay in the mix, and each singer's level",
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
    vocal_levels: VocalLevels | None = Field(
        default=None,
        description="Which vocal parts stay in the mix, and each singer's level",
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
    part_names: dict[Literal["singer1", "singer2", "both"], str] | None = Field(
        default=None,
        description="Names for the singer parts shown on the stage (e.g. {'singer2': 'Miho'}); "
        "an empty name goes back to the default label",
    )

    @field_validator("part_names")
    @classmethod
    def _clean_part_names(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        if v is None:
            return None
        cleaned = {role: " ".join(str(name).split()) for role, name in v.items()}
        if any(len(name) > PART_NAME_MAX for name in cleaned.values()):
            raise ValueError(f"A part name can be at most {PART_NAME_MAX} characters")
        return cleaned


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
    keep_manual: bool = Field(
        default=False,
        description="Keep the word timing of lines timed by hand (align_method 'manual')",
    )
    lyric_source_id: int | str | None = Field(
        default=None,
        description="The LRCLIB listing that custom_lyrics were taken from, if any",
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
    keep_manual: bool = Field(
        default=False,
        description="When re-timing, keep the word timing of lines timed by hand",
    )

    @field_validator("quality", mode="before")
    @classmethod
    def validate_quality(cls, v: Any) -> str:
        return parse_separation_quality(v)


class VocalSplitRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kind: Literal["lead_backing", "male_female"] = Field(
        default="lead_backing",
        description="Which split of the vocal stem to make: 'lead_backing' or 'male_female'",
    )


class SongLoopRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    prompt: str | None = Field(
        default=None,
        max_length=600,
        description="What the loop shows, in words; leave out to have it written from the lyrics",
    )
    model: str | None = Field(
        default=None,
        max_length=20,
        description="The video model, one of those GET /api/capabilities offers under "
        "song_loop.models; leave out for the server's default",
    )

    @field_validator("prompt", mode="before")
    @classmethod
    def tidy_prompt(cls, v: Any) -> Any:
        """One line of text; an empty one means none was typed."""
        if isinstance(v, str):
            return " ".join(v.split()) or None
        return v

    @field_validator("model", mode="before")
    @classmethod
    def tidy_model(cls, v: Any) -> Any:
        if isinstance(v, str):
            return v.strip().lower() or None
        return v


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
    track_id: str | None = Field(
        default=None,
        description=(
            "Audio track identifier: a YouTube video ID, or '<site>-<id>' for a link from "
            "another site; uploads have none"
        ),
    )
    url: str | None = Field(
        default=None,
        description="The link the song was made from (a Spotify, Apple Music, TIDAL or Deezer link "
        "for a matched song); uploads have none",
    )
    song_match: dict | None = Field(
        default=None,
        description=(
            "For a Spotify, Apple Music, TIDAL or Deezer link: the song read from the service (site, "
            "title, artist, duration) and the YouTube upload it was matched to (youtube_id, "
            "youtube_title, youtube_url)"
        ),
    )
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
    lyric_source_id: int | str | None = Field(
        default=None, description="The LRCLIB listing the lyrics came from, when known"
    )
    part_names: dict[str, str] | None = Field(
        default=None, description="Names given to the singer parts, shown on the stage"
    )
    voice_parts: dict[str, Any] | None = Field(
        default=None,
        description="Whether two voices were told apart on the vocal stem when the song was "
        "processed, how clearly, and how many lines went to Singer 2",
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
