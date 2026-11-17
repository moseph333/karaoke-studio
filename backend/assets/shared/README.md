# Shared with the studio

Values the backend and the studio (frontend) must agree on, kept once here. The backend
reads them through `backend/shared_assets.py`; the frontend imports them as
`@shared/<name>.json` (a Vite alias and a tsconfig path), and the Docker image's frontend
build stage copies this folder next to `frontend/` so the alias resolves there too.

| File | What | Used by |
|---|---|---|
| `stage_presets.json` | Each stage look's id, name, description and sung/unsung colours (ASS), in the order the presets were added | `ass_generator.VISUAL_THEMES`; `theme/stagePresets.ts`, which adds the preview-only fields |
| `singer_aliases.json` | Every singer label a lyric line may carry, mapped to `singer1`, `singer2` or `both` | `schemas.LyricLineSchema`, `ass_generator.singer_part`; `stage/singers.ts` |
| `media_sites.json` | The sites a song link may come from (id, name, domains, an example address), and which site each sample link's host belongs to (`host_cases`) | `services/media_links` (`media/test_media_links.py`) |
| `upload_limits.json` | Upload size limits in MB | `upload_utils`; the local audio uploader |
| `confidence_thresholds.json` | Alignment confidence: below `low` a line needs review, from `high` it reads as high | `lyric_sync` (sync report); `utils/timelineReview.ts`, `utils/lineRealign.ts` |
| `background_motion.json` | The drift, aurora and spectrum motion numbers | `stage_backgrounds.BACKGROUND_MOTION`; `theme/stageBackgrounds.ts` |
| `adlib_cases.json` | Which words of a line are sung in parentheses (a backing vocal or ad-lib), styled smaller and italic | `lyric_tokenize.adlib_flags` (`subtitles/test_ass_adlibs.py`); `utils/lyrics.ts` `adlibFlags` (`tests/stage/stageAdlibs.test.tsx`) |
| `uncovered_vocals.json` | How long singing with no lyric line must last to be reported, and how far each line's span is widened | `lyric_sync` (sync report, `sync_confidence.uncovered_vocals`); `utils/uncoveredVocals.ts` |
| `tokenize_cases.json` | Lyric tokenizer cases both tokenizers must split the same way, and how both write the tokens back out (`written`: with the source text's spacing; `joined`: without it, never spacing CJK characters) | `alignment/test_alignment_parts.py`; `tests/timeline/lyrics.test.ts` |
| `word_spread_cases.json` | Words the studio editor spread evenly over a line (`recalculateWordTimings`), and whether both sides must read them as only spread rather than timed by hand (`spread_evenly`: true for lines of two or more words, never for a one-word line) | `lyric_sync.words_spread_evenly` (`alignment/test_lyric_sync.py`); `utils/manualEdits.ts` (`tests/studio/qualitySync.test.tsx`) |
