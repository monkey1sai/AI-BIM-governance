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
- viewer `:5173` **不得作為初始入口**（使用者一律經 `/ui` 進入並取得 session）；但它**必須是 `/ui/open` 302 handoff 的可達目標** —— `consoleRoutes.ts` 的 handoff 是 server-side 302 到 `viewerPublicBaseUrl`，跨機器部署時瀏覽器必須跟得上。因此 remote 目標的 `VIEWER_BIND_HOST` 綁 LAN，暴露面改由**來源網段白名單**（防火牆）控制，而非以 bind 位址控制。此為第一階段；第二階段改由 coordinator 反向代理 viewer，恢復單一暴露面。
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

兩個閘門由**不同機器**產出，不得互相代替、也不得互相推論：

```txt
[design fidelity — 永遠在 Windows runner]
UI route → approved design screen/state
        → Windows runner / Chromium DPR1 1440x900 + 1920x1080
        → pixel diff <= 1% + semantic states 100%

[operability / runtime — 瀏覽器在 Windows，服務在部署目標]
visible button → default fixture → frontend request
        → real backend API（部署目標上的服務）
        → worker/runtime result → frontend status/result
        → viewer/console visible evidence
        → Playwright / gstack / supported browser engine screenshot or trace
```

**Design gate 綁 Windows 是結構性的，與部署目標遷移無關**：pixel baseline 在 Windows Chromium 拍攝（字型渲染跨 OS 必然不同），`verify-design-system-visual-result.ps1` 的 runner label 白名單只認 CI 的 `windows-latest` 與 `local-windows`。它從來不在部署區跑，因此 canonical 目標改為 Linux 不影響它。

**Runtime evidence 的瀏覽器端也在 Windows**：由本機瀏覽器連部署目標（canonical 目標為跨網段），走的是真實使用者路徑。不得改以目標機自身 localhost 取證 —— 那會系統性繞過跨網段 WebRTC（`KIT_STREAM_SERVER` 解析、ICE candidate、防火牆、`/ui/open` 302 到 viewer）這段最脆弱的環節。

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

真實 IFC semantic viewer E2E 的 fixture 權威是**共用 MinIO 的 `bim-control` bucket 內指定物件**，不是 git-tracked fixture、也不再是某台機器的 local `storage/`。權威改為 MinIO 的理由：測試部署目標已不只一台（Windows 按需驗證點 ＋ Linux canonical，見 §6），以單一機器的本機路徑當權威會讓不同目標各自漂移。

Fixture 以 `scripts/ifc-fixture-manifest.json`（schema `ifc-fixture-manifest/v1`）**pin**，每筆記錄 `bucket` / `key` / `etag` / `size_bytes`（bucket 有 versioning 時另記 `version_id`）。機器實作見 `scripts/lib/ifc-fixture-pin.mjs`。

各機器的 local `storage/` 降級為 **cache**：取用前必須以下載時寫下的 sidecar（`<file>.pin.json`）比對 pin；**無 sidecar 即視為不可驗證，不得使用**（89MB 級 fixture 多為 multipart upload，S3 ETag 不是可本地重算的 content MD5）。

### MUST

- 取用 fixture 前必須以 manifest 比對 `etag` / `size_bytes`（＋ pinned `version_id`）；**任何不符一律 fail closed**，明確報 fixture drift 並停止，不得以不同資料續跑。
- 使用 pinned fixture 跑 identity conversion profile，並保留 `bucket/key`、`etag`、size、hash 或等價可追溯資訊。
- 驗證 stage truth：`expected artifact URL`、`loaded artifact URL`、`matched = true`。
- 透過 coordinator / web UI 開 browser viewer，保存 browser screenshot、WebRTC frame visible evidence、console log、Kit host/session id。
- Evidence 預設放在 `docs/evidence/viewer-validate-ifc-semantics-real-ifc/`，或對應該批變更的 `docs/evidence/<slug>/`（PR / feature slug）。
- 大型輸出只保留 summary JSON、抽樣 mapping、測試結果與截圖；mapping / pset / spatial / bbox 太大時只保留 sample（例如前 20 筆）。
- Full-system E2E complete 必須同時有 governance CPU semantic E2E 與 Kit WebRTC visual/runtime E2E。
- 適用 route 若有 approved design screen，還必須有 commit-bound design fidelity result；Kit OpenUSD Web Viewer／OpenUSD extensions 的新增或重構保留但不在本輪，既有 runtime evidence 契約不因此失效。

### MUST NOT

- 不得把 IFC 本體 commit 進 git（manifest 只記 pin metadata，不含檔案）。
- 不得在 pin 不符時「順手更新 manifest」讓它通過；更新 pin 是獨立、可 review 的變更。
- 不得以無 sidecar 的 local cache 充當已驗證 fixture。
- 不得複製大型 IFC / `model.usdc` / 巨大 artifact 到 repo tracked path。
- 不得用 fake mapping、placeholder USDC、或只有 CPU/backend semantic result 宣稱 viewer/runtime E2E passed。
- 不得在缺少 Kit WebRTC visual/runtime evidence 時宣告 full-system E2E complete。

## 6. Script Contract

`scripts/deploy.ps1` 是 canonical one-click deploy entrypoint。

測試驗證部署環境：

- **部署目標由 `scripts/deploy-target-registry.json`（schema `deploy-target-registry/v1`）決定，不再是單一硬編路徑。** registry 有且只能有一個 `role=canonical_test_deploy` 的目標；其餘為 `on_demand_platform_verification`。目前：
  - `remote-linux-181`（canonical）＝ `bimdeploy@192.168.20.181:/home/bimdeploy/AI-bim-geo`，Linux host-native Kit ＋ web plane Docker。
  - `local-windows`（按需）＝ `D:\Users\deploy\AI-bim-geo`，僅在需要證明 Windows 平台路徑仍可用時手動啟停，**不常駐、不作為 canonical evidence 來源**。
  - `linux_container` 為 reserved kind（第二階段官方容器化的 schema 空位）；目標實際使用該 kind 會驗證失敗。
- 當使用者要求「請測試部署區重建」或同義口令時，MUST 從目前 repo 執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`（**operator 入口不變**）。不帶 `-TargetId` 即 canonical 目標；`-TargetId local-windows` 選按需 Windows 目標。
- Helper MUST freshly fetch `origin` with `+refs/heads/main:refs/remotes/origin/main`；fetch 失敗時停止，不得使用 stale `origin/main`。（ssh 目標在遠端 checkout 內執行同一條，語意逐字不變。）
- ssh 目標的 rebuild 由 `scripts/lib/remote-deploy-transport.ps1` 派工：operator 端推送 per-target base env（registry `env_file`），遠端 override 位於 `<runtime_data_root>/env.local`（在 checkout 外，`git clean` 清不到），effective env 為 per-key 合併且 **override 勝**。合併只有一份實作（遠端經 pwsh 呼叫同一個 lib 函式）。
- **部署＋驗證當下 MUST 快照 effective env**：非 secret 明文、secret 只留 key 名與 sha256-8 指紋與長度，**值一律不落地**（repo 為 public）。快照是時點證據，用於事後判斷「驗證當下的系統狀態」，不是閘門。
- Linux 目標的平台差異由 `scripts/lib/platform/platform-adapter.ps1` 吸收，其中兩項**非可選**：Kit 啟動必須帶 `--no-window`（headless 缺此參數會在 `carb.windowing-glfw` → `IAppWindow::startup` 崩潰）；clone 後必須恢復 `*.sh` 執行位元（Windows 開發的 checkout `core.fileMode=false`，且 `repo.sh` 內部 `exec` 另一支 `.sh`）。兩者已編碼為 registry schema 不變量，違反即驗證失敗。
- Helper MUST 在 reset 前回報 deployment checkout local changes 摘要；重建口令代表部署區可被 reset / clean。
- Helper MUST 排除所有層級 `AGENTS.md` / `CLAUDE.md`，以及 root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`；MUST 保留 `.github/workflows/`。
- Helper 完成清理後 MUST 從**該目標的 `deploy_root`** 執行 `.\scripts\deploy.ps1 -Build` 並回報 exit code / log path（ssh 目標即在遠端 checkout 內執行同一條）。
- 禁止 `-DryRun`；若 sandbox 需要寫入目標 `deploy_root` 的 approval，agent 必須針對 build-only rebuild command 申請，不得改用其他路徑或 dry-run 替代。
- `spec-to-done` 在目前 spec PR 已 merge、commit 可由 freshly fetched `origin/main` 取得後，可於測試部署區真實驗證前執行 ownership-gated preflight。helper 無參數預設只偵測；只有明確傳入 `-StopOwnedRuntime -DeploymentRoot '<該目標的 deploy_root>'`，且 listener 符合 per-port service role、deployment pidfile ancestor 與精確 launcher entrypoint、creation identity 經完整雙快照與每次 stop 前重驗一致，才可用 exact process handle 停止。pidfile 僅供 lineage 佐證，不能單獨授權；port topology 由 deployment env 的 immutable snapshot 推導，不接受 caller parameter/process-environment override，且每次 stop 前重驗 hash。MUST 記錄 port / PID / process name / ownership kind，且同一 port 的全部 busy owners 都通過後才可進入 cleanup。
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

### 三種 stack kind 的互不推論邊界

| stack kind | 產出者 | 涵蓋 | 明確不涵蓋 |
|---|---|---|---|
| `isolated_branch_stack` | 本機 repo-owned 隔離切片（§8） | 未 merge branch 的 CPU governance／coordinator／browser operability | design gate、deploy path、Kit/WebRTC/GPU |
| deploy-target evidence | canonical 目標，只從 `origin/main` 重建（§6） | 已 merge 內容的真實部署行為、Kit/WebRTC/GPU runtime | 未 merge branch（契約明文禁止） |
| `self_referential_bootstrap` | 變更驗證機制本身的 PR，於該 branch 取證 | 僅該 PR 宣告的機制缺口，見 `docs/agents/self-referential-bootstrap.md` | 上述兩者皆不可由它推論 |

三者**互不推論、互不代替**。`self_referential_bootstrap` 是有到期義務的暫時性 kind：merge 後必須以變更後的正規機制重跑同一驗證（fixpoint），欠帳未清會機器擋下一個同類 PR。
