import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ArtifactBinding,
  ConversionQualityMetricsSummary,
  KitInstance,
  KitInstanceBinding,
  ReviewParticipant,
  ReviewSession,
  SessionStatus,
} from "../types.js";
import { nowIso } from "../utils/time.js";

const safeSessionIdPattern = /^review_session_[A-Za-z0-9_-]+$/;
const safeIfcReadyTracePattern = /^ifcready_(?!ifcready_|rev_|stream_conv_|script_|external_)[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_SESSION_TRACE_ID_LENGTH = 200;

export interface CreateSessionInput {
  ready_model_id?: string;
  /** Server-internal only; public create-session input never accepts this field. */
  trace_id?: string;
  /** Server-internal only; used by idempotent recreation to make crash recovery deterministic. */
  session_id?: string;
  recreated_from_session_id?: string;
  review_request_id?: string;
  tenant_id?: string;
  project_id: string;
  model_version_id: string;
  source_artifact_id?: string;
  usdc_artifact_id?: string;
  created_by: string;
  mode?: string;
  kit_instance: KitInstance;
  artifact_bindings?: ArtifactBinding[];
  kit_instance_bindings?: KitInstanceBinding[];
  quality_metrics_summary?: ConversionQualityMetricsSummary | null;
}

export class SessionStore {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  create(input: CreateSessionInput): ReviewSession {
    const timestamp = nowIso();
    const kitInstanceBindings = input.kit_instance_bindings || [];
    const sessionId = input.session_id ?? `review_session_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    assertSafeSessionId(sessionId);
    const traceId = input.trace_id ?? `rev_${sessionId}`;
    if (!isCanonicalSessionTraceId(traceId, sessionId)) {
      throw new Error("Invalid review session trace_id.");
    }
    const session: ReviewSession = {
      ready_model_id: input.ready_model_id,
      session_id: sessionId,
      recreated_from_session_id: input.recreated_from_session_id,
      trace_id: traceId,
      review_request_id: input.review_request_id,
      tenant_id: input.tenant_id || "tenant_demo_001",
      project_id: input.project_id,
      model_version_id: input.model_version_id,
      source_artifact_id: input.source_artifact_id,
      usdc_artifact_id: input.usdc_artifact_id,
      status: kitInstanceBindings.length > 0 ? "active" : "created",
      mode: input.mode || "single_kit_shared_state",
      created_by: input.created_by,
      created_at: timestamp,
      updated_at: timestamp,
      kit_instance: input.kit_instance,
      artifact_bindings: input.artifact_bindings || [],
      kit_instance_bindings: kitInstanceBindings,
      participants: [],
      quality_metrics_summary: input.quality_metrics_summary ?? null,
    };
    this.save(session);
    return session;
  }

  get(sessionId: string): ReviewSession | null {
    if (!isSafeSessionId(sessionId)) return null;
    const file = this.filePath(sessionId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as ReviewSession;
  }

  list(): ReviewSession[] {
    if (!fs.existsSync(this.rootDir)) return [];
    return fs
      .readdirSync(this.rootDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -".json".length))
      .filter(isSafeSessionId)
      .map((sessionId) => this.get(sessionId))
      .filter((session): session is ReviewSession => session !== null)
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }

  save(session: ReviewSession): void {
    this.persistSession(session, false);
  }

  backfillTraceId(sessionId: string, traceId: string): ReviewSession | null {
    const session = this.get(sessionId);
    if (!session) return null;
    if (session.trace_id !== undefined) {
      if (session.trace_id !== traceId) {
        throw new Error("Review session trace_id is immutable.");
      }
      return session;
    }
    if (!isCanonicalSessionTraceId(traceId, sessionId)) {
      throw new Error("Invalid review session trace_id.");
    }
    session.trace_id = traceId;
    this.persistSession(session, true);
    return session;
  }

  private persistSession(session: ReviewSession, allowLegacyTraceBackfill: boolean): void {
    assertSafeSessionId(session.session_id);
    const file = this.filePath(session.session_id);
    const existing = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as ReviewSession)
      : null;
    if (existing && existing.ready_model_id !== session.ready_model_id) {
      throw new Error("Review session ready_model_id is immutable.");
    }
    if (session.ready_model_id !== undefined && !/^mw_[a-f0-9]{16}$/.test(session.ready_model_id)) {
      throw new Error("Invalid review session ready_model_id.");
    }
    if (existing?.trace_id !== undefined) {
      if (session.trace_id !== existing.trace_id) {
        throw new Error("Review session trace_id is immutable.");
      }
    } else if (existing && session.trace_id !== undefined && !allowLegacyTraceBackfill) {
      throw new Error("Review session trace_id backfill requires resolver.");
    } else if (session.trace_id !== undefined) {
      if (!isCanonicalSessionTraceId(session.trace_id, session.session_id)) {
        throw new Error("Invalid review session trace_id.");
      }
    } else if (!existing) {
      throw new Error("Invalid review session trace_id.");
    }
    session.updated_at = nowIso();
    fs.writeFileSync(file, JSON.stringify(session, null, 2), "utf8");
  }

  join(sessionId: string, participant: Pick<ReviewParticipant, "user_id" | "display_name">): ReviewSession | null {
    const session = this.get(sessionId);
    if (!session) return null;
    const timestamp = nowIso();
    session.participants = session.participants.filter((item) => item.user_id !== participant.user_id);
    session.participants.push({
      user_id: participant.user_id,
      display_name: participant.display_name,
      joined_at: timestamp,
      last_seen_at: timestamp,
    });
    this.save(session);
    return session;
  }

  leave(sessionId: string, userId: string): ReviewSession | null {
    const session = this.get(sessionId);
    if (!session) return null;
    session.participants = session.participants.filter((item) => item.user_id !== userId);
    this.save(session);
    return session;
  }

  update(sessionId: string, update: Partial<ReviewSession>): ReviewSession | null {
    const session = this.get(sessionId);
    if (!session) return null;
    const next = { ...session, ...update };
    this.save(next);
    return next;
  }

  setStatus(sessionId: string, status: SessionStatus): ReviewSession | null {
    return this.update(sessionId, { status });
  }

  getRecreationReceipt(sourceSessionId: string, keyDigest: string): string | null {
    if (!isSafeSessionId(sourceSessionId) || !/^[a-f0-9]{64}$/.test(keyDigest)) return null;
    const file = this.recreationReceiptPath(sourceSessionId, keyDigest);
    if (!fs.existsSync(file)) return null;
    const recreatedSessionId = fs.readFileSync(file, "utf8").trim();
    return recreatedSessionId && this.get(recreatedSessionId) ? recreatedSessionId : null;
  }

  recordRecreationReceipt(sourceSessionId: string, keyDigest: string, recreatedSessionId: string): void {
    assertSafeSessionId(sourceSessionId);
    assertSafeSessionId(recreatedSessionId);
    if (!/^[a-f0-9]{64}$/.test(keyDigest)) throw new Error("Invalid recreation idempotency digest.");
    const directory = path.join(this.rootDir, ".recreation-receipts");
    fs.mkdirSync(directory, { recursive: true });
    const file = this.recreationReceiptPath(sourceSessionId, keyDigest);
    try {
      fs.writeFileSync(file, recreatedSessionId, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing !== recreatedSessionId) {
        throw new Error("Recreation idempotency receipt already points to another session.");
      }
    }
  }

  private recreationReceiptPath(sourceSessionId: string, keyDigest: string): string {
    return path.join(this.rootDir, ".recreation-receipts", `${sourceSessionId}.${keyDigest}.receipt`);
  }

  private filePath(sessionId: string): string {
    assertSafeSessionId(sessionId);
    return path.join(this.rootDir, `${sessionId}.json`);
  }
}

export function isSafeSessionId(sessionId: string): boolean {
  return safeSessionIdPattern.test(sessionId);
}

export function isIfcReadySessionTraceId(traceId: unknown): traceId is string {
  return typeof traceId === "string"
    && traceId.length <= MAX_SESSION_TRACE_ID_LENGTH
    && safeIfcReadyTracePattern.test(traceId);
}

export function isCanonicalSessionTraceId(traceId: unknown, sessionId: string): traceId is string {
  if (typeof traceId !== "string" || traceId.length > MAX_SESSION_TRACE_ID_LENGTH) {
    return false;
  }
  return traceId === `rev_${sessionId}` || isIfcReadySessionTraceId(traceId);
}

export function isSessionMutable(session: ReviewSession): boolean {
  return session.status === "created" || session.status === "active";
}

function assertSafeSessionId(sessionId: string): void {
  if (!isSafeSessionId(sessionId)) {
    throw new Error("Invalid review session id.");
  }
}
