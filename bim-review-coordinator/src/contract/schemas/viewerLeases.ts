// Coordinator Browser Contract — viewer leases (editor single-occupancy).
import { z } from "zod/v4";
import type { PublicViewerLease } from "../../services/viewerLeaseStore.js";
import type { Equal, Expect } from "../typecheck.js";
import { isoTimestamp, named } from "../primitives.js";
import { kitStreamConfig } from "./sessions.js";

export const viewerLeaseRole = named("ViewerLeaseRole", z.enum(["primary", "spectator"]));
export const viewerLeaseStatus = named("ViewerLeaseStatus", z.enum(["active", "released", "expired"]));

export const publicViewerLease = named("PublicViewerLease", z.strictObject({
  lease_id: z.string(),
  session_id: z.string(),
  viewer_id: z.string(),
  user_id: z.string(),
  display_name: z.string().nullable(),
  role: viewerLeaseRole,
  status: viewerLeaseStatus,
  kit_instance_id: z.string().nullable(),
  stream_config: kitStreamConfig.nullable(),
  client_nonce: z.string().nullable(),
  claimed_at: isoTimestamp,
  expires_at: isoTimestamp,
  last_heartbeat_at: isoTimestamp.nullable(),
  released_at: isoTimestamp.nullable(),
  first_frame_at: isoTimestamp.nullable(),
  loaded_stage_url: z.string().nullable(),
  datachannel_ready: z.boolean(),
  datachannel_ready_at: isoTimestamp.nullable(),
  stage_match: z.boolean().nullable(),
  lease_token: z.string().optional(),
}));
export type _PublicViewerLease = Expect<Equal<z.output<typeof publicViewerLease>, PublicViewerLease>>;

export const authScope = named("AuthScope", z.enum(["local_dev_lab", "bound"]));

// ── Requests ─────────────────────────────────────────────────────────────────

export const claimViewerLeaseRequest = named("ClaimViewerLeaseRequest", z.object({
  viewer_id: z.string().trim().min(1).max(200),
  user_id: z.string().trim().min(1).max(200).optional(),
  display_name: z.string().trim().max(200).nullish(),
  requested_role: z.enum(["auto", "primary", "spectator"]).default("auto"),
  client_nonce: z.string().trim().max(200).nullish(),
  preferred_kit_instance_id: z.string().trim().max(200).nullish(),
}));

export const heartbeatViewerLeaseRequest = named("HeartbeatViewerLeaseRequest", z.object({
  first_frame: z.boolean().optional(),
  loaded_stage_url: z.string().trim().max(2048).nullable().optional(),
  datachannel_ready: z.boolean().optional(),
}));

export const releaseViewerLeaseRequest = named("ReleaseViewerLeaseRequest", z.object({
  reason: z.string().trim().max(500).optional(),
}));

// ── Responses ────────────────────────────────────────────────────────────────

export const claimViewerLeaseResponse = named("ClaimViewerLeaseResponse", publicViewerLease.extend({
  lease_token: z.string(),
  auth_scope: authScope,
  primary: z.boolean(),
  heartbeat_after_ms: z.number(),
  idempotent_replay: z.boolean(),
}));

export const heartbeatViewerLeaseResponse = named("HeartbeatViewerLeaseResponse", publicViewerLease.extend({
  heartbeat_after_ms: z.number(),
}));

export const viewerLeaseStatusResponse = named("ViewerLeaseStatusResponse", z.strictObject({
  session_id: z.string(),
  auth_scope: authScope,
  primary: z.strictObject({
    available: z.boolean(),
    owned_by_caller: z.boolean(),
  }),
  leases: z.array(publicViewerLease),
  stage_binding: z.strictObject({
    transaction_status: z.string(),
    binding_revision_id: z.string().nullable(),
    active_binding_revision: z.string().nullable(),
    last_good_binding_revision: z.string().nullable(),
  }),
}));
