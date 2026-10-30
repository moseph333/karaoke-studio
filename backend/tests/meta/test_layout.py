"""The backend tests' layout: every test file lives in a feature folder, and test basenames
are unique across folders. pytest imports test files by basename (there is no __init__.py),
so two files called test_api.py in different folders would clash."""

from collections import Counter
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parents[1]


def _test_files() -> list[Path]:
    return [path for path in TESTS_DIR.rglob("test_*.py") if "__pycache__" not in path.parts]


def test_no_test_file_sits_at_the_top_level():
    assert sorted(path.name for path in TESTS_DIR.glob("test_*.py")) == []


def test_test_basenames_are_unique_across_folders():
    counts = Counter(path.name for path in _test_files())
    assert sorted(name for name, count in counts.items() if count > 1) == []


def test_there_is_no_init_py():
    assert sorted(str(path.relative_to(TESTS_DIR)) for path in TESTS_DIR.rglob("__init__.py")) == []
