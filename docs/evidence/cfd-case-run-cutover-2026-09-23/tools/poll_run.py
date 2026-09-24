"""Poll one CFD run through the coordinator; print a line on every change and exit at a terminal status."""
import json
import os
import subprocess
import sys
import time

BASE = os.environ["CFD_COORDINATOR_BASE"].rstrip("/")  # coordinator origin, e.g. http://<canonical-host>:8004
run_id = sys.argv[1]
interval = int(sys.argv[2]) if len(sys.argv) > 2 else 60
prev = None
while True:
    try:
        raw = subprocess.run(["curl.exe", "-s", "-m", "15", f"{BASE}/api/cfd/runs/{run_id}"], capture_output=True, text=True, timeout=30).stdout
        d = json.loads(raw)
        s = d.get("status") or {}
        led = d.get("ledger") or {}
        st = s.get("status") or led.get("status")
        p = s.get("progress") or {}
        line = (f"{run_id} {st} done={p.get('directions_done')}/{p.get('directions_total')} "
                f"converged={s.get('converged_count')} container={s.get('current_container')} "
                f"failure={s.get('failure_code')} updated={s.get('updated_at') or led.get('updated_at')}")
    except Exception as exc:  # noqa: BLE001
        line = f"{run_id} poll-error {type(exc).__name__}: {exc}"
        st = None
    if line != prev:
        print(line, flush=True)
        prev = line
    if st in ("ready", "failed", "cancelled"):
        print(f"TERMINAL {run_id} {st}", flush=True)
        sys.exit(0)
    time.sleep(interval)
