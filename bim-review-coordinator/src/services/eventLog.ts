import fs from "node:fs";
import path from "node:path";
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
    const event: SessionEvent = {
      event_id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      session_id: sessionId,
      type,
      payload,
      created_at: nowIso(),
    };
    const events = this.list(sessionId);
    events.push(event);
    fs.writeFileSync(this.filePath(sessionId), JSON.stringify({ items: events }, null, 2), "utf8");
    return event;
  }

  list(sessionId: string): SessionEvent[] {
    const file = this.filePath(sessionId);
    if (!fs.existsSync(file)) return [];
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as { items?: SessionEvent[] };
    return Array.isArray(payload.items) ? payload.items : [];
  }

  private filePath(sessionId: string): string {
    return path.join(this.rootDir, `${sessionId}.json`);
  }
}
