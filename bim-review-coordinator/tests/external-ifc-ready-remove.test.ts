// model-file-session-lifecycle-contract §3.2（job 檔名）與 §4.4（同鍵 intake job 刪除）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import type { ExternalIfcReadyEvent } from "../src/types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function event(suffix: string, filename: string | null): ExternalIfcReadyEvent {
  return {
    event: "ifc_ready", tenant_id: "tenant_t", project_id: "project_t",
    external_model_version_id: `version_${suffix}`, external_conversion_task_id: null,
    source_ifc: { ref: `http://127.0.0.1:1/${suffix}.ifc`, etag: `etag_${suffix}`, filename },
    callback_url: null,
  };
}
function create(store: ExternalIfcReadyStore, suffix: string, filename: string | null = `${suffix}.ifc`) {
  return store.create(event(suffix, filename), {
    correlationId: `corr_${suffix}`, idempotencyKey: `idem_${suffix}`, tenantId: "tenant_t",
    projectId: "project_t", externalModelVersionId: `version_${suffix}`,
  });
}

describe("ExternalIfcReadyStore source_ifc_filename and remove()", () => {
  it("records source_ifc.filename on the job, null when absent", () => {
    const store = new ExternalIfcReadyStore();
    expect(create(store, "a").source_ifc_filename).toBe("a.ifc");
    expect(create(store, "b", null).source_ifc_filename).toBeNull();
  });

  it("removes the job under an idempotency key from every index and persists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eirs-remove-"));
    roots.push(root);
    const file = path.join(root, "external-ifc-ready.json");
    const store = new ExternalIfcReadyStore(file);
    const kept = create(store, "keep");
    const gone = create(store, "gone");
    expect(store.remove("idem_gone")).toBe(1);
    expect(store.remove("idem_gone")).toBe(0);
    expect(store.get(gone.ifc_ready_job_id)).toBeUndefined();
    expect(store.findExisting("idem_gone", "corr_gone")).toBeUndefined();
    expect(store.getByCorrelation("corr_gone")).toBeUndefined();
    expect(store.list().map((job) => job.ifc_ready_job_id)).toEqual([kept.ifc_ready_job_id]);
    const reloaded = new ExternalIfcReadyStore(file);
    expect(reloaded.list().map((job) => job.ifc_ready_job_id)).toEqual([kept.ifc_ready_job_id]);
  });
});
