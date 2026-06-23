# MinIO 轉檔閉環可觀測性 — 設計 spec

> 日期：2026-06-23 · 狀態：設計核可（待 writing-plans 出實作計畫）
> 來源依據：使用者指令（「MinIO 的問題用 superpowers 建 issue spec」）+ repo 程式碼現況
> 對齊：`docs/plans/`（需求/介面/誠實鐵律）、design system `guides/persistence.md`（雙層持久化）、
> `bim-review-coordinator` 邊界（`CLAUDE.md` / `AGENTS.md`：intake / callback outbox / session control plane）
>
> **metadata DB 權威更正**：雲端 control-plane metadata 權威為 **bim-control · MySQL**（非 Postgres）。
> design-system `guides/persistence.md` 若寫 Postgres，與 repo 現況不符——**以 repo 為準**；本 spec 一律以「metadata 平面 DB（bim-control · MySQL）」表述 ledger 持久層。

---

## 0. 一句話

MinIO **偵測已實作但閉環缺三塊**：無持久轉檔紀錄、無資料結構瀏覽頁、轉檔僅靠新增 IFC 觸發且 completion 端無證據。本 spec 把它補成**可觀測閉環**：偵測 → 持久紀錄 → 唯讀結構/紀錄視圖 → 可載入，全程誠實標記、不越服務邊界、不假裝待建的轉檔權威已存在。

## 1. 問題陳述（現況，以程式碼為證）

| 面向 | 現況 | 證據 |
|---|---|---|
| MinIO 偵測 | ✅ 已實作（ListObjectsV2 輪詢 → key 三段解析 → loopback intake） | `bim-review-coordinator/src/services/minioWatcher.ts`（`deriveIntakeFromKey` / `startMinioWatcher`）；`POST /api/external/ifc-ready` |
| watcher 狀態 | ⚠️ 僅**記憶體內、易失**：`triggered_total` / `skipped_malformed_total` / `last_triggered`（只留最後 5 筆） | `MinioWatcherStatus`（`minioWatcher.ts`）；`tests/minio-watch-status-route.test.ts` |
| 轉檔紀錄（ledger） | ❌ 無持久化「轉檔歷史紀錄」（重啟即失，無法稽核「偵測→轉檔→可載入」） | 無對應 table / 持久 store；status 為 in-memory |
| MinIO 資料結構顯示頁 | ❌ `#minio` 未接真實 bucket list（現有 `docs/plans` 設計規格把它標「已交付」屬過度宣稱） | repo 無 `GET /api/minio/objects` 之類唯讀 list proxy |
| 轉檔觸發 | ⚠️ 僅靠 watcher 偵測到新 `model.ifc` → 觸發排程；無已接線的手動佇列/插隊 UI | watcher `triggerIntake` 為唯一觸發路徑 |
| 轉檔 completion | ❌ IFC→USDC **轉檔權威待建**（Phase 5 紅星）；coverage/usdc 無真實證據 | `bim-streaming-server` conversion authority 品質 gate 未落地 |

真實 MinIO：`192.168.20.234:9000` bucket `bim-control`（唯讀帳號由部署區頂層 `.env` 提供，不落 tracked 檔）。
key 規約：`{prefix}{project}/…/{category}/{version}/model.ifc`，≥3 段（第一段=專案、倒數第二段=種類、末段=版本），中文專案名 → `sanitizeArtifactIdPart` 轉 `mv_<hash8>`。

## 2. 目標與非目標

**目標**
- 把「偵測 → 紀錄 → 結構/紀錄視圖 → 可載入」做成端到端可觀測閉環。
- 補上**持久轉檔紀錄 ledger**（可稽核、可跨重啟、可跨裝置）。
- 補上**唯讀 `#minio` 結構頁**，呈現真實 bucket 三層與每物件角色。
- 把 `#conv` 從易失 status 升級為讀 ledger 的紀錄視圖。

**非目標（YAGNI / 邊界）**
- ❌ 不實作 IFC→USDC 轉檔本體（轉檔權威在 `bim-streaming-server`，另案、Phase 5）。
- ❌ 不把 coordinator 升格為 metadata 權威（它只持 minimal shadow metadata；專案/artifact metadata 權威在外部雲端 control-plane / `_bim-control`）。
- ❌ 不新增手動插隊/優先序佇列 UI（除非後續需求）。
- ❌ 不新增微服務（複用既有 coordinator S3Client + callback outbox）。

## 3. 架構與邊界對齊（雲地分離，不越界）

```
MinIO bucket bim-control ──(唯讀 list / presign)──┐
                                                  ▼
        coordinator :8004（控制面，無 GPU）
        ├─ minioWatcher（已有）：偵測新 model.ifc → loopback POST /api/external/ifc-ready
        ├─ ledger 寫入（新）：偵測即寫一筆 record(status=detected/queued)
        ├─ GET /api/minio/objects（新，唯讀 list proxy）→ #minio 結構頁
        ├─ GET /api/conversion/records（新，讀 ledger）→ #conv 紀錄視圖
        └─ callback outbox（已有）：回填 conversion 結果（status/coverage/usdc_key）
                                                  │
   metadata 平面 DB（bim-control · MySQL / shadow）│  ← ledger 持久權威
                                                  ▼
   bim-streaming-server（轉檔權威，GPU/CPU）：IFC→USDC + coverage（**待建**，Phase 2 回填）
```

**邊界鐵律**
- coordinator 對 MinIO 只做**唯讀** list/presign（沿用 watcher 既有 S3Client 與 SSRF/presign 紀律：presigned URL 不入 log、只記 key）。
- ledger 持久權威屬 metadata 平面；coordinator 暴露**讀視圖**，不可變 metadata 權威。
- conversion body / completion 屬 `bim-streaming-server`；coordinator 只經 callback outbox 收結果回填 ledger。

## 4. 元件單元（四個，各有單一職責 + 明確介面）

### 4.1 轉檔紀錄 ledger（新）
- **做什麼**：持久化每筆 `source MinIO key + etag → conversion job` 的生命週期。
- **欄位（草案，實作於 plan 定稿）**：
  - `idempotency_key`（複用 `idempotencyKeyFor(bucket,key,etag)` = `mw_<hash16>`，天然去重）
  - `correlation_id`（`correlationIdFor` = `minio-watch-<hash8>`）
  - `bucket` / `object_key` / `etag`
  - `project_id`（safe）/ `project_display_name`（中文原名）/ `category` / `external_model_version_id`
  - `conversion_job_id`（= intake 回的 `ifc_ready_job_id`；形狀 `ifcready_<ts>_<hex>`）
  - `status`：`detected → queued → converting → ready | failed`（enum 後端權威；對齊 intake 既有 `download_status` 語意）
  - `coverage_report`（nullable，Phase 2 回填）/ `usdc_key`（nullable，Phase 2 回填）
  - `detected_at` / `updated_at`
- **介面**：寫入由 watcher/intake 觸發；回填由 callback outbox 觸發；讀由 `GET /api/conversion/records`。
- **依賴**：metadata 平面持久層（bim-control · MySQL / `_bim-control` shadow）。
- **冪等**：以 `idempotency_key` upsert，replay 不重建（對齊 watcher `idempotent_replay` 既有不變量）。

### 4.2 `#minio` 唯讀結構頁（新）
- **做什麼**：把真實 bucket 三層（專案 → 類別 → 版本）做成只讀瀏覽頁，每物件標角色：`source IFC` / `parsed USDC` / `pending(待產生)`。
- **介面**：`GET /api/minio/objects?prefix=…`（唯讀 list proxy，分頁/continuation）。回傳結構化樹 + 每物件 `role`。
- **誠實**：頁面明示「唯讀 intake 來源視圖，非 metadata 權威」；`model.usdc` 在 converter 落地前一律標 `pending · 待產生`，不假裝已轉。
- **安全**：擋路徑穿越（沿用 watcher key 規約：拒空段 / `.` / `..`）；presigned 下載連結（如提供）短效、不入 log。

### 4.3 `#conv` 紀錄視圖（升級）
- **做什麼**：從易失 watcher status 升級為讀 ledger：偵測事件 + job 生命週期 + coverage（Phase 2）；失敗 job 可見（對齊 watcher 既有「下載失敗→操作者從 `#/conv` 看到失敗 job」語意）。
- **介面**：`GET /api/conversion/records`（讀 ledger，含 watcher liveness：`poll_count` / `last_poll_at` / `last_error`）。
- **保留**：既有 `PUT /api/conversion/watch`（IX-CV-04 runtime toggle）不動。

### 4.4 端到端可觀測（貫穿）
- 四段一致呈現：**偵測**（watcher status：`poll_count` / `triggered_total` / `last_triggered`）→ **紀錄**（ledger）→ **轉檔**（job status）→ **可載入**（session-ready）。
- `#minio`、`#conv`、watcher status 三者對同一 `idempotency_key` / `conversion_job_id` 必須一致（無矛盾數字）。

## 5. 資料流

```
1. watcher tick：ListObjectsV2 → 命中新 {key,etag}（deriveIntakeFromKey ok）
2. triggerIntake → POST /api/external/ifc-ready（已有）→ 回 ifc_ready_job_id
3. [新] 寫 ledger：upsert record(idempotency_key, status=detected/queued, conversion_job_id)
4. dispatch 轉檔權威（bim-streaming-server）
5. [新] callback outbox 回填：status=converting→ready|failed, coverage_report, usdc_key
6. [新] #minio / #conv 讀視圖呈現一致狀態
```

失敗/自癒語意沿用 watcher 既有三態（`triggered` / `skip_permanent` / `fail_transient`）：transient 失敗下輪重試、replay 命中既有去重；ledger 對 `download_status=failed` 誠實記為 `failed`（job 可見、不重送）。

## 6. 誠實與分期（硬性 · 對齊誠實鐵律）

| 期 | 範圍 | 真實度 |
|---|---|---|
| **Phase 1（現可建）** | 唯讀 list proxy + `#minio` 結構頁 + ledger 的 `detected/queued` 紀錄 + `#conv` 讀視圖 + watcher liveness | **REAL**：資料真、無假數字、無假按鈕 |
| **Phase 2（gated 在待建 converter）** | completion 回填：`usdc_key` / `coverage_report` / `status=ready` 由轉檔權威經 callback 回填 | 在 converter 落地前，record 誠實停在 `converting/pending`；**禁** 假 `ready` / 假 coverage 100% / 假 `model.usdc` parsed |

- 缺遙測標 `未取得`；未建標 `NOT BUILT · Phase 2`；`model.usdc` 未產生標 `pending · 待產生`。
- coverage 對齊「不承諾 100% 無損」；數字一律來自轉檔權威真實 report，前端不寫死。

## 7. 驗收（DoD）

1. 上傳一支新 `model.ifc` 到 watched bucket（fixture 或真實 `bim-control`）。
2. `#minio` 結構頁出現該物件，角色 = `source IFC`；同專案 `model.usdc` 標 `pending · 待產生`。
3. ledger 出現一筆 `detected/queued` record（含 `idempotency_key` / `conversion_job_id`）。
4. `#conv` 紀錄視圖可見該 job 與其**真實** status；watcher liveness（`poll_count` 遞增）可見。
5. 全程 provenance 標記正確、無假 `ready`、無捏造 coverage。
6. （Phase 2）converter 落地後，callback 回填使 record → `ready`、`model.usdc` 角色翻 `parsed`、coverage 為真實值。

## 8. 測試策略

- **單元**：ledger upsert/回填冪等（複用 `idempotencyKeyFor` 既有測試風格）；`deriveIntakeFromKey` 既有覆蓋不回退。
- **整合**：沿用 `minio-watch-intake-integration` / `minio-watch-status-route` 風格，加 ledger 寫入/讀取與 `GET /api/minio/objects` 唯讀 list proxy（fixture bucket）。
- **前端 E2E**：`#minio` / `#conv` 讀視圖（harness 可決定性；真實 list 用 fixture），驗證四段一致、無假 ready；沿用 `e2e/minio-watch-auto-intake.spec.ts` / `e2e/conv-watch-toggle.spec.ts` 模式。
- **誠實守衛**：斷言 converter 未落地時 record 不出現 `ready`、`#minio` 不出現 `parsed` USDC。

## 9. 風險與待確認

1. **ledger 權威歸屬**：須與 `_bim-control`（metadata 權威）對齊——coordinator 只讀、不可變 metadata 權威。實作前確認 ledger 落 metadata 平面 DB（**bim-control · MySQL**，雲端 control-plane metadata 權威）的哪個 owner（governance / control-plane shadow）。
2. **completion 依賴待建 converter**：Phase 2 不可提前宣稱；plan 須把 Phase 1 / Phase 2 明確切開，Phase 1 可獨立交付。
3. **唯讀 list proxy 安全**：擋路徑穿越、presigned 不入 log、唯讀帳號最小權限（沿用 watcher SSRF/presign 紀律）。
4. **`docs/plans` 過度宣稱更正**：本 spec 落地前/同時，`docs/plans` 設計規格的 `#minio`「已交付」與轉檔排程佇列描述須改標「Phase 1 部分可建 / 現況僅偵測」（由 docs 重建一併處理）。

## 10. 後續

- 下一步：`writing-plans` 出 Phase 1 的逐任務實作計畫（bite-sized，含 ledger schema 定稿、`GET /api/minio/objects`、`GET /api/conversion/records`、watcher→ledger 寫入、`#minio`/`#conv` 前端、E2E）。
- 對應 GitHub issue：**[#250](https://github.com/monkey1sai/AI-BIM-governance/issues/250)**（追蹤入口，標題＝「MinIO 轉檔閉環可觀測性」）。
