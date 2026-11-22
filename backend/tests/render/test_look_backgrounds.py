"""How each look treats the picture behind the lyrics, and Cinema's picture frame."""

import subprocess

import pytest
from PIL import Image

from backend.services import look_backgrounds, video_renderer
from backend.services.stage_looks import LOOKS
from backend.services.video_renderer import (
    THUMBNAIL_LOOK,
    RenderJob,
    artwork_still,
    ffmpeg_args,
    prepare_background,
)
from backend.tests.helpers.libass_frames import needs_libass

FILL_1080 = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080"


def test_without_a_look_the_cover_art_is_drawn_as_it_always_was():
    assert artwork_still(1920, 1080) == (1920, 1080, f"{FILL_1080},{THUMBNAIL_LOOK}")
    assert artwork_still(1920, 1080, look_id="") == artwork_still(1920, 1080)


def test_ktv_keeps_the_blurred_cover_art():
    assert artwork_still(1920, 1080, look_id="ktv") == artwork_still(1920, 1080)
    assert artwork_still(1920, 1080, drift=True, look_id="ktv") == artwork_still(
        1920, 1080, drift=True
    )


def test_a_replaced_presets_id_gets_its_looks_treatment():
    assert artwork_still(1920, 1080, look_id="afterglow") == artwork_still(
        1920, 1080, look_id="marquee"
    )


def test_marquee_draws_the_cover_art_grey_dark_and_sharp():
    _w, _h, chain = artwork_still(1920, 1080, look_id="marquee")
    row = "0.0468:0.1573:0.0159:0"
    assert chain == f"{FILL_1080},colorchannelmixer={row}:{row}:{row}"
    assert "boxblur" not in chain


def test_songbook_washes_the_cover_art_into_its_paper():
    _w, _h, chain = artwork_still(1920, 1080, look_id="songbook")
    assert chain.endswith(
        "hue=s=0,format=rgb24,lutrgb=r=221.40+val*0.1:g=220.50+val*0.1:b=216.00+val*0.1"
    )


def test_prompter_blurs_the_cover_art_nearly_to_black():
    _w, _h, chain = artwork_still(1920, 1080, look_id="prompter")
    assert chain.endswith("boxblur=45:5,colorchannelmixer=rr=0.18:gg=0.18:bb=0.18")


def test_cinema_sets_a_sharp_picture_into_its_frame():
    rect = look_backgrounds.picture_rect(LOOKS["cinema"], 1920, 1080)
    assert rect == (0, 138, 1920, 804)
    width, height, chain = artwork_still(1920, 1080, look_id="cinema")
    assert (width, height) == (1920, 1080)
    assert chain == (
        "scale=1920:804:force_original_aspect_ratio=increase,crop=1920:804,"
        "pad=1920:1080:0:138:black"
    )
    tall = look_backgrounds.picture_rect(LOOKS["cinema"], 1080, 1920)
    assert tall == (0, 216, 1080, 1080)


def test_cinemas_drifting_still_is_the_picture_alone_and_is_framed_after_the_pan(tmp_path):
    width, height, chain = artwork_still(1920, 1080, drift=True, look_id="cinema")
    assert (width, height) == video_renderer.stage_backgrounds.overscan_size(1920, 804)
    assert "pad=" not in chain
    cover = tmp_path / "cover.png"
    Image.new("RGB", (64, 64), (200, 80, 40)).save(cover)
    background = prepare_background(
        tmp_path, 1920, 1080, str(cover), None, background_style="drift", look_id="cinema"
    )
    assert background.graph.endswith(",pad=1920:1080:0:138:black[bg];")
    assert "crop=1920:804" in background.graph


def test_only_cinema_frames_its_picture():
    for look_id, look in LOOKS.items():
        framed = look_backgrounds.picture_rect(look, 1920, 1080) is not None
        assert framed == (look_id == "cinema")
    assert look_backgrounds.picture_rect(None, 1920, 1080) is None


def test_an_uploaded_video_gets_the_looks_dim_and_frame(tmp_path):
    clip = tmp_path / "upload.mp4"
    clip.write_bytes(b"x")
    plain = prepare_background(tmp_path, 1920, 1080, None, str(clip))
    assert plain.graph == f"[0:v]{FILL_1080},fps=60[bg];"
    marquee = prepare_background(tmp_path, 1920, 1080, None, str(clip), look_id="marquee")
    assert marquee.graph == (
        f"[0:v]{FILL_1080},fps=60,colorchannelmixer=rr=0.45:gg=0.45:bb=0.45[bg];"
    )
    ktv = prepare_background(tmp_path, 1920, 1080, None, str(clip), look_id="ktv")
    assert ktv.graph == plain.graph
    cinema = prepare_background(tmp_path, 1920, 1080, None, str(clip), look_id="cinema")
    assert cinema.graph == (
        "[0:v]scale=1920:804:force_original_aspect_ratio=increase,crop=1920:804,fps=60,"
        "pad=1920:1080:0:138:black[bg];"
    )


def test_generated_backgrounds_are_drawn_in_cinemas_picture_and_framed(tmp_path):
    whole = prepare_background(tmp_path, 1920, 1080, None, None, background_style="aurora")
    framed = prepare_background(
        tmp_path, 1920, 1080, None, None, background_style="aurora", look_id="cinema"
    )
    assert whole.graph.endswith("scale=1920:1080:flags=bicubic[bg];")
    assert framed.graph.endswith("scale=1920:804:flags=bicubic,pad=1920:1080:0:138:black[bg];")
    assert framed.size == video_renderer.stage_backgrounds.low_res_size(1920, 804)
    marquee = prepare_background(
        tmp_path, 1920, 1080, None, None, background_style="aurora", look_id="marquee"
    )
    assert marquee.graph == whole.graph


def test_the_plain_style_is_the_ground_colour_whatever_the_look(tmp_path):
    for look_id in LOOKS:
        background = prepare_background(
            tmp_path, 1920, 1080, None, None, "#101010", "color", look_id=look_id
        )
        assert background.kind == "color" and background.graph == "[0:v]null[bg];"


def test_the_visualizer_sits_on_the_pictures_bottom_edge(tmp_path):
    def graph(picture):
        job = RenderJob(
            background=video_renderer.RenderBackground("color"),
            audio_path=tmp_path / "a.wav",
            ass_path=tmp_path / "s.ass",
            output_path=tmp_path / "o.mp4",
            width=1920,
            height=1080,
            duration=10.0,
            include_visualizer=True,
            picture=picture,
        )
        args = ffmpeg_args(job, None, "a.wav", "s.ass", None, "o.mp4")
        return args[args.index("-filter_complex") + 1]

    assert "overlay=0:H-240:format=auto" in graph(None)
    assert "overlay=0:942-240:format=auto" in graph((0, 138, 1920, 804))


@pytest.mark.parametrize(
    ("treatment", "ground", "expected"),
    [
        (None, "#000000", ""),
        ({"kind": "sharp"}, "#000000", ""),
        ({"kind": "blur"}, "#000000", THUMBNAIL_LOOK),
        ({"kind": "dim", "level": 0.35}, "#000000", "colorchannelmixer=rr=0.35:gg=0.35:bb=0.35"),
    ],
)
def test_a_treatment_is_a_filter_chain(treatment, ground, expected):
    assert look_backgrounds.treatment_chain(treatment, ground) == expected


@needs_libass
@pytest.mark.parametrize("look_id", list(LOOKS))
def test_each_looks_still_is_really_made_at_the_frames_size(tmp_path, look_id):
    cover = tmp_path / "cover.png"
    Image.new("RGB", (300, 300), (220, 120, 40)).save(cover)
    _w, _h, chain = artwork_still(1920, 1080, look_id=look_id)
    target = tmp_path / "still.png"
    video_renderer.render_still(cover, chain, target)
    with Image.open(target) as still:
        assert still.size == (1920, 1080)
        middle = still.convert("RGB").getpixel((960, 540))
        top = still.convert("RGB").getpixel((960, 10))
    if look_id == "cinema":
        assert top == (0, 0, 0) and middle == pytest.approx((220, 120, 40), abs=6)
    if look_id == "marquee":
        assert middle[0] == middle[1] == middle[2] and middle[0] < 60
    if look_id == "songbook":
        assert min(middle) > 200
    if look_id == "prompter":
        assert max(middle) < 60


def test_ffmpeg_accepts_every_looks_chain_for_an_uploaded_image(tmp_path):
    if not subprocess.run(["which", "ffmpeg"], capture_output=True, check=False).stdout:
        pytest.skip("FFmpeg is needed")
    upload = tmp_path / "upload.png"
    Image.new("RGB", (200, 120), (30, 160, 220)).save(upload)
    for look_id in LOOKS:
        work = tmp_path / look_id
        work.mkdir()
        background = prepare_background(work, 1920, 1080, None, str(upload), look_id=look_id)
        assert background.kind == "image" and background.path == work / "background.png"
        with Image.open(background.path) as made:
            assert made.size == (1920, 1080)
