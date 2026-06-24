import { describe, expect, it } from "vitest";
import { deriveLifecycleStatus } from "../src/services/lifecycleStatus.js";
import type { IfcReadyIntakeJob } from "../src/types.js";

function job(overrides: Partial<IfcReadyIntakeJob>): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: "j1",
    status: "accepted",
    idempotent_replay: false,
    correlation_id: "c1",
    idempotency_key: "k1",
    tenant_id: "t1",
    project_id: "p1",
    external_model_version_id: "v1",
    source_ifc_ref: "ref",
    source_ifc_etag: "etag",
    conversion_job_id: null,
    conversion_status: null,
    conversion_authority: null,
    created_at: "2026-06-24T00:00:00.000Z",
    updated_at: "2026-06-24T00:00:00.000Z",
    ...overrides,
  } as IfcReadyIntakeJob;
}

describe("deriveLifecycleStatus 凍結映射", () => {
  it("accepted → detected", () => {
    expect(deriveLifecycleStatus(job({ status: "accepted" }))).toBe("detected");
  });
  it("queued_for_conversion → queued", () => {
    expect(deriveLifecycleStatus(job({ status: "queued_for_conversion" }))).toBe("queued");
  });
  it("dispatched → converting", () => {
    expect(deriveLifecycleStatus(job({ status: "dispatched" }))).toBe("converting");
  });
  it("dispatched + conversion_status=ready → ready", () => {
    expect(deriveLifecycleStatus(job({ status: "dispatched", conversion_status: "ready" }))).toBe("ready");
  });
  it("failed → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "failed" }))).toBe("failed");
  });
  it("dispatch_failed → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "dispatch_failed" }))).toBe("failed");
  });
  it("dropped_on_restart → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "dropped_on_restart" }))).toBe("failed");
  });
  it("download_status=failed 壓過 accepted → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "accepted", download_status: "failed" }))).toBe("failed");
  });
});
