import { randomBytes } from "node:crypto";

export type A4HandoffAction = "focus" | "highlight";

export interface A4HandoffBinding {
  review_session_id: string;
  principal_ref: string;
  model_version_id: string;
  primary_artifact_id: string;
  active_binding_revision: string;
}

export interface A4HandoffRow {
  ifc_guid: string | null;
  prim_path: string;
}

export interface A4HandoffIntent {
  handoff_id: string;
  action: A4HandoffAction;
  binding: A4HandoffBinding;
  rows: A4HandoffRow[];
  created_at: string;
  expires_at: string;
}

export type A4HandoffCreateResult =
  | { ok: true; intent: A4HandoffIntent }
  | { ok: false; code: "a4_handoff_config_invalid" | "a4_handoff_expired" | "a4_handoff_store_saturated" };

export type A4HandoffConsumeResult =
  | { ok: true; intent: A4HandoffIntent }
  | {
      ok: false;
      code: "a4_handoff_unavailable" | "a4_handoff_expired" | "a4_handoff_binding_mismatch";
    };

export interface A4HandoffStoreOptions {
  ttlMs?: number;
  maxRecords?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_RECORDS = 512;

function configuredTtlMs(): number {
  const raw = process.env.A4_HANDOFF_TTL_SECONDS?.trim();
  if (!raw) return DEFAULT_TTL_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1_000 : Number.NaN;
}

function sameBinding(left: A4HandoffBinding, right: A4HandoffBinding): boolean {
  return left.review_session_id === right.review_session_id
    && left.principal_ref === right.principal_ref
    && left.model_version_id === right.model_version_id
    && left.primary_artifact_id === right.primary_artifact_id
    && left.active_binding_revision === right.active_binding_revision;
}

function cloneIntent(intent: A4HandoffIntent): A4HandoffIntent {
  return {
    ...intent,
    binding: { ...intent.binding },
    rows: intent.rows.map((row) => ({ ...row })),
  };
}

/**
 * Process-local, bounded handoff intent store. It deliberately keeps no query,
 * proof token, proof id, host path, or durable session event.
 */
export class A4HandoffStore {
  private readonly records = new Map<string, A4HandoffIntent>();
  private readonly ttlMs: number;
  private readonly maxRecords: number;
  private readonly now: () => number;

  constructor(options: A4HandoffStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? configuredTtlMs();
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.now = options.now ?? Date.now;
  }

  create(input: {
    action: A4HandoffAction;
    binding: A4HandoffBinding;
    rows: A4HandoffRow[];
    minProofExpiresAt: string;
  }): A4HandoffCreateResult {
    const nowMs = this.now();
    const proofExpiryMs = Date.parse(input.minProofExpiresAt);
    if (
      !Number.isFinite(this.ttlMs)
      || this.ttlMs <= 0
      || this.ttlMs > MAX_TTL_MS
      || !Number.isInteger(this.maxRecords)
      || this.maxRecords < 1
    ) {
      return { ok: false, code: "a4_handoff_config_invalid" };
    }
    if (!Number.isFinite(proofExpiryMs) || proofExpiryMs <= nowMs) {
      return { ok: false, code: "a4_handoff_expired" };
    }
    this.purgeExpired(nowMs);
    if (this.records.size >= this.maxRecords) {
      return { ok: false, code: "a4_handoff_store_saturated" };
    }

    let handoffId = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = `a4h_${randomBytes(18).toString("base64url")}`;
      if (!this.records.has(candidate)) {
        handoffId = candidate;
        break;
      }
    }
    if (!handoffId) {
      return { ok: false, code: "a4_handoff_store_saturated" };
    }

    const intent: A4HandoffIntent = {
      handoff_id: handoffId,
      action: input.action,
      binding: { ...input.binding },
      rows: input.rows.map((row) => ({ ...row })),
      created_at: new Date(nowMs).toISOString(),
      expires_at: new Date(Math.min(nowMs + this.ttlMs, proofExpiryMs)).toISOString(),
    };
    this.records.set(handoffId, intent);
    return { ok: true, intent: cloneIntent(intent) };
  }

  consume(handoffId: string, currentBinding: A4HandoffBinding): A4HandoffConsumeResult {
    const intent = this.records.get(handoffId);
    if (!intent) return { ok: false, code: "a4_handoff_unavailable" };

    // Cross-session/principal probes never reveal whether the opaque ID exists,
    // and do not consume another principal's valid intent.
    if (
      intent.binding.review_session_id !== currentBinding.review_session_id
      || intent.binding.principal_ref !== currentBinding.principal_ref
    ) {
      return { ok: false, code: "a4_handoff_unavailable" };
    }

    const nowMs = this.now();
    if (Date.parse(intent.expires_at) <= nowMs) {
      this.records.delete(handoffId);
      return { ok: false, code: "a4_handoff_expired" };
    }
    if (!sameBinding(intent.binding, currentBinding)) {
      // A same-principal stage/model change permanently invalidates the old
      // intent; restoring an old revision must not revive it.
      this.records.delete(handoffId);
      return { ok: false, code: "a4_handoff_binding_mismatch" };
    }

    this.records.delete(handoffId);
    return { ok: true, intent: cloneIntent(intent) };
  }

  private purgeExpired(nowMs: number): void {
    for (const [handoffId, intent] of this.records) {
      if (Date.parse(intent.expires_at) <= nowMs) this.records.delete(handoffId);
    }
  }
}
