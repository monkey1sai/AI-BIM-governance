## ADDED Requirements

### Requirement: RISK-IN-MEMORY-QUEUE-PERSISTENCE

`bim-review-coordinator` 的 IFC→USDC 轉檔排隊調度 (`ConversionDispatchQueue`) MUST 採用 in-memory FIFO 並接受「coordinator 重啟即遺失 queued 任務」的風險邊界。系統 SHALL 在重啟或 graceful shutdown 時透過 `drain()` 將仍在 `queued_for_conversion` 的 job 標記為 `dropped_on_restart`，並 MUST NOT 假裝其可被自動續做。任何「持久化升級」(sqlite / Redis / RabbitMQ) MUST 透過獨立 OpenSpec change 立案，不在本 change 內實作。

#### Scenario: Coordinator restart drops in-memory queue items

- **WHEN** `bim-review-coordinator` 在多個轉檔任務排隊中時被重啟、graceful shutdown 或 crash
- **THEN** 所有處於 `queued_for_conversion` 的 job MUST 透過 `ConversionDispatchQueue.drain()` 被標記為 `dropped_on_restart`
- **AND** 系統 MUST NOT 自動重派 `dropped_on_restart` 的 job
- **AND** 操作員 SHALL 透過外部公司雲端重新 POST `/api/external/ifc-ready` 來續做

#### Scenario: Persistence upgrade is out of scope

- **WHEN** 任何 contributor 想把 in-memory queue 換成 sqlite / Redis / RabbitMQ
- **THEN** MUST 開獨立 OpenSpec change 並另行立 spec、design、tasks
- **AND** 本 spec 的 risk acceptance 邊界 MUST NOT 被視為自動授權升級實作

---

### Requirement: RISK-CI-GPU-VERIFICATION-BLINDSPOT

CI 環境因無實體 NVIDIA GPU，SHALL 將 Kit Viewport 渲染與 WebRTC 串流相關驗證歸類為 `blocked_gpu_runtime_unavailable`，並 MUST NOT 阻擋主線 CI pass/fail。GPU-bound 驗證 SHALL 改由 host-native smoke runbook (`docs/runbooks/one-click-deploy-smoke.md`) 與 OpenSpec evidence 文件人工蓋章。

#### Scenario: CI runs without physical GPU

- **WHEN** 持續整合 (CI) 環境在無 NVIDIA 顯示卡下執行驗證腳本
- **THEN** GPU / Kit 渲染相關 step MUST 被明確標記 `blocked_gpu_runtime_unavailable`
- **AND** CI workflow MUST NOT 把 `blocked_gpu_runtime_unavailable` 視為 fail
- **AND** affected functional pass MUST 改由 host-native smoke runbook 由 reviewer 人工蓋章

#### Scenario: GPU evidence is recorded out-of-band

- **WHEN** PR 觸及 Kit runtime / WebRTC / streaming server 程式碼
- **THEN** PR description 或 OpenSpec change 的 evidence 段 SHALL 引用 `docs/runbooks/one-click-deploy-smoke.md` Smoke Pass Log 對應 row
- **AND** 該 row MUST 含 commit hash 與 reviewer 簽名

---

### Requirement: RISK-FALLBACK-VISUAL-INCONSISTENCY

`bim-streaming-server` 的 IFC→USDC 轉換 SHALL 以 HOOPS 原生 Kit pipeline 為 primary。當 fallback (`IfcOpenShell` + `pxr`) 被觸發時，conversion result MUST 在 `metadata.json` 標註 `source = "ifcopenshell_openusd_fallback"`（即 `_run_ifcopenshell_openusd_fallback` 寫入的 marker），使下游 reviewer 能識別視覺一致性風險。重命名 `source` key 或改 marker 值 MUST 透過獨立 OpenSpec change；實作層級的視覺迴歸測試 (visual regression) MUST 透過獨立 OpenSpec change 立案。

#### Scenario: Fallback pipeline is taken

- **WHEN** `bim-streaming-server` 因 HOOPS / Kit 轉換失敗而觸發 `IfcOpenShell` + `pxr` fallback
- **THEN** 產出的 `metadata.json` MUST 包含 `"source": "ifcopenshell_openusd_fallback"`（由 `_run_ifcopenshell_openusd_fallback` 寫入）
- **AND** reviewer SHALL 透過該 marker 識別 mesh 結構 / 材質精度可能與 primary pipeline 不一致

#### Scenario: Visual regression test is out of scope

- **WHEN** 任何 contributor 想加 fallback vs primary 視覺迴歸測試
- **THEN** MUST 開獨立 OpenSpec change 並另行立 spec、design、tasks
- **AND** 本 spec 的 marker 義務 MUST NOT 被視為自動授權 visual regression test 實作

---

### Requirement: RISK-WEBRTC-DATA-CHANNEL-RACE

`bim-streaming-server` Kit instance MUST 啟用 `-SkipAutoLoad`，並 SHALL 把 stage 載入決策權交給 browser-side `web-viewer-sample` 透過 DataChannel 的 `openStageRequest`。Kit 端 `_on_open_stage` handler MUST 以 last-write-wins 行為處理衝突的 `openStageRequest`（後到請求覆蓋 `_requested_stage_url`），且 MUST NOT 卡死 Kit thread。專屬 race detection 結構化 log key、正式 DataChannel state machine、`openStageRequest` 排他鎖 MUST 透過獨立 OpenSpec change 立案。

#### Scenario: DataChannel race with conflicting open requests

- **WHEN** 多個 viewer client 同時對同一 Kit instance 發送不同模型的 `openStageRequest`
- **THEN** `_on_open_stage` SHALL 以後到請求覆蓋前一個（透過 `self._requested_stage_url = requested_url` 賦值）
- **AND** Kit thread MUST NOT 因 race 而卡死或當機
- **AND** 衝突 race detection 的明確 struct log key MUST NOT 在本 spec 範圍內被引入（屬 successor change）

#### Scenario: DataChannel state machine is out of scope

- **WHEN** 任何 contributor 想引入正式 state machine 與 exclusive lock
- **THEN** MUST 開獨立 OpenSpec change 並另行立 spec、design、tasks
- **AND** 本 spec 的 last-write-wins + struct log 義務 MUST NOT 被視為自動授權 state machine 實作

---

### Requirement: RISK-AI-AGENT-HISTORICAL-HALLUCINATION

AI agent (Claude Code / Codex / Gemini 等) 在本 repo 上操作時 MUST 以 `AGENTS.md` 為 source of truth，CLAUDE.md / GEMINI.md 為鏡像入口。任何修改 production code 之 PR SHALL 經由 `.github/workflows/pr-review-agent.yml` 自動審查閘門檢查跨界與退役服務引用。退役服務 (`_worker` / `_bim-control`) 與其歷史文件 MUST NOT 被當成現行架構參考。CI 整合 GitNexus 自動跨界校驗 MUST 透過獨立 OpenSpec change 立案。

#### Scenario: AI agent references retired service

- **WHEN** AI agent 在生成 / 修改代碼時引用 `_worker` 或 `_bim-control` 作為現行 runtime service
- **THEN** human reviewer 或 PR review agent SHALL 標記為跨界 violation 並拒絕 merge
- **AND** correct path SHALL 改引用 `bim-review-coordinator` / `bim-streaming-server` / `web-viewer-sample` 三個現行 service

#### Scenario: Cross-boundary write attempt

- **WHEN** AI agent 試圖讓 `bim-review-coordinator` 渲染 3D 或在 callback outbox 傳模型 bytes
- **THEN** human reviewer 或 PR review agent SHALL 標記為違反 `bim-review-coordinator/CLAUDE.md` Must Not 條款並拒絕 merge

#### Scenario: GitNexus CI integration is out of scope

- **WHEN** 任何 contributor 想把 GitNexus 跨界校驗整合到 CI workflow
- **THEN** MUST 開獨立 OpenSpec change 並另行立 spec、design、tasks
- **AND** 本 spec 的 AGENTS.md + PR review agent 義務 MUST NOT 被視為自動授權 CI 整合實作
