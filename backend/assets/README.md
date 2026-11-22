# Bundled fonts

Fonts that exported karaoke videos use (`fonts/`), passed to FFmpeg's subtitles filter as
`fontsdir` so renders match the studio stage without installing system fonts.

| File | Family | Used by | License |
|---|---|---|---|
| `Sora-Regular.ttf`, `Sora-Bold.ttf` | Sora 2.000 | Afterglow theme | SIL OFL 1.1 (`licenses/Sora-OFL.txt`) |
| `SpaceGrotesk-Regular.ttf`, `SpaceGrotesk-Bold.ttf` | Space Grotesk | Monolith Press (`clean_paper`) | SIL OFL 1.1 (`licenses/SpaceGrotesk-OFL.txt`) |
| `Montserrat-Regular.ttf`, `Montserrat-Bold.ttf` | Montserrat | Modern Gold, Cyber Cyan, Neon Sunset, Classic KTV (the default font) | SIL OFL 1.1 (`licenses/Montserrat-OFL.txt`) |
| `VT323-Regular.ttf` | VT323 | Midnight KTV Booth (`crt_ktv`) | SIL OFL 1.1 (`licenses/VT323-OFL.txt`) |

| `SofiaSansExtraCondensed-Black.ttf`, `SofiaSans-Bold.ttf` | Sofia Sans 4.101 | Marquee | SIL OFL 1.1 (`licenses/SofiaSansExtraCondensed-OFL.txt`, `licenses/SofiaSans-OFL.txt`) |
| `MPLUSRounded1c-ExtraBold.ttf` | M PLUS Rounded 1c 1.060 (Latin, kana and kanji) | KTV | SIL OFL 1.1 (`licenses/MPLUSRounded1c-OFL.txt`) |
| `Newsreader-Medium.ttf`, `Newsreader-MediumItalic.ttf` | Newsreader 1.003, optical size 18 | Songbook | SIL OFL 1.1 (`licenses/Newsreader-OFL.txt`) |
| `Jost-Medium.ttf` | Jost 3.710 | Cinema | SIL OFL 1.1 (`licenses/Jost-OFL.txt`) |
| `AtkinsonHyperlegible-Bold.ttf` | Atkinson Hyperlegible 1.006 | Prompter | SIL OFL 1.1 (`licenses/AtkinsonHyperlegible-OFL.txt`) |

The first four rows are the fonts of the presets the five looks replace; they stay until
production runs the looks.

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
(`tests/looks/test_font_metrics.py` fails until you do).

The static instances come from Google Fonts. Lyrics are drawn bold: libass picks each
family's Bold file (VT323 has one weight, which libass emboldens like the browser does).
Basement Flyer (Impact) and Reel-to-Reel '74 (Georgia) name fonts that are not free to
redistribute; renders fall back to the system's fonts for those.
