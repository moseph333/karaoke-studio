# Shared with the studio

Values the backend and the studio (frontend) must agree on, kept once here. The backend
reads them through `backend/shared_assets.py`; the frontend imports them as
`@shared/<name>.json` (a Vite alias and a tsconfig path), and the Docker image's frontend
build stage copies this folder next to `frontend/` so the alias resolves there too.

| File | What | Used by |
|---|---|---|
| `stage_looks.json` | The five stage looks (Marquee, KTV, Songbook, Cinema, Prompter): layout, colours, typefaces, motion, cover-art treatment and where each part sits in a 16:9 and a 9:16 frame, in u (1% of the frame's short side; sizes are ems, positions baselines). Also the timing rules, the line-fitting rules, the default look, the default part names and the look each replaced preset maps to | `services/stage_looks`, `stage_timing`, `text_fit`, `stage_layout`, `look_backgrounds` (`looks/test_stage_looks_spec.py`) |
| `stage_scene_cases.json` | A made-up song in each look and format at chosen moments, and every row of text and shape the video draws then, read back from the subtitle file | `ass_look` through `tools/stage_cases` (`looks/test_stage_cases_current.py`); `utils/stageScene.ts` (`tests/stage/stageSceneCases.test.ts`) |
| `stage_fit_cases.json` | Token widths and a text box, and the size, squeeze and row breaks the line-fitting rule must give | `text_fit.fit_block` (`looks/test_text_fit_cases.py`); `utils/stageFit.ts` (`tests/stage/stageFitCases.test.ts`) |
| `stage_timeline_cases.json` | Lyric lines and a song length, and when every line, card, count-in and break marker must show | `stage_timing.plan_timeline` (`looks/test_stage_timeline_cases.py`); `utils/stageTimeline.ts` (`tests/stage/stageTimelineCases.test.ts`) |
| `stage_layout_cases.json` | A lyric line, a look and a format, and where its words, part name, romaji and next line must go | `services/stage_layout` (`looks/test_stage_layout_cases.py`); `utils/stageLayout.ts` (`tests/stage/stageLayoutCases.test.ts`) |
| `stage_font_metrics.json` | Each stage typeface: its file, the names libass and CSS know it by, its ascent, descent and cap height in ems, the factor from an em to libass's Fontsize, and every listed character's advance width (thousandths of an em), with the rules for characters a face lacks. Written by `python -m backend.tools.font_metrics` | `services/font_metrics` (`looks/test_font_metrics.py`) |
| `singer_aliases.json` | Every singer label a lyric line may carry, mapped to `singer1`, `singer2` or `both` | `schemas.LyricLineSchema`, `ass_generator.singer_part`; `stage/singers.ts` |
| `media_sites.json` | The sites a song link may come from (id, name, domains, an example address, and `kind`: `download` for sites yt-dlp downloads from, `lookup` for Spotify, Apple Music, TIDAL and Deezer, whose songs are matched to a YouTube upload), and which site each sample link's host belongs to (`host_cases`) | `services/media_links` (`media/test_media_links.py`); `utils/mediaLinks.ts` (`tests/intake/mediaLinks.test.ts`) |
| `upload_limits.json` | Upload size limits in MB | `upload_utils`; the local audio uploader |
| `confidence_thresholds.json` | Alignment confidence: below `low` a line needs review, from `high` it reads as high | `lyric_sync` (sync report); `utils/timelineReview.ts`, `utils/lineRealign.ts` |
| `background_motion.json` | The drift, aurora and spectrum motion numbers | `stage_backgrounds.BACKGROUND_MOTION`; `theme/stageBackgrounds.ts` |
| `adlib_cases.json` | Which words of a line are sung in parentheses (a backing vocal or ad-lib), styled smaller and italic | `lyric_tokenize.adlib_flags` (`subtitles/test_ass_adlibs.py`); `utils/lyrics.ts` `adlibFlags` (`tests/stage/stageAdlibs.test.tsx`) |
| `uncovered_vocals.json` | How long singing with no lyric line must last to be reported, and how far each line's span is widened | `lyric_sync` (sync report, `sync_confidence.uncovered_vocals`); `utils/uncoveredVocals.ts` |
| `tokenize_cases.json` | Lyric tokenizer cases both tokenizers must split the same way, and how both write the tokens back out (`written`: with the source text's spacing; `joined`: without it, never spacing CJK characters) | `alignment/test_alignment_parts.py`; `tests/timeline/lyrics.test.ts` |
| `word_spread_cases.json` | Words the studio editor spread evenly over a line (`recalculateWordTimings`), and whether both sides must read them as only spread rather than timed by hand (`spread_evenly`: true for lines of two or more words, never for a one-word line) | `lyric_sync.words_spread_evenly` (`alignment/test_lyric_sync.py`); `utils/manualEdits.ts` (`tests/studio/qualitySync.test.tsx`) |

The four `stage_*_cases.json` files are written by `python -m backend.tools.stage_cases` from the backend's rules; run it after changing a rule or `stage_looks.json` and read the diff.
