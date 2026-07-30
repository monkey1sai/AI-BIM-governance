> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：定位 A1–A10、定義 user-facing 完成標準、規劃 frontend / 真實 IFC E2E 驗收、改 deploy / runtime / scripts 入口時。

# Product Operability And Script Contract

## 1. 產品定位來源

Repo-local 產品功能需求主來源：

- `docs/plans/docs-plans-README.md`：docs/plans 唯一入口；設計與規格正本＝`AI-BIM 前後端設計文件.dc.html`（§01–§08）；A1–A10 需求與介面語意問 §03 前端架構／§06 資料模型，現況以 repo code＋tests 直接查證。
- `C:\Repos\design\desigin-system`：唯讀的 production 2D authoring standard；本 repo 不回寫。
- `docs/plans/design-system-reference.manifest.json`＋`docs/plans/design-system-baseline/`：CI/PR/merge 可攜的 approved design snapshot；machine supporting artifacts，不是第二份需求正本。
- `docs/plans/AI-BIM Console Hi-Fi.dc.html`：Console 高保真互動原型設計稿（6 screens），production 2D pass/fail 仍以 pinned manifest/baselines 為 machine gate。

外部設計站 `https://bim-docs.jackshappybot.com/` 是產品定位與架構參考：

- 分頁「01 系統架構」的「BIM 模型管理平台 — 系統架構」：主系統採雲端與客戶落地端分離架構；外部公司雲端是 control-plane，客戶落地端是 IFC / Kit / MCP runtime data-plane。
- 分頁「05 BIM治理與模型檢核」：A1–A10 是本 repo 的 10 大主要開發項目。
- 分頁「06 操作介面總覽」：歷史 UX 參考；與 current pinned design screen 衝突時，不作 visual pass/fail 權威。

程式碼與 contracts 仍是行為 source of truth；repo-local plans 依 `docs/plans/docs-plans-README.md` §2/§3 取用（行為需求問設計文件 §01–§08、現況問 code＋tests、2D fidelity 問 pinned design reference）。Design source 不得覆寫 API、enum、安全、權限、runtime lifecycle 或 service ownership。

- 前端相關改動（web-viewer-sample / console）動工前必讀設計文件 §04 API 契約與 §08 R1–R4（後端凍結面：前端只打 coordinator `:8004`、proxy 路徑 byte-identical、禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py`；瀏覽器禁直連 `:49101`／`:49102`／`:8010`）。
- A1–A10 建成狀態以 repo code＋tests 直接查證，文件只引用、不各自展開論證。

EdgeConsole product shell contract（對齊 `feat/edge-console-product-shell`）：

- 正式產品殼層入口是 coordinator `/ui`；目標 IA 見設計文件 §03（home＝總覽 Mission Control：KPI·生產線快照·警示·A1–A10 啟動器）。
- Route map 以設計文件 §03（`#/home`、`#/workspace?dock=a1..a4|issues`、`#/pipeline`、`#/ops`、`#/app/:slug`）＋舊路由收斂表（CH-G：`#coordinator`→`#/home`、`#intake`·`#conv`·`#minio`→`#/pipeline` 等）為唯一來源，本檔不另行維護清單。
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

- 未 merge branch 的 CPU governance／coordinator／browser operability evidence MUST 依 §8 隔離 stack 契約取得並標示 stack kind；Kit／WebRTC／GPU evidence 另走 host-native 契約。
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
- `spec-to-done` 在目前 spec PR 已 merge、commit 可由 freshly fetched `origin/main` 取得後，可於測試部署區真實驗證前執行 ownership-gated preflight。helper 無參數預設只偵測；只有明確傳入 `-StopOwnedRuntime -DeploymentRoot 'D:\Users\deploy\AI-bim-geo'`，且 listener 符合 per-port service role、deployment pidfile ancestor 與精確 launcher entrypoint、creation identity 經完整雙快照與每次 stop 前重驗一致，才可用 exact process handle 停止。pidfile 僅供 lineage 佐證，不能單獨授權；port topology 由 deployment env 的 immutable snapshot 推導，不接受 caller parameter/process-environment override，且每次 stop 前重驗 hash。MUST 記錄 port / PID / process name / ownership kind，且同一 port 的全部 busy owners 都通過後才可進入 cleanup。
- 既有一般 Phase 3 重試能力不變，但所有自動停止（無論是否走 `spec-to-done`）也 MUST 使用同一 hardened helper 與相同閘門，再重跑同一條 `.\scripts\deploy.ps1 -Build`。helper 無法證明 ownership 時必須 HELD；只有使用者逐次確認明確 PID 與 ownership evidence 後才可人工例外。不得停止無關 process、驗證未 merge branch，或改用 `-Force` / `-DryRun`。

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

## 8. 隔離 branch stack 驗證

未 merge branch 的 CPU governance／coordinator／browser operability evidence MUST 在
`stack_kind=isolated_branch_stack` 的 repo-owned 隔離切片取得。base ports 為 coordinator
`8005`、governance `49103`、Playwright viewer `5180`；parallel offset 只接受整數 `0..4`。
部署區 `8004/49102/49101/8010/5173/5174` 與 Kit `49100/49110..49150` 全部保留。
非法 offset 與 resolved-port 交集必須在 listener 查詢、cleanup、啟動之前 fail closed。

launcher `scripts/dev/start-isolated-branch-stack.ps1` 的 `start|stop|status` 必須收到安全的
`ChangeId`、`RunId`，且只管理 governance/coordinator。manifest 位於
`artifacts/e2e/<change-id>/<run-id>/stack-manifest.json`；同名不得覆寫。停止 backend 前必須
同時重驗 manifest PID、完整 entrypoint/command line 與 process creation identity；任一 backend
不符時不得停止任何 process。每個 run 的 governance DB/federation output、coordinator session/event/outbox/ledger/
IFC-ready store/mutable storage 必須落在該 run 的 `state/`；child environment 必須明示覆寫 inherited
deployment mutable paths，worktree `storage/` 只作 read-only fixture root。直接執行 launcher 必須先在固定
安全 log root 建立 logger，再以 `StructLog.psm1` 記錄 terminal action lifecycle；safe-segment validation
失敗也要記錄，但拒絕的 raw segment 不得進入 log path/data。viewer lifecycle 僅由 Playwright `webServer` 擁有。

引用 browser result 作 evidence 時必須設 `E2E_REQUIRE_REAL=1` 與 `E2E_STACK_MANIFEST`。
manifest path/content/worktree/HEAD、coordinator/viewer env 或保留 port HTTP/WebSocket 不符時 hard fail；
global setup 必須在 health 後重驗 backend PID/command line/creation identity，且 resolved listener 必須
位於 manifest process lineage；lineage 每節必須帶 creation identity、拒絕 parent 比 child 晚的 PID-reuse
假關聯，並在輸出 snapshot 前重驗 listener 與整條 lineage 未改變；
不得以 conditional skip 計為通過。evidence 必須揭露 harness build/query flags、resolved ports、
base URLs、observed runtime IDs 與 screenshot/trace 路徑。

隔離 stack evidence 不得推論 design gate；不得推論 deploy path；不得推論 Kit/WebRTC、GPU、
first-frame、stage truth 或 DataChannel。這些 gate 仍各自由既有契約產生 evidence。
