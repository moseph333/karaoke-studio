# Karaoke Studio 2.0: Architecture

This guide explains how Karaoke Studio is put together: the FastAPI backend and its processing pipelines, the background jobs that run on finished songs, the stem separation and lyric sync engines with their worker protocols, and the React frontend with its design system, studio layout and command palette.

---

## 1. Overview

```
┌──────────────────────────────── Browser ────────────────────────────────┐
│ React 18 + TypeScript + Tailwind (token-driven design system)           │
│ Library / Processing / Studio: stage, timeline, inspector, transport    │
│ Command palette · MediaSession · polling (pipeline, render, jobs)       │
└───────────────┬─────────────────────────────────────────┬───────────────┘
                │ REST /api/*                              │ media /static/*
┌───────────────▼─────────────────────────────────────────▼───────────────┐
│ FastAPI (backend/main.py): auth, security headers, CORS, static mounts  │
│ Routers: auth · projects · uploads · exports · quality · system         │
├──────────────────────────────┬──────────────────────────────────────────┤
│ Pipelines & background jobs  │ Services                                 │
│ pipeline.py (intake)         │ separator + presets ──► roformer_worker  │
│ render_worker.py (video)     │ lyric_sync + aligner ─► ctc_align_worker │
│ reseparation.py (stems)      │ lyrics, chord_detector, vocal_analyzer   │
│ realignment.py (lyrics)      │ audio_mixer, video_renderer, ass_generator│
├──────────────────────────────┴──────────────────────────────────────────┤
│ projects.json (atomic writes, .bak recovery) · stems/ output/ downloads/│
│ Model folders: TORCH_HOME · AUDIO_SEPARATOR_MODEL_DIR · ALIGNMENT_MODEL_DIR│
└─────────────────────────────────────────────────────────────────────────┘
```

**Stack.** Python 3.10+ (3.12 recommended), FastAPI, Pydantic v2, numpy/scipy/soundfile, FFmpeg (libass, Rubber Band, alimiter), yt-dlp, syncedlyrics. PyTorch and torchaudio 2.10+ for Demucs and neural alignment; the optional extras in `backend/requirements-ml.txt` add RoFormer separation (`audio-separator`) and text normalisation (`uroman`, `num2words`). Frontend: React 18, TypeScript (strict), Vite, Tailwind CSS, lucide icons, Vitest and React Testing Library.

### Repository layout

```
backend/
  main.py                 app, middleware, static mounts, router wiring, shared singletons
  config.py               paths (KARAOKE_DATA_DIR), auth and job limits, version
  schemas.py              Pydantic request and response models with timing validators
  project_store.py        projects.json persistence, PROJECTS_LOCK, disk cleanup
  project_analysis.py     when chords and the vocal range are detected, the song's key, the YouTube kit
  master_audio.py         mix file names, the mix cache, the streamed master (WAV or AAC)
  shared_assets.py        loads the JSON shared with the frontend (assets/shared)
  pipeline.py             YouTube and upload intake pipelines
  render_worker.py        1080p60 video render job
  background_jobs.py      conflict rules shared by the two jobs below
  reseparation.py         re-make a finished song's stems (separation_job)
  realignment.py          re-time a finished song's lyrics in the background (sync_job)
  routers/                auth, projects, uploads, exports, quality, system
  services/
    separation_presets.py   Fast / Balanced / Best plans, availability, estimates
    separator.py            plan chain with fallback, Demucs and RoFormer runs
    separation_progress.py  progress parsing for both engines
    process_watchdog.py     cancel / timeout / stall watchdog for worker processes
    lyrics.py               LRCLIB, syncedlyrics, LRC and plain-text parsing
    aligner.py              DSP aligner (envelope, phrase snapping, spectral flux words)
    lyric_sync.py           sync orchestrator: DSP pass, neural pass, merge, report
    line_realign.py         re-time one line near its current place
    lyric_tokenize.py       word tokens (mirrors the frontend) and MMS spelling
    alignment_config.py     ALIGNMENT_* settings and neural availability
    sync_confidence.py      per-line confidence from the vocal stem
    capabilities.py         what this server can run (GET /api/capabilities)
    audio_mixer.py          key shift, guide vocal blend, preview vs final quality
    ass_generator.py        SubStation Alpha subtitles (word sweep, duets, countdowns)
    video_renderer.py       FFmpeg video render with bundled fonts
    stage_backgrounds.py    drifting art, aurora and spectrum filter graphs (motion shared with the stage)
    waveform.py             cached waveform peaks for the scrubber
    chord_detector.py, vocal_analyzer.py, downloader.py, youtube_uploader.py
  workers/
    roformer_worker.py      RoFormer separation in its own process
    ctc_align_worker.py     MMS forced alignment in its own process
  tools/                  fetch_models, benchmark_sync, benchmark_separation, seed_demo
  assets/                 bundled theme fonts and their licences; shared/ JSON the frontend imports as @shared
  tests/                  pytest suites, one folder per feature (plus e2e/, helpers/, meta/)
frontend/src/
  App.tsx                 providers + AppContent (library, processing or studio)
  types.ts, api.ts
  theme/                  app themes, stage presets, persisted stage settings
  context/                AppThemeContext
  components/
    ui/                   design-system primitives
    studio/, transport/, stage/, timeline/, audio/, export/, quality/,
    commandPalette/, track-search/ and top-level views and dialogs
  hooks/                  audio, mix, polling, editor, palette, quality and shortcut hooks
  utils/                  pure helpers (format, lyrics, review, quality, manual edits…)
  tests/                  Vitest suites, one folder per feature (plus helpers/, meta/)
docs/                     this guide, screenshots
```

---

## 2. Backend

### 2.1 Application entry point

`backend/main.py` builds the FastAPI app, installs the middleware (security headers, CORS, session authentication), mounts static media and the built frontend, includes the routers, and creates the shared service singletons (`separator`, `aligner`, `audio_mixer`, `lyrics_service`, `video_renderer`, …). Its `lifespan` marks the jobs the previous server process left running as interrupted before the first request (see Cancellation in §2.3) and deletes the half-written videos and scratch mixes of the renders it cut off (see Video in §2.8); a failure there is logged and never stops startup. `logging_setup.configure_logging()` gives the app's own loggers (`karaoke_backend` and `backend.*`) a timestamped stderr handler at INFO (`LOG_LEVEL`), since Uvicorn configures only its own. Tests monkeypatch these singletons, so services are always reached through `backend.main` at call time.

**Authentication.** When `APP_PASSWORD` is set, every `/api/*` request except `GET /api/health` and `/api/auth/*`, and every `/static/*` file, needs a session: an HMAC-signed token from `POST /api/auth/login` (also set as an `HttpOnly` cookie), the `X-App-Password` header, or `Authorization: Bearer`. Without one, `GET /api/health` answers from the cached update status and ignores `check_remote`. Wrong passphrases are rate limited per client IP (`LOGIN_RATE_LIMIT_*`, HTTP 429 with `Retry-After`), whether they arrive at `POST /api/auth/login` or as credentials on any route (`auth.authenticate_request`, used by the middleware, `GET /api/auth/status` and `check_remote`). A wrong value or a token with the wrong signature counts once per window however often it is resent, and a request carrying several credentials has no more new values compared than the window has room for; a token signed with the passphrase but expired, a request with no credential and a valid passphrase sent beside a stale token count nothing. A client IP over the limit gets the 429 before its credentials are compared, on every protected route, so a right guess cannot get through; `/api/auth/status` answers `authenticated: false` instead, and `check_remote` is ignored. These handlers are async, so checking and counting a guess is one step on the event loop. A 401 for cookie credentials also expires both session cookies, so browsers stop resending a stale one. The client IP is the `X-Forwarded-For` entry `FORWARDED_TRUSTED_HOPS` places from the end (default 1: the one the nearest proxy wrote; 2 for cloudflared in front of Nginx Proxy Manager; 0 ignores the header), else the socket address. Keep the app port reachable only through those proxies; a client that connects directly can set the header itself. The same goes for every trusted proxy but the outermost: with 2, a client that reaches Nginx Proxy Manager without passing cloudflared picks its own key, so use 1 if Nginx Proxy Manager also serves clients directly.

**Static media.**

| Mount | Folder | Contents |
| :--- | :--- | :--- |
| `/static/downloads` | `downloads/` | original audio, cover art |
| `/static/stems` | `stems/<track>/` | `vocals.wav`, `instrumental.wav`, `separation.json` (how they were made), custom instrumentals |
| `/static/output` | `output/` | master mixes (and their `.m4a` previews), rendered videos (one per aspect ratio) |
| `/static/backgrounds` | `backgrounds/` | uploaded stage and video backdrops |
| `/` | `frontend/dist` | the built single-page app |

Stem, master and rendered video URLs carry a `?v=` version after a re-separation, remix or new render so browsers never play or download a stale file.

### 2.2 API

| Method and path | Purpose |
| :--- | :--- |
| `GET /api/health`, `POST /api/health`, `POST /api/system/update` | version and update check; the POST forms can start an update and need a session |
| `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` | session handling |
| `GET /api/capabilities` | separation presets and lyric aligner this server can run, with reasons |
| `POST /api/search` | YouTube search |
| `POST /api/process` | start the YouTube pipeline (`separation_quality` optional) |
| `POST /api/upload-track` (alias `/api/upload-audio`) | start the upload pipeline (form field `separation_quality`) |
| `POST /api/upload-instrumental`, `POST /api/upload-background` | custom backing track (header-checked; 409 while the song is still processing), stage backdrop |
| `GET /api/projects`, `GET /api/project/{id}`, `GET /api/project/{id}/status` | library, one song, its progress fields (each settles jobs left by a restart) |
| `PATCH /api/project/{id}`, `POST /api/project/{id}/metadata` | title and artist |
| `POST /api/project/{id}/lyrics` | save edited lines |
| `GET /api/project/{id}/lyrics/candidates` | LRCLIB candidates |
| `POST /api/project/{id}/realign-lyrics` | new lyrics, LRCLIB re-fetch, or current `lines`; `background: true` queues a sync job (202) |
| `POST /api/project/{id}/realign-lyrics/cancel` | cancel the sync job |
| `POST /api/project/{id}/realign-line` | re-time one line; saves nothing |
| `POST /api/project/{id}/reseparate` (202), `…/reseparate/cancel` | re-make stems at another preset |
| `GET`/`POST /api/project/{id}/vocal-range`, `POST …/recommend-key` | vocal range analysis, Smart Key |
| `GET`/`POST /api/project/{id}/chords`, `POST …/chords/detect` | chords (transposed), edits, re-detection |
| `POST /api/project/{id}/mix` | key and guide vocal remix (cached per setting; the song keeps its `MIX_CACHE_PER_SONG` most recently used mixes) |
| `GET /api/project/{id}/waveform` | waveform peaks (`bins`, cached by stem mtime) |
| `GET /api/project/{id}/backdrop` | the cover art as exports draw it (`aspect`, `drift`), PNG cached in the output folder |
| `POST /api/project/{id}/render`, `POST …/cancel-render` | video render |
| `POST /api/render/warmup` | start a cloud CPU ahead of an export (202; nothing happens for local renders) |
| `POST /api/project/{id}/cancel`, `DELETE /api/project/{id}` | cancel processing, delete a song and its files |
| `GET /api/project/{id}/export/{lrc,ass,chord-sheet}`, `…/export/audio/{stem}` | exports |
| `GET /api/project/{id}/youtube-package` | YouTube title, description, tags and chapters |

### 2.3 Persistence and concurrency

- **Store.** Projects live in `projects.json`, written atomically with a `.bak` copy for recovery. All writes take `PROJECTS_LOCK`. A project dict can be replaced by a fresh copy from disk at any time, so background jobs look the project up again before every write instead of keeping a reference.
- **Job slots.** `WORKER_SEMAPHORE` (`MAX_CONCURRENT_JOBS`, default 2) bounds intake pipelines, renders, re-separations and background re-alignments. They start through `background_jobs.run_job`, on threads of their own (`JOB_THREADS`), so jobs waiting for a slot never take the threadpool that request handlers share. `lyric_sync.ALIGN_SEMAPHORE` (`MAX_CONCURRENT_ALIGN_JOBS`, default 1) bounds neural alignment passes, which load a large model: pipelines wait for a slot, while a single-line re-align falls back to DSP when the slot is busy.
- **Cancellation.** `active_cancellations` maps keys to `threading.Event`s: `{id}` (pipeline), `{id}_render`, `{id}_reseparate`, `{id}_sync`. Deleting a song sets all of them, then removes its files, including staged stems. A route registers a job's event before the song shows the job as busy, and every job (intake, render, re-separation, background re-alignment) removes only its own event when it ends (`background_jobs.release_cancel_event`), so a cancel followed at once by a new request keeps the new job's event. The exception is a render requested while a cancelled render is still stopping: it reuses that render's event, already set, instead of getting its own. A job with no event therefore belongs to an earlier server process: at startup and on every read of a song, its status or the library, a busy intake or a `queued` or `rendering` render with no event under the song's id or track_id, or a `queued` or `running` background job with no event under the id, becomes an error, "Interrupted by a server restart". An intake is settled only when its `heartbeat` is also missing or older than this process's start (`background_jobs.PROCESS_STARTED_AT_MS`), which keeps `seed_demo`'s processing song live; renders are settled on the event alone.
- **Disk space.** `save_projects` returns whether it wrote the store. Request handlers that report an edit as saved (lyrics, title and artist, chords, `/mix` and the custom instrumental) call `save_projects(strict=True)` inside `restore_on_failed_save`: a failed write answers 507 (`OSError`, usually a full disk) or 500 (anything else) and puts the edited fields back in memory, so a reload never shows an edit that the next restart would lose; the instrumental upload also puts back the file an earlier upload left at its path. A delete whose save fails removes the song's files, then removes the song again (a reload from disk may have brought it back meanwhile) and retries strictly; a second failure answers 507 saying the files are gone but the library still lists the song. Background and progress saves stay soft: they log the failure, keep the newest state in memory, and count as a write, so throttled progress saves retry about once a second. `ensure_free_space` refuses new work with 507 while the data folder's disk has less than `DISK_MIN_FREE_MB` free (default 1024, 0 turns it off): `/process` (except a song that is already ready or running), the three uploads, `/render` and `/reseparate`, each after its 404, 409 and request checks (an upload's file-content check needs the file, so it comes after). Edits are never blocked, and when the free space cannot be read the request goes through.

### 2.4 Intake pipeline

`pipeline.run_pipeline` (YouTube) and `run_local_pipeline` (upload) move a project through these statuses (the progress bands drive the processing view):

| Status | Progress | Work |
| :--- | :--- | :--- |
| `queued` / `processing` / `downloading` | 5–34 | fetch audio and metadata |
| `separating` | 35–70 | stems at the song's preset (`separate_project_stems`), then vocal range and chords |
| `fetching_lyrics` | 72 | LRCLIB / syncedlyrics, or the custom lyrics |
| `aligning` | 82–91 | `sync_lyrics` (DSP, then neural when available) |
| `mixing` | 92 | first master mix |
| `ready` | 100 | the studio opens |

Status details never contain "chord" or "range" during separation; the processing view uses those words to advance its stepper.

### 2.5 Background jobs on a finished song

Both jobs keep their state on the project (`separation_job`, `sync_job`: `id`, `status` queued/running/done/error/cancelled, `progress`, `detail`, `error`, timestamps), so the studio just polls the project's status (`GET /api/project/{id}/status`). `background_jobs.conflict_reason` stops a job from starting while the other runs or while the song is still processing (409), and a job left `queued` or `running` by a server restart is marked as interrupted at startup and on the next read.

**Re-separation** (`reseparation.py`). Separates into `stems/.staging/<audio_id>/<job>` (progress 0–80), swaps the new stems and their `separation.json` record in with `os.replace` (dated at the swap, so mixes of the old stems are not reused; the record is replaced even on a downgrade), keeps a custom instrumental, refreshes the vocal range, re-detects chords only when asked (or when there are none), optionally re-times the lyrics (kept as they are if someone saves lyrics meanwhile, compared by the same digest as below), and renders a new versioned master mix. A cancelled or failed run leaves the song exactly as it was.

**Background re-alignment** (`realignment.py`). The route works out the lyrics first (so input errors come back as 400s), then queues `sync_lyrics` with the server's configured engine. When it finishes, the lines are stored only if nobody saved other lines meanwhile (a digest of the lines is compared); otherwise the job ends with "your edits were kept". Re-timing existing lines keeps word timing that came with the lyrics file (`align_method: "lrc"`).

### 2.6 Stem separation

**Presets** (`separation_presets.py`):

| Preset | Engine | Models | Parameters |
| :--- | :--- | :--- | :--- |
| `fast` | Demucs | `htdemucs` | `--shifts 1 --overlap 0.25 --int24 --clip-mode clamp` (Demucs 4.1+) |
| `balanced` | RoFormer | `vocals_mel_band_roformer.ckpt` | overlap 2 |
| `best` | RoFormer ensemble | Mel-Band + `model_bs_roformer_ep_317_sdr_12.9755.ckpt` | overlap 4, waveform average |

Availability is decided without importing PyTorch: package metadata (`find_spec`, versions) plus whether the weights are cached or may be downloaded. `separate_stems(audio_path, track_id, model_name, duration, progress_callback, cancel_event)` resolves a preset (or a raw Demucs model name), walks the fallback chain best → balanced → fast, skips plans that cannot run, and falls back on any failure that is not a cancellation. The result includes provenance (`preset`, `engine`, `models`, `label`, `requested`, `fallback_reason`, `elapsed_seconds`, `separated_at`), stored on the project as `separation` and beside the stems as `separation.json` (written to a temp file and moved into place; the old record is removed before new stems replace the old ones). Valid cached stems are reused without running anything when their record's preset ranks at or above the request (`preset_rank`: fast < balanced < best; raw Demucs models rank with Fast), and the reused record reports the new `requested` with no `fallback_reason`. Stems without a record (made before records were kept, or whose record is unreadable) count as Fast, so they are re-separated once when a song is re-processed at Balanced or Best. Below the request only the better presets are tried, and if none of them can run, or all fail, the cached stems are kept with the reasons as `fallback_reason` instead of being replaced by a cheaper fallback (status "Kept the earlier stems").

**Engine processes.** Both engines run as child processes with stdout discarded and stderr parsed line by line (`ProgressTracker`): tqdm bars, model download bars ("Downloading model weights… (N%)") and JSON events. `ProcessWatchdog` terminates (then kills after 10 s) a process that is cancelled, exceeds `SEPARATION_TIMEOUT_SEC`, or prints nothing for `SEPARATION_STALL_SEC`. Errors read "Demucs failed (exit N): …" or "RoFormer separation failed …" with a friendly hint (out of memory, disk full, weights missing) and the last lines of stderr.

**Cloud GPU** (`remote_separation.py`, `gpu/modal_app.py`). With `SEPARATION_REMOTE=modal`, RoFormer plans are spawned on the deployed Modal function instead of a local process. It runs the same worker on the first free GPU (`A10G,L40S,L4,T4` by default, fastest first since billing is per second), keeps weights in the `karaoke-models` volume, and puts a start marker and then the worker's stderr on an ephemeral Modal queue, which feeds the same `ProgressTracker`; the stems come back as the call's result. Availability then means the `modal` client and credentials are present (checked offline). Cancel, `SEPARATION_TIMEOUT_SEC` and `SEPARATION_STALL_SEC` cancel the remote call. If the service is unreachable, or no GPU starts the job within `SEPARATION_REMOTE_QUEUE_SEC`, the job raises `RemoteUnavailable`, the other cloud presets are skipped and Fast runs locally. Time estimates use `REMOTE_REALTIME_FACTORS` plus a fixed 30 s for queueing, start-up and transfers, and capabilities report `runs_on: "cloud-gpu"`.

**RoFormer worker protocol** (`python -u -m backend.workers.roformer_worker`):

```
--audio IN --out DIR --models M1 [M2] --overlap N --model-dir D --allow-download 0|1
[--ensemble avg_wave] [--download-only]
```

It runs one `audio_separator` pass per model into `DIR/passN`, averages ensemble stems, and writes `DIR/vocals.wav` and `DIR/no_vocals.wav`. Stderr carries `{"event": "stage" | "download" | "error", …}` lines. Exit codes: `0` ok, `2` usage, `3` weights missing (downloads disabled), `4` import error, `5` failed.

### 2.7 Lyric sync

**Lyrics** (`lyrics.py`). LRCLIB first, then `syncedlyrics` in a bounded executor; untimed results count as plain lyrics. LRC parsing honours `[offset:]` (positive means earlier) and enhanced `<mm:ss.xx>` word tags. Plain text drops section headings such as `[Chorus]`.

**Orchestrator** (`lyric_sync.sync_lyrics(vocals_path, lines, *, lyric_data, engine, progress, cancel_event)`):

1. **DSP pass.** `aligner.align_lyrics(vocals_path, lines)`. Plain lyrics get a second, timed pass that snaps each line to its sung phrase (`ALIGN_REFINE_PLAIN`).
2. **Engine choice.** `ALIGNMENT_ENGINE` auto / ctc / dsp. Neural alignment needs torch and torchaudio 2.10+ and the MMS model (cached, or downloadable when `ALIGNMENT_ALLOW_DOWNLOAD=1`).
3. **Neural pass.** All lines go to one worker process, each with a window around its DSP timing (±0.75 s, split halfway into the gaps), waiting for an `ALIGN_SEMAPHORE` slot.
4. **Merge.** Per line, neural word timing replaces the DSP estimate when the line aligned, its score is at least `ALIGNMENT_MIN_CONFIDENCE` (0.45) and at least 70% of its words were placed; missing words are shared out between neighbours and timing stays monotonic. Lines with word timing from the lyrics file keep it. If the worker fails, the whole song keeps the DSP timing and the reason is recorded.
5. **Confidence** (`sync_confidence.py`). Vocal activity and onsets are measured once per stem (10 ms grid, cached by path, size and mtime). DSP lines score 0.5 × coverage + 0.5 × onset agreement (Gaussian, σ = 60 ms); neural lines blend 0.6 × model score with 0.4 × that evidence; lyrics-file lines keep at least 0.9; no-audio fallbacks get 0.2.
6. **Output.** Lines gain `confidence` and `align_method` (ctc, dsp, lrc, fallback; the editor adds manual). The project gets a `sync_report` (engine, fallback reason, line counts per method, low-confidence count, mean confidence, elapsed time) and `lyric_timing` (`source_word`, `source_line`, `aligned`, `none`). `is_synced` stays false for plain lyrics; the UI reads `lyric_timing`.

**CTC worker protocol** (`python -u -m backend.workers.ctc_align_worker --request REQ.json --response RES.json`):

```jsonc
// request
{"version": 1, "audio": "/abs/vocals.wav", "model_dir": "/models/mms_fa", "allow_download": true,
 "lines": [{"index": 0, "window_start": 9.45, "window_end": 14.6, "words": ["every", "window", ""]}]}
// response
{"version": 1, "model": "MMS_FA",
 "lines": [{"index": 0, "status": "ok", "error": null, "line_score": 0.83, "star_ratio": 0.12,
            "words": [{"start": 10.21, "end": 10.58, "score": 0.91}, {"start": 10.6, "end": 11.0, "score": 0.77}, null]}]}
```

Words are spelled for the MMS alphabet by `lyric_tokenize.normalize_for_mms` (numbers via `num2words`, other scripts via `uroman` when installed); an empty spelling means the word cannot be aligned. Each window is aligned as `* word … *` so the star token absorbs anything that is not the line. Exit codes match the RoFormer worker; a timeout (`ALIGNMENT_TIMEOUT_SEC`) or stall (`ALIGNMENT_STALL_SEC`) stops it.

**Single-line re-align** (`line_realign.py`, `POST …/realign-line`). The search window is the line ± `search_window` (default 1.5 s, at most 3 s), never past the neighbouring lines of the same voice. Candidate starts are the line's current start and every phrase start (singing after 0.12 s of quiet) in the window; each scores vocal coverage over the line's length, plus quiet just before it, minus distance moved. The end snaps to the nearest release (0.25 s of quiet). DSP word timing reads only the window's audio. When the neural aligner is ready and has a free slot, it searches the whole window too and wins if confident. The response is `{status: ok | not_found, line, engine, elapsed, fallback_reason, detail, window}`.

### 2.8 Mixing, subtitles and rendering

- **Mixer.** `audio_mixer.mix_and_shift` blends the guide vocal with `amix … normalize=0` plus `alimiter`, so the backing track keeps its level. A `MIX_QUALITY` context variable picks the pitch shifter: fast resampling for previews, Rubber Band (`pitchq=quality`, formants preserved on the guide vocal) for renders, with a fallback graph for older FFmpeg builds. `/mix` results are cached by file name while newer than the stems and made by the current mixer (`MIX_CACHE_VERSION` in `master_audio.py`, noted in `output/.mix-cache-version`; renders older than that note are made again). After each `/mix` (once its save succeeded) and each re-separation, `prune_mix_cache` keeps the song's `MIX_CACHE_PER_SONG` (default 6, 0 keeps all) most recently used mixes; see Master audio.
- **Master audio** (`master_audio.py`). Mix file names, the mix cache, and the project's `master_audio_path` / `master_audio_url`. The path is always the WAV (exports, renders, the waveform). With `PREVIEW_AUDIO_FORMAT=aac` the URL points at an AAC copy (`AudioMixer.encode_preview`: 160 kbps, `+faststart` so playback and seeking start at once), re-encoded when the WAV is newer and served as `audio/mp4`; without an AAC encoder, or when encoding fails, the studio streams the WAV. A reused mix gets a new access time and keeps its modification time, so its `?v=` URL and its `.m4a` stay valid. `prune_mix_cache` (never raises) matches only `{track}_mix_<semitones>_<guide %>.wav` (never `.tmp_` files, `{id}_master.wav` or other songs) and deletes each WAV with its `.m4a`: first the mixes that can never be served again (older than the marker, the instrumental, or the vocals when the guide is above 0), then, ordered by last use (the latest access or modification time of the WAV and its `.m4a`), those past the limit. Every song's current `master_audio_path` (compared by file name) and any mix used in the last 60 s are never deleted: such a mix takes a slot only when it is among the `MIX_CACHE_PER_SONG` most recently used, and is otherwise kept on top of the limit, so a song can hold more mixes than that. It copies the masters' names under `PROJECTS_LOCK`, releases it, then takes `_MIX_CACHE_LOCK` (which `reusable_mix_path` also holds while it checks and touches a mix), so the order is always `PROJECTS_LOCK`, then `_MIX_CACHE_LOCK`. The intake's first `{id}_master.wav` is not pruned.
- **Song analysis** (`project_analysis.py`). The chord and vocal-range routes, the ASS and chord sheet exports and the render detect chords or the vocal range when a song has none yet; the intake pipelines, `POST …/chords/detect` and vocal-range re-analysis always do. `ensure_chords` / `ensure_vocal_range` detect outside `PROJECTS_LOCK` and store under it, keeping what was stored meanwhile (first writer wins) unless forced. Chords come from the instrumental, else the original track. A song's key is its vocal analysis's estimate, else a top-level `estimated_key` (older songs). The YouTube kit (`youtube_package`) describes the key and guide level of the last render (`render_settings`), else the song's current ones.
- **Subtitles.** `ass_generator` writes word sweeps on absolute centisecond boundaries with `{\k}` spacers for gaps, so exported highlights stay on time; duet colours and stage presets match the studio.
- **Video.** `render_worker` mixes at final quality into `{track}_final_audio.wav`, which it deletes when the render ends (finished, failed or cancelled), and renders 1080p60 (16:9 or 9:16) through FFmpeg with libass, using the bundled theme fonts (`backend/assets/fonts`: Sora, Space Grotesk, Montserrat, VT323) and the stage's backdrop colour. `video_renderer.prepare_background` feeds the filter graph at a genuine 60 fps for every backdrop (`-loop 1 -framerate 60` for stills, `fps=60` for looping videos, `r=60` for the colour source), so the sweep is drawn for each output frame; a still image (custom, or the song's thumbnail with its blur and darkening) is processed once into a PNG instead of per frame, falling back to the per-frame chain if that step fails. The background style (`style_config.background_style`, with `background_palette` and `background_tone`) picks what is drawn when there is no upload: the thumbnail still (default), the drift (the thumbnail processed once at 1.12× and panned by `crop`, decoded once through the `loop` filter), aurora (one-frame Gaussian orb sprites overlaid at song-time positions) or the spectrum (`showcqt` of the song, tinted from the palette), or the plain colour. Aurora and spectrum are drawn at a quarter of the output size from inline lavfi sources, add the stage's scrim and are upscaled, so cloud renders ship nothing extra for them. Their motion numbers live in `backend/assets/shared/background_motion.json`, which the stage imports too. The libx264 preset is `FFMPEG_PRESET` (default `veryfast`, CRF 18). Each aspect ratio has its own file, `{track}_karaoke.mp4` for 16:9 and `{track}_karaoke_vertical.mp4` for 9:16, so a render replaces only its own format's video. FFmpeg (or the cloud download, and the local render after a failed cloud one) writes `<name>.part.mp4` next to it, which `os.replace` moves into place only when the render succeeds; a failed or cancelled render removes the part file and keeps the previous video, and the `lifespan` hook deletes the part files and scratch mixes a restart left behind, including the mixer's unfinished `{track}_final_audio.tmp_*.wav` (`render_worker.remove_render_leftovers`). `video_url` is the latest render and `videos_by_aspect` maps each format to its latest file, which the Export dialog offers next to it.
- **Cloud export** (`remote_render.py`, `render` in `gpu/modal_app.py`). With `RENDER_REMOTE=modal`, `ffmpeg_args` builds the same command against upload names (`background.*`, `audio.*`, `subtitles.ass`, fonts in `/fonts`), and `modal_jobs.run_modal_job` spawns it on a 16-core CPU, streams FFmpeg's `-progress` lines back into the same `RenderProgress` parser and returns the MP4. Cancel stops the remote call; an unavailable service, no CPU within `RENDER_REMOTE_QUEUE_SEC` or a failed render falls back to the local render. `modal_jobs` is shared with the cloud GPU separation and cancels the remote call whenever following it raises, including from a progress callback; it reports the wait for a container every 5 s (shown as "Waiting for a cloud CPU… 45 s") and logs it once the job starts. Opening the Export dialog sends a beacon to `POST /api/render/warmup`, which spawns `render(warmup=True)` at most once a minute (`RENDER_REMOTE_PREWARM`); the container then waits `RENDER_REMOTE_SCALEDOWN_SEC` (120 s, separate from the GPU's 30 s) for the render.

---

## 3. Frontend

### 3.1 Design system

- **Tokens.** Each app theme (`theme/appThemes.ts`) defines colours, fonts, radii, borders and shadows, applied as CSS variables on `<html>` (`--theme-*`, `--app-*`), with `--theme-<colour>-rgb` channels, semantic colours (success, warning, danger, info, focus, overlay) and effects (`--theme-gradient-accent`, `--theme-gradient-stage`, `--theme-glass-alpha`). Tailwind maps `theme.*` colours to `rgb(var(--theme-<c>-rgb) / <alpha>)`, so opacity utilities work in every theme.
- **Themes.** Five app themes: **Afterglow** (default: ink surfaces, violet-to-pink accent, gold sung lyrics, Sora and Inter), Basement Flyer, Reel-to-Reel '74, Midnight KTV Booth and Monolith Press. Nine stage presets (`theme/stagePresets.ts`) set the karaoke colours, font and backdrop; Afterglow is listed first.
- **Primitives** (`components/ui`): Button, IconButton, Panel, SegmentedControl, Tabs, Dialog (with header, body and footer), Menu, Slider, Switch, Checkbox, Badge, Field, Kbd, Spinner, ProgressBar / ProgressRing, Skeleton, EmptyState, VisuallyHidden. Interactive primitives keep 44 px touch targets and tighten from `md:` up. Dialogs render only while open, put the close button first, trap focus and close on backdrop click unless they are gates (sign-in). `utils/cn.ts` merges classes with the custom token classes registered.

### 3.2 Studio layout

- `App` wraps `AppContent` in the palette and theme providers. `AppContent` shows the library (`TrackSearch`), the `ProcessingView`, or the `StudioWorkspace`.
- **Header** (`StudioHeader`): brand, palette trigger, render badge, app theme picker, help, profile, New Song and the single Export button.
- **Workspace** (`studio/StudioWorkspace.tsx`): on desktop a grid of the main column (song header, stage and timeline) and the inspector aside (Audio Mix and Stage Look panels); on phones three tabs (Stage, Timeline, Mix & Theme). The song header carries the sync badge (fidelity, mean confidence, auto-aligned) and the stems badge.
- **Transport** (`transport/TransportDock.tsx`): the only `<audio>` element (it never remounts), waveform scrubber, play, time, speed, key stepper and volume; fixed at the bottom on phones. It publishes `--dock-height` so toasts sit above it.

### 3.3 State and hooks

| Hook | Role |
| :--- | :--- |
| `useProjectPolling` | polls the song's status (`/api/project/{id}/status`, its progress fields only) once a second while a pipeline, render, `separation_job` or `sync_job` is active, and fetches the full project once when one finishes |
| `useStudioAudio` | transport state; keeps the position and play state when the master URL changes |
| `useMixController` | requested vs applied key and guide level; debounced `/mix`, latest request wins |
| `useVisualTheme` + `stageSettingsStorage` | stage look, persisted in `karaoke_stage_settings_v1` |
| `useLyricEditorState`, `useLyricHistory`, `useTapCursorHistory` | timeline editing, 50-step undo, tap-to-sync |
| `useTimelineFilter` + `utils/timelineReview` | "Needs review" (confidence < 60%, missing or tiny words, overlaps) |
| `useCapabilities` | `/api/capabilities`, fetched on first use and shared |
| `useTrackIntake` | starts songs; remembers the chosen separation quality |
| `useQualityJobs` | starts and cancels re-separation and background re-alignment; outcome toasts |
| `useLineRealign` | "Re-align this line", applied as an undoable edit |
| `useSyncJobResult` | holds a finished re-alignment back while the editor has unsaved edits |
| `useMediaSession` | metadata, play/pause/seek/stop and previous/next line from media keys |
| `useKeyboardShortcuts` | global shortcuts, ignored while typing or while any dialog is open |
| `useUpdatePrompt` | offers a Reload toast once the server serves a newer build: when the tab becomes visible and every 5 minutes, it compares the hashed entry script in `/` with the one this page loaded |

**Hand edits.** The editor routes hand edits through a setter that compares each line's content (text, times, words) with the previous state: changed lines become `align_method: "manual"` and lose their confidence, and a line edited back to its saved content gets its saved metadata back (`utils/manualEdits.ts`). Aligner results, undo/redo and server updates bypass it.

### 3.4 Command palette

`commandPalette/` holds a registry: components register commands (`useRegisterCommands(scope, commands)`) and searchable sources (songs, lyric lines) while mounted, and the palette reads them when it opens. <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> toggles it unless another dialog or the sign-in gate is open. Ranking puts prefix matches first, then word starts, substrings and loose subsequences; results are capped at 50 and recent commands are kept in `karaoke_palette_recent`. Studio commands cover playback, stage, mix (including "Improve stem separation…"), themes, navigation, song actions, and the timeline's lyric tools (save, undo, tap-to-sync, re-align the selected line or all lines, cancel a re-alignment).

### 3.5 Stage

`LyricDisplay` composes `stage/StageBackground`, `StageToolbar`, `StageLyrics` (word sweep or line mode) and `StageFloatingControls` for fullscreen. `StageBackground` draws only what the export draws: the stage colour, then the cover art (the export's own still from `GET /api/project/{id}/backdrop`, panned for the drift), aurora orbs, the spectrum (`StageSpectrum`, a canvas fed by its own analyser and calibrated against `showcqt`), or an upload; aurora and spectrum add the export's scrim. Drift and aurora positions are functions of the song time (`theme/stageBackgrounds.ts`), so a paused stage shows the exported frame at that moment; they hold still under reduced motion. Lyrics carry the export's outline. The preview uses the same backdrop, duet colours and font as the exported video and subtitles.

---

## 4. Testing

- **Backend** (`pytest`). `tests/conftest.py` gives every test an isolated data folder and a hermetic ML setup: `SEPARATION_QUALITY=fast`, `ALIGNMENT_ENGINE=dsp`, downloads off, model folders under the test's temp directory, `HF_HUB_OFFLINE=1`, Demucs quality-flag detection off, the disk-space guard off (`DISK_MIN_FREE_MB=0`), and the mix cache at its default size (`MIX_CACHE_PER_SONG=6`). Engines that need weights are exercised through fake worker processes and stand-in packages, so the suite runs offline. CPU-budget tests guard the DSP aligner's speed.
- **Frontend** (Vitest, jsdom). Contracts enforced by tests include unique accessible names in the studio at phone and desktop widths, 44 px touch targets, the dialog contract, a single never-remounting audio element, and design-token usage (no fixed palette colours in components).
- **Layout.** Each suite keeps one folder per feature: `backend/tests/` has `alignment`, `chords`, `lyrics`, `realignment`, `separation`, `media`, `subtitles`, `exports`, `render`, `projects`, `vocal_range`, `server`, `workers`, `tools` and `e2e`; `frontend/src/tests/` has `accessibility`, `app`, `audio`, `chords`, `components`, `dialogs`, `export`, `intake`, `shortcuts`, `stage`, `studio`, `theme`, `timeline`, `transport` and `ui`. Synthetic audio, media and fixtures shared between files live in each suite's `helpers/`. The `meta/` tests guard the layout: no test file at the top level, and on the backend unique basenames and no `__init__.py`, because pytest imports test files by basename.
- **Gates.**

  ```bash
  ruff check backend && ruff format --check backend && pytest
  cd frontend && npm run lint && npm run format:check && npx tsc -p . --noEmit && npm test && npm run build
  ```

- **Real-model checks** (on a machine that can download the weights): `backend/tools/fetch_models.py`, `benchmark_sync.py` (word error and confidence-vs-error against hand-timed words) and `benchmark_separation.py` (SI-SDR per preset against reference stems).
