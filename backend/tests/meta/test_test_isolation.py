"""The autouse fixture keeps every file a test writes under its temporary folder."""

from pathlib import Path

import backend.main as main_mod
from backend import config


def test_service_singletons_write_under_the_test_folder(tmp_path: Path):
    assert config.DATA_DIR.is_relative_to(tmp_path)
    assert main_mod.audio_mixer.output_dir == config.OUTPUT_DIR
    assert main_mod.video_renderer.output_dir == config.OUTPUT_DIR
    assert main_mod.separator.output_base_dir == config.STEMS_DIR
    assert main_mod.downloader.output_dir == config.DOWNLOADS_DIR
    for folder in (
        main_mod.audio_mixer.output_dir,
        main_mod.video_renderer.output_dir,
        main_mod.separator.output_base_dir,
        main_mod.downloader.output_dir,
    ):
        assert folder.is_relative_to(tmp_path)
