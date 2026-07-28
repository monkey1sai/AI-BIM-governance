# Structured Log Baseline Runtime Evidence

## Revision and machine

- Runtime source HEAD: `4ef5af5f7269f3e57e4ca2564875241abc79b7f2`.
- Attempt ID: `attempt-20260728T030306Z-4ef5af5`.
- Gitignored evidence root: `artifacts/spec-to-done/cross-service-structured-log-baseline/evidence/attempt-20260728T030306Z-4ef5af5/`.
- Active pointer: `artifacts/spec-to-done/cross-service-structured-log-baseline/active-attempt.json`, with `status=succeeded` and the same attempt ID and source HEAD.
- Machine: `DESKTOP-7VF1E3D`; OS `Microsoft Windows NT 10.0.26100.0`; PowerShell `7.5.4`; architecture `X64`.
- The source attempt's hash-bound `evidence-summary.md` has a known PowerShell formatting defect in its root-trace line. That artifact is preserved unchanged. This tracked document is a derived rendering of the hash-validated JSON artifacts; it is not a byte-identical copy of the source summary.

## Fixture name-size-SHA256

- Name: `許良宇圖書館建築_2026.ifc`.
- Size: `89394282` bytes.
- SHA-256: `54d77fe1c8839bdd7d2cb46a9a87e4491b75f0019462608fab7bc5fc86155b71`.

Only the fixture name, size, and digest are recorded here; the machine-local source path is intentionally omitted.

## Exact command provenance

The attempt's `command-provenance.jsonl` records these commands in sequence. Paths are shown exactly as recorded; no environment values or secrets are included.

1. `repo.bat build` from `bim-streaming-server` — passed, exit `0`.
2. `C:\Program Files\PowerShell\7\pwsh.exe -NoProfile -File C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline\bim-streaming-server\scripts\start-host-native-conversion-service.ps1 -BindHost 127.0.0.1 -PortRaw 49104 -PythonExe C:\Repos\active\iot\AI-BIM-governance\.worktrees\cross-service-structured-log-baseline\.venv\Scripts\python.exe` from `bim-streaming-server` — started.
3. `C:\Program Files\nodejs\npm.cmd run dev` from `bim-review-coordinator` — started.
4. `C:\Program Files\nodejs\npm.cmd run dev -- --host 127.0.0.1 --port 5175 --strictPort` from `web-viewer-sample` — started.
5. `GET http://127.0.0.1:49104/health` — passed, HTTP `200`.
6. `GET http://127.0.0.1:8005/health` — passed, HTTP `200`.
7. `GET http://127.0.0.1:5175/` — passed, HTTP `200`.
8. `scripts/smoke-bscheme-intake.ps1 (supported)` — passed, exit `0`.
9. `python validate_runtime_logs.py --log-root <attempt-log-root> --trace-id <root-trace-id> --require-services coordinator streaming-server viewer scripts --output runtime-log-validation.json` — passed, exit `0`.

The three repository-relative service working directories and the repository root are retained in `command-provenance.jsonl`; the abbreviated `from` labels above avoid treating one machine's worktree root as a reusable command contract.

## Owned process lease and shutdown

- `shutdown.json` reports `status=succeeded`.
- Four identity-matched processes were stopped by the owned-process lease.
- Twelve observed process records were already `not_running` when cleanup checked them.
- `foreign_listeners` is empty; no unowned process was stopped.
- The fixed evidence ports `49104`, `8005`, and `5175` were free after shutdown.
- The attempt artifact manifest contains 12 required files and reports `status=succeeded`.

## Root trace timeline and runtime IDs

- Root trace / IFC-ready job ID: `ifcready_1785207805934_b398fe8e` (byte-identical in the canonical readiness fields).
- Conversion job ID: `stream_conv_20260728030326_36c2106b`.
- Review session ID: `review_session_4ad0773c65c6`.
- Kit instance ID recorded by the session: `kit_local_001`.
- The canonical `real_ifc_intake_conversion` tier appears exactly once with `status=passed`; its context and tier execution modes are `production`.
- Browser bootstrap evidence reports `passed`, with `browser/struct-log-bootstrap.png` and `browser/struct-log-bootstrap-trace.zip` under the attempt root.
- Session close reports `status=closed`.
- `root-trace-timeline.json` contains 18 records across `coordinator`, `scripts`, `streaming-server`, and `viewer` under the same root trace.

The Kit instance ID is session metadata. It is not evidence of WebRTC first-frame, USD stage load, or render fidelity.

## Schema/env-snapshot/redaction validation

The canonical runtime validator reports `status=passed`, zero schema violations, and zero redaction violations.

| Service | JSONL file | Lines | Event counts |
|---|---|---:|---|
| coordinator | `coordinator/2026-07-28/coordinator-run_20260728_030324_672cdb.jsonl` | 11 | `env_snapshot=1`, `lifecycle=9`, `network=1` |
| scripts | `scripts/2026-07-28/scripts-run_20260728_030325_68e121.jsonl` | 10 | `env_snapshot=1`, `lifecycle=9` |
| streaming-server | `streaming-server/2026-07-28/streaming-server-run_20260728_030323_3ccd5f.jsonl` | 5 | `env_snapshot=1`, `lifecycle=3`, `network=1` |
| viewer | `viewer/2026-07-28/viewer-run_20260728_030430_88370e.jsonl` | 1 | `env_snapshot=1` |

Each required service/run has exactly one `env_snapshot`. This document records counts and relative file names only; it does not reproduce raw environment keys or values.

## OpenSpec 10.1-10.5 mapping

- **10.1:** The supported production-mode smoke completed IFC-ready intake, streaming conversion, review-session creation, browser bootstrap, and session close.
- **10.2:** The validator found one JSONL file for each of the four required services.
- **10.3:** The generated timeline joins 18 records from all four services on `ifcready_1785207805934_b398fe8e`.
- **10.4:** All four service runs contain exactly one `env_snapshot`; schema violations and redaction violations are both zero.
- **10.5:** This tracked evidence document records the reviewed, hash-validated runtime result and its limitations.

## Verified facts

- `active-attempt.json`, `artifact-manifest.json`, and the canonical semantic checker agree that the selected attempt succeeded.
- Health checks for conversion, coordinator, and viewer returned HTTP `200` before the supported smoke ran.
- The real IFC fixture completed conversion, produced the recorded conversion ID, opened the recorded review session, passed browser bootstrap evidence, and closed the session.
- The canonical validator accepted all four service logs with no schema or redaction violations.
- Owned cleanup succeeded and reported no foreign listeners.
- The successful attempt and every hash-bound source artifact remain unchanged.

## Inferences

- The shared root trace and 18-record four-service timeline demonstrate that the production carriers are sufficient to correlate this local IFC-ready workflow end to end.
- One `env_snapshot` per required service/run, together with zero redaction violations, supports the structured-log baseline's environment-capture and secret-redaction acceptance criteria for this attempt.

## Unverified risks

- This is one machine-local production-mode evidence run, not a cross-platform or repeated-run reliability sample.
- A recorded Kit instance ID does not prove the viewer received a live WebRTC frame or loaded a USD stage.
- The source attempt summary remains intentionally malformed at its root-trace line; consumers should use the hash-validated JSON artifacts and this derived tracked document.

## Skipped checks

- WebRTC first-frame, render fidelity, and stage evidence are not claimed by this runtime-log evidence pass.
- Design-system pixel fidelity and the branch-protected visual comparison gate are not part of Task 8 and are not claimed here.
- Multi-viewer behavior, live cloud callback delivery, and USD stage composition were not exercised by this attempt.
