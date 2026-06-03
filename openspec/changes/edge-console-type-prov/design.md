# Design — edge-console-type-prov

## Context

Edge Console（`web-viewer-sample/src/console/`）與 viewer（`Window.tsx` / `AppStream.tsx`）共用同一前端專案。`tsc --noEmit` 是 CI 與 `vite build` 前的硬閘門。本 change 為對抗驗證後的型別 / 誠實標示修復，不改執行期行為（EC-02 除外，但僅將 `null` 規約為 `undefined`，語意等價）。

## Goals / Non-Goals

- Goals：`tsc` 11 → 0；provenance 型別涵蓋後端權威值；`mediaPort` 與串流 library 型別一致；UI 標示與後端落地一致；移除死碼。
- Non-Goals：不改 provenance 視覺、不改後端、不引入依賴、不動 `App.tsx`。

## Decisions

### D1（EC-01）：StubPage 改用單一真相 `Prov`，不再寫死 union

`data.ts` 已有 `export type Prov = "asbuilt" | "artifact" | "demo" | "p1" | "p15"`，且 `Field` / `ProvTag` / `Panel` 都收 `Prov`。`StubPage` 卻自行寫死缺 `"artifact"` 的窄化 union，是唯一漏接點。改 import `Prov` 後型別收斂到單一真相，`EdgeConsole.tsx` 傳給 Model Intake（`conversion quality_metrics` / `semantic_mapping_fidelity`）與 Semantic Viewer（`element_mapping.json`）的 `'artifact'` 即合法。

### D2（EC-02）：`mediaport` 全鏈正規化為 `number | undefined`

串流 library 的 `DirectConfig.mediaPort` 型別為 `number | undefined`；viewer 端歷史上用 `number | null` 表「未指定」。`null` 不可指派 `number | undefined`，故在 stream 分支（直接賦值）與 local 分支（spread）各觸一個 TS2322。

選 **全鏈正規化為 `number | undefined`**（contract 首選），而非在賦值點臨時 `?? undefined`：

- 串流端點型別 `StreamEndpoint.mediaport`、`AppProps.mediaport`、`AppStreamProps.mediaport` 一致為 `number | undefined`，避免「某層 null、某層 undefined」的拼接。
- 端點建構處的 `?? null` 改 `?? undefined`（`resolveInitialStreamEndpoint` / `_resolveStreamEndpoint`），`streamEndpointLabel` 的判空 `!== null` 改 `!== undefined`。
- `sameStreamEndpoint` 以 `===` 比較，`undefined === undefined` 為 true，行為不變。
- `AppStream.tsx` local 分支：`StreamConfig.local.mediaPort` 在 config 為 `null`（TS 靜態型別即 `null`），原 `this.props.mediaport || StreamConfig.local.mediaPort` 永遠不會由 config 取得 number，故簡化為 `this.props.mediaport != null && { mediaPort: this.props.mediaport }`（缺值略過該欄，交 library 套預設）。runtime 行為等價（config 端永遠 null）。
- `App.tsx`（NVIDIA Forms entry）的 `mediaport: number` → `number` 可指派 `number | undefined`，不需改，亦不在 scope。

不選「改 library 型別」或「賦值點 cast」：前者不可改第三方型別，後者把 `null` 帶進執行期再硬轉，違反「不傳 null 給 library」的本意。

### D3（EC-03 / EC-04）：標示與註解對齊後端事實（誠實鐵律）

BCF 2.1 匯出後端已落地（commit d88efa0，`governance-service/bcf/bcf_writer.py` 純 stdlib `zipfile` + `xml.etree.ElementTree`，刻意不依賴 GPLv3 `bcf-client`），前端 IssuesRuleCenterPage 已有可用「匯出 BCF 2.1」按鈕。`pages.tsx` 仍標 `p1` / `p15`「待建」與 `data.ts` 註解述 A2/A3「骨架 + spec（p1）」皆為過時假象，違反 Edge Console「畫面與真實落地一致」契約。改為 `asbuilt`「已實作」並更新註解，保留「純 stdlib，不依賴 GPLv3」授權說明。

### D4（EC-05）：只刪「先確認真未使用」者

- `React` default import：專案用 new JSX transform（`react-jsx`），不需 `import React`。逐檔確認：`EdgeConsole.tsx` / `pages.tsx` 仍用 named import（`useEffect`/`useState`/`useCallback`），只刪 default；`console.test.tsx` / `main.tsx` 整行 `import React` 未用，整行刪。
- `Window.tsx` `severityToColor`：grep 全 `src/` 僅出現在 import 行（其餘 highlight 用 `buildHighlightPrimsRequest`），確認未用後自 import list 移除。
- `Window.tsx` `pendingIssueHighlightRequestId`：grep 全 `src/` 僅出現在欄位宣告行，無任何讀寫，確認死欄位後移除。

### D5：測試隨行為更新（誠實守門不退）

`console.test.tsx` A1 Rule Center 原斷言 `toContain("後端待建")`，前提是 BCF / Issue DB 標待建。EC-03 後該頁無任何「後端待建」項（IDS / BCF / Issue DB 皆 as-built），斷言本身成為假宣告。改為 `toContain("匯出 BCF 2.1")`（驗證 BCF 入口存在）+ `not.toContain("99.1%")`（守無假數字），保留「誠實守門」意圖而不再斷言一個已成假的字串。

## Risks / Trade-offs

- **R1（EC-02 行為）**：把 `null` 規約為 `undefined`。緩解：`StreamConfig.local.mediaPort` 在 config 即 `null`，且 library 對 `undefined`/缺欄一致套預設；`sameStreamEndpoint` 用 `===` 不受影響；行為等價，vitest `windowHelpers.test.ts` 全綠。
- **R2（測試弱化疑慮）**：移除 `後端待建` 斷言可能被視為放寬。緩解：該斷言已是假宣告（誠實鐵律要求移除），新斷言改驗真實入口 + 無假數字，整體誠實守門未降。
- **R3（blast radius）**：`mediaport` 跨 4 檔。緩解：型別收斂為單一值域，`tsc` 全綠即證跨檔一致；無新增 runtime 分支。

## Migration / Rollout

無資料遷移、無 API 變更、無新依賴。純前端型別 / 文案 / 死碼修復，可獨立 merge。
