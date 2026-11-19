# Karaoke Studio

Local-first web app that turns any song into karaoke: it splits the vocals from the backing track, times the lyrics down to the word, lets you fix anything on a live timeline, and exports 1080p karaoke videos.

![Karaoke Studio](docs/karaoke-preview.png)

## What's new in 2.11

- **Search for the song.** Type a title, an artist or both in the box on the home screen and the songs appear under it as you type: artwork, artist, album, year and length, with a badge on live takes, remixes and other versions. Tap the artwork to hear 30 seconds before you make it.
- **Typos are fine.** "adel rolling in the deap" finds Adele's Rolling in the Deep. A misspelled search is respelled and searched both ways, and the song you meant is listed first, above covers, tribute acts and karaoke tracks.
- **No more duplicates.** A song that is already in the library says so in the results and opens instead of being made a second time.
- **YouTube is still there.** Under the songs, **Search YouTube uploads** lists videos for a recording the catalogs don't have. Deezer song links now work like Spotify, Apple Music and TIDAL ones.
- **Help knows about it.** **Fix a problem** says what to do when the search does not list a song or lists another version of it.

**2.10** took song links from SoundCloud, Bandcamp, Vimeo and the Internet Archive as well as YouTube, matched Spotify, Apple Music and TIDAL songs to a YouTube upload of the same recording, added shortcuts on the app icon and kept the screen on while a song plays, explained failures from the new sites, and (2.10.1) fixed what a review of the whole codebase found; live streams and recordings longer than an hour are refused (`MAX_SONG_MINUTES`). **2.9** added guidance for a first song: step-by-step cards in the studio, a check-up for every song, a **Fix a problem** tab in Help, failed songs that say why, and a walk through the YouTube upload after an export. See [Using Karaoke Studio](#using-karaoke-studio) and [When results are off](#when-results-are-off). **2.8** found the right lyrics more often, gave songs with two voices their parts by voice, swept Japanese and other CJK lyrics one character at a time with their romaji underneath, kept videos from going blank in long gaps and outros (cloud renders gained Japanese fonts, so redeploy the Modal app, see **Cloud GPU** below), and added splitting and merging lines. **2.7** looks lyrics up while the stems are separated, warms the cloud GPU while the audio downloads, and opens the studio while the chords and vocal range are still being detected. **2.6** added the home screen's live lyric preview and a faster first load, saved the neural aligner's listening pass (and computes it on the cloud GPU), and made updates wait for CI. Earlier releases are in [CHANGELOG.md](CHANGELOG.md) and on the [releases page](https://github.com/moseph333/karaoke-studio/releases).

## Screenshots

| | |
| :---: | :---: |
| ![Song library and intake](docs/screenshots/library.png) <br> Library and intake | ![Stem quality picker](docs/screenshots/separation-quality.png) <br> Stem quality at intake |
| ![Improve stem separation](docs/screenshots/improve-stems.png) <br> Re-make stems at another quality | ![Re-align a line](docs/screenshots/realign-line.png) <br> Re-align one line |
| ![Lines that need review](docs/screenshots/needs-review.png) <br> Needs review | ![Command palette](docs/screenshots/command-palette.png) <br> Command palette |
| ![Export dialog](docs/screenshots/export.png) <br> Export | ![Processing](docs/screenshots/processing.png) <br> Processing |
| ![Monolith Press theme](docs/screenshots/theme-monolith-press.png) <br> Monolith Press theme | ![Midnight KTV Booth theme](docs/screenshots/theme-midnight-ktv.png) <br> Midnight KTV Booth theme |
| ![Phone stage](docs/screenshots/phone-stage.png) <br> Phone: stage | ![Phone timeline](docs/screenshots/phone-timeline.png) <br> Phone: timeline |
| ![First-song steps](docs/screenshots/first-song.png) <br> First-song steps | ![Song check-up](docs/screenshots/song-checkup.png) <br> Song check-up |
| ![Fix a problem in Help](docs/screenshots/help-fix-a-problem.png) <br> Help: Fix a problem | ![A failed song](docs/screenshots/processing-failed.png) <br> A song that failed |
| ![Upload to YouTube steps](docs/screenshots/youtube-upload.png) <br> Export: Upload to YouTube | |

## Using Karaoke Studio

A first song, start to finish. The studio shows the same steps on a card the first time you open a finished song, and **Help** (<kbd>?</kbd>) has them under **Studio Usage Guide**.

1. **Add a song.** Type its title, its artist or both and pick it from the songs listed under the box (small typos are fine, and the artwork plays a 30-second preview). Or paste a song link (YouTube, SoundCloud, Bandcamp, Vimeo, the Internet Archive, Spotify, Apple Music, TIDAL or Deezer), or switch to **Local Audio File** and upload one. **Advanced options** holds the stem quality (Fast, Balanced, Best) and a box for your own lyrics.
2. **Wait a few minutes.** The screen shows the stage it is on and a time estimate. You can leave: the song keeps processing and waits in your library. Best quality on a CPU, and a server's first Balanced or Best song (it downloads its model once), take longer.
3. **Play and sing.** Press <kbd>Space</kbd>. The words light up as they are sung.
4. **Check the lyrics.** Everything is automatic, so now and then a lyric is wrong or a line is out of time. The **check-up** button next to the song's title counts what looks off and takes you to each fix; **Needs review** above the timeline shows the lines the aligner was unsure about.
5. **Set your key.** In **Audio mix**, shift the key to your range (the tempo stays the same) and turn the guide vocal up to sing along with the original singer.
6. **Make a video.** **Export** renders a 1080p karaoke video of the song as it is now: its lyrics and timing, the key and guide vocal from Audio mix, and the look and format (16:9 or 9:16 Shorts) from Stage look. Most songs take a few minutes, and you can close the dialog while it renders. The same dialog has subtitle files, the stems and a chord sheet.

### Putting the video on YouTube

The upload itself happens on YouTube; the studio sends nothing. Once a render has finished, **Upload to YouTube** under the video in the Export dialog gives you each step:

1. **Download** the MP4, open YouTube Studio, choose **Create → Upload videos** and pick the file.
2. **Paste the title** (`Artist - Song (Karaoke Version / With Lyrics)`, shortened to fit YouTube's 100 characters).
3. **Paste the description**: the song's details, the lyrics and, when the song has three sections of ten seconds or more, timestamps that YouTube turns into chapters. Very long lyrics are cut at the end of a line so the description fits YouTube's 5,000 characters.
4. **Paste the tags.** On the upload's Details step they are under **Show more**.
5. **Check before you publish.** Start as Unlisted or Private, watch it through, then make it Public. A 9:16 video of up to three minutes is published as a Short. YouTube may recognise the song and put a copyright claim on the video (the rights holder can run ads on it or block it in some countries), so upload only songs you have the right to share.

After changing the lyrics, the key or the look, **Render Again** makes a new video; the title, description and tags follow the song.

## When results are off

**Help → Fix a problem** has these with a button to each tool. The song's **check-up** lists the ones the studio can see for itself: missing lyrics, lines that may be out of time, singing without lyrics, stems that fell back to another quality, and a background job that failed.

| What you notice | What to do |
| :--- | :--- |
| The search does not list my song, or lists another version | Add the artist to the title, or type a line of the lyrics; small typos are fine. Tell versions apart by the album, the year, the length and the badge (Live, Remix, Edit), and tap the artwork to hear 30 seconds. **Show more songs** lists the matches after the first five. **Search YouTube uploads**, under the songs, lists videos of a recording the catalogs do not have; or paste a link, or upload the audio. |
| There are no lyrics | **Re-import** in the timeline: search with a simpler title or the original artist, or paste the lyrics (plain text or LRC). Pasted words are timed to the singing. |
| The lyrics are for another song or version | Fix the title or artist with the pencil next to the title, then **Re-import → Re-query LRCLIB** and apply the listing that matches what is sung. |
| The words are early or late through the whole song | **Offset** shifts every line; start with 0.1 to 0.5 s. If the gap changes through the song, re-align all lines from the Re-import dialog or the command palette. |
| One part is out of time | **Needs review** filters the unsure lines. A line's **⋯** menu has **Re-align this line**; you can also nudge it, expand it to move words, or use **Tap sync** for a long stretch. |
| Some sung parts have no words | The **Vocals without lyrics** notice above the timeline plays each stretch. Insert a line there, type the words and re-align the line. |
| I can still hear the singer | Set **Guide vocal** to Off in Audio mix. If it is still there, **Improve** re-makes the stems at Balanced or Best while the song stays playable. |
| The backing track sounds thin or watery | **Improve** at a better quality, or **Replace** the instrumental with a real one. |
| I asked for Best and got Fast | The better model could not run (cloud GPU busy or unreachable, model not installed, too little memory). The check-up says why; **Improve** again later. |
| It is a duet, but every line has one colour | **Duet parts → By Voice**; if it finds one voice, use Alternating or set lines with the singer chip. |
| The song is too high or too low | Shift the key in Audio mix, or ask the **Smart Recommender**. |
| Processing failed | The failed song says what happened in plain words (a private, blocked or removed song, a sign-in check, a link that holds a whole album, a song picked from the search, or a Spotify, Apple Music, TIDAL or Deezer link, with no matching YouTube upload, a live stream or a recording longer than the server allows, a download that did not get through) and has **Try again** (a song from an uploaded file is uploaded again instead). Most Vimeo videos need a sign-in the server does not have. If it fails the same way, search for the song again and pick one of the YouTube uploads listed under the songs, paste another copy of it, or download the audio yourself and upload it. |
| The video render failed, or takes very long | **Try Again** in Export. A render draws every frame, so a few minutes is normal; you can close the dialog while it runs, and a failed render keeps the previous video. |
| I don't know how to get the video onto YouTube | Render and download it, then follow **Upload to YouTube** under the finished video. See [Putting the video on YouTube](#putting-the-video-on-youtube). |
| Re-timing the lyrics or re-making the stems failed | The song keeps its previous timing and stems. Only one job runs on a song at a time: wait for it, then start again. |

## Features

### Stem separation

Pull audio from a YouTube, SoundCloud, Bandcamp, Vimeo or Internet Archive link (`yt-dlp`) or upload `.mp3`, `.wav`, `.flac`, `.m4a`, `.ogg`, `.opus` or `.aac`. A link must be one song: a track's own page, not a profile, an album or a playlist (an Internet Archive item that holds a whole concert is refused; open one of its tracks). The same link pasted again opens the song you already made. Most Vimeo videos need a sign-in the server doesn't have, so expect those to fail. A live stream is refused, and so is a recording longer than an hour (`MAX_SONG_MINUTES`), before anything is downloaded: paste a video of the song alone, not a whole album or concert.

**Search.** Typed words are searched as you type, in two public music catalogs that need no account or key: Deezer's search and Apple's iTunes Search. The results are songs, not videos: each recording is listed once (though both catalogs and several albums carry it) with its album, year and length, a 30-second preview, and a badge when it is a live take, a remix, an edit, a re-recording or another version. Misspellings are handled three ways: both catalogs search loosely, a misspelled search is respelled (from YouTube's search suggestions, or from the songs the typo did find) and searched both ways, and the list is ordered by how well each song's title and artist fit the words, typos allowed, so the song as released comes before live takes, remixes, covers, karaoke tracks and tribute acts unless you ask for one ("wonderwall live"). A line of the lyrics often works too. A song already in your library is marked and opens instead of being made again. Picking a song starts it like a Deezer or Apple Music link, described next, so it gets the catalog's title and artist and the upload of that very recording. **Search YouTube uploads**, under the songs, lists videos for anything the catalogs don't have; it is also what the search shows when no catalog can be reached. Each search sends the typed words from the server to Deezer, Apple and Google's suggestion service (`SONG_SEARCH_SOURCES` chooses which, and `none` keeps the search on YouTube alone), and your browser loads the artwork and previews straight from Deezer's and Apple's servers.

Spotify, Apple Music, TIDAL and Deezer can't be downloaded from, so a link to one of their songs is looked up instead: the studio reads the song's title, artist and length from the service and picks a YouTube upload of the same recording, never a cover, a live take, a remix or an upload more than 15 seconds longer or shorter. The song keeps the service's title and artist, which find the lyrics more reliably, and the song check-up names the upload that was used (with a tip when its length differs by a few seconds, which can mean another edit). If no upload matches, the song stops and says so; search for it and pick one of the YouTube uploads listed under the songs instead. Other streaming services (Amazon Music, Qobuz) aren't supported, so download the audio and upload it. The song is split into `vocals.wav` and `instrumental.wav` at the quality you pick in **Advanced options**:

| Preset | Engine | Time on CPU (4-min song) | Notes |
| :--- | :--- | :--- | :--- |
| **Fast** | Demucs `htdemucs` | about 1.5 min | Bundled. Some instrument bleed in the vocals. |
| **Balanced** *(default)* | Mel-Band RoFormer | about 6 min | Cleaner vocals, tidier backing track. Needs the ML extras. |
| **Best** | Mel-Band RoFormer + BS-RoFormer, averaged | about 25 min | Cleanest. A GPU is recommended. |

When a preset cannot run (extras not installed, weights unavailable, out of memory), separation falls back Best → Balanced → Fast and the studio says why. The Mix panel shows which model made a song's stems, and **Improve** re-makes them at another quality while the song stays playable. You can also re-time the lyrics against the new vocals or detect the chords again.

**Cloud GPU (optional).** On a slow CPU, Balanced and Best can run on a [Modal](https://modal.com) GPU instead: deploy `gpu/modal_app.py` with `modal deploy gpu/modal_app.py` (again after updates that change it, the RoFormer or aligner workers, `backend/requirements-ml.txt` or the fonts, as 2.8 did by adding Japanese fonts to the cloud renders), then set `SEPARATION_REMOTE=modal` and a Modal token in `.env`. The GPU runs the same RoFormer worker, progress streams back to the studio, and a 4-minute song takes about a minute on Balanced and two on Best, billed per second. The same GPU job also runs the neural lyric aligner's listening pass over the new vocals, so lyric sync on your server skips its slowest step (a few seconds of GPU time instead of minutes of CPU). If the GPU service is unreachable or no GPU is free within `SEPARATION_REMOTE_QUEUE_SEC`, the song falls back to Fast on your server.

### Lyrics and sync

- Lyrics come from LRCLIB, NetEase and `syncedlyrics`, or you paste plain text or LRC (enhanced LRC word tags are kept). A fan upload titled "Artist - Song" is searched by its artist, the cleanest of LRCLIB's versions wins, and NetEase's version is used when it writes out repeats that LRCLIB lists once. **Re-import** lists every version best first, with what looks wrong with each and which one the song uses.
- Fetched lyrics are tidied before they are timed: translation notes and "x2" markers go, lines too long to sing as one are split, all-caps lyrics become sentence case, and a Japanese (or other CJK) line's romaji in parentheses becomes a smaller row under it.
- **Neural alignment** (MMS forced alignment through torchaudio) places each word when the model is available. The **DSP aligner** (vocal energy, spectral flux and phrase snapping) is the fallback and the in-request engine. The model's listening pass over a stem is saved (`<data dir>/alignment_cache`, the 200 most recent songs, about 1.5 MB each), so re-timing lyrics or a single line later only runs the alignment.
- Every line gets a **confidence** score from how well the vocal stem supports its timing. The sync badge shows the song's average, a dot on each timeline row shows the line's, and **Needs review** filters the lines below 60%.
- The **song check-up**, the button next to the song's status badges, counts what looks off (missing lyrics, lines that may be out of time, singing without lyrics, stems that fell back and why, a failed background job) and has a button to the tool that fixes each. See [When results are off](#when-results-are-off).
- **Re-align this line** (row menu) finds where a line is really sung near its current place and applies the result as an undoable edit. Whole songs can be re-aligned in the background with the neural aligner while you keep working.
- Singing with no line to show (a hook the lyrics wrote once but the song repeats) is listed above the timeline as **Vocals without lyrics**; with the neural aligner, new songs get those repeats added as lines marked **Added repeat**.
- CJK lyrics are timed one character at a time, and the neural aligner times a line with romaji from its romaji.
- Lines you change by hand are marked as manual and keep your timing, also when the whole song is re-aligned or its stems are re-made with re-timed lyrics. Lines of two or more words that the editor only spread evenly (line-by-line tap-to-sync, new or retyped lines) still get their words placed by the aligner; a one-word line, such as an ad-lib, keeps its timing.

### Timeline editor

50-step undo and redo, live tap-to-sync (<kbd>T</kbd>), batch offsets, ±0.2 s and ±0.05 s nudges, an expandable per-word editor, splitting a line after any word and merging it with the next, inline text and chord editing, and duet parts (Singer 1, Singer 2, Both). New songs whose vocals clearly hold two voices get their parts by voice, **Duet parts → By Voice** assigns them later, and the parts can be given names in the track details, which the stage shows.

### Stage, themes and export

- Word-sweep or line-by-line highlighting, backing vocals and ad-libs (words in parentheses) drawn smaller and in italics, Japanese and other CJK lyrics swept per character with their romaji underneath, instrumental countdowns, an end card with the song's title after the last line, a beat visualizer (<kbd>V</kbd>), a transposing chord bar (<kbd>C</kbd>) and a fullscreen TV stage (<kbd>F</kbd>).
- Five app themes (**Afterglow**, **Basement Flyer**, **Reel-to-Reel '74**, **Midnight KTV Booth**, **Monolith Press**) and nine stage presets, with custom colours and font scale. Stage settings are remembered.
- Backgrounds: the song's **cover art**, still or **drifting** in a slow pan, **aurora** (soft orbs in the preset's colours), a **spectrum** that rises with the music, a **plain** colour, or your own image or looping video. The stage draws each one the way the video does: cover art is the export's own image, and moving backgrounds follow the song, so a paused stage shows the video's frame at that moment.
- Key shift (−12 to +12 semitones) and speed (0.5× to 1.5×), a 0–50% guide vocal, and the **Smart Key Recommender** that fits a song's vocal range to your voice. Final renders shift pitch with Rubber Band at high quality, keeping the guide vocal's formants.
- Exports: 1080p60 MP4 (16:9 or 9:16 Shorts) with the lyric sweep drawn for every frame, an **♪ Instrumental ♪** label through long gaps and the song's title through the outro (both with the countdown), lines too long for two rows drawn smaller, `.lrc` and `.ass` subtitles, WAV stems, chord and lyric sheets, and a YouTube metadata kit. **Render Again** makes a new video after you change the lyrics, key or look, and **Try Again** retries a failed render. A failed or cancelled render keeps the previous video, and the 16:9 and 9:16 videos are kept side by side, so rendering one format never replaces the other.
- **Cloud export (optional).** With `RENDER_REMOTE=modal` (same Modal deployment and token as the cloud GPU), MP4s render on a 16-core Modal CPU: about 1¼ minutes for a 3-minute song, around a cent each. Opening the Export dialog starts a cloud CPU in the background, so Modal finds one while you choose the options, and it stays ready for 2 minutes after each export. While the export waits for a CPU, the studio counts the seconds. If it is unavailable or fails, the export renders on your server.

### On your phone

- **Install it as an app.** On Android (Chrome), tap **Install** in the header on the library screen, or pick **Install app** from the command palette or the browser menu. On iPhone and iPad, open the studio in Safari, tap **Share**, then **Add to Home Screen**. Installing needs the studio served over HTTPS, and the installed app keeps its own sign-in, so you enter the passphrase once more there.
- **Share songs to it (Android).** Share a video from the YouTube app, or a song from SoundCloud, Bandcamp, Spotify, Apple Music, TIDAL or Deezer, to Karaoke Studio and it opens with the link in the search box; tap **Go** to start. A share from another app puts the shared words, such as the song's name, in the box and lists the songs they find.
- **Shortcuts on the icon.** Long-press the app icon (or right-click it in the taskbar or dock on a computer) for **New song**, **Upload audio** and **Continue last song**, which reopens the song this device had open last.
- **Feels like an app.** Back returns from a song to the library, the layout keeps clear of the notch and rounded corners, pull-to-refresh can't reload you mid-edit, the screen stays on while a song plays, the bar under Android's gesture pill takes the colour of your app theme (Chrome 153 or newer; after a theme change the installed app catches up within a day or so), and while your server is down or restarting the app shows a "Can't reach your studio" screen that reloads by itself when the server is back.
- **Updates.** A **Reload** toast appears once the server runs a newer build. Where the server applies its own updates (`SELF_UPDATE=1`), an **Update now** toast also appears as soon as GitHub has a newer version.

## Quick start

### One-command local launch

```bash
./run.sh
```

Checks FFmpeg, creates the Python environment, installs dependencies (CPU PyTorch by default), builds the frontend if needed, starts the server on port `8000` and opens your browser. Set `INSTALL_ML_EXTRAS=1` to also install the RoFormer extras for Balanced and Best, and `TORCH_INDEX_URL` to pick another PyTorch build (for example CUDA):

```bash
INSTALL_ML_EXTRAS=1 ./run.sh
```

### Docker Compose

```bash
docker compose up -d
```

The image includes the ML extras (build with `--build-arg INSTALL_ML_EXTRAS=0` for a smaller, Fast-only image). Model weights live in the `karaoke-models` volume, so they download once and survive rebuilds. To expose the app through a Cloudflare Tunnel, set `CLOUDFLARE_TUNNEL_TOKEN` in `.env` and run:

```bash
docker compose --profile tunnel up -d
```

To update a shared instance without cutting off anyone's song import or render, run `scripts/update_when_idle.sh` from the checkout (from cron or a systemd timer, say) instead of `git pull && docker compose up -d --build`. It builds the new image while the old container keeps serving, then pauses new songs, uploads, renders and re-made stems (everyone sees a notice; editing and playback keep working), waits until the running jobs finish or `UPDATE_DRAIN_MAX_SEC` passes, and only then recreates the container. If the build or the restart fails, the old container keeps serving and the next run tries again, until a fix is pushed. `--force` rebuilds without a new commit.

When the checkout's origin is on GitHub, the script moves to a new commit only once that commit's CI run has passed. A failed run keeps the install on the version it is running, and a run that is still going is waited for (`UPDATE_CI_WAIT_SEC`), then left for the next call. A commit whose run was seen failed or still going stays held back on later calls that cannot read a result. Otherwise, if there is no result to read (GitHub's API cannot be reached, or the commit has no CI run), the update goes ahead and the log says so. `UPDATE_REQUIRE_CI=0` turns the check off; `--force` does not.

### Manual development setup

```bash
# Backend (port 8000)
python3 -m venv venv
source venv/bin/activate
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements.txt
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements-ml.txt  # optional
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (proxies API requests to localhost:8000)
cd frontend
npm install
npm run dev
```

## Models and licences

Nothing is downloaded until it is first needed. Downloads go to persistent model folders (Docker: the `/models` volume).

| Model | Used for | Size | Licence | Folder |
| :--- | :--- | :--- | :--- | :--- |
| Demucs `htdemucs` | Fast | about 80 MB | MIT | `TORCH_HOME` |
| Mel-Band RoFormer | Balanced, Best | about 0.9 GB | third-party, see the model card | `AUDIO_SEPARATOR_MODEL_DIR` |
| BS-RoFormer | Best | about 0.6 GB | third-party, see the model card | `AUDIO_SEPARATOR_MODEL_DIR` |
| MMS forced aligner | neural lyric alignment | about 1.2 GB | **CC-BY-NC 4.0 (non-commercial)** | `ALIGNMENT_MODEL_DIR` |

- Review the model licences before any commercial use. The MMS aligner is for non-commercial use only. Set `ALIGNMENT_ENGINE=dsp` to never use it.
- To prefetch everything (for example while building an image, or for an offline server), run:

  ```bash
  python -m backend.tools.fetch_models --separation all --alignment
  ```

  Then set `SEPARATION_ALLOW_DOWNLOAD=0` and `ALIGNMENT_ALLOW_DOWNLOAD=0` so the server never downloads at run time.
- `GET /api/capabilities` reports what the server can run right now and why not; the intake picker and the re-align dialogs use it.

## Keyboard shortcuts

Shortcuts are ignored while you type in a field or while a dialog is open.

| Key | Action |
| :--- | :--- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek 5 seconds |
| <kbd>Shift</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | Seek 1 second |
| <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | Seek 15 seconds |
| <kbd>[</kbd> / <kbd>]</kbd> | Previous / next lyric line |
| <kbd>R</kbd> | Replay the current line |
| <kbd>M</kbd> | Mute / unmute |
| <kbd>F</kbd> | Fullscreen stage |
| <kbd>V</kbd> | Beat visualizer |
| <kbd>C</kbd> | Chord bar |
| <kbd>T</kbd> | Tap-to-sync stamp |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Y</kbd> | Undo / redo lyric or chord edits |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> | Command palette: every action, song and lyric line |
| <kbd>?</kbd> | Help and usage guide |
| Media keys | Play, pause, previous / next line, seek (MediaSession) |

In the song search on the home screen, <kbd>Enter</kbd> searches at once, <kbd>↓</kbd> moves from the box into the results and <kbd>↑</kbd> / <kbd>↓</kbd> between them, <kbd>Enter</kbd> starts the focused song, and <kbd>Esc</kbd> returns to the box (pressed there, it dismisses the results).

## Configuration

Copy `.env.example` to `.env`; it documents every setting.

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port for the web UI and API |
| `APP_PASSWORD` | *(empty)* | Optional shared passphrase (`HttpOnly` cookie session). Leave blank for open local access. |
| `SESSION_SECRET` | *(empty)* | Server secret session tokens are signed with, together with the passphrase. Empty uses a random secret the server creates in `<data dir>/.session_secret` on first sign-in. Changing either signs everyone out. |
| `SELF_UPDATE` | *(off)* | `1` where a host service applies updates written to `<data dir>/.update_requested` (as on the homelab). The studio then shows an **Update now** toast when GitHub's `main` is ahead of the running build. |
| `UPDATE_DRAIN_MAX_SEC` | `2700` | How long `scripts/update_when_idle.sh` waits for running jobs before it restarts the server anyway (jobs still running then are interrupted). New jobs stay paused while it waits. |
| `UPDATE_REQUIRE_CI` | `1` | `scripts/update_when_idle.sh` moves to a new commit only once its CI run on GitHub has passed. `0` updates without asking. |
| `UPDATE_CI_WAIT_SEC` | `900` | How long the script waits for a CI run that is still going before it leaves the update for its next call. |
| `UPDATE_CI_TOKEN` | *(empty)* | GitHub token the script reads the CI result with. Only a private repository needs one (read access to Actions); without it GitHub answers 404 and the update goes ahead unchecked. |
| `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` / `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `5` / `60.0` | Wrong passphrases allowed per IP and window, at login or in a header or cookie on any route (each distinct value counts once per window), before HTTP `429`. A client over the limit gets `429` even with valid credentials. |
| `FORWARDED_TRUSTED_HOPS` | `1` | Reverse proxies in front of the app that append to `X-Forwarded-For`; the rate limit keys on the entry this many places from the end. `2` for cloudflared in front of Nginx Proxy Manager, but only if Nginx Proxy Manager gets traffic from cloudflared alone: a client that reaches it directly (on the LAN, say) can pick its own rate-limit key with a forged header, so use `1` there. `0` to ignore the header and use the socket address. |
| `MAX_JSON_BODY_MB` | `16` | Largest request body outside the upload routes (which keep their own limits plus 1 MB); larger bodies get HTTP `413` before they are read. |
| `ALLOWED_HOSTS` | *(empty)* | Comma-separated host names the server answers to (`*.example.com` matches subdomains); other `Host` headers get HTTP `400`. Empty answers any host. Set it on an install without a passphrase to stop DNS rebinding, where a website points its own name at the server. `localhost`, `127.0.0.1` and `::1` always work. |
| `MAX_CONCURRENT_JOBS` | `2` | Separations, re-separations, re-alignments and renders running at once |
| `PREVIEW_AUDIO_FORMAT` | `wav` | What the studio streams: the WAV master, or `aac` for a 160 kbps `.m4a` copy (about 5 MB instead of 40 MB for a 4-minute song; each new mix takes a few seconds longer). Exports and videos always use the WAV. |
| `MIX_CACHE_PER_SONG` | `6` | Key and guide mixes kept per song (each about 40 MB for a 4-minute song, plus its `.m4a` copy); the least recently used are deleted first and the current mix is always kept. Applied after each remix and re-separation, and to every song when the server starts. `0` keeps every mix. |
| `KARAOKE_DATA_DIR` | `./workspace_data` | Audio, stems, renders and `projects.json` |
| `MAX_SONG_MINUTES` | `60` | The longest recording a pasted link may download, in minutes. A longer video is refused before anything is downloaded, as is a live stream; `0` lifts the length limit. Uploaded files have their own size limit. |
| `SONG_SEARCH_SOURCES` | `deezer,itunes,suggest` | The services the song search asks, comma-separated: `deezer` and `itunes` are the music catalogs the songs come from, `suggest` is YouTube's search suggestions, used to respell a misspelled search. Each search sends the typed words to the ones listed. `none` turns the catalog search off: the studio then lists YouTube uploads, as it does when no catalog answers. |
| `SONG_SEARCH_COUNTRY` | `us` | The iTunes Store whose songs are searched, as a two-letter country code (`gb`, `jp`, ...). |
| `DISK_MIN_FREE_MB` | `1024` | Free space (MB) to keep on the data folder's disk. Below it, new songs, uploads, renders and re-separations are refused with HTTP `507`; edits are never blocked. `0` turns the check off. |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(empty)* | Cloudflare tunnel token (Docker `--profile tunnel`) |
| `LOG_LEVEL` | `INFO` | Level of the app's own log lines |

**Stem separation**

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `SEPARATION_QUALITY` | `balanced` | Default preset for new songs: `fast`, `balanced` or `best` |
| `SEPARATION_ALLOW_DOWNLOAD` | `1` | Download RoFormer weights on first use |
| `AUDIO_SEPARATOR_MODEL_DIR` | `<data dir>/models/audio-separator` | Where RoFormer weights live |
| `SEPARATION_BALANCED_MODEL` / `SEPARATION_BEST_MODELS` | built-in | Override the RoFormer checkpoints |
| `SEPARATION_TIMEOUT_SEC` / `SEPARATION_STALL_SEC` | `7200` / `900` | Stop a separation that runs too long or prints nothing |
| `INSTALL_ML_EXTRAS` | Docker `1`, `run.sh` `0` | Install the RoFormer extras |
| `SEPARATION_REMOTE` | *(empty)* | `modal` runs Balanced and Best on a Modal GPU (deploy `gpu/modal_app.py` first) |
| `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` | *(empty)* | Modal token for the server |
| `SEPARATION_REMOTE_APP` | `karaoke-studio-gpu` | Name of the deployed Modal app |
| `SEPARATION_REMOTE_TIMEOUT_SEC` | `1800` | Longest a separation may run on the cloud GPU (read by `modal deploy`). `SEPARATION_TIMEOUT_SEC` on the server can only stop a job sooner |
| `SEPARATION_REMOTE_QUEUE_SEC` | `300` | Longest wait for a free GPU before falling back to Fast here |
| `SEPARATION_REMOTE_PREWARM` | `1` | Start a cloud GPU when a song's intake begins, so it is up by the time the audio has downloaded |

**Video export**

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `FFMPEG_PRESET` | `veryfast` | libx264 preset for MP4 exports (slower presets make smaller files) |
| `RENDER_REMOTE` | *(empty)* | `modal` renders exports on a Modal cloud CPU (deploy `gpu/modal_app.py` first) |
| `RENDER_REMOTE_QUEUE_SEC` | `120` | Longest wait for a cloud CPU before rendering here |
| `RENDER_REMOTE_TIMEOUT_SEC` | `3600` | Stop a cloud render that runs longer than this |
| `RENDER_REMOTE_PREWARM` | `1` | Start a cloud CPU when the Export dialog opens (at most once a minute) |
| `RENDER_REMOTE_SCALEDOWN_SEC` | `120` | How long an idle render container waits for the next export (read by `modal deploy`) |

**Lyric sync**

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `ALIGNMENT_ENGINE` | `auto` | `auto` / `ctc` use the neural aligner when available, `dsp` never does |
| `ALIGNMENT_ALLOW_DOWNLOAD` | `1` | Download the MMS model on first use |
| `ALIGNMENT_MODEL_DIR` | `<data dir>/models/mms_fa` | Where the MMS model lives |
| `ALIGNMENT_MIN_CONFIDENCE` | `0.45` | Model score from which neural word timing replaces the DSP estimate |
| `ALIGNMENT_TIMEOUT_SEC` / `ALIGNMENT_STALL_SEC` | `1800` / `600` | Stop a neural pass that runs too long or prints nothing |
| `MAX_CONCURRENT_ALIGN_JOBS` | `1` | Neural passes at once (each loads the model) |
| `ALIGN_REFINE_PLAIN` | `1` | Snap pasted, untimed lyrics to the sung phrases |
| `ALIGNMENT_SONG_PASS` | `1` | Also place every line in the whole song with the neural model, so lines far from the first estimate (and lyrics timed for another version) are found |

## API reference

The server hosts an interactive API reference at [`/api/docs`](http://localhost:8000/api/docs): every route with its request and response schemas, code samples, and a panel for sending test requests. The raw OpenAPI schema is at `/api/openapi.json`. Both need a session when `APP_PASSWORD` is set, so sign in to the studio first (the page uses its cookie) or enter the passphrase in the page's Authentication box.

## Tools

```bash
# Download model weights ahead of time
python -m backend.tools.fetch_models --separation all --alignment

# Measure lyric sync accuracy against hand-timed words (enhanced LRC or studio JSON)
python -m backend.tools.benchmark_sync --vocals vocals.wav --truth truth.lrc --engine both

# Measure stem quality (SI-SDR) per preset against reference stems
python -m backend.tools.benchmark_separation --mix song.wav --vocals ref_vocals.wav

# Seed a demo workspace with synthetic songs for UI work and screenshots
KARAOKE_DATA_DIR=/tmp/karaoke-demo python -m backend.tools.seed_demo
```

## System requirements

- **OS**: Linux, macOS, or Windows (WSL2)
- **Python**: 3.10+ (3.12 recommended)
- **Node.js**: 18+
- **FFmpeg**: with `libass` (subtitle burn-in) and ideally `rubberband` (high-quality pitch shifting in renders)
- **Disk space**: about 4 GB for dependencies and model weights, plus room for your songs. New songs, uploads, renders and re-separations stop while less than `DISK_MIN_FREE_MB` (1 GB by default) is free, and an edit that cannot be saved reports an error instead of being lost. Each song keeps about `MIX_CACHE_PER_SONG` key and guide mixes (6 by default; a song's current mix and any used in the last minute are never deleted, so it can hold a few more): extra ones go after each remix and re-separation, and for every song shortly after the server starts. A render deletes its scratch mix when it ends, and the server deletes what a restart left half-made (videos, mixes, re-separated stems) when it starts.
- **GPU**: optional. Best separation and neural alignment are much faster on one.

## Development and tests

```bash
# Backend tests and linter (the suite sets its own test passphrase)
pytest
ruff check backend && ruff format --check backend

# Frontend tests, linter, type check and production build
cd frontend
npm test && npm run lint && npm run format:check && npx tsc -p . --noEmit && npm run build
```

Releases are automated with [release-please](https://github.com/googleapis/release-please): commits on `main` follow Conventional Commits, a release PR collects them with the version bump and `CHANGELOG.md`, and merging it tags the release and publishes its notes.

Engines that need model weights are tested with fake worker processes, so the suites run offline. For the design system, routes, background jobs and worker protocols, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licence and disclaimer

For personal, educational and fair-use practice with media you own or have permission to use. Provided as-is under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE). Model weights downloaded at run time keep their own licences (see above).
