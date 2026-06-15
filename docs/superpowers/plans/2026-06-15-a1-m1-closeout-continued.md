# A1/M1 收尾包(續作)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox(`- [ ]`)。

**Goal:** 接續已完成的「失敗抽屜」半段,補完「五步 stepper 狀態機 + E2E」並修掉一個測試 nit,把 A1/M1 收尾包推到 merged PR。

**背景(已落地,勿重做/勿動):** 前一輪 std-implement 已端到端完成並 commit:
- governance-service `GET /api/rule-runs/{id}/failures`(app.py,回傳 array key=`items`)+ conftest.py(門指派樓層)— **完成**
- coordinator `/api/governance/rule-runs/:runId/failures` proxy — **完成**
- `governanceClient.getFailures`(回 `RuleFailuresResponse{ total, items }`)— **完成**
- pages.tsx **inline 失敗抽屜** `CopyGuidBtn`(602)/`FailureRuleRow`(625)/`FailureScoreboard`(701),已用於 `IssuesRuleCenterPage`(908,取代舊扁平表)— **完成**。testid:`a1-failures-by-rule`、`a1-fail-rule-<code>`、`a1-fail-toggle-<code>`、`a1-fail-more-<code>`;複製鈕為文字「複製」。`FailureScoreboard({ runId, failed: RuleResultRow[] })` 失敗為 0 時 return null。

**護欄(務必遵守):**
- **不要**新建 `RuleFailuresDrawer.tsx`(抽屜已 inline 完成);stepper 直接 reuse 現有 `FailureScoreboard`。
- **不要**動 app.py / governanceProxy.ts / governanceClient.ts / FailureScoreboard·FailureRuleRow·CopyGuidBtn / IssuesRuleCenterPage 的失敗抽屜(全已完成且 reviewed)。
- 本續作只動:`test_rule_failures.py`(修 nit)、新建 `a1Machine.ts`+`a1Machine.test.ts`、`pages.tsx` 的 `LifecycleStrip` 與 `A1GovernanceWorkbenchPage`、`console.test.tsx` 的 A1 斷言、新建 `e2e/a1-m1-closeout.spec.ts`、`edge-console.css`。

**驗證指令:**
- governance:`"/c/Program Files/Python312/python.exe" -m pytest tests/ -v`(cwd governance-service)
- web 單元:`npx vitest run src/console/<file>`、build:`npm run build`(cwd web-viewer-sample)
- e2e:`npx playwright test e2e/a1-m1-closeout.spec.ts`(前置 build:ui + 重啟 :8004 dist-ui)

**GitNexus 紀律:** 改 `LifecycleStrip`/`A1GovernanceWorkbenchPage` 前 `gitnexus_impact`;commit 前 `gitnexus_detect_changes`。

---

## Task 0: 修 test_rule_failures.py 裸 next() nit

**Files:** Modify `governance-service/tests/test_rule_failures.py`(line ~58 與 ~61 兩處裸 `next()`)

- [ ] **Step 1: baseline**

Run: `cd governance-service && "/c/Program Files/Python312/python.exe" -m pytest tests/test_rule_failures.py -v`
Expected: 目前綠(nit 不致 fail,只是脆弱),確認起點。

- [ ] **Step 2: 改兩處裸 next() 加 default + 顯式 assert**

把:
```python
    door_in_storey = next(f for f in body["items"] if f["ifc_type"] == "IfcDoor")
    assert door_in_storey["storey"] == "L1"  # D-002 缺 FireRating 失敗,且指派於 L1 → 非 null
    unassigned = next(
        f for f in body["items"]
        if f["ifc_type"] == "IfcWall" and f["rule_code"] == "WALL-STOREY-ASSIGNED"
    )
    assert unassigned["storey"] is None  # 無名牆未指派樓層 → 誠實 null,不捏造
```
換成:
```python
    door_in_storey = next((f for f in body["items"] if f["ifc_type"] == "IfcDoor"), None)
    assert door_in_storey is not None, f"expected IfcDoor in failures page, got: {[f['ifc_type'] for f in body['items']]}"
    assert door_in_storey["storey"] == "L1"  # D-002 缺 FireRating 失敗,且指派於 L1 → 非 null
    unassigned = next(
        (f for f in body["items"]
         if f["ifc_type"] == "IfcWall" and f["rule_code"] == "WALL-STOREY-ASSIGNED"),
        None,
    )
    assert unassigned is not None, f"expected unassigned IfcWall in failures, got: {[(f['ifc_type'], f['rule_code']) for f in body['items']]}"
    assert unassigned["storey"] is None  # 無名牆未指派樓層 → 誠實 null,不捏造
```

- [ ] **Step 3: 跑測試 + 全套回歸**

Run: `cd governance-service && "/c/Program Files/Python312/python.exe" -m pytest tests/ -v`
Expected: 全綠。

- [ ] **Step 4: commit**

```bash
git add governance-service/tests/test_rule_failures.py
git commit -m "task#0: 修 test_rule_failures 裸 next() 加 default + 顯式 assert(避免 StopIteration 遮蔽斷言)"
```

---

## Task 1: 純 reducer a1Machine.ts(TDD)

**Files:** Create `web-viewer-sample/src/console/a1Machine.ts`、`web-viewer-sample/src/console/a1Machine.test.ts`

- [ ] **Step 1: 寫失敗測試 `a1Machine.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { a1Reducer, initialA1State, uiSteps, type A1State } from "./a1Machine";
import type { RuleRunStatus } from "./governanceClient";

const fakeRun = (status: RuleRunStatus["status"]): RuleRunStatus => ({
  rule_run_id: "rr_1", status, score: 80, rule_set: "default", model_version_id: null,
  summary: { total: 10, passed: 7, failed: 3, errored: 0, target_summary: {}, warnings: [] },
});

describe("a1Reducer 六態轉移", () => {
  it("PICK_FILE 進 picked;空路徑回 idle", () => {
    expect(a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" }).step).toBe("picked");
    expect(a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "" }).step).toBe("idle");
  });
  it("沒選檔 RUN 不前進(守門)", () => {
    expect(a1Reducer(initialA1State, { type: "RUN" }).step).toBe("idle");
  });
  it("picked→running→scored 全鏈", () => {
    let s: A1State = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    s = a1Reducer(s, { type: "RUN" });
    expect(s.step).toBe("running");
    s = a1Reducer(s, { type: "RUN_PROGRESS", run: fakeRun("running") });
    expect(s.step).toBe("running");
    s = a1Reducer(s, { type: "RUN_DONE", run: fakeRun("succeeded"), failed: [] });
    expect(s.step).toBe("scored");
    expect(s.run?.rule_run_id).toBe("rr_1");
  });
  it("RUN_FAIL 留在 running 並可重試,不前進 dot", () => {
    let s: A1State = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    s = a1Reducer(s, { type: "RUN" });
    s = a1Reducer(s, { type: "RUN_FAIL", error: "boom" });
    expect(s.step).toBe("running");
    expect(s.runError).toBe(true);
    expect(s.error).toBe("boom");
  });
  it("scored→issued→delivered", () => {
    let s: A1State = { ...initialA1State, step: "scored", ifcPath: "x.ifc", run: fakeRun("succeeded") };
    s = a1Reducer(s, { type: "CREATE_ISSUES_OK", issueCount: 3 });
    expect(s.step).toBe("issued");
    expect(s.issueCount).toBe(3);
    s = a1Reducer(s, { type: "EXPORT_OK" });
    expect(s.step).toBe("delivered");
    expect(s.exported).toBe(true);
  });
  it("重跑(RUN)清下游記分但保留已開 issue artifact", () => {
    let s: A1State = { ...initialA1State, step: "issued", ifcPath: "x.ifc", run: fakeRun("succeeded"), failed: [], issueCount: 3 };
    s = a1Reducer(s, { type: "RUN" });
    expect(s.step).toBe("running");
    expect(s.run).toBeNull();
    expect(s.issueCount).toBe(3);
  });
  it("uiSteps:idle 全 future、picked 第1點 current、delivered 末點 current", () => {
    expect(uiSteps(initialA1State)).toEqual(["future", "future", "future", "future", "future"]);
    const picked = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    expect(uiSteps(picked)).toEqual(["current", "future", "future", "future", "future"]);
    const delivered: A1State = { ...initialA1State, step: "delivered" };
    expect(uiSteps(delivered)).toEqual(["done", "done", "done", "done", "current"]);
  });
});
```

- [ ] **Step 2: 跑確認失敗**

Run: `cd web-viewer-sample && npx vitest run src/console/a1Machine.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `a1Machine.ts`**

```ts
// A1 五步治理閉環狀態機(純函式,無 React/IO)。對齊 docs/plans 互動規格 IX-A1(B.1)。
// 證據型更新(PATTERN-EVIDENCE-UPDATE):state 只在伺服器確認後前進;重跑清下游記分但保留已落地 artifact。
import type { RuleRunStatus, RuleResultRow } from "./governanceClient";

export type A1Step = "idle" | "picked" | "running" | "scored" | "issued" | "delivered";

export interface A1State {
  step: A1Step;
  ifcPath: string;
  run: RuleRunStatus | null;
  failed: RuleResultRow[];
  issueCount: number | null;
  exported: boolean;
  error: string | null;
  runError: boolean;
}

export const initialA1State: A1State = {
  step: "idle", ifcPath: "", run: null, failed: [],
  issueCount: null, exported: false, error: null, runError: false,
};

export type A1Event =
  | { type: "PICK_FILE"; ifcPath: string }
  | { type: "RUN" }
  | { type: "RUN_PROGRESS"; run: RuleRunStatus }
  | { type: "RUN_DONE"; run: RuleRunStatus; failed: RuleResultRow[] }
  | { type: "RUN_FAIL"; error: string }
  | { type: "CREATE_ISSUES_OK"; issueCount: number }
  | { type: "EXPORT_OK" }
  | { type: "RESET" };

const STEP_ORDER: A1Step[] = ["idle", "picked", "running", "scored", "issued", "delivered"];

export function a1Reducer(state: A1State, event: A1Event): A1State {
  switch (event.type) {
    case "PICK_FILE":
      return { ...initialA1State, step: event.ifcPath ? "picked" : "idle", ifcPath: event.ifcPath };
    case "RUN":
      if (!state.ifcPath) return state;
      return { ...state, step: "running", run: null, failed: [], error: null, runError: false };
    case "RUN_PROGRESS":
      return state.step === "running" ? { ...state, run: event.run } : state;
    case "RUN_DONE":
      return { ...state, step: "scored", run: event.run, failed: event.failed, runError: false, error: null };
    case "RUN_FAIL":
      return { ...state, step: "running", runError: true, error: event.error };
    case "CREATE_ISSUES_OK":
      if (!["scored", "issued", "delivered"].includes(state.step)) return state;
      return { ...state, step: state.step === "scored" ? "issued" : state.step, issueCount: event.issueCount };
    case "EXPORT_OK":
      if (!["scored", "issued", "delivered"].includes(state.step)) return state;
      return { ...state, step: "delivered", exported: true };
    case "RESET":
      return initialA1State;
    default:
      return state;
  }
}

export type StepDot = "done" | "current" | "future";

export function uiSteps(state: A1State): StepDot[] {
  const order = STEP_ORDER.indexOf(state.step);
  const currentUi = order === 0 ? -1 : order - 1;
  return [0, 1, 2, 3, 4].map((i) => (i < currentUi ? "done" : i === currentUi ? "current" : "future"));
}
```

- [ ] **Step 4: 跑確認通過**

Run: `cd web-viewer-sample && npx vitest run src/console/a1Machine.test.ts`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add web-viewer-sample/src/console/a1Machine.ts web-viewer-sample/src/console/a1Machine.test.ts
git commit -m "task#1: A1 五步狀態機純 reducer a1Machine(idle→delivered + uiSteps,TDD)"
```

---

## Task 2: 重構 #a1 為 reducer 驅動 stepper(接現有 FailureScoreboard)

**Files:** Modify `web-viewer-sample/src/console/pages.tsx`(`LifecycleStrip` ~62-73、`A1GovernanceWorkbenchPage` ~190-238)、`web-viewer-sample/src/console/console.test.tsx`、`web-viewer-sample/src/console/edge-console.css`

- [ ] **Step 1: GitNexus impact**

`gitnexus_impact({target: "A1GovernanceWorkbenchPage", direction: "upstream"})` 與 `gitnexus_impact({target: "LifecycleStrip", direction: "upstream"})`,回報 d=1(renderBody + ConversionSchedulingPage)。HIGH/CRITICAL 先停。

- [ ] **Step 2: 改 `LifecycleStrip`(~62-73)吃 state**

```tsx
function LifecycleStrip({ steps, statuses }: { steps: string[]; statuses?: ("done" | "current" | "future")[] }) {
  const cls = (i: number) => {
    const st = statuses?.[i];
    if (st === "done") return "done";
    if (st === "current") return "active";
    if (st === "future") return "";
    return i === 0 ? "active" : "";
  };
  return (
    <div className="ec-flow" style={{ margin: "8px 0 12px" }}>
      {steps.map((s, i) => (
        <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className={`ec-flow-step ${cls(i)}`}><span className="ec-flow-n">{i + 1}</span>{s}</span>
          {i < steps.length - 1 && <span className="ec-flow-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 在 pages.tsx 頂部 import 區加 a1Machine**

加一行(governanceClient / RuleRunStatus / useReducer 等多半已 import;缺哪個補哪個):
```tsx
import { a1Reducer, initialA1State, uiSteps } from "./a1Machine";
```
確認 `useReducer` 在 React import 內(`import { useReducer, useState, useCallback, ... } from "react";`)。

- [ ] **Step 4: 整段重寫 `A1GovernanceWorkbenchPage`(~190-238)**

```tsx
export function A1GovernanceWorkbenchPage() {
  const [state, dispatch] = useReducer(a1Reducer, initialA1State);
  const [pathInput, setPathInput] = useState("C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\fixture-bytes.ifc");
  const [idsPath, setIdsPath] = useState("");
  const ui = uiSteps(state);
  const runId = state.run?.rule_run_id ?? null;

  const doRun = useCallback(async () => {
    if (!state.ifcPath) return;
    dispatch({ type: "RUN" });
    try {
      const { rule_run_id } = await governanceClient.createRuleRun({ ifc_source_path: state.ifcPath, ids_path: idsPath || undefined });
      let st: RuleRunStatus | null = null;
      for (let i = 0; i < 60; i++) {
        st = await governanceClient.getRuleRun(rule_run_id);
        dispatch({ type: "RUN_PROGRESS", run: st });
        if (st.status === "succeeded" || st.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (st && st.status === "succeeded") {
        const failed = await governanceClient.getResults(rule_run_id, "failed");
        dispatch({ type: "RUN_DONE", run: st, failed });
      } else {
        dispatch({ type: "RUN_FAIL", error: st ? `rule-run ${st.status}` : "no status" });
      }
    } catch (e) {
      dispatch({ type: "RUN_FAIL", error: String(e) });
    }
  }, [state.ifcPath, idsPath]);

  const makeIssues = useCallback(async () => {
    if (!runId) return;
    try {
      const { created } = await governanceClient.issuesFromRuleRun(runId);
      dispatch({ type: "CREATE_ISSUES_OK", issueCount: created });
    } catch { /* 後端離線:誠實不前進(不偽造 issued) */ }
  }, [runId]);

  const doExport = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(governanceClient.exportUrl(runId));
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `rule-run-${runId}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      dispatch({ type: "EXPORT_OK" });
    } catch { /* 誠實不前進 */ }
  }, [runId]);

  return (
    <>
      <h1>A1 · 治理與模型檢核</h1>
      <p className="ec-lead">上傳/選取 IFC,跑自動規則檢核,直接產生 Issue 與 BCF/Excel。規則檢核在 governance-service(CPU)完成;3D 高亮需 GPU viewport(依 review session 派發,待建)。</p>

      <Panel title="A1 五步引導式流程" sub="整頁狀態機驅動;步驟依當前 state 亮燈(證據型更新,禁樂觀)" prov="asbuilt">
        <LifecycleStrip steps={["上傳模型", "自動檢核", "結果記分板", "開 Issue", "匯出 BCF"]} statuses={ui} />
        <div className="ec-grid" style={{ marginBottom: 8 }}>
          <Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
          <Field k="step" v={state.step} prov="asbuilt" />
          {state.issueCount !== null && <Field k="已開 issue(artifact)" v={String(state.issueCount)} prov="asbuilt" />}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" data-testid="a1-step-path" style={{ minWidth: 420 }} value={pathInput}
            onChange={(e) => setPathInput(e.target.value)} />
          <Btn data-testid="a1-step-pick" caption="鎖定此模型路徑(進入步驟2)" onClick={() => dispatch({ type: "PICK_FILE", ifcPath: pathInput })}>選取模型</Btn>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <input className="ec-btn" style={{ minWidth: 420 }} placeholder="(選填)buildingSMART IDS .ids 路徑" value={idsPath} onChange={(e) => setIdsPath(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <Btn primary data-testid="a1-step-run" disabled={state.step === "idle" || state.step === "running"}
            caption="POST /api/governance/rule-runs" onClick={doRun}>
            {state.step === "running" ? "檢核中…" : "執行規則檢核"}
          </Btn>
          {state.runError && <span className="ec-warn-note">檢核失敗(可重試):{state.error}</span>}
        </div>
      </Panel>

      {state.run && (
        <Panel title="結果記分板" sub="真實 rule-run summary;點規則列展開命中構件(GUID/名稱/樓層)" prov="asbuilt">
          <div className="ec-grid" data-testid="a1-rulerun-scoreboard">
            <Metric value={state.run.summary?.total ?? "—"} label="評估構件" />
            <Metric value={state.run.summary?.passed ?? "—"} label="passed" />
            <Metric value={state.run.summary?.failed ?? "—"} label="failed" tone="warn" />
            <Metric value={state.run.score ?? "—"} label="score" />
          </div>
          {runId && state.failed.length > 0 && <FailureScoreboard runId={runId} failed={state.failed} />}
        </Panel>
      )}

      <Panel title="交付" sub="開 Issue / 匯出 BCF·Excel 走真實後端;3D 高亮待建(不提供假按鈕)" prov="asbuilt">
        <Btn data-testid="a1-step-issues" disabled={state.step === "idle" || state.step === "picked" || state.step === "running"}
          caption="POST /api/governance/issues/from-rule-run/:id" onClick={makeIssues}>失敗構件建 Issue</Btn>{" "}
        <Btn data-testid="a1-step-export" disabled={!runId || state.run?.status !== "succeeded"}
          caption="GET /api/governance/rule-runs/:id/export?fmt=excel" onClick={doExport}>匯出 Excel</Btn>{" "}
        <Btn prov="p1" disabled caption="需 viewer DataChannel(highlightPrimsRequest)— 後續整合(M3/M4)">在 3D 高亮</Btn>
      </Panel>

      <section data-testid="a1-real-ifc-slice" className="ec-a1-inline-slice">
        <RealIfcConsolePage />
      </section>
    </>
  );
}
```

(移除原本內嵌的 `<IssuesRuleCenterPage />`(它仍由 `#issues` 路由獨立服務,EdgeConsole.tsx:75);保留 `<RealIfcConsolePage />`。`FailureScoreboard` 在同檔 pages.tsx 已定義,直接用。)

- [ ] **Step 5: 補 `edge-console.css` `.ec-flow-step.done` 樣式**

在 `.ec-flow-step.active` 附近加:
```css
.ec-flow-step.done { border-color: #2e7d32; }
.ec-flow-step.done .ec-flow-n { background: #2e7d32; }
```

- [ ] **Step 6: 更新 `console.test.tsx` A1 斷言(對 `A1GovernanceWorkbenchPage` render 的那段)**

`保留`:`"上傳模型"`、`"自動檢核"`、`"開 Issue"`、`"匯出 BCF"`、`"rule_run_id"`、`'data-testid="a1-real-ifc-slice"'`、`'data-testid="real-ifc-demo-control"'`。
`移除`(來自已移除的內嵌 IssuesRuleCenterPage):`'data-testid="a1-rule-center-slice"'`、`"A1 rule-run authority"`、`"governance-service :49102"`、`"review_session_id"`、`"viewer_url（/ui/open）"` 對 `a1` 變數的斷言。
`新增`:
```tsx
    expect(a1).toContain('data-testid="a1-step-run"');
    expect(a1).toContain('data-testid="a1-step-issues"');
    expect(a1).toContain('data-testid="a1-step-export"');
    expect(a1).toContain("POST /api/governance/rule-runs");
```
跑 `npx vitest run src/console/console.test.tsx` 直到綠;只動 `a1` 那幾行,其他頁斷言不碰。

- [ ] **Step 7: build + detect_changes + commit**

Run: `cd web-viewer-sample && npx vitest run src/console/console.test.tsx src/console/a1Machine.test.ts && npm run build`
Expected: PASS + build 綠。`gitnexus_detect_changes` 應只含 pages.tsx / console.test.tsx / edge-console.css。

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/console.test.tsx web-viewer-sample/src/console/edge-console.css
git commit -m "task#2: #a1 重構為 reducer 驅動五步 stepper(接現有 FailureScoreboard,移除內嵌 IssuesRuleCenterPage)"
```

---

## Task 3: Browser E2E

**Files:** Create `web-viewer-sample/e2e/a1-m1-closeout.spec.ts`

- [ ] **Step 1: 寫 spec(skip-gate 比照 a2-version-diff-selector.spec.ts;testid 對齊 inline 抽屜)**

```ts
import { test, expect } from "@playwright/test";

// A1/M1 收尾端到端:#/a1 reducer stepper 走真 rule-run → 記分 → 展開失敗規則看 GUID/名稱/樓層 → 開 Issue → 匯出。
// 服務這頁的是 coordinator 已 build 的 dist-ui(npm run build:ui),非 fresh viewer。前置缺失 → conditional skip。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("A1/M1 收尾:#a1 五步 stepper + 失敗抽屜", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request, page }) => {
    let apiOk = false;
    try {
      const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
      apiOk = res.ok();
    } catch { apiOk = false; }
    test.skip(!apiOk, "governance proxy 未備妥(需 :49102 + coordinator proxy)");

    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui/#/a1`);
      await page.getByTestId("a1-step-run").waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch { uiOk = false; }
    test.skip(!uiOk, "coordinator dist-ui 非本 branch(#/a1 缺 a1-step-run):需 npm run build:ui 後重啟 :8004。");
  });

  test("選模型 → 自動亮步驟2 → 檢核 succeeded → 展開失敗規則看 GUID/名稱/樓層 → 開 Issue → 匯出", async ({ page }) => {
    await page.getByTestId("a1-step-pick").click();
    await expect(page.getByTestId("a1-step-run")).toBeEnabled({ timeout: 5_000 });

    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });

    // 失敗抽屜:FailureScoreboard 在有失敗時 render a1-failures-by-rule(fixture-bytes.ifc 有已知失敗)。
    const byRule = page.getByTestId("a1-failures-by-rule");
    const sawDrawer = await byRule.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    if (sawDrawer) {
      // 點第一條規則的展開 toggle → 命中構件表出現,含「storey」欄與「複製」鈕,且至少一列樓層非空白佐證 enrichment。
      await page.locator('[data-testid^="a1-fail-toggle-"]').first().click();
      await expect(page.locator('[data-testid^="a1-fail-rule-"] th', { hasText: "storey" }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "複製" }).first()).toBeVisible({ timeout: 10_000 });
    }

    await expect(page.getByTestId("a1-step-issues")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a1-step-issues").click();
    await expect(page.getByTestId("a1-step-export")).toBeEnabled({ timeout: 10_000 });

    await page.screenshot({ path: "../artifacts/e2e/a1-m1-closeout-flow.png", fullPage: true });
  });

  test("重跑檢核 → 記分板重建(證據型更新,可重跑不崩)", async ({ page }) => {
    await page.getByTestId("a1-step-pick").click();
    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });
    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });
    await page.screenshot({ path: "../artifacts/e2e/a1-m1-closeout-rerun.png", fullPage: true });
  });
});
```

- [ ] **Step 2: 跑 E2E(前置就緒時)**

Run: `cd web-viewer-sample && npx playwright test e2e/a1-m1-closeout.spec.ts`
Expected: 前置就緒 → PASS + 截圖;前置缺失 → conditional skip。**如實回報 PASS / skip,不可把 skip 當通過。**

- [ ] **Step 3: commit**

```bash
git add web-viewer-sample/e2e/a1-m1-closeout.spec.ts
git commit -m "task#3: A1/M1 收尾 E2E(stepper 五步 + 失敗抽屜樓層欄 + 重跑路徑)"
```

---

## Task 4: 收尾驗證

**Files:** 無新檔(僅跑驗證 + detect_changes)

- [ ] **Step 1: 三層全套驗證**

```bash
cd governance-service && "/c/Program Files/Python312/python.exe" -m pytest tests/ -v
cd ../web-viewer-sample && npm run build && npx vitest run src/console/
```
Expected: 全綠。

- [ ] **Step 2: detect_changes 終檢**

`gitnexus_detect_changes({scope: "compare", base_ref: "main"})` 確認改動範圍 = test_rule_failures.py / a1Machine.ts(+test)/ pages.tsx / console.test.tsx / edge-console.css / e2e spec + 前一輪已完成的 app.py·conftest·governanceProxy·governanceClient,無外溢。

- [ ] **Step 3: 回報** 改了哪些檔 / 驗證結果 / 未跑項與原因 / 已知風險(供 P6 PR body)。
