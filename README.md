# Karaoke Studio

Local-first web app for splitting songs into vocal and instrumental stems, syncing lyrics down to the word, practicing or performing on a live stage, and exporting 1080p karaoke videos.

![Karaoke Studio Interface](docs/karaoke-preview.png)

## What It Does

- **Audio & Stem Separation**: Upload local audio (`.mp3`, `.wav`, `.flac`), drop in existing backing tracks, or pull audio via `yt-dlp`. Uses Demucs to split `vocals.wav` and `instrumental.wav`.
- **Pitch, Tempo & Key Matching**: Shift key (`-12` to `+12` semitones) and playback speed (`0.5x`–`1.5x`) independently, blend 0%–50% guide vocals, or use the **Smart Key Recommender** to match a song's vocal range to your voice.
- **Lyric Fetching & Word Alignment**: Automatically searches LRCLIB and `syncedlyrics` (or accepts pasted text / `.lrc` files) and aligns lines and individual words to the isolated vocal track.
- **Timeline Editor**: Fine-tune timing with 50-step Undo/Redo, live Tap-to-Sync (`T`), batch timestamp offsets, ±0.2s nudging, inline word/chord editing, and duet role assignment (`Singer 1`, `Singer 2`, `Both`).
- **Live Stage & Themes**: Fullscreen TV stage (`F`) with **Word Sweep** or **Line-by-Line** lyric display, instrumental gap countdowns, optional 60fps beat visualizer (`V`), transposing chord bar (`C`), and 4 built-in themes (**Basement Flyer**, **Reel-to-Reel '74**, **Midnight KTV Booth**, and **Monolith Press**).
- **Exports**: One-click downloads for isolated WAV stems, chord & lyric sheets, standalone `.lrc` and `.ass` subtitle files, or 1080p60 MP4 videos (16:9 widescreen or 9:16 vertical Shorts).

## Quick Start

### 1. One-Command Local Launch

```bash
./run.sh
```

Checks FFmpeg, creates the Python virtual environment, builds the frontend if needed, starts FastAPI on port `8000`, and opens your browser.

### 2. Docker Compose

```bash
docker compose up -d
```

To expose the app through a Cloudflare Tunnel, set `CLOUDFLARE_TUNNEL_TOKEN` in `.env` and run:

```bash
docker compose --profile tunnel up -d
```

### 3. Manual Dev Setup

```bash
# Backend (port 8000)
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (proxies API requests to localhost:8000)
cd frontend
npm install
npm run dev
```

## Keyboard Shortcuts

Shortcuts are disabled automatically while typing in inputs or modal dialogs.

| Key | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Play / pause audio |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek backward / forward 5 seconds |
| <kbd>M</kbd> | Mute / unmute audio |
| <kbd>F</kbd> | Toggle Fullscreen TV Stage Mode |
| <kbd>V</kbd> | Toggle beat-reactive audio visualizer |
| <kbd>C</kbd> | Toggle live transposing chord bar |
| <kbd>T</kbd> | Stamp current timestamp during Tap-to-Sync |
| <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> | Undo / redo timeline or chord edits |
| <kbd>?</kbd> | Open the in-app help guide |

## Configuration

Copy `.env.example` to `.env` to customize settings:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port for the web UI and FastAPI server |
| `APP_PASSWORD` | *(empty)* | Optional login passphrase (`HttpOnly` cookie session). Leave blank for open local access. |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max failed login attempts per IP before returning HTTP `429` |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `60.0` | Rate-limit window in seconds |
| `MAX_CONCURRENT_JOBS` | `2` | Max simultaneous stem separation / video render jobs |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(empty)* | Cloudflare Zero Trust tunnel token (Docker `--profile tunnel`) |
| `KARAOKE_DATA_DIR` | `./workspace_data` | Storage directory for audio, stems, and rendered videos |

## System Requirements

- **OS**: Linux, macOS, or Windows (WSL2)
- **Python**: 3.10+ (3.12 recommended)
- **Node.js**: 18+
- **FFmpeg**: compiled with `libass` support (for burning subtitles into MP4s)
- **Disk space**: ~5 GB free for Demucs weights and working audio files

## Tests & Architecture

```bash
# Backend tests & linter
pytest
ruff check backend && ruff format --check backend

# Frontend tests, linter & production build
cd frontend
npm test && npm run lint && npm run build
```

For details on the backend routers, DSP alignment pipeline, and frontend state hooks, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License & Disclaimer

For personal, educational, and fair-use audio practice with media you own or have permission to use. Provided as-is under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
