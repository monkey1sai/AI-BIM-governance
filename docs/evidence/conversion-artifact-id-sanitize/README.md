# Evidence — conversion-artifact-id-sanitize（中文 model_version_id 派工修復 + dispatch_error 可見）

對應 spec：`docs/superpowers/specs/2026-06-11-conversion-artifact-id-sanitize-design.md`
對應 issue：#205

## 模式決策（誠實鐵律）

採 **(B) STUB CONVERSION API**。

- 真 conversion API（:8010 / streaming）需 host-native GPU runtime、太重，不在本機 browser E2E 起。
- 本 E2E 起一個與 conversion 端 `SAFE_ID_RE`（`/^[A-Za-z0-9_.-]+$/`）**逐字同款規則**的 Node `http` stub
  conversion server（spec §7 允許），由本 spec 自起一台「本 branch 碼」的 coordinator（`tsx src/index.ts`），
  其 `STREAMING_CONVERSION_API_BASE` 指向該 stub。
- 真規則（`SAFE_ID_RE`）已在**單元/整合層**鎖死：
  `bim-review-coordinator/tests/external-ifc-ready.test.ts` 的
  「中文 external_model_version_id 的 dispatch 不再被 conversion 端 SAFE_ID_RE 擋成 400」
  以逐字同款規則驗 `ifc_artifact.artifact_id`。本 E2E 只負責 user-facing vertical slice
  （前端可操作 + 證據可見），不取代單元/整合層的真規則驗收。
- 故本目錄截圖與 evidence 標 **STUB CONVERSION API**。

## Run 方式

前置：

```bash
# 1. build 本 branch 的 console dist-ui（coordinator /ui 服務的就是它）
cd web-viewer-sample && npm run build:ui
```

跑 E2E：

```bash
cd web-viewer-sample && npm run test:e2e -- conversion-artifact-id-sanitize.spec.ts
```

本 spec 完全自包：在 `beforeAll` 內自起 (a) stub conversion server、(b) stub IFC source server、
(c) 一台本 branch 碼的 coordinator（OS 配的 free port，避免撞既有 :8004 docker coordinator），
coordinator 以 `CONSOLE_DIST_DIR=web-viewer-sample/dist-ui` 同源服務 `/ui`，前端 `coordinatorClient`
走 same-origin → 全程打到本 stub 化的 coordinator。`CONVERSION_POLL_ENABLED=false`（dispatch 終態即 assert）、
`IFC_DOWNLOAD_STRICT=false`（stub source 同步下載成功）。

> 註：playwright 仍會 auto-start :5180 viewer，但本 spec 全程 `page.goto` 到自起的 coordinator `/ui`，
> :5180 與本 spec 無關。若 dist-ui 未 build，`beforeAll` 會 `test.skip`（誠實：環境未對齊不假裝跑過）。

## 觀察到的真實狀態（誠實鐵律）

本機實跑一次（2026-06-11），coordinator 自起於 free port（log 顯示 `listening on http://127.0.0.1:62017`），
測試 **1 passed**。觀察到：

- POST 中文 `external_model_version_id = "271_pieple_管線"` 的 ifc-ready → 回 **202**，job id `ifcready_*`。
  該 job 走到 **`dispatched`**（`dispatch_error` 為 `null`）。
  → 中文 id 經 coordinator `sanitizeArtifactIdPart` 後 `ifc_artifact.artifact_id` 為 safe，
    stub conversion 端（真 `SAFE_ID_RE`）不再回 400，dispatch **不再 `dispatch_failed`**。
- POST 必失敗 job（`external_model_version_id = "forcefail_demo"`，stub 對含 `forcefail` 的 artifact_id 強制回 400）
  → job 走到 **`dispatch_failed`**，`dispatch_error` 帶完整錯誤字串（含 `400` 與 stub detail）。
- 前端 `#/conv`（IFC→USD 轉檔排程）→ 按 **Refresh queue** → 「Ifc-ready jobs」表渲染兩筆：
  - 中文 id job：conversion 欄為 `queued`，**無** `conv-dispatch-error-<jobId>` 節點。
  - forcefail job：dispatch 欄出現 `conv-dispatch-error-<jobId>` 節點，`title` 屬性含完整錯誤字串（`400`）。

> 未觀察到的不寫成功：本輪**未**起真 conversion API（:8010）、**未**做真 IFC→USDC 轉檔、
> **未**驗 Kit / WebRTC 視覺；conversion 為 STUB。dispatch_failed job 的重派/重試端點不在本輪（spec §3 非目標）。

## 截圖清單

| 檔名 | 內容 |
|---|---|
| `conv-list.png` | `#/conv`「Ifc-ready jobs」列表：中文 id job（非 dispatch_failed）＋ forcefail job 的 dispatch_error 明細（STUB CONVERSION API） |

（同一張另存於 repo 根 `artifacts/e2e/conversion-artifact-id-sanitize-conv.png`，本 tracked 目錄保留一份。）
