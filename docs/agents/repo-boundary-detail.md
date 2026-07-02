> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：需要做跨 sub-repo 決策、修改 repo boundary、查 data 權威歸屬、追資料流時。

# Repo Boundary Detail

> wiki / Source of Truth 規範見 root `AGENTS.md` §3；本檔不再重複維護。

`AI-BIM-governance/` workspace 的完整 repo 邊界、資料流動、互動方式與禁止跨界規則。AGENTS.md 主檔只保留一句話摘要與 mermaid 入口；本檔承擔完整細節。

---

## 1. Workspace 範圍

主要開發資料夾：

```txt
AI-BIM-governance/
```

核心 repo / folder：

```txt
AI-BIM-governance/
├── bim-review-coordinator/      # 控制中心，localhost:8004
├── bim-streaming-server/        # Kit streaming + IFC→USDC authority，WebRTC 49100
├── governance-service/          # A1/A2/A3 governance authority，127.0.0.1:49102 loopback
├── web-viewer-sample/           # browser client，localhost:5173
├── apps/kit-manager-web/        # Kit Manager operator UI
├── services/kit-manager-api/    # Kit Manager API，:8010
└── tests/                       # external platform contracts + test-only fakes
```

```mermaid
flowchart TD
  CO[bim-review-coordinator<br/>Control Plane]
  KIT[bim-streaming-server<br/>IFC→USDC Authority + Kit Runtime]
  GOV[governance-service<br/>A1/A2/A3 Governance Authority :49102]
  CLOUD[[external company-cloud bim-control<br/>Control Plane]]
  EDGE[[external customer-edge IFC Worker]]
  WV[web-viewer-sample<br/>Browser Client]
  KM[kit-manager web + api :8010]

  EDGE -->|POST /api/external/ifc-ready| CO
  CO -->|start / check / reference process| KIT
  CO -->|/api/governance/* proxy| GOV
  CO -->|metadata-only callback outbox| CLOUD
  WV -->|REST: create/join session| CO
  WV -->|WebRTC + DataChannel| KIT
  KM -->|Kit fleet ops / telemetry| KIT
```

其中：

```txt
bim-review-coordinator/
bim-streaming-server/
web-viewer-sample/
tests/contracts/
tests/fakes/
```

是 B 方案後正式架構中的核心互動 repo / test-only fixture。`_worker/` 與 `_bim-control/` 已自 repo 刪除；歷史描述見 `docs/agents/history-and-archive.md`。

---

## 1.A 架構決策（2026-05-15）：外部既有平台邊界與 webhook intake

> 依使用者明確指令與 `BIM模型管理平台 系統架構_260514.pdf`（雲地分離）。本節為 **B 方案落地後的現行邊界**，優先序高於下方保留的歷史描述。`_bim-control` / `_worker` 已不再是本 repo runtime 依賴。

### 決策

```txt
1. PDF 平台（公司雲端 Web門戶/MySQL/SSO + 客戶落地端 IFC Worker+Revit）
   = 外部既有系統，已部署於公司測試機/正式機
   （ppms 192.168.20.238 / normal 192.168.20.237），
   不屬於 AI-BIM-governance 的功能開發範圍。
2. `_bim-control` / `_worker` 已**自 repo 刪除**（removed from product runtime，
   **非降級、非保留為 offline fake runtime profile**）；外部公司雲端 control-plane
   與客戶落地端 IFC Worker 屬外部既有系統，僅由 `tests/fakes` + `tests/contracts`
   模擬（design D4：test fixture，非 runtime）。**[2026-05-18 B 方案落地]**
3. 本 repo 唯一對外入口 = `bim-review-coordinator` `POST /api/external/ifc-ready`
   （caller = 客戶落地端 IFC Worker，落地端內網，Service auth）；收到後建立
   local conversion job 並對 `bim-streaming-server` 發 internal conversion
   request（internal-only：spec `streaming-ifc-usdc-conversion-authority`
    + `conversion-webhook-lifecycle`）；轉檔結果以 metadata-only callback
   outbox 回拋公司雲端（spec `external-cloud-callback-lifecycle`）。
4. 本 repo 開發範圍收斂為：
   webhook intake → IFC→USDC → Kit streaming → BIM 治理
   （bim-streaming-server / bim-review-coordinator / web-viewer-sample）。
```

### 落地方式與衝突管理（重點）

完整 OpenSpec change 執行紀錄（PR #63 / PR #59 / mergeCommit 55a9703 / archive 路徑）已遷至 `docs/agents/history-and-archive.md` §3.7。

> **[2026-05-18 修訂｜依 `planB.txt`]** 本決策已細化（取代上方「降級為 fake / offline profile」字面）：(1) `_worker` / `_bim-control` **自 repo 刪除**（非降級保留），測試改 `tests/fakes` + contract fixtures；(2) 對外 intake 收斂於 **`bim-review-coordinator`**（`POST /api/external/ifc-ready`），`bim-streaming-server` 僅 internal conversion engine；(3) webhook caller = 客戶落地端 IFC Worker（落地端內網，非公司測試機直連）；(4) 新增**雲端 callback outbox**（metadata-only，禁傳 `.usdc` 大檔）；(5) 公司雲端=control-plane / 本 repo=客戶落地端 data-plane 權威切分；(6) change-id `local-coordinator-ifc-ready-intake-boundary` 已於 PR #63 apply。完整方案見 archived OpenSpec change `openspec/changes/archive/2026-05-18-local-coordinator-ifc-ready-intake-boundary/`。**§10/§11 為現行閉環；其他歷史段落若與本決策衝突，以本節與 §10/§11 為準。**

---

## 2. 核心 repo 的定位總覽

```mermaid
flowchart LR
    EDGE["[外部] 客戶落地端 IFC Worker"]
    CLOUD["[外部] 公司雲端 bim-control"]
    CO["bim-review-coordinator\nExternal IFC-ready intake + Session / Control Plane"]
    KIT["bim-streaming-server\nIFC→USDC Authority\n+ Omniverse Kit Runtime"]
    GOV["governance-service\nA1/A2/A3 Governance Authority\n127.0.0.1:49102 loopback"]
    WV["web-viewer-sample\nBrowser Client"]
    KM["kit-manager web + api\n:8010"]

    EDGE -->|POST /api/external/ifc-ready| CO
    CO -->|internal conversion request| KIT
    CO -->|/api/governance/* proxy| GOV
    CO -->|metadata-only callback outbox| CLOUD
    WV -->|REST: create / join session| CO
    WV -->|WebRTC video + DataChannel JSON| KIT
    WV -->|Socket.IO / WebSocket state events| CO
    CO -->|optional collaboration state| KIT
    WV -->|annotation / issue interaction| CO
    KM -->|Kit fleet ops / telemetry| KIT
```

一句話定位：

```txt
[外部] company cloud  = control-plane 權威（本 repo 不 mirror）
[外部] IFC Worker     = 客戶落地端 IFC 產出者（本 repo 不啟動）
bim-review-coordinator = 唯一對外 IFC-ready intake + Session / 協作控制中心
bim-streaming-server   = IFC→USDC conversion authority + Omniverse GPU / USD / WebRTC Runtime
governance-service     = A1 rule-run / A2 diff / A3 federation / issue / BCF loopback authority（僅 coordinator proxy 可達）
web-viewer-sample      = Browser 操作端與串流觀看端
kit-manager web + api  = operator-facing Kit 機隊 UI / API（:8010）
tests/fakes/contracts  = 外部平台 test-only doubles，非 runtime profile
```

---

## 3. Repo 邊界

> **B 方案現行判讀規則**：本節中提到 `_bim-control` / `_worker` 的角色描述只保留為歷史邊界與 test-double 對照；兩者已自 product runtime 刪除（細節見 `docs/agents/history-and-archive.md`）。現行 runtime 邊界以 §1.A、§10、§11 為準。

## 3.4 `bim-review-coordinator/`

### 角色

```txt
Session Control Plane / Collaboration Coordinator
```

### 邊界

`bim-review-coordinator` 是 review session 的協調中心。

它負責協調：

```txt
- review session 狀態
- browser client 與 Kit streaming server 的連線資訊
- user presence / collaboration state
- selection / annotation / issue focus 等協作事件
- fake BIM platform 與 fake storage 的資料查詢路由
```

它不負責：

```txt
- USD stage loading
- Omniverse viewport rendering
- WebRTC video encoding
- IFC / USD 檔案內容轉換
- 直接保存大型檔案
- 取代外部公司雲端 control-plane 成為資料權威
- 取代 web-viewer-sample 成為 UI
```

> **例外 carve-out(2026-05-21,change `fast-ifc-link-demo-loop`)**:
> 允許 coordinator 在 `POST /api/external/ifc-ready` 的同步階段,將外部 IFC 下載
> 至本地 shared volume 路徑 `storage/ifc-cache/<ifc_ready_job_id>/source.ifc`,
> 作為 dispatch streaming-server 前的**臨時通道快取**(非資料權威)。coordinator
> 不視為該 IFC bytes 的資料權威:權威仍屬外部公司雲端 control-plane
> (`external_model_version_id` 參照),streaming-server 為 conversion authority。
> 規範細節見 spec `local-coordinator-ifc-ready-intake-boundary` 內
> `Coordinator synchronously downloads IFC to shared volume before responding`
> requirement。Transition 過後若另有設計(streaming-server 直接從 MinIO pull、
> 或 sidecar service 處理下載),carve-out 可由新的 spec 變更（branch → PR）收斂回原邊界。

### 控制邊界

`bim-review-coordinator` 可以知道：

```txt
session_id
user_id
model_version_id
kit_instance_id
stream_config
presence state
collaboration event
```

但不應該知道或操作：

```txt
USD internal prim tree implementation
Omniverse material / camera / renderer internal details
large binary file bytes
```

---

## 3.5 `bim-streaming-server/`

### 角色

```txt
IFC→USDC Conversion Authority / Omniverse Kit Runtime / GPU Streaming Server
```

### 邊界

`bim-streaming-server` 是 B 方案的 IFC→USDC conversion job authority，同時仍是 Omniverse Kit runtime。

它負責處理：

```txt
- 接收 coordinator 的 internal conversion request（上游為外部客戶落地端 IFC Worker 的 ifc-ready webhook，經 coordinator 收斂）
- 建立 conversion_job_id 並管理 queued / running / succeeded / failed / cancelled 狀態
- 對外提供 IFC→USDC conversion status / result API
- 透過 headless converter app / subprocess / worker lane 執行 heavy conversion
- 產出 model.usdc、element_mapping.json、entity_index.json、metadata.json 或等價 result payload
- 保留 mapping quality metrics、sidecar carrier 與 no-placeholder-ready 語意
- callback coordinator conversion_result_ready / conversion_failed（coordinator 再經 metadata-only callback outbox 回拋外部公司雲端）
- USD / USDC stage runtime
- Omniverse Kit viewport
- GPU rendering
- WebRTC video stream
- WebRTC DataChannel JSON command
- stage tree / prim selection / camera / visual overlay 的 runtime 操作
```

它不負責：

```txt
- project / model version 的資料權威
- 使用者登入與權限
- review session lifecycle 的總控
- 多人協作事件的中心廣播
- 長期 annotation / issue 儲存
- 假 S3 檔案倉庫
- 假 BIM API
- 阻塞 live WebRTC viewport thread 執行大型 IFC→USDC conversion
```

### Runtime 邊界

`bim-streaming-server` 只處理「目前這個 stream session 中的 3D runtime 狀態」。

它可以處理：

```txt
目前開啟哪個 USD / USDC
目前選取哪個 prim
目前 viewport camera 狀態
目前套用哪些 visual overlay
```

但這些狀態若要成為正式審查資料，必須經 `bim-review-coordinator` 回寫至正式資料權威（外部公司雲端 control-plane）。

---

## 3.6 `web-viewer-sample/`

### 角色

```txt
Browser Client / WebRTC Viewer / User Interaction Layer
```

### 邊界

`web-viewer-sample` 是瀏覽器操作端。

它負責：

```txt
- 顯示 WebRTC 串流畫面
- 送出 DataChannel JSON command 給 bim-streaming-server
- 接收 bim-streaming-server 回傳的 scene state / command result
- 與 bim-review-coordinator 交換 session / collaboration state
- 顯示 project / issue / annotation / stage tree 等 UI 狀態
```

它不負責：

```txt
- 啟動或停止 Kit server
- 分配 GPU
- 保存專案資料
- 保存大型模型檔案
- 執行 IFC / USD 轉檔
- 執行法規 / 碳排 / AI 判斷
- 取代 coordinator 管理 session
```

### Client 邊界

`web-viewer-sample` 是使用者對整個系統的操作入口，但不是資料權威，也不是 GPU runtime。

它可以送出操作意圖，例如：

```txt
open stage
select prim
highlight issue
add annotation
focus issue
join session
leave session
```

但操作結果應該由對應 repo 處理：

```txt
3D runtime 操作 → bim-streaming-server
session / collaboration → bim-review-coordinator
metadata / review data → bim-review-coordinator（上游權威＝外部公司雲端 bim-control）
file / conversion access → bim-review-coordinator（conversion 權威＝bim-streaming-server）
```

---

## 3.7 `governance-service/`

### 角色

A1「BIM 治理與模型檢核」與 A2 diff / A3 federation 的 core governance backend authority。落地端內部 Python/FastAPI 服務（`127.0.0.1:49102` loopback），對真實 IFC 跑宣告式規則集（`rules/*.yaml` DSL + `rule_engine/`），產出 governance score、failed elements、issue / BCF / diff / federation 等 CPU governance results。純 CPU host-native ifcopenshell，無 GPU / Kit 依賴。

### 邊界

- MUST 綁 `127.0.0.1`；瀏覽器 MUST NOT 直連，一律經 coordinator `/api/governance/*` proxy（缺席時 coordinator 誠實回 502）。
- MUST 唯讀消費既有 `element_mapping.json`；不自行轉檔、不改寫 USDC（conversion 屬 `bim-streaming-server` :49101）。
- 以 `ifc_guid` 為主鍵；`usd_prim_path` 未對映時為 `null`，不捏造；fake/smoke mapping 不得當真實覆蓋率。
- 不擁有：對外控制面 / session / callback outbox（coordinator）、瀏覽器 UI（web-viewer-sample）、Kit runtime（streaming）。
- 詳細規則見 `governance-service/AGENTS.md`（七段 schema）。

## 3.8 `apps/kit-manager-web/` 與 `services/kit-manager-api/`

Operator-facing Kit 機隊管理：`kit-manager-api`（FastAPI `:8010`）掌 Kit instance 啟停 / 遙測；`kit-manager-web`（Vite）是 operator UI。不參與 IFC 轉檔、governance 判定與 review session lifecycle；詳細規則見各自 `AGENTS.md`。

## 4. 資料類型與歸屬

| 資料類型 | 權威 repo / folder | 說明 |
|---|---|---|
| Project metadata | 外部公司雲端 `bim-control` | Control-plane 權威；本 repo 不 mirror |
| Model version metadata | 外部公司雲端 `bim-control` | 以 `external_model_version_id` 參照 |
| Artifact metadata | 外部公司雲端 `bim-control` + 本地最小 shadow | 高階索引在雲端；本地只保存轉檔與 callback 必要欄位 |
| Source IFC reference | 外部客戶落地端 IFC Worker + `bim-review-coordinator` shadow | IFC 產出者為外部系統；coordinator 保存 ref/etag/correlation |
| USD / USDC file | `bim-streaming-server` | B 方案 IFC→USDC conversion authority 產出的衍生檔 |
| element_mapping.json / entity_index.json | `bim-streaming-server` + 本地 shadow | 檔案由 streaming conversion result 產出；雲端只接 metadata-only callback |
| Callback delivery state | `bim-review-coordinator` | metadata-only outbox / retry / dead-letter |
| Review issue metadata | 外部公司雲端 `bim-control` / 本地最小 shadow | 真實權威在外部 control-plane |
| Annotation metadata | `bim-review-coordinator` local event + 外部 control-plane callback | 本地保存協作事件；正式權威依外部平台決定 |
| Review session state | `bim-review-coordinator` | 當前 session 狀態 |
| Collaboration state | `bim-review-coordinator` | presence / selection / issue focus / annotation event |
| USD stage runtime state | `bim-streaming-server` | 當前 Omniverse scene runtime 狀態 |
| Browser UI state | `web-viewer-sample` | 當前前端 UI 狀態 |

---

## 5. 核心資料流

## 5.1 Artifact Discovery Flow

> **退役狀態**：本節描述的『web-viewer-sample 請求 session → bim-review-coordinator 同步查詢 _bim-control 取得 artifact / conversion 狀態』流程已被 B 方案（_bim-control 已刪除、對外 intake 收斂於 coordinator webhook + 雲端 metadata-only callback outbox，見 §1.A / §10）取代。完整歷史 mermaid 與邊界說明遷至 `docs/agents/history-and-archive.md` §3.4。現行等效資訊見 §10 Workspace 最重要閉環。

---

## 5.2 Streaming Flow

```mermaid
sequenceDiagram
    participant WV as web-viewer-sample
    participant KIT as bim-streaming-server

    WV->>KIT: WebRTC connect
    KIT-->>WV: Rendered viewport stream
    WV->>KIT: DataChannel openStageRequest { stage_composition }
    KIT->>KIT: Open primary USDC + apply secondary subLayers
    KIT-->>WV: DataChannel openedStageResult
```

### 邊界說明

```txt
WebRTC video stream 只存在於 web-viewer-sample 與 bim-streaming-server 之間。
USD / USDC conversion result 由 bim-streaming-server 在 B 方案下提供。
bim-streaming-server 載入、渲染，且是 IFC→USDC conversion job authority；它仍不成為 project / issue / annotation 的資料權威。
```

---

## 5.3 Scene Interaction Flow

```mermaid
sequenceDiagram
    participant WV as web-viewer-sample
    participant KIT as bim-streaming-server

    WV->>KIT: DataChannel getChildrenRequest
    KIT-->>WV: getChildrenResponse
    WV->>KIT: DataChannel selectPrimsRequest
    KIT-->>WV: stageSelectionChanged
    WV->>KIT: DataChannel highlightPrimsRequest
    KIT-->>WV: highlightPrimsResult
```

### 邊界說明

```txt
Scene interaction 是 browser client 與 Kit runtime 之間的 DataChannel JSON 流程。
這些 runtime interaction 不等於正式資料保存。
若要保存成審查紀錄，必須經 coordinator 回寫（上游正式權威＝外部公司雲端 control-plane）。
```

---

## 5.4 Collaboration Flow

> **退役狀態(2026-05-21,change `remove-conflict-review-from-fast-mvp`)**:本節
> collaboration broadcast(highlight / selection / annotation)在 coordinator 與
> viewer 兩端的 implementation 已從 fast MVP product runtime 移除(`reviewNamespace.ts`
> 內的 `highlightRequest` / `selectionUpdate` / `annotationCreate` Socket.IO event
> handlers、viewer `IssuePanel` / `EventLogPanel` 已刪)。本 sequence 保留作為
> archive context;viewer Change 2 (`fast-ifc-link-demo-loop`) 將 viewer 主畫面
> 收斂為「全螢幕 stream + 邊框 HUD」,不含多人協作 UI。若未來重新引入,以新
> spec 變更新增 requirement 與 viewer slot。

完整歷史 mermaid 與邊界說明遷至 `docs/agents/history-and-archive.md` §3.4。

---

## 5.5 Review Result Visualization Flow

> **退役狀態(2026-05-21,change `remove-conflict-review-from-fast-mvp`)**:本節
> review issue → DataChannel `highlightPrimsRequest` 的「issue 流」入口
> (viewer `IssuePanel` + coordinator `getReviewIssues` / `review-bootstrap`
> endpoint)已從 fast MVP product runtime 移除。DataChannel `highlightPrimsRequest`
> 本身保留作 mapping highlight 工具(Window.tsx `_onMappingItemClick`),Change 2
> 重做 viewer 時再評估。若 issue 流要重新引入,以新 spec 變更新增。

完整歷史 mermaid 與邊界說明遷至 `docs/agents/history-and-archive.md` §3.4。

---

## 6. 通訊方式邊界

| 通訊方式 | 起點 | 終點 | 用途 |
|---|---|---|---|
| REST | `web-viewer-sample` | `bim-review-coordinator` | 建立 session、查詢 session、取得 stream config |
| WebRTC video | `bim-streaming-server` | `web-viewer-sample` | 串流 Omniverse viewport 畫面 |
| WebRTC DataChannel JSON | `web-viewer-sample` | `bim-streaming-server` | open stage、selection、highlight、scene query |
| WebSocket / Socket.IO | `web-viewer-sample` | `bim-review-coordinator` | presence、selection、annotation、issue focus 等多人事件 |
| Optional WebSocket | `bim-streaming-server` | `bim-review-coordinator` | Kit runtime 接收多人狀態 overlay，不作為主要資料權威 |

歷史內部通訊列（涉及已刪除 `_bim-control` / `_worker`）遷至 `docs/agents/history-and-archive.md` §3.5。

---

## 7. Source of Truth 原則

## 7.1 BIM 原始資料

```txt
IFC / RVT / DWG = 原始模型資料
```

原始模型資料的權威屬外部既有平台（公司雲端 SSO/MySQL 控制面 + 客戶落地端 IFC Worker/Revit），不在本 repo 開發範圍內（見 §1.A）。歷史上曾由 repo 內部 `_bim-control`（RVT source / signed reference 版本關聯）與 `_worker`（RVT→IFC bridge / handoff lineage）分工，兩者已刪除；完整歷史敘述見 `docs/agents/history-and-archive.md` §3.6。

---

## 7.2 Omniverse Runtime 資料

```txt
USD / USDC = rendering / streaming artifact
```

其 conversion job、檔案本體與 result payload 屬於：

```txt
bim-streaming-server
```

其 runtime 操作屬於：

```txt
bim-streaming-server
```

---

## 7.3 Mapping 資料

```txt
IFC GUID ↔ USD Prim Path
```

這是 BIM 語意資料與 Omniverse 視覺化資料之間的橋。

```txt
mapping file body      → bim-streaming-server
mapping metadata       → 外部公司雲端 bim-control（經 coordinator metadata-only callback outbox，非本 repo 內部服務）
mapping runtime usage  → web-viewer-sample / bim-streaming-server
```

---

## 7.4 Review 資料

> **退役狀態(2026-05-21,change `remove-conflict-review-from-fast-mvp`)**:issue
> / annotation / review result 的 fast MVP product runtime 已移除(`ReviewIssue`
> interface、`getReviewIssues` / `createAnnotation` / `getReviewBootstrap` /
> `IssuePanel` / `EventLogPanel` 已刪)。本表保留作 archive context,記錄歷史權威
> 劃分。若 review 流要重新引入,以新 spec 變更新增 requirement 與
> coordinator / viewer 端配套。

完整歷史 ownership 拆解遷至 `docs/agents/history-and-archive.md` §3.4。

---

## 8. 禁止跨界規則

## 8.1 `web-viewer-sample` 不應做的事

```txt
- 不啟動 Kit server
- 不分配 GPU
- 不保存 project / model / issue 的資料權威
- 不保存大型模型檔案
- 不執行 IFC / USD 轉檔
```

## 8.2 `bim-streaming-server` 不應做的事

```txt
- 不管理使用者登入
- 不管理 project / model version
- 不作為 annotation / issue 長期資料庫
- 不作為多人協作事件中心
- 不取代外部公司雲端 bim-control control-plane
- 不取代外部客戶落地端 IFC Worker（不自產 IFC）
```

## 8.3 `bim-review-coordinator` 不應做的事

```txt
- 不渲染 3D
- 不開啟 USD stage
- 不處理 Omniverse renderer internal state
- 不保存大型模型檔案
- 不取代外部公司雲端 control-plane 成為資料權威
- 不取代 web-viewer-sample 成為 UI
```

## 8.4 `_bim-control` 不應做的事

已刪除服務，語意等同規則已在 `docs/agents/history-and-archive.md` §3.1「它不負責」清單中逐項涵蓋，不重複維護。

## 8.5 `_worker` 不應做的事

已刪除服務；規則清單（含 §3.3 未涵蓋的 GPU 分配 / USD stage 操作 / 多人協作事件中心 3 條）已遷至 `docs/agents/history-and-archive.md` §3.6。

---

## 9. Optional Mock Services 說明

`AI-BIM-governance/` 之後可以存在其他 mock folders，例如：

```txt
_ai-rule-carbon-service/
_mock-auth/
_mock-sensor-service/
```

這些不屬於本文件定義的核心 repo。若歷史計畫文件提到 `_s3_storage`、`_conversion-service` 或 `_conversion-server`，那些引用只代表舊設計背景；目前 runtime 不啟動、不檢查、也不依賴這些服務。

若它們存在，邊界原則如下：

```txt
- 它們只提供假資料、假結果或本地測試用資料處理。
- 它們不應越過外部公司雲端 control-plane（歷史上為 `_bim-control`）成為正式資料權威。
- 它們不應越過 bim-streaming-server 直接控制 Omniverse viewport。
- 它們不應越過 bim-review-coordinator 管理 session / collaboration。
- 它們不應越過 web-viewer-sample 成為 browser UI。
```

---

## 10. Workspace 最重要閉環

> **B 方案（local-coordinator-ifc-ready-intake-boundary，2026-05-18 落地）**：`_worker` / `_bim-control` 已**自 repo 刪除**（非降級），只由 `tests/fakes` + `tests/contracts` 模擬外部既有平台。對外入口收斂於 `bim-review-coordinator`；`bim-streaming-server` 為 internal-only 轉檔引擎；轉檔結果以 metadata-only callback 回拋公司雲端（outbox）。

整個 workspace 要保護的最小閉環（B 方案）是：

```txt
[外部] 客戶落地端 IFC Worker 產出 .ifc
→ POST /api/external/ifc-ready 至 bim-review-coordinator（落地端內網，Service auth）
→ bim-review-coordinator 驗證 / idempotency / 建立 local conversion job
   並綁定 external_model_version_id
→ bim-review-coordinator 對 bim-streaming-server 發 internal conversion request
→ bim-streaming-server（internal-only）執行 IFC→USDC，產出 USDC / element_mapping / manifest
→ bim-review-coordinator 取得結果，組 metadata-only callback 入 callback_outbox
   （retry / dead-letter；不傳 .usdc 本體）→ 回拋 [外部] 公司雲端 bim-control
→ bim-review-coordinator 建立 / 維護 review session 與 local web view session
→ web-viewer-sample 取得 session / stream config（使用者經可替換 auth provider）
→ web-viewer-sample 連到 bim-streaming-server
→ bim-streaming-server 載入 USD / USDC
→ web-viewer-sample 顯示 stream 畫面
→ 使用者點選 issue / prim → web-viewer-sample 送 DataChannel command
→ bim-streaming-server 執行 3D highlight / selection
→ web-viewer-sample 送 annotation / collaboration event
→ bim-review-coordinator 廣播 / 回寫；最小 shadow metadata 留本地
   （control-plane 權威屬公司雲端，不 mirror）
```

任何修改都不應破壞這條閉環。歷史的 `_bim-control 接收 fake RVT → _worker RVT→IFC → _bim-control 保存 metadata` 閉環已隨兩服務刪除而退役，僅作 archive context，不得作為 startup / health / smoke / review-session 依賴。

---

## 11. 總結

本 workspace 的核心分工（B 方案）是：

```txt
bim-review-coordinator
= 唯一對外 IFC-ready intake（Service auth / idempotency / external_model_version_id
  binding）+ Session / collaboration control plane + 雲端 metadata-only callback
  outbox + local web view session + 最小 shadow metadata（data-plane）

bim-streaming-server
= internal-only IFC→USDC conversion engine（由 coordinator internal request 觸發）
  + Omniverse Kit runtime / WebRTC streaming / USD scene runtime

web-viewer-sample
= Browser client / user interaction layer

[外部，非本 repo] 公司雲端 bim-control = control-plane 權威
[外部，非本 repo] 客戶落地端 IFC Worker = 外部 IFC 產出者

_worker / _bim-control
= 已自 repo 刪除（removed from product runtime，非降級）；
  僅 tests/fakes + tests/contracts 模擬，不是 runtime profile
```

所有跨 repo 互動都必須遵守：

```txt
對外 IFC-ready intake 歸 coordinator（唯一外部入口）
IFC→USDC conversion 歸 streaming server（internal-only）
雲端 callback（metadata-only / outbox）歸 coordinator
control-plane 權威歸外部公司雲端（本地僅最小 shadow，不 mirror）
session / collaboration 歸 coordinator
3D runtime 歸 streaming server
使用者操作歸 web viewer
外部平台模擬只在 tests/，不得進 runtime
```
