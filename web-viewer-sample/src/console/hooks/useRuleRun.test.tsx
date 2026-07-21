// useRuleRun 共用 hook（C3 slice 1）單元測試：mock governanceClient，驗證
// 「來源四形 create 路由 → pollGen 輪詢至終態 → failed results 載入」與
// 取消/重試守門語意（對齊 console.test.tsx 既有 A1 頁 client-render 驗收的
// finding#1 / qr-t2 守門，抽 hook 後行為不得回退）。
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { governanceClient } from "../governanceClient";
import type { RuleResultRow, RuleRunStatus } from "../governanceClient";
import { useRuleRun } from "./useRuleRun";
import type { RuleRunOutcome, UseRuleRun } from "./useRuleRun";

const fakeRunStatus = (status: RuleRunStatus["status"]): RuleRunStatus => ({
  rule_run_id: "rr_hook",
  status,
  score: 97,
  rule_set: "default",
  model_version_id: null,
  summary: { total: 5, passed: 4, failed: 1, errored: 0, target_summary: {}, warnings: [] },
});

const failedRow: RuleResultRow = {
  ifc_guid: "guid-1",
  usd_prim_path: null,
  rule_code: "naming",
  severity: "error",
  status: "fail",
  message: "naming rule failed",
};

describe("useRuleRun（共用 rule-run hook：create 路由 + 輪詢 + 守門）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  let root: Root | null = null;
  /** Harness 每次 render 鏡射最新 hook api（測試以此驅動 dispatch / run）。 */
  let latest: UseRuleRun;

  function Harness() {
    latest = useRuleRun();
    return null;
  }

  const mount = async () => {
    root = createRoot(container);
    await act(async () => { root!.render(<Harness />); });
  };
  const unmount = async () => {
    if (root) { await act(async () => { root!.unmount(); }); root = null; }
  };
  const pickFile = async (ifcPath = "C:/storage/270/model.ifc", modelVersionId = "mv-1") => {
    await act(async () => { latest.dispatch({ type: "PICK_FILE", ifcPath, modelVersionId }); });
  };

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(async () => {
    await unmount();
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("direct 來源：createRuleRun → 輪詢 running→succeeded → RUN_DONE scored + failed rows 載入", async () => {
    const createSpy = vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    const getSpy = vi.spyOn(governanceClient, "getRuleRun")
      .mockResolvedValueOnce(fakeRunStatus("running"))
      .mockResolvedValue(fakeRunStatus("succeeded"));
    const resultsSpy = vi.spyOn(governanceClient, "getResults").mockResolvedValue([failedRow]);

    await mount();
    await pickFile();
    expect(latest.state.step).toBe("picked");

    let outcome: RuleRunOutcome | null = null;
    await act(async () => {
      const p = latest.run({ kind: "direct", request: { ifc_source_path: "C:/storage/270/model.ifc" } })
        .then((o) => { outcome = o; });
      // 第一輪 running → setTimeout(1000) → 第二輪 succeeded。
      await vi.advanceTimersByTimeAsync(1000);
      await p;
    });

    expect(createSpy).toHaveBeenCalledWith({ ifc_source_path: "C:/storage/270/model.ifc" });
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(resultsSpy).toHaveBeenCalledWith("rr_hook", "failed");
    expect(latest.state.step).toBe("scored");
    expect(latest.state.failed).toEqual([failedRow]);
    expect(latest.runId).toBe("rr_hook");
    expect(outcome).toMatchObject({ kind: "succeeded" });
  });

  it("來源路由：for-session / for-ifc-ready / for-library 分別走對應 governanceClient create 函式", async () => {
    const sessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    const ifcReadySpy = vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    const librarySpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await mount();

    await pickFile("session://s-1");
    await act(async () => { await latest.run({ kind: "for-session", sessionId: "s-1", body: { ids_path: "rules/a.ids" } }); });
    expect(sessionSpy).toHaveBeenCalledWith("s-1", { ids_path: "rules/a.ids" });

    await pickFile("ifc-ready://job-1");
    await act(async () => { await latest.run({ kind: "for-ifc-ready", ifcReadyJobId: "job-1", body: {} }); });
    expect(ifcReadySpy).toHaveBeenCalledWith("job-1", {});

    await pickFile("library://270/建築/model.ifc");
    const libraryRequest = { project_id: "270", model_id: "建築", version_name: "model.ifc" };
    await act(async () => { await latest.run({ kind: "for-library", request: libraryRequest }); });
    expect(librarySpy).toHaveBeenCalledWith(libraryRequest);
  });

  it("idle / 未選檔：run() 誠實回 not_ready，不發任何 create 請求", async () => {
    const createSpy = vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    await mount();
    let outcome: RuleRunOutcome | null = null;
    await act(async () => {
      outcome = await latest.run({ kind: "direct", request: { ifc_source_path: "C:/x.ifc" } });
    });
    expect(outcome).toEqual({ kind: "not_ready" });
    expect(createSpy).not.toHaveBeenCalled();
    expect(latest.state.step).toBe("idle");
  });

  it("preflight 回錯誤字串 → RUN_FAIL（running-error 子態），不發 create；outcome=preflight_failed", async () => {
    const createSpy = vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    await mount();
    await pickFile();
    let outcome: RuleRunOutcome | null = null;
    await act(async () => {
      outcome = await latest.run(
        { kind: "direct", request: { ifc_source_path: "C:/x.ifc" } },
        { preflight: async () => "source IFC artifact stale before rule-run: source_ifc_exists=false" },
      );
    });
    expect(outcome).toEqual({ kind: "preflight_failed", error: "source IFC artifact stale before rule-run: source_ifc_exists=false" });
    expect(createSpy).not.toHaveBeenCalled();
    expect(latest.state.step).toBe("running");
    expect(latest.state.runError).toBe(true);
    expect(latest.state.error).toContain("stale");
  });

  it("[finding#1 鏡射] 輪詢中 unmount → 迴圈停止，不再發 getRuleRun；outcome=cancelled", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    const getSpy = vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("running"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await mount();
    await pickFile();
    let outcomePromise: Promise<RuleRunOutcome> | null = null;
    await act(async () => {
      outcomePromise = latest.run({ kind: "direct", request: { ifc_source_path: "C:/x.ifc" } });
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsBeforeUnmount = getSpy.mock.calls.length;
    expect(callsBeforeUnmount).toBeGreaterThanOrEqual(1);

    await unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(getSpy.mock.calls.length).toBe(callsBeforeUnmount);
    await expect(outcomePromise!).resolves.toEqual({ kind: "cancelled" });
  });

  it("[qr-t2-pollgen-race 鏡射] createRuleRun await 期間 PICK_FILE → 取消生效，getRuleRun 不發", async () => {
    let resolveCreate!: (v: { rule_run_id: string; status: string }) => void;
    vi.spyOn(governanceClient, "createRuleRun").mockReturnValue(
      new Promise((res) => { resolveCreate = res; }),
    );
    const getSpy = vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("running"));

    await mount();
    await pickFile();
    let outcomePromise: Promise<RuleRunOutcome> | null = null;
    await act(async () => {
      outcomePromise = latest.run({ kind: "direct", request: { ifc_source_path: "C:/x.ifc" } });
    });
    expect(getSpy).not.toHaveBeenCalled();

    // createRuleRun 仍 pending 時 PICK_FILE → step running→picked → pollGen 遞增（取消本輪）。
    await pickFile("C:/storage/270/other.ifc");
    resolveCreate({ rule_run_id: "rr_hook", status: "queued" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

    expect(getSpy).not.toHaveBeenCalled();
    await expect(outcomePromise!).resolves.toEqual({ kind: "cancelled" });
  });

  it("[qr-t2-terminal-status-whitelist 鏡射] errored（union 外 terminal）→ 一次即 RUN_FAIL，不空轉", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    const erroredStatus = { ...fakeRunStatus("running"), status: "errored" } as unknown as RuleRunStatus;
    const getSpy = vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(erroredStatus);

    await mount();
    await pickFile();
    let outcome: RuleRunOutcome | null = null;
    await act(async () => {
      outcome = await latest.run({ kind: "direct", request: { ifc_source_path: "C:/x.ifc" } });
    });
    expect(getSpy.mock.calls.length).toBe(1);
    expect(outcome).toMatchObject({ kind: "failed", error: "rule-run errored" });
    expect(latest.state.step).toBe("running");
    expect(latest.state.runError).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(getSpy.mock.calls.length).toBe(1);
  });

  it("running-error 子態重試：第二次 run() 走 RUN_RETRY 真重啟輪詢 → scored", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    const getSpy = vi.spyOn(governanceClient, "getRuleRun")
      .mockResolvedValueOnce(fakeRunStatus("failed"))
      .mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await mount();
    await pickFile();
    let first: RuleRunOutcome | null = null;
    await act(async () => {
      first = await latest.run({ kind: "direct", request: { ifc_source_path: "C:/x.ifc" } });
    });
    expect(first).toMatchObject({ kind: "failed", error: "rule-run failed" });
    expect(latest.state.runError).toBe(true);

    const callsAfterFail = getSpy.mock.calls.length;
    let second: RuleRunOutcome | null = null;
    await act(async () => {
      second = await latest.run({ kind: "direct", request: { ifc_source_path: "C:/x.ifc" } });
    });
    expect(getSpy.mock.calls.length).toBeGreaterThan(callsAfterFail);
    expect(second).toMatchObject({ kind: "succeeded" });
    expect(latest.state.step).toBe("scored");
    expect(latest.state.runError).toBe(false);
  });

  it("enrichFailed：成功時取代 failed rows；丟例外時 best-effort 保留原 rows", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_hook", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([failedRow]);

    await mount();
    await pickFile();
    const enriched: RuleResultRow = { ...failedRow, usd_prim_path: "/World/x" };
    await act(async () => {
      await latest.run(
        { kind: "direct", request: { ifc_source_path: "C:/x.ifc" } },
        { enrichFailed: async () => [enriched] },
      );
    });
    expect(latest.state.failed).toEqual([enriched]);

    // 重跑：enrich 丟例外 → 保留 getResults 原 rows，RUN_DONE 照常。
    await act(async () => {
      await latest.run(
        { kind: "direct", request: { ifc_source_path: "C:/x.ifc" } },
        { enrichFailed: async () => { throw new Error("mapping offline"); } },
      );
    });
    expect(latest.state.step).toBe("scored");
    expect(latest.state.failed).toEqual([failedRow]);
  });

  it("create 例外 → RUN_FAIL String(e)；outcome=failed run:null", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("governance 502"));
    await mount();
    await pickFile();
    let outcome: RuleRunOutcome | null = null;
    await act(async () => {
      outcome = await latest.run({ kind: "direct", request: { ifc_source_path: "C:/x.ifc" } });
    });
    expect(outcome).toMatchObject({ kind: "failed", run: null });
    expect(latest.state.runError).toBe(true);
    expect(latest.state.error).toContain("governance 502");
  });
});
