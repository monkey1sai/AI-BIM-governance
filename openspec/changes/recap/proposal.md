## Why

長線 SaaS roadmap（[docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md)）規劃 6–9 個月、8 個 Phase、NT$50–70 萬硬體投入，但 demo 需要 72 小時內跑得起來。repo 既有的三個服務（`bim-review-coordinator` / `bim-streaming-server` / `web-viewer-sample`）加上 `tests/fakes` 已經涵蓋 roadmap Phase 0 / 1 / 3 / 4 的 MVP 能力，缺的不是功能，是**單機 demo 的啟動順序、port matrix、host vs WSL 邊界、fake 觸發腳本、驗收標準**這層 orchestration runbook。

目前這些隱性知識散在以下位置，沒有 single source：

- `CLAUDE.md` §5 列了驗證入口但不是 demo 啟動順序
- `CLAUDE.md` §3 描述閉環但不是可執行步驟
- `memory/kit-gpu-render-needs-windows-native.md`、`memory/wsl-ubuntu-24-04-container-toolkit-setup.md` 記錄 Kit graphics 不能跑 WSL 的硬約束，但只在 Claude memory，新人或工程白癡看不到
- `tests/fakes` 知道怎麼模擬外部 worker / 公司雲端 callback，但沒有 demo-friendly 觸發腳本

結果：每次有人要 demo，都要重新摸索一遍同樣的踩雷路徑（WSL Kit 不通、`POST /api/external/ifc-ready` 該打哪、storage 裡的 `轉檔測試*.ifc` 哪一支轉得乾淨）。`recap` 的目的就是把這些一次整理成可重複的 demo runbook，凍結 fast MVP demo 路徑。

## What Changes

本 change 是 **單一份 runbook documentation + 一條 roadmap 交叉索引**，不新增任何 production runtime 程式碼、不新增 orchestration 腳本（既有 `scripts/start-all.ps1` / `scripts/demo-health-check.ps1` / `scripts/smoke-bscheme-intake.ps1` 已涵蓋啟動 / 健康檢查 / spec-correct ifc-ready 觸發 + conversion 等待 + callback publish + evidence 收集，無需重複造輪）。

新增：

- `docs/demo/fast-mvp-demo-recap.md` — single-source demo runbook，內容包含：
  - 雲地分離邊界回顧（引用 `CLAUDE.md` §2 與 `AGENTS.md`，不複製）
  - 三服務 port matrix 與 host vs container 部署矩陣（49100/49101 Windows host-native，8004/5173 可 docker 或 npm）
  - WSL Kit graphics 已知阻擋與 host-native 為主路徑的理由（引用 `runtime-image-linux-kit-launcher-readiness` deferred 與 `docs/runbooks/FAST_MVP_DOCKER_KIT_MANAGER.md`）
  - 從零到 demo 的啟動順序（直接引用既有 `scripts/start-all.ps1` → `scripts/demo-health-check.ps1` → `scripts/smoke-bscheme-intake.ps1`，並對齊 `CLAUDE.md` §5）
  - storage/ 樣本選擇條件（top-level `storage/*.ifc`，對齊 `smoke-bscheme-intake.ps1` 的 `Get-TopLevelIfcFixtures` 規則）與「現場不要抽不認識的檔」原則
  - 三步 demo 故事板（start-all → health-check → smoke-bscheme-intake，並在 viewer 觀察 DataChannel highlight）
  - 驗收長相（對齊 `smoke-bscheme-intake.ps1` 的 tier 狀態語意：`passed` / `failed` / `blocked` / `deferred` / `not_observed`）

修改：

- 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 加一段「fast MVP demo 短路徑」交叉索引到 `docs/demo/fast-mvp-demo-recap.md`；若該 roadmap 有對應的 `.html` 鏡像，同步更新（或在 archive 階段補）

非新增（明確排除）：

- 不新增 `bim-review-coordinator` / `bim-streaming-server` / `web-viewer-sample` 內任何 source file
- 不新增 `scripts/demo/` 子目錄或新 orchestration 腳本（既有 scripts 已足夠）
- 不新增 production dependency、不動 `package.json` / `requirements*.txt` runtime block
- 不引入 MinIO / Gitea / Git LFS / IfcOpenShell / IfcTester / BCF / MQTT / InfluxDB / Brick Schema / DVC 等 roadmap Phase 1/2/5/6 元件
- 不接真實外部 `_bim-control` 雲端、不接真實外部客戶落地端 IFC Worker（全由 `tests/fakes` + 既有 contract 覆蓋）
- 不嘗試解 WSL Kit graphics blocker — 以 Windows host-native 為唯一 demo 路徑（與既有 memory `kit-gpu-render-needs-windows-native` 與 `FAST_MVP_DOCKER_KIT_MANAGER.md` 的 evidence rule 一致）
- 不改 OpenSpec 既有 capability 的 requirement；新加的 `demo-fast-mvp-orchestration` capability 與既有 runtime capability 正交，純文檔層

## Capabilities

### New Capabilities

- `demo-fast-mvp-orchestration`: 文檔與最小腳本層 capability，定義「單機 fast MVP demo 的可重複啟動 / 觸發 / 驗收契約」，與既有 runtime capability 正交。

### Modified Capabilities

- None.

## Impact

- Owner repo/folder: `docs/demo/`（新檔案 `fast-mvp-demo-recap.md`）；`docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 加交叉索引一段；不新增 `scripts/demo/` 子目錄
- API: 無新 API；只描述既有 `POST /api/external/ifc-ready` 在 demo 場景下該怎麼打
- Data structure: 無新 schema；demo trigger payload 沿用既有 worker compatibility body（`status` / `ifc_path` / `project_id` / `version` / `task_id`）
- Affected integration: demo 範圍內，外部依賴全部由 `tests/fakes` 提供 double；不接真實雲端 / 真實 worker
- Affected symbols（apply 前需 GitNexus impact analysis）: 無 production code 改動，預期 GitNexus `risk_level = LOW`
- Tests/contracts: 既有 `tests/contracts/` 與 `tests/fakes/` 不動；runbook 直接引用既有 `scripts/smoke-bscheme-intake.ps1` 作為 demo 路徑，本 change 不取代 contract test
- Dependencies: none
- Predecessor 狀態提醒: `coordinator-ifc-ready-worker-webhook` PR #74 implementation 已 merged，archive PR 尚未產生；本 change 與其在 capability 上不重疊（一個是 control-plane 自動接線，一個是 demo orchestration runbook），但仍建議優先讓 predecessor archive 落地，以維持 `NoSuccessorWhilePredecessorOpen` policy
