"""A fake CTC worker process for tests of the neural lyric alignment (no torch, no weights).

install_fake_ctc() makes the neural engine look available and runs this script in place of
backend.workers.ctc_align_worker. It speaks both protocol versions: every line is "placed"
at its window start + 0.8 s (+ 0.4 s per word), and a version 2 request with "song" also
gets a song pass with the same placements (windows looked up by line index), so the song
pass agrees with the line windows unless a test says otherwise.

Environment knobs (set with monkeypatch.setenv):
    FAKE_CTC_MODE  ok (default) | lowscore | fail | silent | slow
    FAKE_CTC_SONG  how the song pass answers: "lowscore", "omit" (no "song" in the response),
                   "failed", "skipped", "malformed", or JSON {"<line index>": {"start": s,
                   "score": x}} to place given lines elsewhere (others as by default)
    FAKE_CTC_NULL  the song pass's null_score (default 0.05)
    FAKE_CTC_LOG   where to write the request it received
"""

import subprocess
import sys
import types

from backend.services import alignment_config

FAKE_CTC = r"""
import json, os, sys, time
args = sys.argv[1:]
request = json.load(open(args[args.index("--request") + 1]))
response_path = args[args.index("--response") + 1]
mode = os.environ.get("FAKE_CTC_MODE", "ok")
log = os.environ.get("FAKE_CTC_LOG")
if log:
    json.dump(request, open(log, "w"))

def event(**fields):
    sys.stderr.write(json.dumps(fields) + "\n")
    sys.stderr.flush()

if mode == "fail":
    event(event="error", code="import", detail="PyTorch/torchaudio could not be loaded: boom")
    sys.exit(4)
if mode == "silent":
    time.sleep(30)
if mode == "slow":
    for _ in range(300):
        event(event="stage", detail="Loading the neural aligner…")
        time.sleep(0.1)
event(event="download", detail="Downloading the MMS alignment model (first run only, ~1.2 GB)…")
lines = []
for n, line in enumerate(request["lines"], 1):
    words = []
    for i, w in enumerate(line["words"]):
        if not w:
            words.append(None)
            continue
        start = line["window_start"] + 0.8 + i * 0.4
        words.append({"start": round(start, 3), "end": round(start + 0.25, 3), "score": 0.9})
    score = 0.2 if mode == "lowscore" else 0.85
    lines.append({"index": line["index"], "status": "ok", "error": None, "line_score": score, "star_ratio": 0.3, "words": words})
    event(event="stage", done=n, total=len(request["lines"]), detail=f"Aligning words (neural) {n}/{len(request['lines'])}")
response = {"version": request.get("version", 1), "model": "MMS_FA", "lines": lines}
song_mode = os.environ.get("FAKE_CTC_SONG", "")
if request.get("version") == 2 and "song" in request and song_mode != "omit":
    windows = {line["index"]: line["window_start"] for line in request["lines"]}
    custom = json.loads(song_mode) if song_mode.startswith("{") else {}
    song_lines = []
    for line in request["song"]["lines"]:
        place = custom.get(str(line["index"]), {})
        start0 = place.get("start", windows.get(line["index"], 0.0) + 0.8)
        score = place.get("score", 0.1 if song_mode == "lowscore" else 0.85)
        words = []
        for i, w in enumerate(line["words"]):
            if not w:
                words.append(None)
                continue
            start = start0 + i * 0.4
            words.append({"start": round(start, 3), "end": round(start + 0.25, 3), "score": score})
        timed = [w for w in words if w]
        song_lines.append({"index": line["index"], "status": "ok", "line_score": score,
                           "start": timed[0]["start"], "end": timed[-1]["end"], "words": words})
    null = float(os.environ.get("FAKE_CTC_NULL", "0.05"))
    if song_mode == "failed":
        response["song"] = {"status": "failed", "error": "RuntimeError: boom", "lines": []}
    elif song_mode == "skipped":
        response["song"] = {"status": "skipped", "error": "too little audio for the words", "lines": []}
    elif song_mode == "malformed":
        response["song"] = {"status": "ok", "lines": "nope"}
    else:
        response["song"] = {"status": "ok", "error": None, "null_score": null, "lines": song_lines}
    response["emission"] = {"frames": 100, "seconds_per_frame": 0.02, "chunks": 1, "seconds": 0.1}
json.dump(response, open(response_path, "w"))
"""


def install_fake_ctc(tmp_path, monkeypatch):
    """Makes the neural engine available and routes its worker to the fake script. Returns
    a namespace with ``calls`` (each Popen) and ``log`` (the last request, as JSON)."""
    script = tmp_path / "fake_ctc.py"
    script.write_text(FAKE_CTC)
    state = types.SimpleNamespace(calls=[], log=tmp_path / "request.json")
    monkeypatch.setenv("FAKE_CTC_LOG", str(state.log))
    monkeypatch.setenv("ALIGNMENT_ENGINE", "auto")
    monkeypatch.setattr(alignment_config, "ctc_status", lambda: (True, None))
    real_popen = subprocess.Popen

    def popen(cmd, *args, **kwargs):
        state.calls.append({"cmd": list(cmd), "kwargs": kwargs})
        if "backend.workers.ctc_align_worker" in cmd:
            cmd = [sys.executable, str(script), *cmd[4:]]
        return real_popen(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", popen)
    return state
