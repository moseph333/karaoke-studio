# Bundled fonts

Fonts that exported karaoke videos use (`fonts/`), passed to FFmpeg's subtitles filter as
`fontsdir` so renders match the studio stage without installing system fonts.

| File | Family | Look | License |
|---|---|---|---|
| `SofiaSansExtraCondensed-Black.ttf`, `SofiaSans-Bold.ttf` | Sofia Sans 4.101 | Marquee | SIL OFL 1.1 (`licenses/SofiaSansExtraCondensed-OFL.txt`, `licenses/SofiaSans-OFL.txt`) |
| `MPLUSRounded1c-ExtraBold.ttf` | M PLUS Rounded 1c 1.060 (Latin, kana and kanji) | KTV | SIL OFL 1.1 (`licenses/MPLUSRounded1c-OFL.txt`) |
| `Newsreader-Medium.ttf`, `Newsreader-MediumItalic.ttf` | Newsreader 1.003, optical size 18 | Songbook | SIL OFL 1.1 (`licenses/Newsreader-OFL.txt`) |
| `Jost-Medium.ttf` | Jost 3.710 | Cinema | SIL OFL 1.1 (`licenses/Jost-OFL.txt`) |
| `AtkinsonHyperlegible-Bold.ttf` | Atkinson Hyperlegible 1.006 | Prompter | SIL OFL 1.1 (`licenses/AtkinsonHyperlegible-OFL.txt`) |

The files come from Google Fonts (`google/fonts`). M PLUS Rounded 1c and Atkinson
Hyperlegible are its static files as they are. Sofia Sans, Sofia Sans Extra Condensed and
Jost are cut from its variable fonts at one weight with fontTools' instancer; Newsreader is
cut at weight 500 and optical size 18 (the font's default, which a browser without the
optical-size axis draws too) and named "Newsreader Medium" by hand, upright and italic in one
family so `\i1` picks the real italic. None of the licences reserves a font name.

libass finds a static cut by its legacy family name, which holds the weight unless the weight
is Regular or Bold ("Sofia Sans Extra Condensed Black", "Jost Medium", "Rounded Mplus 1c
ExtraBold"). Those names, each face's metrics and every character's width are in
`shared/stage_font_metrics.json`, which the stage reads too; write it again with
`python -m backend.tools.font_metrics` after changing a font file
(`tests/looks/test_font_metrics.py` fails until you do), then the stage's case files with
`python -m backend.tools.stage_cases`.

A letter a face lacks is drawn by a system font (Noto CJK for Chinese, Korean and, outside
KTV, Japanese; Atkinson Hyperlegible has no macron vowels or dotted capital I, for instance).

## Fonts of the retired presets

`Sora-*.ttf`, `SpaceGrotesk-*.ttf`, `Montserrat-*.ttf` and `VT323-Regular.ttf` (each with its
OFL text in `licenses/`) were the fonts of the nine stage presets the five looks replaced.
No look uses them. They stay until production runs the looks, so that a Modal app deployed
from this tree still holds what the server it serves asks for; remove them afterwards.
