import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "../../src/services/sessionStore.js";
import { SessionTraceResolver } from "../../src/services/sessionTraceResolver.js";
import type { KitInstance } from "../../src/types.js";

const kit: KitInstance = {
  instance_id: "kit_local_001",
  provider: "local_fixed",
  status: "ready",
  stream_server: "127.0.0.1",
  signaling_port: 49100,
  media_server: "127.0.0.1",
};

describe("SessionTraceResolver", () => {
  let root: string;
  let store: SessionStore;
  let linkedRoots: unknown[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "session-trace-resolver-test-"));
    store = new SessionStore(root);
    linkedRoots = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function createStored(traceId?: string) {
    return store.create({
      project_id: "project_001",
      model_version_id: "version_001",
      created_by: "test",
      kit_instance: kit,
      ...(traceId ? { trace_id: traceId } : {}),
    });
  }

  function makeLegacyMissingTrace(): string {
    const session = createStored();
    const file = path.join(root, `${session.session_id}.json`);
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    delete payload.trace_id;
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    return session.session_id;
  }

  function makeResolver(): SessionTraceResolver {
    return new SessionTraceResolver(store, () => linkedRoots);
  }

  it("accepts a valid stored root with zero or case-exact duplicate linked roots", () => {
    const session = createStored("ifcready_stored_001");
    const resolver = makeResolver();

    expect(resolver.plan(session.session_id)).toMatchObject({
      ok: true,
      plan: { canonicalTraceId: "ifcready_stored_001", needsBackfill: false },
    });
    linkedRoots = ["ifcready_stored_001", "ifcready_stored_001"];
    expect(resolver.plan(session.session_id)).toMatchObject({
      ok: true,
      plan: { canonicalTraceId: "ifcready_stored_001", needsBackfill: false },
    });
  });

  it("fails closed on stored/linked conflict or malformed stored state", () => {
    const session = createStored("ifcready_stored_001");
    linkedRoots = ["ifcready_other_001"];
    expect(makeResolver().plan(session.session_id)).toEqual({ ok: false, error: "session_trace_conflict" });

    const file = path.join(root, `${session.session_id}.json`);
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    payload.trace_id = "malformed";
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    linkedRoots = [];
    expect(makeResolver().plan(session.session_id)).toEqual({ ok: false, error: "malformed_stored_trace" });
  });

  it("plans deterministic legacy roots without mutating the session", () => {
    const sessionId = makeLegacyMissingTrace();
    const resolver = makeResolver();

    expect(resolver.plan(sessionId)).toMatchObject({
      ok: true,
      plan: { canonicalTraceId: `rev_${sessionId}`, needsBackfill: true },
    });
    expect(store.get(sessionId)?.trace_id).toBeUndefined();

    linkedRoots = ["ifcready_linked_001"];
    expect(resolver.plan(sessionId)).toMatchObject({
      ok: true,
      plan: { canonicalTraceId: "ifcready_linked_001", needsBackfill: true },
    });
    expect(store.get(sessionId)?.trace_id).toBeUndefined();
  });

  it("deduplicates linked roots independent of order and rejects ambiguity", () => {
    const sessionId = makeLegacyMissingTrace();
    linkedRoots = ["ifcready_b", "ifcready_a", "ifcready_b"];

    expect(makeResolver().plan(sessionId)).toEqual({ ok: false, error: "ambiguous_linked_trace" });

    linkedRoots = ["ifcready_a", "ifcready_a"];
    expect(makeResolver().plan(sessionId)).toMatchObject({
      ok: true,
      plan: { canonicalTraceId: "ifcready_a", needsBackfill: true },
    });
  });

  it("rejects malformed linked roots instead of ignoring them", () => {
    const sessionId = makeLegacyMissingTrace();
    linkedRoots = ["ifcready_valid", "external_untrusted"];

    expect(makeResolver().plan(sessionId)).toEqual({ ok: false, error: "malformed_linked_trace" });
  });

  it("turns malformed persisted JSON into a stable fail-closed result", () => {
    const session = createStored();
    fs.writeFileSync(path.join(root, `${session.session_id}.json`), "{not-json", "utf8");

    expect(makeResolver().plan(session.session_id)).toEqual({
      ok: false,
      error: "malformed_session_state",
    });
  });

  it("commits only the still-current plan and then preserves immutability", () => {
    const sessionId = makeLegacyMissingTrace();
    linkedRoots = ["ifcready_linked_001"];
    const resolver = makeResolver();
    const planned = resolver.plan(sessionId);
    if (!planned.ok) throw new Error(planned.error);

    const committed = resolver.commit(planned.plan);
    expect(committed).toMatchObject({ ok: true, canonicalTraceId: "ifcready_linked_001" });
    expect(store.get(sessionId)?.trace_id).toBe("ifcready_linked_001");

    linkedRoots = ["ifcready_different_001"];
    expect(resolver.commit(planned.plan)).toEqual({ ok: false, error: "session_trace_conflict" });
    expect(store.get(sessionId)?.trace_id).toBe("ifcready_linked_001");
  });

  it("rechecks linked authority at commit to prevent a stale-plan backfill", () => {
    const sessionId = makeLegacyMissingTrace();
    linkedRoots = ["ifcready_linked_001"];
    const resolver = makeResolver();
    const planned = resolver.plan(sessionId);
    if (!planned.ok) throw new Error(planned.error);

    linkedRoots = ["ifcready_linked_002"];
    expect(resolver.commit(planned.plan)).toEqual({ ok: false, error: "stale_session_trace_plan" });
    expect(store.get(sessionId)?.trace_id).toBeUndefined();
  });
});
