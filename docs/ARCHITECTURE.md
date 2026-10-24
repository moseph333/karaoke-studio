# Karaoke Studio Architecture & Engineering Guide

Karaoke Studio is a local-first audio workstation engineered for high-concurrency stem separation, acoustic word alignment, interactive timeline lyric synchronization, and 1080p60 lyric video rendering. This document provides a comprehensive technical overview of system architecture, modular backend and frontend boundaries, request lifecycles, background worker pipelines, state management, and test suite organization.

---

## 1. System Overview & Technology Stack

Karaoke Studio combines an asynchronous Python backend built on **FastAPI** with a single-page application (SPA) built with **React 18**, **TypeScript**, and **Tailwind CSS**.

```
+---------------------------------------------------------------------------------+
|                                 Browser Client                                  |
|  React 18 + TypeScript + Tailwind CSS + Wavesurfer.js + Lucide Icons            |
|  [TrackSearch] <---> [AudioControls] <---> [LyricTimelineEditor] <---> [Modals] |
+---------------------------------------+-----------------------------------------+
                                        | HTTP / REST + Static Media Streaming
                                        v
+---------------------------------------------------------------------------------+
|                               FastAPI Backend                                   |
|  backend/main.py (<300 lines) -> Routers: auth, projects, uploads, exports      |
|  Middlewares: CORS, Security Headers, Rate Limiting, Session Auth               |
+-------------------+-----------------------------+-------------------------------+
                    |                             |
                    v                             v
+---------------------------------------+  +--------------------------------------+
|       Domain & Service Layer          |  |       Concurrency & Persistence      |
| - AudioSeparator (Demucs v4)          |  | - MAX_CONCURRENT_JOBS Semaphore      |
| - VocalAnalyzer (YIN F0 / Key Detect) |  | - Cancelable Thread Execution        |
| - LyricsService (LRCLIB, LRC Parser)  |  | - Atomic JSON Store (projects.json)  |
| - AudioAligner (Envelope Detection)   |  | - Backup Recovery (.bak file)        |
| - AudioMixer (FFmpeg DSP Pitch/Blend) |  | - Atomic Disk Cleanup on Deletion    |
| - VideoRenderer (libass / FFmpeg)     |  +--------------------------------------+
+---------------------------------------+
```

### Core Technologies
- **Backend**: Python 3.10+ / 3.12, FastAPI, Uvicorn, Pydantic v2, `psutil`.
- **Media DSP & Synthesis**: FFmpeg (with `libass` compiled), Demucs v4 (Hybrid Transformer), `yt-dlp`, `syncedlyrics`, `numpy`, `scipy`.
- **Frontend**: React 18, TypeScript 5, Vite, Tailwind CSS, Wavesurfer.js, Lucide React.
- **Verification Tooling**: Vitest, React Testing Library, `pytest`, `pytest-cov`, Ruff, ESLint, Prettier.

### Repository Layout
```
├── backend/
│   ├── main.py                     # Entry point & lifespan (<300 lines)
│   ├── config.py                   # Environment configuration & constants
│   ├── schemas.py                  # Pydantic data models & request/response schemas
│   ├── auth.py                     # HMAC session auth & sliding-window rate limiting
│   ├── project_store.py            # Atomic JSON persistence & backup recovery
│   ├── pipeline.py                 # Asynchronous track intake & processing pipeline
│   ├── render_worker.py            # Asynchronous video render worker
│   ├── upload_utils.py             # Magic-byte validation & upload helpers
│   ├── export_utils.py             # RFC 5987 / 6266 Content-Disposition & header helpers
│   ├── routers/                    # Decomposed API route controllers
│   │   ├── auth.py                 # Login, session validation, logout
│   │   ├── projects.py             # Project CRUD, vocal range, smart key, metadata, deletion cleanup
│   │   ├── uploads.py              # Track intake, local audio upload, background uploads
│   │   └── exports.py              # Standalone .lrc / .ass exports, YouTube SEO kits
│   ├── services/                   # Media processing & domain services
│   │   ├── separator.py            # Demucs v4 stem isolation & pipe buffering
│   │   ├── vocal_analyzer.py       # YIN F0 pitch tracking, chroma key detection & smart key recommender
│   │   ├── chord_detector.py       # Harmonic chord progression extraction & transposition
│   │   ├── lyrics.py               # Multi-stage query normalization, candidate scoring, LRCLIB & LRC parsing
│   │   ├── aligner.py              # FFT offset recovery, phrase boundary snapping, spectral flux & harmonic DP word alignment
│   │   ├── audio_mixer.py          # FFmpeg pitch transposition & guide vocal blend
│   │   ├── video_renderer.py       # FFmpeg video muxing, visualizer compositing & background loop
│   │   ├── ass_generator.py        # SubStation Alpha (\kf, multi-singer duet, gap countdown) script generation
│   │   ├── downloader.py           # yt-dlp stream extraction & metadata retrieval
│   │   └── youtube_uploader.py     # YouTube SEO metadata package generation
│   └── tests/                      # Python test suites (unit, integration, E2E tiers)
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # Root coordinator (<450 lines)
│   │   ├── types.ts                # TypeScript domain models & interfaces
│   │   ├── api.ts                  # REST API client & auth event bus
│   │   ├── components/             # Modular React UI components
│   │   │   ├── TrackSearch.tsx     # Intake coordinator
│   │   │   │   └── track-search/   # ProjectLibrary.tsx (search/filter/sort), LocalAudioUploader.tsx
│   │   │   ├── AudioControls.tsx   # Master transport coordinator
│   │   │   │   └── audio/          # WaveformScrubber, PlaybackSpeed, Volume, Pitch, GuideVocal, VocalRangeRecommenderModal, MixActions, ErrorBanner
│   │   │   ├── LyricTimelineEditor # Interactive timeline coordinator
│   │   │   │   └── timeline/       # LineCard, ExpandedWordEditor, DuetAssignmentModal, BatchOffsetModal, TapToSyncBanner, LyricReplacementModal, TimelineModals
│   │   │   ├── ExportModal.tsx     # Export coordinator
│   │   │   │   └── export/         # ExportAudioSection.tsx, ExportSubtitleSection.tsx, ExportYouTubeKit.tsx
│   │   │   ├── BeatVisualizer.tsx  # 60fps HTML5 Canvas & Web Audio AnalyserNode beat visualizer [V]
│   │   │   ├── VisualThemePicker   # Visual preset, custom color/font scale & background picker
│   │   │   ├── HelpModal.tsx       # In-app help & keyboard shortcuts guide
│   │   │   ├── ProcessingView.tsx  # Pipeline progress view
│   │   │   ├── StudioHeader.tsx    # App navigation bar
│   │   │   ├── StudioMetaHeader.tsx# Project metadata breadcrumb & edit controls
│   │   │   ├── StudioModals.tsx    # Global modal dialog container
│   │   │   ├── LyricDisplay.tsx    # Live synchronized karaoke lyric display, Duet badges, Gap Countdown & Fullscreen TV Stage Mode
│   │   │   ├── Tooltip.tsx         # Accessible hover/focus tooltips with hotkey badges
│   │   │   ├── ErrorBoundary.tsx   # React error boundary with auto-recovery
│   │   │   └── Toast.tsx           # Toast alert system
│   │   ├── hooks/                  # Custom React hooks
│   │   │   ├── useKeyboardShortcuts# Global & modal keyboard shortcuts (Space, ←/→, M, F, V, ?)
│   │   │   ├── useFocusTrap.ts     # Accessible modal focus trapping
│   │   │   ├── useToast.tsx        # Toast notifications queue
│   │   │   ├── useInterpolatedTime # 60fps RAF audio playback time sync (playbackRate-aware)
│   │   │   ├── useLyricEditorState # Timeline line/word editing, duet assignment, batch offset, tap-to-sync & dirty state
│   │   │   ├── useLyricHistory.ts  # 50-step bounded Undo/Redo history stack (Ctrl+Z / Ctrl+Y)
│   │   │   ├── useTapCursorHistory # Line & Word Tap-to-Sync cursor state, 50-step history & T hotkey
│   │   │   ├── useVisualTheme.ts   # Theme presets, custom sung/unsung color overrides & font scaling
│   │   │   ├── useStudioAudio.ts   # Audio transport, playback speed, volume, mute & Web Audio AnalyserNode state
│   │   │   ├── useStudioAuth.ts    # Authentication state & session tokens
│   │   │   └── useTimelineAutoScroll# Smooth active-word auto-scrolling
│   │   ├── utils/                  # Pure domain utilities (lyrics.ts, tapSync.ts, vocalRange.ts, gapDetection.ts, volumeStorage.ts, audioErrors.ts)
│   │   └── tests/                  # Vitest component & responsive test suites (63 suites)
├── docs/                           # Architectural guides & previews
└── workspace_data/                 # Local data directory (downloads, stems, output)
```

---

## 2. Backend Architecture

The backend was refactored from a monolithic entry point into modular, single-responsibility components adhering strictly to bounded file size guardrails (<=300 lines for `main.py`, <=500 lines for all service and router modules).

### Application Entry Point (`backend/main.py`)
- **FastAPI Lifespan Context**: Initializes data directories (`downloads/`, `stems/`, `output/`, `temp/`), loads projects from disk on startup, and gracefully shuts down running workers.
- **Middleware Chain**:
  1. `SecurityHeadersMiddleware`: Injects defensive HTTP security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`).
  2. `CORSMiddleware`: Permits controlled cross-origin requests for local development.
  3. `SessionAuthMiddleware`: Inspects inbound requests across 5 auth vectors (`X-Session-Token`, `X-App-Password`, `Authorization: Bearer`, and cookies `session_token` / `karaoke_token`).
- **Global Exception Handlers**: Translates validation errors into structured HTTP 422 JSON responses with sanitized details.
- **Static Mounts**: Serves static media artifacts (`/downloads`, `/stems`, `/output`) and SPA frontend bundles.

### Modular Routers (`backend/routers/`)
1. **`routers/auth.py`**:
   - `POST /api/auth/login`: Authenticates passphrase against `APP_PASSWORD`. On success, issues HMAC-SHA256 signed session token and sets `HttpOnly` cookie. Enforces sliding-window rate limiting (`LOGIN_RATE_LIMIT_MAX_ATTEMPTS` per `LOGIN_RATE_LIMIT_WINDOW_SECONDS`), returning HTTP 429 when exceeded.
   - `GET /api/auth/status`: Reports authentication mode (`is_authenticated`, `requires_auth`, `configured`).
   - `POST /api/auth/logout`: Clears session cookies.
2. **`routers/projects.py`**:
   - `GET /api/projects`: Lists projects with optional user scoping (`scope=my` or `scope=all`).
   - `GET /api/project/{project_id}`: Retrieves single project state and metadata.
   - `GET /api/project/{project_id}/vocal-range` & `POST /api/project/{project_id}/vocal-range`: Computes or returns cached vocal pitch bounds (`Hz` and scientific pitch notation), tessitura, and estimated key from `vocals.wav`, auto-backfilling existing projects without repeating stem separation.
   - `POST /api/project/{project_id}/recommend-key`: Calculates the cost-minimizing integer semitone offset (`[-12, +12]`) to fit a track's vocal range into a target voice preset or custom note range.
   - `PATCH /api/project/{project_id}/metadata`: Persists title and artist updates atomically to `projects.json`.
   - `DELETE /api/project/{project_id}`: Cancels in-flight pipeline or render jobs, removes project and alias entries from `projects.json`, and performs atomic disk cleanup of all audio, stem, and video artifacts across storage directories.
   - `POST /api/project/{project_id}/lyrics`: Saves edited lyric lines, word tokens, and multi-singer duet assignments (`singer1`, `singer2`, `both`).
   - `POST /api/project/{project_id}/realign-lyrics`: Replaces project lyrics via custom text/LRC or re-queries LRCLIB, re-running acoustic word alignment against existing `vocals.wav` without repeating stem separation.
   - `POST /api/project/{project_id}/mix`: Adjusts pitch shift (-12 to +12 semitones) and guide vocal blend (0% to 50%).
   - `POST /api/project/{project_id}/render`: Queues 1080p60 MP4 video synthesis (supporting aspect ratio, custom theme/colors/font scale, instrumental gap countdown cues, and optional composited beat-reactive audio visualizer).
   - `POST /api/project/{project_id}/cancel`: Halts active processing or rendering jobs.
3. **`routers/uploads.py`**:
   - `POST /api/process`: Ingests YouTube URLs or 11-character video IDs.
   - `POST /api/upload-audio`: Ingests local audio files (`.mp3`, `.wav`, `.flac`), validating magic bytes and size limits.
   - `POST /api/upload-background`: Ingests static images (`.jpg`, `.png`, `.webp`) and custom videos (`.mp4`, `.webm`) for video backgrounds.
   - `GET /api/search`: Queries YouTube tracks via `yt-dlp`.
4. **`routers/exports.py`**:
   - `GET /api/project/{project_id}/export/lrc`: Generates standalone `.lrc` subtitle downloads with UTF-8 RFC 5987 headers.
   - `GET /api/project/{project_id}/export/ass`: Generates SubStation Alpha `.ass` karaoke subtitle files formatted with active visual theme styles, multi-singer duet styles (`KaraokeLineX_Singer2`, `KaraokeLineX_Both`), instrumental gap countdown cues, custom colors, font size scale, and resolution.
   - `GET /api/project/{project_id}/export/audio/{stem}`: Streams direct audio downloads (`instrumental`, `vocals`, or `master`) with RFC 5987 `Content-Disposition` headers.
   - `GET /api/project/{project_id}/youtube-kit`: Generates YouTube SEO metadata packages (title, description, tags, timecoded chapters).

### Domain Modules & Services
- **`backend/project_store.py`**: Thread-safe persistence using `threading.Lock`. Writes are executed atomically by writing to `projects.json.tmp` followed by atomic filesystem replacement (`os.replace`). Creates automated backups in `projects.json.bak` to ensure self-healing recovery if disk corruption occurs.
- **`backend/pipeline.py`**: Manages the sequential track processing lifecycle in background worker threads, executing:
  `queued` -> `downloading` -> `separating` -> `aligning` (including vocal range & key extraction) -> `ready` (or `error`).
- **`backend/render_worker.py`**: Dispatches video rendering jobs guarded by `MAX_CONCURRENT_JOBS` concurrency semaphores.
- **`services/separator.py` (`AudioSeparator`)**: Wraps Demucs v4 CLI with non-blocking pipe draining to avoid OS subprocess buffer deadlocks. Cleans up intermediate model artifacts (`htdemucs/`) on exit or failure.
- **`services/vocal_analyzer.py` (`VocalAnalyzer`)**: Performs FFT-accelerated YIN $F_0$ pitch detection with cumulative mean normalization and parabolic interpolation to extract lowest/highest notes, median note, 10th–90th percentile tessitura, and Krumhansl-Schmuckler 12-bin chroma key correlation, plus cost-minimizing semitone transposition recommendations for voice presets (`bass` through `soprano`) or custom note ranges.
- **`services/lyrics.py` (`LyricsNormalizer`, `LyricsService`)**: Normalizes noisy track/artist metadata (soundtrack/remaster tags, featured artists, unbalanced brackets, swapped `Artist - Title`), executes a 6-stage query fallback ladder against LRCLIB and `syncedlyrics`, ranks candidates by token-set/sequence similarity, line completeness, and duration proximity, and parses LRC timestamps (`[mm:ss.xx]`) and plain text tokens.
- **`services/aligner.py` (`AudioAligner`)**: Verifies LRC candidates and recovers global timing offsets via zero-mean Pearson FFT cross-correlation with 3-point parabolic interpolation, snaps synced line starts and releases to vocal phrase boundaries while trimming $\ge 1.0\text{s}$ trailing instrumental gaps, partitions untimed plain lyrics across detected vocal phrases (preserving $\ge 1.5\text{s}$ interludes), and computes sub-line word boundaries via vocal-band ($200\text{--}4500\text{Hz}$) STFT log-magnitude spectral flux, voiced harmonic autocorrelation gating, and syllable-aware dynamic programming while enforcing strict monotonic non-overlapping invariants.
- **`services/audio_mixer.py` (`AudioMixer`)**: Uses FFmpeg `asetrate` / `aresample` filters to shift pitch by semitones without modifying playback tempo, and blends guide vocals over backing tracks.
- **`services/ass_generator.py`**: Formats Advanced SubStation Alpha scripts with progressive `\kf` syllable wipes, 6 multi-singer duet styles (`KaraokeLineX_Singer1`, `KaraokeLineX_Singer2`, `KaraokeLineX_Both`), `KaraokeCountdown` cues for intro and inter-line gaps ($\ge 4.0\text{s}$), visual color themes, CSS-to-ASS color conversion, font size scaling, and aspect ratio scaling (`1920x1080` for 16:9, `1080x1920` for 9:16).
- **`services/video_renderer.py` (`VideoRenderer`)**: Executes FFmpeg filtergraphs burning ASS subtitles and optional beat-reactive frequency visualizers onto looped background videos or scaled images, encoding 1080p60 MP4 with 320 kbps AAC audio.

---

## 3. Frontend Architecture

The frontend follows a component hierarchy with specialized subdirectories, decoupled custom hooks, and strict accessibility standards.

```
frontend/src/
├── App.tsx
│   ├── StudioHeader (Navbar, User Profile, Help '?' trigger)
│   ├── TrackSearch (Landing & Intake)
│   │   ├── ProjectLibrary (Search, status filter, sort, edit metadata, delete)
│   │   └── LocalAudioUploader (Local audio file drag-and-drop intake)
│   ├── ProcessingView (Active job progress & error states)
│   ├── Studio Workspace
│   │   ├── StudioMetaHeader (Track title, artist, back button, edit)
│   │   ├── AudioControls (Playback transport)
│   │   │   ├── WaveformScrubber (Interactive SVG waveform & click/drag seek)
│   │   │   ├── PlaybackSpeedControl (0.5x..1.5x variable speed selector)
│   │   │   ├── MasterVolumeControl (Volume slider & mute)
│   │   │   ├── PitchTranspositionControl (-12..+12 semitones & Smart Key trigger)
│   │   │   ├── VocalRangeRecommenderModal (Detected vocal range/key, voice presets & 1-click shift)
│   │   │   ├── GuideVocalControl (0%..50% blend)
│   │   │   ├── AudioMixActionsBar (Apply mix, reset)
│   │   │   └── AudioPlaybackErrorBanner (Auto-recovery banner)
│   │   ├── VisualThemePicker (Preset themes, custom sung/unsung colors, font scaling, Custom BG)
│   │   ├── LyricTimelineEditor (Word-by-word editor & power tools)
│   │   │   ├── TimelineLineCard (2-row mobile layout, ±0.2s nudge, singer cycle, edit text, delete)
│   │   │   ├── ExpandedWordEditor (Sub-line word timing editor)
│   │   │   ├── DuetAssignmentModal (Range, alternating, and pause-clustering auto-split duet assignment)
│   │   │   ├── BatchOffsetModal (Shift all or selected-onward timestamps)
│   │   │   ├── TapToSyncBanner (Live line & word beat-stamping mode [T])
│   │   │   ├── LyricReplacementModal (In-studio LRC/text upload & LRCLIB re-query)
│   │   │   └── TimelineModals (Insert line modal, discard confirmation)
│   │   ├── LyricDisplay (Live karaoke lyric sweep, Duet badges, Gap Countdown & Fullscreen TV Stage Mode [F])
│   │   │   └── BeatVisualizer (60fps HTML5 Canvas & Web Audio AnalyserNode frequency visualizer [V])
│   │   └── Tooltip (Accessible hover/focus tooltips with <kbd> hotkey badges)
│   └── StudioModals (Global dialog manager)
│       ├── AuthModal (Password login)
│       ├── ExportModal (MP4 render, visualizer/countdown toggles, stem downloads, .lrc/.ass downloads, YouTube kit)
│       │   ├── ExportAudioSection (Direct instrumental, vocals, and master audio downloads)
│       │   ├── ExportSubtitleSection (.lrc / .ass instant export buttons)
│       │   └── ExportYouTubeKit (SEO title, description, tags, chapters)
│       ├── HelpModal (In-app usage guide & keyboard shortcuts reference)
│       ├── EditMetadataModal (Inline title & artist editing)
│       └── DeleteConfirmModal (Project deletion confirmation)
```

### State Management & Custom Hooks (`frontend/src/hooks/`)
- **`useKeyboardShortcuts`**: Manages global hotkeys:
  - <kbd>Space</kbd>: Play / pause master audio.
  - <kbd>←</kbd> / <kbd>→</kbd>: Seek backward / forward 5 seconds.
  - <kbd>M</kbd>: Mute / unmute audio.
  - <kbd>F</kbd>: Toggle Fullscreen TV Stage Mode.
  - <kbd>V</kbd>: Toggle Beat-Reactive Audio Visualizer (with explicit `!e.shiftKey` modifier guard).
  - <kbd>?</kbd> (<kbd>Shift</kbd>+<kbd>/</kbd>): Toggle In-App Help & Usage Guide modal.
  - Hotkeys are isolated: automatically disabled when focus is inside text inputs (`<input>`, `<textarea>`, `<select>`, `contenteditable`) or when any modal dialog is open.
- **`useFocusTrap`**: Implements WAI-ARIA dialog focus trapping. Loops <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> within active modal boundaries, restores previous focus on close, and dismisses on <kbd>Escape</kbd>.
- **`useToast`**: Thread-safe notification system supporting auto-dismiss timers, manual dismissal, and hover-pause timer suspension.
- **`useInterpolatedTime`**: Runs a `requestAnimationFrame` loop that interpolates audio element `currentTime` (scaled by `playbackRate`) for smooth 60fps lyric sweep highlights without jitter caused by low-frequency `timeupdate` events.
- **`useTimelineAutoScroll`**: Automatically adjusts `scrollTop` to keep the active highlighted lyric line comfortably visible during continuous playback, yielding cleanly to manual user touch or scroll gestures.
- **`useLyricEditorState`**: Tracks dirty state (`isDirty`), line insertions, line deletions, timestamp nudging, per-line and bulk/auto Duet singer role assignments (`singer1`, `singer2`, `both`), batch timestamp offsets, live Line and Word Tap-to-Sync stamping (backed by `utils/tapSync.ts`), and automatic word-level timing recalculation.
- **`useLyricHistory`**: Maintains a bounded 50-step Undo/Redo snapshot history stack with <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> (<kbd>Cmd+Shift+Z</kbd>) keyboard listener integration.
- **`useTapCursorHistory`**: Coordinates Line and Word Tap-to-Sync mode selection, active target line and word cursor coordinates, a synchronized 50-step Undo/Redo cursor history stack, and isolated <kbd>T</kbd> hotkey handling.
- **`useVisualTheme`**: Manages visual theme selection, custom sung/unsung hex color overrides, and lyric font size scaling (`0.75x`–`1.5x`).
- **`useStudioAudio`**: Coordinates audio playback transport, variable `playbackRate` (`0.5x`–`1.5x`), volume clamping, mute state persistence in `localStorage`, and Web Audio `AnalyserNode` binding (`WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>`) for the 60fps `BeatVisualizer`.
- **`useStudioAuth`**: Manages session token storage, HTTP header injection, and broadcasts unauthorized events (`AUTH_UNAUTHORIZED_EVENT`) to trigger the login modal upon session expiry.

---

## 4. Request Lifecycle & Background Worker Pipeline

### 4.1 Audio Intake, Stem Separation & Vocal Range Analysis
1. **Intake Trigger**: User provides a YouTube URL/ID via `TrackSearch` or uploads a local `.mp3`/`.wav`/`.flac` file via `LocalAudioUploader`.
2. **Validation**: The backend validates URL format or verifies container magic bytes (e.g. `RIFF` for WAV, `ID3` for MP3, `fLaC` for FLAC) and enforces size ceilings (HTTP 413).
3. **Queueing**: Project record is created in `projects.json` with status `"queued"`. A background worker acquires a slot in `MAX_CONCURRENT_JOBS`.
4. **Stem Separation**: Demucs v4 runs in a subprocess to separate audio into `vocals.wav` and `instrumental.wav`. Non-blocking pipe buffering prevents OS deadlock.
5. **Lyric Ingestion & Candidate Verification**: `LyricsService` normalizes metadata and queries LRCLIB / `syncedlyrics` across a 6-stage fallback ladder, ranking candidates by similarity, completeness, and duration proximity.
6. **Acoustic Alignment, Vocal Range & Chord Analysis**: `AudioAligner` cross-checks LRC timestamps via FFT cross-correlation to recover global timing offsets, snaps line boundaries to vocal phrase onsets/releases (or partitions untimed lines across detected phrases), and aligns sub-line words via spectral flux, voiced harmonic gating, and syllable-aware dynamic programming, while `VocalAnalyzer` and `ChordDetector` extract $F_0$ pitch bounds, tessitura, musical key, and time-aligned chord progressions.
7. **Master Mix**: Initial master audio is synthesized, and project status transitions to `"ready"`.

### 4.2 Interactive Editing, Duet Assignment, Smart Key & Subtitle Export
1. **Interactive Nudging, Duet Split & Power Tools**: The user adjusts line timings in `LyricTimelineEditor`, cycles or bulk-assigns singer roles (`singer1`, `singer2`, `both`) via `DuetAssignmentModal`, uses Undo/Redo, shifts lines in bulk via `BatchOffsetModal`, stamps lines or words live during playback with `TapToSyncBanner`, replaces/realigns lyrics via `LyricReplacementModal`, or applies an optimal semitone transposition via `VocalRangeRecommenderModal`.
2. **Instant Audio & Subtitle Downloads**: The user opens `ExportModal` to download isolated audio stems (`instrumental.wav`, `vocals.wav`, `master.wav`) or standalone `.lrc` and `.ass` subtitles:
   - Backend formats subtitle content dynamically from active project lines.
   - For `.ass`, active theme colors (or custom sung/unsung overrides), multi-singer duet styles (`KaraokeLineX_Singer2`, `KaraokeLineX_Both`), $\ge 4.0\text{s}$ instrumental gap countdown cues, font size scaling, and resolution (`1920x1080` or `1080x1920`) are burned into `[V4+ Styles]` and `[Events]`.
   - Files download immediately with RFC 5987 / 6266 UTF-8 headers without requiring a video render.

### 4.3 1080p60 Video Rendering
1. **Render Request**: The user selects an aspect ratio (`16:9` widescreen or `9:16` vertical Shorts), visual preset / background, and optional countdown / beat-reactive visualizer flags.
2. **Worker Concurrency**: Job enters `"queued"` state until a worker slot is available.
3. **ASS Synthesis**: `ass_generator.py` generates the subtitle script with `\kf` karaoke wipe tags, multi-singer styles, and instrumental gap countdown events.
4. **FFmpeg Multiplexing**: FFmpeg composites the audio, background image/video loop, optional beat-reactive frequency visualizer overlay, and ASS subtitles into an MP4 container with H.264 video and 320 kbps AAC audio.
5. **Completion**: Verified with `ffprobe`, status becomes `"completed"`, and output is ready for download.

---

## 5. Testing Architecture & Quality Methodology

Karaoke Studio employs an **opaque-box, requirements-driven testing philosophy** to rigorously validate user-facing behavior, API interface contracts, and media processing pipelines without coupling tests to internal private functions.

### Core Testing Principles
1. **Opaque-Box Contract Verification**: Assertions originate strictly from public HTTP endpoints, API schemas, and DOM interfaces.
2. **Hermetic & Deterministic Execution**: External network interactions (`yt-dlp` YouTube extraction and LRCLIB lyric queries) are intercepted by deterministic mock fixtures in `conftest.py`. No live internet connection is required.
3. **Real Media Processing**: While heavy AI inference (Demucs) and internet downloads are mocked with instantaneous synthetic audio generators, **real audio filters and video rendering engines (FFmpeg, ASS subtitle synthesis, YIN $F_0$ pitch analysis, acoustic envelope analysis)** execute on actual valid WAV audio and PNG/JPEG visual assets.
4. **Adversarial Resilience & Defensive Validation**: Boundary tests actively stress the system with invalid parameters, out-of-range semitones, 0-byte files, oversized payloads (HTTP 413), malformed URLs, Unicode/CJK/emoji text, and concurrent multithreaded writes.

### Backend Test Architecture

The backend test suite is organized into domain unit/integration suites and a 5-tier E2E testing framework (4,528 total tests):

```
backend/tests/
├── conftest.py                             # Root fixtures, client setup, synthetic assets
├── test_adversarial_ass_countdown.py       # Adversarial ASS gap countdown & boundary tests
├── test_adversarial_r1_lyrics.py           # Adversarial multi-stage lyric query & scoring tests
├── test_aligner.py                         # Acoustic phrase snapping & spectral word alignment tests
├── test_aligner_benchmark.py               # Global offset, phrase boundary & syllable MAE benchmarks
├── test_aligner_m3_adversarial.py          # Line boundary snapping & untimed phrase adversarial tests
├── test_aligner_m4_adversarial.py          # Spectral flux & voiced harmonic gating adversarial tests
├── test_api_boundary_fuzzing.py            # HTTP boundary input fuzzing (mix, intake, lyrics)
├── test_api_routes.py                      # Comprehensive API route contract tests
├── test_api_vocal_range.py                 # Vocal range API, auto-backfill & key recommender tests
├── test_audio_stem_exports.py              # Direct audio stem download routes & header tests
├── test_auth_and_scoping.py                # Session authentication & user scoping tests
├── test_auth_security_adversarial.py       # HMAC forgery, replay, & brute-force rate limit stress
├── test_backend_adversarial_stress.py      # Adversarial stress for stem exports, realignment & ASS
├── test_challenger2_stress.py              # Adversarial stress for vocal range & key recommendation
├── test_downloader.py                      # yt-dlp wrapper & metadata extraction tests
├── test_e2e_linesync_integration.py        # Cross-layer E2E line-by-line vs word sweep export & render tests
├── test_e2e_lyrics_aligner_sync.py         # 4-tier E2E lyric retrieval & acoustic sync benchmark suite
├── test_line_sync_ass.py                   # Line-by-line vs word sweep ASS generator & export endpoint tests
├── test_lyric_realignment.py               # In-studio lyric replacement & realignment tests
├── test_lyrics.py                          # Multi-stage LRCLIB fallback, candidate ranking & LRC tests
├── test_m2_adversarial.py                  # Multi-singer duet schema, aligner & ASS adversarial tests
├── test_m3_challenger_video_matrix.py      # 16:9 & 9:16 FFmpeg visualizer & countdown matrix tests
├── test_media_subprocess_stress.py         # Subprocess pipe deadlock, timeout & zombie tests
├── test_mixer.py                           # FFmpeg pitch transposition & guide vocal blend tests
├── test_project_lifecycle_adversarial.py   # Path traversal, prefix isolation, & delete race tests
├── test_security_and_storage.py            # Security headers & project store recovery tests
├── test_separator.py                       # Demucs isolation & cache reuse tests
├── test_subtitle_export_adversarial.py     # RFC 5987 headers, centisecond rollover, & export tests
├── test_theme_ass_fuzz.py                  # Fuzzing & boundary stress for theme presets & ASS styles
├── test_theme_export_parity.py             # Stage theme preset & ASS export parity tests
├── test_theme_styling.py                   # Custom hex-to-ASS color, duet styles & font scaling tests
├── test_tier5_adversarial_final_1.py       # Tier 5 adversarial stress for lyric normalization & aligner
├── test_tier5_adversarial_final_2.py       # Tier 5 adversarial stress for spectral DP & boundary invariants
├── test_video_renderer.py                  # FFmpeg video muxing, visualizer & ASS burning tests
├── test_vocal_analyzer.py                  # YIN F0 pitch tracking, chroma key & preset unit tests
├── test_vocal_analyzer_adversarial.py      # Silent, unvoiced, NaN/Inf & extreme pitch boundary tests
├── test_worker_concurrency.py              # Worker semaphore queueing & slot release tests
├── test_worker_concurrency_stress.py       # 20-thread concurrency & worker stress tests
├── test_youtube.py                         # YouTube URL validation & ID extraction tests
└── e2e/                                    # 5-Tier End-to-End Suite
    ├── conftest.py                         # Hermetic mocks, synthetic WAV/PNG generators
    ├── test_e2e_tier1_features.py          # Tier 1: Core Feature Coverage (>=5 tests per feature)
    ├── test_e2e_tier2_boundaries.py        # Tier 2: Boundary & Corner Cases (>=5 tests per feature)
    ├── test_e2e_tier3_pairwise.py          # Tier 3: Cross-Feature Pairwise Combinations
    ├── test_e2e_tier4_scenarios.py         # Tier 4: Real-World User Workflow Scenarios
    └── test_e2e_tier5_adversarial_backend.py# Tier 5: White-Box Adversarial Backend Suite
```

#### The 5 E2E Tiers
- **Tier 1: Core Feature Coverage**: Exhaustive verification of standard happy paths across all 8 major application subsystems (Audio Intake, Stem Separation, Lyrics Processing, Timeline Alignment, Audio Mixing, Video Rendering, Security/Auth, Projects Persistence).
- **Tier 2: Boundary & Corner Cases**: Hardens all 8 features against edge inputs, anomalous states, and adversarial attacks (0-byte files, 5000+ char lines, sub-tenth-second audio, extreme pitch shifts, oversized payloads).
- **Tier 3: Cross-Feature Combinations**: Validates pairwise feature interactions and state transitions across subsystem boundaries (e.g. custom lyrics + pitch transposition + video rendering).
- **Tier 4: Canonical Application Scenarios**: Simulates full real-world user workflows:
  1. *Golden Path*: YouTube intake -> stem separation -> lyrics fetch -> alignment -> playback -> 1080p60 MP4 render -> YouTube SEO kit.
  2. *Social Media Creator Studio*: Custom plain text lyrics -> +3 semitones pitch shift & 15% guide vocal -> 1080x1920 background -> timeline nudging -> 9:16 vertical MP4 export.
  3. *Musician Self-Produced Backing Track*: Direct studio WAV upload -> custom lyric submission -> -1 semitone shift -> 1080p60 video export.
  4. *Multi-User Studio Collaboration*: Passphrase gate protection -> Alice and Bob user isolation via `scope=my` -> unauthenticated visitors blocked -> session logout.
  5. *Fault-Tolerant Operator*: Mid-flight intake pipeline cancellation -> restart resilience -> mid-flight render cancellation -> re-render with new styling.
  6. *International Multilingual Production*: Japanese Kanji, Hiragana, English Romaji, and emoji stage cues ("🌸 桜の雨 (Sakura Rain)") -> custom ASS subtitle styling -> UTF-8 preservation -> YouTube metadata kit export.
- **Tier 5: White-Box Adversarial Hardening**: Deep integration stress testing covering pipeline edge conditions, process concurrency, and state machine recovery.

### Frontend Test Architecture

The frontend test suite in `frontend/src/tests/` provides exhaustive component, responsive layout, accessibility, and integration coverage across 78 test modules (1,649 total tests):

```
frontend/src/tests/
├── AppThemeEngine.test.tsx                 # Theme engine tokens, CSS variables, zero-FOUC & persistence
├── AppThemePicker.test.tsx                 # Accessible header theme picker listbox & keyboard navigation
├── AppThemeSystem.test.tsx                 # 4-tier E2E theme system, 4D rubric & stage sync suite
├── AudioControls.test.tsx                  # Transport, pitch stepper, vocal range & guide vocal blend
├── AuthModal.test.tsx                      # Login modal form, error state, password submission
├── BeatVisualizer.test.tsx                 # 60fps canvas visualizer, AnalyserNode & V hotkey tests
├── Challenger2Stress.test.tsx              # Vocal range & Smart Key UI stress & responsive tests
├── ErrorBoundary.test.tsx                  # React error boundary fallback rendering
├── ExportAudioSection.test.tsx             # Direct instrumental, vocals, and master audio downloads
├── ExportModal.test.tsx                    # Render triggers, visualizer/countdown flags, subtitle downloads
├── FullscreenStageAndThemes.test.tsx       # Fullscreen TV stage, custom color pickers, font scaling
├── HelpDialogAccessibility.test.tsx        # Help modal ARIA attributes, focus trap, dismiss
├── HelpModal.test.tsx                      # Help modal sections, shortcuts table, usage guide
├── HelpModalShortcutsStress.test.tsx       # Rapid hotkey toggling & input isolation stress
├── LineSyncMode.test.tsx                   # Line-by-line vs word sweep preview, stage & export tests
├── LyricDisplay.test.tsx                   # Synchronized lyric line, duet badges & gap countdown rendering
├── LyricTimelineEditor.test.tsx            # Inline editing, line nudge, singer cycle, dirty state tracking
├── LyricTimelinePowerTools.test.tsx        # Undo/redo stack, batch offset, line/word tap-to-sync, lyric re-import
├── PlaybackSpeedControl.test.tsx           # Variable playback speed (0.5x..1.5x) & radio semantics
├── ProjectLibrarySearchSort.test.tsx       # Library real-time search, status filtering & sorting
├── StudioLifecycle.test.tsx                # App state transitions & project loading
├── ThemePickerAndViews.test.tsx            # Multi-view theme styling across Library, Studio & Modals
├── Toast.test.tsx                          # Toast notification rendering & timers
├── Tooltip.test.tsx                        # Tooltip hover/focus, Escape dismiss, hotkey badges
├── TooltipStress.test.tsx                  # Rapid hover/focus churn & disabled state sync
├── TrackSearch.test.tsx                    # YouTube search, local audio intake, library cards
├── VisualThemeSync.test.tsx                # Bidirectional app-to-stage theme sync & custom overrides
├── VocalRangeRecommenderModal.test.tsx     # Voice presets, custom range & 1-click transposition modal
├── WaveformScrubber.test.tsx               # Interactive waveform rendering & drag seek scrubbing
├── adversarialDuetStress.test.tsx          # Duet bulk/auto-split, undo/redo & 320px touch target stress
├── adversarialGapCountdown.test.tsx        # Gap countdown boundary & playback rate interpolation stress
├── api.test.ts                             # API client, token persistence, error handling
├── appStateTransitions.test.tsx            # View transitions (Landing -> Search -> Processing -> Ready)
├── audioPlaybackAndSync.test.tsx           # Audio volume clamping & RAF interpolation sync
├── errorBoundaryAdversarial.test.tsx       # Thrown non-Error objects & media error translation
├── frontendIntegrationAdversarial.test.tsx # Tier 5 comprehensive white-box integration suite
├── gapDetection.test.ts                    # Intro & inter-line gap (>=4.0s) detection unit tests
├── keyboardAccessibilityShortcuts.test.tsx # Global hotkeys, focus trapping, input isolation
├── layoutGeometryTouchTargets.test.tsx     # Bounding rect assertions & touch target >=44px
├── lyrics.test.ts                          # Word token timing recalculation unit tests
├── lyricsTimingInvariants.test.ts          # Contiguous monotonic non-overlapping invariants
├── m3ChallengerAdversarial.test.tsx        # Visualizer, Shift+V guard & countdown adversarial tests
├── mobileViewportErgonomics.test.tsx       # 320px viewport truncation, hit targets, wrapping
├── modalDialogsResponsive.test.tsx         # Modal dialog responsiveness across breakpoints
├── projectCardModalInteractions.test.tsx   # Card click bubbling isolation & double-click guards
├── responsiveLayout.test.tsx               # Breakpoints (320px, 375px, 768px, 1280px) overflow
├── studioAdversarialStress.test.tsx        # Adversarial boundary stress across R1-R5 upgrades
├── studioControlsTouchErgonomics.test.tsx  # Studio dashboard touch target ergonomics (>=44px)
├── subtitleExportAccessibility.test.tsx    # Subtitle download button accessibility & parameters
├── subtitleExportDownloads.test.tsx        # Simulated blob anchor downloads & DOM cleanup
├── tapSync.test.ts                         # Pure line & word tap-sync engine & monotonic boundary tests
├── timelineAutoScrollAndTouch.test.tsx     # 2-row mobile line cards & auto-scroll sync
├── timelineLineStructureEditing.test.tsx   # Line insertion (above/below) & deletion invariants
├── toastAndAuthAdversarial.test.tsx        # Toast hover-pause & 401 unauthorized bus
├── tooltipAccessibilitySemantics.test.tsx  # WAI-ARIA tooltip semantics & aria-describedby links
├── useFocusTrap.test.tsx                   # Focus loop & restoration unit tests
├── useKeyboardShortcuts.test.ts            # Shortcut listener & input isolation unit tests
├── useProjectPolling.test.ts               # Polling exponential backoff & retry tests
├── useTapCursorHistory.test.ts             # Bounded 50-step tap cursor undo/redo & T hotkey isolation tests
├── vocalRange.test.ts                      # Pitch/MIDI/SPN conversion & transposition unit tests
└── vocalRangeAdversarial.test.ts           # Unvoiced, extreme Hz & custom bound adversarial tests
```

### Quality Gates & Verification Commands

All changes in the repository must pass the full suite of automated quality gates:

```bash
# 1. Backend Verification
./venv/bin/pytest                            # Baseline: >=4,528 passed, 0 failed, >90% coverage
./venv/bin/ruff check backend                # Zero lint violations
./venv/bin/ruff format --check backend       # Zero formatting diffs

# 2. Frontend Verification (inside frontend/)
cd frontend
npm test -- --run                            # Baseline: >=1,649 passed across 78 suites, 0 failed
npm run lint                                 # Zero ESLint warnings
npm run format:check                         # Zero Prettier diffs
npm run build                                # Zero TypeScript or Vite compilation errors
```
