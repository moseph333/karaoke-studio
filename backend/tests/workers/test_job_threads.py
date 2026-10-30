"""Long background jobs run on worker threads of their own (background_jobs.JOB_THREADS),
so a queue of them cannot use up the threads that sync request handlers share."""

import anyio
from anyio import from_thread, to_thread

import backend.main as main_mod
from backend.background_jobs import JOB_THREADS, run_job


def _thread_use() -> dict[str, int]:
    """From inside a job: tokens borrowed from the job and the shared request limiters."""
    shared = from_thread.run_sync(lambda: to_thread.current_default_thread_limiter())
    return {"job": JOB_THREADS.borrowed_tokens, "shared": shared.borrowed_tokens}


def test_run_job_runs_on_the_job_threads():
    seen = {}

    def job(value):
        seen["value"] = value
        seen.update(_thread_use())

    anyio.run(run_job, job, 7)

    assert seen == {"value": 7, "job": 1, "shared": 0}


def test_the_job_pool_is_separate_from_the_shared_threadpool():
    async def limiters():
        return to_thread.current_default_thread_limiter()

    assert anyio.run(limiters) is not JOB_THREADS
    assert JOB_THREADS.total_tokens >= 8


def test_intake_pipelines_start_on_the_job_threads(client, monkeypatch):
    seen = {}

    def fake_pipeline(project_id, url_or_id, custom_lyrics=None):
        seen["project"] = project_id
        seen.update(_thread_use())

    monkeypatch.setattr(main_mod, "run_pipeline", fake_pipeline)
    res = client.post("/api/process", json={"url_or_id": "dQw4w9WgXcQ"})

    assert res.status_code == 200
    assert seen == {"project": "dQw4w9WgXcQ", "job": 1, "shared": 0}


def test_every_long_job_site_uses_run_job():
    import ast
    import inspect

    from backend.routers import projects, quality, uploads

    first_args = []
    for module in (projects, quality, uploads):
        for node in ast.walk(ast.parse(inspect.getsource(module))):
            if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_task":
                first_args.append(ast.unparse(node.args[0]))

    # Everything but the render warm-up (one quick request) is a long job
    assert sorted(first_args) == ["remote_render.warm_up"] + ["run_job"] * 5
