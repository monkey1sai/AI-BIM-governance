/**
 * Unit tests for src/services/sessionStore.ts
 *
 * Tests cover the NEW exports added in this PR:
 *   - isSafeSessionId
 *   - isSessionMutable   (NEW in this PR)
 *   - SessionStore: create, get, save, join, leave, update, setStatus
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore, isSafeSessionId, isSessionMutable } from "../src/services/sessionStore.js";
import type { KitInstance, KitInstanceBinding, ReviewSession } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-store-unit-test-"));
}

const dummyKitInstance: KitInstance = {
  instance_id: "kit_local_001",
  provider: "local_fixed",
  status: "ready",
  stream_server: "127.0.0.1",
  signaling_port: 49100,
  media_server: "127.0.0.1",
};

const dummyKitBinding: KitInstanceBinding = {
  kit_instance_id: "kit_local_001",
  provider: "local_fixed",
  tenant_id: "tenant_001",
  assigned_artifact_ids: ["artifact_usdc_001"],
  status: "ready",
  stream_config: {
    signalingServer: "127.0.0.1",
    signalingPort: 49100,
    mediaServer: "127.0.0.1",
  },
  started_at: "2026-01-01T00:00:00.000Z",
  last_heartbeat_at: "2026-01-01T00:00:00.000Z",
  released_at: null,
  gpu_profile: { profile: "local_fixed", capacity_slot: "local-slot-1" },
};

function createBaseSession(store: SessionStore, overrides: Partial<Parameters<SessionStore["create"]>[0]> = {}): ReviewSession {
  return store.create({
    project_id: "project_001",
    model_version_id: "version_001",
    created_by: "user_001",
    kit_instance: dummyKitInstance,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// isSafeSessionId
// ---------------------------------------------------------------------------

describe("isSafeSessionId", () => {
  it("accepts valid session ids with prefix and alphanumeric suffix", () => {
    expect(isSafeSessionId("review_session_abc123")).toBe(true);
  });

  it("accepts session ids with hyphens and underscores in suffix", () => {
    expect(isSafeSessionId("review_session_abc-123_XYZ")).toBe(true);
  });

  it("rejects ids without the required prefix", () => {
    expect(isSafeSessionId("session_abc123")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeSessionId("")).toBe(false);
  });

  it("rejects path traversal attempts", () => {
    expect(isSafeSessionId("../secrets")).toBe(false);
    expect(isSafeSessionId("review_session_../../etc")).toBe(false);
  });

  it("rejects ids with slashes", () => {
    expect(isSafeSessionId("review_session_/bad/path")).toBe(false);
  });

  it("rejects ids with spaces", () => {
    expect(isSafeSessionId("review_session_bad id")).toBe(false);
  });

  it("rejects ids with special shell characters", () => {
    expect(isSafeSessionId("review_session_bad;rm -rf")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSessionMutable
// ---------------------------------------------------------------------------

describe("isSessionMutable", () => {
  it("returns true for status created", () => {
    const session = { status: "created" } as ReviewSession;
    expect(isSessionMutable(session)).toBe(true);
  });

  it("returns true for status active", () => {
    const session = { status: "active" } as ReviewSession;
    expect(isSessionMutable(session)).toBe(true);
  });

  it("returns false for status closing", () => {
    const session = { status: "closing" } as ReviewSession;
    expect(isSessionMutable(session)).toBe(false);
  });

  it("returns false for status closed", () => {
    const session = { status: "closed" } as ReviewSession;
    expect(isSessionMutable(session)).toBe(false);
  });

  it("returns false for status failed", () => {
    const session = { status: "failed" } as ReviewSession;
    expect(isSessionMutable(session)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

describe("SessionStore", () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("returns a session with a valid session_id prefix", () => {
      const session = createBaseSession(store);

      expect(session.session_id).toMatch(/^review_session_/);
    });

    it("mints and persists the server-owned standalone trace root", () => {
      const session = createBaseSession(store);

      expect(session.trace_id).toBe(`rev_${session.session_id}`);
      expect(store.get(session.session_id)?.trace_id).toBe(session.trace_id);
    });

    it("persists an exact server-supplied IFC-ready trace root", () => {
      const session = createBaseSession(store, { trace_id: "ifcready_root_001" });

      expect(session.trace_id).toBe("ifcready_root_001");
      expect(store.get(session.session_id)?.trace_id).toBe("ifcready_root_001");
    });

    it("rejects malformed or nested server-supplied trace roots", () => {
      expect(() => createBaseSession(store, { trace_id: "ifcready_ifcready_nested" })).toThrow(
        "Invalid review session trace_id.",
      );
      expect(() => createBaseSession(store, { trace_id: "external_untrusted" })).toThrow(
        "Invalid review session trace_id.",
      );
      for (const nested of [
        "ifcready_rev_nested",
        "ifcready_stream_conv_nested",
        "ifcready_script_nested",
        "ifcready_external_nested",
      ]) {
        expect(() => createBaseSession(store, { trace_id: nested })).toThrow(
          "Invalid review session trace_id.",
        );
      }
    });

    it("sets status to created when no kit_instance_bindings are provided", () => {
      const session = createBaseSession(store, { kit_instance_bindings: [] });

      expect(session.status).toBe("created");
    });

    it("sets status to active when kit_instance_bindings are provided", () => {
      const session = createBaseSession(store, { kit_instance_bindings: [dummyKitBinding] });

      expect(session.status).toBe("active");
    });

    it("stores review_request_id when provided", () => {
      const session = createBaseSession(store, { review_request_id: "review_request_007" });

      expect(session.review_request_id).toBe("review_request_007");
    });

    it("stores artifact_bindings", () => {
      const bindings = [
        {
          binding_id: "binding_1",
          artifact_group_id: "ag_001",
          model_version_id: "version_001",
          artifact_id: "artifact_usdc_001",
          artifact_role: "derived" as const,
          url: "edge-local://artifacts/model.usdc",
          mapping_url: null,
          load_order: 0,
          routing_policy: "same_instance" as const,
          ready_status: "ready" as const,
        },
      ];
      const session = createBaseSession(store, { artifact_bindings: bindings });

      expect(session.artifact_bindings).toHaveLength(1);
      expect(session.artifact_bindings[0].artifact_id).toBe("artifact_usdc_001");
    });

    it("persists session to disk", () => {
      const session = createBaseSession(store);
      const filePath = path.join(tmpDir, `${session.session_id}.json`);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("defaults tenant_id to tenant_demo_001 when not provided", () => {
      const session = createBaseSession(store);

      expect(session.tenant_id).toBe("tenant_demo_001");
    });

    it("uses provided tenant_id when given", () => {
      const session = createBaseSession(store, { tenant_id: "tenant_special" });

      expect(session.tenant_id).toBe("tenant_special");
    });
  });

  describe("recreation receipts", () => {
    it("survives a store restart and persists only the idempotency-key digest", () => {
      const source = createBaseSession(store);
      const recreated = createBaseSession(store, { recreated_from_session_id: source.session_id });
      const rawKey = "closed-recreate-operator-retry";
      const digest = createHash("sha256").update(rawKey).digest("hex");

      store.recordRecreationReceipt(source.session_id, digest, recreated.session_id);

      const restartedStore = new SessionStore(tmpDir);
      expect(restartedStore.getRecreationReceipt(source.session_id, digest)).toBe(recreated.session_id);
      const receiptDir = path.join(tmpDir, ".recreation-receipts");
      const receiptFiles = fs.readdirSync(receiptDir);
      expect(receiptFiles).toEqual([`${source.session_id}.${digest}.receipt`]);
      expect(`${receiptFiles[0]}:${fs.readFileSync(path.join(receiptDir, receiptFiles[0]), "utf8")}`).not.toContain(rawKey);
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe("get", () => {
    it("returns null for non-existent session", () => {
      const result = store.get("review_session_nonexistent");

      expect(result).toBeNull();
    });

    it("returns null for invalid session id", () => {
      const result = store.get("../../../etc/passwd");

      expect(result).toBeNull();
    });

    it("retrieves a created session by id", () => {
      const created = createBaseSession(store);

      const fetched = store.get(created.session_id);

      expect(fetched).not.toBeNull();
      expect(fetched?.session_id).toBe(created.session_id);
      expect(fetched?.project_id).toBe("project_001");
    });
  });

  // -------------------------------------------------------------------------
  // join
  // -------------------------------------------------------------------------

  describe("join", () => {
    it("returns null for unknown session", () => {
      const result = store.join("review_session_nonexistent", { user_id: "user_001" });

      expect(result).toBeNull();
    });

    it("adds a participant to the session", () => {
      const session = createBaseSession(store);

      const updated = store.join(session.session_id, { user_id: "user_001", display_name: "User One" });

      expect(updated?.participants).toHaveLength(1);
      expect(updated?.participants[0].user_id).toBe("user_001");
      expect(updated?.participants[0].display_name).toBe("User One");
    });

    it("updates existing participant instead of duplicating", () => {
      const session = createBaseSession(store);
      store.join(session.session_id, { user_id: "user_001" });

      const updated = store.join(session.session_id, { user_id: "user_001", display_name: "Updated Name" });

      expect(updated?.participants).toHaveLength(1);
      expect(updated?.participants[0].display_name).toBe("Updated Name");
    });

    it("adds multiple distinct participants", () => {
      const session = createBaseSession(store);
      store.join(session.session_id, { user_id: "user_001" });

      const updated = store.join(session.session_id, { user_id: "user_002" });

      expect(updated?.participants).toHaveLength(2);
    });

    it("persists the join to disk", () => {
      const session = createBaseSession(store);
      store.join(session.session_id, { user_id: "user_001" });

      const reloaded = store.get(session.session_id);

      expect(reloaded?.participants).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // leave
  // -------------------------------------------------------------------------

  describe("leave", () => {
    it("returns null for unknown session", () => {
      const result = store.leave("review_session_nonexistent", "user_001");

      expect(result).toBeNull();
    });

    it("removes a participant from the session", () => {
      const session = createBaseSession(store);
      store.join(session.session_id, { user_id: "user_001" });
      store.join(session.session_id, { user_id: "user_002" });

      const updated = store.leave(session.session_id, "user_001");

      expect(updated?.participants).toHaveLength(1);
      expect(updated?.participants[0].user_id).toBe("user_002");
    });

    it("does not throw when leaving a session you were not in", () => {
      const session = createBaseSession(store);

      const updated = store.leave(session.session_id, "user_never_joined");

      expect(updated?.participants).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe("update", () => {
    it("returns null for unknown session", () => {
      const result = store.update("review_session_nonexistent", { status: "closed" });

      expect(result).toBeNull();
    });

    it("merges partial updates into the session", () => {
      const session = createBaseSession(store);

      const updated = store.update(session.session_id, { mode: "multi_kit" });

      expect(updated?.mode).toBe("multi_kit");
      expect(updated?.project_id).toBe("project_001");
    });

    it("persists updates to disk", () => {
      const session = createBaseSession(store);
      store.update(session.session_id, { mode: "multi_kit" });

      const reloaded = store.get(session.session_id);

      expect(reloaded?.mode).toBe("multi_kit");
    });

    it("rejects attempts to replace an existing canonical trace root", () => {
      const session = createBaseSession(store);

      expect(() => store.update(session.session_id, { trace_id: "ifcready_replacement" })).toThrow(
        "Review session trace_id is immutable.",
      );
      expect(store.get(session.session_id)?.trace_id).toBe(session.trace_id);
    });
  });

  describe("backfillTraceId", () => {
    it("backfills a legacy missing trace exactly once", () => {
      const session = createBaseSession(store);
      const filePath = path.join(tmpDir, `${session.session_id}.json`);
      const legacy = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      delete legacy.trace_id;
      fs.writeFileSync(filePath, JSON.stringify(legacy, null, 2), "utf8");

      const first = store.backfillTraceId(session.session_id, "ifcready_legacy_001");
      expect(first?.trace_id).toBe("ifcready_legacy_001");
      expect(() => store.backfillTraceId(session.session_id, "ifcready_legacy_002")).toThrow(
        "Review session trace_id is immutable.",
      );
      expect(store.get(session.session_id)?.trace_id).toBe("ifcready_legacy_001");
    });
  });

  // -------------------------------------------------------------------------
  // setStatus
  // -------------------------------------------------------------------------

  describe("setStatus", () => {
    it("returns null for unknown session", () => {
      const result = store.setStatus("review_session_nonexistent", "closed");

      expect(result).toBeNull();
    });

    it("updates session status", () => {
      const session = createBaseSession(store);

      const updated = store.setStatus(session.session_id, "closed");

      expect(updated?.status).toBe("closed");
    });

    it("persists status change to disk", () => {
      const session = createBaseSession(store);
      store.setStatus(session.session_id, "closing");

      const reloaded = store.get(session.session_id);

      expect(reloaded?.status).toBe("closing");
    });
  });

  // -------------------------------------------------------------------------
  // Safety: assertSafeSessionId on save
  // -------------------------------------------------------------------------

  describe("save", () => {
    it("throws when saving a session with an invalid session_id", () => {
      const session = createBaseSession(store);
      session.session_id = "../traversal/evil";

      expect(() => store.save(session)).toThrow("Invalid review session id.");
    });

    it("does not allow public save to bypass resolver-owned legacy backfill", () => {
      const session = createBaseSession(store);
      const filePath = path.join(tmpDir, `${session.session_id}.json`);
      const legacy = JSON.parse(fs.readFileSync(filePath, "utf8")) as ReviewSession;
      delete legacy.trace_id;
      fs.writeFileSync(filePath, JSON.stringify(legacy, null, 2), "utf8");
      legacy.trace_id = "ifcready_bypass_001";

      expect(() => store.save(legacy)).toThrow("Review session trace_id backfill requires resolver.");
      expect(store.get(session.session_id)?.trace_id).toBeUndefined();
    });
  });
});
