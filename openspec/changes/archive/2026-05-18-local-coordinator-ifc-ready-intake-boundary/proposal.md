# Local Coordinator IFC-ready Intake + Cloud Callback + Mock Retirement

## Why

依 `BIM模型管理平台 系統架構_260514.pdf` 雲地分離既有平台與使用者明確決策（`AGENTS.md §1.A` + `planB.txt`）：公司雲端 = 外部 control-plane，客戶落地端 IFC Worker = 外部 IFC 產出者，本 repo = 客戶落地端 data-plane runtime。目前對外入口仍綁內部 mock（`_worker`/`_bim-control`），閉環與 readiness 依賴它們，違反雲地分離與邊界原則；需把對外契約收斂到 coordinator、轉檔完成 callback 公司雲端（僅 metadata）、並把 mock 自產品 runtime 移除。

## What Changes

- **新增** coordinator 對外 intake：`POST /api/external/ifc-ready`（caller = 客戶落地端 IFC Worker，落地端內網）；Service auth（可替換 `AuthProvider`）、idempotency、local conversion job state、`external_model_version_id` binding；建立後呼叫 `bim-streaming-server` internal conversion API。
- **新增** 雲端 callback lifecycle：`conversion_result_ready` / `conversion_failed`，**metadata-only（禁傳 `.usdc` 等大檔）**，必備 callback outbox / retry / dead-letter / evidence log。
- **新增** local artifact shadow metadata：客戶落地端最小本地索引（idempotency / 轉檔 / web view / callback retry 用途；非 mirror 公司 MySQL）。
- **新增** runtime image Linux Kit launcher readiness：補 predecessor archive 遺留的 deferred 項；GPU/Kit/license 阻塞時標 `deferred`、不得標 passed。
- **修改** `conversion-webhook-lifecycle`：`ifc_ready` 來源 = 客戶落地端 IFC Worker；對外入口 = coordinator（非 `bim-streaming-server`）；新增 Service auth / callback outbox 語意；保留 correlation / idempotency。
- **修改** `streaming-ifc-usdc-conversion-authority`：收斂為 internal conversion engine（internal-only），非對外入口；IFC→USDC / element_mapping / manifest 轉檔核心語意不變。
- **修改** `demo-runtime-readiness-smoke`：核心 tier 不再依賴 `_worker`/`_bim-control`；改用 contract stub 呼叫 coordinator intake，驗 conversion + callback outbox + Kit launcher evidence。
- **修改** `runtime-verification-evidence`：新增 Kit launcher / callback outbox evidence 分層。
- **修改** `documentation-source-of-truth`：AGENTS.md / CLAUDE.md / roadmap 對齊 control-plane（公司雲端）/ data-plane（本 repo）。
- **BREAKING — 移除產品能力 / 核心 runtime 依賴**：`worker-rvt-ifc-bridge`、`bim-control-revit-intake-facade`、`worker-artifact-pipeline`。RVT→IFC bridge / RVT intake facade / worker artifact pipeline 屬外部平台；本 repo 刪除 `_worker/`、`_bim-control/` 服務，僅允許 `tests/fakes` + contract fixtures 模擬外部 API。

## Capabilities

### New Capabilities

- `local-coordinator-ifc-ready-intake-boundary` — coordinator 對外 IFC-ready intake 契約與邊界（caller 身份、auth、idempotency、job binding）。
- `external-cloud-callback-lifecycle` — 轉檔結果回拋公司雲端（metadata-only + outbox / retry / dead-letter）。
- `local-artifact-shadow-metadata` — 客戶落地端最小本地 shadow metadata 權責與欄位集合。
- `runtime-image-linux-kit-launcher-readiness` — runtime image 能 launch produced Linux Kit launcher 的就緒條件與證據規格。

### Modified Capabilities（本 change 內提供 delta）

- `conversion-webhook-lifecycle` — handoff 重新定錨於外部客戶落地端 IFC Worker → coordinator intake。
- `streaming-ifc-usdc-conversion-authority` — 收斂為 internal-only，由 coordinator internal request 觸發。
- `documentation-source-of-truth` — 對齊 control-plane（公司雲端）/ data-plane（本 repo）+ mock 退役。

### Apply-time（T9）spec 變更（對「當時現行 specs」撰寫，不在本 propose 做巨量易碎 delta）

下列 spec 變更面大且 specs 仍可能漂移；依範圍紀律與 OpenSpec「MODIFIED 須複製完整 requirement、避免 partial 失真」指引，於 apply 階段 T9 對 merge 後現行 specs 撰寫 delta（意圖已在 `## What Changes` 標明，含 BREAKING）：

- `demo-runtime-readiness-smoke`（MODIFIED：核心 tier 去 `_worker`/`_bim-control` 化、改 contract stub）
- `runtime-verification-evidence`（MODIFIED：新增 Kit launcher / callback outbox evidence 分層）
- `worker-rvt-ifc-bridge`（REMOVED as product capability：僅 test fixture 模擬）
- `bim-control-revit-intake-facade`（REMOVED as product capability：僅 test fixture 模擬）
- `worker-artifact-pipeline`（REMOVED as core runtime dependency：僅 test fixture 模擬）

## Impact

- **Owning repo / folder**：主要 `bim-review-coordinator/`（對外 intake + AuthModule + callback outbox + local web view session）；`bim-streaming-server/`（internal conversion API 收斂，轉檔核心不動）；刪除 `_worker/`、`_bim-control/`；`compose.*` / `scripts/*` / health / smoke；新增 `tests/fakes/`、`tests/contracts/`。
- **邊界保全**：對外契約集中於 coordinator（客戶落地端 local control-plane 邊界），`bim-streaming-server` 僅 internal engine（不變 god service）；資料權威切分 = 公司雲端 control-plane / 本 repo data-plane；大型模型/3D 檔不出客戶落地端（PDF 鐵律，callback 僅輕量 metadata）。
- **Non-goals**：不重寫 `bim-streaming-server` 既有 IFC→USDC 轉檔核心；不開發 PDF 平台（Nuxt 門戶 / MySQL / EZPLUS SSO / Revit plugin）；不保留 `_worker`/`_bim-control` 為 offline_fake runtime profile；GPU 採購 / 多 Kit 並行不在本 change。
- **API / event / runtime boundary changes（明確標示）**：
  - 新增對外 `POST /api/external/ifc-ready`（`bim-review-coordinator`）。
  - 新增雲端 callback event `conversion_result_ready` / `conversion_failed`（metadata-only）。
  - `ifc_ready` 來源由內部 `_worker` 改為外部客戶落地端 IFC Worker。
  - `bim-streaming-server` 對外入口移除，改 internal-only conversion API。
  - **刪除 `_worker`（:8005）/ `_bim-control`（:8001）服務** → startup / health / smoke / compose 為 BREAKING；§10 閉環需重寫（任務 T9）。
- **Open（需外部平台團隊確認；不阻塞本 propose，阻塞 T5 真實對接）**：OQ1 公司雲端 callback endpoint/auth；OQ2 source/usdc artifact ref scheme；OQ3 `external_model_version_id` / `external_conversion_task_id` 產生方與格式；OQ4 Service auth 憑證發放時程；OQ5 local web view ↔ 公司 SSO 銜接點。
