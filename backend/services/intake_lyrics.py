"""The lyrics pasted when a song was started, kept on the song until its lines are made.

An intake hands pasted lyrics straight to its pipeline, so a song that failed or was
cancelled had lost them by the time it was started again, and the second try fetched lyrics
instead. They stay on the song (``intake_lyrics``) while it is being made: a retry and an
album made as one song read them from there, and the pipeline forgets them once the song
has its lines, which hold the same words from then on.
"""

FIELD = "intake_lyrics"


def pasted(text: object) -> str | None:
    """The text when it holds lyrics, else None (nothing pasted, or only spaces)."""
    return text if isinstance(text, str) and text.strip() else None


def keep(proj: dict, text: object) -> None:
    """Keeps the lyrics pasted for the song; leaves the song alone when there are none."""
    lyrics = pasted(text)
    if lyrics is not None:
        proj[FIELD] = lyrics


def kept(proj: object) -> str | None:
    """The lyrics pasted when the song was started, if it still has them."""
    return pasted(proj.get(FIELD)) if isinstance(proj, dict) else None


def forget(proj: dict) -> None:
    """Drops the kept lyrics: the song's lines carry them now."""
    proj.pop(FIELD, None)
