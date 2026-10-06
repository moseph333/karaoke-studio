import pytest
from backend.services.youtube_uploader import YouTubeMetadataService

def test_generate_youtube_package():
    sample_lines = [
        {"id": 0, "text": "First line of the song", "start_time": 5.0, "end_time": 9.0},
        {"id": 1, "text": "Second line of the song", "start_time": 10.0, "end_time": 14.0}
    ]

    pkg = YouTubeMetadataService.generate_youtube_package(
        title="Bohemian Rhapsody",
        artist="Queen",
        lines=sample_lines,
        semitones=2,
        has_guide_vocal=True
    )

    assert "Queen - Bohemian Rhapsody (Karaoke Version" in pkg["title"]
    assert "+2 Semitones" in pkg["key_note"]
    assert "Instrumental with Backing/Guide" in pkg["description"]
    assert "00:05 - Lyrics Start" in pkg["description"]
    assert "First line of the song" in pkg["lyrics"]
    assert "karaoke" in pkg["tags"]
    assert "queen" in pkg["tags"]
