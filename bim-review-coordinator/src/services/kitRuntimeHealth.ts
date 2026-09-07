import type { PublicViewerLease } from "./viewerLeaseStore.js";

// Kit media health from viewer-lease evidence (#768).
//
// The coordinator never sees Kit's video path directly, but every primary
// viewer lease reports two facts over its heartbeat: `datachannel_ready`
// (Kit answered a loadingStateQuery over the DataChannel, so the process is
// alive and messaging) and `first_frame_at` (the browser decoded a video
// frame). A Kit whose media layer died - the exact shape produced when a
// replacement Kit was launched into a half-torn-down predecessor - keeps
// answering the DataChannel while no client ever gets a frame. That pattern is
// invisible to /api/kit/health (an HTTP liveness of kit-manager-api) and the
// top-bar chip kept saying "Kit Runtime OK" through a whole afternoon of it.
//
// Rules (deliberately conservative - this is a witness, not a verdict):
//   - Only leases that were CONNECTED long enough count: role=primary,
//     datachannel_ready=true, and observed for >= MIN_OBSERVED_MS from the
//     moment the DataChannel was first reported ready (datachannel_ready_at;
//     claimed_at only for records that predate that field) to the later of
//     last_heartbeat_at/released_at/now(active). A viewer that left within
//     seconds proves nothing either way.
//   - `suspect` needs SUSPECT_STREAK consecutive qualifying leases (newest
//     first) with first_frame_at === null and no newer qualifying lease that
//     did get a frame. One failed viewer can be the browser's fault.
//   - `ok` when the newest qualifying lease got a frame.
//   - `unknown` when there is no qualifying evidence at all.
// Everything reported is derived from lease rows already exposed by
// /api/runtime/status, so the operator can audit the call.

export const KIT_MEDIA_MIN_OBSERVED_MS = 20_000;
export const KIT_MEDIA_SUSPECT_STREAK = 2;

export type KitMediaState = "ok" | "suspect" | "unknown";

export interface KitRuntimeHealthEntry {
  kit_instance_id: string;
  media_state: KitMediaState;
  source: "viewer_lease_evidence";
  detail: string;
  no_first_frame_streak: number;
  qualifying_lease_count: number;
  last_first_frame_at: string | null;
  evidence_lease_ids: string[];
}

interface QualifyingLease {
  lease: PublicViewerLease;
  claimedAtMs: number;
}

function observedUntilMs(lease: PublicViewerLease, nowMs: number): number {
  const candidates = [lease.last_heartbeat_at, lease.released_at]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  if (lease.status === "active") candidates.push(nowMs);
  return candidates.length > 0 ? Math.max(...candidates) : Number.NaN;
}

function qualifyingLeases(leases: PublicViewerLease[], nowMs: number): QualifyingLease[] {
  const out: QualifyingLease[] = [];
  for (const lease of leases) {
    if (lease.role !== "primary" || lease.datachannel_ready !== true) continue;
    const claimedAtMs = Date.parse(lease.claimed_at);
    const untilMs = observedUntilMs(lease, nowMs);
    if (!Number.isFinite(claimedAtMs) || !Number.isFinite(untilMs)) continue;
    // The frameless window starts when Kit was proven to be messaging, not at
    // claim time: a viewer whose DataChannel only came up late has not yet had
    // a fair chance at a frame. Records without the timestamp fall back to
    // claimed_at (older coordinator builds).
    const readyAtParsed = lease.datachannel_ready_at ? Date.parse(lease.datachannel_ready_at) : Number.NaN;
    const windowStartMs = Number.isFinite(readyAtParsed) ? Math.max(readyAtParsed, claimedAtMs) : claimedAtMs;
    // A lease that already got a frame counts regardless of how long it lived:
    // a frame is positive proof. A frameless lease must have been observed long
    // enough that a healthy Kit would have produced one.
    if (lease.first_frame_at === null && untilMs - windowStartMs < KIT_MEDIA_MIN_OBSERVED_MS) continue;
    out.push({ lease, claimedAtMs });
  }
  // newest first
  return out.sort((left, right) => right.claimedAtMs - left.claimedAtMs);
}

export function deriveKitRuntimeHealth(
  kitInstanceIds: string[],
  leases: PublicViewerLease[],
  nowMs: number = Date.now(),
): KitRuntimeHealthEntry[] {
  const ids = new Set<string>(kitInstanceIds);
  for (const lease of leases) if (lease.kit_instance_id) ids.add(lease.kit_instance_id);
  return Array.from(ids).sort().map((kitInstanceId) => {
    const own = qualifyingLeases(leases.filter((lease) => lease.kit_instance_id === kitInstanceId), nowMs);
    const lastWithFrame = own.find((item) => item.lease.first_frame_at !== null) ?? null;
    let streak = 0;
    for (const item of own) {
      if (item.lease.first_frame_at !== null) break;
      streak += 1;
    }
    const evidence = own.slice(0, Math.max(streak, 1)).map((item) => item.lease.lease_id);
    if (own.length === 0) {
      return {
        kit_instance_id: kitInstanceId,
        media_state: "unknown",
        source: "viewer_lease_evidence",
        detail: "no primary viewer lease with DataChannel evidence observed long enough to judge the media layer",
        no_first_frame_streak: 0,
        qualifying_lease_count: 0,
        last_first_frame_at: null,
        evidence_lease_ids: [],
      };
    }
    if (streak === 0) {
      return {
        kit_instance_id: kitInstanceId,
        media_state: "ok",
        source: "viewer_lease_evidence",
        detail: "newest DataChannel-ready primary viewer lease reported a first frame",
        no_first_frame_streak: 0,
        qualifying_lease_count: own.length,
        last_first_frame_at: lastWithFrame?.lease.first_frame_at ?? null,
        evidence_lease_ids: evidence,
      };
    }
    if (streak >= KIT_MEDIA_SUSPECT_STREAK) {
      return {
        kit_instance_id: kitInstanceId,
        media_state: "suspect",
        source: "viewer_lease_evidence",
        detail: `${streak} consecutive primary viewer leases had DataChannel ready for >=${KIT_MEDIA_MIN_OBSERVED_MS / 1000}s but never a first frame; Kit media layer is likely dead (restart Kit via scripts/stop-all.ps1 + deploy)`,
        no_first_frame_streak: streak,
        qualifying_lease_count: own.length,
        last_first_frame_at: lastWithFrame?.lease.first_frame_at ?? null,
        evidence_lease_ids: evidence,
      };
    }
    return {
      kit_instance_id: kitInstanceId,
      media_state: "unknown",
      source: "viewer_lease_evidence",
      detail: `${streak} recent primary viewer lease(s) without a first frame; below the ${KIT_MEDIA_SUSPECT_STREAK}-lease threshold, could still be a client-side problem`,
      no_first_frame_streak: streak,
      qualifying_lease_count: own.length,
      last_first_frame_at: lastWithFrame?.lease.first_frame_at ?? null,
      evidence_lease_ids: evidence,
    };
  });
}
