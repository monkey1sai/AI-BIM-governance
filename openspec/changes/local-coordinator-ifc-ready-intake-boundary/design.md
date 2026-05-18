# Design — Local Coordinator IFC-ready Intake + Cloud Callback + Mock Retirement

> 動機見 `proposal.md`；需求句式見 `specs/`。本文聚焦架構與技術決策（why），不逐行實作。

## Context

`BIM模型管理平台 系統架構_260514.pdf` 為雲地分離既有平台：公司雲端負責 Web 門戶 / MySQL / EZPLUS SSO / 版本與權限（輕量 JSON metadata）；客戶落地端負責 MinIO / IFC Worker + Revit / 模型檔案儲存與 IFC 轉檔（重量資料，每家客戶獨立落地主機，公司雲端不存客戶模型原始檔）。

現況：本 repo 對外入口仍綁內部 mock（`_worker` :8005 / `_bim-control` :8001），`AGENTS.md §10` 閉環、`demo-runtime-readiness-smoke`、`compose`/`scripts` 皆依賴它們。決策權威 `AGENTS.md §1.A`（2026-05-18 修訂，依 `planB.txt`）將本 repo 定位收斂為「客戶落地端 data-plane runtime」。

Stakeholders：本 repo（coordinator / streaming / OpenUSD runtime / local web view）、外部公司雲端 `bim-control`（control-plane）、外部客戶落地端 IFC Worker（IFC 產出者）。

## Goals / Non-Goals

**Goals**

- 對外契約收斂於 `bim-review-coordinator`；`bim-streaming-server` 收斂為 internal conversion engine。
- 轉檔結果以 metadata-only callback 回拋公司雲端，具 outbox / retry / dead-letter。
- `_worker` / `_bim-control` 自產品 runtime 刪除；測試改 `tests/fakes` + contract fixtures。
- 補 predecessor archive 遺留的 Linux Kit launcher readiness（誠實 deferred，不謊報）。
- control-plane（公司雲端）/ data-plane（本 repo）資料權威切分明確化。

**Non-Goals**

- 不重寫 `bim-streaming-server` 既有 IFC→USDC 轉檔核心。
- 不開發 PDF 平台（Nuxt / MySQL / EZPLUS SSO / Revit plugin）。
- 不保留 `_worker`/`_bim-control` 為 offline_fake runtime profile。
- GPU 採購 / 多 Kit 並行不在本 change（既有 P0-hold）。

## Decisions

### D1 webhook caller = 客戶落地端 IFC Worker（非公司測試機）

選定：caller = 客戶落地端 IFC Worker，network boundary = 落地端內網（intra-LAN）。
理由：PDF 明確重量資料/轉檔在客戶落地端，每家客戶獨立落地主機；公司測試機 `192.168.20.238`/正式機 `192.168.20.237` 是公司雲端側 Docker 主機（Nginx+Nuxt+MySQL），只透過 API 管理任務/版本/權限/接收 callback。
Alternative（否決）：公司測試機直連 webhook —— 與雲地分離矛盾，且大檔需經客戶落地端流動。

### D2 對外 intake 放 coordinator，streaming 僅 internal

選定：對外契約屬 `bim-review-coordinator`（`POST /api/external/ifc-ready`）；`bim-streaming-server` 保留 internal conversion API、非對外入口。
理由：coordinator 要負責產品邊界（外部身份、`external_model_version_id` 關聯、local web view session、callback/outbox、conversion 狀態機）。
Alternative（否決）：intake 放 `bim-streaming-server`（短期較快）—— 會導致 web view session 歸屬不清、metadata 散落、outbox 塞進轉檔服務、auth/SSO/RBAC 污染轉檔引擎、streaming 變 god service、邊界不乾淨。

### D3 兩層 auth + 可替換 AuthProvider

選定：A. User auth（browser / local web view，未來接 EZPLUS SSO）；B. Service auth（IFC Worker→coordinator，machine-to-machine）。實作 `AuthProvider` / `AuthModule` 介面，先放 `intranet-dev` provider（IP allowlist + `X-Webhook-Secret`/HMAC signature + `correlation_id` + `idempotency_key` + tenant/project/`external_model_version_id`）。
理由：機器對機器不能只靠使用者 SSO；現在不做死 SSO、也不只做 IP allowlist；介面化讓未來新增 `sso-token-introspection` / `machine-token` / `mTLS` provider 不重做。
Alternative（否決）：只做 IP allowlist（不足以防偽 caller）；現在就硬接 EZPLUS SSO（外部時程未定、會綁死）。

### D4 `_worker`/`_bim-control` 刪除（非降級保留）

選定：自 repo 刪除；不再作 runtime profile / readiness tier / compose / start-all / health / smoke 預設或可選服務。測試所需的假外部平台改為 `tests/fakes/external_ifc_worker_client`、`tests/fakes/cloud_bim_control_api`、`tests/contracts/*.json`、`temp/` 手動工具（不進正式 runtime）。
理由：保留為 offline fake 會讓邊界與雲地分離無法落地，且維持兩個產品服務的負擔無價值。
Alternative（否決）：v1 的「降級保留 offline_fake runtime profile」—— 依 `planB.txt` 明確改為刪除。

### D5 雲端 callback：metadata-only + outbox（必要，非 optional）

選定：轉檔完成/失敗必 callback 公司雲端 `bim-control`；payload 僅輕量 metadata（`source_ifc.ref`/`etag`、`artifacts.*_ref`、`artifact_summary`），**不傳 `.usdc` 本體**；必備 `callback_outbox` + retry policy + dead-letter state + callback evidence log。
理由：PDF 鐵律——大型模型檔案只在客戶辦公室 ↔ 客戶落地主機之間流動，不經公司伺服器；客戶落地端可能暫時連不到公司雲端 API，不可「call 一次失敗就算了」。
Alternative（否決）：callback 帶 artifact 本體（違反雲地分離）；無 outbox 的單次 callback（落地端網路波動即遺失結果）。

### D6 control-plane / data-plane 資料權威切分

選定：
- 公司雲端 `bim-control`（control-plane 權威）：tenant/customer、project、user、role/permission/RBAC、license、model version/commit、conversion task request、版本歷史、高階 artifact index、callback 接收狀態。
- 本 repo（data-plane 權威）：local conversion job state、source IFC / USDC / element_mapping local availability、artifact manifest、converter version、runtime image digest、Kit launcher validation evidence、local web view session、callback outbox retry state。
- 本 repo 僅保存最小 shadow metadata（`tenant_id`/`project_id`/`external_model_version_id`/`external_conversion_task_id`/`correlation_id`/`source_ifc_ref`/`source_ifc_etag`/`conversion_job_id`/`artifact_manifest_ref`/`callback_url`/`callback_status`/`last_callback_attempt_at`），**非 mirror 公司 MySQL**。
理由：control-plane / data-plane 分界即 PDF 雲地分離；本地僅需 idempotency / 轉檔 / web view / callback retry 所需索引。

### D7 主流程架構

```txt
[公司雲端 bim-control] control-plane（Nuxt/MySQL/SSO/RBAC/model version/task）
        ▲  callback: conversion_result_ready / conversion_failed（metadata-only）
        │
[客戶落地端 IFC Worker + Revit] 產出 .ifc
        │  POST /api/external/ifc-ready（machine-to-machine，落地端內網）
        ▼
[本 repo bim-review-coordinator] external intake · AuthModule · idempotency ·
        local job state · external_model_version_id binding · callback outbox ·
        local web view session
        │  internal conversion request
        ▼
[本 repo bim-streaming-server] internal: IFC→USDC / element_mapping / manifest
        ▼
[本 repo OpenUSD/Omniverse runtime] Linux Kit launcher · USDC streaming · local web view
        ▼
[Browser] 使用者經公司 SSO / token / local viewer access 開啟模型
```

## Risks / Trade-offs

- [大改面：刪服務 + coordinator 升格邊界] → 依 T0…T9 分批，每批最小驗證；高 impact symbol 先 GitNexus impact analysis，HIGH/CRITICAL 先回報。
- [§10 閉環現綁 mock] → T2/T9 收斂；落地前本地 demo 仍可跑（過渡）。
- [公司雲端 callback API 契約未定] → 先以 contract fixture 凍結 payload，real endpoint 待外部（OQ1）；阻塞 T5 真實對接，不阻塞本 change propose。
- [取代 v1 R4] → 用 external contract test stub 保留驗證能力；不保留 offline_fake runtime profile。
- [callback outbox / Kit launcher 是必要工作] → 不得當 optional；GPU/Kit 阻塞 evidence 標 `deferred`，不可謊報 passed。
- [Service auth 過早做死] → `AuthProvider` 介面，先 `intranet-dev`，未來加 provider 不重做。
- [spec REMOVE 面大] → apply 時依當時 `openspec/specs/` 現況逐一收斂；REMOVED/MODIFIED 高 impact 先 impact analysis。

## Migration Plan

依 `tasks.md` T0…T9 分批；rollback 策略：每批為最小可回復 diff、走 PR + GitHub Actions，未 merge 不影響 main；`_worker`/`_bim-control` 刪除前先建立 `tests/fakes`+contract fixtures 確保驗證能力不中斷；§10 閉環/AGENTS/CLAUDE/roadmap/specs rewrite 收斂於 T9，merge 後才 OpenSpec sync/archive 並依 §1.6 同步 roadmap。

## Open Questions

- OQ1 公司雲端 `bim-control` callback 接收 endpoint URL / auth（machine token? mTLS?）。
- OQ2 source / usdc artifact 的 ref scheme（`minio://` bucket 命名、`etag` 來源）。
- OQ3 `external_model_version_id` / `external_conversion_task_id` 由誰產生、格式。
- OQ4 IFC Worker → coordinator 的 Service auth 憑證由公司平台發放時程。
- OQ5 local web view 與公司 SSO 的銜接點（token introspection? redirect?）。

> OQ1–OQ5 屬外部平台團隊確認事項；不阻塞本 change 之 propose 與 spec/task 撰寫，阻塞 T5（雲端 callback 真實對接）與 T7（SSO 銜接）的最終驗收。
