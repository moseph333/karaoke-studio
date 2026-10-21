"""
Milestone 3 Challenger 2: Adversarial Stress Test Suite for Chord & Lyric Sheet Export.
Scope:
1. Lead-sheet horizontal alignment with rapid chord changes, un-timed lyrics, and tightly packed chords.
2. Instrumental blocks for intros, bridges/interludes, outros, and pure instrumental tracks.
3. RFC 5987 and RFC 6266 Content-Disposition and Content-Type header fuzzing across diverse Unicode,
   emojis, accents, and malicious strings.
4. Pitch shift / transposition fuzzing across [-12, +12], boundary validation (HTTP 422), and key signature projection.
"""

import re
import urllib.parse
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.main import app, projects
from backend.project_store import PROJECTS_LOCK, save_projects
from backend.routers.exports import format_timestamp, generate_chord_sheet
from backend.services.chord_detector import project_key_signature, transpose_chord


def create_mock_project(
    title: str = "Test Track",
    artist: str = "Test Artist",
    lines: list | None = None,
    chords: list | None = None,
    estimated_key: str | None = "C Major",
) -> str:
    pid = f"chal2_{uuid.uuid4().hex[:8]}"
    stem_dir = config.STEMS_DIR / pid
    stem_dir.mkdir(parents=True, exist_ok=True)

    proj_data = {
        "id": pid,
        "title": title,
        "artist": artist,
        "status": "ready",
        "duration": 60.0,
        "estimated_key": estimated_key,
        "semitones": 0,
        "lines": lines if lines is not None else [],
        "chords": chords if chords is not None else [],
    }

    with PROJECTS_LOCK:
        projects[pid] = proj_data
        save_projects()

    return pid


# ==============================================================================
# SECTION 1: LEAD-SHEET ALIGNMENT & INSTRUMENTAL BLOCKS
# ==============================================================================


def test_rapid_chord_changes_exact_word_alignment(client):
    """Verify chords align horizontally above corresponding lyric words during rapid chord changes."""
    text = "Fast lyric rhythm test with many words and quick changes"
    # Word character start indices:
    # "Fast" -> 0
    # "lyric" -> 5
    # "rhythm" -> 11
    # "test" -> 18
    # "with" -> 23
    # "many" -> 28
    # "words" -> 33
    # "and" -> 39
    # "quick" -> 43
    # "changes" -> 49
    words = [
        {"word": "Fast", "start_time": 0.0, "end_time": 0.4},
        {"word": "lyric", "start_time": 0.4, "end_time": 0.8},
        {"word": "rhythm", "start_time": 0.8, "end_time": 1.2},
        {"word": "test", "start_time": 1.2, "end_time": 1.6},
        {"word": "with", "start_time": 1.6, "end_time": 2.0},
        {"word": "many", "start_time": 2.0, "end_time": 2.4},
        {"word": "words", "start_time": 2.4, "end_time": 2.8},
        {"word": "and", "start_time": 2.8, "end_time": 3.2},
        {"word": "quick", "start_time": 3.2, "end_time": 3.6},
        {"word": "changes", "start_time": 3.6, "end_time": 4.0},
    ]
    lines = [
        {
            "id": 1,
            "text": text,
            "start_time": 0.0,
            "end_time": 4.0,
            "words": words,
        }
    ]
    chords = [
        {"start": 0.0, "end": 0.8, "chord": "C"},
        {"start": 0.8, "end": 1.6, "chord": "Dm7"},
        {"start": 1.6, "end": 2.4, "chord": "Em"},
        {"start": 2.4, "end": 3.2, "chord": "F"},
        {"start": 3.2, "end": 4.0, "chord": "G7"},
    ]

    pid = create_mock_project(title="Rapid Chords Alignment", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    body = res.text

    # Extract lines within the code block
    m = re.search(r"```\n(.*?)\n```", body, re.DOTALL)
    assert m, "Markdown output must be enclosed in fenced code block"
    code_content = m.group(1).splitlines()

    # Find the line with the chord string and the line with the lyric string
    chord_line = None
    lyric_line = None
    for i, line_str in enumerate(code_content):
        if text in line_str:
            lyric_line = line_str
            if i > 0:
                chord_line = code_content[i - 1]
            break

    assert chord_line is not None, "Chord line must precede lyric line"
    assert lyric_line is not None

    # Check alignment:
    # Prefix in chord_line is "[00:00.00]  " (12 characters)
    # Prefix in lyric_line is "            " (12 characters)
    prefix_len = 12
    assert chord_line.startswith("[00:00.00]  ")
    assert lyric_line.startswith(" " * prefix_len)

    # Chords relative to the lyric string:
    chord_payload = chord_line[prefix_len:]
    lyric_payload = lyric_line[prefix_len:]
    assert lyric_payload == text

    # Verify each chord symbol starts exactly at the character column of its target word
    assert chord_payload[0] == "C", f"C should start at col 0 ('Fast'), got {chord_payload}"
    assert chord_payload[11:14] == "Dm7", (
        f"Dm7 should start at col 11 ('rhythm'), got {chord_payload[11:14]}"
    )
    assert chord_payload[23:25] == "Em", (
        f"Em should start at col 23 ('with'), got {chord_payload[23:25]}"
    )
    assert chord_payload[33] == "F", f"F should start at col 33 ('words'), got {chord_payload[33]}"
    assert chord_payload[43:45] == "G7", (
        f"G7 should start at col 43 ('quick'), got {chord_payload[43:45]}"
    )


def test_untimed_lyrics_word_snapping_alignment(client):
    """Verify un-timed lines (without word timestamps) interpolate and snap chords to word boundaries."""
    text = "Waiting for the morning sun to rise"
    lines = [
        {
            "id": 1,
            "text": text,
            "start_time": 0.0,
            "end_time": 10.0,
            "words": [],  # No word-level timestamps
        }
    ]
    # Chord at t=5.0s (midpoint of 10s line)
    # Ratio = 0.5 * 35 chars = ~17.5. Text around char 17: "morning" starts at 16.
    chords = [
        {"start": 0.0, "end": 5.0, "chord": "Am"},
        {"start": 5.0, "end": 10.0, "chord": "G"},
    ]

    pid = create_mock_project(title="Untimed Snapping", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    body = res.text

    m = re.search(r"```\n(.*?)\n```", body, re.DOTALL)
    assert m
    code_content = m.group(1).splitlines()

    chord_line = next(line for line in code_content if "Am" in line and "G" in line)
    lyric_line = next(line for line in code_content if text in line)
    assert lyric_line is not None

    chord_payload = chord_line[12:]
    # Am starts at column 0 ("Waiting")
    assert chord_payload.startswith("Am")
    # G should snap to a non-whitespace character (start of a word like "morning" or "sun")
    g_idx = chord_payload.find("G")
    assert g_idx != -1
    # Char at g_idx in text should not be a space
    assert text[g_idx] != " ", f"G should snap to a word start, but snapped to space at {g_idx}"


def test_tightly_packed_chords_prevent_overlap(client):
    """Verify chords placed closer than their character lengths do not crash and separate gracefully."""
    text = "A B C D E"
    words = [
        {"word": "A", "start_time": 0.0, "end_time": 0.1},
        {"word": "B", "start_time": 0.1, "end_time": 0.2},
        {"word": "C", "start_time": 0.2, "end_time": 0.3},
    ]
    lines = [{"id": 1, "text": text, "start_time": 0.0, "end_time": 1.0, "words": words}]
    # Cmaj7 is 5 chars long, placed at 0.0 ("A" at char 0) and Dsus4 is 5 chars placed at 0.1 ("B" at char 2)
    chords = [
        {"start": 0.0, "end": 0.1, "chord": "Cmaj7"},
        {"start": 0.1, "end": 0.2, "chord": "Dsus4"},
    ]

    pid = create_mock_project(title="Packed Chords", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    # Both chords must appear in the sheet without string clobbering
    assert "Cmaj7" in res.text
    assert "Dsus4" in res.text
    assert "Cmaj7 Dsus4" in res.text


def test_instrumental_blocks_intro_bridge_outro(client):
    """Verify [Instrumental] blocks are generated for intro, inter-line bridge, and outro gaps."""
    lines = [
        {
            "id": 1,
            "text": "First vocal line here",
            "start_time": 8.0,
            "end_time": 12.0,
            "words": [],
        },
        {
            "id": 2,
            "text": "Second vocal line after bridge",
            "start_time": 20.0,
            "end_time": 24.0,
            "words": [],
        },
    ]
    chords = [
        # Intro chords (t < 8.0s)
        {"start": 0.0, "end": 4.0, "chord": "C"},
        {"start": 4.0, "end": 8.0, "chord": "G"},
        # Verse 1 chord (8.0 - 12.0s)
        {"start": 8.0, "end": 12.0, "chord": "Am"},
        # Bridge chords (12.0 - 20.0s gap >= 2.0s)
        {"start": 12.0, "end": 16.0, "chord": "F"},
        {"start": 16.0, "end": 20.0, "chord": "G7"},
        # Verse 2 chord (20.0 - 24.0s)
        {"start": 20.0, "end": 24.0, "chord": "C"},
        # Outro chords (t >= 24.0s)
        {"start": 24.0, "end": 28.0, "chord": "Dm7"},
        {"start": 28.0, "end": 32.0, "chord": "Cmaj7"},
    ]

    pid = create_mock_project(title="Full Song Structure", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    body = res.text

    # Verify Intro block
    assert "[00:00.00]  [Instrumental]" in body
    assert "Chords: C - G" in body

    # Verify Verse 1
    assert "First vocal line here" in body
    assert "Am" in body

    # Verify Inter-line Bridge block
    assert "[00:12.00]  [Instrumental]" in body
    assert "Chords: F - G7" in body

    # Verify Verse 2
    assert "Second vocal line after bridge" in body

    # Verify Outro block
    assert "[00:24.00]  [Instrumental]" in body
    assert "Chords: Dm7 - Cmaj7" in body


def test_purely_instrumental_track(client):
    """Verify projects with 0 lyric lines but valid chords render pure instrumental lead sheets."""
    chords = [
        {"start": 0.0, "end": 4.0, "chord": "C"},
        {"start": 4.0, "end": 8.0, "chord": "Am"},
        {"start": 8.0, "end": 12.0, "chord": "F"},
        {"start": 12.0, "end": 16.0, "chord": "G"},
    ]
    pid = create_mock_project(title="Instrumental Solo", lines=[], chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    body = res.text

    assert "[00:00.00]  [Instrumental]" in body
    assert "Chords: C - Am - F - G" in body


def test_consecutive_identical_chords_deduplicated_in_instrumental(client):
    """Verify consecutive identical chords in instrumental blocks are cleanly deduplicated."""
    chords = [
        {"start": 0.0, "end": 2.0, "chord": "C"},
        {"start": 2.0, "end": 4.0, "chord": "C"},
        {"start": 4.0, "end": 6.0, "chord": "G"},
        {"start": 6.0, "end": 8.0, "chord": "G"},
        {"start": 8.0, "end": 10.0, "chord": "C"},
    ]
    pid = create_mock_project(title="Dedup Test", lines=[], chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    assert "Chords: C - G - C" in res.text
    assert "C - C" not in res.text


def test_no_chord_symbols_filtered_out(client):
    """Verify 'N', 'N.C.', and empty chords are excluded from output and do not clutter sheets."""
    lines = [
        {"id": 1, "text": "Silent intro singing", "start_time": 4.0, "end_time": 8.0, "words": []}
    ]
    chords = [
        {"start": 0.0, "end": 4.0, "chord": "N"},
        {"start": 4.0, "end": 8.0, "chord": "N.C."},
    ]
    pid = create_mock_project(title="No Chord Filtering", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    body = res.text

    # Instrumental block should not display "Chords: N"
    assert "Chords: N" not in body
    assert "Chords: N.C." not in body
    # Line should not display N.C. above lyrics
    assert "N.C." not in body


# ==============================================================================
# SECTION 2: RFC 5987 & RFC 6266 HEADERS FUZZING
# ==============================================================================


@pytest.mark.parametrize(
    "title,artist",
    [
        ("夜に駆ける", "YOASOBI"),  # Japanese CJK
        ("🎵 Karaoke Party! 🎤 🌟 🚀", "Emoji Singer"),  # Emojis
        ("Über den Wolken — Chanson d'été & Joséphine à Noël", "Français/Deutsch"),  # Diacritics
        ("千里之外", "周杰伦 & 费玉清"),  # Chinese CJK
        ("Звезда по имени Солнце", "Кино"),  # Cyrillic
        ("يا مسافر وحدك", "محمد عبد الوهاب"),  # Arabic RTL
        ('Title With "Quotes" and ; Semicolons & \\ Backslash\nNewline', "Dangerous Punctuation"),
        ("   ", "   "),  # Empty whitespace title/artist
        ("🔥", ""),  # Single emoji only
        ("A" * 250, "B" * 50),  # Long strings
    ],
)
def test_rfc5987_and_rfc6266_headers_fuzzing(client, title, artist):
    """Fuzz RFC 5987 & RFC 6266 Content-Disposition and Content-Type across diverse Unicode titles."""
    lines = [{"id": 1, "text": "Singing along", "start_time": 0.0, "end_time": 2.0}]
    chords = [{"start": 0.0, "end": 2.0, "chord": "C"}]

    pid = create_mock_project(title=title, artist=artist, lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")

    # 1. Must succeed with HTTP 200
    assert res.status_code == 200

    # 2. Content-Type must be text/markdown; charset=utf-8
    ct = res.headers.get("content-type", "").lower()
    assert "text/markdown" in ct or "text/plain" in ct
    assert "utf-8" in ct

    # 3. Content-Disposition must exist
    cd = res.headers.get("content-disposition", "")
    assert cd, "Content-Disposition header must be present"
    assert cd.startswith("attachment;"), f"Expected attachment disposition, got {cd}"

    # 4. Must be 100% 7-bit ASCII encodable (guarantees Starlette latin-1 compliance)
    try:
        cd.encode("ascii")
    except UnicodeEncodeError as exc:
        pytest.fail(f"Content-Disposition contains non-ASCII characters: {exc} in {cd}")

    # 5. Must contain legacy ASCII filename="..." parameter
    m_ascii = re.search(r'filename="([^"]+)"', cd)
    assert m_ascii, f"Missing ASCII filename parameter in {cd}"
    ascii_fn = m_ascii.group(1)
    assert ascii_fn.endswith(".md")
    # Must not contain unescaped quotes or path separators
    assert "/" not in ascii_fn
    assert "\\" not in ascii_fn

    # 6. Must contain RFC 5987 filename*=UTF-8''... parameter
    m_rfc5987 = re.search(r"filename\*=UTF-8''([^\s;]+)", cd)
    assert m_rfc5987, f"Missing RFC 5987 filename* parameter in {cd}"
    encoded_fn = m_rfc5987.group(1)

    # 7. Decoding the RFC 5987 percent-encoded filename must recover intended content
    decoded_fn = urllib.parse.unquote(encoded_fn)
    assert decoded_fn.endswith(".md")

    # If title has clean alphanumeric or recognizable words, verify presence in decoded name
    clean_title_chars = re.sub(r'[\r\n"\\/:*?<>|\x00-\x1f\x7f]', "", title).strip()
    if clean_title_chars and not clean_title_chars.isspace():
        # At least one meaningful word or character from title must be preserved
        first_token = clean_title_chars.split()[0]
        if first_token:
            assert first_token in decoded_fn


# ==============================================================================
# SECTION 3: TRANSPOSITION & BOUNDARY FUZZING
# ==============================================================================


@pytest.mark.parametrize("semitones", list(range(-12, 13)))
def test_semitone_transposition_full_range(client, semitones):
    """Verify semitone shifts from -12 to +12 succeed, update headers, and transpose chords accurately."""
    lines = [{"id": 1, "text": "Melody line", "start_time": 0.0, "end_time": 2.0}]
    chords = [{"start": 0.0, "end": 2.0, "chord": "C"}]

    pid = create_mock_project(title="Transpose Range Test", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet?semitones={semitones}")
    assert res.status_code == 200
    body = res.text

    # Verify pitch shift header
    if semitones > 0:
        assert f"**Pitch Shift:** +{semitones} semitones" in body
    elif semitones < 0:
        assert f"**Pitch Shift:** {semitones} semitones" in body
    else:
        assert "**Pitch Shift:** Original key (0 semitones)" in body

    # Verify transposed chord symbol with circle-of-fifths key awareness
    target_key = project_key_signature("C Major", semitones) if semitones != 0 else "C Major"
    expected_chord = transpose_chord("C", semitones, key=target_key)
    assert expected_chord in body, (
        f"Transposed chord {expected_chord} not found in body for {semitones} (target key: {target_key})"
    )


@pytest.mark.parametrize(
    "invalid_semitones",
    [13, -13, 14, -14, 50, -50, 100, -999, "invalid", "1.5", "-12.5", ""],
)
def test_invalid_semitones_returns_http_422(client, invalid_semitones):
    """Verify out-of-range (>12 or <-12) or non-integer semitones trigger HTTP 422 Unprocessable Entity."""
    pid = create_mock_project(
        title="Boundary Project",
        lines=[{"id": 1, "text": "Test line", "start_time": 0.0, "end_time": 2.0}],
        chords=[{"start": 0.0, "end": 2.0, "chord": "C"}],
    )
    res = client.get(f"/api/project/{pid}/export/chord-sheet?semitones={invalid_semitones}")
    assert res.status_code == 422, (
        f"Expected 422 for semitones={invalid_semitones}, got {res.status_code}"
    )


def test_key_signature_projection_in_header(client):
    """Verify circle-of-fifths key projection updates key signature in header when transposed."""
    lines = [{"id": 1, "text": "Key test", "start_time": 0.0, "end_time": 2.0}]
    chords = [{"start": 0.0, "end": 2.0, "chord": "F"}]

    pid = create_mock_project(
        title="Key Projection",
        estimated_key="F Major",
        lines=lines,
        chords=chords,
    )

    # Transposing F Major by +2 semitones yields G Major
    res = client.get(f"/api/project/{pid}/export/chord-sheet?semitones=2")
    assert res.status_code == 200
    assert "**Key:** G Major (Transposed from F Major)" in res.text
    # F + 2 semitones = G
    assert "G" in res.text


# ==============================================================================
# SECTION 4: EDGE CASES & RESILIENCE
# ==============================================================================


def test_export_empty_project_returns_400(client):
    """Verify exporting a project with no lyrics and no chords returns HTTP 400."""
    pid = create_mock_project(title="Empty Project", lines=[], chords=[])
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 400
    assert "Project has no lyric lines or chords to export" in res.json().get("detail", "")


def test_export_nonexistent_project_returns_404(client):
    """Verify querying an unknown project ID returns HTTP 404."""
    res = client.get("/api/project/nonexistent_project_id_12345/export/chord-sheet")
    assert res.status_code == 404


def test_export_lyrics_only_without_chords(client):
    """Verify project with lyrics but no chords generates clean lyric sheet without crashing."""
    lines = [
        {"id": 1, "text": "A cappella intro line", "start_time": 1.0, "end_time": 4.0},
        {"id": 2, "text": "A cappella second line", "start_time": 5.0, "end_time": 8.0},
    ]
    pid = create_mock_project(title="A Cappella", lines=lines, chords=[])
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    body = res.text
    assert "A cappella intro line" in body
    assert "A cappella second line" in body
    assert "[00:01.00]  A cappella intro line" in body


def test_complex_chords_transposition_with_bass_notes(client):
    """Verify complex chords (maj7, m7, slash chords) transpose correctly."""
    lines = [{"id": 1, "text": "Complex jazz chords", "start_time": 0.0, "end_time": 4.0}]
    chords = [
        {"start": 0.0, "end": 2.0, "chord": "Cmaj7"},
        {"start": 2.0, "end": 4.0, "chord": "C/G"},
    ]
    pid = create_mock_project(title="Jazz Chords", lines=lines, chords=chords)

    # Transpose by +2 semitones:
    # Cmaj7 -> Dmaj7
    # C/G -> D/A
    res = client.get(f"/api/project/{pid}/export/chord-sheet?semitones=2")
    assert res.status_code == 200
    body = res.text
    assert "Dmaj7" in body
    assert "D/A" in body


def test_multibyte_unicode_lyrics_alignment(client):
    """Verify non-ASCII / CJK lyrics align correctly with chord symbols without crashing."""
    text = "沈むように 溶けてゆくように"
    words = [
        {"word": "沈むように", "start_time": 0.0, "end_time": 2.0},
        {"word": "溶けてゆくように", "start_time": 2.0, "end_time": 4.0},
    ]
    lines = [{"id": 1, "text": text, "start_time": 0.0, "end_time": 4.0, "words": words}]
    chords = [
        {"start": 0.0, "end": 2.0, "chord": "F#m"},
        {"start": 2.0, "end": 4.0, "chord": "G#m"},
    ]
    pid = create_mock_project(title="夜に駆ける", artist="YOASOBI", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    assert "F#m" in res.text
    assert "G#m" in res.text
    assert text in res.text


def test_large_song_stress_scalability(client):
    """Stress test with 500 lines and 2,000 chords to verify sub-second completion and linear scaling."""
    import time

    lines = []
    chords = []
    for i in range(500):
        t0 = float(i * 2.0)
        t1 = t0 + 1.8
        lines.append(
            {
                "id": i,
                "text": f"This is lyric line number {i} for high volume stress testing",
                "start_time": t0,
                "end_time": t1,
                "words": [
                    {"word": "This", "start_time": t0, "end_time": t0 + 0.3},
                    {"word": "is", "start_time": t0 + 0.3, "end_time": t0 + 0.6},
                    {"word": "lyric", "start_time": t0 + 0.6, "end_time": t0 + 0.9},
                    {"word": "line", "start_time": t0 + 0.9, "end_time": t0 + 1.2},
                    {"word": "number", "start_time": t0 + 1.2, "end_time": t0 + 1.5},
                ],
            }
        )
    for j in range(2000):
        t0 = float(j * 0.5)
        t1 = t0 + 0.5
        chords.append(
            {
                "start": t0,
                "end": t1,
                "chord": ["C", "Am", "F", "G7"][j % 4],
            }
        )

    pid = create_mock_project(title="Scale Stress Song", lines=lines, chords=chords)
    t_start = time.perf_counter()
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    elapsed = time.perf_counter() - t_start

    assert res.status_code == 200
    assert elapsed < 1.0, f"Expected 500 lines / 2000 chords export in < 1.0s, took {elapsed:.3f}s"
    assert "This is lyric line number 499" in res.text


def test_zero_duration_and_out_of_order_chords_graceful(client):
    """Verify zero-duration or out-of-order chords are sorted and handled without crash."""
    lines = [{"id": 1, "text": "Testing stability", "start_time": 2.0, "end_time": 5.0}]
    chords = [
        {"start": 4.0, "end": 4.0, "chord": "G"},  # 0 duration
        {"start": 1.0, "end": 2.0, "chord": "C"},  # before line
        {"start": 2.5, "end": 3.5, "chord": "Am"},  # during line
        {"start": 6.0, "end": 8.0, "chord": "F"},  # after line (outro)
    ]
    pid = create_mock_project(title="Order & Zero Duration", lines=lines, chords=chords)
    res = client.get(f"/api/project/{pid}/export/chord-sheet")
    assert res.status_code == 200
    assert "Testing stability" in res.text
