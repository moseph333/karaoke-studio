import pytest
from backend.services.lyrics import LyricsService

SAMPLE_LRC = """[00:04.20]First line of the song
[00:08.50]Second line with more words
[00:14.00]Final chorus line
"""

def test_parse_lrc():
    lines = LyricsService.parse_lrc(SAMPLE_LRC)
    assert len(lines) == 3
    
    # First line checks
    assert lines[0]["text"] == "First line of the song"
    assert lines[0]["start_time"] == 4.2
    assert lines[0]["end_time"] == 8.5
    assert len(lines[0]["words"]) == 5
    assert lines[0]["words"][0]["word"] == "First"
    assert lines[0]["words"][0]["start_time"] == 4.2

    # Second line checks
    assert lines[1]["text"] == "Second line with more words"
    assert lines[1]["start_time"] == 8.5
    assert lines[1]["end_time"] == 14.0

    # Ensure each word has start_time <= end_time
    for line in lines:
        for w in line["words"]:
            assert w["start_time"] <= w["end_time"]

def test_parse_plain_text():
    text = "Hello world\nThis is a karaoke test"
    lines = LyricsService.parse_plain_text(text)
    assert len(lines) == 2
    assert lines[0]["text"] == "Hello world"
    assert len(lines[0]["words"]) == 2
    assert lines[1]["text"] == "This is a karaoke test"


def test_update_lyrics_endpoint_validation(client):
    from backend.main import projects
    proj_id = "test_lyric_schema"
    projects[proj_id] = {"id": proj_id, "lines": []}

    # Valid schema payload
    valid_payload = {
        "lines": [
            {
                "id": 1,
                "text": "Hello world",
                "start_time": 1.0,
                "end_time": 3.0,
                "words": [
                    {"word": "Hello", "start_time": 1.0, "end_time": 1.8},
                    {"word": "world", "start_time": 2.0, "end_time": 3.0}
                ]
            }
        ]
    }
    res = client.post(f"/api/project/{proj_id}/lyrics", json=valid_payload)
    assert res.status_code == 200
    assert res.json()["lines_count"] == 1
    assert projects[proj_id]["lines"][0]["text"] == "Hello world"

    # Invalid schema payload (missing required start_time and text)
    invalid_payload = {
        "lines": [
            {"id": 1}
        ]
    }
    bad_res = client.post(f"/api/project/{proj_id}/lyrics", json=invalid_payload)
    assert bad_res.status_code == 422  # Pydantic validation failure
