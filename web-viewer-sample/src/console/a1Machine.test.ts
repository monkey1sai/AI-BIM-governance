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
  it("RUN 守門:已在 running 時再次 RUN 不重置 in-flight run(防舊 poll 結果污染新 run)", () => {
    // 進 running 並已有一份輪詢中的 run;此時誤觸/雙擊 RUN 必須是 no-op,
    // 否則 run 被清成 null 但 step 仍 running,讓上一輪 poll 的 RUN_DONE 通過守門寫進髒結果。
    let s: A1State = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    s = a1Reducer(s, { type: "RUN" });
    s = a1Reducer(s, { type: "RUN_PROGRESS", run: fakeRun("running") });
    expect(s.step).toBe("running");
    expect(s.run?.rule_run_id).toBe("rr_1");
    const after = a1Reducer(s, { type: "RUN" });
    expect(after).toBe(s); // 完全 no-op,引用不變
    expect(after.run?.rule_run_id).toBe("rr_1"); // in-flight run 仍在,未被清空
  });
  it("重跑(RUN from delivered)清下游旗標但保留 exported artifact", () => {
    // spec §2.1/§5:重跑清下游 state,但已落地 artifact(已匯出檔)保留可見。
    let s: A1State = { ...initialA1State, step: "delivered", ifcPath: "x.ifc", run: fakeRun("succeeded"), issueCount: 3, exported: true };
    s = a1Reducer(s, { type: "RUN" });
    expect(s.step).toBe("running");
    expect(s.run).toBeNull();
    expect(s.exported).toBe(true); // 已匯出 artifact 保留
    expect(s.issueCount).toBe(3); // 已開 Issue artifact 保留
  });
  it("RUN_DONE 守門:非 running 態(舊 poll 回調)不前進 scored", () => {
    // 先 RUN 進 running,再 PICK_FILE 回 picked(清掉 run 上下文);舊 poll 的 RUN_DONE 不得強推 scored
    let s: A1State = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    s = a1Reducer(s, { type: "RUN" });
    const picked = a1Reducer(s, { type: "PICK_FILE", ifcPath: "x.ifc" });
    expect(picked.step).toBe("picked");
    const after = a1Reducer(picked, { type: "RUN_DONE", run: fakeRun("succeeded"), failed: [] });
    expect(after).toBe(picked);
    expect(after.step).toBe("picked");
  });
  it("RUN_FAIL 守門:非 running 態(舊 poll 錯誤回調)不強設 running", () => {
    // PICK_FILE 後處於 picked(沒在跑);舊 poll 的 RUN_FAIL 不得把 step 推回 running
    const picked = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    expect(picked.step).toBe("picked");
    const after = a1Reducer(picked, { type: "RUN_FAIL", error: "stale" });
    expect(after).toBe(picked);
    expect(after.step).toBe("picked");
    expect(after.runError).toBe(false);
  });
  it("uiSteps:idle 全 future、picked 第1點 current、delivered 末點 current", () => {
    expect(uiSteps(initialA1State)).toEqual(["future", "future", "future", "future", "future"]);
    const picked = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    expect(uiSteps(picked)).toEqual(["current", "future", "future", "future", "future"]);
    const delivered: A1State = { ...initialA1State, step: "delivered" };
    expect(uiSteps(delivered)).toEqual(["done", "done", "done", "done", "current"]);
  });
  it("uiSteps:running/scored/issued 中間態逐點推進", () => {
    expect(uiSteps({ ...initialA1State, step: "running" })).toEqual(["done", "current", "future", "future", "future"]);
    expect(uiSteps({ ...initialA1State, step: "scored" })).toEqual(["done", "done", "current", "future", "future"]);
    expect(uiSteps({ ...initialA1State, step: "issued" })).toEqual(["done", "done", "done", "current", "future"]);
  });
});
