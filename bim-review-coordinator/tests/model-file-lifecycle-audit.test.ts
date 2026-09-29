// model-file-session-lifecycle-contract §4.3–§4.5：模型檔案生命週期的四個 audit 事件在 app 層真的寫出，
// 欄位齊全、trace id 合法且不超過 200 字元，並通過結構化日誌契約的 validateLogRecordBasic。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { validateLogRecordBasic } from "../src/lib/structLog.js";
import type { ExternalIfcReadyEvent } from "../src/types.js";
import { createAuditLogHarness, readAuditRecords, type AuditLogHarness } from "./helpers/auditLog.js";

const WEBHOOK_SECRET = "audit-test-webhook-secret";
const INTERNAL_TOKEN = "audit-test-internal-token";
const INTAKE_EXAMPLE = (JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "tests", "contracts", "ifc_ready_payload.json"), "utf-8")) as { example: Record<string, unknown> }).example;

let active: CoordinatorApp | null = null;
const roots: string[] = [];
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeApp(ledgerRecords: unknown[] = []): { app: CoordinatorApp; audit: AuditLogHarness } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-file-lifecycle-audit-"));
  const audit = createAuditLogHarness();
  roots.push(root, audit.logRoot);
  const ledgerPath = path.join(root, "conversion-ledger.json");
  fs.writeFileSync(ledgerPath, JSON.stringify({ schema_version: "conversion-ledger/v2", records: ledgerRecords }, null, 2), "utf-8");
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"), conversionLedgerStorePath: ledgerPath,
    edgeRuntimeDataRoot: root, artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false, minioWatchBucket: "bim-control",
    externalIntakeWebhookSecret: WEBHOOK_SECRET, internalApiAuthToken: INTERNAL_TOKEN,
  }, { structLog: audit.logger });
  return { app: active, audit };
}

function ledgerRecord(key: string, overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: key, correlation_id: `corr_${key}`, project_id: "proj_a", project_display_name: "專案A", category: "建築",
    external_model_version_id: "v1", object_key: null, bucket: null, conversion_job_id: null, status: "failed", coverage_report: null,
    usdc_key: null, detected_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", ...overrides,
  };
}
function tombstone(key: string) {
  return ledgerRecord(key, { status: "removed", removed_at: "2026-09-02T00:00:00.000Z", removed_by: "op" });
}

function createTerminalIntakeJob(app: CoordinatorApp, idempotencyKey: string) {
  const event: ExternalIfcReadyEvent = {
    event: "ifc_ready", tenant_id: "tenant_t", project_id: "project_t", external_model_version_id: "version_t",
    external_conversion_task_id: null, source_ifc: { ref: "http://127.0.0.1:1/t.ifc", etag: "etag_t", filename: "t.ifc" }, callback_url: null,
  };
  const job = app.externalIfcReadyStore.create(event, { correlationId: `corr_${idempotencyKey}`, idempotencyKey,
    tenantId: "tenant_t", projectId: "project_t", externalModelVersionId: "version_t" });
  app.externalIfcReadyStore.markDownloadFailed(job.ifc_ready_job_id, "source gone");
  return job;
}

/** The one audit record for `action`, checked against the structured-log contract; returns its data. */
function auditData(audit: AuditLogHarness, action: string, traceId: string): Record<string, unknown> {
  const records = readAuditRecords(audit.logger, action);
  expect(records).toHaveLength(1);
  const [record] = records;
  expect(validateLogRecordBasic(record)).toMatchObject({ valid: true });
  expect(record.trace_id).toBe(traceId);
  expect(String(record.trace_id).length).toBeLessThanOrEqual(200);
  return record.data as Record<string, unknown>;
}

describe("session.purge audit (§4.3)", () => {
  it("records actor, reason, previous status, what was removed and outcome ok under the session's canonical trace id", async () => {
    const { app, audit } = makeApp();
    const created = await request(app.app).post("/api/review-sessions").send({ project_id: "project_audit", model_version_id: "model_audit" });
    const sessionId = created.body.session_id as string;
    await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({ reason: "test fixture" });

    const purged = await request(app.app).delete(`/api/review-sessions/${sessionId}?reason=stale_cleanup`).set("X-Operator", "ops-alice");
    expect(purged.status).toBe(200);
    expect(auditData(audit, "session.purge", `rev_${sessionId}`)).toEqual({
      action: "session.purge", actor: "ops-alice", target: sessionId, reason: "stale_cleanup", previous_status: "closed",
      session_file_removed: true, events_file_removed: true, outcome: "ok",
    });
  });

  it("uses the ifcready_ root trace of a session opened for an IFC-ready job", async () => {
    const { app, audit } = makeApp();
    const session = app.store.create({
      trace_id: "ifcready_1790000000000_abcdef12", project_id: "project_audit", model_version_id: "model_audit", created_by: "unit",
      kit_instance: { instance_id: "kit_local_001", provider: "local_fixed", status: "ready", stream_server: "127.0.0.1",
        signaling_port: 49100, media_server: "127.0.0.1" },
    });
    app.store.setStatus(session.session_id, "failed");
    expect((await request(app.app).delete(`/api/review-sessions/${session.session_id}`)).status).toBe(200);
    expect(auditData(audit, "session.purge", "ifcready_1790000000000_abcdef12"))
      .toMatchObject({ target: session.session_id, reason: "manual", previous_status: "failed", outcome: "ok" });
  });
});

describe("conversion.record.remove audit (§4.4)", () => {
  it("uses the newest same-key intake job's ifcready_ trace id when jobs exist", async () => {
    const { app, audit } = makeApp([ledgerRecord("idem_audit_jobs")]);
    createTerminalIntakeJob(app, "idem_audit_jobs");
    const newest = createTerminalIntakeJob(app, "idem_audit_jobs");
    const removed = await request(app.app).delete("/api/conversion/records/idem_audit_jobs").set("X-Operator", "ops-bob");
    expect(removed.status).toBe(200);
    expect(auditData(audit, "conversion.record.remove", newest.ifc_ready_job_id)).toEqual({
      action: "conversion.record.remove", actor: "ops-bob", target: "idem_audit_jobs", previous_status: "failed", intake_jobs_removed: 2,
    });
  });

  it("falls back to a sanitised, bounded external_ trace id without jobs, keeps the full key as target, and audits a replay sweep with replay: true", async () => {
    const longKey = `idem:${"k".repeat(192)}.v2`;
    expect(longKey).toHaveLength(200);
    const expectedTrace = `external_idem_${"k".repeat(186)}`;
    expect(expectedTrace).toHaveLength(200);
    const { app, audit } = makeApp([ledgerRecord(longKey)]);
    expect((await request(app.app).delete(`/api/conversion/records/${longKey}`)).status).toBe(200);
    expect(auditData(audit, "conversion.record.remove", expectedTrace)).toEqual({
      action: "conversion.record.remove", actor: "local-operator", target: longKey, previous_status: "failed", intake_jobs_removed: 0,
    });

    // A replay with nothing to sweep writes no audit record.
    expect((await request(app.app).delete(`/api/conversion/records/${longKey}`)).status).toBe(200);
    expect(readAuditRecords(audit.logger, "conversion.record.remove")).toHaveLength(1);

    // A replay that sweeps a late same-key job is audited, under that job's trace id.
    const late = createTerminalIntakeJob(app, longKey);
    expect((await request(app.app).delete(`/api/conversion/records/${longKey}`)).body.intake_jobs_removed).toBe(1);
    const records = readAuditRecords(audit.logger, "conversion.record.remove");
    expect(records).toHaveLength(2);
    expect(validateLogRecordBasic(records[1])).toMatchObject({ valid: true });
    expect(records[1].trace_id).toBe(late.ifc_ready_job_id);
    expect(records[1].data).toEqual({
      action: "conversion.record.remove", actor: "local-operator", target: longKey, previous_status: "removed",
      intake_jobs_removed: 1, replay: true,
    });
  });
});

describe("conversion.ledger.upsert_ignored audit (§4.4)", () => {
  it("is written when a late conversion result reaches a tombstone, always under external_<key>, and the tombstone stays", async () => {
    const { app, audit } = makeApp([tombstone("idem_audit_late")]);
    // A job that was still around when its record was tombstoned (the ingest path looks jobs up by correlation id).
    const event: ExternalIfcReadyEvent = {
      event: "ifc_ready", tenant_id: "tenant_t", project_id: "project_t", external_model_version_id: "version_t",
      external_conversion_task_id: null, source_ifc: { ref: "http://127.0.0.1:1/t.ifc", etag: "etag_t", filename: "t.ifc" }, callback_url: null,
    };
    app.externalIfcReadyStore.create(event, { correlationId: "corr_audit_late", idempotencyKey: "idem_audit_late",
      tenantId: "tenant_t", projectId: "project_t", externalModelVersionId: "version_t" });

    const ingested = await request(app.app).post("/api/internal/conversion-result").set("X-Internal-Token", INTERNAL_TOKEN)
      .send({ correlation_id: "corr_audit_late", conversion_job_id: "stream_conv_audit_late", status: "failed", reason: "late result" });
    expect(ingested.status).toBe(202);
    expect(auditData(audit, "conversion.ledger.upsert_ignored", "external_idem_audit_late")).toEqual({
      action: "conversion.ledger.upsert_ignored", actor: "system", target: "idem_audit_late", attempted_status: "failed",
      removed_at: "2026-09-02T00:00:00.000Z",
    });
    const records = await request(app.app).get("/api/conversion/records?include_removed=1");
    expect(records.body.items[0]).toMatchObject({ idempotency_key: "idem_audit_late", status: "removed" });
  });
});

describe("conversion.intake.rejected_removed audit (§4.4)", () => {
  it("records the intake source as actor and the key as target under external_<key>", async () => {
    const { app, audit } = makeApp([tombstone("idem_audit_intake"), tombstone("mw_0123456789abcdef")]);
    const external = await request(app.app).post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": WEBHOOK_SECRET, "X-Correlation-Id": "corr_audit_intake", "X-Idempotency-Key": "idem_audit_intake" })
      .send(structuredClone(INTAKE_EXAMPLE));
    expect(external.status).toBe(409);
    expect(auditData(audit, "conversion.intake.rejected_removed", "external_idem_audit_intake")).toEqual({
      action: "conversion.intake.rejected_removed", actor: "external", target: "idem_audit_intake",
    });

    // The MinIO watcher's self-POST (registered in the watcher intake registry) is recorded as minio_watch.
    app.watcherIntakeRegistry.expect("mw_0123456789abcdef", "corr_audit_watch");
    const watcher = await request(app.app).post("/api/external/ifc-ready")
      .set({ "X-Webhook-Secret": WEBHOOK_SECRET, "X-Correlation-Id": "corr_audit_watch", "X-Idempotency-Key": "mw_0123456789abcdef" })
      .send(structuredClone(INTAKE_EXAMPLE));
    expect(watcher.status).toBe(409);
    const records = readAuditRecords(audit.logger, "conversion.intake.rejected_removed");
    expect(records).toHaveLength(2);
    expect(validateLogRecordBasic(records[1])).toMatchObject({ valid: true });
    expect(records[1].trace_id).toBe("external_mw_0123456789abcdef");
    expect(records[1].data).toEqual({ action: "conversion.intake.rejected_removed", actor: "minio_watch", target: "mw_0123456789abcdef" });
    expect(app.externalIfcReadyStore.list()).toEqual([]);
  });
});
