# 中文 model_version_id 轉檔派工修復（artifact_id sanitize + dispatch_error 可見）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > wiki；與實作衝突時以實作程式碼與 `openspec/specs/` capability spec 為準。
- 日期：2026-06-11
- 對應 issue：#205（bug: 中文 external_model_version_id 使 conversion 派工 400）
- Phase 對應：M2 轉檔管線（真 MinIO intake → conversion dispatch 主鏈路修復）
- userFacing：true（`#/conv` 頁 dispatch_error 明細）

## 1. 背景與問題（2026-06-11 測試區實測，issue #205）

真實 MinIO（192.168.20.234:9001）intake 一筆 ifc-ready job（`ifcready_1781147610370_e232cfed`，project 271，`external_model_version_id="271_pieple_管線"`）：IFC **下載成功**，但派工失敗：

```
dispatch_error = streaming conversion API 400: {"detail":"Invalid ifc_artifact_id: ifc_271_pieple_管線"}
```

Root cause（已實證）：

1. `bim-review-coordinator/src/services/streamingConversionClient.ts:112` 直接組 `artifact_id = "ifc_" + binding.externalModelVersionId`，未 sanitize。
2. conversion authority 驗證 `SAFE_ID_RE = ^[A-Za-z0-9_.-]+$`（`bim-streaming-server/.../messaging/conversion_authority.py:10`、`_safe_id` L712 fullmatch）→ 中文字元失敗 → 400 → job 標 `dispatch_failed`。

本專案資料即中文命名（機電/水電/消防），凡外部系統帶中文 model_version_id 必踩。另一個使用者實際痛點：`#/conv` 的 Ifc-ready jobs 表只顯示狀態字 `dispatch_failed`，**看不到 dispatch_error 原因**（本次得靠 API 才知道是 400 invalid id）。

## 2. 目標（成功標準）

1. 中文（任何非 safe 字元）的 `external_model_version_id` 不再導致 dispatch 400：coordinator 組出的 `ifc_artifact_id` 永遠通過 conversion 端 `SAFE_ID_RE`。
2. sanitize 具確定性（同一 external id 永遠映出同一 artifact_id）且不碰撞（不同 external id 不會映到同一 artifact_id）。
3. 純 safe 字元的既有 id **輸出不變**（向後相容：英文 id 的 artifact_id 與現行完全相同，不影響既有對帳/etag 慣例）。
4. `#/conv` Ifc-ready jobs 表可見 `dispatch_error` 明細（有錯才顯示；無錯不佔版面），operator 不需打 API 即可知道派工失敗原因。

## 3. 非目標（明確不做）

- 不放寬 conversion 端 `SAFE_ID_RE`（id 會進檔案路徑 / USD 層命名，放寬有路徑安全與相容風險；修在 coordinator 端）。
- 不做 dispatch_failed 的重派端點 / UI 重試按鈕（types.ts 註明屬 T4/T5 backlog；issue #205 已記）。
- 不動 conversion authority、不動 download / binding / callback 流程。
- 不改 `external_model_version_id` 本身的儲存與顯示（外部 id 原樣保留於 job / binding / callback 對帳）。

## 4. 設計

### 4.1 coordinator：artifact_id sanitize（streamingConversionClient.ts）

新增純函式 `sanitizeArtifactIdPart(raw: string): string`（放同檔或 utils，與既有模式一致）：

- 規則：`safe = raw.replace(/[^A-Za-z0-9_.-]/g, "")`。
  - 若 `safe === raw` → 回傳 `raw`（**零行為變化**，既有英文 id 不變）。
  - 否則 → 回傳 `${safe}_${sha256hex(raw).slice(0, 8)}`（Node 內建 `crypto`，不加依賴）。`safe` 為空字串時退化為 `mv_${sha256hex(raw).slice(0, 8)}`（全中文 id 也有可讀前綴）。
- 呼叫處：L112 改為 `artifact_id: \`ifc_${sanitizeArtifactIdPart(binding.externalModelVersionId)}\``。
- 確定性：同一 raw → 同一輸出（無時鐘/亂數）；唯一性：hash 後綴繫結原始 raw，不同 raw 同 safe 前綴也不碰撞（8 hex ≈ 43 億空間，內部 correlation 用途足夠）。
- 例：`271_pieple_管線` → `ifc_271_pieple__a1b2c3d4`（雙底線為移除中文後的相鄰殘留，可接受；不做額外壓縮以保規則簡單）。

### 4.2 EdgeConsole：`#/conv` 顯示 dispatch_error

- `ConversionSchedulingPage`（`web-viewer-sample/src/console/pages.tsx`）的 Ifc-ready jobs 表：
  - `IfcReadyListItem` 型別（coordinator API 已回 `dispatch_error` 欄位）補欄位定義（前端 client 型別檔）。
  - job 列有 `dispatch_error` 時，於該列下方（或狀態欄附註）顯示截斷後的錯誤明細（完整字串 title/tooltip），樣式沿用既有 `ec-warn-note` 類錯誤文案；無錯誤時不渲染。
- 誠實標記：錯誤顯示為真實 backend 欄位，無 mock。

### 4.3 資料流（一句話版）

外部 intake（POST `/api/external/ifc-ready`，含中文 model_version_id）→ coordinator 下載 → dispatch 時 `ifc_${sanitize(...)}` → conversion API `SAFE_ID_RE` 通過 → 202 dispatched；`#/conv` 列表任何 `dispatch_error` 都可見明細。

## 5. 錯誤處理

| 情境 | 行為 |
|---|---|
| external id 全為 safe 字元 | artifact_id 與現行輸出完全一致（回歸零影響） |
| external id 含任何非 safe 字元 | safe 前綴 + sha256 前 8 碼，通過 SAFE_ID_RE |
| external id 全為非 safe 字元 | `mv_<hash8>` 前綴退化形 |
| conversion API 其他 4xx/5xx | 既有 dispatch_failed 路徑不變，但 UI 現在可見 dispatch_error 明細 |

## 6. 測試與驗收

1. **coordinator 單元測試**（vitest，照 `streamingConversionClient` / dispatch 既有測試模式）：
   - 中文 id `271_pieple_管線` → artifact_id match `^ifc_[A-Za-z0-9_.-]+$` 且含 `271_pieple_` 前綴與 8 hex 後綴。
   - 純英文 id → 輸出與舊版完全相同（鎖回歸）。
   - 同 id 兩次呼叫輸出相同（確定性）；兩個不同中文 id 輸出不同（防碰撞抽樣）。
   - 全非 safe 字元 id → `ifc_mv_<hash8>`。
   - dispatch 整合測試：stub conversion API 以 `SAFE_ID_RE` 同規則驗 artifact_id，中文 model_version_id 的 dispatch 不再 400。
2. **前端 vitest**（`console.test.tsx` 既有模式）：列表含 `dispatch_error` 的 job render 出錯誤明細；無 `dispatch_error` 的 job 不渲染錯誤節點。
3. **Browser E2E（Playwright）**：隔離 stack 起 coordinator（stub 或真 conversion API 依 plan 細化）→ POST `/api/external/ifc-ready` 帶中文 `external_model_version_id`（ref 走可控的本機 HTTP 來源，比照既有 external-ifc-ready 測試 fixture 模式）→ `#/conv` 看到該 job 進入非 dispatch_failed 狀態（dispatched/queued 級）；另造一筆必失敗 job 驗 `dispatch_error` 明細可見。截圖 + summary 落 `artifacts/e2e/conversion-artifact-id-sanitize-*` 與 tracked `docs/evidence/conversion-artifact-id-sanitize/`。
4. **驗收基準**：上述全綠 + 四項回報；issue #205 可關聯（PR body 註 `Fixes #205` 的 sanitize 部分；重派功能不在本輪，issue 留註記或拆 follow-up）。

## 7. 風險與緩解

- **既有 artifact_id 對帳**：sanitize 對純 safe id 零變化，僅新（含中文）id 走新形 — 無既有資料遷移問題（dispatch_failed job 為 in-memory，重啟即清）。
- **E2E 的 conversion API 依賴**：真 conversion API（:8010）在隔離 stack 較重；plan 可選 stub server 以同一 `SAFE_ID_RE` 規則驗收（單元/整合層已真規則鎖死），browser E2E 聚焦 UI 可操作與 dispatch_error 可見性。stub 處 evidence 須誠實標註 stub。
- **雙底線殘留可讀性**：`271_pieple__a1b2c3d4` 雙底線屬規則簡單性的取捨，不影響功能。
