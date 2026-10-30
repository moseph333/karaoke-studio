# Bundled fonts

Fonts that exported karaoke videos use (`fonts/`), passed to FFmpeg's subtitles filter as
`fontsdir` so renders match the studio stage without installing system fonts.

| File | Family | Used by | License |
|---|---|---|---|
| `Sora-Regular.ttf`, `Sora-Bold.ttf` | Sora 2.000 | Afterglow theme | SIL OFL 1.1 (`licenses/Sora-OFL.txt`) |
| `SpaceGrotesk-Regular.ttf`, `SpaceGrotesk-Bold.ttf` | Space Grotesk | Monolith Press (`clean_paper`) | SIL OFL 1.1 (`licenses/SpaceGrotesk-OFL.txt`) |
| `Montserrat-Regular.ttf`, `Montserrat-Bold.ttf` | Montserrat | Modern Gold, Cyber Cyan, Neon Sunset, Classic KTV (the default font) | SIL OFL 1.1 (`licenses/Montserrat-OFL.txt`) |
| `VT323-Regular.ttf` | VT323 | Midnight KTV Booth (`crt_ktv`) | SIL OFL 1.1 (`licenses/VT323-OFL.txt`) |

The static instances come from Google Fonts. Lyrics are drawn bold: libass picks each
family's Bold file (VT323 has one weight, which libass emboldens like the browser does).
Basement Flyer (Impact) and Reel-to-Reel '74 (Georgia) name fonts that are not free to
redistribute; renders fall back to the system's fonts for those.
