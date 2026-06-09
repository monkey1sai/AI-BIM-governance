> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：定位 A1–A10、定義 user-facing 完成標準、規劃 frontend / 真實 IFC E2E 驗收、改 deploy / runtime / scripts 入口時。

# Product Operability And Script Contract

## 1. 產品定位來源

外部設計站 `https://bim-docs.jackshappybot.com/` 是本 repo 的產品定位參考：

- 分頁「05 BIM治理與模型檢核」：A1–A10 是本 repo 的 10 大主要開發項目。
- 分頁「06 操作介面總覽」：使用者操作介面、按鈕功能、進度與可驗收流程參考。
- 設計站原始碼可依個人環境 clone / 定位；本 PR 使用使用者提供的本機 clone 作為一次性查證來源，該本機路徑不納入 repo contract。

程式碼與 contracts 仍是行為 source of truth；設計站負責產品方向、操作介面語意與驗收期待。

## 2. A1–A10 開發項目

| Code | 名稱 | Repo 主要落點 |
|---|---|---|
| A1 | BIM 治理與模型檢核 | `governance-service` + `bim-review-coordinator` proxy + `web-viewer-sample` Edge Console |
| A2 | 模型版本差異與責任追蹤 | `governance-service/diff_engine` + Edge Console |
| A3 | 跨專業模型 Federation | `governance-service/federation` + Review Room handoff |
| A4 | 語意搜尋與模型問答 | Edge Console / future search service / controlled highlight |
| A5 | IoT / BMS / FM 數位分身 | future core service + optional 3D overlay |
| A6 | 4D / 5D 施工模擬 | future schedule service + optional Kit overlay |
| A7 | Reality Capture 比對 | future capture service + optional 3D deviation overlay |
| A8 | AI 訓練資料與 Synthetic Data | future GPU job lane / Replicator |
| A9 | 設計 / 審查 Copilot | future controlled operation-plan layer, session-layer only |
| A10 | 機器人 / 自動巡檢模擬 | future Isaac / robot simulation lane |

Repo 定位：先做可賣、可驗收的 CORE governance flow；Omniverse / Kit / Isaac 類能力視為 3D / GPU 加值，必須用真實 runtime evidence 才能宣稱 passed。

## 3. Frontend Operability Requirement

凡是 user-facing capability，完成標準不是 API 完成，而是一條可在瀏覽器驗收的 vertical slice：

```txt
UI route
→ visible button
→ default fixture
→ frontend request
→ real backend API
→ worker/runtime result
→ frontend status/result
→ viewer/console visible evidence
→ Playwright/Chrome screenshot or trace
```

### MUST

- 新增或更新 visible frontend route。
- 提供明確 UI controls / buttons。
- 提供 default fixture；不得要求使用者手動 curl / Postman / 找 payload。
- 前端按鈕必須打真實 backend API，不得只接 mock 除非明確標 `demo` / `fixture`。
- UI 必須顯示 loading、success、failure、retry state。
- UI 必須顯示相關 ID：`job_id`、`model_version_id`、`artifact_url`、`review_session_id`、`usd_stage_url`、`prim_path` / `ifc_guid`。
- 必須提供 browser E2E command、截圖/trace/console/network evidence。
- README / docs / PR 必須列手動驗收步驟。

### MUST NOT

- 不得以 backend tests only 宣告 user-facing feature 完成。
- 不得要求使用者只靠 curl / Postman 驗收。
- 不得把無遙測資料畫成 fail；應標 `未取得` / `not observed`。
- 不得用 fake mapping / fake fixture 當真實 conversion correctness。

## 4. PR Frontend Verification Table

PR 描述中 user-facing change 必須包含：

| Item | Result |
|---|---|
| Frontend route |  |
| Main button(s) |  |
| Fixture used |  |
| Backend API called |  |
| Runtime action |  |
| Visible success state |  |
| E2E command |  |
| Screenshot / trace |  |
| Manual test steps |  |
| Known gaps |  |

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

### MUST NOT

- 不得把上述 IFC commit 進 git。
- 不得複製大型 IFC / `model.usdc` / 巨大 artifact 到 repo tracked path。
- 不得用 fake mapping、placeholder USDC、或只有 CPU/backend semantic result 宣稱 viewer/runtime E2E passed。
- 不得在缺少 Kit WebRTC visual/runtime evidence 時宣告 full-system E2E complete。

## 6. Script Contract

`scripts/deploy.ps1` 是 canonical one-click deploy entrypoint。

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
