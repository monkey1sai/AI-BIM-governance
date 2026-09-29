// model-file-session-lifecycle-contract §3.1 歸屬規則、§3.2 檔名推導、§4.4 在途判定。
import { describe, expect, it } from "vitest";
import {
  activeLinkedSessionIds, isIntakeJobInFlight, linkSessionsToRecord, recordSourceFilename, type ConversionRecordSession,
} from "../src/services/modelFileLinks.js";
import type { ArtifactBinding, IfcReadyIntakeJob, ReviewSession } from "../src/types.js";

function session(overrides: Partial<ReviewSession> & Pick<ReviewSession, "session_id">): ReviewSession {
  return {
    tenant_id: "t", project_id: "p", model_version_id: "m", status: "active", mode: "single_kit_shared_state",
    created_by: "unit", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
    kit_instance: {} as ReviewSession["kit_instance"], artifact_bindings: [], kit_instance_bindings: [], participants: [],
    ...overrides,
  };
}
function job(overrides: Partial<IfcReadyIntakeJob> & Pick<IfcReadyIntakeJob, "idempotency_key">): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: `ifcready_${overrides.idempotency_key}`, status: "accepted", idempotent_replay: false,
    correlation_id: "corr", tenant_id: "t", project_id: "p", external_model_version_id: "m",
    source_ifc_ref: "http://127.0.0.1:1/x.ifc", source_ifc_etag: "e", conversion_job_id: null,
    conversion_status: null, conversion_authority: null, download_status: "pending",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}
const record = { idempotency_key: "mw_0123456789abcdef", conversion_job_id: "stream_conv_1", object_key: null as string | null };
function binding(overrides: Partial<ArtifactBinding> & Pick<ArtifactBinding, "artifact_id">): ArtifactBinding {
  return {
    binding_id: `b_${overrides.artifact_id}`, artifact_group_id: "g", model_version_id: "m", artifact_role: "derived",
    url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready", ...overrides,
  };
}
function linkOf(linked: ReviewSession, link: ConversionRecordSession["link"]): ConversionRecordSession {
  return { session_id: linked.session_id, status: linked.status, created_at: linked.created_at, updated_at: linked.updated_at, link };
}
function byId(...sessions: ReviewSession[]): Map<string, ReviewSession> {
  return new Map(sessions.map((item) => [item.session_id, item]));
}

describe("linkSessionsToRecord", () => {
  it("applies R1 ready_model, R2 intake job, R3 artifact binding, first match wins, newest first", () => {
    const r1 = session({ session_id: "review_session_r1", ready_model_id: record.idempotency_key, created_at: "2026-09-03T00:00:00.000Z" });
    const r2 = session({ session_id: "review_session_r2", created_at: "2026-09-02T00:00:00.000Z" });
    const r3 = session({ session_id: "review_session_r3", status: "closed", created_at: "2026-09-01T00:00:00.000Z",
      artifact_bindings: [{ binding_id: "b", artifact_group_id: "g", model_version_id: "m", artifact_id: "a", artifact_role: "derived",
        url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready", conversion_job_id: "stream_conv_1" }] });
    const unrelated = session({ session_id: "review_session_x" });
    const jobs = [job({ idempotency_key: record.idempotency_key, review_session_id: "review_session_r2" })];
    expect(linkSessionsToRecord(record, [unrelated, r3, r2, r1], jobs)).toEqual([
      { session_id: "review_session_r1", status: "active", created_at: r1.created_at, updated_at: r1.updated_at, link: "ready_model" },
      { session_id: "review_session_r2", status: "active", created_at: r2.created_at, updated_at: r2.updated_at, link: "intake_job" },
      { session_id: "review_session_r3", status: "closed", created_at: r3.created_at, updated_at: r3.updated_at, link: "artifact_binding" },
    ]);
  });

  it("does not link through a null conversion_job_id", () => {
    const bound = session({ session_id: "review_session_b", artifact_bindings: [{ binding_id: "b", artifact_group_id: "g", model_version_id: "m",
      artifact_id: "a", artifact_role: "derived", url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready", conversion_job_id: null }] });
    expect(linkSessionsToRecord({ ...record, conversion_job_id: null }, [bound], [])).toEqual([]);
  });
});

describe("recordSourceFilename", () => {
  it("prefers object_key, then job filename, then a linked session binding, then null", () => {
    const withKey = { ...record, object_key: "proj/建築/v1/model.ifc" };
    expect(recordSourceFilename(withKey, [], [], new Map())).toBe("model.ifc");
    const jobs = [job({ idempotency_key: record.idempotency_key, source_ifc_filename: "from_job.ifc" })];
    expect(recordSourceFilename(record, jobs, [], new Map())).toBe("from_job.ifc");
    const linked = session({ session_id: "review_session_l", artifact_bindings: [
      binding({ artifact_id: "a", conversion_job_id: "stream_conv_1", source_ifc_filename: "from_binding.ifc" }),
    ] });
    expect(recordSourceFilename(record, [], [linkOf(linked, "artifact_binding")], byId(linked))).toBe("from_binding.ifc");
    expect(recordSourceFilename(record, [], [], new Map())).toBeNull();
  });

  it("step 2: the intake job filename beats a linked session binding", () => {
    const jobs = [job({ idempotency_key: record.idempotency_key, source_ifc_filename: "from_job.ifc" })];
    const linked = session({ session_id: "review_session_l", ready_model_id: record.idempotency_key, artifact_bindings: [
      binding({ artifact_id: "a", conversion_job_id: "stream_conv_1", source_ifc_filename: "from_binding.ifc" }),
    ] });
    expect(recordSourceFilename(record, jobs, [linkOf(linked, "ready_model")], byId(linked))).toBe("from_job.ifc");
  });

  it("step 3: in a federated session takes the binding whose conversion_job_id is the record's", () => {
    const federated = session({ session_id: "review_session_f", artifact_bindings: [
      binding({ artifact_id: "other", conversion_job_id: "stream_conv_other", source_ifc_filename: "wrong.ifc" }),
      binding({ artifact_id: "mine", load_order: 1, conversion_job_id: "stream_conv_1", source_ifc_filename: "right.ifc" }),
    ] });
    expect(recordSourceFilename(record, [], [linkOf(federated, "artifact_binding")], byId(federated))).toBe("right.ifc");
  });

  it("step 3: never guesses among several model bindings when none carries the record's conversion job", () => {
    const federated = session({ session_id: "review_session_f", ready_model_id: record.idempotency_key, artifact_bindings: [
      binding({ artifact_id: "one", conversion_job_id: "stream_conv_other", source_ifc_filename: "wrong.ifc" }),
      binding({ artifact_id: "two", load_order: 1, conversion_job_id: "stream_conv_another", source_ifc_filename: "right.ifc" }),
    ] });
    expect(recordSourceFilename(record, [], [linkOf(federated, "ready_model")], byId(federated))).toBeNull();
  });

  it("step 3: an R1 or R2 session with exactly one model binding lends its filename without a job match; overlays do not count", () => {
    const single = session({ session_id: "review_session_s", ready_model_id: record.idempotency_key, artifact_bindings: [
      binding({ artifact_id: "model", conversion_job_id: null, source_ifc_filename: "single.ifc" }),
      binding({ artifact_id: "cfd:overlay", artifact_role: "overlay", load_order: 1, source_ifc_filename: null }),
    ] });
    expect(recordSourceFilename(record, [], [linkOf(single, "ready_model")], byId(single))).toBe("single.ifc");
    expect(recordSourceFilename(record, [], [linkOf(single, "intake_job")], byId(single))).toBe("single.ifc");
    // The same session reached only through an unrelated binding link is skipped.
    expect(recordSourceFilename(record, [], [linkOf(single, "artifact_binding")], byId(single))).toBeNull();
  });

  it("step 3: walks the linked sessions in sessions[] order (newest first), not in store order", () => {
    const older = session({ session_id: "review_session_old", created_at: "2026-09-01T00:00:00.000Z", artifact_bindings: [
      binding({ artifact_id: "a", conversion_job_id: "stream_conv_1", source_ifc_filename: "older.ifc" }),
    ] });
    const newer = session({ session_id: "review_session_new", created_at: "2026-09-02T00:00:00.000Z", artifact_bindings: [
      binding({ artifact_id: "a", conversion_job_id: "stream_conv_1", source_ifc_filename: "newer.ifc" }),
    ] });
    const linked = linkSessionsToRecord(record, [older, newer], []);
    expect(linked.map((item) => item.session_id)).toEqual(["review_session_new", "review_session_old"]);
    expect(recordSourceFilename(record, [], linked, byId(older, newer))).toBe("newer.ifc");
  });
});

describe("activeLinkedSessionIds and isIntakeJobInFlight", () => {
  it("keeps only sessions that are not closed or failed", () => {
    expect(activeLinkedSessionIds([
      { session_id: "a", status: "active", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: "c", status: "closed", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: "f", status: "failed", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: "n", status: "created", created_at: "", updated_at: "", link: "intake_job" },
    ])).toEqual(["a", "n"]);
  });

  it("follows the contract §4.4 in-flight table", () => {
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "accepted", download_status: "pending" }))).toBe(true);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "accepted", download_status: "failed" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "queued_for_conversion" }))).toBe(true);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatched", conversion_status: null }))).toBe(true);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatched", conversion_status: "ready" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatched", conversion_status: "failed" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatch_failed" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dropped_on_restart" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "failed" }))).toBe(false);
  });
});
