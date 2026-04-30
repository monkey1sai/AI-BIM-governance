import fs from "node:fs";
import path from "node:path";
import { isSafeSessionId } from "./sessionStore.js";
import { nowIso } from "../utils/time.js";

export interface SessionEvent {
  event_id: string;
  session_id: string;
  type: string;
  payload: unknown;
  created_at: string;
}

export class EventLog {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  append(sessionId: string, type: string, payload: unknown): SessionEvent {
    assertSafeSessionId(sessionId);
    const event: SessionEvent = {
      event_id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      session_id: sessionId,
      type,
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
      return fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SessionEvent);
    }
    const legacyFile = path.join(this.rootDir, `${sessionId}.json`);
    if (!fs.existsSync(legacyFile)) return [];
    const payload = JSON.parse(fs.readFileSync(legacyFile, "utf8")) as { items?: SessionEvent[] };
    return Array.isArray(payload.items) ? payload.items : [];
  }

  private filePath(sessionId: string): string {
    assertSafeSessionId(sessionId);
    return path.join(this.rootDir, `${sessionId}.jsonl`);
  }
}

function assertSafeSessionId(sessionId: string): void {
  if (!isSafeSessionId(sessionId)) {
    throw new Error("Invalid review session id.");
  }
}
