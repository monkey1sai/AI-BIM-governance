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
