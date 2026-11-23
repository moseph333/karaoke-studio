"""The cloud function that makes song loops, read from gpu/modal_app.py: what the server
and the function must agree on."""

import ast

from backend.services.process_watchdog import PROJECT_ROOT

MODAL_APP = (PROJECT_ROOT / "gpu" / "modal_app.py").read_text(encoding="utf-8")


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(MODAL_APP)
    return next(
        node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name
    )


def test_every_argument_has_a_default():
    """So a server that sends fewer arguments than a newer deployment knows still gets a loop."""
    args = _function("song_loop").args
    names = [arg.arg for arg in args.args]
    assert names[:8] == ["lyrics", "title", "artist", "prompt", "model", "seed", "lines", "warmup"]
    assert len(args.defaults) == len(names)


def test_a_warm_up_returns_before_anything_runs():
    body = ast.unparse(_function("song_loop"))
    assert body.index("if warmup:") < body.index("lines.put(STARTED)")
    assert body.index("lines.put(STARTED)") < body.index("subprocess.Popen")


def test_it_runs_the_worker_and_returns_what_the_worker_recorded():
    body = ast.unparse(_function("song_loop"))
    assert "'backend.workers.song_loop_worker'" in body
    for flag in ("--out", "--model-dir", "--lyrics-file", "--prompt", "--model", "--seed"):
        assert f"'{flag}'" in body
        assert flag in _worker_flags()
    assert "result.json" in body and "result['video']" in body
    assert "weights.commit()" in body


def _worker_flags() -> set[str]:
    source = (PROJECT_ROOT / "backend" / "workers" / "song_loop_worker.py").read_text()
    return {
        node.value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.startswith("--")
    }


def test_the_image_uploads_the_worker_it_runs():
    assert '"/app/backend/workers/song_loop_worker.py"' in MODAL_APP
    assert "SONG_LOOP_REMOTE_GPUS" in MODAL_APP and "SONG_LOOP_REMOTE_TIMEOUT_SEC" in MODAL_APP
