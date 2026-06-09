# EdgeConsole Product Shell 上線（B 方案 prototype 操作台落地）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans，逐步打勾。

**Goal:** 把 `/ui` 的主控台從 `OperatorConsole`（Option A 六頁）換成 `EdgeConsole` 的 **完整 prototype 操作台**（B 方案）：今天要做什麼首頁、A1 五步引導、逐 A1–A10 的 3D Viewer 呈現頁、轉檔/Session/機隊/MinIO 治理頁；同時修正「零 GPU / 無 Omniverse 依賴」框架字眼為 **GPU 為核心前提**，並對未建功能誠實標記。

**Architecture:** 純前端。基底直接取用已驗證（2026-06-08：44 tests + build:ui + Docker :8004/ui E2E pass）的 `stash@{0}`（product-governance-console WIP），用 `git stash apply` 套到新 branch；丟棄 stash 的 AGENTS.md/CLAUDE.md 舊改（main 已有四套工具契約），合併 console.test.tsx / pages.tsx（保 PR-1 LifecycleTab + PR-2 ProvLegend），疊上 GPU-premise 框架修正 + 保留 `#/kit`、`#/demo-control` 兩條 operator-tool 路由（非 silently 砍）。

**Tech Stack:** React 18 + TS + Vitest（renderToString）+ repo 內建 Playwright（本機無 bun）。

**硬約束（四套工具契約 / 邊界）：**
1. 不在 main 開發 → branch `feat/edge-console-product-shell` → PR。
2. 改 symbol 前 GitNexus impact 已跑：`isOperatorConsolePath`(LOW, caller=main.tsx)、`EdgeConsole`(LOW, 0 caller)。
3. 邊界已審：MinioDataPage（靜態 tree，非 S3 browser）、KitGpuFleetPage（靜態機隊，明寫 restart 須送 audited intent 給 Kit Manager）、Session/Conversion（走 coordinator proxy、危險動作 disabled+p1）。全唯讀、無直連 MinIO、無 Kit 控制。
4. 未建一律標 p1/p4/demo；不做假按鈕。
5. 完成證據 = Playwright 截 `:8004/ui`（home + #/a1 + #/viewer）存 `artifacts/e2e/`。
6. commit 前 GitNexus detect_changes 驗 scope。

---

### Task 1：建 branch + 套用 stash 基底

**Files:** 全 console 檔（apply）。

- [ ] **Step 1:** `git switch -c feat/edge-console-product-shell`
- [ ] **Step 2:** `git stash apply stash@{0}`（保留 stash 當備援，不 pop）
- [ ] **Step 3:** 解衝突
  - `git checkout --ours -- AGENTS.md CLAUDE.md`（保 main 的四套工具契約，丟 stash 舊 2 行）
  - `console.test.tsx`：保 main 的 LifecycleTab/ProvLegend 測試 + 併入 stash 的 EdgeConsole/page 測試
  - `pages.tsx`：保 PR-2 的 ProvLegend import + CoordinatorPage `<ProvLegend/>` + 併入 stash 的 +327 新頁
- [ ] **Step 4:** 乾淨套用的檔（無 PR-1/PR-2 衝突）：EdgeConsole.tsx / data.ts / routing.ts / main.tsx / coordinatorClient.ts / governanceClient.ts / edge-console.css 應自動 apply。

### Task 2：GPU-premise 框架修正（使用者明確指正）

**Files:** `data.ts`, `EdgeConsole.tsx`, `pages.tsx`

- [ ] **Step 1:** `data.ts` NAV_GROUPS：`core` group `sub` 從 `"CORE · 無 Omniverse 依賴"` → `"CORE · 語意 / 規則 / 問題"`。
- [ ] **Step 2:** `EdgeConsole.tsx` header chip：`GPU 未取得` → `GPU · 依 session 派發`（保 ec-demo tone）。
- [ ] **Step 3:** `pages.tsx` A1 lead：`3D 高亮是加值，A1 core 不依賴 GPU` → `3D 高亮需 GPU viewport（依 review session 派發）；規則檢核在 governance-service 完成`。
- [ ] **Step 4:** grep `零 GPU|無 GPU|無 Omniverse|no.?gpu` 全 console 掃，逐一修成 GPU-premise 語氣（不誤導為「不需 GPU」）。

### Task 3：保留 operator-tool 路由（非回歸）

**Files:** `EdgeConsole.tsx`

- [ ] **Step 1:** import `KitConsolePage`、`RealIfcConsolePage`。
- [ ] **Step 2:** renderBody 加 `case "kit": return <KitConsolePage />;` 與 `case "demo-control": return <RealIfcConsolePage />;`（route 已在 PRODUCT_CONSOLE_ROUTES；補 render，否則落到 HomePage）。

### Task 4：更新測試 / e2e

**Files:** `console.test.tsx`, `routing.test.ts`(驗不需改), `e2e/unified-console-routes.spec.ts`

- [ ] **Step 1:** `routing.test.ts`：所有斷言（#/kit、#/demo-control、#/nope→false）在新 PRODUCT_CONSOLE_ROUTES（超集）下仍成立 → 不需改，跑過確認。
- [ ] **Step 2:** `unified-console-routes.spec.ts`：原斷言 OperatorConsole（op-page、op-nav-*、IntakeSelectPage「模型進件」）已不成立；改為驗 EdgeConsole 保留的 `#/kit`→`kit-proxy-panel`、`#/demo-control`→`real-ifc-demo-control`，移除 op-* 與 IntakeSelectPage 斷言。`product-console-integration.spec.ts`（已存在）為 B 操作台主驗收。

### Task 5：驗證（最小→完整）

- [ ] **Step 1:** `cd web-viewer-sample; npx vitest run src/console`（全綠；含 EdgeConsole/page SSR + PR-1/PR-2）。
- [ ] **Step 2:** `npm run build`（tsc + vite 綠）。
- [ ] **Step 3:** `npm run build:ui`（dist-ui 重建——`:8004/ui` 入口；deploy.ps1 不會自動跑 build:ui）。
- [ ] **Step 4:** 重啟 coordinator 容器讓 dist-ui 生效（bind-mount）。
- [ ] **Step 5:** Playwright 截 `:8004/ui`（home「今天要做什麼」+ `#/a1` 五步 + `#/viewer` 3D Viewer）存 `artifacts/e2e/pr3-edge-console-*.png`。
- [ ] **Step 6:** GitNexus `detect_changes(scope=all)`，記風險；HIGH/CRITICAL 先回報。

### Task 6：commit + PR

- [ ] **Step 1:** `git diff --cached --check`（擋 trailing whitespace）。
- [ ] **Step 2:** commit + push + `gh pr create`（繁中標題/描述 + Frontend Verification table + gstack 證據路徑）。
- [ ] **Step 3:** merge（require-gstack-evidence 閘應放行——已有 e2e png）。

## Self-Review
- **Spec 覆蓋**：使用者 ① A1–A10 總覽=prototype 操作模型（HomePage + NAV_GROUPS + A1 五步）✓ ② 逐 A1–A10 的 3D Viewer 呈現（ViewerPresentationPage）✓ ③ GPU 為前提（Task 2 框架修正）✓ ④ 誠實 NOT BUILT（p1/p4/demo 標記沿用）✓。
- **邊界**：無新增直連 MinIO / Kit 控制；敏感頁全唯讀展示已審 ✓。
- **回歸**：保 `#/kit`、`#/demo-control`（Task 3）；routing.test.ts 向後相容（Task 4-1）✓。
- **Placeholder**：無；套用既有已驗證 code + 明確 edit 點。
