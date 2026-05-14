# Stabilize demo runtime readiness — verification report

日期：2026-05-14

對應 OpenSpec change：`stabilize-demo-runtime-readiness`

## Scope

本紀錄聚焦於 `demo-runtime-readiness-smoke` 能力的實作驗證，範圍限於：

- 根目錄 `scripts/` 下的 smoke / readiness orchestration
- `_worker` dev IFC fixture 與 conversion 邊界（不變更 API ownership）
- `bim-review-coordinator` `stream_config` 的額外 `quality_metrics_summary` pass-through 欄位（additive）
- `web-viewer-sample` 新增的 `ConversionSummaryCard`（read-only，dev-only fallback）
- `bim-streaming-server` 啟動 preflight 與 single-Kit happy-path 運行手冊

本次同時刻意 **不** 改：

- 既有 production REST / Socket.IO / DataChannel contract
- `_worker` API ownership
- Kit runtime 行為（仍由 `start-streaming-server.ps1 -SkipAutoLoad` 啟動）
- 既有 `web-viewer-sample` lint debt

## Baseline

| 項目 | 值 |
|---|---|
| Branch | `codex/openspec/stabilize-demo-runtime-readiness-impl` |
| Worktree base | `7ca5a5e docs(openspec): 擴充 stabilize-demo-runtime-readiness 收 single-Kit demo 端到端 happy-path (#49)` |
| 對應 specs | `openspec/changes/stabilize-demo-runtime-readiness/specs/demo-runtime-readiness-smoke/spec.md` |
| 對應 runbook | [`docs/verification/2026-05-14-stabilize-demo-runtime-readiness/runbook.md`](2026-05-14-stabilize-demo-runtime-readiness/runbook.md) |
| Evidence 目錄 | `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/` |
| 歷史 baseline | `docs/verification/2026-05-13-demo-current-runtime-observation.md`（context only，不視為 current pass） |

## 變更摘要

1. 新增 `scripts/lib/smoke-evidence.ps1` — 共用 PowerShell helper，提供 `New-SmokeEvidenceRecord`、`Add-SmokeTier`、`Write-SmokeEvidence`、`Resolve-WorkerDevStorageRoot`、`Get-WorkerDevFixtureSummary`、`Get-KitLauncherPreflight`、`Test-KitSignalingPortListening`，並把 `WORKER_DEV_STORAGE_ROOT` 預設值固定到 `C:\Repos\active\iot\AI-BIM-governance\storage`。
2. 重寫 `scripts/smoke-review-session.ps1`：移除 invalid inline IFC（曾觸發 IfcOpenShell parse failure），改用 dev IFC source / 或在 fixture 缺失時直接 `blocked`，並在 coordinator lifecycle 仍可獨立通過時保留 worker conversion / Kit / browser tier 為非 passed。
3. 重寫 `scripts/smoke-worker-review-request.ps1`：保留原本的 dev source / conversion / review-request / coordinator session lifecycle / sessionBound 流程，但每段都產生獨立的 `worker_conversion`、`bim_control_review_request`、`coordinator_session_lifecycle`、`bim_control_review_request_active` 等 tier，並補上 Kit / browser / `single_kit_render` / `dedicated_multi_kit_routing` 的 explicit 分類。
4. 重寫 `scripts/smoke-review-socket.ps1`：保留現有 Socket.IO 驗證腳本，但明確標記 `kit_webrtc_readiness=not_observed`、`browser_visual_evidence=not_observed`，避免 Socket.IO 通過被誤判為 WebRTC / 瀏覽器視覺成功。
5. 重寫 `scripts/dev-health-check.ps1`：除了原本的 service health 之外，新增 `fixture_preflight`、`kit_launcher_preflight`、`kit_webrtc_readiness` tier，並透過 `-StrictKit` 選擇是否在 Kit tier 非 passed 時 fail。
6. 新增 `scripts/run-single-kit-demo.ps1`：single-Kit demo orchestration helper，做 service preflight → 解析 `WORKER_DEV_STORAGE_ROOT` → 找最大 `.ifc` fixture → 觸發 worker conversion → 等待 succeeded → 建立 coordinator review session（帶 `quality_metrics_summary` 與 entity_index overlay binding）→ 印出 viewer URL 與 Kit preflight summary。失敗或 fixture 缺失時，明確 `blocked` 並標示 next command；不會自動跑 Kit 也不會直接擷取 screenshot。
7. 在 `bim-review-coordinator` 加入 additive 的 `ConversionQualityMetricsSummary` 型別與 schema：
   - `types.ts` 新增 `ConversionQualityMetricsSummary`，並把 `ReviewSession.quality_metrics_summary` / `StreamConfigResponse.quality_metrics_summary` 設為 optional 的 `null`-able 欄位。
   - `app.ts` 的 `createSessionSchema` 新增 `quality_metrics_summary` passthrough 區塊，並把它 forward 給 `store.create` 與 `buildStreamConfig`。
   - `services/sessionStore.ts` 把 `quality_metrics_summary` 寫入 session JSON，保持 strictly additive。
8. 在 `web-viewer-sample` 加入 `ConversionSummaryCard.tsx`：
   - `types/review.ts` 新增 `ConversionQualityMetricsSummary` 與 `ReviewStreamConfig.quality_metrics_summary` optional 欄位。
   - 新元件 `components/ConversionSummaryCard.tsx`：當 `stream_config.model.status === "ready"` 且 summary 存在時，顯示 fixture / source IFC entity count / sidecar carriers / materialization strategy / coverage ratio / coverage status / conversion duration；否則顯示 degraded 卡，列出當前 `model.status` 與 smoke blocker hint。
   - dev-only fallback：當 coordinator 未轉送 summary 時，於 `import.meta.env.DEV` 下，依 `conversion_job_id` 取 `_worker` 的 `/api/conversions/{job}/result` 做 read-only 顯示，**不快取、不重算、不再廣播**。
   - `DemoControlPanel.tsx` 接收新 prop 並掛載卡片於 status 區之後。
9. 新增 focused 自動化驗證：
   - `scripts/tests/test-smoke-evidence.ps1`：對共用 helper 做 7 個 assertion，含 tier 分離、`single_kit_render` 必要欄位、multi-Kit invariant、`WORKER_DEV_STORAGE_ROOT` 解析（無 env、override、env 三種）。
   - `web-viewer-sample/scripts/verify-conversion-summary-card.mjs`：對卡片做 source-level invariant 與 `defaultFetchFallback` pure transform 的 round-trip assertion，並驗證 prod build 不會觸發 dev fallback、dev build 會觸發。
10. 新增 runbook 與 verification 目錄結構，所有 smoke / orchestration 預設把 evidence JSON 寫到 `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/`。

## Tier 狀態總覽（current pass）

| Tier | Owner | Status | Notes |
|---|---|---|---|
| `service_health` (`_bim-control`/`_worker`/`coordinator`) | per service | `not_observed` | 不啟動實服務；helper 與 script 自身結構由 focused tests 驗證 |
| `fixture_preflight` | `scripts` | `blocked` | 本 worktree `storage/` 目前只有 `README.md`，符合 spec 對 fixture 缺失的 `blocked` 分類 |
| `worker_conversion` | `_worker` | `blocked` | 沒有 parseable `.ifc`；smoke script 會帶 `WORKER_DEV_STORAGE_ROOT` 與 next command |
| `bim_control_review_request` | `_bim-control` | `not_observed` | 本 pass 不啟動 services；review-request lifecycle 邊界沒有改動 |
| `coordinator_session_lifecycle` | `bim-review-coordinator` | `not_observed` (current pass)；type-check passed | type-only/route 改動已透過 build script 驗證 |
| `socket_io_collaboration` | `bim-review-coordinator` | `not_observed` | socket smoke 行為未在本 pass 重跑；contract 沒有變動 |
| `kit_launcher_preflight` | `bim-streaming-server` | `blocked` | `_build/windows-x86_64/release/ezplus.bim_review_stream_streaming.kit.bat` 不存在；helper 已能 emit 對應 next command |
| `kit_webrtc_readiness` | `bim-streaming-server` | `blocked` | `127.0.0.1:49100` not listening |
| `browser_visual_evidence` | `web-viewer-sample` | `not_observed` | 本 pass 沒開瀏覽器；smoke script 會記錄 viewer URL + session id 供手動 capture |
| `single_kit_render` | `web-viewer-sample` | `blocked` | Kit launcher + signaling port + worker model.usdc 同時缺失；evidence schema 已固定 |
| `dedicated_multi_kit_routing` | `bim-streaming-server` | `deferred` | invariant `stream_config.kit_instance_bindings.length <= 1` 已由 helper test 驗證 |

說明：

- 上述 `blocked` / `not_observed` 是本 pass 的事實狀態；對應的 evidence schema 與 script 結構由 `scripts/tests/test-smoke-evidence.ps1` 與 `web-viewer-sample/scripts/verify-conversion-summary-card.mjs` 驗證。
- 若要進到 `single_kit_render=passed`，必須跑完 runbook 的手動段並把 screenshot / video dimensions 寫回 evidence JSON。

## 焦點驗證指令

```text
# Coordinator type-check (additive quality_metrics_summary)
cd bim-review-coordinator && npm run build

# Viewer build + focused tests
cd web-viewer-sample && npm run build
cd web-viewer-sample && npm run test:session-first
cd web-viewer-sample && npm run test:conversion-summary-card

# Smoke evidence helper unit assertions（手動於 Windows PowerShell 執行）
pwsh -NoProfile -File scripts/tests/test-smoke-evidence.ps1

# Strict OpenSpec validation
openspec validate stabilize-demo-runtime-readiness --strict
```

## 已知 risk / follow-up

- 真實 GPU + Kit launcher 仍需手動 build 與啟動，符合 design.md Decision 6（partially automated, partially manual）。
- `_bim-control` Kit alloc 行為沒有改動；`auto_allocate_kit=true` 時若沒有 Kit 端點仍會回 409 — 這是設計，不視為 regression。
- viewer card 的 dev fallback 只用於 dev runtime，production build 不會 reach 該分支；同時不快取，session 結束後沒有 residual state。

## 歷史 context

- `docs/verification/2026-05-13-demo-current-runtime-observation.md` 仍是 demo runtime 觀察的 historical baseline；本 pass 並未取代其紀錄，只是補上 reusable smoke/readiness contract。
- `openspec/changes/optimize-worker-non-renderable-materialization` 已封存，其結果（`materialization_strategy=sidecar`、`sidecar_carrier_count`、`coverage_ratio` 紀錄）是 viewer 卡片資料來源依據。
