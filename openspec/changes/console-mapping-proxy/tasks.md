## 1. coordinator：element-mapping session-scoped proxy

- [x] 1.1 `bim-review-coordinator/src/app.ts` 新增 `GET /api/governance/element-mapping/for-session/:sessionId`：`isSafeSessionId` 守門（非法 → 400）；`store.get(sessionId)` 不存在 → 404；session `artifact_bindings` 無 `mapping_url` → 404；解析 `mapping_url` 取 `pathname+search`，經 `proxyConversionService(response, config.conversionApiBase, "GET", path)` server-side 抓取並原樣回傳。
- [x] 1.2 新增 `bim-review-coordinator/tests/element-mapping-for-session.test.ts`：解析回傳 mapping（200 + JSON）/ session 不存在（404）/ 無 mapping_url binding（404）/ 非法 sessionId（400）/ conversion 不可達（502）。
- [x] 1.3 `npm run verify`（build + 全測試）綠（284 tests）。

## 2. viewer：MappingCache 載入改走 coordinator proxy

- [x] 2.1 `web-viewer-sample/src/console/governanceClient.ts` 新增 `elementMappingForSession(sessionId)` → GET `/api/governance/element-mapping/for-session/:sessionId`（打 `COORD_BASE` `:8004`）。
- [x] 2.2 `web-viewer-sample/src/Window.tsx` `_loadElementMapping`：有 `this.state.reviewSessionId` 時用 `governanceClient.elementMappingForSession` 取 payload；無 session 才 fallback 直接 `fetch(mapping_url)`。其餘（`isElementMappingDocument` 驗證、`MappingCache.fromDocument`、fake 拒絕、state set）不變。
- [x] 2.3 `npm run build`（vite）+ `tsc --noEmit` 0 error。

## 3. deploy 接線

- [x] 3.1 `compose.host-kit.yml` coordinator `environment` 補 `GOVERNANCE_API_BASE: ${HOST_GOVERNANCE_API_BASE:-http://host.docker.internal:49102}`。

## 4. 驗證與部署

- [x] 4.1 `npx openspec validate console-mapping-proxy --strict` 綠。
- [x] 4.2 GitNexus `detect_changes` 確認改動範圍符合預期（HIGH-risk `_loadElementMapping` 為行為保持的內部 fetch 來源置換；app.ts 僅新增 route）。
- [ ] 4.3 `scripts/deploy.ps1 -Build` 重建 → 重進真 IFC → primary viewer → overlay A3 → 點有對映失敗構件 → **3D 標紅成功**（Kit `highlightPrimsResult` 確認）→ A8 開 issue + BCF；截圖佐證、保留環境。
