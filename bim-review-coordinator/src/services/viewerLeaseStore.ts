import { randomBytes } from "node:crypto";
import type { KitInstanceBinding } from "../types.js";

export type ViewerLeaseRole = "primary" | "spectator";
export type ViewerLeaseRequestRole = ViewerLeaseRole | "auto";
export type ViewerLeaseStatus = "active" | "released" | "expired";

export interface ViewerLeaseRecord {
  lease_id: string;
  lease_token: string;
  session_id: string;
  viewer_id: string;
  user_id: string;
  display_name: string | null;
  role: ViewerLeaseRole;
  status: ViewerLeaseStatus;
  kit_instance_id: string | null;
  stream_config: KitInstanceBinding["stream_config"] | null;
  client_nonce: string | null;
  claimed_at: string;
  expires_at: string;
  last_heartbeat_at: string | null;
  released_at: string | null;
  first_frame_at: string | null;
  loaded_stage_url: string | null;
  datachannel_ready: boolean;
  stage_match: boolean | null;
}

export interface PublicViewerLease {
  lease_id: string;
  session_id: string;
  viewer_id: string;
  user_id: string;
  display_name: string | null;
  role: ViewerLeaseRole;
  status: ViewerLeaseStatus;
  kit_instance_id: string | null;
  stream_config: KitInstanceBinding["stream_config"] | null;
  client_nonce: string | null;
  claimed_at: string;
  expires_at: string;
  last_heartbeat_at: string | null;
  released_at: string | null;
  first_frame_at: string | null;
  loaded_stage_url: string | null;
  datachannel_ready: boolean;
  stage_match: boolean | null;
  lease_token?: string;
}

export interface ClaimViewerLeaseInput {
  session_id: string;
  viewer_id: string;
  user_id: string;
  display_name?: string | null;
  requested_role: ViewerLeaseRequestRole;
  client_nonce?: string | null;
  preferred_kit_instance_id?: string | null;
  bindings: KitInstanceBinding[];
}

export interface ClaimViewerLeaseResult {
  ok: boolean;
  lease?: ViewerLeaseRecord;
  idempotent_replay?: boolean;
  conflict?: ViewerLeaseRecord;
  detail?: string;
}

export interface HeartbeatViewerLeaseInput {
  first_frame?: boolean;
  loaded_stage_url?: string | null;
  datachannel_ready?: boolean;
  expected_stage_url?: string | null;
}

const DEFAULT_TTL_MS = 45_000;
const DEFAULT_HEARTBEAT_AFTER_MS = 15_000;

export class ViewerLeaseStore {
  private readonly leases = new Map<string, ViewerLeaseRecord>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    readonly heartbeatAfterMs = DEFAULT_HEARTBEAT_AFTER_MS,
  ) {}

  claim(input: ClaimViewerLeaseInput): ClaimViewerLeaseResult {
    const nowMs = Date.now();
    this.expire(nowMs);

    const existingReplay = this.findReplay(input);
    if (existingReplay) {
      return { ok: true, lease: existingReplay, idempotent_replay: true };
    }

    const role = this.resolveRequestedRole(input.session_id, input.requested_role);
    if (role === "primary") {
      const primary = this.activePrimary(input.session_id);
      if (primary) {
        return {
          ok: false,
          conflict: primary,
          detail: "primary_already_claimed",
        };
      }
    }

    const binding = chooseBindingForLease(input.bindings, role, input.preferred_kit_instance_id);
    if (!binding) {
      return {
        ok: false,
        detail: "no_stream_endpoint_available",
      };
    }

    const now = new Date(nowMs).toISOString();
    const lease: ViewerLeaseRecord = {
      lease_id: `viewer_lease_${randomBytes(8).toString("hex")}`,
      lease_token: randomBytes(24).toString("hex"),
      session_id: input.session_id,
      viewer_id: input.viewer_id,
      user_id: input.user_id,
      display_name: cleanOptionalString(input.display_name),
      role,
      status: "active",
      kit_instance_id: binding.kit_instance_id,
      stream_config: binding.stream_config,
      client_nonce: cleanOptionalString(input.client_nonce),
      claimed_at: now,
      expires_at: new Date(nowMs + this.ttlMs).toISOString(),
      last_heartbeat_at: null,
      released_at: null,
      first_frame_at: null,
      loaded_stage_url: null,
      datachannel_ready: false,
      stage_match: null,
    };
    this.leases.set(lease.lease_id, lease);
    return { ok: true, lease };
  }

  heartbeat(sessionId: string, leaseId: string, token: string, input: HeartbeatViewerLeaseInput): ViewerLeaseRecord | null {
    const nowMs = Date.now();
    this.expire(nowMs);
    const lease = this.leases.get(leaseId);
    if (!lease || lease.session_id !== sessionId || lease.status !== "active" || lease.lease_token !== token) {
      return null;
    }

    const now = new Date(nowMs).toISOString();
    lease.last_heartbeat_at = now;
    lease.expires_at = new Date(nowMs + this.ttlMs).toISOString();
    if (input.first_frame && !lease.first_frame_at) {
      lease.first_frame_at = now;
    }
    if (typeof input.loaded_stage_url === "string" || input.loaded_stage_url === null) {
      lease.loaded_stage_url = cleanOptionalString(input.loaded_stage_url);
    }
    if (typeof input.datachannel_ready === "boolean") {
      lease.datachannel_ready = input.datachannel_ready;
    }
    if (lease.loaded_stage_url && input.expected_stage_url) {
      lease.stage_match = stageUrlsEquivalent(lease.loaded_stage_url, input.expected_stage_url);
    } else if (lease.loaded_stage_url === null) {
      lease.stage_match = null;
    }
    return lease;
  }

  release(sessionId: string, leaseId: string, token?: string): ViewerLeaseRecord | null {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.session_id !== sessionId) return null;
    if (token !== undefined && lease.lease_token !== token) return null;
    if (lease.status === "active") {
      lease.status = "released";
      lease.released_at = new Date().toISOString();
      lease.expires_at = lease.released_at;
    }
    return lease;
  }

  releaseSession(sessionId: string): ViewerLeaseRecord[] {
    const released: ViewerLeaseRecord[] = [];
    for (const lease of this.leases.values()) {
      if (lease.session_id !== sessionId || lease.status !== "active") continue;
      lease.status = "released";
      lease.released_at = new Date().toISOString();
      lease.expires_at = lease.released_at;
      released.push(lease);
    }
    return released;
  }

  authorizePrimary(sessionId: string, leaseId: string, token: string): ViewerLeaseRecord | null {
    this.expire(Date.now());
    const lease = this.leases.get(leaseId);
    if (!lease || lease.session_id !== sessionId || lease.status !== "active") return null;
    if (lease.lease_token !== token || lease.role !== "primary") return null;
    return lease;
  }

  get(sessionId: string, leaseId: string): ViewerLeaseRecord | null {
    this.expire(Date.now());
    const lease = this.leases.get(leaseId);
    return lease && lease.session_id === sessionId ? lease : null;
  }

  list(sessionId: string): ViewerLeaseRecord[] {
    this.expire(Date.now());
    return [...this.leases.values()]
      .filter((lease) => lease.session_id === sessionId)
      .sort((left, right) => Date.parse(left.claimed_at) - Date.parse(right.claimed_at));
  }

  primary(sessionId: string): ViewerLeaseRecord | null {
    this.expire(Date.now());
    return this.activePrimary(sessionId);
  }

  private activePrimary(sessionId: string): ViewerLeaseRecord | null {
    return [...this.leases.values()].find((lease) =>
      lease.session_id === sessionId && lease.role === "primary" && lease.status === "active",
    ) ?? null;
  }

  private resolveRequestedRole(sessionId: string, requested: ViewerLeaseRequestRole): ViewerLeaseRole {
    if (requested === "primary" || requested === "spectator") return requested;
    return this.activePrimary(sessionId) ? "spectator" : "primary";
  }

  private findReplay(input: ClaimViewerLeaseInput): ViewerLeaseRecord | null {
    const clientNonce = cleanOptionalString(input.client_nonce);
    if (!clientNonce) return null;
    const requested = input.requested_role === "auto" ? null : input.requested_role;
    return [...this.leases.values()].find((lease) =>
      lease.session_id === input.session_id
      && lease.viewer_id === input.viewer_id
      && lease.client_nonce === clientNonce
      && lease.status === "active"
      && (!requested || lease.role === requested),
    ) ?? null;
  }

  private expire(nowMs: number): void {
    const now = new Date(nowMs).toISOString();
    for (const lease of this.leases.values()) {
      if (lease.status !== "active") continue;
      if (Date.parse(lease.expires_at) <= nowMs) {
        lease.status = "expired";
        lease.released_at = now;
      }
    }
  }
}

export function publicLease(lease: ViewerLeaseRecord, options?: { includeToken?: boolean }): PublicViewerLease {
  const result: PublicViewerLease = {
    lease_id: lease.lease_id,
    session_id: lease.session_id,
    viewer_id: lease.viewer_id,
    user_id: lease.user_id,
    display_name: lease.display_name,
    role: lease.role,
    status: lease.status,
    kit_instance_id: lease.kit_instance_id,
    stream_config: lease.stream_config,
    client_nonce: lease.client_nonce,
    claimed_at: lease.claimed_at,
    expires_at: lease.expires_at,
    last_heartbeat_at: lease.last_heartbeat_at,
    released_at: lease.released_at,
    first_frame_at: lease.first_frame_at,
    loaded_stage_url: lease.loaded_stage_url,
    datachannel_ready: lease.datachannel_ready,
    stage_match: lease.stage_match,
  };
  if (options?.includeToken) {
    result.lease_token = lease.lease_token;
  }
  return result;
}

function chooseBindingForLease(
  bindings: KitInstanceBinding[],
  role: ViewerLeaseRole,
  preferredKitInstanceId?: string | null,
): KitInstanceBinding | null {
  if (bindings.length === 0) return null;
  if (preferredKitInstanceId) {
    const preferred = bindings.find((binding) => binding.kit_instance_id === preferredKitInstanceId);
    if (preferred) return preferred;
  }
  if (role === "primary") return bindings[0] ?? null;
  return bindings[1] ?? bindings[0] ?? null;
}

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
}

function stageUrlsEquivalent(loaded: string, expected: string): boolean {
  if (loaded === expected) return true;
  try {
    const a = new URL(loaded);
    const b = new URL(expected);
    return a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}
