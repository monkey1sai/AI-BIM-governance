import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "./coordinatorClient";

describe("coordinatorClient.getConversionsHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /api/dev/conversions and returns the pass-through {items,count}", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [{ conversion_job_id: "cj_1", status: "succeeded" }], count: 1 }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    );
    const res = await coordinatorClient.getConversionsHistory();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/api/dev/conversions");
    expect(res.items[0].conversion_job_id).toBe("cj_1");
    expect(res.count).toBe(1);
  });
});
