import os
import numpy as np
import soundfile as sf
import subprocess
from backend.services.audio_mixer import AudioMixer
from backend.services.video_renderer import VideoRenderer

def test_audio_mixer_and_video_render(tmp_path):
    sr = 44100
    duration = 3.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    
    # Generate 440Hz sine wave (A4)
    sine_inst = 0.5 * np.sin(2 * np.pi * 440 * t)
    # Generate 880Hz sine wave (vocals)
    sine_voc = 0.3 * np.sin(2 * np.pi * 880 * t)

    inst_wav = tmp_path / "inst.wav"
    voc_wav = tmp_path / "voc.wav"
    sf.write(str(inst_wav), sine_inst, sr)
    sf.write(str(voc_wav), sine_voc, sr)

    # 1. Test AudioMixer
    mixer = AudioMixer(output_dir=tmp_path)
    mixed_path = mixer.mix_and_shift(
        instrumental_path=str(inst_wav),
        vocals_path=str(voc_wav),
        semitones=2,
        guide_volume=0.2,
        output_filename="test_mixed.wav"
    )
    assert os.path.exists(mixed_path)
    mixed_data, mixed_sr = sf.read(mixed_path)
    assert mixed_sr == 44100
    assert len(mixed_data) > 0

    # 2. Test VideoRenderer end-to-end with ASS subtitle overlay
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "test.ass"
    renderer.generate_ass_subtitles(
        lines=[
            {
                "id": 0,
                "text": "Hello Karaoke",
                "start_time": 0.5,
                "end_time": 2.5,
                "words": [
                    {"word": "Hello", "start_time": 0.5, "end_time": 1.5},
                    {"word": "Karaoke", "start_time": 1.5, "end_time": 2.5},
                ]
            }
        ],
        output_ass_path=ass_path
    )

    mp4_out = tmp_path / "test_karaoke.mp4"
    rendered_file = renderer.render_video(
        audio_path=mixed_path,
        ass_subtitles_path=str(ass_path),
        output_mp4_path=mp4_out,
        title="Test Track",
        artist="Test Artist"
    )

    assert os.path.exists(rendered_file)
    assert os.path.getsize(rendered_file) > 1000

    # Verify video properties using ffprobe
    probe_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate",
        "-of", "csv=s=x:p=0",
        str(rendered_file)
    ]
    probe_res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, text=True)
    assert "1920x1080" in probe_res.stdout
