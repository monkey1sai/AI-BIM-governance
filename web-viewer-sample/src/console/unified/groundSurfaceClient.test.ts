import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroundSurfaceClient } from "./groundSurfaceClient";

afterEach(() => vi.unstubAllGlobals());
describe("pane-owned ground primary credential closure", () => {
  it("refuses unavailable and mismatched scopes without a request; uses the current lease only", async () => {
    let authority: { sessionId: string; sourceClientId: string; leaseToken: string; userToken: string } | null = null;
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({}) })); vi.stubGlobal("fetch", fetcher);
    const client = createGroundSurfaceClient(() => authority);
    await expect(client.catalog("review_session_test", "/World/Elements/IfcSlab/G_test")).rejects.toThrow("ground_primary_lease_required");
    authority = { sessionId: "review_session_other", sourceClientId: "lease_other", leaseToken: "test-only-other", userToken: "test-user" };
    await expect(client.catalog("review_session_test", "/World/Elements/IfcSlab/G_test")).rejects.toThrow("ground_primary_lease_required");
    expect(fetcher).not.toHaveBeenCalled();
    authority = { sessionId: "review_session_test", sourceClientId: "lease_current", leaseToken: "test-only-current", userToken: "test-user" };
    await client.catalog("review_session_test", "/World/Elements/IfcSlab/G_test");
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ "X-User-Token": "test-user", "X-Viewer-Lease-Token": "test-only-current", "X-Viewer-Source-Client-Id": "lease_current" });
    await client.samplePositions("review_session_test", "ground_" + "a".repeat(64), { bounds_m: [0, 0, 1, 1], spacing_m: 1 });
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toEqual({ bounds_m: [0, 0, 1, 1], spacing_m: 1 });
    await client.assessment("review_session_test", "ground_" + "a".repeat(64), { source_run_id: "cfd_test000001", wind_from_degrees: 22.5 });
    expect(fetcher.mock.calls[2][0]).toContain("/engineering-assessment");
    expect(JSON.parse(fetcher.mock.calls[2][1].body as string)).toEqual({ source_run_id: "cfd_test000001", wind_from_degrees: 22.5 });
    expect(fetcher.mock.calls[2][1].headers).toMatchObject({ "X-Viewer-Lease-Token": "test-only-current" });
    authority = null;
    await expect(client.assessment("review_session_test", "ground_" + "a".repeat(64), { source_run_id: "cfd_test000001", wind_from_degrees: 0 })).rejects.toThrow("ground_primary_lease_required");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(Object.keys(client).sort()).toEqual(["assessment", "catalog", "confirm", "preview", "samplePositions", "saved"]);
  });
});
