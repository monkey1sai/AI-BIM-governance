# apps/kit-manager-web Agent Rules

本檔是 `apps/kit-manager-web/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`apps/kit-manager-web` 是 **獨立 Vite + React 18 前端 — Kit Manager UI**，提供 operator 對 Kit runtime 的管理介面（list / start / stop / status）。它與 `web-viewer-sample` 是兩個不同 browser 端；本 app 的 2D UX／IA／visual state 同樣受 pinned `desigin-system` design gate 管理，但不擁有 review viewer/WebRTC。

開發埠口：依 `vite.config.ts`（預設 Vite dev server）。

## Owns

- `src/App.tsx` / `src/main.tsx` / `src/styles.css` — UI entry 與 root component
- `src/api/` — 對 kit-manager-api 的 client（contract 見 `docs/contracts/kit-manager-api.contract.md`）
- `src/components/` — Kit Manager 專屬 UI components
- `src/models.ts` — UI-side TypeScript model
- `vite.config.ts` / `tsconfig.json` — build 設定
- `package.json` dev / build scripts

## Does Not Own

- kit-manager-api server-side 邏輯（屬於外部 service / sub-repo）
- review session UI（屬於 `web-viewer-sample`）
- WebRTC client（屬於 `web-viewer-sample`）
- Kit runtime / GPU runtime（屬於 `bim-streaming-server`）
- coordinator session lifecycle（屬於 `bim-review-coordinator`）

## Required Boundaries

- MUST 透過 `src/api/` 對 kit-manager-api 互動；遵守 `docs/contracts/kit-manager-api.contract.md` 的 API contract。
- MUST 把 UI 與 server protocol 改動分開處理。
- MUST NOT 直接控制 Kit 進程、分配 GPU、啟動 / 停止 Docker container（這些走 server 端）。
- MUST NOT 跨越邊界進入 `web-viewer-sample` 的 review viewer / WebRTC client 領域。
- MUST NOT 引入 Omniverse / `pxr` / `omni.*` 套件。
- Kit Manager 2D UI 與 Kit OpenUSD Web Viewer／OpenUSD extensions 是兩個 scope；後者保留但不因本 app 的 visual alignment 被擴充或重構。

## Before Editing

- 先讀 `src/App.tsx`、`src/api/`、`docs/contracts/kit-manager-api.contract.md`、root `docs/plans/TARGET-contracts.md` §5.1 與 design manifest。
- 改 API 互動 MUST 先確認 contract 是否同步；contract 改動需走 `tests/contracts/`。
- 新增 component 沿用既有 component pattern；UI 改動避免引入新 production dependency 不解釋。

## Verify

```powershell
cd apps/kit-manager-web; npm run build
```

`tsc && vite build` 是目前的 type-check + bundle 入口；無獨立 unit test 套件。

## Done Criteria

- 改動沒有把 Kit Manager UI 變成 server / runtime authority。
- `npm run build` 通過，或清楚說明 build error 與 fix 計劃。
- User-facing flow 完成時必須列 route/URL/buttons/fixture/API/runtime ID/visible states/functional evidence，以及 design screen/manifest/visual result/comparison/artifacts；只通過 API、build 或 screenshot 不算完整驗收。
- Current manifest 尚無 Kit Manager approved screen 時 machine status 必須是 `partial_reference_missing`、missing scope=`surface:kit-manager-web`、`Full completion claimed=no`；可做誠實局部修復但不得宣稱 99%。取得上游核准 screen 後，才以 Chromium DPR1 兩 viewport pixel≤1%＋CI Playwright semantic 100% 作 design pass。
- 若觸及 API contract，PR 描述 MUST 列出對應 `docs/contracts/kit-manager-api.contract.md` 是否同步。
- 最終回覆列出 changed files、validation、known risks。
