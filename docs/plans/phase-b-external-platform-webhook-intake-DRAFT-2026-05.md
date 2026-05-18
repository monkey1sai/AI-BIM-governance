# Phase B 規劃草稿 v2：客戶落地端 coordinator IFC-ready intake + 雲端 callback + mock 刪除

> **文件性質**：planning / pre-OpenSpec **DRAFT**（不是 OpenSpec change，不在 `openspec/changes/`，不開 worktree/PR，不動產品程式碼）。檔名沿用歷史（roadmap §1.1B 連結指向本檔）；內容已依 `C:\Users\IOT\Documents\planB.txt`（2026-05-18 修訂建議）整份重寫，取代 v1「外部 webhook intake + mock 降級保留」的方向。
> **gate 狀態**：`NoSuccessorWhilePredecessorOpen` **已清除**——predecessor `introduce-ai-bim-runtime-manager-docker-kit-mvp` 之 implementation PR #59（`55a9703`）+ archive PR #61（`5489328`）皆 MERGED；本 Plan B 可升格為正式 OpenSpec change。
> **建議升格 change-id**：`local-coordinator-ifc-ready-intake-boundary`（歷史別名：`external-platform-webhook-intake-boundary`，仍可沿用但語意較不準）。
> **建議 proposal title**：`Local Coordinator IFC-ready Intake + Cloud Callback + Mock Retirement`。
> **權威來源**：邊界決策 SoT = `AGENTS.md §1.A`；roadmap 對應 §1.1A/§1.1B；PDF `BIM模型管理平台 系統架構_260514.pdf`（雲地分離）；本次修訂輸入 = `planB.txt`（Q1–Q6 收斂 + 補充資料）。
> **回覆語言**：繁體中文；API 路徑 / schema 欄位 / status enum / 外部產品名稱保留原文。

---

## 0. 升格前置（gate 已清除）

```txt
gate：NoSuccessorWhilePredecessorOpen → 已清除
  predecessor introduce-ai-bim-runtime-manager-docker-kit-mvp
    implementation PR #59  MERGED (55a9703)
    archive       PR #61   MERGED (5489328) → openspec/specs/ 已含 runtime-manager-docker-kit-mvp（19 specs）
升格步驟：
  1. 從 synced main 重跑 change-id-resolve（確認 blockers=[]）
  2. opsx-worktree-guard → opsx-worktree-provision 開
     codex/openspec/local-coordinator-ifc-ready-intake-boundary
  3. 用本草稿 §4/§5/§6 跑 openspec-propose（先 explore 收斂 §8 剩餘 open questions）
  4. apply-and-verify 依 T0…T9 分批落地
```

---

## 1. Why / 新主軸（control-plane vs data-plane）

PDF 雲地分離：公司雲端負責 Web 門戶 / MySQL / EZPLUS SSO / 版本與權限（輕量 JSON metadata）；客戶落地端負責 MinIO / IFC Worker + Revit / 模型檔案儲存與 IFC 轉檔（重量資料 `.rvt`/`.ifc`/3D 幾何，流量由客戶端承擔，每家客戶獨立落地主機，公司雲端不存客戶模型原始檔）。

**Plan B v2 主軸（取代 v1 的「mock 降級保留」）**：

```txt
公司雲端 bim-control
  = 外部 control-plane（非本 repo）
  = SSO / RBAC / project / model version / conversion task / callback 接收 API

客戶落地端 IFC Worker + Revit
  = 外部既有 IFC 產出者（非本 repo）
  = 產出 .ifc 後呼叫本 repo

本 repo（客戶落地端 data-plane runtime）
  = coordinator external intake + streaming IFC→USDC + OpenUSD/USDC runtime
    + local web view + callback outbox
```

一句話：**本 repo 不再模擬公司雲端、也不再模擬 IFC Worker；只做客戶落地端該做的 OpenUSD / USDC runtime 與可視化服務。** 大模型與 3D 資料本就不該繞回公司雲端，而應在客戶落地端被轉換、快取、streaming、view —— 這正是本 repo 採用 Omniverse / OpenUSD 的核心理由之一。

---

## 2. Scope / Non-goals

### In scope

```txt
- coordinator 新增對外 POST /api/external/ifc-ready（auth / payload / idempotency /
  local job state / external_model_version_id binding / 呼叫 streaming internal API /
  收 conversion result / callback 雲端 / local web view 查詢入口）。
- streaming-server 收斂為「internal conversion engine」：只收 internal conversion
  request，輸出 USDC / element_mapping / manifest，不擁有對外契約。
- 雲端 callback：conversion_result_ready / conversion_failed，只傳輕量 metadata，
  必備 callback_outbox + retry + dead-letter + evidence log。
- 兩層 auth：User auth（web view，未來 EZPLUS SSO）、Service auth（IFC Worker→
  coordinator，machine-to-machine），以可替換 AuthProvider/AuthModule 介面實作。
- local artifact shadow metadata（最小本地索引，非 mirror 公司 MySQL）。
- 刪除 _worker / _bim-control（見 §3 Q4），測試改 tests/fakes + contract fixtures。
- T0：補 archive 遺留缺口 Validate runtime image launches produced Linux Kit launcher。
```

### Out of scope（non-goals）

```txt
- 不重寫 / 不重新驗證 streaming 既有 IFC→USDC 轉檔核心（沿用，只改觸發來源/邊界）。
- 不開發 PDF 平台本身（Nuxt 門戶 / MySQL / EZPLUS SSO / Revit plugin 全屬外部）。
- 不把 .usdc / 3D 大檔 callback 回公司雲端（PDF 鐵律：大檔只在客戶側流動）。
- 不在本 change 內處理 GPU 採購 / 多 Kit 並行（既有 P0-hold，分開）。
- 不保留 _worker / _bim-control 為 offline_fake runtime profile（與 v1 不同）。
```

---

## 3. Design（Q1–Q6 收斂結論）

### 3.1 新架構主流程

```txt
[公司雲端 bim-control]  Nuxt / MySQL / EZPLUS SSO / RBAC / model version / conversion task
        ▲
        │ callback: conversion_result_ready / conversion_failed（輕量 metadata only）
        │
[客戶落地端 IFC Worker + Revit]  產出 .ifc
        │  POST /api/external/ifc-ready（machine-to-machine，落地端內網）
        ▼
[本 repo: bim-review-coordinator]  ← 客戶落地端 local control-plane / 邊界服務
   external intake · AuthModule · idempotency · local job state
   · external_model_version_id binding · callback outbox · local web view session
        │  internal conversion request
        ▼
[本 repo: bim-streaming-server]  internal conversion engine（IFC→USDC / element_mapping / manifest）
        ▼
[本 repo: OpenUSD / Omniverse runtime]  Linux Kit launcher · USDC streaming · local web view
        ▼
[Browser]  使用者透過公司 SSO / token / local viewer access 開啟模型
```

### 3.2 Q1（收斂）：webhook caller = 客戶落地端 IFC Worker

```txt
webhook caller     = 客戶落地端 IFC Worker（與本 repo runtime 同一落地端內網）
network boundary    = 落地端內網（intra-LAN），非公司測試機直連
公司測試機 192.168.20.238 / 正式機 192.168.20.237 = 公司雲端側 Docker 主機
  （Nginx + Nuxt + MySQL），只透過 API 管理任務/版本/權限/接收 callback，
  不直接扮演 IFC-ready caller
```
→ Plan B 移除 v1「公司測試機直接呼叫 webhook」假設。

### 3.3 Q2（收斂）：intake 放 coordinator，不是 streaming-server

```txt
對外契約屬 coordinator；streaming-server 只保留 internal conversion API（非對外）。
IFC Worker → POST /api/external/ifc-ready → bim-review-coordinator
  - 驗證 caller / payload / idempotency
  - 建立 local conversion job、綁定 external_model_version_id
  - 呼叫 bim-streaming-server internal conversion API
  - 收 conversion result → callback 公司雲端 → 提供 local web view 查詢入口
bim-streaming-server
  - 只負責 IFC → USDC / element_mapping / conversion artifact
```
理由：coordinator 要負責產品邊界（外部身份、model version 關聯、web view session、callback/outbox、conversion 狀態機）；streaming-server 不應變成 god service（web view session 歸屬不清、metadata 散落、outbox 塞進轉檔服務、auth/SSO/RBAC 污染轉檔引擎、邊界不乾淨）。技術上可保留 streaming internal endpoint，但**對外契約屬 coordinator**。

### 3.4 Q3（收斂）：兩層 auth + 可替換 AuthProvider

```txt
A. User auth（browser / local web view）
   - 未來接 EZPLUS SSO；驗證 access_token / RBAC / project permission
B. Service auth（IFC Worker → coordinator webhook，machine-to-machine）
   - 不能只靠使用者 SSO；至少需 service credential
   - 現階段：intranet-dev provider = IP allowlist + X-Webhook-Secret/HMAC signature
     + correlation_id + idempotency_key + tenant_id/project_id/external_model_version_id
   - 未來：sso-token-introspection / machine-token / mTLS provider（介面不重做）
實作：AuthProvider / AuthModule 介面，先放 intranet-dev provider；不做死 SSO、
也不只做 IP allowlist。
```

### 3.5 Q4（收斂）：`_worker` / `_bim-control` 刪除（非降級）

```txt
從本 repo 刪除；不再作為 runtime profile / readiness tier；
不再出現在 start-all / health / smoke / compose 的預設或可選服務。
測試所需的「假外部平台」改為 test fixture / contract test / temp utility：
  tests/fakes/external_ifc_worker_client
  tests/fakes/cloud_bim_control_api
  tests/contracts/ifc_ready_payload.json
  tests/contracts/conversion_result_callback.json
  temp/ 手動測試工具（不進正式 runtime）
```
→ v1 的 R4「external-stub + offline_fake_mode 雙 tier」改為：**用 external contract test stub 保留驗證能力；不保留 offline_fake runtime profile。**

### 3.6 Q5（收斂）：conversion_result_ready 必須 callback 回公司雲端（metadata-only + outbox）

轉檔完成/失敗後本 repo **必須** callback 公司雲端 bim-control；**只傳輕量 metadata，不傳 `.usdc` 本體**（PDF 鐵律：大檔只在客戶辦公室 ↔ 客戶落地主機之間流動，不經公司伺服器）。

```json
// conversion_result_ready
{
  "event": "conversion_result_ready",
  "tenant_id": "xxx",
  "project_id": "xxx",
  "external_model_version_id": "xxx",
  "conversion_job_id": "xxx",
  "correlation_id": "xxx",
  "status": "ready",
  "source_ifc": { "ref": "minio://bucket/path/model.ifc", "etag": "..." },
  "artifacts": {
    "usdc_ref": "minio://bucket/path/model.usdc",
    "element_mapping_ref": "minio://bucket/path/element_mapping.json",
    "manifest_ref": "minio://bucket/path/manifest.json"
  },
  "artifact_summary": { "format": "USDC", "converter": "bim-streaming-server", "runtime": "openusd", "created_at": "..." }
}
```
```json
// conversion_failed
{ "event": "conversion_failed", "status": "failed", "reason": "...", "retryable": true, "correlation_id": "..." }
```
callback **必備**（非 optional）：`callback_outbox` + retry policy + dead-letter state + callback evidence log（客戶落地端可能暫時連不到公司雲端 API，不可「call 一次失敗就算了」）。

### 3.7 Q6（重新定義）：誰是什麼 metadata 的權威

| 權威方 | 擁有的 metadata |
|---|---|
| **公司雲端 bim-control（control-plane）** | tenant/customer、project、user、role/permission/RBAC、license、model version/commit record、IFC conversion task request、版本歷史、高階 artifact index、callback 接收狀態 |
| **本 repo（客戶落地端 data-plane）** | local conversion job state、source IFC local availability、USDC/OpenUSD artifact local availability、element_mapping local availability、artifact manifest、converter version、runtime image digest、Kit launcher validation evidence、local web view session/artifact resolution、callback outbox retry state |

本 repo **不 mirror 公司 MySQL**，只保存讓 local runtime 正常運作的最小 shadow metadata：

```txt
tenant_id / project_id / external_model_version_id / external_conversion_task_id /
correlation_id / source_ifc_ref / source_ifc_etag(checksum) / conversion_job_id /
artifact_manifest_ref / callback_url / callback_status / last_callback_attempt_at
```
正式答案：外部平台仍是 model_version 權威；本 repo 不 mirror 完整 metadata；本 repo 保存 local runtime 必需的 artifact shadow metadata；USDC/OpenUSD artifact 的 local availability 與 manifest 由本 repo 負責。

---

## 4. OpenSpec proposal 草案（升格時填入 proposal.md）

```txt
## Why
依 AGENTS.md §1.A + planB.txt：公司雲端 = 外部 control-plane；客戶落地端
IFC Worker = 外部 caller；本 repo = 客戶落地端 data-plane runtime。對外 intake
收斂於 coordinator，轉檔完成 callback 雲端（metadata-only + outbox），
_worker/_bim-control 自 repo 刪除。

## What Changes
- ADDED：local-coordinator-ifc-ready-intake-boundary、external-cloud-callback-lifecycle、
  local-artifact-shadow-metadata、runtime-image-linux-kit-launcher-readiness
- MODIFIED：conversion-webhook-lifecycle、streaming-ifc-usdc-conversion-authority、
  demo-runtime-readiness-smoke、runtime-verification-evidence、documentation-source-of-truth
- REMOVED（as product capability / core runtime dependency）：worker-rvt-ifc-bridge、
  bim-control-revit-intake-facade、worker-artifact-pipeline（僅允許 test fixture 模擬外部 API）

## Impact
- code：bim-review-coordinator（external intake + auth + outbox + web view session）、
  bim-streaming-server（internal conversion API 收斂）、刪 _worker/_bim-control、
  compose/scripts/health/smoke、tests/fakes + contract fixtures
- docs/SoT：AGENTS.md §1.A/§2-§11/§10 閉環、CLAUDE.md、roadmap、openspec/specs（T1/T9）
- 不改：streaming 既有 IFC→USDC 轉檔核心邏輯
```

---

## 5. Spec delta 草稿（升格時放 `openspec/changes/<id>/specs/`；依 OpenSpec 標頭改寫）

```txt
ADDED
- local-coordinator-ifc-ready-intake-boundary
  外部契約屬 coordinator；caller=客戶落地端 IFC Worker（intra-LAN）；
  POST /api/external/ifc-ready；Service auth（AuthProvider）；idempotency；
  local job state；external_model_version_id binding；呼叫 streaming internal API。
- external-cloud-callback-lifecycle
  conversion_result_ready / conversion_failed；metadata-only（禁傳大檔）；
  callback_outbox + retry + dead-letter + evidence log。
- local-artifact-shadow-metadata
  最小本地 shadow 欄位集合；非 mirror；idempotency/轉檔/web view/retry 用途。
- runtime-image-linux-kit-launcher-readiness
  runtime image 能 launch produced Linux Kit launcher；evidence 規格；
  GPU/Kit 阻塞 → deferred，不可標 passed。

MODIFIED
- conversion-webhook-lifecycle：ifc_ready 來源=客戶落地端 IFC Worker；
  入口=coordinator（非 streaming）；新增 Service auth / outbox 語意。
- streaming-ifc-usdc-conversion-authority：收斂為 internal conversion engine，
  非對外入口；轉檔核心不變。
- demo-runtime-readiness-smoke：核心不依賴 _worker/_bim-control；
  改用 contract stub 呼叫 coordinator intake，驗 conversion+callback outbox+Kit launcher evidence。
- runtime-verification-evidence：新增 Kit launcher / callback outbox evidence 分層。
- documentation-source-of-truth：AGENTS/CLAUDE/roadmap 對齊 control-plane/data-plane。

REMOVED（as product capability / core runtime dependency）
- worker-rvt-ifc-bridge：RVT→IFC 屬外部 IFC Worker，非本 repo 產品能力。
- bim-control-revit-intake-facade：RVT intake/metadata 屬外部公司雲端，非本 repo。
- worker-artifact-pipeline：不再是核心 runtime 依賴；僅 test fixture 模擬外部 API。
```
> 注意：active specs 內若仍有 worker / bim-control 能力描述，**不寫「降級」，寫 removed from product runtime，只允許 test fixture 模擬外部 API**。

---

## 6. Tasks 草稿（升格時放 tasks.md；分批、守 repo 邊界；順序依 planB §10）

```txt
T0  Runtime image closure（P0，補 archive 遺留）
    Validate runtime image launches produced Linux Kit launcher。
    驗收：image build 成功；Linux Kit launcher artifact 產生；launcher 於 Linux
    runtime image 內可執行；啟動後有可檢查 log；能載入 sample USDC 或至少完成
    Kit runtime smoke；evidence＝image digest/launcher path/startup log/exit code/
    USDC sample path；GPU/driver/Kit license 阻塞 → 標 deferred，不可標 passed。
T1  OpenSpec boundary rewrite（change-id=local-coordinator-ifc-ready-intake-boundary）
    定義 公司雲端=external control-plane、客戶落地端 IFC Worker=external caller、
    本 repo=local runtime/data-plane。
T2  Delete _worker / _bim-control
    刪 runtime 服務；移除 compose/scripts/health/smoke 依賴；改 tests/fakes +
    contract fixtures；移除 AGENTS/CLAUDE/roadmap 把它們當核心閉環的描述。
T3  Coordinator external intake
    POST /api/external/ifc-ready；payload schema；idempotency；AuthModule；
    local job state；呼叫 streaming internal API。
T4  Streaming server internal conversion API
    保留 IFC→USDC conversion authority（internal-only）；輸出 USDC/element_mapping/manifest；
    不做對外入口。
T5  Callback to company cloud
    conversion_result_ready / conversion_failed；callback outbox/retry/dead-letter；
    只傳 metadata，不傳大檔。
T6  Local artifact metadata model
    local shadow metadata；artifact_manifest；external_model_version_id binding；
    source_ifc_ref / usdc_ref / mapping_ref。
T7  Local web view integration
    coordinator 提供 viewer session / artifact resolution；使用者 SSO flow 預留；
    現階段可替換 auth provider。
T8  Readiness / smoke / evidence rewrite
    default smoke 不依賴 _worker/_bim-control；新 smoke 用 contract stub 呼叫
    coordinator intake；驗 conversion + callback outbox + Kit launcher evidence。
T9  Documentation cleanup
    AGENTS.md / CLAUDE.md / roadmap / OpenSpec specs 對齊（含 §10 閉環 rewrite）。
```
每批驗證：type check → lint → 該服務目錄 affected unit/contract tests → 必要時 smoke；Python tests 各自服務目錄跑。修改 function/class/method 前依 GitNexus 規範跑 impact analysis；HIGH/CRITICAL 先回報。

---

## 7. 風險與緩解

```txt
R1 大改面（刪服務 + coordinator 升格邊界）：依 T0…T9 分批，每批最小驗證，
   高 impact 先 GitNexus impact analysis。
R2 §10 閉環現綁 mock：T2/T9 收斂；落地前本地 demo 仍可跑（過渡）。
R3 callback 對象（公司雲端 bim-control API 契約）未定：屬外部平台團隊；
   先以 contract fixture 凍結 payload，real endpoint 待外部提供 → §8 open。
R4（取代 v1）：用 external contract test stub 保留驗證能力；
   不保留 offline_fake runtime profile。
R5 callback outbox/Kit launcher 是必要工作：不得當 optional；
   GPU/Kit 阻塞 evidence 標 deferred，不可謊報 passed。
R6 Service auth 過早做死：用 AuthProvider 介面，先 intranet-dev provider，
   未來加 sso/machine-token/mTLS provider 不重做。
R7 spec REMOVE 面大：升格 explore 時依當時 openspec/specs 現況逐一收斂；
   高 impact MODIFIED/REMOVED 先 impact analysis。
```

---

## 8. Open questions（升格 explore 時收斂；Q1–Q6 已答）

```txt
已收斂：Q1 caller=客戶落地端 IFC Worker；Q2 intake=coordinator；
        Q3 兩層 auth + AuthProvider；Q4 刪除 mock；Q5 雲端 callback+outbox；
        Q6 control-plane/data-plane 權威切分 + 最小 shadow metadata。
仍需外部平台團隊確認（不阻塞升格 propose，阻塞 T5 真實對接）：
  OQ1 公司雲端 bim-control callback 接收 endpoint URL / auth（machine token? mTLS?）
  OQ2 source_ifc / usdc artifact 的 ref scheme（minio:// bucket 命名、etag 來源）
  OQ3 external_model_version_id / external_conversion_task_id 由誰產生、格式
  OQ4 IFC Worker → coordinator 的 Service auth 憑證由公司平台發放的時程
  OQ5 local web view 與公司 SSO 的銜接點（token introspection? redirect?）
```

---

## 9. 升格 checklist（gate 已清除，可直接走）

```txt
[x] PR #59 implementation merged（55a9703）
[x] PR #61 archive merged（5489328）→ openspec/specs 19、gate 清除
[ ] git fetch origin --prune；本地 main == origin/main
[ ] change-id-resolve 重跑 → blockers=[]
[ ] opsx-worktree-guard → provision codex/openspec/local-coordinator-ifc-ready-intake-boundary
[ ] openspec-propose：用 §4/§5/§6 產 proposal/design/tasks/specs（先 explore 收斂 §8 OQ1–OQ5）
[ ] apply-and-verify 依 T0…T9 分批；T0 先行（runtime image closure）
[ ] 完成後 §1.6 同步 roadmap + AGENTS/CLAUDE，把過渡語意收斂為正式邊界
```
