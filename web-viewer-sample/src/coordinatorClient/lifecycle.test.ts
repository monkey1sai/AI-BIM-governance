// coordinatorClient/lifecycle.test.ts — 契約 §4.3／§4.4 的瀏覽器端呼叫與 409 解析。
import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "./index";
import { CoordinatorHttpError, lifecycleConflict } from "./errors";
import { narrowConversionStatus } from "./types";

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("lifecycle client methods", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("purgeReviewSession sends DELETE with the reason query", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, {
      session_id: "review_session_a", status: "purged", purged_at: "2026-09-30T00:00:00.000Z", removed: { session_file: true, events_file: true },
    }));
    const out = await coordinatorClient.purgeReviewSession("review_session_a", "stale_cleanup");
    expect(out.status).toBe("purged");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/review-sessions\/review_session_a\?reason=stale_cleanup$/);
    expect(init.method).toBe("DELETE");
  });

  it("removeConversionRecord sends DELETE to the record key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200, {
      idempotency_key: "mw_0123456789abcdef", status: "removed", removed_at: "2026-09-30T00:00:00.000Z", intake_jobs_removed: 1,
    }));
    await coordinatorClient.removeConversionRecord("mw_0123456789abcdef");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/conversion\/records\/mw_0123456789abcdef$/);
    expect(init.method).toBe("DELETE");
  });

  it("getConversionRecords adds include_removed=1 only when asked", async () => {
    // A Response body can be read once, so each call gets its own reply.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply(200, { count: 0, items: [] }));
    await coordinatorClient.getConversionRecords(100);
    await coordinatorClient.getConversionRecords(100, { includeRemoved: true });
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/limit=100$/);
    expect(String(fetchSpy.mock.calls[1][0])).toMatch(/limit=100&include_removed=1$/);
  });

  it("lifecycleConflict extracts the 409 fields and ignores other errors", () => {
    const inUse = new CoordinatorHttpError("/api/conversion/records/k", 409, "record_in_use", "record_in_use", { error_code: "record_in_use", sessions: ["review_session_a"] });
    expect(lifecycleConflict(inUse)).toEqual({ code: "record_in_use", sessions: ["review_session_a"], intakeStatus: undefined, status: undefined });
    const inFlight = new CoordinatorHttpError("/api/conversion/records/k", 409, "record_in_flight", "record_in_flight", { error_code: "record_in_flight", intake_status: "dispatched" });
    expect(lifecycleConflict(inFlight)?.intakeStatus).toBe("dispatched");
    expect(lifecycleConflict(new CoordinatorHttpError("/x", 403, "caller ip not in allowlist"))).toBeNull();
    expect(lifecycleConflict(new Error("boom"))).toBeNull();
  });

  it("narrowConversionStatus accepts removed", () => {
    expect(narrowConversionStatus("removed")).toBe("removed");
  });
});
