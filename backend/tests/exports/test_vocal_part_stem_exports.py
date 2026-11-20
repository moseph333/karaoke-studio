"""Downloading the vocal parts a song has been split into."""

import os
import time

import pytest

import backend.main as main_mod
from backend.services import vocal_parts
from backend.tests.helpers.split_songs import make_song, wav


@pytest.fixture
def split_song():
    proj = make_song(main_mod, title="Starlight", artist="Luna")
    stems = main_mod.STEMS_DIR / "vs1"
    plan = vocal_parts.split_plan("lead_backing")
    vocal_parts.install(
        stems,
        "lead_backing",
        wav(stems / "work" / "a.wav", 0.2),
        wav(stems / "work" / "b.wav", 0.1),
        vocal_parts.split_record("lead_backing", plan, 3),
    )
    return {"proj": proj, "stems": stems}


@pytest.mark.parametrize(
    ("stem_type", "name", "words"),
    [
        ("lead_vocals", "vocals_lead.wav", "Lead Vocals"),
        ("backing_vocals", "vocals_backing.wav", "Backing Vocals"),
    ],
)
def test_each_part_downloads_under_its_own_name(client, split_song, stem_type, name, words):
    res = client.get(f"/api/project/vs1/export/audio/{stem_type}")

    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert res.content == (split_song["stems"] / name).read_bytes()
    disposition = res.headers["content-disposition"]
    assert "attachment" in disposition
    assert f"Starlight ({words})" in disposition


def test_a_song_without_parts_has_none_to_download(client):
    make_song(main_mod)

    res = client.get("/api/project/vs1/export/audio/backing_vocals")

    assert res.status_code == 400
    assert res.json()["detail"] == "Audio file for backing_vocals not found on disk"


def test_parts_of_vocals_that_were_remade_since_are_not_offered(client, split_song):
    stale = time.time() - 3600
    for name in ("vocals_lead.wav", "vocals_backing.wav"):
        os.utime(split_song["stems"] / name, (stale, stale))

    assert client.get("/api/project/vs1/export/audio/lead_vocals").status_code == 400


def test_an_unknown_stem_type_lists_every_type(client, split_song):
    res = client.get("/api/project/vs1/export/audio/drums")

    assert res.status_code == 400
    assert res.json()["detail"] == (
        "Invalid stem type 'drums'. Allowed: 'instrumental', 'vocals', 'master', "
        "'lead_vocals', 'backing_vocals', 'male_vocals', 'female_vocals'"
    )


def test_the_male_and_female_voices_download_once_they_are_split(client, split_song):
    stems = split_song["stems"]
    assert client.get("/api/project/vs1/export/audio/male_vocals").status_code == 400
    vocal_parts.install(
        stems,
        "male_female",
        wav(stems / "work" / "m.wav", 0.15),
        wav(stems / "work" / "f.wav", 0.05),
        {"model": "duet", "source": "lead"},
    )

    for stem_type, name, words in (
        ("male_vocals", "vocals_male.wav", "Male Vocals"),
        ("female_vocals", "vocals_female.wav", "Female Vocals"),
    ):
        res = client.get(f"/api/project/vs1/export/audio/{stem_type}")
        assert res.status_code == 200
        assert res.content == (stems / name).read_bytes()
        assert f"Starlight ({words})" in res.headers["content-disposition"]
