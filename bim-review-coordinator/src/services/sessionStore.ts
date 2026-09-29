import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isReadyReviewSourceSnapshot, fingerprintReadyReviewSource } from "./readyReviewIntent.js";
import type {
  ArtifactBinding,
  ConversionQualityMetricsSummary,
  KitInstance,
  KitInstanceBinding,
  ReviewParticipant,
  ReviewSession,
  ReadyReviewSourceSnapshot,
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
  review_request_fingerprint?: string;
  ready_review_source?: ReadyReviewSourceSnapshot;
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

export function isModelBinding(binding: Pick<ArtifactBinding, "artifact_role">): boolean {
  return binding.artifact_role !== "overlay";
}

function sourceProjectsExactly(
  s: Pick<CreateSessionInput, "ready_model_id" | "trace_id" | "tenant_id" | "project_id"
    | "model_version_id" | "usdc_artifact_id" | "artifact_bindings">,
  source: ReadyReviewSourceSnapshot,
): boolean {
  // CFD overlay bindings (artifact_role "overlay", building-energy-cfd-p2-contract.md S2.1) are
  // additive result layers registered after the fact; the ready-review source projects onto the
  // model bindings only, so they are excluded before the exactly-one-binding check.
  const modelBindings = Array.isArray(s.artifact_bindings) ? s.artifact_bindings.filter(isModelBinding) : [];
  if (modelBindings.length !== 1) return false;
  const a = modelBindings[0];
  return !!a && s.ready_model_id === source.ready_model_id && s.trace_id === source.root_trace_id
    && s.tenant_id === source.tenant_id && s.project_id === source.project_id
    && s.model_version_id === source.model_version_id
    && s.usdc_artifact_id === "auto_usdc_" + source.conversion_job_id
    && a.artifact_id === s.usdc_artifact_id && a.artifact_group_id === "ag_" + source.model_version_id
    && a.model_version_id === source.model_version_id && a.artifact_role === "derived"
    && a.ready_status === "ready" && a.load_order === 0 && a.routing_policy === "same_instance"
    && a.conversion_authority === "bim-streaming-server" && a.conversion_status === "ready"
    && a.conversion_job_id === source.conversion_job_id
    && a.url === source.model.url && a.mapping_url === source.mapping.url;
}
export function isCanonicalReadyReviewSourceCarrier(value: unknown): value is ReviewSession & {
  ready_review_source: ReadyReviewSourceSnapshot; review_request_fingerprint: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as ReviewSession;
  return isReadyReviewSourceSnapshot(s.ready_review_source)
    && s.review_request_fingerprint === fingerprintReadyReviewSource(s.ready_review_source)
    && sourceProjectsExactly(s, s.ready_review_source);
}

/** Whether a session carries a review-request identity: a ready-review source, its fingerprint, or a request-namespace id. */
export function carriesReviewRequest(
  session: Pick<ReviewSession, "session_id" | "ready_review_source" | "review_request_fingerprint">,
): boolean {
  return session.ready_review_source !== undefined || session.review_request_fingerprint !== undefined
    || session.session_id.startsWith("review_session_request_");
}

/**
 * Integrity of a session's review-request carrier (docs/architecture/review-session-opening-adr.md §4). A session that
 * carries nothing (no ready-review source, no fingerprint, not in the request namespace) is `canonical`. A carrier is
 * `canonical` when its ready-review source projection is exact and either its session id is the request-scope id of its
 * `review_request_id` digest (request namespace) or it carries no `review_request_id` at all (outside the namespace).
 */
export function reviewRequestCarrierIntegrity(session: ReviewSession): "canonical" | "corrupt" {
  if (!carriesReviewRequest(session)) return "canonical";
  const requestNamespace = session.session_id.startsWith("review_session_request_");
  if (!isCanonicalReadyReviewSourceCarrier(session)) return "corrupt";
  if (requestNamespace) {
    return isReviewRequestDigest(session.review_request_id)
      && session.session_id === reviewSessionIdForRequestScope(session.review_request_id) ? "canonical" : "corrupt";
  }
  return session.review_request_id === undefined ? "canonical" : "corrupt";
}

export function isReviewRequestDigest(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && /^[a-f0-9]+$/.test(value);
}
export type CreateReviewRequestSessionInput = Omit<CreateSessionInput,
  "session_id" | "tenant_id" | "review_request_id" | "review_request_fingerprint" | "ready_review_source"> & {
  tenant_id: string;
  ready_review_source: ReadyReviewSourceSnapshot;
  review_request_id: string;
  review_request_fingerprint: string;
};
export type CreateReviewRequestSessionResult =
  | {kind: "created"; session: ReviewSession}
  | {kind: "replay"; session: ReviewSession}
  | {kind: "conflict"} | {kind: "corrupt"}
  /** The request's deterministic session id was purged and stays retired (model-file-session-lifecycle-contract §4.3). */
  | {kind: "retired"};
export function reviewSessionIdForRequestScope(scopeDigest: string): string {
  if (!isReviewRequestDigest(scopeDigest)) throw new Error("Invalid review request scope digest.");
  return `review_session_request_${scopeDigest}`;
}
function isCanonicalStoredReviewRequestSession(
  value: unknown, expectedSessionId: string, expectedScopeDigest: string,
): value is ReviewSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<ReviewSession>;
  return isCanonicalReadyReviewSourceCarrier(r)
    && r.session_id === expectedSessionId && r.review_request_id === expectedScopeDigest
    && isReviewRequestDigest(r.review_request_fingerprint)
    && typeof r.tenant_id === "string" && r.tenant_id.length > 0
    && typeof r.project_id === "string" && r.project_id.length > 0
    && typeof r.model_version_id === "string" && r.model_version_id.length > 0
    && typeof r.trace_id === "string"
    && ["created", "active", "closing", "closed", "failed"].includes(String(r.status))
    && Array.isArray(r.artifact_bindings) && Array.isArray(r.kit_instance_bindings)
    && Array.isArray(r.participants);
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
      review_request_fingerprint: input.review_request_fingerprint,
      ready_review_source: input.ready_review_source,
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

  createOrGetReviewRequest(input: CreateReviewRequestSessionInput): CreateReviewRequestSessionResult {
    if (!input.tenant_id || !isReviewRequestDigest(input.review_request_id)
      || !isReadyReviewSourceSnapshot(input.ready_review_source)
      || input.review_request_fingerprint !== fingerprintReadyReviewSource(input.ready_review_source)
      || !sourceProjectsExactly(input, input.ready_review_source)) {
      throw new Error("Invalid review request identity.");
    }
    const sessionId = reviewSessionIdForRequestScope(input.review_request_id);
    const file = this.filePath(sessionId);
    const existedBeforeRead = fs.existsSync(file);
    const parsed = this.readSessionFile(file) as unknown;
    if (parsed !== null) {
      if (!isCanonicalStoredReviewRequestSession(parsed, sessionId, input.review_request_id)) return {kind: "corrupt"};
      if (parsed.review_request_fingerprint !== input.review_request_fingerprint) return {kind: "conflict"};
      return {kind: "replay", session: parsed};
    }
    // spec §4.3「舊 id 永不復活」：deterministic id（review_request 命名空間）一旦被 purge 就永久退役，
    // 同一個 request 重放回 retired（路由 409 review_session_retired），不當成損壞。
    if (this.isPurged(sessionId)) return {kind: "retired"};
    if (existedBeforeRead || this.hasQuarantinedSession(sessionId)) return {kind: "corrupt"};
    return {kind: "created", session: this.create({...input, session_id: sessionId})};
  }
  private hasQuarantinedSession(sessionId: string): boolean {
    const prefix = `${sessionId}.json.corrupt-`;
    return fs.readdirSync(this.rootDir).some(entry => entry.startsWith(prefix));
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

  /**
   * 契約 §4.3：寫固定名稱的退役標記 `<id>.json.purged`。冪等：已存在就保留原檔。purge 流程第一步就寫它，
   * 之後任何一步失敗，這個 id 都不會再被寫出新檔（見 persistSession）。只是存在與否的旗標，不需要 tmp+rename；
   * list() 只認 `.json` 結尾，不會撿到它。
   */
  markPurged(sessionId: string): void {
    try {
      fs.writeFileSync(this.purgedMarkerPath(sessionId), JSON.stringify({ purged_at: nowIso() }), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  /**
   * 刪除 session 檔（契約 §4.3）。狀態檢查由路由負責。先寫退役標記再刪檔，刪檔失敗時 id 仍是退役的；
   * 不碰 .recreation-receipts 與 .corrupt-* 隔離檔；session 檔不存在回 false，purge 後同 id 永久 404。
   */
  purge(sessionId: string): boolean {
    const file = this.filePath(sessionId); // filePath 內 assertSafeSessionId 擋不安全 id
    if (!fs.existsSync(file)) return false;
    this.markPurged(sessionId);
    fs.rmSync(file);
    return true;
  }

  /** 契約 §4.3「舊 id 永不復活」：這個 id 是否已被 purge（退役標記是否存在）。 */
  isPurged(sessionId: string): boolean {
    return fs.existsSync(this.purgedMarkerPath(sessionId));
  }

  private purgedMarkerPath(sessionId: string): string {
    return `${this.filePath(sessionId)}.purged`; // filePath 內 assertSafeSessionId 擋不安全 id
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
    // 契約 §4.3「舊 id 永不復活」：已 purge 的 id 不再寫出新檔——顯式 id 的 create（recreate、review request）
    // 與持有舊物件的 save（例如 await 探測後才寫回的 artifact health）都擋在這裡。
    if (existing === null && this.isPurged(session.session_id)) {
      throw new Error("Review session id is retired.");
    }
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
    if (session.ready_review_source !== undefined || session.review_request_fingerprint !== undefined) {
      if (!isCanonicalReadyReviewSourceCarrier(session)) throw new Error("Invalid ready review source projection.");
    }
    if (existing?.ready_review_source !== undefined || existing?.review_request_fingerprint !== undefined) {
      if (!isCanonicalReadyReviewSourceCarrier(existing) || !isCanonicalReadyReviewSourceCarrier(session)
        || existing.review_request_fingerprint !== session.review_request_fingerprint
        || !isDeepStrictEqual(existing.ready_review_source, session.ready_review_source)) {
        throw new Error("Ready review source identity is immutable.");
      }
    }
    if (session.review_request_fingerprint !== undefined && !isReviewRequestDigest(session.review_request_fingerprint)) {
      throw new Error("Invalid review request fingerprint.");
    }
    if (existing?.review_request_id !== undefined && session.review_request_id !== existing.review_request_id) {
      throw new Error("Review session review_request_id is immutable.");
    }
    if (existing?.review_request_fingerprint !== undefined && session.review_request_fingerprint !== existing.review_request_fingerprint) {
      throw new Error("Review session review_request_fingerprint is immutable.");
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

const MAX_RECREATION_LINEAGE_HOPS = 32;

/**
 * 契約 §4.3：其他 session 的 recreated_from_session_id 鏈經過 `targetSessionId` 者（任何狀態），依 `sessions` 的順序。
 * 後代的 lineage 查找沿這條鏈走回祖先，所以祖先要等後代都清掉才能 purge。每條鏈最多走 32 跳並防環。
 */
export function recreationDescendantIds(
  targetSessionId: string,
  sessions: readonly Pick<ReviewSession, "session_id" | "recreated_from_session_id">[],
): string[] {
  const parentOf = new Map(sessions.map((session) => [session.session_id, session.recreated_from_session_id]));
  const descendants: string[] = [];
  for (const session of sessions) {
    if (session.session_id === targetSessionId) continue;
    const visited = new Set<string>([session.session_id]);
    let ancestor = session.recreated_from_session_id;
    for (let hops = 1; ancestor && hops <= MAX_RECREATION_LINEAGE_HOPS && !visited.has(ancestor); hops += 1) {
      if (ancestor === targetSessionId) {
        descendants.push(session.session_id);
        break;
      }
      visited.add(ancestor);
      ancestor = parentOf.get(ancestor);
    }
  }
  return descendants;
}

function assertSafeSessionId(sessionId: string): void {
  if (!isSafeSessionId(sessionId)) {
    throw new Error("Invalid review session id.");
  }
}
