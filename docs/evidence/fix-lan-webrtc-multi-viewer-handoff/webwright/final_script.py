from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / "bim-review-coordinator").is_dir() and (candidate / "web-viewer-sample").is_dir():
            return candidate
    raise RuntimeError(f"Could not find repo root from {start}")


def next_run_dir(workspace: Path) -> Path:
    final_runs = workspace / "final_runs"
    final_runs.mkdir(parents=True, exist_ok=True)
    existing = []
    for item in final_runs.glob("run_*"):
        if item.is_dir():
            try:
                existing.append(int(item.name.removeprefix("run_")))
            except ValueError:
                pass
    run_dir = final_runs / f"run_{max(existing, default=0) + 1}"
    (run_dir / "screenshots").mkdir(parents=True)
    return run_dir


def write_log(log_file: Path, message: str) -> None:
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(f"{message}\n")
    print(message, flush=True)


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def repo_relative(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return path.name


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def detect_lan_ipv4() -> str | None:
    candidates: list[str] = []
    hostname = socket.gethostname()
    try:
        for family, _, _, _, sockaddr in socket.getaddrinfo(hostname, None):
            if family == socket.AF_INET:
                address = sockaddr[0]
                if not address.startswith("127."):
                    candidates.append(address)
    except socket.gaierror:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            address = sock.getsockname()[0]
            if address and not address.startswith("127."):
                candidates.insert(0, address)
    except OSError:
        pass

    for address in candidates:
        if address and not address.startswith("127."):
            return address
    return None


def http_json(url: str, method: str = "GET", payload: dict[str, Any] | None = None, timeout: float = 10.0) -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def redirect_location(url: str, timeout: float = 10.0) -> tuple[int, str]:
    opener = urllib.request.build_opener(NoRedirect)
    try:
        opener.open(url, timeout=timeout)
    except urllib.error.HTTPError as error:
        return int(error.code), error.headers.get("Location", "")
    raise RuntimeError(f"Expected redirect from {url}")


def wait_http(url: str, timeout_seconds: float, log_file: Path, label: str) -> None:
    deadline = time.time() + timeout_seconds
    last_error = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    write_log(log_file, f"step wait {label}: ready {url} status={response.status}")
                    return
        except Exception as exc:  # noqa: BLE001 - diagnostics are written to the evidence log.
            last_error = repr(exc)
        time.sleep(0.5)
    raise TimeoutError(f"Timed out waiting for {label} at {url}. last_error={last_error}")


def wait_participants(coordinator_local: str, session_id: str, min_count: int, timeout_seconds: float) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    last_session: dict[str, Any] = {}
    while time.time() < deadline:
        last_session = http_json(f"{coordinator_local}/api/review-sessions/{session_id}")
        if len(last_session.get("participants", [])) >= min_count:
            return last_session
        time.sleep(0.5)
    return last_session


def append_query(url: str, **params: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    return urllib.parse.urlunsplit((
        parsed.scheme,
        parsed.netloc,
        parsed.path,
        urllib.parse.urlencode(query),
        parsed.fragment,
    ))


def start_process(
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    stdout_path: Path,
    stderr_path: Path,
) -> subprocess.Popen[Any]:
    stdout = stdout_path.open("w", encoding="utf-8")
    stderr = stderr_path.open("w", encoding="utf-8")
    try:
        return subprocess.Popen(
            command,
            cwd=str(cwd),
            env=env,
            stdout=stdout,
            stderr=stderr,
            text=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
    except Exception:
        stdout.close()
        stderr.close()
        raise


def stop_process(process: subprocess.Popen[Any] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def session_payload(stage_host: str) -> dict[str, Any]:
    return {
        "project_id": "project_webwright_001",
        "model_version_id": "version_webwright_001",
        "created_by": "webwright_validation",
        "artifact_bindings": [
            {
                "artifact_group_id": "ag_webwright_001",
                "artifact_id": "usdc_webwright_ready_001",
                "artifact_role": "derived",
                "url": f"http://{stage_host}:49101/artifacts/webwright/model.usdc",
                "mapping_url": f"http://{stage_host}:49101/artifacts/webwright/element_mapping.json",
                "load_order": 0,
                "ready_status": "ready",
                "conversion_authority": "bim-streaming-server",
                "conversion_job_id": "conv_webwright_ready_001",
                "conversion_status": "ready",
            }
        ],
        "quality_metrics_summary": {
            "fixture_name": "webwright-ready-fixture.ifc",
            "conversion_job_id": "conv_webwright_ready_001",
            "artifact_group_id": "ag_webwright_001",
            "source_ifc_entity_count": 1,
            "sidecar_carrier_count": 1,
            "materialization_strategy": "sidecar",
            "coverage_ratio": 1,
            "coverage_status": "pass",
            "conversion_duration_seconds": 1,
        },
    }


def inspect_video(page) -> list[dict[str, Any]]:  # type: ignore[no-untyped-def]
    return page.evaluate(
        """
        () => Array.from(document.querySelectorAll('video')).map((video) => ({
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          currentTime: video.currentTime,
          paused: video.paused,
          srcObject: Boolean(video.srcObject),
        }))
        """
    )


def wait_for_video_frame(page, timeout_ms: int) -> bool:  # type: ignore[no-untyped-def]
    try:
        page.wait_for_function(
            """
            () => Array.from(document.querySelectorAll('video')).some((video) =>
              video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
              && video.videoWidth > 0
              && video.videoHeight > 0
            )
            """,
            timeout=timeout_ms,
        )
        return True
    except PlaywrightTimeoutError:
        return False


def attach_page_diagnostics(page, label: str, report: dict[str, Any]) -> None:  # type: ignore[no-untyped-def]
    diagnostics = report.setdefault("browser_diagnostics", {})
    diagnostics[label] = {"console": [], "page_errors": []}

    def record_console(message) -> None:  # type: ignore[no-untyped-def]
        diagnostics[label]["console"].append({
            "type": message.type,
            "text": message.text,
        })

    def record_error(error) -> None:  # type: ignore[no-untyped-def]
        diagnostics[label]["page_errors"].append(str(error))

    page.on("console", record_console)
    page.on("pageerror", record_error)


def run(args: argparse.Namespace) -> int:
    workspace = Path(__file__).resolve().parent
    repo_root = find_repo_root(workspace)
    run_dir = next_run_dir(workspace)
    log_file = run_dir / "final_script_log.txt"
    shutil.copy2(Path(__file__).resolve(), run_dir / "final_script.py")

    write_log(log_file, "step 0 params: repo_root=<repo>")
    public_host = args.public_host or detect_lan_ipv4() or "127.0.0.1"
    lan_mode = not public_host.startswith("127.")
    coordinator_port = args.coordinator_port or free_port()
    viewer_port = args.viewer_port or free_port()
    coordinator_public = f"http://{public_host}:{coordinator_port}"
    viewer_public = f"http://{public_host}:{viewer_port}"
    coordinator_local = f"http://127.0.0.1:{coordinator_port}"
    viewer_local = f"http://127.0.0.1:{viewer_port}"
    write_log(log_file, f"step 1 network: public_host={public_host} lan_mode={lan_mode}")

    data_dir = run_dir / "runtime-data"
    coordinator_env = os.environ.copy()
    kit_instance_endpoints = [
        {
            "id": "kit_local_001",
            "signalingServer": public_host,
            "signalingPort": args.kit_signaling_port,
            "mediaServer": public_host,
            "mediaPort": args.kit_media_port or None,
        }
    ]
    if args.spectator_signaling_port:
        kit_instance_endpoints.append({
            "id": "kit_local_001_spectator_001",
            "signalingServer": public_host,
            "signalingPort": args.spectator_signaling_port,
            "mediaServer": public_host,
            "mediaPort": args.spectator_media_port or None,
        })
    coordinator_env.update(
        {
            "HOST": "0.0.0.0",
            "PORT": str(coordinator_port),
            "PUBLIC_HOST": public_host,
            "VIEWER_PORT": str(viewer_port),
            "VIEWER_PUBLIC_BASE_URL": viewer_public,
            "COORDINATOR_PUBLIC_BASE_URL": coordinator_public,
            "KIT_STREAM_SERVER": public_host,
            "KIT_MEDIA_SERVER": public_host,
            "KIT_SIGNALING_PORT": str(args.kit_signaling_port),
            "KIT_MEDIA_PORT": str(args.kit_media_port) if args.kit_media_port else "",
            "KIT_INSTANCE_ENDPOINTS": json.dumps(kit_instance_endpoints),
            "CONVERSION_POLL_ENABLED": "false",
            "SESSION_STORE_DIR": str(data_dir / "sessions"),
            "EVENT_LOG_DIR": str(data_dir / "events"),
            "LOG_ROOT": str(data_dir / "logs"),
            "CALLBACK_OUTBOX_STORE_PATH": str(data_dir / "callback-outbox.json"),
            "CORS_ORIGINS": ",".join(
                [
                    viewer_public,
                    viewer_local,
                    f"http://localhost:{viewer_port}",
                ]
            ),
        }
    )
    viewer_env = os.environ.copy()
    viewer_env.update(
        {
            "VITE_COORDINATOR_API_BASE": coordinator_public,
            "VITE_COORDINATOR_SOCKET_URL": coordinator_public,
            "VITE_AUTO_CREATE_SESSION": "false",
        }
    )

    coordinator_proc: subprocess.Popen[Any] | None = None
    viewer_proc: subprocess.Popen[Any] | None = None
    report: dict[str, Any] = {
        "classification": {},
        "target_urls": {},
        "screenshots": {},
        "lan_mode": lan_mode,
        "public_host": public_host,
    }
    try:
        coordinator_proc = start_process(
            [npm_command(), "run", "dev"],
            repo_root / "bim-review-coordinator",
            coordinator_env,
            run_dir / "coordinator.stdout.log",
            run_dir / "coordinator.stderr.log",
        )
        viewer_proc = start_process(
            [npm_command(), "run", "dev", "--", "--host", "0.0.0.0", "--port", str(viewer_port), "--strictPort"],
            repo_root / "web-viewer-sample",
            viewer_env,
            run_dir / "viewer.stdout.log",
            run_dir / "viewer.stderr.log",
        )
        wait_http(f"{coordinator_local}/health", 45, log_file, "coordinator")
        wait_http(viewer_local, 60, log_file, "viewer")

        created = http_json(f"{coordinator_local}/api/review-sessions", method="POST", payload=session_payload(public_host))
        session_id = str(created["session_id"])
        write_log(log_file, f"step 2 session: created {session_id}")

        handoff_url = f"{coordinator_public}/ui/open?session={urllib.parse.quote(session_id)}&redirect=http://evil.example"
        status_code, location = redirect_location(handoff_url)
        parsed_location = urllib.parse.urlsplit(location)
        query = dict(urllib.parse.parse_qsl(parsed_location.query))
        write_log(log_file, f"step 3 handoff: status={status_code} location={location}")

        handoff_ok = (
            status_code in {301, 302, 303, 307, 308}
            and location.startswith(viewer_public)
            and query.get("session") == session_id
            and query.get("coordinatorApiBase") == coordinator_public
            and query.get("coordinatorSocketUrl") == coordinator_public
            and "evil.example" not in location
            and (not lan_mode or "127.0.0.1" not in location)
        )
        report["classification"]["viewer_handoff_lan_url"] = "passed" if handoff_ok else "failed"
        report["target_urls"]["handoff_url"] = handoff_url
        report["target_urls"]["redirect_location"] = location

        viewer_one_url = append_query(location, userId="viewer_001", displayName="Viewer One")
        viewer_two_url = append_query(location, userId="viewer_002", displayName="Viewer Two", streamRole="spectator")
        report["target_urls"]["viewer_one_url"] = viewer_one_url
        report["target_urls"]["viewer_two_url"] = viewer_two_url
        report["kit_instance_endpoints"] = kit_instance_endpoints

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context_one = browser.new_context(viewport={"width": 1280, "height": 1800})
            context_two = browser.new_context(viewport={"width": 1280, "height": 1800})
            page_one = context_one.new_page()
            page_two = context_two.new_page()
            attach_page_diagnostics(page_one, "viewer_one", report)
            attach_page_diagnostics(page_two, "viewer_two", report)
            page_one.goto(viewer_one_url, wait_until="domcontentloaded", timeout=30000)
            page_two.goto(viewer_two_url, wait_until="domcontentloaded", timeout=30000)
            for page, label in [(page_one, "viewer_one"), (page_two, "viewer_two")]:
                try:
                    page.get_by_test_id("topbar-session").wait_for(timeout=30000)
                    page.get_by_test_id("tri-ready-badges").wait_for(timeout=30000)
                except PlaywrightTimeoutError:
                    write_log(log_file, f"step 4 browser: {label} timed out waiting for session UI")

            video_wait = {
                "viewer_one": wait_for_video_frame(page_one, 45000),
                "viewer_two": wait_for_video_frame(page_two, 45000),
            }
            report["video_wait"] = video_wait
            write_log(log_file, f"step 4 video_wait: {json.dumps(video_wait, sort_keys=True)}")

            session_after_join = wait_participants(coordinator_local, session_id, 2, 30)
            runtime_status = http_json(f"{coordinator_local}/api/runtime/status")
            participant_count = len(session_after_join.get("participants", []))
            report["session_id"] = session_id
            report["session"] = session_after_join
            report["runtime_status"] = runtime_status
            report["classification"]["same_session_bootstrap"] = "passed" if participant_count >= 2 else "failed"
            report["classification"]["coordinator_participant_evidence"] = "passed" if participant_count >= 2 else "failed"
            write_log(log_file, f"step 6 participants: count={participant_count}")

            page_evidence = {}
            videos_one = inspect_video(page_one)
            videos_two = inspect_video(page_two)

            for page, label in [(page_one, "viewer_one"), (page_two, "viewer_two")]:
                screenshot = run_dir / "screenshots" / f"final_execution_{label}.png"
                page.screenshot(path=str(screenshot), full_page=False)
                report["screenshots"][label] = repo_relative(screenshot, repo_root)
                write_log(log_file, f"step 5 screenshot: {label} {repo_relative(screenshot, repo_root)}")

            for page, label, videos in [(page_one, "viewer_one", videos_one), (page_two, "viewer_two", videos_two)]:
                page_evidence[label] = {
                    "url": page.url,
                    "topbar_session": page.get_by_test_id("topbar-session").inner_text(timeout=5000),
                    "tri_ready": page.get_by_test_id("tri-ready-badges").inner_text(timeout=5000),
                    "stage_truth": page.locator(".stage-truth-panel").inner_text(timeout=5000),
                    "videos": videos,
                }
            report["page_evidence"] = page_evidence
            videos_ready = all(
                any(video.get("readyState", 0) >= 2 and video.get("videoWidth", 0) > 0 and video.get("videoHeight", 0) > 0 for video in videos)
                for videos in [videos_one, videos_two]
            )
            report["classification"]["single_kit_multi_viewer"] = "passed" if videos_ready else "blocked"
            if not videos_ready:
                report["single_kit_multi_viewer_blocker"] = "no_live_kit_webrtc_video_observed"
            browser.close()

        report_path = run_dir / "report.json"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        write_log(log_file, f"step 7 report: {repo_relative(report_path, repo_root)}")

        critical_ok = (
            report["classification"]["viewer_handoff_lan_url"] == "passed"
            and report["classification"]["same_session_bootstrap"] == "passed"
            and report["classification"]["coordinator_participant_evidence"] == "passed"
        )
        return 0 if critical_ok else 2
    finally:
        stop_process(viewer_proc)
        stop_process(coordinator_proc)


def main() -> int:
    parser = argparse.ArgumentParser(description="Webwright-style LAN handoff and same-session two-viewer validation.")
    parser.add_argument("--public-host", default="", help="Browser-visible host/IP. Defaults to detected LAN IPv4, then 127.0.0.1.")
    parser.add_argument("--coordinator-port", type=int, default=0, help="Coordinator port. Defaults to a free local port.")
    parser.add_argument("--viewer-port", type=int, default=0, help="Viewer port. Defaults to a free local port.")
    parser.add_argument("--kit-signaling-port", type=int, default=49100)
    parser.add_argument("--kit-media-port", type=int, default=0)
    parser.add_argument("--spectator-signaling-port", type=int, default=0)
    parser.add_argument("--spectator-media-port", type=int, default=0)
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
