import numpy as np
import soundfile as sf
from backend.services.aligner import AudioAligner

def test_align_lyrics_with_audio(tmp_path):
    sr = 44100
    duration = 6.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    
    # Simulate vocals burst between 1.0s and 4.0s
    vocals = np.zeros_like(t)
    active_mask = (t >= 1.0) & (t <= 4.0)
    vocals[active_mask] = 0.5 * np.sin(2 * np.pi * 500 * t[active_mask])

    vocals_file = tmp_path / "vocals_sim.wav"
    sf.write(str(vocals_file), vocals, sr)

    aligner = AudioAligner()
    raw_lines = [
        {
            "id": 0,
            "text": "Sing a song for me",
            "start_time": 1.0,
            "end_time": 4.0,
            "words": []
        }
    ]

    aligned = aligner.align_lyrics(str(vocals_file), raw_lines)
    assert len(aligned) == 1
    assert len(aligned[0]["words"]) == 5
    
    # Check that word boundaries are strictly monotonic
    words = aligned[0]["words"]
    for i in range(len(words)):
        assert words[i]["start_time"] < words[i]["end_time"]
        if i + 1 < len(words):
            assert words[i]["end_time"] <= words[i + 1]["start_time"] + 0.05
