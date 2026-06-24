# ifc-ready API 欄位重新設計 — 權威設計文件

> 版本：2026-06-24 · 角色：首席 API 設計師（整合三視角：observability / provenance-key / consumer-ux）
> 來源 spec：①`2026-06-24-minio-folderview-and-baseline-disclosure-design`（下稱 **folderview spec**）②`minio-watch-key-structure-design 2026-06-22`（下稱 **key-structure spec**）③`MinIO 轉檔閉環可觀測性 2026-06-23`（下稱 **closed-loop spec**）
> 對象程式碼：`bim-review-coordinator/src/`（`app.ts` schema/summarize、`externalIfcReadyStore.ts` store、`minioWatcher.ts` watcher、`conversionLedger.ts` ledger）

---

## 0. 決議紀錄（Decisions）

> 本節記錄維護者裁決（2026-06-24），**優先於下方 §4.5 / §7 中標「待裁決/建議」的對應段落**。

- **OQ1（已裁決）→ 放寬 key-structure R5**：`project_display_name`、`category` **直接寫入 `externalIfcReadyStore`**（additive、nullable），由 `summarizeIfcReadyJob` 直接投影；**不採** §4.5 的 ledger-join 方案。理由：資料一致性與最小心智負擔優先；coordinator 多存兩個「顯示用」nullable 欄位成本可接受。key-structure R5 對此二欄的「不落 coordinator store」限制在本 spec 明確解除（僅此二欄，其餘 R5 精神保留）。
- **OQ2（降級為文件 task）**：`deriveIntakeFromKey` 程式碼已正確 ≥3 段（`minioWatcher.ts:95`），**非前置 gate**；改為「同步 archive stale「兩層」live-spec + 修 `minioWatcher.ts:12` docstring」的文件清理。
- **P0 全出口遮蔽（必做）**：presigned 簽章外洩出口不只 `summarizeIfcReadyJob`(app.ts:2357)，至少還有 app.ts:1575、1848。遮蔽須涵蓋**所有讀 `job.source_ifc_ref` 並對外回應**的出口 + 誠實守衛測試。詳見 §8.1。
- 其餘必修項見 **§8.1**。

---

## 1. 設計目標與範圍

把 MinIO「偵測→下載→排隊→派工→（Phase 2）轉檔回填→可載入」做成**端到端可溯源、可對帳、誠實標記**的閉環：在 **不破壞既有 ifc-ready intake/去重/dispatch 鏈與既有 26 欄 job_output 契約（closed-loop R11 零回退）** 的前提下，以 **additive/nullable** 方式補齊三類缺口——(a) 溯源斷鏈（中文原名 `project_display_name`、種類 `category`、原始 object key 在 store 邊界被丟棄）、(b) 對帳鍵缺口（`idempotency_key` 未投影到 job_output，三視圖無法以同一把鍵對齊）、(c) 可觀測缺口（狀態三套互打、失敗原因分散、無階段時戳、presigned URL 直接外洩、資料易失性無標記）；同時**硬性遵守誠實鐵律**：presigned 簽章/secret 絕不入欄位與 log、coverage 不假 100%、converter 落地前禁出現 ready/parsed USDC、缺值用明確 null + 前端誠實標籤而非假值。本文件**僅做欄位層級設計**，不含實作程式碼；映射表與型別最終凍結於 plan 階段（見 §7 開放問題）。

---

## 2. 進件 payload 重設計欄位表（POST /api/external/ifc-ready）

> 範圍說明：folderview spec（R-IFCREADY-PAYLOAD-NOT-RESPECIFIED）明示 **ifc-ready intake schema 本身不被重新定義**；本表的 NEW 進件欄位**僅來自 key-structure spec 的 additive 溯源欄位**與**新觸發入口 `POST /api/conversion/trigger` 的 `key`**（後者是獨立 endpoint，非 ifc-ready intake 欄位，標於表末分區）。canonical schema 已 `.passthrough()`，故 additive 子欄位不會被拒。

### 2.1 canonical ifc-ready intake（`ifcReadyPayloadSchema`）

| 欄位名 | 型別 | 必填 | 來源 | 對應 spec | 狀態 | 說明 |
|---|---|---|---|---|---|---|
| `event` | `literal "ifc_ready"` | ✅ | app.ts:159 | 既有 | KEPT | canonical 判別欄位，零變更 |
| `event_id` | `string` | ✗ | app.ts:160 | — | **REMOVED(deprecate)** | 純死欄位，全鏈無讀取點。schema 仍 `.passthrough` 寬容接受（R11 不破壞既有 caller），契約標 `accept-and-drop`，不承諾語意 |
| `correlation_id` (body) | `string` | ✗ | app.ts:161 | — | **REMOVED(deprecate)** | 雙重來源死欄位；權威來源是 `X-Correlation-Id` header。契約標「填 body 不生效，唯一權威=header」 |
| `idempotency_key` (body) | `string` | ✗ | app.ts:162 | — | **REMOVED(deprecate)** | 同上；權威=`X-Idempotency-Key` header。**注意**：此處 deprecate 的是 body 同名欄位，與 job_output 端 NEW 暴露 `idempotency_key`（header 派生真值投影）無關 |
| `tenant_id` | `string` | ✅ | app.ts:163 | closed-loop R1 | KEPT | watcher 由 `config.minioWatchTenantId` 注入 |
| `project_id` | `string` | ✅ | app.ts:164 | key-structure R3 / closed-loop R1 | KEPT | `sanitizeArtifactIdPart(projectRaw)`（純中文→`mv_<hash8>`）。語意不變，但契約須標註「安全代號，非原名」 |
| `external_model_version_id` | `string` | ✅ | app.ts:165 | key-structure R1 / closed-loop R1 | KEPT | key 末段=版本；雲端 callback 關聯主鍵 |
| `project_display_name` | `string \| null` | ✗ | app.ts:168 `.nullish()` | key-structure R3/R-payload-additive / closed-loop R4 | KEPT(schema) **CHANGED(落 store)** | watcher 已送中文原名。**現況刻意不入 store→對外不可見**；本設計要求其值能投影到 job_output（落 store 或 ledger join，見 §4 與 §7-OQ1） |
| `model_category` | `string \| null` | ✗ | app.ts:169 `.nullish()` | key-structure R-payload-additive/R-category-sanitize / closed-loop R1 | KEPT(schema) **CHANGED(落 store / 對外更名 category)** | watcher 已送（key 倒數第二段）。對外與 ledger 統一命名 `category`（見 §4） |
| `external_conversion_task_id` | `string \| null` | ✗ | app.ts:170 | key-structure R-payload-additive | KEPT | watcher 派生 `<version>_mw_<etagShort>`，**非雲端真 task id**（worker-compat 才是真）。契約須標來源歧義 |
| `source_ifc.ref` | `string` | ✅ | app.ts:172 | closed-loop R3 | KEPT(intake 不變) **CHANGED(對外遮蔽)** | watcher 送 presigned URL；**intake 端不變**，但對外輸出端必須遮蔽簽章（見 §3、§4） |
| `source_ifc.etag` | `string` | ✅ | app.ts:173 | closed-loop R3 | KEPT | watcher 送 `stripEtagQuotes(etag)` |
| `source_ifc.key` | `string \| null` | ✗ | **NEW**（app.ts:180 passthrough→建議顯式 `.nullish()`） | closed-loop R3 / key-structure R4 / provenance lens | **NEW** | **新增 additive 子欄位**：純 object key（無簽章），由 watcher/trigger 兩路徑填，供 job_output 的 `source_object_key` 有非簽章來源。誠實：簽章只活在 `source_ifc.ref`，純 key 走此欄 |
| `source_ifc.filename` | `string \| null` | ✗ | app.ts:174 | key-structure R4 | **REMOVED(deprecate-for-display)** | watcher 恆送 `model.ifc`；store 不存、對外不吐。`*/model.ifc` 規約下恆定值零資訊量，契約標「intake 後丟棄，檔名請看 `source_object_key`」 |
| `source_ifc.format` | `string \| null` | ✗ | app.ts:175 | — | **REMOVED(deprecate-for-display)** | 同上，恆為 `ifc`，棄用為對外欄位 |
| `requested_outputs` | `string[]` | ✗ | app.ts:177 | — | KEPT(server-side) **REMOVED(for-display)** | watcher 送固定陣列；dispatch 端若需保留在 server-side，但不進 job_output（恆定值無顯示價值） |
| `callback_url` | `string(url) \| null` | ✗ | app.ts:178 | — | KEPT | store 存、summarize 不吐（僅 shadow 投影），零變更 |
| `(passthrough 其餘)` | `unknown` | ✗ | app.ts:180 | — | KEPT | schema 寬容，store 只擷取固定欄位 |

### 2.2 workerCompat intake（`workerCompatPayloadSchema`）— 全部 KEPT，零變更

| 欄位名 | 型別 | 必填 | 狀態 | 說明 |
|---|---|---|---|---|
| `status` / `ifc_path` / `project_id` / `version` / `task_id` | 見現況 | ✅ | KEPT | 落地端 IFC Worker 替代形狀，R11 零回退；`task_id` 為**真** task id（與 minio-watch 派生值語意不同） |

### 2.3 新觸發入口（**獨立 endpoint，非 ifc-ready intake schema**）

| 欄位名 | 型別 | 必填 | 來源 | 對應 spec | 狀態 | 說明 |
|---|---|---|---|---|---|---|
| `key`（`POST /api/conversion/trigger` body） | `string`（bucket 下 `*/model.ifc` 的 S3 object key） | ✅ | **NEW endpoint** | folderview R-TRIGGER-ENDPOINT / R-TRIGGER-KEY-VALIDATION / R-TRIGGER-PRESIGNED-SERVERSIDE / R-TRIGGER-IDEMPOTENT | **NEW** | 前端**只送 key**；coordinator server-side 過 `deriveIntakeFromKey`（≥3 段、拒空段/`.`/`..`）+ 生成 presigned GET URL 後**重用 triggerIntake 等效邏輯**餵入既有 intake。瀏覽器不碰 secret/憑證/presigned URL。冪等鍵 `mw_<hash16>`，同 key 重觸發回既有 job |

---

## 3. job 輸出重設計欄位表（summarizeIfcReadyJob / GET 端點）

> 既有 26 欄逐字凍結（closed-loop R11 列舉）；以下標 KEPT 者語意不變、標 CHANGED 者改型/改語意但**不刪欄名**、標 NEW 者 additive nullable。FE `IfcReadyListItem` 須同步擴充消費，否則重演「吐了但前端看不到」（`download_failure` 覆轍）。

### 3.1 既有欄位（KEPT / CHANGED）

| 欄位名 | 型別 | null 語意 | 對應 spec | 狀態 | 說明 |
|---|---|---|---|---|---|
| `ifc_ready_job_id` | `string` | non-null | closed-loop R11 | KEPT | job 主鍵；FE 必含 |
| `status`（`IfcReadyIntakeStatus`） | `string` enum | non-null | closed-loop R11 | **CHANGED(降為 intake 階段狀態)** | 既有 enum 保留不破壞；**降為「coordinator 內部 intake 階段狀態」**，對帳主狀態改看 NEW `conversion_lifecycle_status`。契約標明兩者分工 |
| `tenant_id` | `string` | non-null | — | KEPT(**dead-for-FE**) | FE 不消費（單租戶 demo 恆定）。保留後端契約，不為它加 UI |
| `project_id` | `string` | non-null | key-structure R3 | KEPT | **sanitized 代號非原名**；契約須與 NEW `project_display_name` 並列標註 |
| `external_model_version_id` | `string` | non-null | key-structure R1 | KEPT | FE 消費 |
| `external_conversion_task_id` | `string \| null` | null=未提供 | key-structure R-payload | KEPT | minio-watch 場景=派生值，worker 場景=真 task id；靠 NEW `provenance_source` 辨識來源 |
| `correlation_id` | `string` | non-null | closed-loop R2 | KEPT | watcher 場景=`minio-watch-<hash8>` |
| `source_ifc_ref` | `string` | non-null | closed-loop R3 / folderview R-TRIGGER-PRESIGNED | **CHANGED(遮蔽簽章)** | **P0 安全修補**：現況直接吐 `expiresIn:3600` presigned URL=洩漏短效憑證。改為**剝除 `X-Amz-*`/Signature/Expires** 後只留物件位址（bucket/key 或 host-relative path）；簽章只活在 server-side dispatch，永不進 job_output/log。對帳改以 NEW `source_object_key`/`source_bucket` 為準 |
| `source_ifc_etag` | `string` | non-null | closed-loop R3 | KEPT | 扁平化欄位 |
| `download_status` | enum `\| null` | null=未進下載階段 | closed-loop R5 | KEPT | 對齊 lifecycle 映射輸入之一 |
| `download_failure` | `string \| null` | null=無下載失敗 | closed-loop R5/R9 | **CHANGED(併入統一失敗欄)** | store 端保留寫入點不破壞；summarize 改由 NEW `failure_reason`(stage=download) 統一投影，FE 不再需分別消費 |
| `local_path` / `host_local_path` | `string \| null` | null=未下載 | — | KEPT(dead-for-FE) | 容器/host 路徑，FE 未列 |
| `conversion_job_id` | `string \| null` | null=未派工 | closed-loop R4/R11 | KEPT | **MUST == ledger.conversion_job_id == ifc_ready_job_id**（避免雙鍵分歧） |
| `conversion_status` | `string \| null` | null=未派工 | closed-loop R5 | **CHANGED(降為 authority 原文)** | 現況自由字串無 enum。**降為「轉檔權威回報子狀態（authority-reported）」**，不參與三視圖對帳判定；對帳改看 `conversion_lifecycle_status`。FE 不直接綁此欄做狀態 |
| `conversion_authority` | `"bim-streaming-server" \| null` | null=未派工 | closed-loop R6/R11 | KEPT | 同步要求 ledger 也帶（見 §4） |
| `queue_position` | `number \| null` | **三義**：0=in-flight / 1+=queued / null=不在 queue | closed-loop R11 | KEPT(**契約釐清三義**) | 不刪（FE non-optional）。主判讀交給 `conversion_lifecycle_status=converting/queued`，此欄僅承載名次數字。契約**明確記載三義** |
| `dispatch_error` | `string \| null` | null=無派工失敗 | closed-loop R9 | **CHANGED(併入統一失敗欄)** | 同 `download_failure`，summarize 改由 `failure_reason`(stage=dispatch) 投影 |
| `callback_outbox_id` | `string \| null` | null=未回填 | closed-loop R6 | KEPT | 要求 ledger 也補此欄（見 §4） |
| `artifact_manifest_ref` | `string \| null` | null=無 | — | KEPT(dead-for-FE) | data-plane shadow 參照 |
| `review_session_id` / `web_view_session_id` / `viewer_url` | `string \| null` | null=無 session | — | KEPT | viewer 入口；FE 消費 viewer_url |
| `expected_stage_url` / `expected_mapping_url` | `string \| null` | null=無 ready binding | — | KEPT | 衍生欄位（來自 review session） |
| `created_at` / `updated_at` | `string(ISO)` | non-null | closed-loop R4 | KEPT | `updated_at` 被每次 mark* 覆寫→無法重建階段時序（故新增分階段時戳，見 3.2） |

### 3.2 新增欄位（NEW，全部 additive / nullable）

| 欄位名 | 型別 | null 語意 | 對應 spec | 說明（摘要，詳見 §4） |
|---|---|---|---|---|
| `idempotency_key` | `string \| null` | null=非 header/minio 派生 | closed-loop R2 / folderview R-TRIGGER-IDEMPOTENT / R10 | 三視圖對帳主鍵（`mw_<hash16>`）；值已存在於 store binding，僅投影 |
| `idempotent_replay` | `boolean \| null` | null=未知 | closed-loop R2 / folderview R-TRIGGER-IDEMPOTENT | 是否命中既有 job（去重生效可見）；值已在 job record |
| `conversion_lifecycle_status` | enum `detected\|queued\|converting\|ready\|failed \| null` | null=無紀錄/未偵測（#minio 標「未轉」） | closed-loop R5 / folderview R-LEDGER-AS-STATUS-TRUTH / R-STATUS-CHIP-VALUES / R10 | **單一後端權威對帳狀態**，job/ledger 共用同一 enum 定義。chip 顯示唯一來源；converter 落地前禁 ready |
| `failure_reason` | `string \| null`（或結構化 `{stage,code,message}`） | null=無失敗 | closed-loop R5/R9/R12 | 統一失敗承載（取代分散的 download_failure/dispatch_error/watcher fail_transient） |
| `failure_stage` | enum `download\|dispatch\|conversion\|callback\|key_malformed \| null` | null=無失敗 | closed-loop R5/R9 | 失敗段定位（閉環六段） |
| `detected_at` | `string(ISO) \| null` | null=未偵測 | closed-loop R7/R4 | 基線偵測時戳（轉檔前可稽核基線） |
| `queued_at` | `string(ISO) \| null` | null=未入佇列 | closed-loop R5 | 進 dispatch queue 時戳 |
| `dispatched_at` | `string(ISO) \| null` | null=未派工 | closed-loop R-ledger-observability-boundary/R5 | 派工時戳；P7 vertical slice 取證**終點** |
| `converted_at` | `string(ISO) \| null` | **Phase 1 恆 null**（禁用偵測時間假填） | closed-loop R6/R12 | Phase 2 回填 ready 時戳 |
| `project_display_name` | `string \| null` | null=非 minio 來源無原名（誠實留白） | key-structure R3 / closed-loop R4 / folderview R-baseline-disclosure | **溯源斷鏈首要修補**：中文原名對外可見 |
| `category` | `string \| null` | null=非 minio 來源 | key-structure R-payload / closed-loop R1 / folderview R-FOLDERVIEW | 種類對外可見；**對外統一命名 `category`**（非 intake 的 `model_category`）。僅顯示用途，不宣稱依種類派工 |
| `source_bucket` | `string \| null` | null=非 minio 來源 | closed-loop R3/R4/R10 | `{bucket,key,etag}` 對帳三元組之一 |
| `source_object_key` | `string \| null` | null=非 minio 來源 | closed-loop R3/R4 / key-structure R4 / R10 | **純 object key（無簽章）**，取代洩漏式 ref 的對帳職責；#conv/#minio 反查用 |
| `source_ifc_ref_expires_at` | `string(ISO) \| null` | null=非 presigned 來源 | closed-loop R3 / 誠實鐵律 | presigned **過期時戳**（非 URL、不洩簽章）；前端判斷「連結已過期，請重新觸發」 |
| `key_segments` | `{ project_raw, category, version, middle[] } \| null` | null=非 minio 來源或 derive 失敗 | key-structure R1 / closed-loop R8 / folderview R-FOLDERVIEW | 三段拆解結果（後端單一真相），避免前端 re-parse 漂移 |
| `provenance_source` | enum `minio-watch\|manual-trigger\|manual-webhook\|worker-compat \| null` | null=未知來源 | folderview R-TRIGGER-ENDPOINT / R-WATCHER-AUTO-SEMANTICS-FROZEN | 標進件來源鏈；區分「未提供」vs「此來源結構性無此欄」 |
| `is_baseline` | `boolean \| null` | null=來源無 baseline 語意（worker-compat） | folderview R-BASELINE-NO-AUTO-INTAKE/R-BASELINE-DISCLOSURE / closed-loop R7 | per-job 基線旗標；揭露「哪些 model.ifc 尚未產生 job」 |
| `usdc_role` | enum `source_ifc\|parsed_usdc\|pending \| null` | null=無紀錄 | closed-loop R8/R10/R12 / folderview R-STATUS-CHIP AC8 | USDC 角色權威投影；converter 落地前一律 pending，禁假 parsed USDC |
| `usdc_key` | `string \| null` | **Phase 1 恆 null**；禁塞誠實字串污染型別 | closed-loop R6/R10/R12 | Phase 2 回填的 USDC 物件 key |
| `coverage_report` | `object \| null` | **Phase 1 恆 null**；前端不寫死 | closed-loop R6/R12 / memory conv-coverage 自我參照 | Phase 2 回填；數字一律來自轉檔權威；須能承載分子/分母來源 |
| `data_volatility` | enum `in_memory_volatile\|persisted \| null` | null=未知 | folderview R-BASELINE-NO-AUTO-INTAKE/R-NO-AUTO-ENROLL / closed-loop R-LEDGER-AS-STATUS-TRUTH/R12 | 誠實標記 job 端易失（重啟即清）；前端區分「真的沒 job」vs「剛重啟」 |
| `watcher_liveness` | `{ poll_count, last_poll_at, last_error, triggered_total, skipped_malformed_total }`（缺值標「未取得」） | 缺遙測標「未取得」（非 0） | closed-loop R9/R12 | #conv 視圖偵測端存活遙測（嚴格屬 `/api/conversion/records` 輸出，非 `/:jobId`，見 §7-OQ4） |

---

## 4. NEW / CHANGED 欄位逐一理由與 spec 追溯

### 4.1 對帳鍵類

- **`idempotency_key`（NEW, job_output）** — 現況 summarize 只吐 `correlation_id`，不吐 `idempotency_key`（值已在 store binding）。ledger `/api/conversion/records` 以 `idempotency_key=mw_<hash16>` 為主索引、#minio chip 也用它對應；job_output 不暴露同一把鍵則三視圖無法把「#minio 物件 ↔ ledger 紀錄 ↔ ifc-ready job」對齊，**closed-loop R10 四段一致性不變量在 UI 端無法成立**。hash 派生、不含 secret，可安全外露。追溯：closed-loop R2、folderview R-TRIGGER-IDEMPOTENT、R-LEDGER-AS-STATUS-TRUTH、R10。
- **`idempotent_replay`（NEW）** — 手動一鍵觸發同 key 重觸發時，操作員需從回應/列表分辨「新建 job」vs「命中既有」，否則誤判按鈕無效而重複觸發。值已在 job record。追溯：closed-loop R2（replay 回 `idempotent_replay:true`）、folderview R-TRIGGER-IDEMPOTENT。

### 4.2 狀態收斂類

- **`conversion_lifecycle_status`（NEW, both）** — 現況狀態分裂三套互不對齊：`status`(intake enum)、`conversion_status`(自由字串混 dispatch_failed/ready/authority 原值)、`ledger.status`(detected→queued→converting→ready|failed)。closed-loop R5 明文「對齊語意但未定義映射表」、R10 要三視圖數字一致。新增**單一後端權威 enum、job/ledger 共用同一 type 定義**，作為 #minio chip 與 #conv 狀態唯一真相投影，消除「同 job 在 #conv 顯 dispatched、在 #minio 顯 queued」。**MUST 在 plan 凍結映射表並寫成單一 helper（如 `deriveLifecycleStatus(job)`），禁前後端各自映射**。誠實：converter 落地前禁 ready。追溯：closed-loop R5/R10、folderview R-LEDGER-AS-STATUS-TRUTH/R-STATUS-CHIP-VALUES。
- **`status`（CHANGED）/ `conversion_status`（CHANGED）** — 兩者皆**保留不刪（R11）**，但重新定位：`status`=coordinator intake 階段狀態、`conversion_status`=authority 原文回顯，兩者皆不再作對帳主狀態。追溯：closed-loop R5/R11、observations「conversion_status 無 enum」。

### 4.3 失敗可診斷類

- **`failure_reason`（NEW, both）/ `failure_stage`（NEW）** — 失敗原因現散三處：`download_failure`（FE 不消費）、`dispatch_error`（FE 消費）、watcher `fail_transient`（須另查 status）；ledger `status=failed` 無理由欄。操作員看到「失敗」卻無法在同一視圖知道是下載/派工/轉檔權威/malformed key。統一單一 `failure_reason` + `failure_stage`（download|dispatch|conversion|callback|key_malformed）定位閉環六段。誠實：無失敗即 null，不塞假值。`download_failure`/`dispatch_error` CHANGED 為 store 保留寫入點、summarize 由統一欄投影。追溯：closed-loop R5/R9/R12。

### 4.4 階段時戳類

- **`detected_at`/`queued_at`/`dispatched_at`/`converted_at`（NEW）** — 現況僅 `created_at`/`updated_at`（後者被反覆覆寫丟失歷史），無法重建「偵測→排隊→派工→完成」時序、算每段耗時。`detected_at` 對應 closed-loop R7 基線偵測即落時戳；`dispatched_at` 是 P7 vertical slice 取證終點（R-ledger-observability-boundary）；`converted_at` **Phase 1 恆 null**，禁用偵測時間假填。追溯：closed-loop R7/R4/R5/R6/R-ledger-observability-boundary。

### 4.5 溯源類（最高優先修補）

- **`project_display_name`（CHANGED schema→落 store + NEW 投影）** — **致命溯源斷點**：watcher 確實送中文原名、schema `.passthrough` 接受，但 store.create 依 **key-structure R5** 刻意不寫入→summarize 永不吐→#conv 只剩 `mv_<hash8>`，operator 無法反查中文專案。對照 ledger 反而保留→同一 key 兩鏈溯源不一致（observations #1）。**這直接與 closed-loop R-baseline-disclosure-job-output（job 須帶可觀測 project_id+model_category）矛盾**（見 §7-OQ1）。設計裁決：job_output **MUST 能投影此值**，最小改動是 summarize 時由持久 ledger join（不違反 R5「不落 store」字面）；若 join 不可行則裁決放寬 R5。追溯：key-structure R3/R5、closed-loop R4、folderview R-baseline-disclosure。
- **`category`（CHANGED→落 store/對外更名 + NEW 投影）** — 同上；closed-loop **R-baseline-disclosure-job-output 明文要求 job 帶 model_category 可觀測**。**對外與 ledger 統一命名 `category`**（消除 intake `model_category` / ledger `category` 三鏈命名分歧）。僅顯示用途，**不得宣稱依種類派工/分類統計**（key-structure §8 YAGNI）。追溯：key-structure R-payload/R-category-sanitize、closed-loop R1、folderview R-FOLDERVIEW。
- **`source_object_key`/`source_bucket`（NEW, both）+ `source_ifc.key`（NEW intake 子欄位）** — job_output 完全沒有 bucket/object_key，只有混入 presigned 的 ref。closed-loop R3 要 source_ifc 衍生 ledger bucket/object_key/etag、R10 要跨視圖 join。intake 端新增 `source_ifc.key`（純 key、無簽章）讓 job 端有非簽章來源；job 端吐 `source_bucket`+`source_object_key` 完成 `{bucket,key,etag}` 三元對帳鍵可觀測。追溯：closed-loop R3/R4/R10、key-structure R4。
- **`key_segments`（NEW）** — 把 `deriveIntakeFromKey` 三段拆解（`project_raw`=segments[0]、`category`=length-2、`version`=length-1、`middle[]`=識別忽略但保留的動態中間層）**後端單一真相暴露**，避免前端 re-parse 與後端規約漂移（尤其 OQ4 三段語意 gate 未解時）。追溯：key-structure R1、closed-loop R8、folderview R-FOLDERVIEW、R-TRIGGER-KEY-VALIDATION。
- **`provenance_source`（NEW）** — 不同來源溯源完整度不同（minio-watch/manual-trigger 有三段+原名+key；worker-compat 只有 sanitized id，且 `external_conversion_task_id` 語意不同）。標來源讓 null 的「未提供」vs「此來源結構性無此欄」可區分，並分辨自動偵測 vs 手動觸發 vs webhook。追溯：folderview R-TRIGGER-ENDPOINT/R-WATCHER-AUTO-SEMANTICS-FROZEN、observations #11。

### 4.6 誠實/安全收斂類

- **`source_ifc_ref`（CHANGED 遮蔽，P0）+ `source_ifc_ref_expires_at`（NEW）** — **現役安全/誠實違規**：現況把 `expiresIn:3600` presigned URL 原樣吐進 job_output（app.ts:2357），違反 closed-loop R3 邊界鐵律「presigned 不入 log/只記 key」、folderview R-TRIGGER-PRESIGNED-SERVERSIDE「不洩漏 presigned」、CLAUDE.md 邊界，且過期後仍原樣顯示無失效指示。設計：對外 ref 剝除 `X-Amz-*`/Signature/Expires 只留物件位址；簽章只活在 server-side dispatch；`source_ifc_ref_expires_at` 只放過期時戳（非 URL）。**MUST additive 改、不硬改既有欄位語意破壞 FE**（FE `IfcReadyListItem` 未列 source_ifc_ref，風險低但須驗其他 consumer）。追溯：closed-loop R3、folderview R-TRIGGER-PRESIGNED-SERVERSIDE。
- **`usdc_role`（NEW）/ `usdc_key`（NEW）/ `coverage_report`（NEW）** — closed-loop R6/R8/R10/R12 + AC8：converter 落地前一律 pending，**禁假 parsed USDC、禁假 coverage 100%**。`usdc_role` 後端權威投影（usdc_key=null→pending；有值且 ready→parsed）杜絕 FE 寫死假 parsed。`usdc_key`/`coverage_report` **Phase 1 恆 null，誠實字串由前端依 null 渲染，不塞進 nullable 欄位污染型別**。已知教訓：`usd_stage_enumeration` 下 `coverage_ratio=1` 是結構性自我參照恆等非真無損，欄位須能承載分子/分母來源以免被誤讀為零遺漏。追溯：closed-loop R6/R8/R10/R12、folderview R-STATUS-CHIP AC8、memory conv-coverage-ratio-self-referential。
- **`conversion_authority`/`callback_outbox_id`（ledger 端 NEW 對齊）** — job 已有此二欄但 ledger 沒有；closed-loop R6 要 ledger 記 authority、回填路徑=callback outbox。ledger 補上讓操作員追「結果來自誰、經哪筆 outbox 投遞」，確認 coordinator 未越界自填。追溯：closed-loop R6/R11。
- **`is_baseline`（NEW）** — folderview R-BASELINE-NO-AUTO-INTAKE：baseline 既有檔 by-design 不自動產生 job。per-job 旗標讓 #conv 誠實揭露「此 job 是基線補登 vs baseline 後新觸發」。追溯：folderview R-BASELINE-NO-AUTO-INTAKE/R-BASELINE-DISCLOSURE、closed-loop R7。
- **`data_volatility`（NEW）** — store 純 in-memory Map，重啟即清，對外無欄位標示易失性→前端無法區分「真的沒 job」vs「剛重啟」。標出讓操作員以 ledger（持久）為對帳真相。追溯：folderview R-BASELINE-NO-AUTO-INTAKE/R-NO-AUTO-ENROLL、closed-loop R-LEDGER-AS-STATUS-TRUTH/R12。
- **`watcher_liveness`（NEW，屬 records 視圖）** — closed-loop R9 要 `/api/conversion/records` 一併回 watcher 存活遙測；缺遙測標「未取得」（非 0，語意不同）。**注意**：嚴格屬 `/api/conversion/records` 輸出而非 `summarizeIfcReadyJob`（見 §7-OQ4）。追溯：closed-loop R9/R12。

---

## 5. 移除/棄用清單與相容性影響

| 項目 | 處置 | additive vs breaking | 前端消費端影響 |
|---|---|---|---|
| `event_id`（intake body） | **deprecate**（schema `.passthrough` 仍寬容接受，契約標 accept-and-drop） | additive（不刪 schema，R11） | 無（FE 從未消費） |
| `correlation_id` / `idempotency_key`（intake **body** 同名欄位） | **deprecate**，契約標「唯一權威=header」 | additive（schema 保留，R11） | 無（FE 不送 body 此欄）；釐清避免 API caller 誤填 |
| `source_ifc.filename` / `source_ifc.format` | **deprecate-for-display**，契約標「intake 後丟棄，檔名請看 `source_object_key`」 | additive（schema 保留） | 無（現況本就不吐） |
| `requested_outputs` | **deprecate-for-display**（dispatch 端 server-side 若需則保留，不進 job_output） | additive | 無（恆定值） |
| `tenant_id`（job_output） | 標 **dead-for-FE**（保留後端契約 R11，不加 UI） | 無變更 | 無（FE 本就不消費） |
| `source_ifc_ref`（job_output 含簽章） | **CHANGED 遮蔽**（非刪欄；additive 補 `source_object_key`/`source_bucket`/`source_ifc_ref_expires_at` 承接職責） | **語意 breaking-ish**（值內容改變） | FE `IfcReadyListItem` 未列此欄→風險低；**MUST 驗 ledger/其他 consumer 無依賴 job_output ref 直接 GET 下載**（見 §7-OQ3） |
| `conversion_status`（自由字串作主狀態） | **CHANGED 降級**為 authority 原文，前端改綁 `conversion_lifecycle_status` | additive（欄保留 R11） | FE 須改綁新 enum 欄；舊欄仍在不破壞 |
| `download_failure` / `dispatch_error`（分散失敗欄） | **CHANGED**：store 保留寫入點，summarize 改由 `failure_reason` 統一投影 | additive | FE 改消費 `failure_reason`/`failure_stage`；舊欄仍吐不破壞 |
| `queue_position` 三義 | **保留**，契約釐清三義，主判讀交給 lifecycle | 無變更 | 無（FE non-optional 仍可讀） |

**整體相容性結論**：除 `source_ifc_ref` 遮蔽是**唯一 breaking-ish（值內容變更，欄名/型別不變）**外，其餘全為 additive；既有 26 欄 job_output 契約欄名/型別逐字保留（R11 零回退）。**所有 NEW job_output 欄位 FE `IfcReadyListItem` 須同步擴充消費並在 plan 標明 #conv/#minio/A1 render 綁定點**，無綁定點的欄位不加（YAGNI，避免重演 `tenant_id` 吐了沒人用）。

---

## 6. 誠實與邊界守則

1. **presigned URL / secret 絕不入欄位與 log** — `source_ifc_ref` 對外**必須遮蔽** `X-Amz-Signature`/`X-Amz-Credential`/`X-Amz-Date`/`X-Amz-Expires` 等簽章 query 參數，只留 bucket/key 物件位址；完整 presigned 只活在 server-side dispatch，永不進 job_output / ledger / log。`POST /api/conversion/trigger` 前端只送 `key`，presigned GET URL 與 webhook secret 一律 coordinator server-side 生成，瀏覽器零接觸（folderview AC-trigger「按鈕/回應不洩漏 presigned URL」）。過期資訊只用 `source_ifc_ref_expires_at` 時戳表達，非 URL。
2. **coverage 自我參照誠實標註** — `coverage_report` 數字一律來自轉檔權威真實 report，前端不寫死、Phase 1 恆 null。已知教訓：`usd_stage_enumeration` 下 `coverage_ratio=1` 是結構性自我參照恆等（同源 USD prim 枚舉），**非 IFC lossless**；欄位須能承載分子/分母來源，前端顯示此值**須加註不可標「零遺漏」**。
3. **converter 落地前禁假完成** — `conversion_lifecycle_status` 在 converter 落地前禁出現 `ready`、誠實停在 `detected/queued/converting`；`usdc_role` 一律 `pending`、`usdc_key`/`coverage_report` 恆 null（AC8「#minio 不出現假 parsed USDC、ledger 不出現假 ready」不變量）。誠實守衛測試 MUST 斷言此不變量。
4. **誠實佔位策略（型別不污染）** — 資料欄位（`usdc_key`/`coverage_report`/`source_object_key` 等）**保持 nullable null**；誠實字串（`pending · 待產生` / `NOT BUILT · Phase 2` / `未取得`）由**前端依 null + lifecycle 渲染**，後端**不**把字串塞進本該 nullable 的資料欄位。`status` enum 端用 `detected/queued/converting` 表達「尚未 ready」而非塞字串。缺遙測標「未取得」（≠ 0）。
5. **baseline 揭露語意** — baseline 既有 `model.ifc` by-design 不自動產生 ifc-ready intake/job；`is_baseline` per-job 標示、#conv 須誠實揭露「哪些 model.ifc 尚未產生 job」、`triggered_total=0` 不得誤讀為故障；一致性基準=可解析 IFC 數（非 bucket 物件總數 527）。重啟首輪重建 baseline、既存檔不自動觸發（「重啟也救不了既存檔」）。
6. **coordinator 邊界不越界** — coordinator 只暴露讀視圖、不擁有 conversion body / metadata 權威（權威在外部 control-plane / `_bim-control`）；新增 ledger 欄位不得讓 coordinator 升格為 metadata 權威；Phase 2 回填只經 callback outbox 收結果，不自產 `usdc_key`/`coverage_report`/`ready`。
7. **watcher 自動語意凍結** — watcher 自動 intake 語意零變更（folderview AC7）；`deriveIntakeFromKey`、首輪 baseline 不觸發、後續輪 etag 才觸發皆不改；手動一鍵觸發是 additive 平行路徑，匯入相同內部 intake 邏輯（須 `detect_changes` 驗證未動）。

---

## 7. 開放問題 / 待 spec 釐清（誠實列出，不硬填）

- **OQ1（spec 間真實衝突，須使用者/維護者裁決）** — **key-structure R5「`model_category`/`project_display_name` 不入 coordinator shadow store（YAGNI）」 vs closed-loop R-baseline-disclosure-job-output「watcher 觸發後 ifc-ready job 須帶安全 project_id + model_category 可觀測」直接矛盾**。若 job_output 來源只讀持久 store 則兩欄不可能吐。本設計建議解法：**summarize 時由持久 ledger（已持有此二欄）join 補吐，不寫進 `externalIfcReadyStore`**（不違反 R5「不落 store」字面，且 in-memory ≠ 升格 metadata 權威）。此為 spec 間衝突，**不可由 agent 靜默選邊**，須上呈裁決並確認 join 鍵（`idempotency_key`）job↔ledger 1:1。
- **OQ2（前置依賴 gate）** — **`deriveIntakeFromKey` 三段語意 OQ4 archive gate 未解**：live spec 仍寫舊「兩層 `{projectId}/{modelId}`」，與 active 的 ≥3 段衝突（folderview R-TRIGGER-KEY-VALIDATION honesty）。`key_segments`/`category`/`project_display_name`/`external_model_version_id` 全依賴三段規約；舊 2 層 key（如 `899/v1/model.ifc`）在新規則下變 malformed（key-structure §5 刻意契約變更）。**須先確認 archive gate 狀態，不可假設三段解析已正確**。
- **OQ3（既有 consumer 相依驗證）** — `source_ifc_ref` 遮蔽簽章是 breaking-ish。須確認**無下游 consumer 依賴 job_output 的 presigned ref 直接 GET 下載**（FE 不消費，風險低，但 ledger / 其他 consumer 未驗）。
- **OQ4（端點歸屬）** — closed-loop R9 的 `watcher_liveness` 與 R-baseline-disclosure 的 `baseline_count`/`seen_count`/`triggered_total`/`skipped` 嚴格屬 `GET /api/conversion/records` / `GET /api/external/minio-watch/status` 輸出，**非 `summarizeIfcReadyJob`（task 定義 job_output 專指 summarizeIfcReadyJob）**。本文件將其列為 job_output 廣義投影，但**精確歸屬（哪些進 `/:jobId`、哪些只在 records/status）spec 未明示**，須 plan 定稿。
- **OQ5（映射表未凍結）** — closed-loop R5 明文「對齊語意但**未定義精確映射表**」：`conversion_lifecycle_status`(detected/queued/converting/ready/failed) ↔ 既有 `status`(accepted/queued_for_conversion/dispatched/dispatch_failed/dropped_on_restart/failed) + `download_status` + `conversion_status` 的精確對應未定。**MUST 在 plan 凍結映射表並寫成單一 helper + 測試斷言**，禁前後端各自映射（否則重生三視圖不一致）。
- **OQ6（誠實佔位型別未凍結）** — closed-loop R12 未定誠實字串是「後端塞字串」還是「前端依 null 渲染」。本設計主張後者（§6.4），但**須在 plan 凍結「資料欄位保持 nullable null、標籤由前端產」契約**，避免後端塞 `pending · 待產生` 進 nullable `usdc_key` 污染型別、破壞 #minio role 對帳。
- **OQ7（Phase 2 wiring 未接通）** — closed-loop R6 說「callback outbox 已有」，但 ledger 回填 wiring（`recordCallbackOutcome` 目前不帶 `callback_outbox_id` 連結）是 Phase 2 預留尚未接通。**Phase 1 不可宣稱已可觀測到 ready/coverage**，evidence 誠實止於 dispatched/queued（R-ledger-observability-boundary）。
- **OQ8（雙鍵分歧風險）** — closed-loop R11 警告 `conversion_job_id` 與 ledger `conversion_job_id`（=`ifc_ready_job_id`）須同一值。手動觸發路徑（`mw_` 派生）與 worker-compat 路徑（`worker:` 派生 task_id）的 `idempotency_key` 推導須一致，否則 job↔ledger join 落空、`provenance_source` 標示與對帳錯位。**須驗證 join 鍵跨路徑一致**。
- **OQ9（category 透傳深度未定論）** — key-structure R-category-sanitize 明示 `model_category` 是否透傳至 dispatch（`streamingConversionClient`）由實作評估；job_output 暴露 `category` 只需停在 coordinator（store/ledger→summarize），不需透傳轉檔層，符合最小範圍。**不可預設已透傳/已依種類派工**（§8 YAGNI）。

---

## 8. 對抗驗證裁決（adversarial review）

**總評**：草案品質高、誠實紀律到位、欄位設計大致覆蓋三份 spec，且最關鍵的 P0（presigned URL 洩漏進 job_output）抓得正確並有真實程式碼佐證（minioWatcher.ts:301-304 生成 expiresIn:3600 presigned URL → store → summarizeIfcReadyJob app.ts:2357 原樣吐出）。但作為對抗式審查，有三類非放水不可的問題：(1) presigned 洩漏面被低估——草案只點名 summarizeIfcReadyJob:2357，實際 app.ts 至少還有 1575(callback context source_ifc.ref)、1848(artifact_resolution.source_ifc_ref) 兩處也吐含簽章 ref，遮蔽工程須涵蓋全部出口，否則「修了一處仍洩漏」；(2) OQ2 對 deriveIntakeFromKey 三段語意的「衝突」被誇大——實際 code(minioWatcher.ts:95-103)早已是 ≥3 段、category=length-2、version=length-1，唯一殘留的「兩層」只在 stale docstring(line 12) 與未 archive 的 live spec，這是文件衛生問題而非解析正確性 blocker，草案把它列為「不可假設三段解析已正確」過度警示，可能誤導 plan 把不存在的 code 風險當前置 gate；(3) OQ1 衝突真實且草案 join-from-ledger 解法可行（已驗證 ledger 持有 project_display_name/category/idempotency_key/conversion_job_id），但草案未點出 join 的時序風險：ledger 以 idempotency_key 為鍵、conversion_job_id 可為 null 且後填(conversionLedger.ts:23,120)，若以 conversion_job_id 當 join 鍵會在 detected 早期落空，必須以 idempotency_key 為 join 鍵(草案 OQ1 有提但未強調此時序陷阱)。整體可作為 plan 輸入，但 must_fix 清單須先解。建議裁決：APPROVE-WITH-REQUIRED-FIXES。

### 8.1 必修項 (must_fix)

1. P0 全出口遮蔽：source_ifc_ref 含簽章的對外出口不只 summarizeIfcReadyJob(app.ts:2357)，至少還有 app.ts:1575(callback context source_ifc.ref) 與 app.ts:1848(artifact_resolution.source_ifc_ref)。遮蔽設計必須列舉並覆蓋全部讀 job.source_ifc_ref 並對外回應的出口，並加誠實守衛測試斷言『任何對外 response 不含 X-Amz-Signature/X-Amz-Credential』。只修 2357 不算修好。

2. 凍結 conversion_lifecycle_status 映射表 + 單一 helper：closed-loop R5 明示映射表未定。plan 必須產出 intake status(accepted/queued_for_conversion/dispatched/dispatch_failed/dropped_on_restart/failed)+download_status+ledger status → conversion_lifecycle_status 的精確對應，寫成單一 deriveLifecycleStatus() helper(重用 ledger 既有 ConversionLedgerStatus type，禁另宣告)，前後端共用，並加測試斷言。否則三視圖必再度不一致。

3. OQ1 上呈裁決後再實作：key-structure R5 vs closed-loop baseline-disclosure 是真衝突且 ledger 本身也是 coordinator shadow，join-from-ledger 不是純字面繞過。實作 project_display_name/category 投影前必須取得使用者/維護者裁決(放寬 R5 或確認 ledger-join 例外)，不可 agent 靜默選邊。

4. 明確 join 鍵為 idempotency_key 並禁用 conversion_job_id 當 join 鍵：ledger conversion_job_id 後填可為 null(conversionLedger.ts:23,120)，detected/queued 早期 join 會落空。三視圖對帳 join 鍵一律 idempotency_key(mw_<hash16>)，plan 須明文並加測試覆蓋 detected 早期(conversion_job_id=null)仍能 join。

5. OQ2 降級為文件 task 不當前置 gate：deriveIntakeFromKey code 已正確 ≥3 段(minioWatcher.ts:95)。修正草案 OQ2 措辭，把『不可假設三段解析正確』改為『同步 archive stale 兩層 live-spec + 修 minioWatcher.ts:12 docstring』，避免 plan 把不存在的 code 風險當 blocker。

6. 釐清 watcher_liveness / baseline_count / seen_count 的 endpoint 歸屬(OQ4)：這些屬 /api/conversion/records 或 /api/external/minio-watch/status，不屬 summarizeIfcReadyJob(/:jobId)。plan 必須把它們從 job_output 欄位表移出、放進正確 endpoint 的 response type，否則型別與測試錯位。

7. 區分『投影既有值』vs『真 NEW 需 wiring』的實作成本：idempotency_key/idempotent_replay/project_id 等已在 store/binding 僅需投影；conversion_authority/callback_outbox_id 進 ledger、failure_reason/failure_stage 統一欄、key_segments、所有階段時戳則需真新增寫入點+wiring。plan 欄位表須標成本級別，避免低估工作量。

### 8.2 spec 矛盾

- 【真實衝突 OQ1，已驗證】key-structure R5(model_category/project_display_name 不落 coordinator shadow store, YAGNI) vs closed-loop R-baseline-disclosure-job-output + R4(job/ledger 須帶 project_display_name+category 可觀測)。實測：externalIfcReadyStore 確實不存這兩欄(grep 0 命中)，ConversionLedger 確實存(conversionLedger.ts:18-19)。草案 join-from-ledger 解法技術可行，但 ledger 本身亦是 coordinator-local shadow(conversionLedger.ts:49 註解自述)，故 R5『不落 coordinator shadow store』的精神仍被部分觸碰——非純字面繞過。須上呈使用者/維護者裁決，不可 agent 靜默選邊。草案 OQ1 標示正確但低估此 nuance。

- 【被誇大的衝突 OQ2】草案稱 deriveIntakeFromKey 三段語意有 live-spec『兩層』vs active『≥3 段』衝突、並警示『不可假設三段解析已正確』。實測 minioWatcher.ts:95-103 已實作 ≥3 段(segments.length<3 拒)、category=length-2、version=length-1，code 正確。殘留『兩層』僅在 stale docstring(line 12-13)與未 archive 的 live spec。這是『文件 vs code』衝突(文件衛生)，非『code 解析錯誤』風險。草案把它列為前置 gate 過度警示，可能誤導 plan 把不存在的 code 風險當 blocker。建議降級為『docstring/live-spec 須同步 archive』的文件 task。

- 【ledger 欄位 vs 草案 NEW 宣稱】草案 §4.6 稱『job 已有 conversion_authority/callback_outbox_id 但 ledger 沒有，須 NEW 補上』。實測 ConversionLedgerRecord(conversionLedger.ts:14-29)確實無此二欄、且 recordCallbackOutcome(line 143) 只回填 status/usdc_key/coverage_report 不帶 callback_outbox_id 連結。草案宣稱與現實一致，無矛盾——但須注意這是真 NEW 欄位(非投影既有值)，plan 實作量比 idempotency_key(僅投影)高，草案未區分『投影既有』vs『真新增需 wiring』的實作成本，OQ7 有提但未在欄位表標註成本級別。

- 【join 鍵時序陷阱，草案未點明】closed-loop R10/R11 要 conversion_job_id == ledger.conversion_job_id == ifc_ready_job_id。但 ledger conversion_job_id 可為 null 且後填(conversionLedger.ts:23,120 採 ?? 保留語意)。若三視圖 join 用 conversion_job_id 當鍵，在 detected/queued 早期(conversion_job_id 尚 null)會 join 落空。正確 join 鍵須是 idempotency_key(mw_<hash16>，upsert 即有)。草案 OQ1/OQ8 提到 idempotency_key 為 join 鍵但未顯式警告『不可用 conversion_job_id 當 join 鍵』此時序陷阱。

### 8.3 洩漏 / 邊界

- P0 presigned 洩漏面被低估：草案只點名 summarizeIfcReadyJob(app.ts:2357)，但實測 app.ts 至少還有兩處出口吐含簽章的 source_ifc.ref/source_ifc_ref——line 1575(callback context: source_ifc:{ref: job.source_ifc_ref})、line 1848(artifact_resolution.source_ifc_ref)。遮蔽工程必須涵蓋『所有讀 job.source_ifc_ref 並對外回應』的出口，否則修了 2357 仍從 callback/artifact-resolution 端洩漏短效簽章。草案 §3.1/§6.1 須擴充為『全出口遮蔽』而非單點。

- source_ifc_ref 在 store 內仍以完整 presigned 形式持久(externalIfcReadyStore 落 job.source_ifc_ref=presignedRef)。草案選擇『對外遮蔽、server-side 留簽章』，但須明確：簽章是否該根本不落 store(只存純 key+短效簽章另存或即用即丟)？若 store 持久化 3600s 簽章且 store 有任何 dump/log/debug 出口，仍是潛在洩漏面。草案未處理 store 端持久化策略，僅處理 summarize 出口。

- watcher_liveness/source_object_key 等欄位本身無 secret，邊界 OK。host_local_path/local_path 標 dead-for-FE 保留——這是容器/host 絕對路徑，雖 FE 不消費，但仍在 job_output JSON 內對任何 GET /:jobId 呼叫者可見，屬伺服器路徑外洩面。草案標 dead-for-FE 但未討論是否該對外遮蔽絕對路徑(closed-loop 誠實鐵律精神)。建議列為 OQ：host_local_path 是否該從對外 job_output 移除或遮蔽。

- coordinator 邊界：草案 §6.6 與 OQ1 正確守住 coordinator 不升格 metadata 權威。join-from-ledger 不違反(ledger 是讀視圖 shadow)。無越界新增權威欄位。此面已確認乾淨。

### 8.4 命名 / 型別問題

- category vs model_category 命名分裂：intake 端 schema 用 model_category(app.ts:169)、ledger 用 category(conversionLedger.ts:19)、草案對外 job_output 統一為 category。三鏈三名雖草案有意識統一對外為 category，但 intake schema 仍叫 model_category——plan 須明確記載『intake 收 model_category、ledger/對外吐 category』的映射，否則前後端/測試易混。草案 §2.1 有標但未做成醒目映射表。

- failure_reason 型別二義：草案 §3.2 寫『string |（或結構化 {stage,code,message}）』——這是型別未凍結，必須在 plan 二選一。同時又有獨立 failure_stage enum 欄位，若 failure_reason 走結構化版會與 failure_stage 重複承載 stage，造成兩處 stage 可能不一致。建議凍結為 failure_reason:string + failure_stage:enum 單一來源，禁結構化版內再帶 stage。

- queue_position 三義(0=in-flight/1+=queued/null=不在 queue)保留但靠 contract 文字釐清——這是型別無法自證的語意多載，前端極易誤判(0 可能被當 falsy)。草案選擇保留(R11 non-optional)+contract 記載，可接受，但建議 plan 加單元測試斷言三義邊界、且前端判讀一律走 conversion_lifecycle_status 不直接讀 queue_position 數值。

- conversion_lifecycle_status 與 ConversionLedgerStatus 重複定義風險：ledger 已有 type ConversionLedgerStatus = detected|queued|converting|ready|failed(conversionLedger.ts:11)，草案 NEW conversion_lifecycle_status 用相同 enum 值。草案要求『job/ledger 共用同一 type 定義』正確，但須在 plan 明確『重用 ConversionLedgerStatus 為單一 type，禁 job 端另宣告同名 enum』，否則兩處 enum 漂移。

- watcher_liveness 物件型別內嵌且歸屬模糊(§3.2 列在 job_output 表但 OQ4 說屬 records 端點)——同一欄位在文件兩處語意衝突，plan 須先決定它到底在哪個 endpoint 的 response type，不可型別上既是 /:jobId 又是 /records。

- key_segments.middle[] 命名：草案定義 {project_raw, category, version, middle[]}，但 middle 是『識別時忽略的動態中間層』，叫 middle 易被誤解為有語意。建議 ignored_segments 或 dynamic_middle 更誠實表達『保留但不參與識別』。

- is_baseline 與 data_volatility 的 null 語意各自定義但交互未定義：data_volatility=in_memory_volatile 時 is_baseline 是否仍可信？重啟後 in-memory job 清空、ledger 持久——兩欄組合的真值表草案未列，前端誠實渲染須要這張表。

### 8.5 spec 覆蓋率核對

- **[covered]** folderview R-TRIGGER-ENDPOINT (POST /api/conversion/trigger {key}) — §2.3 與 provenance_source=manual-trigger 涵蓋；正確標為獨立 endpoint 非 ifc-ready intake 欄位。
- **[covered]** folderview R-TRIGGER-KEY-VALIDATION (≥3 段、拒空段/./..) — key_segments + §2.3 驗證描述對齊，且與實際 code(minioWatcher.ts:95)一致。
- **[covered]** folderview R-TRIGGER-PRESIGNED-SERVERSIDE (presigned server-side、不洩漏) — §6.1 明確要求瀏覽器只送 key；與 P0 遮蔽連動。
- **[covered]** folderview R-TRIGGER-IDEMPOTENT (mw_<hash16>、回既有 job) — idempotency_key + idempotent_replay NEW 欄位；已驗證值存在於 job binding 僅需投影。
- **[covered]** folderview R-LEDGER-AS-STATUS-TRUTH (ledger 為狀態真相) — conversion_lifecycle_status + data_volatility 對齊；但須在 plan 凍結 job↔ledger 投影來源(見 OQ5)。
- **[covered]** folderview R-STATUS-CHIP-VALUES (chip enum、無紀錄標未轉) — conversion_lifecycle_status null 語意=未轉/未偵測對齊。
- **[covered]** folderview R-BASELINE-NO-AUTO-INTAKE / R-NO-AUTO-ENROLL — is_baseline + data_volatility + §6.5；正確排除 auto-enroll。
- **[covered]** folderview R-WATCHER-AUTO-SEMANTICS-FROZEN (AC7、detect_changes 驗) — §6.7 明列；惟須在 plan 強制 detect_changes 證據，草案僅文字承諾。
- **[partial]** folderview R-IFCREADY-PAYLOAD-NOT-RESPECIFIED (intake schema 凍結) — 草案 §2.1 對既有 intake 欄位做了 REMOVED(deprecate)/REMOVED(for-display) 標註，雖以 .passthrough accept-and-drop 包裝、且不刪 schema，但 folderview spec 明示本 spec『不重新定義 intake schema』。對既有 intake 欄位重新分類(即使 additive)逾越了此 spec 的 scope 宣告，應移交 key-structure/closed-loop spec 主張或在 plan 明確標『此分類屬 closed-loop 範圍非 folderview』。
- **[covered]** folderview R-FOLDERVIEW-NO-IFCREADY-IMPACT (三段只進 #minio badge) — 草案把 folderview 欄位(delimiter/folders/role)正確排除於 job_output 外。
- **[partial]** folderview R-BASELINE-DISCLOSURE-CONV (baseline_count/seen/triggered/skipped) — watcher_liveness NEW 欄位涵蓋 triggered_total/skipped，但 baseline_count/seen_count 未明列於 §3.2 欄位表，且 OQ4 正確指出這些屬 /minio-watch/status 非 summarizeIfcReadyJob——歸屬待 plan 定稿，草案目前混入廣義 job_output 易誤導。
- **[covered]** key-structure R1-three-parts (專案/種類/版本導出) — key_segments NEW 欄位 + project_id/category/external_model_version_id 對齊實際 code。
- **[covered]** key-structure R2-malformed-skip — failure_stage=key_malformed 涵蓋；touches=neither 不產欄位正確。
- **[covered]** key-structure R3-chinese-display-plus-safe-id — project_display_name(原名) + project_id(sanitized)雙欄；已驗證 mv_<hash8> 行為。
- **[covered]** key-structure R4-ui-full-original-key — source_object_key + key_segments 提供 job 端反查；正確標明完整 key 主來源在 watcher status。
- **[partial]** key-structure R5-no-shadow-store-payload-only — 此為與 closed-loop R-baseline-disclosure-job-output 的真實衝突核心(OQ1)。草案 join-from-ledger 解法已驗證可行(ledger 持有兩欄)，但 R5 字面是『不落 coordinator 本地 shadow store』，而 ConversionLedger 本身就是 coordinator-local shadow(conversionLedger.ts:49 註解明寫 coordinator-local shadow)。從 ledger join 補吐在『不寫 externalIfcReadyStore』字面成立，但『ledger 也是 coordinator shadow』使 R5 YAGNI 精神仍被觸碰——須上呈裁決，草案 OQ1 標示正確但未點出此 nuance。
- **[covered]** key-structure R6-flag-off-no-secret — §6.1/§6.7 不碰機密；flag-off byte-identical 不在欄位設計範圍，正確未動。
- **[covered]** key-structure R-payload-additive-fields — §2.1 對齊；已驗證 schema(app.ts:168-169)接受 project_display_name/model_category 為 nullish。
- **[covered]** key-structure R-category-sanitize-passthrough — OQ9 正確標明透傳深度待實作評估、不可預設依種類派工。
- **[partial]** key-structure R-project-id-cross-path-consistency — OQ8 點到跨路徑 join 鍵一致，但未明確覆蓋『dispatch 端 toInternalIfcReadyEvent 二次 sanitize 冪等』這條具體不變量(streamingConversionClient.ts:145)，plan 須補驗 worker-compat 與 minio-watch 對同名得同 project_id。
- **[covered]** key-structure R-baseline-disclosure-job-output (job 須帶 safe project_id + model_category) — project_display_name/category NEW 投影涵蓋；此即 OQ1 衝突的另一端。
- **[covered]** key-structure R-ledger-observability-boundary (P7 止於 dispatched/queued) — dispatched_at 標為取證終點、converted_at Phase1 恆 null；OQ7 正確止於 dispatched/queued。
- **[covered]** closed-loop R1 (三段導出進件) — 與 key-structure R1 同源涵蓋。
- **[covered]** closed-loop R2 (idempotency_key/correlation_id/idempotent_replay) — 已驗證 job binding 已存 idempotency_key/idempotent_replay，summarize 僅需投影。
- **[covered]** closed-loop R3 (source_ifc 物件參照、presigned 不入 log 只記 key) — P0 遮蔽 + source_bucket/source_object_key/source_ifc_ref_expires_at 對齊；但見 leaks 區：遮蔽出口面被低估。
- **[covered]** closed-loop R4 (ledger 欄位集) — 草案欄位大致對齊 ledger 草案(已驗證 conversionLedger 實體欄位)；惟 ledger 實際無 conversion_authority/callback_outbox_id 欄(草案正確標為 NEW 對齊新增)。
- **[partial]** closed-loop R5 (status enum 對齊、映射表未定) — conversion_lifecycle_status NEW + OQ5 正確指出映射表未凍結並要求單一 helper。但草案未提供候選映射草表，plan 風險仍高；建議草案至少列出 intake status→lifecycle 的初步對應假設供 plan 驗證。
- **[covered]** closed-loop R6 (Phase2 usdc_key/coverage/ready 回填、callback outbox) — usdc_key/coverage_report/converted_at Phase1 恆 null；§6.3 禁假 ready。
- **[covered]** closed-loop R7 (baseline disclosure、偵測即寫 detected/queued) — detected_at + is_baseline 涵蓋。
- **[covered]** closed-loop R8 (folderview role enum、model.usdc 標 pending) — usdc_role enum 對齊；R8 touches=neither(屬 /minio/objects)草案正確未當 job_output 主欄。
- **[partial]** closed-loop R9 (#conv watcher liveness) — watcher_liveness NEW 涵蓋欄位，但 OQ4 正確指出嚴格屬 /api/conversion/records 非 /:jobId；草案放在 job_output 表內(§3.2 末列)型別歸屬模糊，plan 須拆出。
- **[covered]** closed-loop R10 (四段一致性不變量) — idempotency_key 作 join 主鍵 + §4.1 論證；但須補 join 時序陷阱(conversion_job_id 後填不可當 join 鍵)。
- **[covered]** closed-loop R11 (26 欄零回退) — §3.1 逐欄保留、CHANGED 不刪欄名；已比對 summarizeIfcReadyJob 實際 26 欄(app.ts:2350-2380)逐字相符。
- **[covered]** closed-loop R12 (誠實佔位、缺值標記) — §6.4 主張資料欄 nullable null + 前端渲染標籤；OQ6 正確標明型別未凍結待 plan 定。
