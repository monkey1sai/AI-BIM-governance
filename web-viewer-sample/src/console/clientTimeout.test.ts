// F12（2026-07-10）：共用 fetch 原語內建 AbortSignal.timeout——wedged socket 不再讓
// 呼叫端 busy 永久卡住（SharedStatusProvider 的 watchdog 降為第二道保險）。
// 測試用 __setFetchTimeoutMsForTests 縮短逾時，stub fetch 為「永不 resolve、只聽 abort」。
import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, __setFetchTimeoutMsForTests } from "./coordinatorClient";
import { governanceClient, __setGovFetchTimeoutMsForTests } from "./governanceClient";

function wedgedFetch() {
  return vi.fn((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
    }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  __setFetchTimeoutMsForTests(null);
  __setGovFetchTimeoutMsForTests(null);
});

describe("F12 fetch 原語 timeout", () => {
  it("coordinatorClient jsonGet：socket 卡死時在逾時內 reject（不永久 pending）", async () => {
    vi.stubGlobal("fetch", wedgedFetch());
    __setFetchTimeoutMsForTests(50);
    await expect(coordinatorClient.health()).rejects.toThrow(/timed out|timeout|abort/i);
  }, 5000);

  it("coordinatorClient jsonPost：同樣受逾時保護", async () => {
    vi.stubGlobal("fetch", wedgedFetch());
    __setFetchTimeoutMsForTests(50);
    await expect(coordinatorClient.createReviewSessionForIfcReady("ifcready_x")).rejects.toThrow(/timed out|timeout|abort/i);
  }, 5000);

  it("governanceClient jsonFetch：同樣受逾時保護", async () => {
    vi.stubGlobal("fetch", wedgedFetch());
    __setGovFetchTimeoutMsForTests(50);
    await expect(governanceClient.filesTree()).rejects.toThrow(/timed out|timeout|abort/i);
  }, 5000);
});
