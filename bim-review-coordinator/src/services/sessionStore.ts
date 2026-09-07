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
    // 單筆讀取維持 fail-closed（SessionTraceResolver 依賴 parse error 浮現）；
    // 只有 list()（啟動掃描）會隔離壞檔，見 readSessionFile。
    return JSON.parse(fs.readFileSync(file, "utf8")) as ReviewSession;
  }

  /**
   * #804：session 目錄改落掛載卷後，寫入中被 kill 的半截 JSON 會跨 recreate 存活；若
   * 啟動時的 list() 直接 JSON.parse 會讓每次重啟都在同一個檔案上崩潰、無法自癒。壞檔在此
   * 隔離成 `<file>.corrupt-<ts>` 並視為不存在（其餘 session 照常服務），寫入端則以 tmp+rename
   * 原子替換，讓這種半截檔不再產生。
   */
  private readSessionFile(file: string): ReviewSession | null {
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as ReviewSession;
    } catch {
      const quarantine = `${file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(file, quarantine);
      } catch {
        // 無法搬走就留在原地；下次讀取仍回 null，不讓一個壞檔拖垮整個 store。
      }
      return null;
    }
  }

  list(): ReviewSession[] {
    if (!fs.existsSync(this.rootDir)) return [];
    return fs
      .readdirSync(this.rootDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -".json".length))
      .filter(isSafeSessionId)
      .map((sessionId) => this.readSessionFile(this.filePath(sessionId)))
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
    const existing = this.readSessionFile(file);
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
    // 原子替換：先寫 tmp 再 rename，容器在寫入中被 kill 也不會留下半截目標檔。
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2), "utf8");
    fs.renameSync(tmp, file);
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
