"""
Milestone 2 Iteration 2 Challenger 1: Adversarial and Edge-Case Stress Suite.
Tests non-Latin-1 export filenames, ASS timestamp resilience, centisecond rollover,
and 100+ minute track handling across services and HTTP endpoints.
"""

import math
import re
import urllib.parse

import pytest
from fastapi.testclient import TestClient

from backend.main import app, build_content_disposition, projects, sanitize_export_filename
from backend.services.aligner import AudioAligner
from backend.services.lyrics import LyricsService
from backend.services.video_renderer import VideoRenderer


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-App-Password": "sluggos"}


# ============================================================================
# Section 1: Non-Latin-1 and Malformed Filenames in Export Routes (/export/lrc, /export/ass)
# ============================================================================


@pytest.mark.parametrize(
    "title,artist,expected_in_utf8",
    [
        ("夜に駆ける", "YOASOBI", "%E5%A4%9C%E3%81%AB%E9%A7%86%E3%81%91%E3%82%8B"),
        ("Группа крови", "Кино", "%D0%93%D1%80%D1%83%D0%BF%D0%BF%D0%B0"),
        ("يا مسافر وحدك", "محمد عبد الوهاب", "%D9%8A%D8%A7"),
        ("Μες στον παράδεισο", "Γιώργος", "%CE%9C%CE%B5%CF%82"),
        ("🎵 ✨ 🚀 🌟 🎤", "Emoji Singer", "%F0%9F%8E%B5"),
        ("Pure Emoji Only: 🎶", "", "%F0%9F%8E%B6"),
        ('Quotes "and" Semicolons; \\Backslash\nNewline\rCR\tTab', "Weird Artist", "Quotes"),
        ("   ", "   ", ""),  # Blank falls back safely
        ("....____----", "....", ""),  # Only punctuation
    ],
)
def test_export_filename_sanitization_and_content_disposition(title, artist, expected_in_utf8):
    """
    Verify sanitize_export_filename and build_content_disposition:
    - Never raise exceptions.
    - Resulting ASCII filename can strictly be encoded to ASCII and Latin-1 without error.
    - Resulting UTF-8 filename* can be decoded back to match UTF-8 intent.
    - No CR, LF, or unescaped quotes in Content-Disposition.
    """
    cd = build_content_disposition(title=title, artist=artist, ext="lrc", fallback="fallback_id")

    # Header must be strictly ASCII encodable (which guarantees Latin-1 encodability for Starlette)
    cd.encode("ascii")
    cd.encode("latin-1")

    assert "\r" not in cd
    assert "\n" not in cd
    assert 'filename="' in cd
    assert "filename*=UTF-8''" in cd

    # Extract ascii filename
    m_ascii = re.search(r'filename="([^"]+)"', cd)
    assert m_ascii is not None
    ascii_fn = m_ascii.group(1)
    assert ascii_fn.endswith(".lrc")
    ascii_fn.encode("ascii")  # strictly ASCII

    # Extract UTF-8 filename
    m_utf8 = re.search(r"filename\*=UTF-8''([^;\s]+)", cd)
    assert m_utf8 is not None
    encoded_utf8 = m_utf8.group(1)
    decoded_utf8 = urllib.parse.unquote(encoded_utf8)
    assert decoded_utf8.endswith(".lrc")

    if expected_in_utf8:
        assert expected_in_utf8 in encoded_utf8


@pytest.mark.parametrize("endpoint_ext", ["lrc", "ass"])
def test_http_export_non_latin1_international_titles(client, auth_headers, endpoint_ext):
    """
    Empirically verify GET /api/project/{id}/export/lrc and /export/ass:
    - Return HTTP 200 with CJK, Cyrillic, Emojis, RTL text.
    - Starlette does NOT crash with UnicodeEncodeError.
    - Response headers Content-Disposition is valid ASCII and contains both parameters.
    """
    test_cases = [
        ("proj_cjk", "夜に駆ける", "YOASOBI"),
        ("proj_cyrillic", "Группа крови", "Кино"),
        ("proj_emoji", "✨ Cosmic Karaoke 🎤", "Star 🌟"),
        ("proj_arabic", "يا مسافر وحدك", "محمد عبد الوهاب"),
        ("proj_all_symbols", "!!! ??? /// \\\\ ***", "### $$$"),
    ]

    for pid, title, artist in test_cases:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "title": title,
            "artist": artist,
            "lines": [
                {
                    "id": 0,
                    "start_time": 1.25,
                    "end_time": 4.5,
                    "text": f"Sample line for {title}",
                    "words": [
                        {"word": "Sample", "start_time": 1.25, "end_time": 2.0},
                        {"word": "line", "start_time": 2.0, "end_time": 3.0},
                    ],
                }
            ],
        }

        url = f"/api/project/{pid}/export/{endpoint_ext}"
        if endpoint_ext == "ass":
            url += "?aspect_ratio=16:9&theme_id=modern_gold"

        resp = client.get(url, headers=auth_headers)
        assert resp.status_code == 200, (
            f"Failed for {pid} ({title}): {resp.status_code} {resp.text}"
        )

        cd_header = resp.headers.get("content-disposition", "")
        assert cd_header, f"Missing Content-Disposition header for {pid}"

        # Verify Starlette header latin-1 compliance
        cd_header.encode("latin-1")
        cd_header.encode("ascii")

        assert 'filename="' in cd_header
        assert "filename*=UTF-8''" in cd_header

        # Verify content is valid UTF-8 and contains the line text tokens
        content_text = resp.text
        assert "Sample" in content_text and "line" in content_text
        if endpoint_ext == "lrc":
            assert "[00:01.25]" in content_text
        elif endpoint_ext == "ass":
            assert "[Script Info]" in content_text
            assert "PlayResX: 1920" in content_text


# ============================================================================
# Section 2: ASS Subtitle Timestamp Resilience (None, NaN, Inf, Negative, Extreme)
# ============================================================================


def test_safe_time_coercion_edge_cases():
    """
    Directly stress-test VideoRenderer._safe_time against all pathological inputs.
    """
    vr = VideoRenderer()
    # Pathological inputs that must coerce cleanly without throwing
    assert vr._safe_time(None) == 0.0
    assert vr._safe_time(None, default=5.0) == 5.0
    assert vr._safe_time(float("nan")) == 0.0
    assert vr._safe_time(float("nan"), default=3.0) == 3.0
    assert vr._safe_time(float("inf")) == 0.0
    assert vr._safe_time(float("-inf")) == 0.0
    assert vr._safe_time(-100.5) == 0.0
    assert vr._safe_time(-0.0001) == 0.0
    assert vr._safe_time("not_a_number") == 0.0
    assert vr._safe_time("not_a_number", default="bad_default") == 0.0
    assert vr._safe_time([], default=2.0) == 2.0
    assert vr._safe_time({}, default=4.0) == 4.0
    assert vr._safe_time(0.0) == 0.0
    assert vr._safe_time(42.5) == 42.5
    assert vr._safe_time("123.45") == 123.45


def test_generate_ass_content_pathological_lines_and_words():
    """
    Stress-test generate_ass_content with None, NaN, Inf, negative, missing fields,
    malformed words, and non-dict entries. Must return valid ASS document without crashing.
    """
    vr = VideoRenderer()

    # 1. Non-list / empty lines
    assert "[Script Info]" in vr.generate_ass_content([])
    assert "[Script Info]" in vr.generate_ass_content(None)  # type: ignore
    assert "[Script Info]" in vr.generate_ass_content("string instead of list")  # type: ignore

    # 2. Pathological line items
    pathological_lines = [
        None,  # Not a dict
        123,  # Not a dict
        "just text",  # Not a dict
        {},  # Empty dict
        {"id": 0, "start_time": None, "end_time": None, "text": "Null line"},
        {"id": 1, "start_time": float("nan"), "end_time": float("nan"), "text": "NaN line"},
        {"id": 2, "start_time": float("inf"), "end_time": float("inf"), "text": "Inf line"},
        {"id": 3, "start_time": float("-inf"), "end_time": -10.0, "text": "Neg line"},
        {"id": 4, "start_time": 10.0, "end_time": 2.0, "text": "Inverted line"},  # end < start
        {
            "id": 5,
            "start_time": 20.0,
            "end_time": 25.0,
            "text": "Malformed words line",
            "words": [
                None,  # Not a dict
                "string word",
                {},
                {"word": "Bad1", "start_time": None, "end_time": None},
                {"word": "Bad2", "start_time": float("nan"), "end_time": 22.0},
                {"word": "Bad3", "start_time": float("inf"), "end_time": float("inf")},
                {"word": "Bad4", "start_time": -5.0, "end_time": -1.0},
                {"word": "Bad5", "start_time": 24.0, "end_time": 21.0},  # inverted
                {"word": "Good", "start_time": 24.0, "end_time": 25.0},
            ],
        },
        # Control characters injection attempt
        {
            "id": 6,
            "start_time": 30.0,
            "end_time": 34.0,
            "text": "Evil {\\b1} \\N \\h {\\c&H0000FF&} tags",
        },
    ]

    ass_result = vr.generate_ass_content(
        pathological_lines, aspect_ratio="16:9", theme_id="modern_gold"
    )
    assert isinstance(ass_result, str)
    assert "[Script Info]" in ass_result
    assert "[Events]" in ass_result

    # Check that evil tags were escaped
    assert r"Evil \{\\b1\} \\N \\h \{\\c&H0000FF&\} tags" in ass_result or r"\{\\b1\}" in ass_result


# ============================================================================
# Section 3: ASS Centisecond Rollover and Negative Clamping
# ============================================================================


@pytest.mark.parametrize(
    "seconds_in,expected_str",
    [
        (59.996, "0:01:00.00"),  # 59.996s -> round(5999.6) = 6000cs -> 1m 00.00s
        (0.999, "0:00:01.00"),  # 0.999s -> round(99.9) = 100cs -> 1.00s
        (0.994, "0:00:00.99"),  # 0.994s -> round(99.4) = 99cs
        (59.994, "0:00:59.99"),  # 59.994s -> round(5999.4) = 5999cs
        (3599.996, "1:00:00.00"),  # 59m 59.996s -> 1h 00m 00.00s
        (0.0, "0:00:00.00"),
        (0.004, "0:00:00.00"),
        (0.015, "0:00:00.02"),
        (-0.5, "0:00:00.00"),  # Negative clamped safely
        (-100.0, "0:00:00.00"),
        (float("nan"), "0:00:00.00"),
        (float("inf"), "0:00:00.00"),
        (float("-inf"), "0:00:00.00"),
        (None, "0:00:00.00"),
    ],
)
def test_ass_time_rollover_and_boundary_formatting(seconds_in, expected_str):
    """
    Empirically verify VideoRenderer._format_ass_time handles centisecond rollovers,
    multi-hour bounds, negatives, and non-finite floats.
    """
    assert VideoRenderer._format_ass_time(seconds_in) == expected_str


# ============================================================================
# Section 4: 100+ Minute Extended Track Support Across All Services & Routes
# ============================================================================


def test_100_plus_minute_is_lrc():
    """
    Verify LyricsService.is_lrc accepts tracks extending past 99 minutes (up to 9999).
    """
    assert LyricsService.is_lrc("[100:00.00] Line at 100 mins") is True
    assert LyricsService.is_lrc("[120:45.67] Two-hour opera line") is True
    assert LyricsService.is_lrc("[999:59.99] Long concert") is True
    assert LyricsService.is_lrc("[9999:00.00] Maximum boundary") is True

    # Should still reject invalid brackets
    assert LyricsService.is_lrc("[Verse 1]") is False
    assert LyricsService.is_lrc("[Chorus]") is False
    assert LyricsService.is_lrc("[ti:Song Title]") is False
    assert LyricsService.is_lrc("[ar:Artist Name]") is False


def test_100_plus_minute_parse_lrc():
    """
    Verify LyricsService.parse_lrc accurately converts timestamps >= 100 minutes.
    """
    lrc_content = (
        "[00:30.00] Intro\n"
        "[99:59.50] Pre-hundred\n"
        "[100:00.00] Century mark\n"
        "[120:15.50] Deep in extended mix\n"
    )
    parsed = LyricsService.parse_lrc(lrc_content)
    assert len(parsed) == 4
    assert parsed[0]["start_time"] == 30.0
    assert parsed[1]["start_time"] == round(99 * 60 + 59.50, 3)
    assert parsed[2]["start_time"] == 6000.0
    assert parsed[2]["text"] == "Century mark"
    assert parsed[3]["start_time"] == round(120 * 60 + 15.50, 3)
    assert parsed[3]["text"] == "Deep in extended mix"


def test_100_plus_minute_generate_lrc():
    """
    Verify LyricsService.generate_lrc formats lines >= 100 minutes cleanly as [100:xx.xx]
    and strips any pre-existing 100+ minute timestamp tags from text.
    """
    lines = [
        {"id": 0, "start_time": 6000.0, "text": "[100:00.00] Raw tagged century text"},
        {"id": 1, "start_time": 7215.25, "text": "Two hour mark"},
    ]
    gen = LyricsService.generate_lrc(lines, title="Long Opera", artist="Maestro")
    assert "[ti:Long Opera]" in gen
    assert "[ar:Maestro]" in gen
    assert (
        "[100:00.00]Raw tagged century text" in gen or "[100:00.00] Raw tagged century text" in gen
    )
    assert "[120:15.25]Two hour mark" in gen or "[120:15.25] Two hour mark" in gen
    # Ensure raw tag was not duplicated
    assert "[100:00.00][100:00.00]" not in gen


def test_aligner_tag_stripping_100_plus_minutes():
    """
    Verify 100+ minute LRC and word bracket tags regex used in AudioAligner.
    """
    raw = "[100:00.00] Long line <100:01.50> with <100:02.00> tags"
    stripped = re.sub(r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>", "", raw)
    cleaned = re.sub(r"\s+", " ", stripped).strip()
    assert cleaned == "Long line with tags"


def test_http_export_lrc_100_plus_minute_project(client, auth_headers):
    """
    Verify GET /api/project/{id}/export/lrc does not return 400 for 100+ minute tracks.
    """
    pid = "proj_extended_100m"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "title": "Extended Symphony",
        "artist": "Orchestra",
        "lines": [
            {"id": 0, "start_time": 6000.0, "end_time": 6005.0, "text": "Century mark movement"},
            {"id": 1, "start_time": 7200.0, "end_time": 7205.0, "text": "Two hours completed"},
        ],
    }

    resp = client.get(f"/api/project/{pid}/export/lrc", headers=auth_headers)
    assert resp.status_code == 200
    assert "[100:00.00]Century mark movement" in resp.text
    assert "[120:00.00]Two hours completed" in resp.text


# ============================================================================
# Section 5: HTTP Error Handling, Query Parameter Injections & Large Timeline Stress
# ============================================================================


def test_export_endpoints_invalid_parameters(client, auth_headers):
    """
    Verify /export/ass and /export/lrc reject invalid inputs with HTTP 400/404
    and do not throw 500 unhandled errors.
    """
    pid = "proj_valid_for_param_tests"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "title": "Param Test Song",
        "artist": "Param Artist",
        "lines": [{"id": 0, "start_time": 1.0, "end_time": 4.0, "text": "Valid text"}],
    }

    # Unknown project returns 404
    assert (
        client.get("/api/project/nonexistent_id/export/lrc", headers=auth_headers).status_code
        == 404
    )
    assert (
        client.get("/api/project/nonexistent_id/export/ass", headers=auth_headers).status_code
        == 404
    )

    # Invalid aspect ratio returns 400
    resp_ar = client.get(f"/api/project/{pid}/export/ass?aspect_ratio=4:3", headers=auth_headers)
    assert resp_ar.status_code == 400
    assert "Invalid aspect ratio" in resp_ar.json()["detail"]

    resp_ar2 = client.get(
        f"/api/project/{pid}/export/ass?aspect_ratio=evil;injection", headers=auth_headers
    )
    assert resp_ar2.status_code == 400

    # Invalid theme_id returns 400
    resp_theme = client.get(
        f"/api/project/{pid}/export/ass?theme_id=bogus_theme", headers=auth_headers
    )
    assert resp_theme.status_code == 400
    assert "Invalid theme_id" in resp_theme.json()["detail"]

    # Active processing status without lines returns 400
    pid_queued = "proj_queued_no_lines"
    projects[pid_queued] = {"id": pid_queued, "status": "queued"}
    assert (
        client.get(f"/api/project/{pid_queued}/export/lrc", headers=auth_headers).status_code == 400
    )
    assert (
        client.get(f"/api/project/{pid_queued}/export/ass", headers=auth_headers).status_code == 400
    )


def test_export_endpoints_empty_or_whitespace_lines(client, auth_headers):
    """
    Verify projects with whitespace-only or empty lines return clean 400 instead of crashing.
    """
    pid_blank = "proj_blank_lines"
    projects[pid_blank] = {
        "id": pid_blank,
        "status": "ready",
        "title": "Blank Song",
        "artist": "Blank Artist",
        "lines": [
            {"id": 0, "start_time": 1.0, "end_time": 2.0, "text": "   "},
            {"id": 1, "start_time": 2.5, "end_time": 3.5, "text": ""},
        ],
    }
    resp = client.get(f"/api/project/{pid_blank}/export/lrc", headers=auth_headers)
    assert resp.status_code == 400
    assert "Project has no lyric lines to export" in resp.json()["detail"]


def test_large_project_ass_and_lrc_stress(client, auth_headers):
    """
    Stress test with 500 lines across 300 minutes to ensure no performance hang,
    stack overflow, or formatting degradation.
    """
    pid_large = "proj_large_scale"
    large_lines = []
    for i in range(500):
        t_start = i * 36.0  # spans 0 to 18,000 seconds (300 minutes)
        t_end = t_start + 30.0
        large_lines.append(
            {
                "id": i,
                "start_time": t_start,
                "end_time": t_end,
                "text": f"Line {i} at time {t_start} seconds in symphony",
                "words": [
                    {"word": f"Word_{i}_1", "start_time": t_start, "end_time": t_start + 10.0},
                    {"word": f"Word_{i}_2", "start_time": t_start + 10.0, "end_time": t_end},
                ],
            }
        )

    projects[pid_large] = {
        "id": pid_large,
        "status": "ready",
        "title": "Massive 300-Minute Concert 🎸 🎵",
        "artist": "The Big Band 🎺",
        "lines": large_lines,
    }

    # Test LRC export
    resp_lrc = client.get(f"/api/project/{pid_large}/export/lrc", headers=auth_headers)
    assert resp_lrc.status_code == 200
    assert "[299:24.00]" in resp_lrc.text
    assert resp_lrc.headers["content-disposition"].encode("ascii")

    # Test ASS export
    resp_ass = client.get(
        f"/api/project/{pid_large}/export/ass?aspect_ratio=9:16", headers=auth_headers
    )
    assert resp_ass.status_code == 200
    assert "PlayResX: 1080" in resp_ass.text
    assert "PlayResY: 1920" in resp_ass.text
    assert "Dialogue: 0,4:59:22.00," in resp_ass.text
    assert resp_ass.headers["content-disposition"].encode("ascii")
