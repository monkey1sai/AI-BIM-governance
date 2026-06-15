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
  it("RUN_DONE 在先前 RUN_FAIL 後把 runError 清回 false(重試成功復原)", () => {
    // 鎖住 a1Machine.ts RUN_DONE handler 清 runError/error:
    // 一次失敗後重觸發 RUN_RETRY 並成功完成,殘留的錯誤旗標必須一併清掉,否則 UI 會永遠掛著紅錯。
    // 注意:此處用 RUN_RETRY(非 RUN)——RUN_FAIL 後 step 仍 running,plain RUN 是 no-op(防雙擊污染),
    // 真正的重試走 running-error 專用的 RUN_RETRY,否則 UI 的「可重試」按鈕點了不會有反應。
    let s: A1State = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    s = a1Reducer(s, { type: "RUN" });
    s = a1Reducer(s, { type: "RUN_FAIL", error: "boom" });
    expect(s.runError).toBe(true);
    s = a1Reducer(s, { type: "RUN_RETRY" }); // 真重試(running-error 子態才有效)
    expect(s.step).toBe("running");
    expect(s.runError).toBe(false); // 重試立刻清掉紅錯旗標(進新一輪 running)
    expect(s.run).toBeNull(); // 重新開跑:清掉上一輪 run 上下文
    s = a1Reducer(s, { type: "RUN_DONE", run: fakeRun("succeeded"), failed: [] });
    expect(s.step).toBe("scored");
    expect(s.runError).toBe(false);
    expect(s.error).toBeNull();
  });
  it("RUN_RETRY 守門:只在 running-error 子態(runError=true)有效,其餘態 no-op", () => {
    // RUN_RETRY 是 RUN_FAIL 後 UI「可重試」按鈕的事件;它必須只在 running-error 子態前進,
    // 不得在 (a) 健康 running(in-flight poll,runError=false)亂清 run 污染新 run,
    // 也不得在 (b) 非 running 態(picked/scored/...)被舊 poll 誤觸而強推狀態。
    // (a) 健康 running(剛 RUN,尚無 RUN_FAIL):RUN_RETRY no-op,引用不變、in-flight run 不被清。
    let live: A1State = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    live = a1Reducer(live, { type: "RUN" });
    live = a1Reducer(live, { type: "RUN_PROGRESS", run: fakeRun("running") });
    expect(live.runError).toBe(false);
    const afterLive = a1Reducer(live, { type: "RUN_RETRY" });
    expect(afterLive).toBe(live); // 完全 no-op
    expect(afterLive.run?.rule_run_id).toBe("rr_1"); // in-flight run 未被清
    // (b) 非 running 態(picked):RUN_RETRY no-op,不強推 running。
    const picked = a1Reducer(initialA1State, { type: "PICK_FILE", ifcPath: "x.ifc" });
    const afterPicked = a1Reducer(picked, { type: "RUN_RETRY" });
    expect(afterPicked).toBe(picked);
    expect(afterPicked.step).toBe("picked");
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
