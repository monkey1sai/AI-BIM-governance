import fs from "node:fs";
import path from "node:path";
import { isSafeSessionId } from "./sessionStore.js";
import { nowIso } from "../utils/time.js";
import type { LifecycleSubjectKind, StructLogger } from "../lib/structLog.js";

export interface SessionEvent {
  event_id: string;
  session_id: string;
  type: string;
  sequence: number;
  payload: unknown;
  created_at: string;
}

type StoredSessionEvent = Omit<SessionEvent, "sequence"> & { sequence?: number };

const LIFECYCLE_EVENT_TYPES = new Set([
  "sessionCreated",
  "sessionActive",
  "sessionClosing",
  "sessionClosed",
  "kitInstanceReleased",
  "kitInstancesReleased",
]);

interface LifecycleMapping {
  subject_kind: LifecycleSubjectKind;
  phase: "start" | "active" | "closing" | "closed";
}

// Source of truth: docs/contracts/structured-log-schema.md §9 EventLog mirror.
// Any new EventLog type MUST add a row here (or fall through to the default).
const STRUCTURED_LIFECYCLE_MAP: Record<string, LifecycleMapping> = {
  sessionCreated: { subject_kind: "review_session", phase: "start" },
  sessionActive: { subject_kind: "review_session", phase: "active" },
  sessionClosing: { subject_kind: "review_session", phase: "closing" },
  sessionClosed: { subject_kind: "review_session", phase: "closed" },
  kitInstanceReleased: { subject_kind: "kit_subprocess", phase: "closed" },
  kitInstancesReleased: { subject_kind: "kit_subprocess", phase: "closed" },
  // firstFrameObserved 是 session active 期間的 operational milestone（WebRTC 首幀到達），非 session
  // 狀態機 transition。依合約 §9「Any other type → active」顯式登記為 active（取代隱晦 fall-through，
  // 明確化映射意圖）；下游若只想統計真 lifecycle transition，須用 data.eventlog_type（mirror 已帶於
  // line ~98）排除此類 operational milestone，勿單憑 phase=active 計入活躍期。
  firstFrameObserved: { subject_kind: "review_session", phase: "active" },
};

export interface EventLogOptions {
  /**
   * Structured log adapter — when present, every successful `append()` also
   * emits a parallel `lifecycle` record per docs/contracts/structured-log-schema.md §9.
   * Existing callers (unit tests that construct `new EventLog(dir)`) keep
   * working without the mirror.
   */
  structLog?: StructLogger;
}

export class EventLog {
  private readonly structLog?: StructLogger;

  constructor(private readonly rootDir: string, options: EventLogOptions = {}) {
    fs.mkdirSync(this.rootDir, { recursive: true });
    this.structLog = options.structLog;
  }

  append(sessionId: string, type: string, payload: unknown): SessionEvent {
    assertSafeSessionId(sessionId);
    this.migrateLegacyIfNeeded(sessionId);
    const event: SessionEvent = {
      event_id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      session_id: sessionId,
      type,
      sequence: this.nextSequence(sessionId),
      payload,
      created_at: nowIso(),
    };
    fs.appendFileSync(this.filePath(sessionId), `${JSON.stringify(event)}\n`, "utf8");
    this.mirrorToStructuredLog(event);
    return event;
  }

  private mirrorToStructuredLog(event: SessionEvent): void {
    if (!this.structLog) return;
    const mapping =
      STRUCTURED_LIFECYCLE_MAP[event.type] ??
      ({ subject_kind: "review_session", phase: "active" } as LifecycleMapping);
    let subjectId = event.session_id;
    if (event.type === "kitInstanceReleased") {
      const released = (event.payload as { kit_instance_id?: unknown })?.kit_instance_id;
      if (typeof released === "string") subjectId = released;
    } else if (event.type === "kitInstancesReleased") {
      const released = (event.payload as { kit_instance_ids?: unknown })?.kit_instance_ids;
      if (Array.isArray(released)) subjectId = released.map(String).join(",");
    }
    try {
      this.structLog
        .withTraceId(`rev_${event.session_id}`)
        .lifecycle("eventLog", `${event.type} (sequence=${event.sequence})`, {
          phase: mapping.phase,
          subject_kind: mapping.subject_kind,
          subject_id: subjectId,
          event_id: event.event_id,
          eventlog_type: event.type,
        });
    } catch {
      // Best-effort mirror — never let structured log issues affect EventLog callers.
    }
  }

  list(sessionId: string): SessionEvent[] {
    if (!isSafeSessionId(sessionId)) return [];
    const file = this.filePath(sessionId);
    if (fs.existsSync(file)) {
      const events: StoredSessionEvent[] = [];
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line) return;
        try {
          events.push(JSON.parse(line) as StoredSessionEvent);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const msg = `EventLog: skipping malformed event in ${path.basename(file)} line ${index + 1}: ${reason}`;
          if (this.structLog) {
            this.structLog.anomaly("eventLog", msg, {
              anomaly_kind: "unexpected_state",
              reason,
              file: path.basename(file),
              line_number: index + 1,
            });
          } else {
            console.warn(msg);
          }
        }
      });
      return withSequences(events);
    }
    return withSequences(this.readLegacy(sessionId));
  }

  listLifecycle(sessionId: string): SessionEvent[] {
    return this.list(sessionId).filter((event) => LIFECYCLE_EVENT_TYPES.has(event.type));
  }

  private migrateLegacyIfNeeded(sessionId: string): void {
    const target = this.filePath(sessionId);
    if (fs.existsSync(target)) return;
    const legacyEvents = this.readLegacy(sessionId);
    if (legacyEvents.length === 0) return;
    const serialized = withSequences(legacyEvents).map((event) => JSON.stringify(event)).join("\n");
    fs.writeFileSync(target, `${serialized}\n`, "utf8");
  }

  private readLegacy(sessionId: string): StoredSessionEvent[] {
    const legacyFile = path.join(this.rootDir, `${sessionId}.json`);
    if (!fs.existsSync(legacyFile)) return [];
    try {
      const payload = JSON.parse(fs.readFileSync(legacyFile, "utf8")) as { items?: StoredSessionEvent[] };
      return Array.isArray(payload.items) ? payload.items : [];
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const msg = `EventLog: legacy file ${path.basename(legacyFile)} unreadable: ${reason}`;
      if (this.structLog) {
        this.structLog.anomaly("eventLog", msg, {
          anomaly_kind: "unexpected_state",
          reason,
          file: path.basename(legacyFile),
          phase: "legacy_read",
        });
      } else {
        console.warn(msg);
      }
      return [];
    }
  }

  private filePath(sessionId: string): string {
    assertSafeSessionId(sessionId);
    return path.join(this.rootDir, `${sessionId}.jsonl`);
  }

  private nextSequence(sessionId: string): number {
    const existing = this.list(sessionId);
    const lastSequence = existing.reduce((max, event) => Math.max(max, event.sequence), 0);
    return lastSequence + 1;
  }
}

function assertSafeSessionId(sessionId: string): void {
  if (!isSafeSessionId(sessionId)) {
    throw new Error("Invalid review session id.");
  }
}

function withSequences(events: StoredSessionEvent[]): SessionEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: typeof event.sequence === "number" && event.sequence > 0 ? event.sequence : index + 1,
  }));
}
