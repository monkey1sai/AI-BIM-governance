## 1. Preflight / Baseline（measure-before-change，紅隊 R6）

- [x] 1.1 `web-viewer-sample` / `bim-review-coordinator` 於 worktree `npm install`（node_modules 缺，先補）。
- [x] 1.2 確認 `web-viewer-sample` 既有測試 baseline（vitest 34 tests）作對照。
- [x] 1.3 在 `codex/openspec/edge-console-shell` branch + worktree 開發，不在 main。

## 2. Edge Console 前端（web-viewer-sample/src/console/）

- [x] 2.1 `edge-console.css`：移植 `--ec-*` 暗綠 token + 三欄 grid（scope 在 `.ec-root`，不影響既有 viewer）。
- [x] 2.2 `data.ts`：PROV 系統（asbuilt/artifact/demo/p1/p15）+ PAGES 兩段式導覽 + A1A10（轉述自 RM_APPS）。
- [x] 2.3 `components.tsx`：誠實元件 ProvTag / Panel / Field / Metric / Btn（強制 caption）/ HealthChip。
- [x] 2.4 `governanceClient.ts`：只打 coordinator `/api/governance/*`（不直連 :49102）。
- [x] 2.5 `pages.tsx`：Overview / A1 Rule Center（實時 + 真實 artifact + 規則集）/ Apps launcher / A2 / A3 骨架 / 其餘 AS-BUILT·待建 stub。
- [x] 2.6 `EdgeConsole.tsx`：三欄殼 + 兩段式導覽 + hash 路由 + ChatUSD 欄（可折疊）。
- [x] 2.7 `main.tsx`：pathname 條件渲染（`/console` → EdgeConsole，其餘 → 既有 `<App/>` 不動）。

## 3. Coordinator proxy（瀏覽器邊界）

- [x] 3.1 `src/routes/governanceProxy.ts`：additive `/api/governance/rule-runs*` proxy（loopback 透傳 :49102，JSON + Excel binary）；後端不可用回 502。
- [x] 3.2 `app.ts`：一行 `registerGovernanceProxy(app)` 註冊（dev conversions 區塊後）。

## 4. Validation

- [x] 4.1 `web-viewer-sample`：`npm run build` 綠（vite build）+ `npm run test` 綠（38 tests，含 4 個 console 誠實 smoke，既有 34 無回歸）。
- [ ] 4.2 `bim-review-coordinator`：`npm run build`（tsc）綠，確認 proxy 型別正確。
- [ ] 4.3 `npx openspec validate edge-console-shell --strict` 通過。
- [ ] 4.4 `git diff --cached --check`。

## 5. Closeout

- [ ] 5.1 commit + PR（繁中，附 validate / build / test 輸出）。
- [ ] 5.2 merge 後 `npx openspec archive edge-console-shell`，sync `openspec/specs/edge-console-operator-frontend/spec.md`。

## 6. 後續（範圍外，已標）

- [ ] 6.1 A2 後端（change 3 model-version-diff-globalid）、A3 後端（change 4 usd-federation-sublayer-sets）。
- [ ] 6.2 跨服務真實 E2E：瀏覽器→coordinator proxy→governance-service→真實 IFC（需兩 branch 程式同跑；Playwright 為後續）。
- [ ] 6.3 Semantic Viewer 接真實 element_mapping.json + client highlight 整合 A1 失敗構件。
