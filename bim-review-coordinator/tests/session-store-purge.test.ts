// model-file-session-lifecycle-contract §4.3：purge 只刪 session 檔與事件檔，並留下固定名稱的退役標記。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLog } from "../src/services/eventLog.js";
import { fingerprintReadyReviewSource, readyReviewSourceSnapshot } from "../src/services/readyReviewIntent.js";
import { recreationDescendantIds, SessionStore, type CreateReviewRequestSessionInput } from "../src/services/sessionStore.js";
import type { KitInstance } from "../src/types.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-purge-unit-"));
  roots.push(root);
  return root;
}

// 與 tests/unit_sessionstore.test.ts 的 dummyKitInstance 同型（src/types.ts KitInstance），
// 取代 brief 草稿中與實際型別不符的 { kit_instance_id, url } 物件。
const dummyKitInstance: KitInstance = {
  instance_id: "kit_local_001",
  provider: "local_fixed",
  status: "ready",
  stream_server: "127.0.0.1",
  signaling_port: 49100,
  media_server: "127.0.0.1",
};

describe("SessionStore.purge and EventLog.remove", () => {
  it("deletes the session file and reports false on a second call", () => {
    const store = new SessionStore(path.join(tempRoot(), "sessions"));
    const session = store.create({
      tenant_id: "t",
      project_id: "p",
      model_version_id: "m",
      created_by: "unit",
      kit_instance: dummyKitInstance,
    });
    expect(store.get(session.session_id)).not.toBeNull();
    expect(store.purge(session.session_id)).toBe(true);
    expect(store.get(session.session_id)).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.purge(session.session_id)).toBe(false);
  });

  it("rejects unsafe ids before touching the filesystem", () => {
    const store = new SessionStore(path.join(tempRoot(), "sessions"));
    expect(() => store.purge("../etc/passwd")).toThrow();
  });

  // spec §4.3「舊 id 永不復活」：purge 留下固定名稱的退役標記，isPurged() 讀得到、list() 讀不到。
  it("leaves the fixed-name retired marker <id>.json.purged after purge: isPurged() is true, list() stays empty", () => {
    const sessionsDir = path.join(tempRoot(), "sessions");
    const store = new SessionStore(sessionsDir);
    const session = store.create({
      tenant_id: "t", project_id: "p", model_version_id: "m", created_by: "unit", kit_instance: dummyKitInstance,
    });
    const neverPurgedId = "review_session_unit_neverpurged1";
    expect(store.isPurged(session.session_id)).toBe(false);
    expect(store.isPurged(neverPurgedId)).toBe(false);

    expect(store.purge(session.session_id)).toBe(true);

    expect(store.isPurged(session.session_id)).toBe(true);
    expect(fs.existsSync(path.join(sessionsDir, `${session.session_id}.json.purged`))).toBe(true);
    expect(store.list()).toEqual([]);
    // A never-purged id must not be reported purged just because some other id's marker exists.
    expect(store.isPurged(neverPurgedId)).toBe(false);
  });

  it("writes the retired marker before deleting the session file, so a failed delete still leaves the id retired (spec §4.3)", () => {
    const sessionsDir = path.join(tempRoot(), "sessions");
    const store = new SessionStore(sessionsDir);
    const session = store.create({
      tenant_id: "t", project_id: "p", model_version_id: "m", created_by: "unit", kit_instance: dummyKitInstance,
    });
    vi.spyOn(fs, "rmSync").mockImplementationOnce(() => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); });
    expect(() => store.purge(session.session_id)).toThrow("EPERM");
    expect(store.isPurged(session.session_id)).toBe(true);
    expect(store.get(session.session_id)).not.toBeNull();
    vi.restoreAllMocks();
    // The retry completes the delete; markPurged() is idempotent.
    store.markPurged(session.session_id);
    expect(store.purge(session.session_id)).toBe(true);
    expect(store.get(session.session_id)).toBeNull();
  });

  it("refuses to write a purged id again: explicit-id create, and save() of a held session object (spec §4.3)", () => {
    const sessionsDir = path.join(tempRoot(), "sessions");
    const store = new SessionStore(sessionsDir);
    const held = store.create({
      tenant_id: "t", project_id: "p", model_version_id: "m", created_by: "unit", kit_instance: dummyKitInstance,
    });
    expect(store.purge(held.session_id)).toBe(true);

    expect(() => store.create({
      session_id: held.session_id, tenant_id: "t", project_id: "p", model_version_id: "m", created_by: "unit",
      kit_instance: dummyKitInstance,
    })).toThrow("Review session id is retired.");
    expect(() => store.save(held)).toThrow("Review session id is retired.");
    expect(fs.existsSync(path.join(sessionsDir, `${held.session_id}.json`))).toBe(false);
    expect(store.get(held.session_id)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("answers retired, not corrupt, when a review request is replayed after its session was purged (spec §4.3)", () => {
    const store = new SessionStore(path.join(tempRoot(), "sessions"));
    const input = reviewRequestInput("1".repeat(64));
    const first = store.createOrGetReviewRequest(input);
    if (first.kind !== "created") throw new Error(`expected created, got ${first.kind}`);
    expect(store.purge(first.session.session_id)).toBe(true);

    expect(store.createOrGetReviewRequest(input)).toEqual({ kind: "retired" });
    expect(store.get(first.session.session_id)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("removes the event file and reports false when there was none", () => {
    const log = new EventLog(path.join(tempRoot(), "events"));
    log.append("review_session_unit000001", "sessionCreated", {});
    expect(log.list("review_session_unit000001")).toHaveLength(1);
    expect(log.remove("review_session_unit000001")).toBe(true);
    expect(log.list("review_session_unit000001")).toEqual([]);
    expect(log.remove("review_session_unit000001")).toBe(false);
  });
});

describe("recreationDescendantIds", () => {
  it("collects every session whose recreated_from_session_id chain passes through the target, whatever its status", () => {
    const sessions = [
      { session_id: "review_session_a" },
      { session_id: "review_session_b", recreated_from_session_id: "review_session_a" },
      { session_id: "review_session_c", recreated_from_session_id: "review_session_b" },
      { session_id: "review_session_x" },
      { session_id: "review_session_y", recreated_from_session_id: "review_session_x" },
    ];
    expect(recreationDescendantIds("review_session_a", sessions)).toEqual(["review_session_b", "review_session_c"]);
    expect(recreationDescendantIds("review_session_b", sessions)).toEqual(["review_session_c"]);
    expect(recreationDescendantIds("review_session_c", sessions)).toEqual([]);
    // A chain that names the target directly counts even when the target itself is not in the list.
    expect(recreationDescendantIds("review_session_gone", [
      { session_id: "review_session_z", recreated_from_session_id: "review_session_gone" },
    ])).toEqual(["review_session_z"]);
  });

  it("stops on a cycle and after 32 hops", () => {
    const cycle = [
      { session_id: "review_session_p", recreated_from_session_id: "review_session_q" },
      { session_id: "review_session_q", recreated_from_session_id: "review_session_p" },
    ];
    expect(recreationDescendantIds("review_session_other", cycle)).toEqual([]);
    const chain = Array.from({ length: 40 }, (_, index) => ({
      session_id: `review_session_n${index}`,
      recreated_from_session_id: index === 0 ? undefined : `review_session_n${index - 1}`,
    }));
    // n32 reaches n0 in 32 hops; n33 would need 33, beyond the bound.
    const descendants = recreationDescendantIds("review_session_n0", chain);
    expect(descendants).toContain("review_session_n32");
    expect(descendants).not.toContain("review_session_n33");
  });
});

function reviewRequestInput(scope: string): CreateReviewRequestSessionInput {
  const source = readyReviewSourceSnapshot({
    readyModelId: "mw_0123456789abcdef", conversionJobId: "stream_conv_fixture",
    correlationId: "fixture", rootTraceId: "ifcready_request_fixture",
    tenantId: "tenant_001", projectId: "project_001", modelVersionId: "version_001",
    model: { url: "http://127.0.0.1/model.usdc", sha256: "a".repeat(64) },
    mapping: { url: "http://127.0.0.1/element_mapping.json", sha256: "b".repeat(64) },
  });
  return {
    ready_model_id: "mw_0123456789abcdef", trace_id: "ifcready_request_fixture",
    review_request_id: scope, review_request_fingerprint: fingerprintReadyReviewSource(source), ready_review_source: source,
    tenant_id: "tenant_001", project_id: "project_001", model_version_id: "version_001",
    usdc_artifact_id: "auto_usdc_stream_conv_fixture", created_by: "coordinator-ready-review-request",
    mode: "single_kit_shared_state", kit_instance: dummyKitInstance,
    artifact_bindings: [{ binding_id: "binding_fixture", artifact_group_id: "ag_version_001",
      model_version_id: "version_001", artifact_id: "auto_usdc_stream_conv_fixture",
      artifact_role: "derived", url: source.model.url, mapping_url: source.mapping.url,
      load_order: 0, routing_policy: "same_instance", ready_status: "ready",
      conversion_authority: "bim-streaming-server", conversion_job_id: "stream_conv_fixture",
      conversion_status: "ready" }], kit_instance_bindings: [], quality_metrics_summary: null,
  };
}
