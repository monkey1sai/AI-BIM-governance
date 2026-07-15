> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：定位 A1–A10、定義 user-facing 完成標準、規劃 frontend / 真實 IFC E2E 驗收、改 deploy / runtime / scripts 入口時。

# Product Operability And Script Contract

## 1. 產品定位來源

Repo-local 產品功能需求主來源：

- `docs/plans/docs-plans-README.md`：docs/plans 唯一入口（TRUTH/TARGET/PROCESS 三分體系）；A1–A10 需求與介面語意問 `TARGET-shell.md`／`TARGET-viewer.md`，現況問 `TRUTH.md`。
- `C:\Repos\design\desigin-system`：唯讀的 production 2D authoring standard；本 repo 不回寫。
- `docs/plans/design-system-reference.manifest.json`＋`docs/plans/design-system-baseline/`：CI/PR/merge 可攜的 approved design snapshot；machine supporting artifacts，不是第八份需求正本。
- `docs/plans/ai-bim-governance-prototype.html`／`ai-bim-geo-viewer-prototype.html`：legacy IA／OpenUSD runtime companions，不再作 production 2D pass/fail authority。

外部設計站 `https://bim-docs.jackshappybot.com/` 是產品定位與架構參考：

- 分頁「01 系統架構」的「BIM 模型管理平台 — 系統架構」：主系統採雲端與客戶落地端分離架構；外部公司雲端是 control-plane，客戶落地端是 IFC / Kit / MCP runtime data-plane。
- 分頁「05 BIM治理與模型檢核」：A1–A10 是本 repo 的 10 大主要開發項目。
- 分頁「06 操作介面總覽」：歷史 UX 參考；與 current pinned design screen 衝突時，不作 visual pass/fail 權威。

程式碼與 contracts 仍是行為 source of truth；repo-local plans 依 `docs/plans/docs-plans-README.md` §3 取用（現況問 TRUTH、行為需求問 TARGET-*、紀律問 PROCESS、2D fidelity 問 pinned design reference）。Design source 不得覆寫 API、enum、安全、權限、runtime lifecycle 或 service ownership。

- 前端相關改動（web-viewer-sample / console）動工前必讀 `docs/plans/TARGET-contracts.md` §1 後端凍結面契約（前端只打 coordinator `:8004`、proxy 路徑 byte-identical、禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py` 等清單）。
- A1–A10 建成狀態唯一落點＝`docs/plans/TRUTH.md`（§4 一覽），其他文件只引用、不各自展開論證。

EdgeConsole product shell contract（對齊 `feat/edge-console-product-shell`）：

- 正式產品殼層入口是 coordinator `/ui`；home 必須顯示「今天要做什麼」與 Smart Todo。
- 完整 22 條正典路由（hash 一律**無斜線**，如 `#a1`、`#viewer`、`#conv`；2026-06-11 勘誤後 `#/a1` 寫法已廢棄）以 `docs/plans/TARGET-contracts.md` §4 為唯一來源，本檔不另行維護清單。
- Operator-tool route `#kit`、`#demo-control` 必須保留，不得 silently 移除。
- A1 rule-run / Issue / BCF 可由 API / 表格完成；3D highlight、first frame、stage truth 必須有 GPU-backed review session，不得宣稱零 GPU 完成 3D。

## 2. A1–A10 開發項目

| Code | 名稱 | Repo 主要落點 |
|---|---|---|
| A1 | BIM 治理與模型檢核 | `governance-service` + `bim-review-coordinator` proxy + `web-viewer-sample` Edge Console |
| A2 | 模型版本差異與責任追蹤 | `governance-service/diff_engine` + Edge Console |
| A3 | 跨專業模型 Federation | `governance-service/federation` + Review Room handoff |
| A4 | 語意搜尋與模型問答 | `governance-service/search` + coordinator `/api/governance/search/*` proxy + Edge Console `#a4`（deterministic filters；PARTIAL） |
| A5 | IoT / BMS / FM 數位分身 | future core service + optional 3D overlay |
| A6 | 4D / 5D 施工模擬 | future schedule service + optional Kit overlay |
| A7 | Reality Capture 比對 | future capture service + optional 3D deviation overlay |
| A8 | AI 訓練資料與 Synthetic Data | future GPU job lane / Replicator |
| A9 | 機器人 / 自主巡檢 | future Isaac / robot simulation lane |
| A10 | 其他應用 / AI 決策工作台 | future controlled evidence/operation-plan layer, session-layer only |

Repo 定位：先做可賣、可驗收的 CORE governance flow；Omniverse / Kit / Isaac 類能力是 3D / GPU runtime lane，必須用真實 review session、first frame、DataChannel 或 runtime evidence 才能宣稱 passed。

## 3. Frontend Dual-Gate Requirement

凡是 user-facing capability，完成標準不是 API 完成，也不是像素或 runtime 單閘完成；必須同時具備 design fidelity 與可在瀏覽器驗收的 operability/runtime vertical slice：

```txt
UI route
→ approved design screen/state
→ Windows runner / Chromium DPR1 1440x900 + 1920x1080
→ pixel diff <= 1% + semantic states 100%
→ visible button
→ default fixture
→ frontend request
→ real backend API
→ worker/runtime result
→ frontend status/result
→ viewer/console visible evidence
→ Playwright / gstack / supported browser engine screenshot or trace
```

### MUST

- 新增或更新 visible frontend route。
- 提供明確 UI controls / buttons。
- 提供 default fixture；不得要求使用者手動 curl / Postman / 找 payload。
- 前端按鈕必須打真實 backend API，不得只接 mock 除非明確標 `demo` / `fixture`。
- UI 必須顯示 loading、success、failure、retry state。
- UI 必須顯示相關 ID：`job_id`、`model_version_id`、`artifact_url`、`review_session_id`、`usd_stage_url`、`prim_path` / `ifc_guid`。
- 必須提供 browser E2E command、截圖/trace/console/network evidence。
- 必須以 `scripts/tests/verify-design-system-reference.ps1` 驗 pinned manifest/baselines；production visual result 必須通過 `scripts/tests/verify-design-system-visual-result.ps1`。
- Frontend scope 必須由 changed paths 與 base/head manifest 聯集推導；semantic result 只能由 branch-protected Playwright inline cases 對 current checkout 產出，PR body／外部 JSON／手填 boolean 不得作輸入。
- Design gate 固定 Chromium、DPR 1、字型 ready、動畫關閉、兩 viewport；navigation/actions/loading/empty/success/warning/failure/disabled/confirmation/current locale/runtime truth 語意必須全過。
- 沒有 approved screen/state 時標 `partial_reference_missing`；混合 bundle 標 `mixed` 並跑全部 approved screens。兩者都必須列 missing scope、`Full completion claimed=no`，不得宣稱 99%，但不阻止誠實的局部修復。
- README / docs / PR 必須列手動驗收步驟。

### MUST NOT

- 不得以 backend tests only 宣告 user-facing feature 完成。
- 不得以 visual diff pass 取代 route/API/runtime evidence，或以 browser/runtime E2E 取代 design diff。
- 不得要求使用者只靠 curl / Postman 驗收。
- 不得把無遙測資料畫成 fail；應標 `未取得` / `not observed`。
- 不得用 fake mapping / fake fixture 當真實 conversion correctness。

## 4. PR Frontend Verification Table

PR 描述中 user-facing change 必須包含下列 machine-required labels（由 `scripts/tests/check-pr-body-evidence.ps1` **逐字比對**，錯字即 CI fail）。`Manual test steps` 可加列，但不得取代 machine-required evidence：

| Item | Result |
|---|---|
| Frontend route |  |
| Main button(s) tested |  |
| Fixture used |  |
| Backend API called |  |
| Runtime action | observed runtime ID |
| Visible success state |  |
| E2E command |  |
| Screenshot / trace |  |
| Design gate status | `passed` / `mixed` / `partial_reference_missing` |
| Design screen(s) |  |
| Reference-missing route(s) / surface(s) |  |
| Full completion claimed | `yes` / `no` |
| Design reference manifest |  |
| Visual fidelity result |  |
| Visual comparison |  |
| Visual artifacts |  |
| Known gaps |  |

Visual comparison 必須列兩 viewport 的 diff ratio（各自 `<=1%`）與 semantic result；Visual artifacts 必須指向 CI output 的 reference/current/diff。pure `partial_reference_missing` 三個 visual 欄位填 `reference_missing`，不得偽造 result。live WebRTC/GPU frame 不作 design golden；functional/runtime evidence 在所有 status 下仍獨立必要。

## 5. Real IFC Semantic Viewer E2E

真實 IFC semantic viewer E2E 的核心輸入是主工作區 local `storage/` 內 IFC，不是 git-tracked fixture。New worktree 只帶 git-tracked files；`storage/` 這類 ignored/local artifact 不會自動出現在新 worktree。

目前指定的主工作區 IFC：

```txt
C:\Repos\active\iot\AI-BIM-governance\storage\270_0dac5239-a2aa-4257-9946-c2b6da6bd24d_model.ifc
C:\Repos\active\iot\AI-BIM-governance\storage\許良宇圖書館建築_2026.ifc
```

### MUST

- 在新 worktree / branch 內跑真實 IFC semantic viewer E2E 時，直接讀主工作區 IFC 絕對路徑，或建立 gitignored local fixture folder / junction / symlink。
- 使用上述 IFC 跑 identity conversion profile，並保留 source IFC path、size、hash 或等價可追溯資訊。
- 驗證 stage truth：`expected artifact URL`、`loaded artifact URL`、`matched = true`。
- 透過 coordinator / web UI 開 browser viewer，保存 browser screenshot、WebRTC frame visible evidence、console log、Kit host/session id。
- Evidence 預設放在 `docs/evidence/viewer-validate-ifc-semantics-real-ifc/`，或對應該批變更的 `docs/evidence/<slug>/`（PR / feature slug）。
- 大型輸出只保留 summary JSON、抽樣 mapping、測試結果與截圖；mapping / pset / spatial / bbox 太大時只保留 sample（例如前 20 筆）。
- Full-system E2E complete 必須同時有 governance CPU semantic E2E 與 Kit WebRTC visual/runtime E2E。
- 適用 route 若有 approved design screen，還必須有 commit-bound design fidelity result；Kit OpenUSD Web Viewer／OpenUSD extensions 的新增或重構保留但不在本輪，既有 runtime evidence 契約不因此失效。

### MUST NOT

- 不得把上述 IFC commit 進 git。
- 不得複製大型 IFC / `model.usdc` / 巨大 artifact 到 repo tracked path。
- 不得用 fake mapping、placeholder USDC、或只有 CPU/backend semantic result 宣稱 viewer/runtime E2E passed。
- 不得在缺少 Kit WebRTC visual/runtime evidence 時宣告 full-system E2E complete。

## 6. Script Contract

`scripts/deploy.ps1` 是 canonical one-click deploy entrypoint。

測試驗證部署環境：

- Deployment checkout 固定為 `D:\Users\deploy\AI-bim-geo`。
- 當使用者要求「請測試部署區重建」或同義口令時，MUST 從目前 repo 執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`。
- Helper MUST freshly fetch `origin` with `+refs/heads/main:refs/remotes/origin/main`；fetch 失敗時停止，不得使用 stale `origin/main`。
- Helper MUST 在 reset 前回報 deployment checkout local changes 摘要；重建口令代表部署區可被 reset / clean。
- Helper MUST 排除所有層級 `AGENTS.md` / `CLAUDE.md`，以及 root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`；MUST 保留 `.github/workflows/`。
- Helper 完成清理後 MUST 從 `D:\Users\deploy\AI-bim-geo` 執行 `.\scripts\deploy.ps1 -Build` 並回報 exit code / log path。
- 禁止 `-DryRun`；若 sandbox 需要寫入 `D:\Users\deploy\AI-bim-geo` 的 approval，agent 必須針對 build-only rebuild command 申請，不得改用其他路徑或 dry-run 替代。
- 若 `deploy.ps1 -Build` Phase 3 被外部 host-native runtime blocker 擋住（例如 `kit.exe` 佔用 49100/49110+，或 conversion `python.exe` 佔用 49101），已授權 agent 只停止可由部署區 pidfile 或 command line / executable path 證明屬於 `D:\Users\deploy\AI-bim-geo` 的 PID tree，並記錄 port / PID / process name / ownership evidence，然後重跑同一條 `.\scripts\deploy.ps1 -Build`；若只有 port/process-name 證據，先取得使用者確認。不得停止無關 process，也不得改用 `-Force` / `-DryRun`。

正式 operator entrypoints：

- `scripts/deploy.ps1`：golden deploy / demo path。
- `scripts/verify-all.ps1`：golden aggregate verification。
- `scripts/stop-all.ps1`：golden stop / cleanup path。

Internal adapters 只能被 canonical entrypoints 或明確 runbook 呼叫：

- `scripts/start-all.ps1`
- `scripts/start-runtime-manager-docker.ps1`
- `scripts/start-web-plane-docker.ps1`
- `scripts/check-*.ps1`
- `scripts/lib/*`

新 smoke / check / e2e 預設不得再新增到 root `scripts/`。優先落點：

- `scripts/tests/`
- `scripts/dev/`
- `tests/e2e/`
- `web-viewer-sample/scripts/`

任何 runtime / Docker / Kit / viewer / env / port / conversion-service / demo launch 相關改動：

- MUST 更新或明確驗證 `scripts/deploy.ps1`。
- MUST 至少跑或說明無法跑 `.\scripts\deploy.ps1 -DryRun`。
- SHOULD 在本機 runtime 可用時跑 `.\scripts\deploy.ps1 -Force -StrictPostVerify`。
- 測試驗證部署重建 MUST 從目前 repo 走 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`；helper 會從 deployment checkout 執行 `.\scripts\deploy.ps1 -Build`。
- MUST 不新增 root-level `scripts/start-*.ps1`、`scripts/smoke-*.ps1`、`scripts/check-*.ps1`、`scripts/*-docker.ps1`，除非同步更新 `scripts/script-registry.json` 與 `scripts/SCRIPT_CONTRACT.md` 並提供理由。

## 7. PR Deploy Path Verification Table

涉及 runtime / docker / Kit / viewer / ports / env 的 PR 必須包含：

| Item | Result |
|---|---|
| Affects runtime / docker / Kit / viewer / ports / env? | yes / no |
| Canonical deploy path updated? | `scripts/deploy.ps1` updated / verified / not needed |
| New root script added? | no / yes with registry entry |
| Deploy dry-run command | `.\scripts\deploy.ps1 -DryRun` |
| Full deploy tested | `.\scripts\deploy.ps1 -Force -StrictPostVerify` / not available |
| Verify command | `.\scripts\verify-all.ps1` |
| Frontend URL verified |  |
| Evidence path |  |
