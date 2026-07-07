# C M4 Runtime Command Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the conservative M4 Runtime Command Bridge for AI-BIM Geo Viewer, aligning the viewer IA with the M4 prototype while preserving coordinator/session/Kit boundaries and hardening primary/spectator command authority.

**Architecture:** The browser separates UI-local intents from runtime mutators. Coordinator remains the session/lease/runtimeStatus authority and does not become a generic operation platform. Kit/WebRTC DataChannel remains the actual runtime path, with mutating commands requiring primary authority and ack evidence.

**Tech Stack:** React 18, TypeScript, Playwright, existing Vite viewer, coordinator Express APIs, Kit Python messaging extension, existing DataChannel command names.

---

## File Structure

- Modify: `web-viewer-sample/src/console/viewer/MockViewport.tsx`
  - Align harness viewer IA to C: left model/tree, center live/honest viewport, right semantic/Pset/Spatial, bottom mapping strip.
  - Keep harness banner honest.
- Modify: `web-viewer-sample/src/console/viewer/viewer.css`
  - Add stable grid layout and responsive sizing for C IA.
  - Preserve single-scroll behavior.
- Modify: `web-viewer-sample/src/Window.tsx`
  - Keep current `AppStream` and role/session logic.
  - Route UI-local selection separately from runtime mutators.
  - Keep spectator mutator send disabled.
  - Treat `composeStageRequest` as a mutating legacy/harness event if still emitted, but do not treat it as production Kit evidence unless a real handler is verified.
- Modify: `web-viewer-sample/e2e/gov-viewer-layout.spec.ts`
  - Assert C IA and single-scroll.
- Modify: `web-viewer-sample/e2e/primary-spectator-authority.spec.ts`
  - Assert primary/spectator frontend behavior and bypass-visible prevention where possible in harness.
- Modify or create: `web-viewer-sample/e2e/runtime-command-bridge.spec.ts`
  - Add command trace assertions for UI-local vs mutator behavior.
- Modify after GitNexus impact and explicit implementation phase: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_management.py`
  - Add runtime-side mutating command authorization gate.
- Modify after GitNexus impact and explicit implementation phase: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py`
  - Add runtime-side mutating command authorization gate for stage loading commands.
- Add or update nearby streaming tests if available.

## Task 1: Lock C Viewer IA Layout Contract

**Files:**
- Modify: `web-viewer-sample/e2e/gov-viewer-layout.spec.ts`

- [ ] **Step 1: Add failing assertions for C IA regions**

Add assertions using stable test IDs:

```ts
await expect(page.getByTestId("mock-viewport")).toBeVisible({ timeout: 30_000 });
await expect(page.getByTestId("geo-viewer-left-model")).toBeVisible();
await expect(page.getByTestId("geo-viewer-center-stage")).toBeVisible();
await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
await expect(page.getByTestId("geo-viewer-runtime-evidence")).toContainText(/primary|spectator|session/i);
```

- [ ] **Step 2: Add single-scroll assertion**

```ts
const metrics = await page.evaluate(() => ({
  documentScrollHeight: document.documentElement.scrollHeight,
  documentClientHeight: document.documentElement.clientHeight,
  bodyScrollHeight: document.body.scrollHeight,
  windowInnerHeight: window.innerHeight,
}));
expect(metrics.documentScrollHeight).toBeLessThanOrEqual(metrics.documentClientHeight + 1);
expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.windowInnerHeight + 1);
```

- [ ] **Step 3: Run red test**

```powershell
npx playwright test e2e/gov-viewer-layout.spec.ts --project=chromium
```

Expected before implementation: FAIL because the new C region test IDs do not exist.

## Task 2: Align MockViewport IA Without Faking Runtime

**Files:**
- Modify: `web-viewer-sample/src/console/viewer/MockViewport.tsx`
- Modify: `web-viewer-sample/src/console/viewer/viewer.css`

- [ ] **Step 1: Add C structural test IDs**

In `MockViewport.tsx`, structure the visible model tab as:

```tsx
<section className="gv-C" data-testid="mock-viewport">
  <aside className="gv-C__left" data-testid="geo-viewer-left-model">
    {/* model info and IFC tree */}
  </aside>
  <main className="gv-C__center" data-testid="geo-viewer-center-stage">
    {/* live frame observed or honest deterministic placeholder */}
  </main>
  <aside className="gv-C__right" data-testid="geo-viewer-right-semantic">
    {/* IFC semantic, Pset/Qto, Spatial */}
  </aside>
  <footer className="gv-C__bottom" data-testid="geo-viewer-bottom-mapping">
    {/* GUID to USD Prim Path mapping strip */}
  </footer>
</section>
```

- [ ] **Step 2: Keep runtime evidence separate from IA blocks**

Move role/session into:

```tsx
<div className="gv-C__evidence" data-testid="geo-viewer-runtime-evidence">
  <span>{streamRole === "spectator" ? "SPECTATOR view-only" : "PRIMARY control"}</span>
  <span>{sessionId || "no session"}</span>
  <span>{frameObserved ? "first frame observed" : "first frame not observed"}</span>
</div>
```

- [ ] **Step 3: Add responsive grid CSS**

```css
.gv-C {
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(420px, 1fr) minmax(260px, 320px);
  grid-template-rows: auto minmax(360px, 1fr) minmax(160px, 220px);
  grid-template-areas:
    "evidence evidence evidence"
    "left center right"
    "bottom bottom bottom";
  gap: 8px;
  overflow: hidden;
}
```

- [ ] **Step 4: Run layout test**

```powershell
npx playwright test e2e/gov-viewer-layout.spec.ts --project=chromium
```

Expected after implementation: PASS for C region and single-scroll assertions.

## Task 3: Separate UI-Local Intent From Runtime Mutators

**Files:**
- Modify: `web-viewer-sample/src/Window.tsx`
- Modify: `web-viewer-sample/src/harness/fixtures/`(新增或擴充一個 mapping fixture,比照 `usdStageTree.ts` 既有「in-memory、非網路 fetch」慣例)
- Modify: `web-viewer-sample/src/console/viewer/MappingTable.tsx`(新增可選的 inline items 資料路徑,harness 專用,不動既有 fetch 邏輯)
- Modify(supersedes task#0 的斷言;需在 commit message 說明 plan 修正理由): `web-viewer-sample/e2e/gov-viewer-layout.spec.ts`
- Test: `web-viewer-sample/e2e/runtime-command-bridge.spec.ts`

**2026-07-06 plan 修正(使用者裁決,原始 Step1 撤回)**:原 Step1 要求 `?harness=1` 直接點 mapping-row,但 harness 依 Task1(task#0,已 commit)設計為「無 mapping_url、誠實顯示 mapping-empty」(`MockViewport.tsx:225` 註解 + `gov-viewer-layout.spec.ts:26`),兩者字面互斥。implementer 曾提案「改打真 coordinator session + 誠實 skip」取代,**使用者不接受**,裁決:harness 本身要能提供可點的 mapping-row。

解法(重用既有機制,不新增新的誠實例外):`MappingTable.tsx` 已內建 fake-mapping 誠實標示機制(`isFakeMappingItem`/`isFakeMappingDocument`,判準 `mock===true` 或 `mapping_method==="fake_for_smoke_test"`,對應 UI 有 `data-testid="mapping-fake"` badge + 逐列 fake 標示,不冒充真實對映;見 `src/types/mapping.ts`)。harness 只要餵一份標記為 fake 的 mapping document 給這個既有機制,就能誠實地讓 `mapping-row` 出現在 harness。

- [ ] **Step 0(新增): harness 提供標記為 fake 的 demo mapping**

在 `web-viewer-sample/src/harness/fixtures/`(新檔或加進既有 fixture)新增 2-3 筆 in-memory demo mapping items(`mock: true` 或 `mapping_method: "fake_for_smoke_test"`,`ifc_guid`/`usd_prim_path` 用明顯的 `HARNESS-DEMO-*` 命名,比照 `usdStageTree.ts` 的 `_h_`/`harness://` 前綴慣例避免與真資料混淆)。`MappingTable.tsx` 新增一個可選 prop(例如 `items?: ElementMappingItem[]`),當提供時直接渲染這份 in-memory 資料、跳過 `fetch(mappingUrl)`(harness 本來就是決定性/不連真後端模式,不要為此新增網路請求);沿用元件既有的 fake badge/逐列標示邏輯,不改其行為。`Window.tsx`/`MockViewport.tsx` 在 `harness===true` 時把這份 fixture 傳給 `MappingTable`。

- [ ] **Step 0b(修訂 task#0 斷言): 更新 `gov-viewer-layout.spec.ts`**

harness 模式下不再斷言 `getByTestId("mapping-empty")` 可見;改斷言至少一筆 `mapping-row` 可見,且 `mapping-fake` badge 可見(誠實標示這是 demo 資料,非真實對映)。commit message 需寫明「supersedes task#0 的 mapping-empty 斷言,因使用者裁決 plan Task3 修正而改變 harness 對構表行為」。

- [ ] **Step 1: Add test that mapping row selection is UI-local**(字面可執行,harness 模式下真的有 row 可點)

```ts
test("mapping row selection updates semantic state without sending runtime mutator", async ({ page }) => {
  await page.goto("/?harness=1");
  await page.getByTestId("mapping-row").first().click();
  await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
  await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
  await expect(page.getByTestId("demo-outgoing-log")).not.toContainText("focusPrimRequest");
});
```

- [ ] **Step 2: Add explicit runtime mutator helper**

In `Window.tsx`, keep the existing event names but centralize the classification:

```ts
const runtimeMutatingEvents = new Set([
  "openStageRequest",
  "loadArtifactGroupRequest",
  "composeStageRequest",
  "highlightPrimsRequest",
  "focusPrimRequest",
  "clearHighlightRequest",
  "selectPrimsRequest",
  "makePrimsPickable",
  "resetStage",
]);
```

`composeStageRequest` is included here only because current frontend/harness paths may emit it. Production C runtime proof must use the verified current protocol path: `loadArtifactGroupRequest` with `stage_composition`, plus coordinator `stageBindingApplied` audit, unless implementation explicitly adds and tests a real `composeStageRequest` Kit handler.

- [ ] **Step 3: Gate runtime mutators through one path**

```ts
private _canSendRuntimeMutator(eventType: string): boolean {
  if (!runtimeMutatingEvents.has(eventType)) return true;
  if (isSpectatorStreamMode()) return false;
  if (isBlockedLifecycle(this.state.reviewLifecycleStatus)) return false;
  return true;
}
```

- [ ] **Step 4: Run focused browser tests**

```powershell
npx playwright test e2e/runtime-command-bridge.spec.ts --project=chromium
```

Expected after implementation: UI-local selection does not emit runtime mutators; explicit focus/highlight commands still do when primary and ready.

## Task 4: Preserve Coordinator Boundary

**Files:**
- Modify only if current tests need assertions: `web-viewer-sample/e2e/primary-spectator-authority.spec.ts`
- Keep unless a later implementation phase proves a gap: `bim-review-coordinator/src/app.ts`
- Keep unless a later implementation phase proves a gap: `bim-review-coordinator/src/services/viewerLeaseStore.ts`

- [ ] **Step 1: Assert no generic operations endpoint is introduced**

Add a static test or script assertion:

```powershell
rg -n "/operations|viewer-operations|operation-log" bim-review-coordinator/src web-viewer-sample/src
```

Expected for C: no new generic operation platform route. Existing local words in docs/tests are acceptable only if not an API route.

- [ ] **Step 2: Keep stage-binding lease authority tests passing**

```powershell
npm test -- viewerLease
```

Expected: existing coordinator lease/stage-binding authority tests pass or reveal exact naming for the focused command.

## Task 5: Add Kit-Side Runtime Mutator Authorization

**Files:**
- Modify: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_management.py`
- Modify: `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py`
- Test: nearest streaming messaging test file, selected after impact analysis

- [ ] **Step 1: Run GitNexus impact before editing Python handlers**

```powershell
npx gitnexus analyze
```

Then run GitNexus `impact` or `context` on:

```txt
StageManager._on_select_prims
StageManager._on_highlight_prims
StageManager._on_clear_highlight
StageManager._on_focus_prim
LoadingManager._on_open_stage
LoadingManager._on_load_artifact_group
```

Expected: blast radius reviewed before editing.

- [ ] **Step 2: Add runtime mutator allowlist**

```py
MUTATING_EVENTS = {
    "openStageRequest",
    "loadArtifactGroupRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
    "highlightPrimsRequest",
    "clearHighlightRequest",
    "focusPrimRequest",
}

READONLY_EVENTS = {
    "loadingStateQuery",
    "getChildrenRequest",
}
```

Do not add `composeStageRequest` to the Kit-side formal allowlist unless a real handler is deliberately added in this same implementation slice with tests. Current C production path is `loadArtifactGroupRequest` / `stage_composition`.

- [ ] **Step 3: Add payload authority guard**

```py
def _is_authorized_mutator(payload: dict) -> bool:
    role = str(payload.get("role") or "").lower()
    source_client_id = str(payload.get("source_client_id") or "")
    lease_token = str(payload.get("viewer_lease_token") or "")
    if role != "primary":
        return False
    if not source_client_id and not lease_token:
        return False
    return True
```

Implementation must adapt this helper to existing payload shape and available lease/token evidence. If the current Kit payload lacks enough authority data, the worker must stop and report the missing upstream contract instead of accepting unauthenticated mutators.

- [ ] **Step 4: Add rejection result**

For each mutating handler, reject unauthorized payloads with a result event matching the handler's existing ack style:

```py
{
    "result": "error",
    "error": "unauthorized_mutating_command",
    "reason": "primary lease required",
}
```

- [ ] **Step 5: Run streaming tests**

```powershell
python -m pytest <nearest-streaming-messaging-tests>
```

Expected: unauthorized spectator-like payloads fail; authorized primary-like payloads preserve existing behavior.

## Task 6: Three-Layer Verification Gate

**Files:**
- Modify: `web-viewer-sample/e2e/gov-viewer-layout.spec.ts`
- Modify: `web-viewer-sample/e2e/primary-spectator-authority.spec.ts`
- Modify or create: `web-viewer-sample/e2e/runtime-command-bridge.spec.ts`
- Use real runtime specs when available: `web-viewer-sample/e2e/real-ifc-viewer-lineage.spec.ts`, `web-viewer-sample/e2e/real-ifc-conversion-lineage.spec.ts`

- [ ] **Step 1: Layer 1 contract/unit verification**

```powershell
npm test -- primary-spectator-authority
npm test -- stage-artifact-binding
```

Expected: role/lease/stage-binding checks pass.

- [ ] **Step 2: Layer 2 browser/harness verification**

```powershell
npx playwright test e2e/gov-viewer-layout.spec.ts e2e/primary-spectator-authority.spec.ts --project=chromium
```

Expected: C IA, single-scroll, primary/spectator behavior, and harness command traces pass.

- [ ] **Step 3: Layer 3 real Kit/WebRTC verification**

```powershell
npx playwright test e2e/real-ifc-viewer-lineage.spec.ts e2e/real-ifc-conversion-lineage.spec.ts --project=chromium
```

Expected: real first frame and DataChannel ack evidence collected. If Kit runtime is not available, report this layer as not collected and do not claim full M4 readiness.

## Task 7: Final Detect Changes And Review

**Files:**
- No new file ownership. Parent coordinator task after implementation.

- [ ] **Step 1: Run whitespace check**

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 2: Run GitNexus detect changes**

```powershell
npx gitnexus detect-changes
```

Expected: changed scope matches viewer IA, command bridge, focused tests, and any approved Kit auth hardening.

- [ ] **Step 3: Write final implementation report**

Report:

```txt
Verified facts
Inferences
Unverified risks
Frontend URL
Buttons tested
Test fixture used
Expected visible result
E2E command
Screenshot/evidence path
Known limitations
```

Expected: no full-system E2E claim unless governance CPU semantic E2E and Kit WebRTC runtime E2E are both present.
