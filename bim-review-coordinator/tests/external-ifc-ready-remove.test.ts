// model-file-session-lifecycle-contract §3.2（job 檔名）與 §4.4（同鍵 intake job 刪除）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import { sanitizeArtifactIdPart } from "../src/services/streamingConversionClient.js";
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

  it("removes every job sharing the idempotency key, with their correlation and sanitized-correlation index entries (§4.4)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eirs-remove-"));
    roots.push(root);
    const file = path.join(root, "external-ifc-ready.json");
    const store = new ExternalIfcReadyStore(file);
    const kept = create(store, "keep");
    const binding = (correlationId: string) => ({
      correlationId, idempotencyKey: "idem_shared", tenantId: "tenant_t", projectId: "project_t", externalModelVersionId: "version_shared",
    });
    // A job whose download failed is not replayed: a re-sent event with the same key creates a second job.
    const dead = store.create(event("dead", "dead.ifc"), binding("corr:dead"));
    store.markDownloadFailed(dead.ifc_ready_job_id, "source gone");
    const resent = store.create(event("resent", "resent.ifc"), binding("corr:resent"));
    // ':' is rewritten by sanitizeArtifactIdPart, so both jobs also sit in the sanitized-correlation index.
    expect(store.getByCorrelation(sanitizeArtifactIdPart("corr:dead"))?.ifc_ready_job_id).toBe(dead.ifc_ready_job_id);

    expect(store.remove("idem_shared")).toBe(2);
    expect(store.get(dead.ifc_ready_job_id)).toBeUndefined();
    expect(store.get(resent.ifc_ready_job_id)).toBeUndefined();
    expect(store.findExisting("idem_shared", "corr:none")).toBeUndefined();
    for (const correlationId of ["corr:dead", "corr:resent"]) {
      expect(store.findExisting("idem_other", correlationId)).toBeUndefined();
      expect(store.getByCorrelation(correlationId)).toBeUndefined();
      expect(store.getByCorrelation(sanitizeArtifactIdPart(correlationId))).toBeUndefined();
    }
    expect(store.list().map((job) => job.ifc_ready_job_id)).toEqual([kept.ifc_ready_job_id]);
    expect(new ExternalIfcReadyStore(file).list().map((job) => job.ifc_ready_job_id)).toEqual([kept.ifc_ready_job_id]);
    expect(store.remove("idem_shared")).toBe(0);
  });
});
