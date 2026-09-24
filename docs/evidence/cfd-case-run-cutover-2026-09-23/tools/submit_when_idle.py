"""Wait until the 181 CFD queue is idle, submit one run from a body file, then follow it to a terminal status.

Usage: submit_when_idle.py <body.json> <x-trace-id> <poll_seconds>
Fail-closed: exits non-zero without submitting if the body file is missing or not JSON, or if the queue never goes idle
within 90 minutes. Submits exactly once; prints the run id and every status change; ends with TERMINAL <run> <status>.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

BASE = os.environ["CFD_COORDINATOR_BASE"].rstrip("/")  # coordinator origin, e.g. http://<canonical-host>:8004
body_path, trace_id, interval = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
body = json.loads(body_path.read_text(encoding="utf-8"))  # raises (no submit) when missing or malformed
assert body.get("idempotency_key"), "body has no idempotency_key"


def get(url: str) -> dict:
    raw = subprocess.run(["curl.exe", "-s", "-m", "15", url], capture_output=True, text=True, timeout=30).stdout
    return json.loads(raw)


deadline = time.time() + 90 * 60
last_busy = None
while True:
    try:
        items = get(f"{BASE}/api/cfd/runs?limit=50").get("items") or []
        busy = [(i.get("run_id"), i.get("status")) for i in items if i.get("status") not in ("ready", "failed", "cancelled")]
    except Exception as exc:  # noqa: BLE001
        busy = [("poll-error", f"{type(exc).__name__}")]
    if not busy:
        break
    if time.time() > deadline:
        print(f"GAVE-UP queue still busy: {busy}", flush=True)
        sys.exit(2)
    if busy != last_busy:
        print(f"waiting: {busy}", flush=True)
        last_busy = busy
    time.sleep(interval)

reply = subprocess.run(
    ["curl.exe", "-s", "-m", "30", "-w", "\n%{http_code}", "-H", "Content-Type: application/json", "-H", f"x-trace-id: {trace_id}",
     "--data-binary", f"@{body_path}", f"{BASE}/api/cfd/runs"],
    capture_output=True, text=True, timeout=60,
).stdout
text, _, code = reply.rpartition("\n")
if code.strip() not in ("200", "202"):
    print(f"SUBMIT-FAILED HTTP {code.strip()}: {text[:300]}", flush=True)
    sys.exit(3)
run_id = json.loads(text)["run_id"]
print(f"SUBMITTED {run_id} HTTP {code.strip()}", flush=True)

prev = None
while True:
    try:
        s = get(f"{BASE}/api/cfd/runs/{run_id}").get("status") or {}
        line = f"{run_id} {s.get('status')} done={(s.get('progress') or {}).get('directions_done')} failure={s.get('failure_code')} updated={s.get('updated_at')}"
        st = s.get("status")
    except Exception as exc:  # noqa: BLE001
        line, st = f"{run_id} poll-error {type(exc).__name__}", None
    if line != prev:
        print(line, flush=True)
        prev = line
    if st in ("ready", "failed", "cancelled"):
        print(f"TERMINAL {run_id} {st}", flush=True)
        sys.exit(0)
    time.sleep(interval)
