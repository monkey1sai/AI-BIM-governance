import fs from "node:fs";
import path from "node:path";
import { isSafeSessionId } from "./sessionStore.js";
import { nowIso } from "../utils/time.js";

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

export class EventLog {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
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
    return event;
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
          console.warn(
            `EventLog: skipping malformed event in ${path.basename(file)} line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          );
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
      console.warn(
        `EventLog: legacy file ${path.basename(legacyFile)} unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
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
