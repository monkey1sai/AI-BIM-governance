## 為何

`AI-BIM-governance/` 已並存三種 startup mode:Mode A(`start-all.ps1` 全 host-native)、Mode B(`start-runtime-manager-docker.ps1` 全 Docker GPU profile)、Mode C(hybrid:`start-web-plane-docker.ps1` 啟 docker compose 上 coordinator + viewer,host-native PowerShell 跑 `bim-streaming-conversion-service` 與 Kit)。實機環境(Windows host + NVIDIA GPU)依 memory `kit-gpu-render-needs-windows-native`,Docker / WSL2 沒 NVIDIA 繪圖驅動,Kit 渲染只能 host-native,所以 Mode C 是技術上唯一能 demo 的路徑。

但 Mode C 啟動目前要使用者在 cold 機器上手動跑多個前置動作:建 `.venv` + `pip install`、`npm ci`、複製 `.env` 系列、清 stale PID、第一次 `docker compose build`、處理 port 衝突、按依賴順序啟三類服務,再到瀏覽器確認三個 health。一條條手動跑容易踩坑(memory `webrtc-no-video-reset-user-recovery`、`mapping-fake-vs-real-isolation` 等),且失敗時要憑記憶手動 unstop。

這個 change 要把 Mode C 一鍵部屬的責任收斂進 `scripts\deploy.ps1`(薄 orchestrator)+ `scripts\lib\*.ps1` 一組 read-only preflight modules 與 host-native launcher / kit-log probe,做到「冷啟動一條指令 → 三服務全 ready,idempotent 重跑 → 全 skip 退 0」的契約。

## 變更內容

- 新增 `one-click-deploy-hybrid` capability,定義 Mode C hybrid 部屬入口的 Phase 0–5 流程、退出碼語意、auto-fix / interactive-guard / never-do 三層 safety 紅線、與 host-native conversion-service 對齊 docker bind mount 的 volume alignment 契約。
- 入口 = `scripts\deploy.ps1`;preflight modules 全 read-only(`scripts\lib\preflight-*.ps1` × 5);有副作用的模組(`scripts\lib\host-native-launcher.ps1` / `deploy-report.ps1` / `kit-log-probe.ps1`)集中在實際啟動 / 寫 log 階段才動手。
- Phase 4 嚴格順序:host-native conversion-service(:49101)→ host-native Kit streaming(:49100/47998)→ docker compose up coordinator + viewer(:8004 / :5173)。coordinator container 內透過 `host.docker.internal:49101/health` 連回 host-native conversion-service,所以 conversion 必須先 ready。
- Volume 對齊方案:`.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT` 是 ground truth(預設 `<RepoRoot>\storage`);deploy.ps1 在啟動 host-native conversion-service 子 process 前 export `STORAGE_ROOT = $RuntimeStorageRoot`(對齊 docker bind mount source),讓 conversion service 內 `ifc2usdc_powershell_adapter.py` 的 sandbox `storage_root` 驗證 coordinator 給的 `host_local_path` 不會 false-positive `invalid_ifc_input`。
- 不修改 Mode A `start-all.ps1` / Mode B `start-runtime-manager-docker.ps1` / Mode C 既有 docker entrypoint `start-web-plane-docker.ps1`、`stop-all.ps1`、`stop-runtime-manager-docker.ps1`、`check-web-plane-docker.ps1`、`compose.runtime-manager.yml`、`compose.host-kit.yml`。新增 deploy.ps1 在 Phase 4c 透過 `Start-Process` 隔離呼叫既有 `start-web-plane-docker.ps1`,完全沿用其行為。
- 測試風格沿用 repo 既有「純 PowerShell + 自訂 `Assert-*` helpers」(對齊 `scripts\tests\test-pr-review-agent.ps1`,**不引入 Pester**)。每個 lib module 一份單測,加一個 Layer 2 `-DryRun` integration test,Layer 3 手動 smoke runbook 在 `docs\runbooks\one-click-deploy-smoke.md`。

## 能力

### 新增能力

- `one-click-deploy-hybrid`: 定義 Mode C(hybrid:web-plane Docker + host-native Kit)一鍵部屬入口的 Phase 流程、退出碼契約、auto-fix / interactive-guard / never-do 三層 safety boundary、volume alignment、idempotent re-run 與 Final Summary 輸出。

### 修改後的能力

- 無。

## 影響

- 主要 owner folder:`scripts/`(新增 deploy.ps1 + lib + tests)、`docs/superpowers/specs|plans/`、`docs/runbooks/`、`openspec/changes/add-one-click-deploy-hybrid/`。
- Mode A / Mode B / 既有 `start-web-plane-docker.ps1` / `stop-*.ps1` / `compose.*.yml` 完全不動;`git diff main...HEAD` 不含這些路徑。
- 新增 PowerShell symbol 約 +218 nodes / +218 edges(GitNexus reindex 後 5,042 → 5,260),`gitnexus_detect_changes scope=compare base=main` 顯示 `risk_level: low` / `affected_processes: 0`,沒侵入任何既有 execution flow。
- 無 production dependency 新增;`pip install -r requirements.txt` 與 `npm ci` 都沿用既有 `requirements.txt` / `package-lock.json`。Docker base image 沿用 `compose.runtime-manager.yml` / `compose.host-kit.yml` 既有 `infra/docker/*.Dockerfile`,deploy.ps1 不改 compose / Dockerfile 內容。
- Secrets / `.env` 邊界:auto-fix 只做 missing-key append(從 `.env.example` 系列取 placeholder 預設值),不覆寫已有 key 的實值;絕不寫 secret 到 `.env` 系列(對齊 AGENTS.md §0.1 與 CLAUDE.md 紅線)。`.env.web-plane.host-kit.example` 不存在 `RUNTIME_STORAGE_ROOT` 時 append 預設絕對路徑 `<RepoRoot>\storage`。
- Repo boundary 保持不變:deploy.ps1 是 dev / demo 入口,不成為 `bim-review-coordinator` / `bim-streaming-server` / `web-viewer-sample` 的 runtime component;不作為外部公司雲端 control-plane 或外部客戶落地端 IFC Worker 的 stub。
- 失敗時不自動 rollback:Phase 任一階段 fail 直接退非 0,已啟的 host-native / docker container 不主動 stop,Final Summary 印「What might be running」與手動 stop 指令給使用者收尾(對齊 spec §8.4)。
- 無 breaking change:現有 Mode A / Mode B / 直接呼叫 `start-web-plane-docker.ps1` 的使用者行為完全不變,deploy.ps1 是並列新入口。
