# Test Infrastructure & E2E Testing Guide

## 1. Testing Philosophy

Karaoke Studio employs an **opaque-box, requirements-driven testing philosophy** designed to rigorously validate user-facing behavior, API interface contracts, and end-to-end media processing pipelines without tying tests to private internal implementations.

### Core Principles
1. **Opaque-Box Contract Verification**: All assertions originate strictly from public HTTP endpoints, API schemas, and interface contracts specified in `PROJECT.md` and user requirements.
2. **Hermetic & Deterministic Execution**: External network interactions (YouTube extraction via `yt-dlp` and lyric scraping via LRCLIB) are intercepted by deterministic mock fixtures in `conftest.py`. No live internet connection is required, eliminating network flakiness and enabling fast CI execution.
3. **Real Media Processing**: While heavy AI model inference (Demucs Demixing) and internet downloads are mocked with instantaneous synthetic audio generators, **real audio filters and video rendering engines (FFmpeg, ASS subtitle synthesis, acoustic envelope analysis)** execute on actual valid WAV audio and PNG/JPEG visual assets.
4. **Adversarial Resilience & Defensive Validation**: Boundary tests actively stress the system with invalid parameters, out-of-range semitones, 0-byte files, oversized payloads (HTTP 413), malformed URLs, Unicode/CJK/emoji text, and concurrent multithreaded writes.

---

## 2. 4-Tier Test Architecture

The E2E test suite in `backend/tests/e2e/` is structured into 4 distinct tiers:

```
backend/tests/e2e/
├── conftest.py                   # Deterministic mocks, audio/image fixtures, project factory
├── test_e2e_tier1_features.py    # Tier 1: Core Feature Coverage (>=5 tests per core feature)
├── test_e2e_tier2_boundaries.py  # Tier 2: Boundary & Corner Cases (>=5 tests per core feature)
├── test_e2e_tier3_pairwise.py    # Tier 3: Cross-Feature Pairwise Combinations
└── test_e2e_tier4_scenarios.py   # Tier 4: Real-World End-to-End Application Scenarios
```

### Tier 1: Core Feature Coverage (`test_e2e_tier1_features.py`)
Provides exhaustive verification of standard ("happy-path") behaviors across all 8 major application subsystems:
- **Audio Intake** (6 tests): Valid URL queueing, direct 11-char video ID intake, custom lyric injection, creator attribution, cached ready project reuse, track search.
- **Stem Separation** (6 tests): Vocal/instrumental stem generation, static stem streaming, custom WAV/MP3 backing upload, unsupported audio rejection, stem cache reuse.
- **Lyrics Processing** (5 tests): Lyric line updates, plain text tokenization, timecoded LRC parsing, LRCLIB schema compatibility, empty lyric handling.
- **Timeline Alignment** (5 tests): Acoustic envelope boundary refinement, word token segmentation, silent vocal fallbacks, monotonic timestamp ordering, stereo-to-mono handling.
- **Audio Mixing** (5 tests): Semitone pitch transposition, guide vocal blending, simultaneous pitch shift + blend, missing instrumental rejection (HTTP 400), static master audio streaming.
- **Video Rendering** (6 tests): Queued render job dispatch, ASS `\kf` progressive sweep subtitle creation, 16:9 canvas dimensions, 9:16 vertical canvas dimensions, custom JPEG/PNG background upload.
- **Security & Passphrase Auth** (7 tests): Open mode status, passphrase access gating (HTTP 401), cookie login lifecycle, incorrect password rejection, cookie deletion on logout, `X-App-Password` header authentication, HTTP security headers (`nosniff`, `DENY`, `strict-origin-when-cross-origin`).
- **Projects Persistence** (6 tests): Atomic disk persistence, full project listing, user-scoped project listing (`scope=my`), individual project retrieval, 404 responses for missing projects, automated recovery from backup (`projects.json.bak`).

### Tier 2: Boundary & Corner Cases (`test_e2e_tier2_boundaries.py`)
Hardens all 8 features against edge inputs, anomalous states, and adversarial attacks:
- **Audio Intake Boundaries**: Empty/whitespace URLs, 4000+ char tracking URLs, multilingual CJK/Cyrillic/Arabic/Emoji lyric text, search with whitespace and boundary limits (0, 1, 10), malformed URL rejection.
- **Stem Separation Boundaries**: 0-byte instrumental upload handling, oversized audio rejection (HTTP 413 ceiling), directory traversal path sanitization (`../../etc/passwd`), non-existent audio handling, special characters in track IDs.
- **Lyrics Boundaries**: Empty string lyric lines, zero-duration/identical start-and-end timestamps, 5000+ char lyric lines, HTML/ASS tags escaping, rapid sub-centisecond consecutive timecodes.
- **Alignment Boundaries**: Sub-tenth second tiny audio files, single-letter word lines ("O I see a star"), 20+ dense words in short intervals, all-zero plain text distribution, 96kHz studio sample rates.
- **Audio Mixing Boundaries**: Lower boundary pitch shift (-12 semitones / full octave down), upper boundary pitch shift (+12 semitones / full octave up), exact guide volume bounds (0.0 and 1.0), fractional high-precision volumes (0.3333333), missing vocal file fallback.
- **Video Rendering Boundaries**: 0-byte background uploads, oversized background image rejection (HTTP 413), unsupported image formats (.gif, .bmp, .svg), path traversal background IDs, ASS curly brace/backslash tag escaping, empty lines subtitle handling.
- **Security / Auth Boundaries**: Empty password submission rejection, 10,000-char giant password safety, SQL injection / template injection payload rejection, `Authorization: Bearer` header validation, tampered cookie rejection, public `/api/health` accessibility.
- **Projects Persistence Boundaries**: Multilingual CJK/Emoji project metadata persistence, 16-thread concurrent save safety, 100-line / 700-word massive timeline payloads, special characters in project IDs, 0-byte empty projects store recovery.

### Tier 3: Cross-Feature Combinations (`test_e2e_tier3_pairwise.py`)
Validates multi-feature interactions and state transitions across subsystem boundaries:
1. Custom lyrics + pitch transposition (+2 semitones) + video rendering.
2. Custom background image + 9:16 vertical format + 3-2-1 countdown dots.
3. User instrumental upload + lyric timing update + audio mixing.
4. Passphrase authentication + media intake + static media streaming.
5. Pipeline cancellation during intake + clean restart resilience.
6. Video render cancellation + aspect ratio switch & re-render.
7. Custom ASS visual theme presets + video synthesis.
8. Pitch shift + guide vocal blend + YouTube SEO metadata package.
9. Multi-tenant user scoping + project isolation.
10. Multilingual CJK lyrics + custom background image + ASS generation.
11. Extreme dual octave shifts (+12 and -12) + waveform verification.
12. Rapid iterative timeline lyric nudges + video subtitle synchronization.

### Tier 4: Real-World Application Scenarios (`test_e2e_tier4_scenarios.py`)
Exercises full user workflows end-to-end:
- **Scenario 1: Golden Path**: Standard YouTube song intake -> stem separation -> lyrics fetch & alignment -> master playback -> 1080p60 MP4 video render -> YouTube SEO package generation.
- **Scenario 2: Social Media Creator Studio**: Custom plain text lyrics -> +3 semitone pitch shift & 15% guide vocal backing -> 1080x1920 background upload -> timeline editor word nudging -> 9:16 vertical MP4 video export.
- **Scenario 3: Musician Self-Produced Track**: Direct studio instrumental WAV upload -> custom lyric submission -> -1 semitone shift -> 1080p60 video export.
- **Scenario 4: Multi-User Studio Collaboration**: Passphrase gate protection -> Alice logs in and creates track -> Bob logs in and creates track -> Alice and Bob scoped views verify isolation -> unauthenticated visitors blocked -> session logout.
- **Scenario 5: Fault-Tolerant Operator**: Pipeline cancelled mid-flight -> recovered and restarted -> video render cancelled mid-flight -> re-rendered with updated styling to completion.
- **Scenario 6: International Multi-lingual Production**: Japanese Kanji, Hiragana, and emoji stage cues ("🌸 桜の雨 (Sakura Rain)") -> custom ASS subtitle styling -> UTF-8 preservation check -> YouTube metadata kit export.

---

## 3. Test Runner Invocation

### Run Full E2E Test Suite (All 4 Tiers)
```bash
venv/bin/pytest backend/tests/e2e/
```

### Run by Specific Tier
```bash
# Tier 1: Core Feature Coverage
venv/bin/pytest backend/tests/e2e/test_e2e_tier1_features.py

# Tier 2: Boundary & Corner Cases
venv/bin/pytest backend/tests/e2e/test_e2e_tier2_boundaries.py

# Tier 3: Cross-Feature Pairwise Combinations
venv/bin/pytest backend/tests/e2e/test_e2e_tier3_pairwise.py

# Tier 4: Real-World Application Scenarios
venv/bin/pytest backend/tests/e2e/test_e2e_tier4_scenarios.py
```

### Run Combined Backend Suite (Unit + Integration + E2E)
```bash
venv/bin/pytest backend/tests/
```

### Code Formatting & Linting Quality Gates
```bash
# Lint checks
venv/bin/ruff check backend/tests/e2e/

# Format checks
venv/bin/ruff format --check backend/tests/e2e/
```

---

## 4. Coverage Thresholds & Quality Gates

The test suite enforces a **minimum coverage threshold of 50.0%** across the backend via `pytest-cov`.
- **Current Total Test Count**: 127 tests (107 E2E tests + 20 unit/integration tests)
- **Current Test Coverage**: **73.12%** (exceeds the 50.0% threshold)
- **Regressions**: 0
- **Execution Time**: ~50 seconds for the entire 107-test E2E suite
