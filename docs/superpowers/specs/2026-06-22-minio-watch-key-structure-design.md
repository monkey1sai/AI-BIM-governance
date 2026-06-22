# MinIO Watcher Key 結構解析變更 — Design Spec

- 日期：2026-06-22
- 狀態：Proposed（brainstorming 產出，待使用者複審 → writing-plans）
- 主題：minio-watch-auto-intake 的 key→intake 解析改為符合真實 bucket 結構（多層 + 中文專案名）

## 1. 背景與問題

`minio-watch-auto-intake`（O4）watcher 輪詢 MinIO `bim-control` bucket，對新 `*/model.ifc` 觸發既有 intake 鏈。2026-06-22 P7 部署驗證時浮現兩層問題：

- **Layer 1（已修，另一 commit；部署區已套用並驗證 enable 成功）**：dockerized coordinator 的 compose 未透傳 `MINIO_WATCH_*`，導致 docker 部署無法配置、`PUT /api/conversion/watch` 永遠 422。已於 `compose.runtime-manager.yml` coordinator `environment:` 補透傳（`${VAR:-}` 預設空＝flag-off 零行為變更）。
- **Layer 2（本 spec）**：watcher 的 [`deriveIntakeFromKey`](../../../bim-review-coordinator/src/services/minioWatcher.ts) 寫死「去 prefix/suffix 後**恰 2 層** `projectId/modelId`」。真實 bucket 結構為多層且含中文專案名：
  ```
  東勢區許良宇紀念圖書館/root/main/<UUID>/model.ifc
  ```
  → 現行邏輯一律判 malformed、永不觸發。且即使觸發，中文專案名雖經下游 `sanitizeSafeIdField`→`sanitizeArtifactIdPart` 後**已可派工**（全非安全→`mv_<hash8>`，**不會 400**），卻被降級為**不可讀**代號。本變更目的＝(a) 修正解析使多層結構能觸發、(b) 提供**穩定可讀 + 保留原名顯示**的 project_id（[streamingConversionClient.ts:96-106](../../../bim-review-coordinator/src/services/streamingConversionClient.ts) 為既定 sanitize 契約）。

## 2. 目標

讓 watcher 正確解析真實多層結構並安全送下游，同時 UI 完整呈現原始 MinIO 結構、中文如實顯示。

## 3. 需求（使用者確認）

- **R1**：key 結構規則——必須湊齊三部分：**專案（第一層／頭）、種類（倒數第二層）、版本（最後一層）**。中間層數可變動（專案管理者動態管理），識別時忽略。
- **R2**：湊不齊三部分（去 prefix/suffix 後 < 3 段，或含空段）→ 視為 malformed、誠實跳過（沿用既有 `skip_permanent` 語意，只計一次）。
- **R3**：中文專案名 **如實顯示** 給人看；同時提供下游可用的英數安全 `project_id`。
- **R4**：UI **完整顯示** MinIO 原始結構（整串 key，所有層、中文皆可見）。
- **R5**：內部儲存**不必**照抄完整 MinIO 路徑。種類／專案原名**只隨進件 payload 傳遞**（供下游/UI 取用），**不寫入** coordinator 本地 shadow store（YAGNI，§8）；供顯示的完整原始 key 由既有 watcher status `last_triggered[].key` 保留。版本（`external_model_version_id`）維持既有持久化。
- **R6**：未啟用（`MINIO_WATCH_ENABLED` 未設）時行為與現況完全一致；不碰機密。

## 4. 設計

### 4.1 deriveIntakeFromKey（核心變更）

去 prefix/suffix → `withoutSuffix` → `segments = withoutSuffix.split("/")`（保留既有「不可含空段」雙斜線防護）。

- 合法條件：`segments.length >= 3` 且所有段非空；否則回 `DeriveErr`（reason：未湊齊 專案/種類/版本 三段）。
- `projectRaw = segments[0]`
- `category = segments[segments.length - 2]`
- `version  = segments[segments.length - 1]`
- 中間 `segments[1 .. length-3]`：忽略（不參與識別，但保留在原始 key 供顯示）。

`DeriveOk` 介面擴充為：
```ts
{ ok: true;
  projectId: string;            // 安全代號（見 4.2）
  projectDisplayName: string;   // = projectRaw（中文原名，如實保留）
  category: string;             // 種類，原樣（英數安全）
  externalModelVersionId: string; // = version（UUID，原樣）
  sourceEtagFrom: (etag: string) => string; }
```

### 4.2 安全 project_id 導出（直接重用 sanitizeArtifactIdPart，不自造方案）

`project_id = sanitizeArtifactIdPart(projectRaw)`——重用下游既有函式為**單一安全真相**：
- 純英數安全（如 `899`）→ 原樣。
- 含非安全（中文）→ `${safe}_${sha256[:8]}`；全非安全（純中文）→ `mv_${sha256[:8]}`（[streamingConversionClient.ts:96-106](../../../bim-review-coordinator/src/services/streamingConversionClient.ts) 既定契約）。

- **跨路徑一致**：dispatch 端 `toInternalIfcReadyEvent` 對 project_id 再跑一次 `sanitizeArtifactIdPart`（streamingConversionClient.ts:145），對已安全值**冪等**；故 watcher 自動路徑與手動 intake 路徑對同一中文名得到**同一 project_id**（不再分裂成兩套代號）。
- **確定性**：同名→同代號（sha256 確定性）。
- **已知限制（NFC/NFD）**：對 raw bytes 直接 hash、不做 Unicode 正規化（與下游同函式一致、不單方正規化）；純漢字 NFC==NFD 穩定，但帶重音拉丁/韓文等 NFC≠NFD 來源的同一視覺名稱可能分裂。實務上傳端以純漢字為主，列為已知限制。
- **路徑安全**：`deriveIntakeFromKey` 對 segment 除「空段」外，額外拒收純點段 `.` / `..`（dots 在 `SAFE_ID_RE` 內、sanitize 不會擋），防 `..` 原樣成為 project_id 的路徑穿越形狀。

### 4.3 intake payload（minioWatcher → `POST /api/external/ifc-ready`）

- `project_id` = `derived.projectId`（安全代號）
- `external_model_version_id` = `derived.externalModelVersionId`（版本 UUID）
- 新增 `model_category` = `derived.category`（種類）
- 新增 `project_display_name` = `derived.projectDisplayName`（中文原名，供顯示／對帳）
- `external_conversion_task_id`、`source_ifc`、`requested_outputs` 等不變
- 原始 object key 仍由 watcher status `last_triggered[].key` 與 ifc-ready 紀錄保留（完整結構、含中文）

> 新增欄位採 **additive／optional**。實作前須確認 `POST /api/external/ifc-ready` 與 `externalIfcReadyStore` 對未知欄位寬容（非 strict-reject）；若 strict，同步放寬接受這兩個 optional 欄位。`model_category` 是否透傳至 dispatch（streamingConversionClient）由實作評估，沿用既有 sanitize；最小範圍下可僅停在 coordinator intake 層。

### 4.4 UI（`#/conv` MinIO 自動偵測面板）

- 「最近觸發」表已顯示完整 object key（含中文與所有層）→ 直接滿足 R4；確認並保留此顯示。
- （加值，可列 follow-up）將 key 拆成「專案／種類／版本」三欄對照顯示，輔助理解；若超出最小範圍則不在本次強制範圍。

## 5. 相容性與行為變更

- 舊「2 層」key（如 `899/v1/model.ifc`）在新規則下未湊滿三段 → 變 malformed。屬**刻意契約變更**（真實資料皆 ≥3 層）。既有測試 / fixtures 同步升級為符合新規則的多層案例。
- `openspec/specs/minio-watch-auto-intake/spec.md` 的 key 規約段（「恰兩層 projectId/modelId」「{projectId}/{modelId}/model.ifc」）改寫為「≥3 段：專案/…(可變動)…/種類/版本」。
- flag-off（未啟用）行為不變；不碰機密；無新增 production 依賴。
- **跨 spec 調和**：`minio-fileserver-source` / `a2-version-diff-selector` 描述 bim-control 為兩層（`{projectId}/{modelId}`），那是 **governance-service 掃本機 `storage/`（dev fixture：270/889/990）** 的 surface；本 spec 改的是 **watcher 讀的真實雲端 bim-control bucket（≥3 段、含動態中間層）** 的 surface——兩者不同來源、不矛盾。spec delta 內須加一句明示區分，避免兩條 live spec 對同名 bucket 各說各話。
- **OpenSpec provenance**：本變更含 production code 行為變更，MUST 走 active change（`openspec/changes/minio-watch-key-structure/` 寫 `## MODIFIED Requirements` delta），不直接手改 live `specs/`；否則 pull-request-review-agent 判 blocked（見 plan Task 0）。

## 6. 受影響檔案

- `bim-review-coordinator/src/services/minioWatcher.ts`（`deriveIntakeFromKey`、`DeriveOk`、payload、status 顯示）
- `bim-review-coordinator/src/services/streamingConversionClient.ts`（若 dispatch 帶 `model_category`；sanitize 既有）
- `bim-review-coordinator/src/services/externalIfcReadyStore.ts` / `src/app.ts`（若 intake schema 需接受新 optional 欄位）
- 測試：`bim-review-coordinator/tests/*`（deriveIntakeFromKey 相關）、`web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`（fixture key 升級）
- `openspec/specs/minio-watch-auto-intake/spec.md`（key 規約段）
- `docs/evidence/minio-watch-auto-intake/`（P7 以真實多層結構重新取證）

## 7. 測試策略（TDD：先紅後綠）

- **單元 `deriveIntakeFromKey`**
  - 4 層真實結構（含中文）→ ok：`projectId`=安全代號、`category`=`main`、`version`=UUID、`projectDisplayName`=中文。
  - 3 層 → ok（無中間動態層）。
  - 2 層 / 1 層 → malformed。
  - 含空段（雙斜線 `a//b/c`）→ malformed（沿用既有防護）。
  - 英數專案名（`899/main/v1`）→ `projectId` 原樣 `899`。
  - 中文確定性：同名兩次 → 同 `projectId`。
- **整合 / E2E**：fixtures 升級為多層 key；watcher 觸發 → ifc-ready job 帶安全 `project_id` + `model_category`；status `last_triggered` 顯示完整 key。
- **P7（部署區，真 MinIO）**：對 `bim-control` 丟一個多層新 key（如 `<新專案>/root/main/<新UUID>/model.ifc` 或覆蓋既有換 etag）→ 觸發 +1、ifc-ready 出現 job、`#/conv` 顯示完整結構；截圖落 `docs/evidence`。

## 8. 不在範圍（YAGNI）

- 種類在轉檔／儲存的進一步語意用途（分類統計、依種類派工等）——本次只「捕獲並傳遞」。
- 完整 IFC→USDC 轉檔完成驗證（需 host-native GPU；P7 以 dispatched/queued 級為 vertical slice 目標，沿用既有 evidence 取捨）。
- 專案名↔代號的人工對照表（使用者確認無對照表，採自動安全代號）。
