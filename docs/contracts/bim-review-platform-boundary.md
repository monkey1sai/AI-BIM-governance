# BIM Review Platform Boundary

本文定義 `bim-review-platform` 在 B 方案中的本機部署邊界。它不是新 repo、不是 nested submodule，也不是把多個 service 合併成單一 process；它只是把既有 service folder 組成一個可啟動、可觀測、可分層驗證的 deployment profile。

## Deployment Profile

| Service | Existing folder | Start command | Health/readiness | Ports | Env owner | Logs |
|---|---|---|---|---|---|---|
| `bim-review-coordinator` | `bim-review-coordinator/` | `npm run dev` | `GET http://127.0.0.1:8004/health` | `8004` | `bim-review-coordinator/.env` | service stdout / coordinator dev logs |
| `bim-streaming-server` | `bim-streaming-server/` | `.\scripts\start-streaming-server.ps1` or `.\repo.bat launch -n ezplus.bim_review_stream_streaming.kit -- --no-window` | WebRTC signal port `49100`; conversion authority contract `POST /api/conversions/ifc-to-usdc` when API adapter is hosted | `49100`, stream port `47998`, optional spectator signal `49110` | `bim-streaming-server/config/*`, Kit launch flags | Kit stdout, `_testoutput/`, streaming traces |
| `web-viewer-sample` | `web-viewer-sample/` | `npm run dev -- --host 0.0.0.0` | `GET http://127.0.0.1:5173/` | `5173` | `web-viewer-sample` Vite/runtime config | Vite stdout / browser console |

Platform readiness is the combined view of the above services. A platform run is `passed` only when every required tier for the selected smoke scope is `passed`. If one service is down, the combined view must keep that service as `failed`, `blocked`, or `not_observed`; it must not collapse the whole profile into a single ambiguous pass.

## Repository Boundary

`bim-review-platform` does not create:

- `bim-review-platform/.git`
- service-level `.git` directories
- `.gitmodules` entries
- subtree-managed copies of `bim-review-coordinator`, `bim-streaming-server`, or `web-viewer-sample`

The local check for this worktree is:

```powershell
Get-ChildItem -Path . -Force -Recurse -Directory -Filter .git
if (Test-Path .gitmodules) { Get-Content .gitmodules } else { 'NO_GITMODULES' }
```

As of this change, the first command returns no nested `.git` directories and the second command returns `NO_GITMODULES`.

## Readiness Tiers

| Tier | Owner | Passed means | Blocked/not observed means |
|---|---|---|---|
| `coordinator_health` | `bim-review-coordinator` | `/health` returns OK and session APIs are reachable | Coordinator is not started, port `8004` is unavailable, or dependencies are missing |
| `streaming_conversion_job` | `bim-streaming-server` | `ifc_ready` creates a streaming-owned conversion job and result contract is valid | Conversion API adapter is not hosted or headless converter prerequisite is missing |
| `single_kit_render` | `bim-streaming-server` | one Kit process accepts a stage load and renders the selected USDC | GPU, Kit build, model artifact, or WebRTC is unavailable |
| `single_kit_multi_viewer` | `bim-streaming-server` + `web-viewer-sample` | primary and spectator viewers share one Kit instance with explicit ports | spectator port, browser automation, or shared state evidence is unavailable |
| `viewer_health` | `web-viewer-sample` | Vite app loads and can request a review session | Vite is not started or coordinator session config is unavailable |

Conversion readiness and WebRTC readiness are independent. For example, a streaming conversion contract test can pass while `single_kit_render` remains blocked because the local machine has no GPU or no running Kit process.

## Single-Kit Single-Viewer Smoke

Minimum evidence:

- Coordinator health passes on `8004`.
- Viewer is reachable on `5173`.
- Streaming server is listening on signal port `49100`.
- The viewer joins a coordinator-created review session.
- The viewer sends `openStageRequest` for a streaming-owned `model.usdc`.
- Streaming server returns `openedStageResult` or equivalent stage-load success.
- Browser evidence confirms a nonblank viewport or records a concrete blocker.

## Single-Kit Multi-Viewer Smoke

Minimum evidence:

- One primary Kit process remains the shared runtime.
- Primary viewer connects through signal port `49100`.
- Spectator viewer connects through an explicit spectator signal port, normally `49110`.
- Both viewers reference the same `kit_instance_id` or same session runtime binding.
- Primary stage load and camera/selection changes are visible or reported in the spectator path.
- If the spectator path cannot be automated, evidence must classify it as `blocked` or `not_observed`, not `passed`.

## Process Boundary

The platform profile must preserve process ownership:

- Coordinator process owns session and collaboration control.
- Streaming process owns conversion authority, Kit runtime, WebRTC, and DataChannel scene runtime.
- Viewer process owns browser UI and user interaction.

Do not merge these into one runtime process for convenience. Local orchestration scripts may start them together, but each service keeps its source folder, port ownership, logs, and failure status.
