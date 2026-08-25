// unified-console-runtime-truth slice 1（tasks 1.3）：共用 poller 的五條義務——同端點單一 in-flight、
// 10s 節奏、指數退避 ≤60s、document.hidden 不發請求、最後訂閱者離開即停；失敗分類；liveFetchers 走 coordinatorClient。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import { CoordinatorStatusStore, classifyFailure, liveFetchers } from "./coordinatorStatusStore";
import { IDLE, idleFetchers, offline503 } from "./__testdata__/coordinatorMocks";

describe("CoordinatorStatusStore", () => {
  let hidden = false;
  let store: CoordinatorStatusStore | null = null;
  beforeEach(() => { vi.useFakeTimers(); hidden = false; });
  afterEach(() => { store?.dispose(); store = null; vi.restoreAllMocks(); vi.useRealTimers(); });

  const make = (fetchers = idleFetchers()) => {
    store = new CoordinatorStatusStore(fetchers, { isHidden: () => hidden, now: () => 1_000 });
    return store;
  };

  it("初始快照全部 offline（尚未收到任何回應＝未連線）", () => {
    const s = make();
    expect(s.getSnapshot().runtimeStatus).toEqual({ data: null, state: "offline", httpStatus: null, message: null, lastUpdatedAt: null });
  });

  it("兩個訂閱者同時 retain 同端點 → 只發一個請求；10s 後才發第二個", async () => {
    let resolve!: (v: typeof IDLE.runtimeStatus) => void;
    const runtimeStatus = vi.fn(() => new Promise<typeof IDLE.runtimeStatus>((r) => { resolve = r; }));
    const s = make({ ...idleFetchers(), runtimeStatus });
    s.retain("runtimeStatus"); s.retain("runtimeStatus");
    expect(runtimeStatus).toHaveBeenCalledTimes(1);
    resolve(IDLE.runtimeStatus);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getSnapshot().runtimeStatus.state).toBe("live");
    expect(s.getSnapshot().runtimeStatus.lastUpdatedAt).toBe(1_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(runtimeStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runtimeStatus).toHaveBeenCalledTimes(2);
  });

  it("連續失敗指數退避 20s→40s→60s（上限 60s），成功後回到 10s", async () => {
    let fail = true;
    const kitHealth = vi.fn(async () => { if (fail) throw offline503("kitHealth"); return IDLE.kitHealth; });
    const s = make({ ...idleFetchers(), kitHealth });
    s.retain("kitHealth");
    await vi.advanceTimersByTimeAsync(0);
    expect(kitHealth).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().kitHealth).toMatchObject({ state: "offline", httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(20_000); expect(kitHealth).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(40_000); expect(kitHealth).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000); expect(kitHealth).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000); expect(kitHealth).toHaveBeenCalledTimes(5);
    fail = false;
    await vi.advanceTimersByTimeAsync(60_000); expect(kitHealth).toHaveBeenCalledTimes(6);
    expect(s.getSnapshot().kitHealth.state).toBe("live");
    await vi.advanceTimersByTimeAsync(10_000); expect(kitHealth).toHaveBeenCalledTimes(7);
  });

  it("document.hidden：不發請求；轉為可見時立即發一輪", async () => {
    hidden = true;
    const issues = vi.fn(async () => IDLE.issues);
    const s = make({ ...idleFetchers(), issues });
    s.retain("issues");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(issues).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(issues).toHaveBeenCalledTimes(1);
  });

  it("最後訂閱者 release 後不再排程", async () => {
    const ruleRuns = vi.fn(async () => IDLE.ruleRuns);
    const s = make({ ...idleFetchers(), ruleRuns });
    s.retain("ruleRuns");
    await vi.advanceTimersByTimeAsync(0);
    s.release("ruleRuns");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ruleRuns).toHaveBeenCalledTimes(1);
    expect(s.refCount("ruleRuns")).toBe(0);
  });

  it("classifyFailure：502/503/504→offline；其他 HTTP→error 帶狀態碼；非 HTTP 錯誤→offline", () => {
    expect(classifyFailure(new CoordinatorHttpError("/x", 503, "d"))).toMatchObject({ state: "offline", httpStatus: 503 });
    expect(classifyFailure(new CoordinatorHttpError("/x", 502, "d"))).toMatchObject({ state: "offline", httpStatus: 502 });
    expect(classifyFailure(new CoordinatorHttpError("/x", 404, "no instance"))).toMatchObject({ state: "error", httpStatus: 404 });
    expect(classifyFailure(new TypeError("fetch failed"))).toMatchObject({ state: "offline", httpStatus: null, message: "fetch failed" });
  });

  it("liveFetchers 在呼叫時才讀 coordinatorClient 屬性（vi.spyOn 可攔截）", async () => {
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(IDLE.runtimeStatus);
    await expect(liveFetchers.runtimeStatus()).resolves.toBe(IDLE.runtimeStatus);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reset（測試用）：清回初始快照、refCount 歸零、不再排程", async () => {
    const minioWatch = vi.fn(async () => IDLE.minioWatch);
    const s = make({ ...idleFetchers(), minioWatch });
    s.retain("minioWatch");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getSnapshot().minioWatch.state).toBe("live");
    s.reset();
    expect(s.refCount("minioWatch")).toBe(0);
    expect(s.getSnapshot().minioWatch.state).toBe("offline");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(minioWatch).toHaveBeenCalledTimes(1);
  });
});
