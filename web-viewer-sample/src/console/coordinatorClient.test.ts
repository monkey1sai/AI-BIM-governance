import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "./coordinatorClient";

describe("coordinatorClient conversion control", () => {
  afterEach(() => vi.restoreAllMocks());

  it("conversionPrioritize 打 POST .../prioritize 帶 reason，回 JSON", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_x", status: "queued_for_conversion", queue_position: 1 }), { status: 200 }),
    );
    const r = await coordinatorClient.conversionPrioritize("ifcready_x", "urgent");
    expect(r.status).toBe("queued_for_conversion");
    const call = spy.mock.calls[0];
    expect(String(call[0])).toContain("/api/conversion/jobs/ifcready_x/prioritize");
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(String((call[1] as RequestInit).body)).toContain("urgent");
  });

  it("conversionRetry 非 2xx 時 throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "nope" }), { status: 409, statusText: "Conflict" }));
    await expect(coordinatorClient.conversionRetry("ifcready_x")).rejects.toThrow();
  });

  it("conversionWatchToggle 發 PUT /api/conversion/watch，body 含 enabled/reason", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), method: (init as RequestInit)?.method, body: (init as RequestInit)?.body as string });
      return new Response(JSON.stringify({ enabled: false, note: "ok" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    const res = await coordinatorClient.conversionWatchToggle(false, "smoke");
    expect(res.enabled).toBe(false);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("/api/conversion/watch");
    expect(JSON.parse(calls[0].body!)).toEqual({ enabled: false, reason: "smoke" });
    spy.mockRestore();
  });
});
