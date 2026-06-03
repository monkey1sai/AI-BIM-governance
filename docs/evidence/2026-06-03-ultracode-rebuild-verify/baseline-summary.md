# Baseline 量測 — 2026-06-03 ultracode rebuild+verify

於 clean `main`(8e22285)量測,作為本回合「先量再改」對照基準。

| 套件 | 指令 | 結果 |
|---|---|---|
| governance-service pytest | host py312 `-m pytest -p no:cacheprovider` | **45 passed** ✅ |
| root pytest | `.venv\Scripts\python.exe -m pytest tests` | **66 passed** ✅ |
| coordinator | `npm run build && npm test` | build OK · **273 passed** ✅ |
| web-viewer-sample | `npm run build`(vite) | OK ✅ |
| web-viewer-sample | `npm run test`(vitest) | **38 passed** ✅ |
| web-viewer-sample | `npx tsc --noEmit` | **11 errors** ⚠️ |

## 環境註記
- 兩個 JS sub-repo 起初缺 `node_modules`(vite/vitest not found),`npm install` 後恢復。屬環境設置,非程式碼缺陷。
- governance-service 走 host `C:\Program Files\Python312\python.exe`(內建 ifcopenshell 0.8.5);root 走 `.venv`。

## viewer tsc --noEmit findings(pre-existing on main)
1. `src/console/EdgeConsole.tsx(40,274/361)(46,260)`:provenance 值 `"artifact"` 不在型別 union `"asbuilt"|"demo"|"p1"|"p15"` — **真 bug**(誠實鐵律 artifact 為合法 provenance,型別漏列)。
2. `src/AppStream.tsx(133,13)(167,17)`:`mediaPort` 型別 `number|null` 不可賦予 `number|undefined` — 潛在 null 處理不一致。
3. unused:`React`(console.test.tsx, EdgeConsole.tsx, pages.tsx, main.tsx)、`severityToColor`/`pendingIssueHighlightRequestId`(Window.tsx) — lint 級。

官方 `npm run build`=純 `vite build`(esbuild,不型別檢查),故上述未被 CI gate;為本回合修復候選。
