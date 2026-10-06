# YouTube Karaoke Studio

An AI-powered web studio to generate high-definition karaoke tracks ready for YouTube upload directly from YouTube Music URLs or search queries.

![Karaoke Studio Interface](https://raw.githubusercontent.com/antigravity/assets/main/karaoke-preview.png)

## Features

- **Source Sourcing**: Search any song or paste a direct YouTube / YouTube Music URL using `yt-dlp`.
- **Vocal & Stem Isolation**: Demucs AI stem separation separates isolated `vocals.wav` and `instrumental.wav`. Also supports uploading your own official instrumental backing track.
- **Synced Lyrics Acquisition**: Automatically queries the open LRCLIB database and `syncedlyrics` for timecoded lyrics, with optional custom lyrics input.
- **Forced Word-by-Word Alignment**: Acoustic energy and envelope alignment calculates exact word-level start and end timestamps.
- **Interactive Timeline Editor**:
  - Live audio scrubbing and word boundary editing.
  - Word wipe preview with real-time progressive color fill.
  - 3-2-1 visual countdown cue dots before vocal entries.
  - Line nudging (-0.2s / +0.2s) for instant beat alignment.
- **Studio Audio Mixing**:
  - Pitch transposition: Shift key up or down by semitones (`-12` to `+12`) without affecting tempo.
  - Guide vocal blend: Blend subtle vocal levels (0% to 50%) into the instrumental track.
- **Theme & Video Customizer**:
  - Presets: Modern Gold, Cyber Cyan, Neon Sunset, Classic KTV Blue/Yellow.
  - Custom background video or image upload, or auto-generated dynamic blurred album art background.
  - 16:9 Widescreen (YouTube standard) and 9:16 Vertical (YouTube Shorts).
- **YouTube Metadata & Export Kit**:
  - High-bitrate 1080p60 MP4 with AAC 320kbps audio.
  - 1-Click Copy formatted YouTube Title, Description with chapter timestamps & lyric sheet, and SEO Tags.

## Quick Start

### 1. Launch with Single Command

```bash
./run.sh
```

This script will verify FFmpeg, check dependencies, build the frontend if needed, start the FastAPI server at `http://localhost:8000`, and open your browser automatically.

### 2. Manual Start

**Backend**:
```bash
./venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend (Development mode)**:
```bash
cd frontend
npm run dev
```

## System Requirements

- **OS**: Linux / macOS / Windows
- **Python**: 3.10+ (Recommended: Python 3.12)
- **Node.js**: 18+
- **FFmpeg**: Required with `libass` support (standard on modern Linux distributions).
