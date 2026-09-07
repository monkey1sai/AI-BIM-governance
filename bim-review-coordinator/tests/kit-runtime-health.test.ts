import { describe, expect, it } from "vitest";
import {
  KIT_MEDIA_MIN_OBSERVED_MS,
  deriveKitRuntimeHealth,
} from "../src/services/kitRuntimeHealth.js";
import type { PublicViewerLease } from "../src/services/viewerLeaseStore.js";

const T0 = Date.parse("2026-09-07T09:00:00.000Z");
const NOW = T0 + 60 * 60 * 1000;

function lease(overrides: Partial<PublicViewerLease> & { lease_id: string; claimed_at: string }): PublicViewerLease {
  const claimedMs = Date.parse(overrides.claimed_at);
  return {
    session_id: "review_session_a",
    viewer_id: `viewer_${overrides.lease_id}`,
    user_id: "lab_user",
    display_name: null,
    role: "primary",
    status: "released",
    kit_instance_id: "kit_local_001",
    stream_config: null,
    client_nonce: null,
    expires_at: new Date(claimedMs + 45_000).toISOString(),
    last_heartbeat_at: new Date(claimedMs + 30_000).toISOString(),
    released_at: new Date(claimedMs + 33_000).toISOString(),
    first_frame_at: null,
    loaded_stage_url: null,
    datachannel_ready: true,
    datachannel_ready_at: new Date(claimedMs + 3_000).toISOString(),
    stage_match: null,
    ...overrides,
  } as PublicViewerLease;
}

const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

describe("deriveKitRuntimeHealth (#768 media witness from lease evidence)", () => {
  it("unknown when there is no qualifying evidence", () => {
    const [entry] = deriveKitRuntimeHealth(["kit_local_001"], [], NOW);
    expect(entry).toMatchObject({ kit_instance_id: "kit_local_001", media_state: "unknown", qualifying_lease_count: 0 });
  });

  it("reproduces the 2026-09-07 181 afternoon: two DataChannel-ready leases, no frame → suspect", () => {
    // 09:20 A1 inline viewer, 09:21 Review Room: both datachannel_ready=true, first_frame_at=null, ~33s each.
    const leases = [
      lease({ lease_id: "viewer_lease_77c1303d9b86b9dd", claimed_at: at(20 * 60_000) }),
      lease({ lease_id: "viewer_lease_e6c3dc1233562b89", claimed_at: at(21 * 60_000) }),
    ];
    const [entry] = deriveKitRuntimeHealth(["kit_local_001"], leases, NOW);
    expect(entry.media_state).toBe("suspect");
    expect(entry.no_first_frame_streak).toBe(2);
    expect(entry.evidence_lease_ids).toEqual(["viewer_lease_e6c3dc1233562b89", "viewer_lease_77c1303d9b86b9dd"]);
    expect(entry.detail).toContain("stop-all");
  });

  it("one frameless lease is below the threshold → unknown, not suspect", () => {
    const [entry] = deriveKitRuntimeHealth(["kit_local_001"], [lease({ lease_id: "l1", claimed_at: at(0) })], NOW);
    expect(entry.media_state).toBe("unknown");
    expect(entry.no_first_frame_streak).toBe(1);
  });

  it("a newer lease with a first frame clears the streak → ok", () => {
    const leases = [
      lease({ lease_id: "old1", claimed_at: at(0) }),
      lease({ lease_id: "old2", claimed_at: at(60_000) }),
      lease({ lease_id: "fresh", claimed_at: at(120_000), first_frame_at: at(123_000) }),
    ];
    const [entry] = deriveKitRuntimeHealth(["kit_local_001"], leases, NOW);
    expect(entry.media_state).toBe("ok");
    expect(entry.last_first_frame_at).toBe(at(123_000));
    expect(entry.no_first_frame_streak).toBe(0);
  });

  it("an older lease with a frame does not excuse newer frameless leases → suspect", () => {
    const leases = [
      lease({ lease_id: "good", claimed_at: at(0), first_frame_at: at(3_000) }),
      lease({ lease_id: "bad1", claimed_at: at(60_000) }),
      lease({ lease_id: "bad2", claimed_at: at(120_000) }),
    ];
    const [entry] = deriveKitRuntimeHealth(["kit_local_001"], leases, NOW);
    expect(entry.media_state).toBe("suspect");
    expect(entry.last_first_frame_at).toBe(at(3_000));
  });

  it("short-lived or DataChannel-less leases do not count as evidence", () => {
    const shortMs = KIT_MEDIA_MIN_OBSERVED_MS - 5_000;
    const leases = [
      lease({
        lease_id: "short",
        claimed_at: at(0),
        last_heartbeat_at: at(shortMs),
        released_at: at(shortMs),
      }),
      lease({ lease_id: "nodc", claimed_at: at(60_000), datachannel_ready: false }),
      lease({ lease_id: "spectator", claimed_at: at(120_000), role: "spectator" }),
    ];
    const [entry] = deriveKitRuntimeHealth(["kit_local_001"], leases, NOW);
    expect(entry.media_state).toBe("unknown");
    expect(entry.qualifying_lease_count).toBe(0);
  });

  it("the frameless window starts at datachannel_ready_at, not claimed_at (late DataChannel is not evidence)", () => {
    // Claimed 40s ago, but the DataChannel only came up 10s ago: the viewer has not had its 20s.
    const late = lease({
      lease_id: "late",
      claimed_at: new Date(NOW - 40_000).toISOString(),
      datachannel_ready_at: new Date(NOW - 10_000).toISOString(),
      status: "active",
      last_heartbeat_at: null,
      released_at: null,
    });
    const older = lease({ lease_id: "older", claimed_at: at(0) });
    expect(deriveKitRuntimeHealth(["kit_local_001"], [older, late], NOW)[0]).toMatchObject({ media_state: "unknown", qualifying_lease_count: 1 });
    // Records without the timestamp (older coordinator builds) fall back to claimed_at.
    const legacy = lease({ lease_id: "legacy", claimed_at: at(60_000), datachannel_ready_at: null });
    expect(deriveKitRuntimeHealth(["kit_local_001"], [older, legacy], NOW)[0].media_state).toBe("suspect");
  });

  it("an active frameless lease is measured up to now", () => {
    const leases = [
      lease({ lease_id: "a1", claimed_at: at(0) }),
      lease({
        lease_id: "live",
        claimed_at: new Date(NOW - 25_000).toISOString(),
        status: "active",
        last_heartbeat_at: null,
        released_at: null,
      }),
    ];
    const [entry] = deriveKitRuntimeHealth(["kit_local_001"], leases, NOW);
    expect(entry.media_state).toBe("suspect");
    expect(entry.evidence_lease_ids[0]).toBe("live");
  });

  it("judges each kit instance separately and includes instances seen only on leases", () => {
    const leases = [
      lease({ lease_id: "k1a", claimed_at: at(0) }),
      lease({ lease_id: "k1b", claimed_at: at(60_000) }),
      lease({ lease_id: "k2", claimed_at: at(0), kit_instance_id: "kit_local_001_spectator_01", first_frame_at: at(2_000) }),
    ];
    const entries = deriveKitRuntimeHealth(["kit_local_001"], leases, NOW);
    expect(entries.map((entry) => [entry.kit_instance_id, entry.media_state])).toEqual([
      ["kit_local_001", "suspect"],
      ["kit_local_001_spectator_01", "ok"],
    ]);
  });
});
