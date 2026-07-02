import { describe, expect, it } from "vitest";
import { deriveFailure } from "../src/services/failureReason.js";
import type { IfcReadyIntakeJob } from "../src/types.js";

function job(overrides: Partial<IfcReadyIntakeJob>): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: "j1", status: "accepted", idempotent_replay: false,
    correlation_id: "c1", idempotency_key: "k1", tenant_id: "t1", project_id: "p1",
    external_model_version_id: "v1", source_ifc_ref: "ref", source_ifc_etag: "etag",
    conversion_job_id: null, conversion_status: null, conversion_authority: null,
    created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as IfcReadyIntakeJob;
}

describe("deriveFailure 收斂失敗欄", () => {
  it("無失敗 → 兩者皆 null(誠實留白)", () => {
    expect(deriveFailure(job({}))).toEqual({ failure_reason: null, failure_stage: null });
  });
  it("download_status=failed + download_failure → stage=download", () => {
    expect(deriveFailure(job({ download_status: "failed", download_failure: "timeout" })))
      .toEqual({ failure_reason: "timeout", failure_stage: "download" });
  });
  it("dispatch_failed + dispatch_error → stage=dispatch", () => {
    expect(deriveFailure(job({ status: "dispatch_failed", dispatch_error: "no slot" })))
      .toEqual({ failure_reason: "no slot", failure_stage: "dispatch" });
  });
  it("dropped_on_restart + dispatch_error → stage=dispatch", () => {
    expect(deriveFailure(job({ status: "dropped_on_restart", dispatch_error: "restart drop" })))
      .toEqual({ failure_reason: "restart drop", failure_stage: "dispatch" });
  });
  it("download 失敗優先於 dispatch(下載失敗即不派工)", () => {
    expect(deriveFailure(job({ download_status: "failed", download_failure: "net", status: "dispatch_failed", dispatch_error: "x" })))
      .toEqual({ failure_reason: "net", failure_stage: "download" });
  });
});
