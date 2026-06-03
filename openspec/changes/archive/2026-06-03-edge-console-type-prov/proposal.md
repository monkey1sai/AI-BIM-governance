## Why

對抗驗證在 Edge Console 前端強確認 5 個 finding：`npx tsc --noEmit` 有 11 個錯誤，且 UI provenance 標示與後端實際落地脫節（誠實鐵律破口）。

1. **EC-01 型別漏 `'artifact'`**：`pages.tsx` 的 `StubPage` items 第三欄寫死窄化 union `"asbuilt"|"demo"|"p1"|"p15"`，漏掉 `data.ts` `Prov` 已定義的 `"artifact"`；`EdgeConsole.tsx` 傳 `'artifact'`（Model Intake / Semantic Viewer 的真實實測來源）觸 3 個 TS2322。
2. **EC-02 `mediaPort` 型別不相容**：viewer 串流端點 `mediaport` 為 `number | null`，但串流 library `DirectConfig.mediaPort` 為 `number | undefined`，`AppStream.tsx` stream / local 分支賦值觸 2 個 TS2322（`null` 不可指派 `number | undefined`）。
3. **EC-03 BCF 匯出 provenance 標錯**：BCF 2.1 匯出後端已落地（`governance-service/bcf/`，純 stdlib，不依賴 GPLv3），前端按鈕可用，但 `pages.tsx` 仍標 `p1` / `p15`「待建」，與實際相反。
4. **EC-04 / HON-1 過時註解**：`data.ts` 註解仍述 A2/A3 為「前端骨架 + spec（p1）」，與資料體 `prov=asbuilt` 及後端落地（diff / federation）矛盾。
5. **EC-05 未用宣告**：`React` default import（new JSX transform 下未用）、`Window.tsx` 的 `severityToColor` import 與 `pendingIssueHighlightRequestId` 死欄位觸 6 個 TS6133。

`tsc` 是 CI 與 build 的硬閘門；型別不一致會讓 `null` 在執行期流進串流 library；provenance 標錯違反 Edge Console「畫面與真實落地一致、無假數字」的誠實契約。

## What Changes

- **EC-01**：`pages.tsx` `StubPage` items 型別由窄化 union 改用 `data.ts` 既有的 `Prov`（`import { Prov }`），使 `'artifact'` 合法。
- **EC-02**：把 viewer `mediaport` 流經處正規化為 `number | undefined`——`StreamEndpoint.mediaport`（`windowHelpers.ts`）、`AppProps.mediaport`（`Window.tsx`）、`AppStreamProps.mediaport`（`AppStream.tsx`）一致；`resolveInitialStreamEndpoint` / `_resolveStreamEndpoint` 的 `?? null` 改 `?? undefined`、`streamEndpointLabel` 的 `!== null` 改 `!== undefined`；`AppStream.tsx` local 分支以 `this.props.mediaport != null` guard 確保 `DirectConfig.mediaPort` 不收 `null`。
- **EC-03**：`pages.tsx` 的 BCF 匯出標示（Overview 與 rule-set 表）由 `p1` / `p15`「待建」改為 `asbuilt`「已實作」，保留「純 stdlib，不依賴 GPLv3」說明。
- **EC-04**：更新 `data.ts` A1–A10 清單註解，與資料體一致（A1/A2/A3 後端皆 as-built）。
- **EC-05**：移除未用的 `React` default import（`EdgeConsole.tsx` / `pages.tsx` / `console.test.tsx` / `main.tsx`，保留有用的 named import）、`Window.tsx` 的 `severityToColor` import 與 `pendingIssueHighlightRequestId` 死欄位。
- **測試對齊**：`console.test.tsx` 的 A1 Rule Center 斷言由失效的「`後端待建`」（BCF 已 as-built 後該頁不再有待建項）改為驗證「`匯出 BCF 2.1`」存在 + 無假數字，保留誠實守門意圖。

純前端型別 / 標示修復；**無新增生產依賴**、不改後端、不改 API / data shape、不改既有 viewer 行為。

## Capabilities

### Modified Capabilities

- `edge-console-operator-frontend`：新增「provenance 型別 SHALL 接受後端權威值（含 artifact）」「mediaPort 型別 SHALL 與串流 library 相容（number | undefined）」「UI provenance 標示 SHALL 與實際落地一致（BCF 匯出為 asbuilt）」三項要求；並修正既有「A2/A3 為標示待建骨架」要求，使其與 A2/A3 後端已落地的事實一致。

### New Capabilities

- None.

## Impact

- Owner repo / folder（皆 `web-viewer-sample/`）：
  - `src/console/pages.tsx`（EC-01 型別 + EC-03 標示）、`src/console/data.ts`（EC-04 註解）、`src/console/EdgeConsole.tsx`（EC-05）、`src/console/console.test.tsx`（EC-05 + 測試對齊）。
  - `src/utils/windowHelpers.ts`、`src/Window.tsx`、`src/AppStream.tsx`（EC-02 `mediaport` 型別）、`src/main.tsx`（EC-05）。
- API / data shape：無變更（純前端型別 / 文案；coordinator / governance-service 契約不動）。
- Runtime boundary：不變（瀏覽器只打 coordinator `:8004`；不渲染 3D；EC-02 不改執行期端點解析行為，只把 `null` 規約為 `undefined`，缺值時交給 library 套預設）。
- Dependencies：**無新增生產依賴**。
- 驗收：`npx tsc --noEmit` 由 11 → 0；`npm run test` 38 passed；`npm run build` 成功。
- Non-goals：不重構 A1/A2/A3 後端、不改 provenance 視覺樣式、不動 `App.tsx`（NVIDIA Forms entry，`mediaport: number` 已相容 `number | undefined`，不在 scope）。
