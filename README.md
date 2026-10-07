# YouTube Karaoke Studio

Web studio for turning YouTube songs into 1080p karaoke videos with synchronized lyrics, pitch shifting, and YouTube-ready metadata.

![Karaoke Studio Interface](https://raw.githubusercontent.com/antigravity/assets/main/karaoke-preview.png)

## Features

- **Audio intake**: search song titles or paste YouTube / YouTube Music links using `yt-dlp`.
- **Stem separation**: Demucs isolates `vocals.wav` and `instrumental.wav`. Supports direct uploads for official backing tracks.
- **Lyric sync**: pulls timecoded lyrics from LRCLIB and `syncedlyrics`, or accepts custom text.
- **Word alignment**: calculates word-level boundaries using acoustic energy and envelope detection.
- **Timeline editor**: audio scrubbing, boundary trimming, progressive wipe previews, 3-2-1 visual countdown dots, and +/-0.2s line nudging.
- **Studio mixing**: semitone pitch shifting (-12 to +12) without tempo change, and 0% to 50% guide vocal blending.
- **Themes and styling**: four presets (Modern Gold, Cyber Cyan, Neon Sunset, Classic KTV), custom video/image backgrounds, auto-blurred album art, and 16:9 widescreen or 9:16 vertical outputs.
- **Export kit**: 1080p60 MP4 with 320 kbps AAC audio, plus formatted titles, description timestamps, lyric sheets, and tags ready for YouTube upload.
- **Access control**: optional password protection for hosted sessions and LAN parties.

## Quick Start

### Option 1: Automatic local launch

Run the startup script:

```bash
./run.sh
```

The script verifies FFmpeg, sets up the Python virtual environment, builds the frontend if needed, starts the FastAPI server on port 8000, and opens your browser.

### Option 2: Docker Compose

Start the studio container:

```bash
docker compose up -d
```

To expose the studio via an existing Cloudflare Tunnel, set `CLOUDFLARE_TUNNEL_TOKEN` in your `.env` file and start with the tunnel profile:

```bash
docker compose --profile tunnel up -d
```

### Option 3: Manual development setup

1. Install backend dependencies and start the API:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

2. Start the Vite development server:

```bash
cd frontend
npm install
npm run dev
```

The frontend development server proxies API requests to `http://localhost:8000`.

## Configuration

Copy `.env.example` to `.env` to customize settings:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port for the web interface and FastAPI server |
| `APP_PASSWORD` | *(empty)* | Passphrase required to log in. Leave empty for open access. |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(empty)* | Zero Trust tunnel token for routing a custom domain to Docker. |
| `KARAOKE_DATA_DIR` | `./workspace_data` | Directory for downloaded audio, stems, and rendered videos. |

## System Requirements

- **Operating system**: Linux, macOS, or Windows (WSL2 recommended)
- **Python**: 3.10 or higher (Python 3.12 recommended)
- **Node.js**: 18 or higher
- **FFmpeg**: compiled with `libass` support (required for subtitle burning)
- **Disk space**: at least 5 GB free for Demucs model weights and audio workfiles

