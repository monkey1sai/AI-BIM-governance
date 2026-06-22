## Why

`minio-watch-auto-intake`（O4）watcher 的 `deriveIntakeFromKey` 寫死「去 prefix/suffix 後恰兩層 `{projectId}/{modelId}`」。2026-06-22 P7 部署驗證對真實 `bim-control` bucket 啟用時暴露：真實雲端結構為多層且專案名為中文——`東勢區許良宇紀念圖書館/root/main/<UUID>/model.ifc`。現行兩層規則一律判 malformed、永不觸發；且中文專案名雖經下游 `sanitizeArtifactIdPart` 已可派工（`mv_<hash8>`，不再 400，conversion-artifact-id-sanitize 已修），卻被降級為不可讀代號、且原名未保留供顯示。本提案把 key 解析改為「≥3 段：專案/種類/版本」並重用既有 sanitize 為安全 project_id、保留中文原名供顯示。

## What Changes

- `deriveIntakeFromKey`：去 prefix/suffix 後規則由「恰兩層」改為「**≥3 段且皆非空、且無純點段（`.`/`..`）**」；第一段=專案、**倒數第二段=種類**、最後一段=版本，中間動態層（專案管理者動態管理）識別時忽略。純點段拒收防 `..` 原樣成為 project_id 的路徑穿越形狀。
- 安全 project_id **重用** `sanitizeArtifactIdPart`（conversion-artifact-id-sanitize 既定契約，單一安全真相）：純英數原樣、含非安全 `${safe}_<hash8>`、全非安全（純中文）`mv_<hash8>`；dispatch 端對已安全值冪等 → watcher 與手動 intake 兩路徑對同一中文名得同一 project_id。
- intake payload 新增 `model_category`（種類）與 `project_display_name`（中文原名，如實顯示）——**additive/optional、`.passthrough()` 相容、只隨 payload 傳遞、不入本地 shadow store**（YAGNI）；完整原始 key 仍由 `last_triggered[].key` 保留供 UI 完整顯示。
- 已知限制：對 raw bytes 直接 hash、不做 Unicode NFC/NFD 正規化（與下游同函式一致）；純漢字 NFC==NFD 穩定，帶重音拉丁/韓文等 NFC≠NFD 來源的同一視覺名稱可能分裂，列已知限制。

## Impact

- Affected specs: `minio-watch-auto-intake`（MODIFIED：key 規約 2 層→≥3 段、安全 project_id、種類/原名 payload 欄位）。
- 跨 spec 調和：`minio-fileserver-source` / `a2-version-diff-selector` 描述 bim-control 為兩層，那是 **governance-service 掃本機 `storage/`（dev fixture 270/889/990）** 的 surface；本 change 改的是 **watcher 讀的真實雲端 bim-control bucket（≥3 段、含動態中間層）** 的 surface——不同來源、不矛盾。
- Affected code: `bim-review-coordinator`（`deriveIntakeFromKey`/`DeriveOk`/intake payload、`ifcReadyPayloadSchema`、`ExternalIfcReadyEvent`）；測試 fixture（`minio-watcher-derive`/`minio-watcher-loop`/`minio-watch-intake-integration`、`web-viewer-sample/e2e/minio-watch-auto-intake`）升級多層。
- 不改 `bim-streaming-server` / MinIO server / viewer；不引入新 production dependency。安全 id 重用既有 `sanitizeArtifactIdPart`，不新增第二套 sanitize 規則。
- userFacing：true（`#conv` MinIO 自動偵測對真實 bucket 觸發，須 P7 部署區 browser E2E 驗收）。
- 風險：key 規約由「恰兩層」反轉為「≥3 段」屬契約變更（既有 2 段 fixture 全升級多層、4 段 malformed fixture 翻轉為真正 <3 段）；全 vitest 套件 431/431 為回歸鎖。
