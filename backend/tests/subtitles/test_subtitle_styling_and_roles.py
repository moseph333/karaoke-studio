"""Adversarial stress-testing suite for Milestone 2: Backend & Subtitle Styling.

Covers:
1. Backend schema validation under adversarial singer aliases and invalid roles.
2. Acoustic alignment preservation across realignment cycles and audio edge cases.
3. ASS subtitle generation: style alternation, progressive \\kf timing integrity, and escaping.
4. VideoRenderer FFmpeg composite: burning multi-singer subtitles cleanly into MP4.
"""

import math
import re
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from pydantic import ValidationError

from backend.schemas import (
    KaraokeProject,
    LyricLineSchema,
    LyricsUpdateRequest,
    WordTimingSchema,
)
from backend.services.aligner import AudioAligner
from backend.services.ass_draw import LookStyle
from backend.services.ass_generator import (
    escape_ass_text,
    format_ass_time,
    generate_ass_content,
    generate_ass_subtitles,
)
from backend.services.ass_look import look_faces
from backend.services.video_renderer import VideoRenderer
from backend.tests.helpers.ass_script import AssEvent, ass_events, parse_ass

# The look whose lines take two rows in turn, and which writes a line as it is written
ROWS_LOOK = "ktv"
# Which row of the two a line takes, by the corner its event is anchored at
ROW_OF_ALIGNMENT = {"\\an7": 0, "\\an9": 1}


def lyric_rows(ass: str) -> list[AssEvent]:
    """The events of the lines being sung (role ``lyric:<line>``), one per row of a line."""
    return [e for e in ass_events(ass) if e.kind == "lyric"]


def row_of(event: AssEvent) -> int:
    """0 for the upper left row of the two-row look, 1 for the lower right."""
    (row,) = [row for tag, row in ROW_OF_ALIGNMENT.items() if tag in event.tags]
    return row


class TestSingerSchemaAdversarial:
    """Stress tests backend schema validation with adversarial singer inputs."""

    @pytest.mark.parametrize(
        "alias,expected",
        [
            # Singer 1 aliases
            ("singer1", "singer1"),
            ("SINGER1", "singer1"),
            ("singer 1", "singer1"),
            ("Singer 1", "singer1"),
            ("SINGER 1", "singer1"),
            ("  singer 1  ", "singer1"),
            ("singer_1", "singer1"),
            ("SINGER_1", "singer1"),
            ("lead", "singer1"),
            ("LEAD", "singer1"),
            ("Lead", "singer1"),
            ("  LEAD  ", "singer1"),
            ("s1", "singer1"),
            ("S1", "singer1"),
            ("  s1  ", "singer1"),
            ("part1", "singer1"),
            ("PART1", "singer1"),
            ("part 1", "singer1"),
            ("Part 1", "singer1"),
            ("PART 1", "singer1"),
            # Singer 2 aliases
            ("singer2", "singer2"),
            ("SINGER2", "singer2"),
            ("singer 2", "singer2"),
            ("Singer 2", "singer2"),
            ("SINGER 2", "singer2"),
            ("  singer 2  ", "singer2"),
            ("singer_2", "singer2"),
            ("partner", "singer2"),
            ("PARTNER", "singer2"),
            ("Partner", "singer2"),
            ("  partner  ", "singer2"),
            ("s2", "singer2"),
            ("S2", "singer2"),
            ("  s2  ", "singer2"),
            ("part2", "singer2"),
            ("PART2", "singer2"),
            ("part 2", "singer2"),
            ("Part 2", "singer2"),
            ("PART 2", "singer2"),
            # Both / Unison aliases
            ("both", "both"),
            ("BOTH", "both"),
            ("Both", "both"),
            ("  both  ", "both"),
            ("unison", "both"),
            ("UNISON", "both"),
            ("Unison", "both"),
            ("  unison  ", "both"),
            ("duet", "both"),
            ("DUET", "both"),
            ("Duet", "both"),
            ("  Duet  ", "both"),
            ("all", "both"),
            ("ALL", "both"),
            ("All", "both"),
            ("together", "both"),
            ("TOGETHER", "both"),
            ("Together", "both"),
            ("  together  ", "both"),
            # Defaults and empty fallbacks
            (None, "singer1"),
            ("", "singer1"),
            ("   ", "singer1"),
            ("\t\n  ", "singer1"),
        ],
    )
    def test_singer_alias_normalization(self, alias, expected):
        """All valid singer alias variants normalize to canonical singer1, singer2, or both."""
        line = LyricLineSchema(text="Test", start_time=0.0, end_time=1.0, singer=alias)
        assert line.singer == expected

    @pytest.mark.parametrize(
        "invalid_role",
        [
            "singer3",
            "alien",
            "chorus",
            "trio",
            "backup",
            "random_string",
            "12345",
            "!@#$%",
            "solo",
            "ensemble",
            "vocalist",
            123,
            True,
            False,
        ],
    )
    def test_invalid_singer_role_rejection(self, invalid_role):
        """Unknown or invalid singer roles must raise ValidationError."""
        with pytest.raises(ValidationError):
            LyricLineSchema(text="Test", start_time=0.0, end_time=1.0, singer=invalid_role)

    def test_lyrics_update_request_adversarial_roundtrip(self):
        """LyricsUpdateRequest validates and serializes mixed alias variants."""
        payload = {
            "lines": [
                {"text": "Line 1", "start_time": 0.0, "end_time": 2.0, "singer": "  LEAD  "},
                {"text": "Line 2", "start_time": 2.0, "end_time": 4.0, "singer": "PARTNER"},
                {"text": "Line 3", "start_time": 4.0, "end_time": 6.0, "singer": "Duet"},
                {"text": "Line 4", "start_time": 6.0, "end_time": 8.0, "singer": None},
                {"text": "Line 5", "start_time": 8.0, "end_time": 10.0, "singer": ""},
            ]
        }
        req = LyricsUpdateRequest(**payload)
        assert req.lines[0].singer == "singer1"
        assert req.lines[1].singer == "singer2"
        assert req.lines[2].singer == "both"
        assert req.lines[3].singer == "singer1"
        assert req.lines[4].singer == "singer1"

        dumped = req.model_dump()
        assert dumped["lines"][0]["singer"] == "singer1"
        assert dumped["lines"][1]["singer"] == "singer2"
        assert dumped["lines"][2]["singer"] == "both"

    def test_karaoke_project_schema_backward_compatibility(self):
        """KaraokeProject loads legacy projects lacking singer fields and defaults to singer1."""
        legacy_data = {
            "id": "legacy_project_123",
            "lines": [
                {
                    "text": "Legacy line without singer",
                    "start_time": 1.0,
                    "end_time": 3.0,
                    "words": [{"word": "Legacy", "start_time": 1.0, "end_time": 2.0}],
                }
            ],
        }
        proj = KaraokeProject(**legacy_data)
        assert proj.lines[0].singer == "singer1"


class TestAlignerSingerPreservation:
    """Stress tests AudioAligner preservation of singer assignments across acoustic cycles."""

    @pytest.fixture
    def synthetic_vocal_wav(self, tmp_path):
        """Creates a 3-second synthetic vocal audio WAV with simulated active bursts."""
        wav_path = tmp_path / "synthetic_vocals.wav"
        sr = 44100
        duration = 3.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        # Create audio with voiced energy bursts
        audio = 0.5 * np.sin(2 * np.pi * 440 * t)
        # Zero out the first 0.5s to simulate intro gap
        audio[: int(sr * 0.5)] = 0.0
        sf.write(str(wav_path), audio.astype(np.float32), sr)
        return str(wav_path)

    @pytest.fixture
    def silent_vocal_wav(self, tmp_path):
        """Creates a 2-second pure silence WAV."""
        wav_path = tmp_path / "silent_vocals.wav"
        sr = 44100
        audio = np.zeros(int(sr * 2.0), dtype=np.float32)
        sf.write(str(wav_path), audio, sr)
        return str(wav_path)

    @pytest.fixture
    def stereo_vocal_wav(self, tmp_path):
        """Creates a 2-second 2-channel stereo WAV."""
        wav_path = tmp_path / "stereo_vocals.wav"
        sr = 44100
        t = np.linspace(0, 2.0, int(sr * 2.0), endpoint=False)
        ch1 = 0.3 * np.sin(2 * np.pi * 330 * t)
        ch2 = 0.3 * np.cos(2 * np.pi * 330 * t)
        stereo = np.column_stack([ch1, ch2]).astype(np.float32)
        sf.write(str(wav_path), stereo, sr)
        return str(wav_path)

    def test_aligner_preserves_singer_in_standard_alignment(self, synthetic_vocal_wav):
        """Aligner preserves singer1, singer2, both across standard realignment."""
        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "First line by lead",
                "start_time": 0.5,
                "end_time": 1.5,
                "singer": "singer1",
            },
            {
                "id": 1,
                "text": "Second line by partner",
                "start_time": 1.6,
                "end_time": 2.5,
                "singer": "singer2",
            },
            {
                "id": 2,
                "text": "Third line by both",
                "start_time": 2.6,
                "end_time": 2.9,
                "singer": "both",
            },
        ]
        result = aligner.align_lyrics(synthetic_vocal_wav, input_lines)
        assert len(result) == 3
        assert result[0]["singer"] == "singer1"
        assert result[1]["singer"] == "singer2"
        assert result[2]["singer"] == "both"
        assert len(result[0]["words"]) == 4
        assert len(result[1]["words"]) == 4
        assert len(result[2]["words"]) == 4

    def test_aligner_preserves_singer_with_empty_words_and_lines(self, synthetic_vocal_wav):
        """Aligner preserves singer on empty lines, whitespace-only lines, or missing words."""
        aligner = AudioAligner()
        input_lines = [
            {"id": 0, "text": "", "start_time": 0.5, "end_time": 1.0, "singer": "singer2"},
            {"id": 1, "text": "   ", "start_time": 1.0, "end_time": 1.5, "singer": "both"},
            {"id": 2, "text": "Real line", "start_time": 1.5, "end_time": 2.0, "singer": "singer1"},
        ]
        result = aligner.align_lyrics(synthetic_vocal_wav, input_lines)
        assert len(result) == 3
        assert result[0]["singer"] == "singer2"
        assert result[0]["words"] == []
        assert result[1]["singer"] == "both"
        assert result[1]["words"] == []
        assert result[2]["singer"] == "singer1"
        assert len(result[2]["words"]) == 2

    def test_aligner_preserves_singer_in_untimed_plain_text(self, synthetic_vocal_wav):
        """When all lines have start_time=0 and end_time=0 (plain text), singer assignments are preserved."""
        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "Lead intro",
                "start_time": 0.0,
                "end_time": 0.0,
                "singer": "singer1",
            },
            {
                "id": 1,
                "text": "Partner verse",
                "start_time": 0.0,
                "end_time": 0.0,
                "singer": "singer2",
            },
            {"id": 2, "text": "Chorus duet", "start_time": 0.0, "end_time": 0.0, "singer": "both"},
        ]
        result = aligner.align_lyrics(synthetic_vocal_wav, input_lines)
        assert len(result) == 3
        assert result[0]["singer"] == "singer1"
        assert result[1]["singer"] == "singer2"
        assert result[2]["singer"] == "both"
        # Start times should have been distributed
        assert result[0]["start_time"] < result[1]["start_time"] < result[2]["start_time"]

    def test_aligner_preserves_singer_on_pure_silence(self, silent_vocal_wav):
        """Aligner handles pure silence audio without crashing and preserves singer roles."""
        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "Sing in silence",
                "start_time": 0.2,
                "end_time": 1.0,
                "singer": "singer2",
            },
            {"id": 1, "text": "Still silent", "start_time": 1.1, "end_time": 1.8, "singer": "both"},
        ]
        result = aligner.align_lyrics(silent_vocal_wav, input_lines)
        assert len(result) == 2
        assert result[0]["singer"] == "singer2"
        assert result[1]["singer"] == "both"

    def test_aligner_preserves_singer_on_stereo_audio(self, stereo_vocal_wav):
        """Aligner safely downmixes multi-channel audio to mono and preserves singer roles."""
        aligner = AudioAligner()
        input_lines = [
            {"id": 0, "text": "Stereo test", "start_time": 0.2, "end_time": 1.5, "singer": "both"},
        ]
        result = aligner.align_lyrics(stereo_vocal_wav, input_lines)
        assert len(result) == 1
        assert result[0]["singer"] == "both"

    def test_aligner_preserves_singer_on_corrupted_file_fallback(self, tmp_path):
        """Aligner falls back to uniform distribution when audio file is corrupted, preserving singer."""
        corrupted_path = tmp_path / "corrupted.wav"
        corrupted_path.write_bytes(b"THIS_IS_NOT_A_VALID_RIFF_WAV_HEADER_DATA_123456789")

        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "Corrupted fallback line",
                "start_time": 1.0,
                "end_time": 3.0,
                "singer": "singer2",
            },
            {"id": 1, "text": "Second line", "start_time": 4.0, "end_time": 6.0, "singer": "both"},
        ]
        result = aligner.align_lyrics(str(corrupted_path), input_lines)
        assert len(result) == 2
        assert result[0]["singer"] == "singer2"
        assert result[1]["singer"] == "both"
        assert len(result[0]["words"]) == 3
        assert len(result[1]["words"]) == 2

    def test_aligner_preserves_singer_when_file_not_found(self):
        """Aligner falls back cleanly when audio file is missing, preserving singer assignments."""
        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "Missing audio line",
                "start_time": 0.0,
                "end_time": 2.0,
                "singer": "singer1",
            },
            {
                "id": 1,
                "text": "Partner line",
                "start_time": 2.5,
                "end_time": 4.5,
                "singer": "singer2",
            },
        ]
        result = aligner.align_lyrics("/non/existent/path/vocals.wav", input_lines)
        assert len(result) == 2
        assert result[0]["singer"] == "singer1"
        assert result[1]["singer"] == "singer2"

    def test_aligner_defaults_missing_singer_to_singer1(self, synthetic_vocal_wav):
        """Lines lacking a singer key default cleanly to 'singer1'."""
        aligner = AudioAligner()
        input_lines = [
            {"id": 0, "text": "Line with no singer key", "start_time": 0.5, "end_time": 1.5},
        ]
        result = aligner.align_lyrics(synthetic_vocal_wav, input_lines)
        assert result[0]["singer"] == "singer1"


class TestAssSubtitleGenerationStress:
    """Stress tests ASS subtitle generation for style tagging, alternation, and \\kf progressive timing."""

    def test_line_alternation_and_singer_styles(self):
        """Verify strict line alternation (row 1 vs row 2) across all singer roles."""
        lines = [
            {"id": 0, "text": "Line 0", "start_time": 1.0, "end_time": 3.0, "singer": "singer1"},
            {"id": 1, "text": "Line 1", "start_time": 4.0, "end_time": 6.0, "singer": "singer1"},
            {"id": 2, "text": "Line 2", "start_time": 7.0, "end_time": 9.0, "singer": "singer2"},
            {"id": 3, "text": "Line 3", "start_time": 10.0, "end_time": 12.0, "singer": "singer2"},
            {"id": 4, "text": "Line 4", "start_time": 13.0, "end_time": 15.0, "singer": "both"},
            {"id": 5, "text": "Line 5", "start_time": 16.0, "end_time": 18.0, "singer": "both"},
            {"id": 6, "text": "Line 6", "start_time": 19.0, "end_time": 21.0, "singer": "partner"},
            {"id": 7, "text": "Line 7", "start_time": 22.0, "end_time": 24.0, "singer": "duet"},
            {"id": 8, "text": "Line 8", "start_time": 25.0, "end_time": 27.0, "singer": "lead"},
        ]
        ass = generate_ass_content(lines, theme_id=ROWS_LOOK)

        dialogues = lyric_rows(ass)
        assert [d.line for d in dialogues] == list(range(9))
        assert [d.plain for d in dialogues] == [line["text"] for line in lines]

        # Even lines take one row and odd lines the other, each at one place
        assert [row_of(d) for d in dialogues] == [0, 1, 0, 1, 0, 1, 0, 1, 0]
        places = {(row_of(d), tuple(d.numbers("pos"))) for d in dialogues}
        assert len(places) == 2

        # A line is filled in the colour of the part that sings it
        look = LookStyle.of(ROWS_LOOK)
        expected_parts = [
            "singer1",  # 0: singer1
            "singer1",  # 1: singer1
            "singer2",  # 2: singer2
            "singer2",  # 3: singer2
            "both",  # 4: both
            "both",  # 5: both
            "singer2",  # 6: partner (alias for singer2)
            "both",  # 7: duet (alias for both)
            "singer1",  # 8: lead (alias for singer1)
        ]
        for d, part in zip(dialogues, expected_parts, strict=True):
            sung, unsung = look.sweep_colors(part)
            assert d.tags.endswith(f"\\1c{sung}\\2c{unsung}"), d.role
        assert len({look.sweep_colors(part) for part in expected_parts}) == 3

        # The part is named where the singer changes
        assert [e.line for e in ass_events(ass) if e.kind == "part"] == [0, 2, 4, 6, 7, 8]

    def test_progressive_kf_timing_tags_strictly_intact_on_every_word(self):
        """Every word token across all dialogue lines must have a valid non-negative \\kf tag."""
        lines = [
            {
                "id": 0,
                "text": "Every single word must sweep smoothly",
                "start_time": 2.0,
                "end_time": 6.0,
                "singer": "singer1",
                "words": [
                    {"word": "Every", "start_time": 2.0, "end_time": 2.6},
                    {"word": "single", "start_time": 2.6, "end_time": 3.2},
                    {"word": "word", "start_time": 3.2, "end_time": 4.0},
                    {"word": "must", "start_time": 4.0, "end_time": 4.5},
                    {"word": "sweep", "start_time": 4.5, "end_time": 5.2},
                    {"word": "smoothly", "start_time": 5.2, "end_time": 6.0},
                ],
            },
            {
                "id": 1,
                "text": "Partner joins in",
                "start_time": 7.0,
                "end_time": 9.0,
                "singer": "singer2",
                "words": [
                    {"word": "Partner", "start_time": 7.0, "end_time": 7.8},
                    {"word": "joins", "start_time": 7.8, "end_time": 8.4},
                    {"word": "in", "start_time": 8.4, "end_time": 9.0},
                ],
            },
            {
                "id": 2,
                "text": "Both sing together",
                "start_time": 10.0,
                "end_time": 12.0,
                "singer": "both",
                "words": [
                    {"word": "Both", "start_time": 10.0, "end_time": 10.5},
                    {"word": "sing", "start_time": 10.5, "end_time": 11.2},
                    {"word": "together", "start_time": 11.2, "end_time": 12.0},
                ],
            },
        ]
        ass = generate_ass_content(lines)
        dialogues = lyric_rows(ass)
        assert {d.line for d in dialogues} == {0, 1, 2}

        # Ensure no negative timing tags exist anywhere
        assert "{\\k-" not in ass
        assert "{\\kf-" not in ass

        # For each row of a line, extract all \kf<digits> tags
        swept = {0: 0, 1: 0, 2: 0}
        for d in dialogues:
            kf_matches = re.findall(r"\{\\kf(\d+)\}", d.text)
            assert len(kf_matches) > 0, f"No \\kf tags found in dialogue: {d}"
            assert len(kf_matches) == len(d.plain.split())
            swept[d.line] += len(kf_matches)
            for kf_val in kf_matches:
                dur_cs = int(kf_val)
                assert dur_cs >= 1, f"Found zero or negative \\kf tag: {dur_cs}"
        assert swept == {index: len(line["words"]) for index, line in enumerate(lines)}

    def test_kf_tags_with_zero_or_inverted_word_durations(self):
        """Words with zero or inverted durations are clamped to at least \\kf1."""
        lines = [
            {
                "id": 0,
                "text": "Zero inverted word line",
                "start_time": 1.0,
                "end_time": 3.0,
                "singer": "both",
                "words": [
                    {"word": "Zero", "start_time": 1.0, "end_time": 1.0},  # 0 duration
                    {"word": "inverted", "start_time": 1.5, "end_time": 1.2},  # inverted
                    {"word": "word", "start_time": 1.8, "end_time": 2.5},
                ],
            }
        ]
        ass = generate_ass_content(lines)
        (row,) = lyric_rows(ass)

        kf_matches = re.findall(r"\{\\kf(\d+)\}", row.text)
        assert len(kf_matches) == 3
        # All kf tags must be >= 1
        for val in kf_matches:
            assert int(val) >= 1

    def test_special_characters_escaping_in_words(self):
        """ASS control characters and formatting symbols in lyrics do not break ASS syntax."""
        lines = [
            {
                "id": 0,
                "text": "Special {tags} \\N \\h \"quotes\" 'single' & <font> ● 🎤",
                "start_time": 1.0,
                "end_time": 4.0,
                "singer": "singer2",
                "words": [
                    {"word": "{tags}", "start_time": 1.0, "end_time": 1.8},
                    {"word": "\\N", "start_time": 1.8, "end_time": 2.5},
                    {"word": "AC/DC", "start_time": 2.5, "end_time": 3.0},
                    {"word": "🎤", "start_time": 3.0, "end_time": 4.0},
                ],
            }
        ]
        ass = generate_ass_content(lines, theme_id=ROWS_LOOK)
        dialogues = lyric_rows(ass)
        assert len(dialogues) == 1
        d_line = dialogues[0].text

        # Braces inside words must be escaped as \{ and \}
        assert "\\{tags\\}" in d_line
        # Backslash parted from the N
        assert "\\\u2060N" in d_line
        # Valid kf tags remain unescaped
        assert d_line.count("{\\kf") == 4
        # What each sweep fills is its word, the backslash and braces as characters
        assert re.split(r"\{\\kf\d+\}", d_line)[1:] == [
            "\\{tags\\} ",
            "\\\u2060N ",
            "AC/DC ",
            "🎤",
        ]

    def test_custom_singer_colors_reach_their_lines(self):
        """Custom singer2 and both colors are the sung colours of those parts' lines."""
        lines = [
            {"id": 0, "text": "Test", "start_time": 1.0, "end_time": 2.0},
            {"id": 1, "text": "Reply", "start_time": 3.0, "end_time": 4.0, "singer": "singer2"},
            {"id": 2, "text": "Chorus", "start_time": 5.0, "end_time": 6.0, "singer": "both"},
        ]
        ass = generate_ass_content(
            lines,
            singer2_color="#ff0080",  # Rose pink -> &H8000FF&
            both_color="#00ffff",  # Aqua/Cyan -> &HFFFF00&
        )
        sung = {
            d.line: re.search(r"\\1c(&H[0-9A-F]{6}&)", d.tags).group(1) for d in lyric_rows(ass)
        }
        assert sung[1] == "&H8000FF&"
        assert sung[2] == "&HFFFF00&"
        assert sung[0] not in ("&H8000FF&", "&HFFFF00&")

    def test_empty_lines_list_handling(self):
        """Empty lines list returns valid ASS skeleton with the look's styles defined."""
        ass = generate_ass_content([])
        assert "[Script Info]" in ass
        assert "[V4+ Styles]" in ass
        assert "[Events]" in ass
        parsed = parse_ass(ass)
        assert set(parsed["styles"]) == {*look_faces(LookStyle.of(None)), "Shape"}
        assert parsed["events"] == []


class TestVideoRendererCompositeAndBurn:
    """Empirical verification that multi-singer styling burns cleanly into MP4 via FFmpeg."""

    @pytest.fixture
    def sample_audio_wav(self, tmp_path):
        """Generates a real 3-second stereo WAV audio file for rendering."""
        wav_path = tmp_path / "test_audio.wav"
        sr = 44100
        duration = 3.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        audio = 0.3 * np.sin(2 * np.pi * 440 * t)
        stereo = np.column_stack([audio, audio]).astype(np.float32)
        sf.write(str(wav_path), stereo, sr)
        return str(wav_path)

    def test_video_renderer_burns_multi_singer_subtitles_16_9(self, tmp_path, sample_audio_wav):
        """VideoRenderer renders 16:9 MP4 with Singer 1, Singer 2, and Both styles cleanly without FFmpeg errors."""
        renderer = VideoRenderer(output_dir=tmp_path)
        output_ass = tmp_path / "multi_singer_16_9.ass"
        output_mp4 = tmp_path / "multi_singer_16_9.mp4"

        lines = [
            {
                "id": 0,
                "text": "Singer 1 sings first",
                "start_time": 0.5,
                "end_time": 1.2,
                "singer": "singer1",
                "words": [
                    {"word": "Singer", "start_time": 0.5, "end_time": 0.8},
                    {"word": "1", "start_time": 0.8, "end_time": 1.2},
                ],
            },
            {
                "id": 1,
                "text": "Singer 2 responds",
                "start_time": 1.4,
                "end_time": 2.1,
                "singer": "singer2",
                "words": [
                    {"word": "Singer", "start_time": 1.4, "end_time": 1.8},
                    {"word": "2", "start_time": 1.8, "end_time": 2.1},
                ],
            },
            {
                "id": 2,
                "text": "Both harmonize",
                "start_time": 2.2,
                "end_time": 2.9,
                "singer": "both",
                "words": [
                    {"word": "Both", "start_time": 2.2, "end_time": 2.6},
                    {"word": "harmonize", "start_time": 2.6, "end_time": 2.9},
                ],
            },
        ]

        ass_path = renderer.generate_ass_subtitles(
            lines=lines,
            output_ass_path=output_ass,
            aspect_ratio="16:9",
        )
        assert Path(ass_path).is_file()

        # Render video with FFmpeg
        progress_calls = []

        def on_progress(pct, detail, eta):
            progress_calls.append(pct)

        rendered_mp4 = renderer.render_video(
            audio_path=sample_audio_wav,
            ass_subtitles_path=ass_path,
            output_mp4_path=output_mp4,
            aspect_ratio="16:9",
            duration=3.0,
            progress_callback=on_progress,
        )

        assert Path(rendered_mp4).is_file()
        assert Path(rendered_mp4).stat().st_size > 10000

        # ffprobe validation: verify video stream properties
        probe_v = (
            subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height,codec_name",
                    "-of",
                    "csv=p=0",
                    rendered_mp4,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            .stdout.strip()
            .split(",")
        )
        codec, width, height = probe_v[0], int(probe_v[1]), int(probe_v[2])
        assert codec == "h264"
        assert width == 1920
        assert height == 1080

        # ffprobe validation: verify audio stream properties
        probe_a = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "csv=p=0",
                rendered_mp4,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert probe_a == "aac"

    def test_video_renderer_burns_multi_singer_subtitles_9_16(self, tmp_path, sample_audio_wav):
        """VideoRenderer renders 9:16 vertical MP4 with multi-singer styles cleanly."""
        renderer = VideoRenderer(output_dir=tmp_path)
        output_ass = tmp_path / "multi_singer_9_16.ass"
        output_mp4 = tmp_path / "multi_singer_9_16.mp4"

        lines = [
            {
                "id": 0,
                "text": "Vertical Lead",
                "start_time": 0.5,
                "end_time": 1.5,
                "singer": "singer1",
                "words": [{"word": "Vertical", "start_time": 0.5, "end_time": 1.5}],
            },
            {
                "id": 1,
                "text": "Vertical Duet",
                "start_time": 1.6,
                "end_time": 2.8,
                "singer": "both",
                "words": [{"word": "Duet", "start_time": 1.6, "end_time": 2.8}],
            },
        ]

        ass_path = renderer.generate_ass_subtitles(
            lines=lines,
            output_ass_path=output_ass,
            aspect_ratio="9:16",
        )

        rendered_mp4 = renderer.render_video(
            audio_path=sample_audio_wav,
            ass_subtitles_path=ass_path,
            output_mp4_path=output_mp4,
            aspect_ratio="9:16",
            duration=3.0,
        )

        assert Path(rendered_mp4).is_file()

        probe_v = (
            subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height,codec_name",
                    "-of",
                    "csv=p=0",
                    rendered_mp4,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            .stdout.strip()
            .split(",")
        )
        codec, width, height = probe_v[0], int(probe_v[1]), int(probe_v[2])
        assert codec == "h264"
        assert width == 1080
        assert height == 1920

    def test_video_renderer_method_parameter_signatures(self, tmp_path):
        """VideoRenderer.generate_ass_subtitles takes the duet colours through style_config or as
        keyword arguments, with the same result."""
        renderer = VideoRenderer(output_dir=tmp_path)
        out_ass = tmp_path / "sig_test.ass"

        # Calling with singer2_color via style_config works cleanly:
        lines = [
            {"id": 0, "text": "Hi", "start_time": 0.0, "end_time": 1.0, "singer": "singer2"},
            {"id": 1, "text": "Ho", "start_time": 2.0, "end_time": 3.0, "singer": "both"},
        ]
        res = renderer.generate_ass_subtitles(
            lines=lines,
            output_ass_path=out_ass,
            style_config={"singer2_color": "#ff0080", "both_color": "#00ff00"},
        )
        content = Path(res).read_text(encoding="utf-8")
        sung = {d.line: d.tags for d in lyric_rows(content)}
        assert "\\1c&H8000FF&" in sung[0]  # Converted BGR for #ff0080
        assert "\\1c&H00FF00&" in sung[1]  # Converted BGR for #00ff00

        # The duet colours are direct keyword arguments too, like on the module function
        direct = tmp_path / "sig_test_direct.ass"
        renderer.generate_ass_subtitles(
            lines=lines,
            output_ass_path=direct,
            singer2_color="#ff0080",
            both_color="#00ff00",
        )
        assert direct.read_text(encoding="utf-8") == content

    def test_video_renderer_burns_emojis_and_unicode_lyrics(self, tmp_path, sample_audio_wav):
        """VideoRenderer burns non-ASCII, Cyrillic, Japanese, and emoji characters without crashing FFmpeg."""
        renderer = VideoRenderer(output_dir=tmp_path)
        output_ass = tmp_path / "unicode.ass"
        output_mp4 = tmp_path / "unicode.mp4"

        lines = [
            {
                "id": 0,
                "text": "カラオケ 🎤 Bonjour Café",
                "start_time": 0.5,
                "end_time": 1.5,
                "singer": "singer1",
                "words": [
                    {"word": "カラオケ", "start_time": 0.5, "end_time": 1.0},
                    {"word": "🎤", "start_time": 1.0, "end_time": 1.2},
                    {"word": "Bonjour", "start_time": 1.2, "end_time": 1.4},
                    {"word": "Café", "start_time": 1.4, "end_time": 1.5},
                ],
            },
            {
                "id": 1,
                "text": "Привет мир 👥 Duet Unison",
                "start_time": 1.6,
                "end_time": 2.8,
                "singer": "both",
                "words": [
                    {"word": "Привет", "start_time": 1.6, "end_time": 2.0},
                    {"word": "мир", "start_time": 2.0, "end_time": 2.3},
                    {"word": "👥", "start_time": 2.3, "end_time": 2.5},
                    {"word": "Duet", "start_time": 2.5, "end_time": 2.8},
                ],
            },
        ]

        ass_path = renderer.generate_ass_subtitles(
            lines=lines,
            output_ass_path=output_ass,
            aspect_ratio="16:9",
        )

        rendered_mp4 = renderer.render_video(
            audio_path=sample_audio_wav,
            ass_subtitles_path=ass_path,
            output_mp4_path=output_mp4,
            duration=3.0,
        )

        assert Path(rendered_mp4).is_file()
        assert Path(rendered_mp4).stat().st_size > 10000


class TestAlignerEdgeStress:
    """Further edge-case stress tests for AudioAligner with exotic audio conditions."""

    def test_aligner_with_nan_and_inf_audio_samples(self, tmp_path):
        """Aligner sanitizes NaN and Inf samples in vocal audio without propagating NaNs to timestamps."""
        wav_path = tmp_path / "nan_inf.wav"
        sr = 44100
        samples = np.array(
            [0.5, float("nan"), -0.5, float("inf"), float("-inf"), 0.2] * 1000, dtype=np.float32
        )
        sf.write(str(wav_path), samples, sr)

        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "Sanitize test",
                "start_time": 0.0,
                "end_time": 0.1,
                "singer": "singer2",
            }
        ]
        result = aligner.align_lyrics(str(wav_path), input_lines)
        assert len(result) == 1
        assert result[0]["singer"] == "singer2"
        for w in result[0]["words"]:
            assert math.isfinite(w["start_time"])
            assert math.isfinite(w["end_time"])

    @pytest.mark.parametrize("sr", [8000, 16000, 48000, 96000])
    def test_aligner_with_various_sample_rates(self, tmp_path, sr):
        """Aligner correctly computes frame lengths across various sample rates."""
        wav_path = tmp_path / f"sr_{sr}.wav"
        duration = 1.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        audio = (0.4 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        sf.write(str(wav_path), audio, sr)

        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "Sample rate test",
                "start_time": 0.1,
                "end_time": 0.8,
                "singer": "both",
            }
        ]
        result = aligner.align_lyrics(str(wav_path), input_lines)
        assert len(result) == 1
        assert result[0]["singer"] == "both"
        assert len(result[0]["words"]) == 3

    def test_aligner_with_empty_audio_file(self, tmp_path):
        """Aligner handles zero-byte / zero-frame audio without ZeroDivisionError."""
        wav_path = tmp_path / "zero_frame.wav"
        with wave.open(str(wav_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(44100)
            wf.writeframes(b"")

        aligner = AudioAligner()
        input_lines = [
            {
                "id": 0,
                "text": "Zero audio line",
                "start_time": 1.0,
                "end_time": 3.0,
                "singer": "singer1",
            }
        ]
        result = aligner.align_lyrics(str(wav_path), input_lines)
        assert len(result) == 1
        assert result[0]["singer"] == "singer1"


class TestAssScaleStress:
    """High-volume multi-line stress testing for ASS subtitle generation."""

    def test_fifty_lines_alternation_and_timing_integrity(self):
        """50 lines alternating singers generate valid dialogue styles and strictly positive \\kf tags."""
        singers = ["singer1", "singer2", "both"]
        lines = []
        cur_t = 1.0
        for i in range(50):
            s_role = singers[i % 3]
            line_words = [
                {"word": f"word_{i}_1", "start_time": cur_t, "end_time": cur_t + 0.4},
                {"word": f"word_{i}_2", "start_time": cur_t + 0.4, "end_time": cur_t + 0.8},
                {"word": f"word_{i}_3", "start_time": cur_t + 0.8, "end_time": cur_t + 1.2},
            ]
            lines.append(
                {
                    "id": i,
                    "text": f"Line {i} text",
                    "start_time": cur_t,
                    "end_time": cur_t + 1.2,
                    "singer": s_role,
                    "words": line_words,
                }
            )
            cur_t += 1.5

        ass = generate_ass_content(lines, theme_id=ROWS_LOOK)
        dialogues = lyric_rows(ass)
        assert [d.line for d in dialogues] == list(range(50))
        look = LookStyle.of(ROWS_LOOK)

        for i, d in enumerate(dialogues):
            # Lines take the two rows in turn, each in its part's colours
            assert row_of(d) == i % 2
            sung, unsung = look.sweep_colors(singers[i % 3])
            assert d.tags.endswith(f"\\1c{sung}\\2c{unsung}")

            # Verify 3 \kf tags on each line
            kf_matches = re.findall(r"\{\\kf(\d+)\}", d.text)
            assert len(kf_matches) == 3
            for dur in kf_matches:
                assert int(dur) >= 1
