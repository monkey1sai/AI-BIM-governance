# Demo current runtime observation

日期：2026-05-13

對應 OpenSpec change：`demo-current-runtime-observation`

## Scope

本紀錄重新觀測目前這個 worktree 的 demo runtime 狀態，範圍限於：

- `_bim-control` fake BIM data authority
- `_worker` artifact / conversion facade
- `bim-review-coordinator` session / collaboration control plane
- `web-viewer-sample` browser client
- `bim-streaming-server` Kit / WebRTC runtime prerequisites

本次是 observation pass，不變更 API、event schema、storage layout、session lifecycle、Kit runtime contract 或 browser UI contract。

## Baseline

| 項目 | Current observation |
|---|---|
| Branch | `codex/openspec/demo-current-runtime-observation` |
| HEAD | `93df32d update CLAUDE.md for claude code (#39)` |
| `HEAD...origin/main` | `0 0` after `git fetch origin --prune` |
| Worktree | Clean before docs/evidence updates |
| Active OpenSpec changes | `demo-current-runtime-observation` (`0/34` before this pass), `optimize-worker-source-entity-enumeration` (`25/26`) |
| Historical evidence rule | Older verification reports are context only unless rerun in this pass |

## Observation Matrix

| Tier | Owner | Status | Current evidence |
|---|---|---|---|
| Service health | `_bim-control`, `_worker`, `bim-review-coordinator`, `web-viewer-sample` | `passed` | `scripts/start-all.ps1 -SkipStreaming -HealthTimeoutSeconds 45` outside sandbox; `scripts/dev-health-check.ps1` passed; 5173 returned HTTP 200 |
| Kit service health | `bim-streaming-server` | `blocked` | `bim-streaming-server/scripts/start-streaming-server.ps1 -SkipAutoLoad -PreflightOnly` failed because `_build/windows-x86_64/release/ezplus.bim_review_stream_streaming.kit.bat` is missing |
| API / focused tests | per service | `passed` with one known lint failure | `_bim-control` 23 passed; `_worker` 105 passed / 1 skipped; coordinator 105 passed; viewer build and session-first contract passed; viewer lint failed with existing 29 errors / 1 warning |
| Worker dev source readiness | `_worker` | `blocked` | `GET /api/dev/ifc-sources` returned `items: []`; current worktree `storage/` contains only `README.md` |
| Worker conversion smoke | `_worker` | `failed` | `scripts/smoke-review-session.ps1` created `conversion_job_id=conv_20260513100246_c395e1ca`, but result failed with `ConversionAdapterError: IfcOpenShell could not open source IFC: Unable to parse IFC SPF header` |
| Worker canonical real conversion | `_worker` | `not_observed` current / historical `blocked` | Current worktree has no IFC fixtures. Historical `optimize-worker-source-entity-enumeration` evidence says source enumeration passed but `non_renderable_entity_materialization` timed out |
| Review request lifecycle | `_bim-control` | `passed` for blocker classification | `review_request_id=review_request_1778666777077_1d692eed` recorded `blocked_conversion`, `blocker=conversion_readiness`, `missing_refs=["ag_593876ab7233"]` |
| Coordinator session lifecycle | `bim-review-coordinator` | `passed` | `session_id=review_session_87404055d4fd`; stream config returned `model.status=missing`; close produced `closed` and `kit_instance_bindings[0].status=released` |
| Socket.IO collaboration | `bim-review-coordinator` + `_bim-control` annotation path | `passed` | `scripts/smoke-review-socket.ps1` passed with `session=review_session_8b7cf9515752` |
| Browser route HTTP | `web-viewer-sample` | `passed` | `Invoke-WebRequest http://127.0.0.1:5173` returned HTTP 200 |
| Browser visual / E2E automation | `web-viewer-sample` + Browser plugin | `blocked` / `not_observed` | In-app Browser policy rejected opening `http://127.0.0.1:5173`; no screenshot captured |
| Single Kit WebRTC | `bim-streaming-server` + `web-viewer-sample` | `blocked` | 49100 was not listening; streaming launcher missing; no `openedStageResult`, video dimensions, or screenshot |
| Same-Kit primary / spectator | `bim-streaming-server` + `web-viewer-sample` | `not_observed` | No live Kit signaling endpoint |
| Dedicated multi-Kit runtime | `bim-streaming-server` / future GPU capacity | `deferred` | Fewer than two live GPU-backed Kit endpoints; do not claim passed |

## Commands And Results

### Branch and OpenSpec baseline

```powershell
git -c safe.directory=C:/Users/IOT/.codex/worktrees/01e1/AI-BIM-governance fetch origin --prune
git -c safe.directory=C:/Users/IOT/.codex/worktrees/01e1/AI-BIM-governance status --short --branch
git -c safe.directory=C:/Users/IOT/.codex/worktrees/01e1/AI-BIM-governance rev-list --left-right --count HEAD...origin/main
openspec list --json
```

Result:

- Branch: `codex/openspec/demo-current-runtime-observation`
- `HEAD...origin/main`: `0 0`
- Active changes: `optimize-worker-source-entity-enumeration`, `demo-current-runtime-observation`

### Service startup and health

The first `start-all.ps1 -SkipStreaming` run inside the sandbox passed health only during the tool call; background processes were reclaimed afterwards. The durable runtime observation used the same script outside the sandbox.

```powershell
.\scripts\start-all.ps1 -SkipStreaming -HealthTimeoutSeconds 45
.\scripts\dev-health-check.ps1
Invoke-WebRequest -Uri http://127.0.0.1:5173 -TimeoutSec 5 -UseBasicParsing
```

Result:

- `_bim-control` health: `{"status":"ok","service":"_bim-control"}`
- `_worker` health: `{"status":"ok","service":"_worker","dev_ifc_source_root":{"items":0}}`
- `bim-review-coordinator` health: `{"status":"ok","service":"bim-review-coordinator","kit_signaling_port":49100}`
- `web-viewer-sample`: HTTP 200
- PIDs from `scripts/.run`: `_bim-control=27140`, `_worker=39164`, `bim-review-coordinator=28612`, `web-viewer-sample=42344`

Runtime prerequisites observed:

- Python: `3.12.7`
- Node: `v22.22.0`
- npm: `11.6.2`
- GPU: `NVIDIA GeForce RTX 4060 Ti`, driver `580.97`
- Viewer package engine drift: `package.json` requires Node `^18.0.0` / npm `^10.0.0`; current Node/npm are newer.
- Viewer install reported 8 dependency audit findings from existing package graph; no dependency declaration was changed.

### Focused tests and builds

```powershell
cd _bim-control
python -m pytest tests/test_review_session_requests_api.py tests/test_review_data_api.py

cd _worker
python -m pytest tests/test_worker_api.py tests/test_worker_converters.py tests/test_worker_batch_verification.py tests/test_worker_store.py

cd bim-review-coordinator
npm test

cd web-viewer-sample
npm run build
npm run test:session-first
npm run lint
```

Result:

- `_bim-control`: `23 passed`
- `_worker`: `105 passed, 1 skipped`
- `bim-review-coordinator`: `105 passed`
- `web-viewer-sample` build: passed, with Vite chunk-size warning
- `web-viewer-sample` session-first contract: passed
- `web-viewer-sample` lint: failed with `29 errors, 1 warning`; this matches the repo-known pre-existing lint status and was not fixed in this observation change

### Root smoke scripts

```powershell
.\scripts\smoke-worker-review-request.ps1
.\scripts\smoke-review-session.ps1
.\scripts\smoke-review-socket.ps1
```

Result:

- `smoke-worker-review-request.ps1`: blocked because no dev IFC source exists under the worker dev storage root.
- `smoke-review-session.ps1`: failed because the script's minimal inline IFC cannot be parsed by IfcOpenShell.
  - `source_artifact_id=artifact_src_3c138a21f9d1`
  - `artifact_group_id=ag_593876ab7233`
  - `conversion_job_id=conv_20260513100246_c395e1ca`
  - `status=failed`
  - error: `ConversionAdapterError: IfcOpenShell could not open source IFC: Unable to parse IFC SPF header`
- `smoke-review-socket.ps1`: passed with `session=review_session_8b7cf9515752`

### Worker artifact and conversion readiness

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8005/api/dev/ifc-sources
Get-ChildItem -LiteralPath storage -Recurse -File
```

Result:

- `GET /api/dev/ifc-sources`: `items=[]`
- Current worktree `storage/`: only `README.md`
- No current live real IFC conversion rerun was possible from this worktree's repo-local dev source root.

Historical context, not current pass:

- `docs/verification/2026-05-13-worker-source-entity-enumeration-optimization.md` shows the canonical first fixture under `C:\Repos\active\iot\AI-BIM-governance\storage` had `1,604,773` source entities and passed `source_entity_enumeration` in about `33.19s`.
- That same historical run timed out at `non_renderable_entity_materialization`; it did not produce a completed `model.usdc`.

### Review request, session lifecycle, and close / release

Evidence file:

```txt
docs/verification/evidence/2026-05-13-demo-current-runtime-observation/review-session-lifecycle-summary.json
```

Important IDs:

- `review_request_id=review_request_1778666777077_1d692eed`
- `session_id=review_session_87404055d4fd`

Observed state:

- `_bim-control` review request status: `blocked_conversion`
- blocker: `conversion_readiness`
- missing refs: `["ag_593876ab7233"]`
- coordinator session status before close: `active`
- stream config model status: `missing`
- close status: `closed`
- `kit_instance_bindings[0].status`: `released`
- lifecycle event types: `sessionCreated`, `sessionActive`, `sessionClosing`, `sessionClosed`, `kitInstanceReleased`

Interpretation:

- Coordinator lifecycle and release semantics are currently working.
- This does not imply render-ready artifacts or WebRTC runtime are working; the model is explicitly `missing`.

### Browser / Kit / WebRTC

```powershell
.\bim-streaming-server\scripts\tests\test-stage-loading-contract.ps1
.\bim-streaming-server\scripts\start-streaming-server.ps1 -SkipAutoLoad -PreflightOnly
Test-NetConnection -ComputerName 127.0.0.1 -Port 49100
```

Result:

- DataChannel stage loading contract: passed.
- Kit preflight: failed because the streaming launcher is missing:
  - `bim-streaming-server/_build/windows-x86_64/release/ezplus.bim_review_stream_streaming.kit.bat`
  - next step: run `.\repo.bat build` in `bim-streaming-server/`, then rerun preflight/start.
- 49100 TCP test: failed; no live Kit signaling endpoint.
- Browser automation: blocked by in-app Browser security policy for `http://127.0.0.1:5173`; no screenshot produced.

### Closeout validation

```powershell
openspec validate demo-current-runtime-observation --strict
git -c safe.directory=C:/Users/IOT/.codex/worktrees/01e1/AI-BIM-governance diff --check
npx gitnexus analyze
GitNexus MCP detect_changes repo="C:\Users\IOT\.codex\worktrees\01e1\AI-BIM-governance" scope="all"
```

Result:

- OpenSpec strict validation: passed.
- `git diff --check`: passed; Git reported CRLF conversion warnings only.
- GitNexus analyze: indexed this worktree successfully (`4,030 nodes`, `8,435 edges`, `172 clusters`, `252 flows`).
- GitNexus MCP detect changes: `changed_count=2`, `changed_files=3`, `affected_count=0`, `risk_level=low`.
- Changed indexed sections: roadmap `2026-05-13 demo-current-runtime-observation` and `Active observation: demo-current-runtime-observation`.
- Interpretation: this pass changed OpenSpec / docs / evidence only; no indexed code execution flows were affected.

## Evidence Artifacts

| Path | Purpose |
|---|---|
| `docs/verification/evidence/2026-05-13-demo-current-runtime-observation/review-session-lifecycle-summary.json` | Review request, coordinator session, stream config, close/release, and lifecycle events |
| `docs/verification/evidence/2026-05-13-demo-current-runtime-observation/command-summary.json` | Condensed command/status matrix |
| `docs/verification/evidence/2026-05-13-demo-current-runtime-observation/browser-automation-blocked.json` | Browser policy blocker record |

No screenshot exists for this pass because Browser automation was blocked and Kit/WebRTC was unavailable.

## Current State Summary

| Status | Tiers |
|---|---|
| `passed` | non-Kit service health, focused API/tests/builds, coordinator lifecycle close/release, Socket.IO collaboration, non-GPU DataChannel contract, viewer HTTP route |
| `failed` | `smoke-review-session.ps1` minimal inline IFC conversion |
| `blocked` | worker dev-source smoke, real worker artifact readiness from current worktree, browser automation, single Kit/WebRTC runtime |
| `deferred` | dedicated multi-Kit GPU-backed runtime |
| `not_observed` | same-Kit primary/spectator runtime, current canonical real IFC conversion from this worktree |

## Follow-Up

1. To rerun worker real conversion in this worktree, place or map real `.ifc` fixtures into the configured `WORKER_DEV_STORAGE_ROOT`; the current repo-local `storage/` does not contain IFC files.
2. Fix or replace `scripts/smoke-review-session.ps1` minimal IFC payload if it is intended to be a successful conversion smoke; current payload is not a valid IFC SPF model for IfcOpenShell.
3. Build `bim-streaming-server` so `ezplus.bim_review_stream_streaming.kit.bat` exists, then rerun Kit preflight and WebRTC browser evidence.
4. Do not mark dedicated multi-Kit runtime passed until at least two live GPU-backed Kit endpoints are available.
