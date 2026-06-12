# minio-watch-auto-intake — E2E Evidence

- 文件性質：working note（驗收證據；非 contract / 非 runbook）。與實作衝突時以程式碼與 `openspec/specs/` 為準。
- 設計 / plan：`docs/superpowers/plans/2026-06-12-minio-watch-auto-intake.md`（O4 觸發機制 B 案：輪詢 ListObjectsV2；
  plan 內以 spec §3 / §4.1 / §7 inline 載明設計，本 branch 無獨立 `*-design.md` 檔，design 權威即此 plan）。
- E2E spec：`web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`

## 驗收標記（誠實鐵律）

- **STUB MINIO**：本機 fake S3 stub（http server 回 ListObjectsV2 XML），非真 192.168.20.234:9000。
  presigned GET URL 由 AWS SDK 簽出（指向 stub）。
- **STUB CONVERSION API**：stub 回 202 queued；job 進 dispatched/queued 級即達 vertical slice 目標
  （真 IFC→USDC 需 host-native GPU runtime，不在本機 E2E）。
- **vertical slice**：UI route `#/conv` → useEffect 自動 load → 真 coordinator
  `GET /api/external/ifc-ready` + `GET /api/external/minio-watch/status` → watcher 自動建立的 988 job
  + Panel triggered≥1。**全程不碰任何按鈕**（M2 DoD 前半「自動觸發」語意）。
- **UI 層直接斷言（非僅後端對帳）**：除了後端 `triggered_total≥1`、`ifc-ready` 出現 988 之外，spec 另在
  瀏覽器 DOM 直接斷言（1）MinIO 自動偵測 Panel 的「baseline / seen / 觸發 / 跳過」Field 第 3 槽（觸發）
  為非零整數（triggered≥1 由 UI 呈現驗證）；（2）Ifc-ready jobs 表 988 列的 conversion 欄顯示
  `queued`（job 達 dispatched/queued 級由 UI 呈現驗證）。
- **conditional-skip 限制**：dist-ui 未 build → test.skip（Playwright skip != fail）。本 repo 無 Playwright
  CI job，故不 false-green 任何 gate；屬本機 / 指揮官手動 gate。

## P7 部署區驗證（real MinIO）

- 對真 MinIO（192.168.20.234:9000，唯讀 credentials 由使用者提供入 env）開 `MINIO_WATCH_ENABLED=true`
  觀察 baseline 正常、`#/conv` Panel 顯示真 bucket/last_poll；真新檔觸發視使用者丟檔配合。
- **狀態：not observed**（待 P7 由指揮官提供 credentials + 丟檔配合後補實測截圖）。

## 觀察到的真實狀態（誠實鐵律）

本機實跑一次（2026-06-12）：`cd web-viewer-sample && npm run build:ui` 產出 `dist-ui/index.html` 後，
`npx playwright test e2e/minio-watch-auto-intake.spec.ts` → **1 passed (13.8s)、0 skipped**。觀察到：

- coordinator 以 `MINIO_WATCH_ENABLED=true` + 本機 fake S3 stub（interval 1s）自起於 OS 配的 free port。
- baseline 物件（`899/baseline/model.ifc`）僅登 seen 不觸發；測試 poll `minio-watch/status` 得 `baseline_count=1`。
- 注入 `988/auto/model.ifc` 後下一輪 watcher 自動 intake：`ifc-ready?limit=50` 出現 `project_id="988"` 的 job、
  `minio-watch/status` 的 `triggered_total>=1`（全程未碰任何按鈕）。
- 前端 `#/conv`（coordinator 同源 `/ui`）：`minio-watch-panel` 顯示「啟用中」，且「baseline / seen / 觸發 / 跳過」
  Field 實測渲染 `1 / 2 / 1 / 0`（觸發=1，UI 直接斷言為非零）；`Ifc-ready jobs` 表 988 列 conversion 欄
  實測渲染 `queued`（UI 直接斷言）。
- 截圖落 `artifacts/e2e/minio-watch-auto-intake-conv.png`（fullPage，~150 KB），三個 Panel（Pipeline /
  MinIO 自動偵測 / Ifc-ready jobs）皆渲染。

## 截圖

- `artifacts/e2e/minio-watch-auto-intake-conv.png`（gitignored artifacts 區；本檔記錄產生路徑與內容）。
