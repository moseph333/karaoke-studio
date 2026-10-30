# Karaoke Studio

Karaoke Studio (2.1) turns a song from a YouTube URL or an uploaded file into karaoke: it separates the vocals from the backing track, fetches lyrics and times them word by word, lets you fix the timing on a live timeline, and exports 1080p60 videos, `.lrc`/`.ass` subtitles and stems. A FastAPI backend drives FFmpeg, Demucs/RoFormer separation and an MMS/DSP lyric aligner; the React + TypeScript frontend is built to `frontend/dist` and served by the backend. Local-first, optionally behind a shared passphrase, AGPL-3.0.

Read next: `README.md` (features, every env var with its default) and `docs/ARCHITECTURE.md` (API table, persistence and concurrency rules, worker protocols, frontend hooks). Both are current for 2.1.

## Commands

Run from the repo root: code imports `backend.*` and `pytest.ini` sets `pythonpath = .`.

```bash
./run.sh                        # checks FFmpeg, creates venv/, installs deps (CPU torch), builds the frontend if needed, serves :8000
INSTALL_ML_EXTRAS=1 ./run.sh    # also the RoFormer extras; TORCH_INDEX_URL picks another torch build (e.g. CUDA)

# Manual setup
python3 -m venv venv && source venv/bin/activate
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements.txt     # includes pytest, ruff, modal
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements-ml.txt  # optional: local Balanced/Best
cp .env.example .env
cd frontend && npm install      # CI uses npm ci

# Dev servers
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
cd frontend && npm run dev      # Vite on :5173, proxies /api and /static to :8000

# Gates, as .github/workflows/ci.yml runs them (Python 3.12, Node 20)
ruff check backend && ruff format --check backend && pytest
cd frontend && npm run lint && npm run format:check && npm test && npm run build   # build = tsc && vite build
cd frontend && npm run format   # also: npm run lint:fix, npm run test:watch

# Docker
docker compose up -d                    # image includes the ML extras; INSTALL_ML_EXTRAS=0 (compose build arg) gives a Fast-only image
docker compose --profile tunnel up -d   # adds cloudflared (needs CLOUDFLARE_TUNNEL_TOKEN)
docker compose exec karaoke-studio python -m backend.tools.fetch_models

# Tools
python -m backend.tools.fetch_models --separation all --alignment    # prefetch weights, then set *_ALLOW_DOWNLOAD=0
KARAOKE_DATA_DIR=/tmp/karaoke-demo python -m backend.tools.seed_demo  # synthetic library, no network or models
python -m backend.tools.benchmark_sync --vocals vocals.wav --truth truth.lrc --engine both
python -m backend.tools.benchmark_separation --mix song.wav --vocals ref_vocals.wav
modal deploy gpu/modal_app.py           # cloud workers, see below
```

## Architecture

- **No database.** Projects live in `projects.json` under `KARAOKE_DATA_DIR` (atomic writes, `.bak` recovery, `PROJECTS_LOCK`); media in `downloads/`, `stems/<track>/`, `output/`, `backgrounds/`, served at `/static/*`. The `projects` cache, job semaphores, cancel events (`active_cancellations`) and login rate limits are in memory, so run a single uvicorn process.
- **Backend layout.** `backend/main.py` builds the app (auth and security-header middleware, static mounts, routers, service singletons). Routes are in `backend/routers/`, domain logic in `backend/services/`, RoFormer and MMS run as child processes from `backend/workers/`. Long jobs (`pipeline.py`, `render_worker.py`, `reseparation.py`, `realignment.py`) start as FastAPI `BackgroundTasks` and share `WORKER_SEMAPHORE` (`MAX_CONCURRENT_JOBS`); their status and progress live on the project, which the UI polls.
- **Song flow** (`pipeline.run_pipeline` for YouTube, `run_local_pipeline` for uploads):
  1. Download with yt-dlp (`services/downloader.py`, retries several YouTube player clients).
  2. Separate (`services/separator.py`) at the song's preset from `separation_presets.py`: fast = Demucs `htdemucs` (`python -m demucs`); balanced = Mel-Band RoFormer and best = Mel-Band + BS-RoFormer averaged, both through `workers/roformer_worker.py` locally or on Modal. Falls back best → balanced → fast; `process_watchdog.py` handles cancel, timeout and stall; provenance is stored as `project.separation`. Then vocal range (`vocal_analyzer.py`) and chords (`chord_detector.py`).
  3. Lyrics (`services/lyrics.py`): LRCLIB, then `syncedlyrics`, or pasted text/LRC.
  4. Align (`services/lyric_sync.sync_lyrics`): DSP pass (`aligner.py`), then the neural MMS pass (`workers/ctc_align_worker.py`, one at a time via `ALIGN_SEMAPHORE`) when available; merged per line, scored by `sync_confidence.py`, summarized in `sync_report`.
  5. First master mix (`audio_mixer.mix_and_shift`), then status `ready`.
  6. Editing: the studio saves lines (`POST /api/project/{id}/lyrics`), remixes key and guide vocal (`/mix`, cached), re-times one line (`realign-line`, saves nothing), and starts background jobs on finished songs: `sync_job` (`realign-lyrics` with `background: true`) and `separation_job` (`reseparate`). `background_jobs.conflict_reason` blocks overlaps with 409.
  7. Export: `/render` → `render_worker` mixes at final quality (Rubber Band), writes the `.ass` word sweep (`ass_generator.py`) and renders with FFmpeg + libass (`video_renderer.py`, bundled theme fonts in `backend/assets/fonts`), locally or on Modal. LRC, ASS, chord sheet, stems and the YouTube kit are plain GET routes.
- **Frontend** (`frontend/src`): React 18, strict TypeScript, Vite, Tailwind; no router or state library. `App.tsx` switches between the library (`TrackSearch`), `ProcessingView` and `studio/StudioWorkspace` (stage, timeline, inspector); `transport/TransportDock` owns the only `<audio>` element. Behaviour lives in `hooks/` (polling, audio, mix, editor history, quality jobs, command palette), pure helpers in `utils/`, design-system primitives in `components/ui/`, themes in `theme/` plus CSS variables in `index.css`. `api.ts` (`apiFetch`) adds the auth headers. `types.ts` mirrors `backend/schemas.py` by hand.

## Cloud offload (Modal)

- `gpu/modal_app.py` defines the Modal app (default name `karaoke-studio-gpu`): `separate` runs `roformer_worker` unchanged on the first free GPU (`A10G,L40S,L4,T4`) with weights in the Modal volume `karaoke-models` (unrelated to the Docker volume of the same name); `render` runs FFmpeg on 16 CPUs with `backend/assets/fonts` mounted at `/fonts`.
- Deploy with `modal deploy gpu/modal_app.py` after `modal setup`. Deploy-time env: `SEPARATION_REMOTE_APP`, `SEPARATION_REMOTE_GPUS`, `SEPARATION_REMOTE_SCALEDOWN_SEC` (30), `RENDER_REMOTE_CPUS` (16). Redeploy by hand after changing the RoFormer worker, `backend/requirements-ml.txt` (installed with `audio-separator[gpu]`) or the fonts; nothing redeploys it automatically.
- Server toggles: `SEPARATION_REMOTE=modal` (Balanced and Best only; Fast always runs locally) and `RENDER_REMOTE=modal`. Credentials: `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` in `.env` (a `~/.modal.toml` also counts). `SEPARATION_REMOTE_APP` must match the deployed name. Limits: `SEPARATION_REMOTE_QUEUE_SEC` (300), `RENDER_REMOTE_QUEUE_SEC` (120), `RENDER_REMOTE_TIMEOUT_SEC` (3600); remote separation also obeys `SEPARATION_TIMEOUT_SEC` and `SEPARATION_STALL_SEC`. Opening the Export dialog sends a beacon to `POST /api/render/warmup`, which starts a cloud CPU at most once a minute (`RENDER_REMOTE_PREWARM`, on by default) so the render doesn't wait for one.
- Readiness is checked offline (package and credentials present). Deploy or capacity problems surface at job time as `RemoteUnavailable`: separation skips the other cloud presets and runs Fast locally; a failed or unavailable cloud render renders locally.
- Server side: `services/modal_jobs.py` (spawn, follow an ephemeral queue, cancel), `remote_separation.py`, `remote_render.py`. Kept in sync by hand with `gpu/modal_app.py`: the `STARTED` marker, `FONTS_DIR`, function names and kwargs. Tests fake the `modal` module, and `backend/tests/conftest.py` unsets every remote/Modal variable.

## Deployment

- Production runs in a Proxmox LXC (CT 112) on the owner's homelab: Docker-in-LXC, using this repo's `Dockerfile` and `docker-compose.yml` from a clone at `/opt/karaoke-studio`, behind Nginx Proxy Manager. The provisioning script (`scripts/deploy_karaoke_lxc.sh`), a reference compose copy (`docker/karaoke-studio/`) and the ops doc (`docs/homelab/services/karaoke.md`) live in the homelab repo (kepler).
- **Pushing to `main` deploys.** A systemd timer runs `update.sh` every 30 minutes: `git fetch`, `git reset --hard origin/main`, `docker compose up -d --build`. It does not wait for CI. If the build fails, the old container keeps running and later runs see no new commit, so push a fix or force an update.
- Forced update: `POST /api/system/update` (or `POST /api/health`) with `{"action": "update"}` writes `<data dir>/.update_requested`, which a systemd path unit turns into an immediate update. Both routes need a session when `APP_PASSWORD` is set, so scripts send `X-App-Password`.
- Prod config exists only in CT 112's `.env`, which updates leave alone: `SEPARATION_REMOTE=modal`, `SEPARATION_QUALITY=best`, `RENDER_REMOTE=modal` and a dedicated Modal token. New env vars need safe defaults. An untracked `docker-compose.override.yml` there sets `ulimits: core: 0`.
- The prod CPU has AVX but no AVX2/AVX-512: local RoFormer is very slow there and PyTorch can die with SIGILL, so Balanced and Best depend on Modal and Fast is the local fallback. 4 vCPUs, 6 GB RAM, a 40 GB disk shared with Docker's build cache.

## Conventions

- Python: ruff for lint and format (target py312, line length 100, double quotes; rules in `pyproject.toml`). Modules open with a docstring. Reach shared singletons (`separator`, `audio_mixer`, `lyrics_service`, `WORKER_SEMAPHORE`, `projects`, ...) through `import backend.main as main_mod` at call time; tests monkeypatch them there. Background jobs look the project up again before every write and save under `PROJECTS_LOCK`.
- Frontend: Prettier (single quotes, semicolons, width 100), ESLint with `--max-warnings 0` (warnings fail CI), strict TS. Colour only through theme tokens (`bg-theme-*`, `text-theme-*`): `designTokenGuard.test.ts` fails on Tailwind palette classes like `bg-slate-800` in `components/` or `App.tsx`. Modals use `components/ui/Dialog`; tests enforce 44 px touch targets and unique accessible names at phone and desktop widths.
- Tests: `backend/tests/test_*.py` plus `backend/tests/e2e/test_e2e_tier{1..5}_*.py`; `frontend/src/tests/*.test.ts(x)` (Vitest, jsdom, Testing Library). 2.0-era files are named for the feature (`test_reseparation.py`, `TransportDock.test.tsx`) with sentence-style test names; many older files carry names from earlier agent runs (`challenger`, `m3_`, `iter2`, `tier5`). ML engines run as fake worker processes and stub packages, so neither suite needs model weights or network.
- Commits: Conventional Commits, `type(scope): summary`, the summary in plain lowercase English describing the effect (`fix(stems): keep lyric edits saved while a re-separation re-times words`). Types: feat, fix, docs, test, style, chore. Bodies are wrapped prose on what was wrong and what changed.
- Releases: annotated tag `vX.Y.Z` with message `Release vX.Y.Z: <summary>`; bump `DEFAULT_APP_VERSION` in `backend/config.py` and `version` in `frontend/package.json` (and its lock). The running version is `APP_VERSION`, else `git describe --tags --always` (compose mounts `.git` read-only), else that default. No changelog file; the README's "What's new" covers the major release.

## Gotchas

- `backend/config.py` reads the repo-root `.env` at import (real env vars win) and creates the `KARAOKE_DATA_DIR` folders (default `./workspace_data`) on import. It also reads `ALLOWED_ORIGINS` (comma-separated CORS list) and `APP_VERSION`, which `.env.example` does not list.
- Auth: an empty `APP_PASSWORD` means open access. When set, `/api/*` (except `GET /api/health` and `/api/auth/*`) and `/static/*` need a session token or the raw passphrase (`X-App-Password`, `Authorization: Bearer`, or a cookie); without one, `GET /api/health` ignores `check_remote`. The login rate limit keys on the last `X-Forwarded-For` entry (the nearest proxy's), so port 8000 must only be reachable through the proxy. Tokens are HMAC-signed with the passphrase and last 7 days, so changing it signs everyone out. `conftest.py` sets a test passphrase when none is set: use the `client` fixture, or `unauth_client` for 401 cases.
- Models download on first use into `TORCH_HOME`, `AUDIO_SEPARATOR_MODEL_DIR` and `ALIGNMENT_MODEL_DIR` (Docker: the `karaoke-models` volume at `/models`): Demucs about 80 MB, each RoFormer 0.6–0.9 GB, MMS about 1.2 GB. The MMS aligner is CC-BY-NC 4.0 (non-commercial); `ALIGNMENT_ENGINE=dsp` never uses it. The `librosa<1.0` pin in `requirements-ml.txt` is deliberate (audio-separator 0.47 needs audioread).
- Never commit `.env`, `client_secret.json`, `token.json`, `workspace_data/` or `frontend/dist/`. `.gitignore` also ignores every `*.png`, `*.jpg`, `*.webp`, `*.wav`, `*.mp4` and `*.ass` outside `docs/` and `frontend/public/`; tests generate their media at run time.
- The processing view advances its stepper when `status_detail` contains "chord" or "range"; keep those words out of separation status text.
- Shared with the frontend: `backend/assets/shared/*.json` (stage presets' names and colours, singer labels, upload limits, confidence thresholds, background motion, tokenizer cases), read by `backend/shared_assets.py` and imported by the frontend as `@shared/<name>.json`; the Docker frontend stage copies that folder. Still hand-synced: each stage preset's export-only style (`_EXPORT_STYLES` in `ass_generator.py`) and stage-only fields (`STAGE_VIEWS` in `stagePresets.ts`); app themes across `theme/appThemes.ts`, `index.css`, the boot script in `index.html` and `public/manifest.json` (compared by `themeRegistryParity.test.ts`); the lyric tokenizer in `backend/services/lyric_tokenize.py` and `frontend/src/utils/lyrics.ts` (both suites run `backend/assets/shared/tokenize_cases.json`). Theme ids differ from display names (`punk_diy` = Basement Flyer, `tape_studio_70s` = Reel-to-Reel '74, `dive_bar_crt` = Midnight KTV Booth, `clean_paper` = Monolith Press).
- Changing what the mixer produces: bump `MIX_CACHE_VERSION` in `backend/routers/projects.py` so cached mixes and older renders are rebuilt.
- `pytest.ini` always adds `--cov=backend` and `pyproject.toml` sets `fail_under = 50`, so running a subset can fail on coverage alone (pytest-cov's `--no-cov` turns it off). A few tests assert wall-clock budgets and can flake on slow CPUs. CI installs FFmpeg with libass (`ffmpeg libass-dev`) for the backend suite; a couple of tests skip without FFmpeg or its rubberband filter.
- `run.sh` rebuilds `frontend/dist` only when it is missing or the `frontend/src` directory itself is newer, so edits to existing files can leave a stale build. The backend mounts `frontend/dist` at `/` only if it exists at startup.
