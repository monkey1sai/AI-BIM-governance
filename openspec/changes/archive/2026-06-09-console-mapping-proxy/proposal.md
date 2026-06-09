## Why

`unified-console-mvp` 把 A1–A10 治理 overlay 接上 live viewer 後，於部署環境跑完整互動 E2E（真 IFC + 真 3D）時，發現「在 3D 標示」恆顯示「無法在 3D 標示（未對映 usd_prim_path）」，即使 `element_mapping.json` 內該 `ifc_guid` 確有有效 `usd_prim_path`（實測 71 筆失敗門中 67 筆有對映）。

根因：viewer 的 `MappingCache` 載入是 `Window._loadElementMapping` **直接 `fetch(mapping_url)`**，而 `mapping_url` 指向 `bim-streaming-server` 轉檔 artifact 端點（`:49101`）。在 hybrid / LAN 部署下 viewer origin（`:5173`）≠ artifact origin（`:49101`），且 artifact 回應**無任何 CORS header**（`Access-Control-Allow-Origin` 缺），瀏覽器跨來源 fetch 直接 `TypeError: Failed to fetch` → `MappingCache` 為空 → 所有 `ifc_guid` 皆判為未對映 → 標示一律誠實降級。USDC 由 Kit-side 載入（不經瀏覽器）故 stage 仍 matched，遮蔽了此前端載入失敗。

這同時違反 `web-viewer-sample` 邊界：**「所有 file URL 查詢一律透過 coordinator」「與 streaming server 的互動限定於 WebRTC video + DataChannel」**（repo-local `CLAUDE.md` / 根 `AGENTS.md §3.5`）。viewer 不得 HTTP 直連 `:49101` 取 artifact。

附帶修復一個 deploy 接線 gap：hybrid `compose.host-kit.yml` 缺 `GOVERNANCE_API_BASE`，dockerized coordinator 的 governance proxy fallback 到 container loopback `127.0.0.1:49102`、連不到 host-native governance-service（`:49102`），使 `for-session` rule-run 回 502。

## What Changes

- **coordinator 新增 1 個 session-scoped element-mapping proxy 端點**：`GET /api/governance/element-mapping/for-session/:sessionId`。解析 `session → artifact binding 的 mapping_url`，取其 path 後經 `config.conversionApiBase`（host 可達的 `host.docker.internal:49101`）server-side 抓取，原樣回傳 JSON。CORS 由 coordinator 既有全域 `cors({ origin: corsOrigins })` 提供。誠實：session/mapping 無法解析回 404、conversion 不可達回 502（重用既有 `proxyConversionService`）。
- **viewer `Window._loadElementMapping` 改走 coordinator proxy**：有 `reviewSessionId` 時經新 `governanceClient.elementMappingForSession(sessionId)`（打 `:8004`）載入；無 session（debug / 本機直開檔）才 fallback 直抓 `mapping_url`。method 簽章 / 回傳 / caller 契約不變；`mapping_url` 仍用於顯示與 Kit `openStageRequest`（Kit-side 載入不變）。
- **`governanceClient` 新增 `elementMappingForSession(sessionId)`**（GET `:8004` proxy）。
- **deploy 接線**：`compose.host-kit.yml` coordinator `environment` 補 `GOVERNANCE_API_BASE: ${HOST_GOVERNANCE_API_BASE:-http://host.docker.internal:49102}`（鏡像既有 `CONVERSION_API_BASE` pattern）。

## Capabilities

### New Capabilities

- None（本 change 為缺陷修復 + 邊界對齊交付，不新增 capability）。

### Modified Capabilities

- `unified-governance-console`：新增一項可驗收 `### Requirement`，固化「viewer 的 `element_mapping` 載入 SHALL 經 coordinator `:8004` proxy（SHALL NOT HTTP 直連 `:49101`），使 3D 標示在 hybrid/LAN 部署可真正解析對映且不違反前端邊界」。不修改既有行為要求。

## Impact

- Owner repo / folder：`bim-review-coordinator/src/app.ts`（新增 1 個 read-resolve + forward 端點，reuse `proxyConversionService`）+ 新增端點測試；`web-viewer-sample/src/Window.tsx`（`_loadElementMapping` 內部換 fetch 來源，行為保持）+ `web-viewer-sample/src/console/governanceClient.ts`（新增 1 個 client method）；`compose.host-kit.yml`（補 1 個非機密服務 URL env）。
- API / data shape：**新增 1 個 coordinator GET 端點**（read-resolve + forward）。`element_mapping` JSON shape、governance-service / `bim-streaming-server` 端點、stream-config data shape **皆不變**。
- Runtime boundary：**回到合規**——viewer 不再 HTTP 直連 `:49101`；file URL 一律經 coordinator `:8004`。3D 著色仍走既有 viewer↔Kit WebRTC DataChannel carve-out。coordinator 僅 resolve + forward，不解讀 / 不保存 mapping，不成為新資料權威。
- Dependencies：**無新增生產依賴**。
- 驗證：`bim-review-coordinator` `npm run verify` 全綠（含新端點測試：解析回傳 mapping / session 不存在 404 / 無 mapping_url 404 / 非法 sessionId 400 / conversion 不可達 502）；`web-viewer-sample` `npm run build`（vite + tsc）0 error。標示成功的完整互動 E2E（A3→失敗構件→**3D 標紅成功**→A8）於 `scripts/deploy.ps1 -Build` 重建後以真 IFC + 真 3D 截圖佐證（保留環境供檢視）。
- Deploy：coordinator 與 viewer 為 docker 服務，端點 / 接線變更需 `scripts/deploy.ps1 -Build` 重建 image（golden path，不新增 root script）。
- Non-goals：不改 `element_mapping` 產出 / shape、不給 `:49101` 直接加 CORS（改走 coordinator proxy 才合邊界）、不做跨版本 MappingCache、不動 governance-service / streaming / Kit。
