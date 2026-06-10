# PR-1：Runtime NVIDIA 官方約束 callout（hybrid 吸收 #1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 或 subagent-driven-development，逐步打勾。

**Goal:** 在 `#/runtime`（CoordinatorGovernanceTabs / LifecycleTab）加一段 NVIDIA OVAS 官方 GPU/串流硬約束 callout（純文案、零後端、零邊界風險），把 Option B 設計規格 §10.5③ 最有價值、零風險的「不誤導的維運真相」吸收進 Option A 現役 console。

**Architecture:** 純前端 additive。只改 `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx`（在既有 `LifecycleTab` 末尾加 callout、並把 `LifecycleTab` export 供測試）+ `console.test.tsx` 加一條 SSR 斷言。不碰 routing、不碰後端、不新增依賴。標記沿用既有 `prov="asbuilt"`（官方文件背書的真實約束，非 DEMO）。

**Tech Stack:** React + TypeScript + Vitest（既有）；驗收截圖用 repo 內建 Playwright（本機無 bun，gstack browse 不可用 → 等效證據存 `artifacts/e2e/*.png` 以過 require-gstack-evidence PreToolUse 閘）。

**硬約束（四工具契約 / 邊界）：**
1. 不在 `main` 開發 → 走 branch `feat/runtime-nvidia-constraints` → PR。
2. 改 symbol 前先 `gitnexus_impact`（LifecycleTab / CoordinatorGovernanceTabs）。
3. 純文案；不直連 MinIO / 不啟停 Kit / 不分配 GPU；前端只走 coordinator :8004（本 PR 連 fetch 都不加）。
4. 內容是 NVIDIA 官方約束（已查證），標 `asbuilt`；不假裝任何未建功能。
5. 完成證據 = `#/runtime` → Lifecycle 分頁的 Playwright 截圖存 `artifacts/e2e/`。
6. commit 前 `gitnexus_detect_changes` 驗 scope。

---

### Task 1：LifecycleTab 加 NVIDIA 約束 callout + export + 測試

**Files:**
- Modify: `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx`（`LifecycleTab` L169-182）
- Modify: `web-viewer-sample/src/console/console.test.tsx`（既有 import CoordinatorGovernanceTabs，加 LifecycleTab SSR 斷言）

- [ ] **Step 1：GitNexus impact（改 symbol 前）**

Run: `gitnexus_impact({target: "LifecycleTab", direction: "upstream"})`（或 `CoordinatorGovernanceTabs`）。
Expected: 直接 caller = CoordinatorGovernanceTabs（同檔），下游 = RuntimePage(pages.tsx)。blast radius 低（同檔 + 一個 page）；HIGH/CRITICAL 才回報。

- [ ] **Step 2：寫失敗測試（先 export LifecycleTab）**

`console.test.tsx` 既有 `import { CoordinatorGovernanceTabs } from "./coordinator/RuntimeGovernanceTabs";`，改成同時 import LifecycleTab，並加：

```tsx
import { CoordinatorGovernanceTabs, LifecycleTab } from "./coordinator/RuntimeGovernanceTabs";

it("LifecycleTab 顯示 NVIDIA 官方 GPU/串流硬約束（1 GPU/stream・無 migrate・port≠frame）", () => {
  const html = renderToString(<LifecycleTab />);
  expect(html).toContain("1 GPU");
  expect(html).toContain("terminate");           // terminate + recreate
  expect(html).toContain("port listening");      // port listening ≠ has frame
  expect(html).toContain("NVIDIA");              // 來源標註
});
```

- [ ] **Step 3：跑測試確認 FAIL**

Run: `cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "NVIDIA"`
Expected: FAIL（LifecycleTab 未 export / 文字不存在）。

- [ ] **Step 4：實作 — export LifecycleTab + 加 callout**

`RuntimeGovernanceTabs.tsx`：把 `function LifecycleTab()` 改 `export function LifecycleTab()`，並在既有 `</div>`（L179 的 ec-grid 後）與 `</Panel>` 之間插入：

```tsx
      <p className="ec-note">GPU / 串流硬約束（NVIDIA Omniverse OVAS 官方）— 維運真相，不做會誤導的承諾：</p>
      <div className="ec-grid">
        <Field k="1 GPU = 1 stream" v="每個 GPU worker 限一個 stream；同時 session 數 ≤ GPU 數。多個 spectator 共看同一 stream 不另吃 GPU。" prov="asbuilt" />
        <Field k="無 migrate API" v="session 綁單一 GPU pod 跑到結束（create→connect→disconnect→terminate）。換 GPU = terminate + recreate，啟動約 30–40s、shader cache 冷可達 15min+；不提供無縫遷移。" prov="asbuilt" />
        <Field k="port listening ≠ has frame" v="只有 browser first-frame evidence 才算 viewer 真看到畫面；埠有 listen 不代表可審查 ready。" prov="asbuilt" />
      </div>
      <p className="ec-note">來源：NVIDIA Omniverse OVAS deployment requirements / limitations（docs.omniverse.nvidia.com/ovas）。</p>
```

（`Field` 已在本檔 import；無新依賴。）

- [ ] **Step 5：跑測試確認 PASS + 既有測試不破**

Run: `cd web-viewer-sample && npx vitest run src/console/console.test.tsx`
Expected: 新案 PASS，既有 CoordinatorGovernanceTabs 案全綠。

- [ ] **Step 6：build 驗證（型別）**

Run: `cd web-viewer-sample && npm run build`
Expected: tsc + vite build 綠（export 變更不影響既有 import）。

- [ ] **Step 7：gstack/Playwright 證據截圖（#/runtime → Lifecycle）**

以 repo 內建 Playwright（本機無 bun）截 `:8004/ui#/runtime` 點到 Lifecycle 分頁，存 `artifacts/e2e/pr1-runtime-nvidia-constraints.png`。若 web-plane 未起則先 `scripts/deploy.ps1 -Build`（或重建 dist-ui + 重啟 coordinator）。截到含「1 GPU = 1 stream / 無 migrate API」即可。

- [ ] **Step 8：gitnexus detect_changes（commit 前驗 scope）**

Run: `gitnexus_detect_changes()`
Expected: 只動 RuntimeGovernanceTabs.tsx + console.test.tsx，無預期外 symbol/flow。

- [ ] **Step 9：branch + commit + PR**

```bash
git switch -c feat/runtime-nvidia-constraints
git add web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx web-viewer-sample/src/console/console.test.tsx
git commit -m "feat(runtime): #/runtime 加 NVIDIA OVAS 官方 GPU/串流硬約束 callout（hybrid 吸收 #1）"
git push -u origin feat/runtime-nvidia-constraints
gh pr create --base main --title "feat(runtime): NVIDIA OVAS 官方約束 callout（hybrid 吸收 PR-1）" --body "<含 gstack 證據路徑 artifacts/e2e/pr1-runtime-nvidia-constraints.png>"
```

PR 描述含 Frontend Verification table（Frontend URL=:8004/ui#/runtime、Buttons=Lifecycle 分頁、Expected=顯示 1 GPU/stream・無 migrate・port≠frame、gstack evidence path）。merge 時 require-gstack-evidence 閘應放行（已有 e2e png）。

---

## Self-Review
- **Spec 覆蓋**：吸收設計規格 §10.5③ 的官方約束敘事（B 維度 5 最高價值零風險項）✓。
- **Placeholder**：無；JSX 與測試皆完整 code。
- **Type 一致**：`Field` 既有元件、props k/v/prov 與本檔既有用法一致；`LifecycleTab` export 不改簽名（無 props）。
- **邊界**：純文案、零 fetch、零 runtime 控制 ✓。
