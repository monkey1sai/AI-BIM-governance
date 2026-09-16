# Session 身分顯示重設計（session-identity-display）— Design

**Status**：approved（owner 2026-09-16 選方案 B，並加入 A1 治理檢核頁「審查模型」與「既有審查」兩個下拉）。

**問題**：console 各處把 review session 顯示成 `review_session_request_3bcaceaf…` 這種 id，加上 `project_id` 常是 `mv_6c51d572` hash、`model_version_id` 是 UUID，operator 看不出「這是 MinIO 哪個專案、哪個種類、什麼時候建的、誰建的」。A1 頁「審查模型」下拉更以「檔名未提供」開頭（181 上 17 筆 ledger 有 16 筆 `object_key` 為 null），「既有審查」下拉只顯示「審查 1 · 進行中 · <長 id>」。

**唯一忠實源**：coordinator 已持有全部所需資料，只是沒在 `GET /api/runtime/status` 透出：

| 資料 | 現在在哪 | join key |
|---|---|---|
| `project_display_name`（中文原名）、`category`、`object_key`、`bucket`、`detected_at`、`correlation_id` | `ConversionLedger.get(readyModelId)` | `session.ready_model_id === record.idempotency_key` |
| `intake_source`（`minio_watch` / `external`）、`source_ifc_ref`（完整 MinIO URL，含舊紀錄缺的 key） | `ExternalIfcReadyStore.list()` | `job.idempotency_key === session.ready_model_id`（fallback `job.review_session_id === session.session_id`） |
| `created_by`、`recreated_from_session_id`、`artifact_bindings[].source_ifc_filename` | `ReviewSession`（store） | 本身 |

## 1. 後端（PR-1）：`runtimeSessionSummary.origin`

`bim-review-coordinator/src/runtimeStatus.ts` 的 `summarizeSessionForRuntime` 新增 **必填** `origin` 區塊；contract `src/contract/schemas/runtime.ts` 同步：

```ts
origin: z.strictObject({
  kind: z.enum(["auto_conversion_ready", "console_request", "recreated", "api_explicit"]),
  created_by: z.string(),
  intake_source: z.enum(["minio_watch", "external"]).nullable(),
  project_display_name: z.string().nullable(),
  category: z.string().nullable(),
  bucket: z.string().nullable(),
  source_object_key: z.string().nullable(),
  source_ifc_filename: z.string().nullable(),
  recreated_from_session_id: z.string().nullable(),
  ledger_detected_at: isoTimestamp.nullable(),
})
```

`kind` 由 server-owned 事實推導，**不得**用 `session_id` 前綴猜：

1. `session.recreated_from_session_id` 有值 → `recreated`
2. `created_by === "coordinator-auto-conversion-ready"` → `auto_conversion_ready`（`intake_source` 區分 MinIO watch 自動／外部進件自動）
3. `created_by === "coordinator-ready-review-request"` → `console_request`（A1「建立新的審查」）
4. 其他（`POST /api/review-sessions` 明確 caller，`created_by` 為呼叫者字串）→ `api_explicit`

欄位來源與誠實 fallback：

- `project_display_name` / `category` / `bucket` / `ledger_detected_at`：ledger record；查無 → `null`。`category` 空字串視為 `null`。
- `source_object_key`：`record.object_key`；為 null 或空字串時由對應 ifc-ready job 的 `source_ifc_ref` 以既有 `minioObjectKeyFromSourceRef(ref, bucket)` 還原，bucket 取 `record.bucket`，否則 `config.minioWatchBucket`（bucket 閂門：ref 不落在該 bucket 底下，如 dev register、雲端 presigned、virtual-host 形狀，一律 `null`，不捏造）。兩者皆無 → `null`。`bucket` 在由 ref 還原時取閂門用的 bucket。
- ledger 不可用（`ConversionLedger.get` throw）時 `origin` 的 ledger 欄位降級為 `null`，`runtime/status` 不得因此變 500。
- `source_ifc_filename`：`source_object_key` 的最後一段；否則 `artifact_bindings` 中第一個非空 `source_ifc_filename`；否則 `null`。
- `intake_source`：對應 ifc-ready job 的 `intake_source`；job 缺欄位（#809 前）或查無 job → `null`。

`buildRuntimeStatus` 的 `RuntimeStatusInput` 新增 optional `conversionRecordByReadyModelId?: (readyModelId: string) => ConversionLedgerRecord | null`；`app.ts` 的 `GET /api/runtime/status` 傳入 `(id) => conversionLedger.get(id)`。ifc-ready jobs 已在 input，於函式內建立 `idempotency_key → job` 與 `review_session_id → job` 索引各一次（O(n)），不在 session 迴圈裡重掃。

**不改**：`sessions.count / active_count / participant_count`、既有欄位語意、任何寫入路徑、`/api/review-sessions/*` 契約。

測試（`bim-review-coordinator`，vitest）：

- 新檔 `tests/runtime-status-session-origin.test.ts`：直接呼叫 `buildRuntimeStatus`，覆蓋四種 `kind`、ledger 命中／未命中、`object_key` null 時由 `source_ifc_ref` 解出 key 與 filename、`source_ifc_ref` 非法時為 null、`intake_source` 缺欄位為 null、`category` 空字串為 null。
- 既有以 `stage_open_evidence` 或 `/api/runtime/status` 為斷言的測試（`tests/sessions.test.ts`、`ready-model-session.test.ts`、`minio-source-object-key.test.ts` 等）跑綠；contract 為 `strictObject`，response validation 會抓漏欄。
- `npm test`、`npm run build`（cwd `bim-review-coordinator`）。

## 2. 前端（PR-2）：共用 `SessionIdentity`

### 2.1 純函式 `web-viewer-sample/src/console/sessionIdentity.ts`

- `sessionTitle(s)`：`${project_display_name ?? project_id} · ${category ?? "種類未取得"} · 版本 ${shortVersion(model_version_id)}`。
- `shortVersion(v)`：UUID 形狀取前 8 碼；其餘（`v1`）原樣。
- `sessionOriginLabel(s, lang)`：`auto_conversion_ready`＋`minio_watch` → 「MinIO 自動」；＋`external` → 「外部進件自動」；＋null → 「轉檔完成自動」；`console_request` → 「Console 建立」；`recreated` → 「重建自 <來源 id 後 6 碼>」；`api_explicit` → 「API 建立（created_by）」。
- `formatCreated(iso, now)`：`MM-DD HH:mm · N 分鐘前／N 小時前／N 天前`（本地時區）。
- `sessionOptionLabel(s)`：單行版本供 `<option>`：`${formatCreated} · ${originLabel} · 參與 ${participant_count} · ${status 中文} · …${session_id 後 6 碼}`。
- `modelOptionLabel(record)`：A1「審查模型」用：`${category || "種類未取得"} · 版本 ${shortVersion(external_model_version_id)} · 轉檔 ${MM-DD}`；有 `object_key` 時前綴檔名。**不再**以「檔名未提供」開頭。
- 全部純函式、無 React、無 I/O；`sessionIdentity.test.ts` 覆蓋每個 fallback。

### 2.2 元件 `SessionIdentity.tsx`

三行：主標（`sessionTitle`）／識別列（mono `session_id`＋複製鈕，`data-testid="session-id"`）／狀態列（來源 chip、`formatCreated`、狀態 chip（`created` 顯「尚未啟動」）、參與者數）。`compact` prop 只出主標＋狀態列。樣式沿用 `--ab-*` token 與 `.ec-prov` chip，不新增 CSS 檔。

### 2.3 頁面套用

| 頁面 | 變更 |
|---|---|
| `#pipeline` 3D Handoff（`unified/PipelinePage.tsx`） | 卡片內容改 `SessionIdentity`；只列 active（PR #854）；依 `created_at` 新到舊；最多 5 張，超過顯「還有 N 個 → #sessions」。`data-uc="handoff-link"` / `handoff-count` / `handoff-none` 保留。 |
| `#sessions` Active sessions（`pages.tsx` SessionManagementPage） | 9 欄表改 4 欄：身分（`SessionIdentity`）／狀態與來源／證據（首幀・心跳・stage 合併一格，沿用 `ev-first-frame` 等 testid）／動作。表上加狀態 filter chip（active／created／closing，預設全選），legend 計數跟著 filter。`session-row-<id>`、`session-terminate-<id>` 等 testid 不變。 |
| A1「審查模型」（`ReadyReviewSessions.tsx`） | `<optgroup label={project_display_name}>` 依專案分組，組內依 `detected_at` 新到舊；option 用 `modelOptionLabel`。「準備開啟的模型」面板：有 `object_key` 顯完整 key；否則顯「MinIO 路徑未持久化（舊轉檔紀錄）」而非「來源檔名未提供」。 |
| A1「既有審查」 | option 用 `sessionOptionLabel`，依 `created_at` 新到舊；選定後在下拉下方以 `SessionIdentity compact` 顯示所選 session。 |
| A4 語意查詢 session 下拉（`A4SemanticSearchPage.tsx`） | option 用 `sessionOptionLabel`。 |
| KG 機隊即時 session 清單（`pages.tsx` KitGpuFleetPage） | 連結文字改 `sessionTitle`＋id 後 6 碼。 |

### 2.4 誠實規則

- 任一 `origin` 欄位為 null → 顯「未取得」類文字，不留空白、不用 id 拼湊假名稱。
- 舊 session（後端部署前建立）在新後端下 `origin` 仍由 store 事實推導，無需資料遷移；只有 ledger 已被覆寫的極舊紀錄會出現「種類未取得」。
- 不改任何 API 呼叫時序、不新增輪詢、不新增依賴。

測試（`web-viewer-sample`）：`sessionIdentity.test.ts`（純函式）；`pipelineLiveBinding.test.tsx`、`SessionManagementPage.test.tsx`、`ReadyReviewSessions.test.tsx` 更新標籤斷言；`contractFixtures.ts` 的 `runtimeSessionSummary` builder 補 `origin` 預設；E2E `unified-console-runtime-truth.spec.ts`、`sessions-terminate.spec.ts`、A1 相關 spec 依 testid 不變原則只改文字斷言；`npx vitest run`、`npx tsc --noEmit -p .`、`npm run build`。

## 3. 交付順序與驗證

1. PR-1（本 worktree `feat/session-origin-runtime-contract`）：後端 `origin`＋contract＋tests＋本 spec。合併後部署 181，`GET /api/runtime/status` 抽查三筆（MinIO 自動、Console 建立、closed 舊紀錄）確認 `origin` 值與 ledger 一致。
2. PR-2（`feat/session-identity-display`，PR-1 合併後開）：前端 2.1–2.3。合併部署後真站驗證 `#pipeline`、`#sessions`、`#a1` 兩個下拉、`#a4`。
3. 兩個 PR 各自走 `.github/PULL_REQUEST_TEMPLATE.md` 七段；CI `pr-safety`＋owner exact-head Approve。

## 4. Out of scope

- 不新增端點、不改 session 建立／關閉流程、不改 ledger schema、不做 session 命名（人工命名另案）。
- `ready_review_source` 快照、`review_request_fingerprint` 不透出（非顯示需求）。
- 3D 工作區（`WorkspacePage`）目前不列 session，本案不動。
