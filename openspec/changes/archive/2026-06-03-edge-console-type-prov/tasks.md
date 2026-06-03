# Tasks — edge-console-type-prov

## 1. EC-01：StubPage provenance 型別接受 'artifact'

- [x] 1.1 `pages.tsx` 加 `import { Prov }`（自 `./data`）。
- [x] 1.2 `StubPage` items 第三欄型別由 `"asbuilt" | "demo" | "p1" | "p15"` 改為 `Prov`。
- [x] 1.3 確認 `EdgeConsole.tsx` 的 `'artifact'`（Model Intake / Semantic Viewer）不再觸 TS2322。

## 2. EC-02：mediaPort 型別與串流 library 相容（number | undefined）

- [x] 2.1 `windowHelpers.ts` `StreamEndpoint.mediaport` 由 `number | null` 改 `number | undefined`（加註解）。
- [x] 2.2 `Window.tsx` `AppProps.mediaport` 改 `number | undefined`。
- [x] 2.3 `Window.tsx` `resolveInitialStreamEndpoint` / `_resolveStreamEndpoint` 的 `?? null` 改 `?? undefined`；`streamEndpointLabel` 的 `!== null` 改 `!== undefined`。
- [x] 2.4 `AppStream.tsx` `AppStreamProps.mediaport` 改 `number | undefined`；local 分支 guard 改 `this.props.mediaport != null` 確保 `DirectConfig.mediaPort` 不收 `null`/`undefined`。
- [x] 2.5 確認 stream / local 兩分支不再觸 TS2322；`App.tsx`（`mediaport: number`）仍相容不需改。

## 3. EC-03：BCF 匯出 provenance 標示與落地一致

- [x] 3.1 確認後端 BCF 2.1 匯出已落地（`governance-service/bcf/bcf_writer.py`，純 stdlib zipfile/ElementTree，不依賴 GPLv3）。
- [x] 3.2 `pages.tsx` OverviewPage 的 BCF 列由 `p1`「待建」改 `asbuilt`「已實作（純 stdlib，不依賴 GPLv3）」。
- [x] 3.3 `pages.tsx` rule-set 表的 BCF 列由 `p15`「待建」改 `asbuilt`「已實作（純 stdlib zipfile/ElementTree，不依賴 GPLv3）」。

## 4. EC-04 / HON-1：data.ts 過時註解對齊

- [x] 4.1 更新 `data.ts` A1–A10 清單註解：A1（rule-run + IDS + BCF）、A2（GlobalId diff + geometry opt-in + issue-impact）、A3（USD sublayer federation + per-member transform + review-room handoff）後端皆 as-built。

## 5. EC-05：移除未用宣告

- [x] 5.1 `EdgeConsole.tsx` 移除 `React` default import（保留 `useEffect` / `useState`）。
- [x] 5.2 `pages.tsx` 移除 `React` default import（保留 `useCallback` / `useState`）。
- [x] 5.3 `console.test.tsx` 移除整行 `import React`（用 `renderToString`，new JSX transform）。
- [x] 5.4 `main.tsx` 移除整行 `import React`（new JSX transform）。
- [x] 5.5 `Window.tsx` 自 streamMessages import 移除未用的 `severityToColor`。
- [x] 5.6 `Window.tsx` 移除未用的 `pendingIssueHighlightRequestId` 死欄位。

## 6. 測試對齊與驗證

- [x] 6.1 `console.test.tsx` A1 Rule Center 斷言：移除失效的「`後端待建`」（BCF as-built 後該頁無待建項），改驗「`匯出 BCF 2.1`」+ 無假數字；同步修正過時行內註解。
- [x] 6.2 `npx tsc --noEmit` → 0 errors（修前 11）。
- [x] 6.3 `npm run test`（vitest）→ 38 passed / 0 fail。
- [x] 6.4 `npm run build`（vite）→ 成功。
- [x] 6.5 `npx openspec validate edge-console-type-prov --strict` → 通過。
