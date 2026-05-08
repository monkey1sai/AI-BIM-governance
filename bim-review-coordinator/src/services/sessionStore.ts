import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ArtifactBinding, KitInstance, KitInstanceBinding, ReviewParticipant, ReviewSession, SessionStatus } from "../types.js";
import { nowIso } from "../utils/time.js";

const safeSessionIdPattern = /^review_session_[A-Za-z0-9_-]+$/;

export interface CreateSessionInput {
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
}

export class SessionStore {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  create(input: CreateSessionInput): ReviewSession {
    const timestamp = nowIso();
    const kitInstanceBindings = input.kit_instance_bindings || [];
    const session: ReviewSession = {
      session_id: `review_session_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
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

  save(session: ReviewSession): void {
    assertSafeSessionId(session.session_id);
    session.updated_at = nowIso();
    fs.writeFileSync(this.filePath(session.session_id), JSON.stringify(session, null, 2), "utf8");
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

  private filePath(sessionId: string): string {
    assertSafeSessionId(sessionId);
    return path.join(this.rootDir, `${sessionId}.json`);
  }
}

export function isSafeSessionId(sessionId: string): boolean {
  return safeSessionIdPattern.test(sessionId);
}

export function isSessionMutable(session: ReviewSession): boolean {
  return session.status === "created" || session.status === "active";
}

function assertSafeSessionId(sessionId: string): void {
  if (!isSafeSessionId(sessionId)) {
    throw new Error("Invalid review session id.");
  }
}
