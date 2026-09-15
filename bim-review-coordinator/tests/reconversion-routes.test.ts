import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";

let app: CoordinatorApp | undefined;
let root: string | undefined;
afterEach(async () => {
  if (app) { await app.dispose(); app.io.close(); app.server.close(); app = undefined; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = undefined; }
});
function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "reconversion-http-"));
  const ledgerPath = path.join(root, "ledger.json");
  const ledger = new ConversionLedger(ledgerPath);
  for (const [id, key, bucket, status] of [
    ["mw_original", "project/main/v1/model.ifc", "bim-control", "ready"],
    ["mw_new", "project/main/v1/model.ifc", "bim-control", "queued"],
    ["mw_other", "other/main/v1/model.ifc", "bim-control", "ready"],
    ["mw_other_bucket", "project/main/v1/model.ifc", "other", "ready"],
  ] as const) ledger.upsert({ idempotency_key: id, correlation_id: id, project_id: "project", project_display_name: "Project",
    category: "main", external_model_version_id: "v1", object_key: key, bucket, source_etag: "etag", status, conversion_job_id: null }, "2026-09-15T01:00:00Z");
  app = createCoordinatorApp({ sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "outbox.json"), conversionLedgerStorePath: ledgerPath,
    minioWatchEnabled: false, minioWatchEndpoint: "http://minio.test:9000", minioWatchBucket: "bim-control",
    minioWatchAccessKey: "test-ak", minioWatchSecretKey: "test-sk", externalIntakeIpAllowlist: [], conversionTriggerIpAllowlist: [],
    streamingConversionApiBase: "http://127.0.0.1:1" });
  return app;
}
describe("reconversion HTTP boundary", () => {
  it("requires the complete reconversion intent before contacting MinIO", async () => {
    const subject = setup();
    const response = await request(subject.app).post("/api/conversion/trigger").send({ key: "project/main/v1/model.ifc", request_id: "reconversion-http-01" });
    expect(response.status).toBe(400);
    expect(response.body.error_code).toBe("invalid_reconversion_intent");
    expect(subject.externalIfcReadyStore.list()).toHaveLength(0);
  });
  it("preserves operator authorization before accepting an intent", async () => {
    const subject = setup();
    subject.config.conversionTriggerIpAllowlist = ["192.0.2.1"];
    subject.config.devAuthToken = "";
    const response = await request(subject.app).post("/api/conversion/trigger").send({ key: "project/main/v1/model.ifc", force_retrigger: true, request_id: "reconversion-http-01", expected_etag: "etag" });
    expect(response.status).toBe(403);
    expect(subject.externalIfcReadyStore.list()).toHaveLength(0);
  });
  it("filters history before limiting and excludes another object or bucket", async () => {
    const subject = setup();
    const response = await request(subject.app).get("/api/conversion/records").query({ object_key: "project/main/v1/model.ifc", limit: 1 });
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].converter_version).toBeNull();
  });
  it("reports an uncertain dispatch without exposing raw signed URLs or inventing terminal failure", async () => {
    const subject = setup();
    const job = subject.externalIfcReadyStore.create({ event: "ifc_ready", tenant_id: "test", project_id: "project", external_model_version_id: "v1", source_ifc: { ref: "https://source.invalid/file", etag: "etag" } },
      { idempotencyKey: "mw_new", correlationId: "mw_new", tenantId: "test", projectId: "project", externalModelVersionId: "v1" });
    subject.externalIfcReadyStore.markDispatchFailed(job.ifc_ready_job_id, "https://private.invalid/?X-Amz-Signature=test-secret");
    const intake = await request(subject.app).get("/api/external/ifc-ready");
    expect(intake.body.items[0]).toMatchObject({ source_object_key: "project/main/v1/model.ifc", source_ifc_etag: "etag" });
    const response = await request(subject.app).get("/api/conversion/records").query({ object_key: "project/main/v1/model.ifc" });
    expect(response.body.items.find((row: { idempotency_key: string }) => row.idempotency_key === "mw_new"))
      .toMatchObject({ status: "queued", dispatch_state: "dispatch_failed", failure_code: "dispatch_unconfirmed" });
    expect(JSON.stringify(response.body)).not.toContain("private.invalid");
    expect(JSON.stringify(response.body)).not.toContain("test-secret");
  });
});
