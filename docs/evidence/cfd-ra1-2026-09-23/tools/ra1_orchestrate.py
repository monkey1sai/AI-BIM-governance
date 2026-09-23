"""R-A1 orchestration on 181: idle-before x3 → 2-direction CFD run, solving x3 → cancel → idle-after x3.

Each trial runs ra1_probe.mjs (real Chrome) and, 12 s into the trial, one read-only SSH host sample (load average,
top processes by %CPU with short command names, docker CPU%, GPU utilisation). 60 s between trials so the previous
primary viewer lease (45 s TTL) has expired. Outputs go to artifacts/e2e/cfd-ra1-181/ (local, gitignored).
"""
import json, os, pathlib, shutil, subprocess, time, urllib.request, urllib.error
from datetime import datetime, timezone

MAIN = pathlib.Path(__file__).resolve().parents[4]  # repo root (docs/evidence/<dir>/tools/<file>)
VIEWER = MAIN / "web-viewer-sample"
OUT = MAIN / "artifacts" / "e2e" / "cfd-ra1-181"
PROBE_SRC = pathlib.Path(__file__).with_name("ra1_probe.mjs")
PROBE_DST = VIEWER / "e2e" / "_scratch_ra1_probe.mjs"
COORD = os.environ["E2E_COORDINATOR_BASE_URL"]  # e.g. http://<canonical-host>:8004
SESSION = os.environ["CFD_E2E_SESSION_ID"]
CONVERSION = os.environ["RA1_CONVERSION_JOB_ID"]  # ready conversion job the load run is created for
HOST = os.environ["RA1_SSH_HOST"]  # host alias from the operator ssh config (read-only sampling)
TRIALS = 3
GAP_S = 60
SAMPLE_CMD = (
    "cat /proc/loadavg; echo '--top'; top -bn1 -o %CPU -w 512 | awk 'NR>7 && NR<=17 {print $9, $12}'; "
    "echo '--docker'; docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}'; "
    "echo '--gpu'; nvidia-smi --query-gpu=utilization.gpu,utilization.encoder --format=csv,noheader 2>/dev/null "
    "|| nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader"
)


def log(msg):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%SZ')}] {msg}", flush=True)


def api(method, path, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(COORD + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def host_sample():
    try:
        out = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", HOST, SAMPLE_CMD],
                             capture_output=True, text=True, timeout=40).stdout
    except Exception as exc:  # sampling must never break the measurement
        return {"error": str(exc)}
    sample = {"utc": datetime.now(timezone.utc).isoformat(), "top": [], "docker": [], "gpu": None}
    section = "load"
    for line in out.splitlines():
        if line.startswith("--"):
            section = line[2:]
            continue
        if section == "load" and line.strip():
            parts = line.split()
            sample["loadavg_1_5_15"] = [float(x) for x in parts[:3]]
        elif section == "top" and line.strip():
            cpu, _, cmd = line.partition(" ")
            try:
                sample["top"].append({"cpu_pct": float(cpu), "command": cmd.strip()[:40]})
            except ValueError:
                pass
        elif section == "docker" and line.strip():
            name, _, cpu = line.rpartition(" ")
            sample["docker"].append({"name": name, "cpu_pct": cpu})
        elif section == "gpu" and line.strip():
            sample["gpu"] = line.strip()
    return sample


def run_trial(label, trial, run_id=""):
    env = dict(os.environ, RA1_LABEL=label, RA1_TRIAL=str(trial), RA1_OUT=str(OUT), RA1_RUN_ID=run_id,
               CFD_E2E_SESSION_ID=SESSION, E2E_COORDINATOR_BASE_URL=COORD)
    proc = subprocess.Popen(["node", str(PROBE_DST)], cwd=VIEWER, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, shell=False)
    time.sleep(12)
    sample = host_sample()
    out, _ = proc.communicate(timeout=300)
    path = OUT / f"{label}-{trial}.json"
    result = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"label": label, "trial": trial, "error": "no result file", "stdout_tail": out[-500:]}
    result["host_sample"] = sample
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    log(f"{label}-{trial}: exit={proc.returncode} primary={result.get('lease_primary')} ff={result.get('first_frame_ms')} "
        f"ack_med={(result.get('ack') or {}).get('median_ms')} p95={(result.get('ack') or {}).get('p95_ms')} "
        f"fps={(result.get('video') or {}).get('rvfc_fps')} load={sample.get('loadavg_1_5_15')} err={result.get('error')}")
    return result


def phase(label, run_id=""):
    for i in range(1, TRIALS + 1):
        run_trial(label, i, run_id)
        if i < TRIALS:
            time.sleep(GAP_S)


def wait_status(run_id, wanted, timeout_s):
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        code, body = api("GET", f"/api/cfd/runs/{run_id}")
        status = (body.get("status") or {}).get("status") or (body.get("ledger") or {}).get("status")
        if status != last:
            log(f"run {run_id} status={status}")
            last = status
        if status in wanted:
            return status
        if status in ("failed", "cancelled", "ready") and status not in wanted:
            return status
        time.sleep(20)
    return last


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PROBE_SRC, PROBE_DST)
    plan = {"schema": "cfd-ra1-plan/v1", "trials_per_condition": TRIALS, "gap_s": GAP_S, "session_id": SESSION, "started_utc": datetime.now(timezone.utc).isoformat()}
    try:
        log("phase idle-before")
        phase("idle-before")
        time.sleep(GAP_S)
        body = {
            "schema": "cfd-run-request/v1", "idempotency_key": "ra1-181-2dir-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
            "source": {"conversion_job_id": CONVERSION}, "preprocess": {"profile": "exterior-wind/v1"},
            "wind": {"wind_from_degrees": [0, 90], "uref_m_s": 5.0, "zref_m": 10.0, "z0_m": 0.5, "true_north_source": "geo_reference"},
            "mesh": {}, "solver": {}, "origin": {"session_id": None},
        }
        code, created = api("POST", "/api/cfd/runs", body, timeout=60)
        run_id = created.get("run_id")
        plan["run"] = {"create_status": code, "run_id": run_id, "request": {k: body[k] for k in ("wind", "mesh", "solver")}}
        log(f"run created status={code} run_id={run_id}")
        if code not in (200, 202) or not run_id:
            raise SystemExit(f"run creation failed: {code} {created}")
        plan["run"]["phase_reached"] = wait_status(run_id, {"solving"}, 40 * 60)
        if plan["run"]["phase_reached"] != "solving":
            raise SystemExit(f"run never reached solving: {plan['run']['phase_reached']}")
        time.sleep(30)  # let the solver ramp up to its 4 processes
        log("phase cfd-solving")
        phase("cfd-solving", run_id)
        code, cancelled = api("POST", f"/api/cfd/runs/{run_id}/cancel", {})
        plan["run"]["cancel_status"] = code
        log(f"cancel status={code}")
        plan["run"]["final_status"] = wait_status(run_id, {"cancelled"}, 10 * 60)
        time.sleep(GAP_S)
        plan["host_after_cancel"] = host_sample()
        log("phase idle-after")
        phase("idle-after")
    finally:
        PROBE_DST.unlink(missing_ok=True)
        plan["finished_utc"] = datetime.now(timezone.utc).isoformat()
        (OUT / "plan.json").write_text(json.dumps(plan, indent=2), encoding="utf-8")
        log("done")


if __name__ == "__main__":
    main()
