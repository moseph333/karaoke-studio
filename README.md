# Karaoke Studio

Local-first audio workstation for stem separation, acoustic word alignment, timeline lyric synchronization, and 1080p lyric video rendering.

![Karaoke Studio Interface](docs/karaoke-preview.png)

## Features

- **Audio intake**: upload local tracks (`.mp3`, `.wav`, `.flac`) or ingest audio streams via `yt-dlp`.
- **Project library search, filter, sort & lifecycle**: instant client-side search (by title, artist, or creator), status filtering (`All`, `Ready`, `In Progress / Error`), sorting (`Recent`, `Title A–Z`, `Artist A–Z`), metadata editing (`title` and `artist`), and project deletion with automatic cancellation of in-flight jobs and full disk cleanup across `downloads/`, `stems/`, and `output/`.
- **Stem separation, vocal range & harmonic chord analysis**: Demucs isolates `vocals.wav` and `instrumental.wav` (supporting direct uploads for official backing tracks), the **Vocal Range Analyzer & Smart Key Recommender** extracts $F_0$ pitch bounds (`Hz` and scientific pitch notation like `G3`–`C5`), comfortable tessitura, and estimated musical key to recommend and apply an optimal semitone shift (`-12` to `+12`) for standard voice types (Bass to Soprano) or custom note ranges, and the **Harmonic Chord Progression Detector** extracts time-aligned chord segments (`Major`, `Minor`, `7`, `maj7`, `m7`) from `instrumental.wav` with key-aware circle-of-fifths transposition.
- **Lyric sync, multi-stage fallback retrieval & in-studio hot-swapping**: normalizes noisy track/artist metadata (remasters, soundtrack tags, featured artists, swapped `Artist - Title`), executes a 6-stage fallback search ladder across LRCLIB and `syncedlyrics` with token-set similarity, completeness, and duration-proximity candidate ranking, cross-checks fetched LRC timestamps against isolated vocal audio via FFT cross-correlation to recover global timing offsets and reject mismatched candidates, accepts custom text and `.lrc` timestamps, and supports in-studio lyric replacement and acoustic realignment without re-running stem separation.
- **Acoustic phrase & spectral word alignment**: snaps synced LRC line starts and releases to true vocal phrase boundaries (trimming trailing $\ge 1.0\text{s}$ instrumental gaps while preserving sustained notes), partitions untimed plain lyrics across detected vocal phrases while preserving intros, bridges ($\ge 1.5\text{s}$), and outros, and computes sub-line word boundaries using vocal-band ($200\text{--}4500\text{Hz}$) STFT log-magnitude spectral flux, voiced harmonic autocorrelation gating (suppressing breath noise and percussive bleed), and syllable-aware dynamic programming.
- **Timeline editor, duet part assignment & power tools**: 50-step Undo/Redo history (`Ctrl+Z` / `Ctrl+Y`), **Duet / Multi-Singer Part Assignment** (`Singer 1 / Lead`, `Singer 2 / Partner`, `Both / Unison`) with per-line cycling, bulk range/alternating patterns, and pause-clustering auto-split, batch timestamp offset shifting (across all lines or from the selected line onward), live Line and Word Tap-to-Sync (`T`) beat stamping during playback, inline lyric text and chord cue editing, line insertion and deletion with automatic monotonic word-level timing recalculation, interactive waveform scrubbing, ±0.2s line nudging, and dirty-state discard protection.
- **Studio mixing & playback speed**: interactive audio/vocal waveform scrubber, variable playback speed (`0.5x`–`1.5x`) for practicing or fine-tuning sync, semitone pitch shifting (-12 to +12) without tempo change, master volume and mute controls, and 0% to 50% guide vocal blending.
- **Fullscreen TV Stage Mode, live transposing chord bar, beat visualizer, gap countdowns & custom theme engine**: Fullscreen stage mode (`F`) with auto-hiding floating playback controls, selectable **Word Sweep** or **Line-by-Line** lyric sync display modes, toggleable **Live Transposing Chord Bar** (`C`) with active chord highlighting and upcoming chord previews, toggleable 60fps canvas **Beat-Reactive Audio Visualizer** (`V`), automatic **Instrumental Gap Countdown** progress bars and upcoming-singer lead-in cues during intros and bridges ($\ge 4.0\text{s}$), distinct multi-singer duet colors and badges, an application-wide **UI Theme Picker** with four human-crafted themes (**Punk Rock / Underground / DIY**, **Analog 70s Tape Studio**, **Dive Bar CRT KTV**, **Brutalist / Clean Paper Studio**) synchronized with eight visual stage presets, custom sung/unsung color pickers, adjustable lyric font scaling (`0.75x`–`1.5x`), custom video/image backgrounds, auto-blurred album art, and 16:9 widescreen or 9:16 vertical outputs.
- **Keyboard navigation & in-app help**: transport and studio shortcuts (`Space`, `←`, `→`, `M`, `F`, `V`, `C`, `T`, `Ctrl+Z`, `Ctrl+Y`) and `?` hotkey for the accessible In-App Help & Studio Usage Guide modal, plus styled contextual tooltips with hotkey badges across studio controls.
- **Export kit, direct audio stems, chord sheets & standalone subtitles**: direct 1-click downloads for isolated audio stems (`instrumental.wav`, `vocals.wav`, and pitch-shifted `master.wav`), 1-click downloadable **Chord & Lyric Sheets** (`.txt` / `.md`), instant standalone `.lrc` and `.ass` synchronized subtitle downloads (including optional transposed chord cues, multi-singer duet styles, instrumental gap countdown cues, custom colors, font scaling, `1920x1080` / `1080x1920` resolution, and selectable progressive `\kf` word sweep or instant full-line highlight modes) without waiting for a video render, plus full 1080p60 MP4 renders with optional composited beat-reactive audio visualizers and chord overlays, 320 kbps AAC audio, and YouTube metadata packages.
- **Resilience & accessibility**: comprehensive error boundaries with audio auto-recovery, in-app toast alerts, and accessible focus traps for modal dialogs.
- **Responsive mobile & tablet studio**: adaptive layouts down to 320px–375px viewports with touch-sized (`>=44px`) transport/mixing/library controls, 2-row mobile lyric timeline nudging, and live 16:9 widescreen / 9:16 vertical Shorts previews.
- **Access control & worker concurrency**: HMAC-SHA256 signed session tokens with `HttpOnly` cookies, sliding-window login rate limiting (`429 Too Many Requests`), and bounded background worker semaphores (`MAX_CONCURRENT_JOBS`) that queue excess pipeline and render jobs without deadlock.

## Keyboard Shortcuts & Studio Controls

The studio provides keyboard shortcuts for playback navigation and precision editing controls. Global shortcuts are isolated and automatically ignored while typing in text inputs or navigating active modal dialogs.

| Shortcut / Control | Type | Description |
| :--- | :--- | :--- |
| <kbd>Space</kbd> | Shortcut | Toggle master audio playback / pause |
| <kbd>←</kbd> (Left Arrow) | Shortcut | Seek backward 5 seconds in timeline playback |
| <kbd>→</kbd> (Right Arrow) | Shortcut | Seek forward 5 seconds in timeline playback |
| <kbd>M</kbd> / <kbd>m</kbd> | Shortcut | Toggle audio mute / unmute |
| <kbd>F</kbd> / <kbd>f</kbd> | Shortcut | Toggle Fullscreen TV Stage Mode with auto-hiding floating controls |
| <kbd>V</kbd> / <kbd>v</kbd> | Shortcut | Toggle 60fps Beat-Reactive Audio Visualizer in Studio and TV Stage Mode |
| <kbd>C</kbd> / <kbd>c</kbd> | Shortcut | Toggle Live Transposing Chord Bar in Studio and TV Stage Mode |
| <kbd>T</kbd> / <kbd>t</kbd> | Shortcut | Stamp current playback timestamp onto target line or word during Tap-to-Sync mode |
| <kbd>Ctrl+Z</kbd> / <kbd>Cmd+Z</kbd> | Shortcut | Undo most recent lyric timeline or chord edit (up to 50 steps) |
| <kbd>Ctrl+Y</kbd> / <kbd>Cmd+Shift+Z</kbd> | Shortcut | Redo previously undone lyric timeline or chord edit |
| <kbd>?</kbd> | Shortcut | Toggle in-app Help & Studio Usage Guide |
| **Waveform Scrubber** | Control | Interactive audio/vocal energy waveform with click-and-drag seeking |
| **Playback Speed** | Control | Variable speed selector (`0.5x`, `0.75x`, `1.0x`, `1.25x`, `1.5x`) synchronized with lyric sweeps |
| **Master Volume** | Control | Linear volume slider (0%–100%) and mute toggle for studio monitoring |
| **Pitch Shift & Smart Key** | Control | Stepper (-12 to +12 semitones) and Vocal Range / Smart Key Recommender for voice presets or custom note ranges |
| **Live Transposing Chord Bar** | Control | Beat-synchronized chord progression ribbon with dynamic key transposition, click-to-seek, and inline chord editing |
| **Guide Vocal** | Control | Blend slider from 0% to 50% vocal volume over instrumental backing tracks |
| **Duet / Multi-Singer Split** | Control | Per-line singer role cycling (`Singer 1`, `Singer 2`, `Both`) and bulk/auto duet split modal |
| **Batch Offset & Tap-to-Sync** | Control | Shift all or selected-onward lyric timestamps by a custom delta, or tap live with the beat in Line or Word sync mode |
| **In-Studio Lyric Re-Import** | Control | Replace lyrics via custom text/LRC or re-query LRCLIB and realign word timings in-place |
| **Timeline Nudging** | Control | Stepper buttons to shift line start and end timestamps in ±0.2-second increments |
| **Inline Line Editing** | Control | Edit lyric line text, insert lines above/below/end, or delete lines with automatic word-token timing recalculation |
| **Theme Picker, Word Sweep, Line Sync & Styling** | Control | Application-wide UI theme selector (Punk Rock / DIY, Analog 70s Tape, Dive Bar CRT KTV, Clean Paper Studio) synchronized with stage presets, selectable word sweep or line sync, $\ge 4.0\text{s}$ gap countdowns, custom colors, and font scaling (`0.75x`–`1.5x`) |
| **Modal Focus Traps** | Accessibility | Keyboard focus looping (`Tab`, `Shift+Tab`) and `Escape` dismiss for Auth, Metadata, Delete, Export, and Help dialogs |

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

## Quality Tooling & Verification

Karaoke Studio maintains strict quality gates across both backend and frontend layers.

### Backend Testing and Linters

All backend tests and linters use Python 3.12+ inside the project virtual environment:

```bash
# Run pytest with code coverage (4,528 unit, integration, E2E, and adversarial tests)
pytest

# Check code formatting with Ruff
ruff format --check backend

# Run Ruff linter checks
ruff check backend

# Auto-format Python source files
ruff format backend

# Auto-fix fixable Ruff linter warnings
ruff check --fix backend
```

Configuration files:
- `pyproject.toml`: Ruff lint/format rules and pytest-cov settings
- `pytest.ini`: pytest test discovery, warning filters, and coverage flags

### Frontend Testing and Linters

Frontend quality tools run from the `frontend/` directory:

```bash
cd frontend

# Run Vitest unit, component, and responsive layout tests (1,649 tests across 78 test suites)
npm test

# Run Vitest in interactive watch mode
npm run test:watch

# Run ESLint (zero-warning policy enforced)
npm run lint

# Check code formatting with Prettier
npm run format:check

# Auto-format frontend code with Prettier
npm run format

# Run TypeScript type check (tsc) and production bundle build (Vite)
npm run build
```

### Continuous Integration (CI)

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and pull request targeting `main`. It executes parallel matrix jobs:
- **Backend Quality Gates**: Ubuntu runner, Python 3.12, FFmpeg + libass, `ruff check`, `ruff format --check`, and full `pytest` suite.
- **Frontend Quality Gates**: Ubuntu runner, Node 20, `npm run lint`, `npm run format:check`, `npm test` (Vitest), and `npm run build` (TypeScript + Vite).

## Configuration

Copy `.env.example` to `.env` to customize settings:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port for the web interface and FastAPI server |
| `APP_PASSWORD` | *(empty)* | Passphrase required to log in (issues HMAC-SHA256 session tokens & `HttpOnly` cookies). Leave empty for open access. |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` | `5` | Maximum failed login attempts per client IP within the rate-limit window before returning HTTP `429`. |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `60.0` | Sliding window duration (in seconds) for failed login attempt rate limiting. |
| `MAX_CONCURRENT_JOBS` | `2` | Maximum simultaneous background processing/rendering worker slots before queueing additional jobs. |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(empty)* | Zero Trust tunnel token for routing a custom domain to Docker. |
| `KARAOKE_DATA_DIR` | `./workspace_data` | Directory for downloaded audio, stems, and rendered videos. |

## System Requirements

- **Operating system**: Linux, macOS, or Windows (WSL2 recommended)
- **Python**: 3.10 or higher (Python 3.12 recommended)
- **Node.js**: 18 or higher
- **FFmpeg**: compiled with `libass` support (required for subtitle burning)
- **Disk space**: at least 5 GB free for Demucs model weights and audio workfiles

## Architecture & Engineering Highlights

Karaoke Studio was engineered as a high-concurrency, local-first media workstation:

- **Modular Backend Architecture**: FastAPI backend decomposed into single-responsibility routers (`routers/auth`, `routers/projects`, `routers/uploads`, `routers/exports`) and service layers (`services/separator`, `services/vocal_analyzer`, `services/lyrics`, `services/aligner`, `services/audio_mixer`, `services/video_renderer`, `services/ass_generator`), backed by bounded worker semaphores (`MAX_CONCURRENT_JOBS`) and cancelable thread execution.
- **Modular Frontend Architecture**: React 18 single-page application structured into focused subcomponent hierarchies (`components/audio/`, `components/export/`, `components/timeline/`, `components/track-search/`, `BeatVisualizer`) and custom hooks (`useKeyboardShortcuts`, `useFocusTrap`, `useInterpolatedTime`, `useLyricEditorState`, `useTapCursorHistory`, `useTimelineAutoScroll`, `useStudioAudio`).
- **Audio DSP Pipeline**: Demucs v4 (Hybrid Transformer) stem isolation combined with FFT cross-correlation global offset recovery, vocal phrase onset/release boundary snapping, and vocal-band spectral flux + voiced harmonic autocorrelation gating with syllable-aware dynamic programming for sub-line word alignment, plus FFT-accelerated YIN $F_0$ pitch tracking and Krumhansl-Schmuckler chroma key & harmonic chord detection for vocal range analysis and smart key transposition.
- **Video Rendering Engine**: Native FFmpeg filtergraphs with `libass` compositing to burn dynamic progressive wipe karaoke styles, multi-singer duet themes, $\ge 4.0\text{s}$ instrumental gap countdowns, and optional beat-reactive audio visualizers directly into 1080p60 MP4 with 320 kbps AAC audio.
- **Fault-Tolerant Storage**: Atomic JSON persistence with automated backup recovery to guard against state corruption during sudden shutdowns.
- **Modern Interface**: React 18, Tailwind CSS, Lucide icons, contextual tooltips with hotkey badges, and Wavesurfer.js audio scrubbers for interactive timeline editing.

For a comprehensive architectural guide covering decomposed backend routers, media processing pipelines, frontend state architecture, and test suite organization, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Development & AI Assistance

Code generation, test suites, and refactors were iteratively produced using LLMs under direct engineering oversight. System architecture, product requirements, homelab infrastructure deployment, and real-world failure triage—including FFmpeg stream deadlocks, YouTube rate limits, and pipeline concurrency—were driven, tested, and validated by the maintainer.

## Maintenance & Support

This repository is maintained as an open-source portfolio and personal showcase project. It is provided **"as-is"** without dedicated commercial support or SLAs. Upstream dependencies (such as YouTube stream extractors or external lyric APIs) may require periodic updates if upstream platforms alter their signatures.

## Legal & Fair-Use Disclaimer

Karaoke Studio is intended strictly for personal, educational, and fair-use audio exploration, practice, and amateur karaoke production using locally owned media or authorized streams. The authors do not encourage or condone copyright infringement. Users are solely responsible for ensuring compliance with all applicable copyright laws and third-party terms of service.

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE). Any derivative network services or distributions must provide corresponding source code under the same license terms.
