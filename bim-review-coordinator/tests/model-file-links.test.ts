// model-file-session-lifecycle-contract §3.1 歸屬規則、§3.2 檔名推導、§4.4 在途判定。
import { describe, expect, it } from "vitest";
import {
  activeLinkedSessionIds, isIntakeJobInFlight, linkSessionsToRecord, recordSourceFilename,
} from "../src/services/modelFileLinks.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../src/types.js";

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
    expect(recordSourceFilename(withKey, [], [])).toBe("model.ifc");
    const jobs = [job({ idempotency_key: record.idempotency_key, source_ifc_filename: "from_job.ifc" })];
    expect(recordSourceFilename(record, jobs, [])).toBe("from_job.ifc");
    const linked = session({ session_id: "review_session_l", artifact_bindings: [{ binding_id: "b", artifact_group_id: "g", model_version_id: "m",
      artifact_id: "a", artifact_role: "derived", url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready", source_ifc_filename: "from_binding.ifc" }] });
    expect(recordSourceFilename(record, [], [linked])).toBe("from_binding.ifc");
    expect(recordSourceFilename(record, [], [])).toBeNull();
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
