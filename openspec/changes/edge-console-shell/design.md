# Design — edge-console-shell（Edge Console 前端 + governance proxy）

## 定位

以設計原型「06 操作介面總覽」為骨架，在真實 `web-viewer-sample`（Vite + React 18 + TS）落地落地端 Edge Console。原型是 Babel-in-browser + iframe 的設計參考；本 change 把其 IA + `--ec-*` 視覺 + 誠實 provenance 系統移植成真實 `.tsx`，不複製原型檔。

## 路由決策（零依賴）

不引入 `react-router-dom`。改以：
- `main.tsx` 用 `window.location.pathname` 判斷 `/console` → 掛 `EdgeConsole`，其餘 → 既有 `<App/>`（viewer）不動。
- Edge Console 內頁用 `hashchange`（與原型一致）。

理由（YAGNI + 最小 diff + 守邊界）：避免新增生產依賴、避免改動既有 `?session=` bootstrap、避免 fork `App.tsx` / `Window.tsx`。8 頁內部切換用 hash 已足夠。

## 跨 repo 資料流

```
瀏覽器 (web-viewer-sample /console)
  │  只打 :8004（governanceClient）
  ▼
bim-review-coordinator (:8004)  ── /api/governance/* proxy（governanceProxy.ts, loopback 透傳）──►  governance-service (127.0.0.1:49102)
```

- 瀏覽器永不直連 `:49102`；proxy 透傳 JSON 與 Excel binary；後端不可用回 502（誠實）。
- 3D highlight（A1 失敗構件標示）走 client `highlightPrimsRequest`（既有 builder），不復活退役的 server→viewer push。

## Source-of-truth 歸屬

| 資料 | 權威 owner |
|---|---|
| rule-run 結果 / score | `governance-service`（前端只顯示，不保存權威） |
| A1 真實實測 artifact 數字 | committed evidence（`docs/evidence/governance-rule-run-pass/`，PR #151）；標 artifact，非捏造 |
| review session / stream-config | `bim-review-coordinator`（既有） |

前端不保存 review / issue 權威資料（守 `web-viewer-sample` 邊界）。

## 誠實系統

provenance：asbuilt（已實作）/ artifact（實測）/ demo（示範）/ p1·p15（待建）。A1 為 asbuilt + artifact；A2/A3 為 p1 骨架；A4–A10 為 p15 roadmap 灰掉；GPU/conversion 無遙測標 demo「未取得」非 fail。移除原型所有願景假數字。

## 驗證策略與環境限制

- `web-viewer-sample`：`npm run build`（vite）+ `npm run test`（vitest）；新增 `console.test.tsx` 以 `renderToString` 斷言誠實性（A1-A10 列出、真實 artifact 數字、A2/A3 標待建、Overview 無假數字）。實測 38 tests 全綠（含既有 34 無回歸）。
- `bim-review-coordinator`：`npm run build`（tsc）驗證 proxy 型別。
- 環境：worktree 需先 `npm install`（node_modules gitignored）；不需 GPU。
- 跨服務真實 E2E（browser→coordinator→governance→真實 IFC）需 change 1 + change 2 程式同跑，列為後續（Playwright）。
