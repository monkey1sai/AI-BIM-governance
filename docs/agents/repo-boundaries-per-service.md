> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：需要查個別 repo（`bim-review-coordinator` / `bim-streaming-server` / `web-viewer-sample` / `governance-service` / `kit-manager-web` / `kit-manager-api`）的角色、負責與不負責清單、控制邊界，或跨 repo 禁止事項時。

# Repo Boundaries Per Service

> 本檔自 `docs/agents/repo-boundary-detail.md` 原 §3、§8 拆分並持續維護；延用原章節編號（§3 / §3.4–§3.8 / §8 / §8.1–§8.5）。workspace 總覽、架構決策、資料流、資料歸屬、通訊方式與最重要閉環見 `docs/agents/repo-boundary-detail.md`；資料流與 Source of Truth 細節見 `docs/agents/repo-data-flow-and-ownership.md`。

---

## 3. Repo 邊界

> **B 方案現行判讀規則**：本節中提到 `_bim-control` / `_worker` 的角色描述只保留為歷史邊界與 test-double 對照；兩者已自 product runtime 刪除（細節見 `docs/agents/history-and-archive.md`）。現行 runtime 邊界以 §1.A、§10、§11 為準。

## 3.4 `bim-review-coordinator/`

### 角色

```txt
Session / Presence Control Plane
```

### 邊界

`bim-review-coordinator` 是 review session 與 presence 的協調中心，也是session-scoped runtime mutation的narrow policy authority；它不執行3D mutation。

它負責協調：

```txt
- review session 狀態
- browser client 與 Kit streaming server 的連線資訊
- user presence（`joinSession` / `leaveSession` / `heartbeat` / `presenceUpdated`）
- authenticated viewer lease與每次runtime mutator的allow/deny decision
- bounded stage-binding authorization / atomic consume / Kit-confirmed active與last-good shadow
- generic session event log（append-only compatibility archive，不代表 live broadcast 或資料權威）
- browser-facing governance proxy（issue / annotation / BCF 寫入由 `governance-service` 處理）
- fake BIM platform 與 fake storage 的資料查詢路由
```

它不負責：

```txt
- USD stage loading
- Omniverse viewport rendering
- USD / stage / selection / highlight / camera等runtime mutation execution
- WebRTC video encoding
- IFC / USD 檔案內容轉換
- 直接保存大型檔案
- 處理 selection / annotation / issue focus 的 live collaboration event
- 成為 issue / annotation / BCF 資料權威
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
generic session event log（compatibility archive）
runtime mutation policy decision
stage-binding pending/executing/confirmed shadow（非GPU truth）
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
- 向coordinator取得每次mutator的fresh decision，執行mutation並回報observed stage terminal outcome
```

它不負責：

```txt
- project / model version 的資料權威
- 使用者登入與權限
- review session lifecycle 的總控
- session presence 的中心廣播
- 長期 annotation / issue 儲存
- 假 S3 檔案倉庫
- 假 BIM API
- 阻塞 live WebRTC viewport thread 執行大型 IFC→USDC conversion
```

### Runtime 邊界

`bim-streaming-server` 只處理「目前這個 stream session 中的 3D runtime 狀態」。

Runtime policy與actual state刻意分開：coordinator擁有lease/lifecycle-based allow/deny與binding confirmation shadow；streaming server擁有實際mutation、stage observation與GPU truth。Frontend gate不是安全邊界，Kit不得在authority outage時放行或使用positive cache。

它可以處理：

```txt
目前開啟哪個 USD / USDC
目前選取哪個 prim
目前 viewport camera 狀態
目前套用哪些 visual overlay
```

但這些狀態若要成為正式審查資料，必須走現行 `governance-service` / 外部公司雲端 control-plane write path；已退役的 coordinator collaboration handlers 不是可用回寫路徑。

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
- 與 bim-review-coordinator 交換 session / presence / stream config
- 經 coordinator governance proxy 顯示 project / issue / annotation / BCF / stage tree 等 UI 狀態
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
3D runtime操作是否允許／binding是否已確認 → bim-review-coordinator narrow policy與confirmation shadow
session / presence → bim-review-coordinator
issue / annotation / BCF → governance-service（browser 經 bim-review-coordinator proxy）
project metadata reference → bim-review-coordinator（長期權威＝外部公司雲端 bim-control）
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
- 不作為 session presence 事件中心
- 不取代外部公司雲端 bim-control control-plane
- 不取代外部客戶落地端 IFC Worker（不自產 IFC）
```

## 8.3 `bim-review-coordinator` 不應做的事

```txt
- 不渲染 3D
- 不開啟 USD stage
- 不處理 Omniverse renderer internal state
- 不執行 USD / stage / selection / highlight runtime mutation
- 不保存大型模型檔案
- 不取代外部公司雲端 control-plane 成為資料權威
- 不取代 web-viewer-sample 成為 UI
```

## 8.4 `_bim-control` 不應做的事

已刪除服務，語意等同規則已在 `docs/agents/history-and-archive.md` §3.1「它不負責」清單中逐項涵蓋，不重複維護。

## 8.5 `_worker` 不應做的事

已刪除服務；規則清單（含 §3.3 未涵蓋的 GPU 分配 / USD stage 操作 / 多人協作事件中心 3 條）已遷至 `docs/agents/history-and-archive.md` §3.6。
