// GET /api/runtime/status sessions.items[].origin（session-identity-display spec §1）：
// buildRuntimeStatus 以 ready_model_id 對 ledger 與 ifc-ready job 注入 origin；HTTP 路徑通過 enforce-mode contract。
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { buildRuntimeStatus } from "../src/runtimeStatus.js";
import type { ConversionLedgerRecord } from "../src/services/conversionLedger.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../src/types.js";

const ISO = "2026-09-16T05:08:55.017Z";
function session(over: Partial<ReviewSession> = {}): ReviewSession {
  return {
    session_id: "review_session_abc", tenant_id: "t", project_id: "mv_6c51d572", model_version_id: "24e598ab-1",
    status: "active", mode: "single_kit_shared_state", created_by: "coordinator-auto-conversion-ready", created_at: ISO, updated_at: ISO,
    kit_instance: { instance_id: "kit_local_001", provider: "local_fixed", status: "ready", stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1", media_port: 1024 },
    artifact_bindings: [], kit_instance_bindings: [], participants: [],
    ...over,
  };
}
const RECORD: ConversionLedgerRecord = {
  idempotency_key: "mw_010792d2cce6bf9b", correlation_id: "minio-watch-010792d2", project_id: "mv_6c51d572",
  project_display_name: "東勢區許良宇紀念圖書館", category: "建築", external_model_version_id: "24e598ab-1",
  object_key: null, bucket: "bim-control", conversion_job_id: "stream_conv_1", status: "ready",
  coverage_report: null, usdc_key: null, detected_at: "2026-09-08T08:42:32.485Z", updated_at: ISO,
};
const JOB = {
  ifc_ready_job_id: "ifcready_1", status: "dispatched", idempotent_replay: false, correlation_id: "minio-watch-010792d2",
  idempotency_key: "mw_010792d2cce6bf9b", intake_source: "minio_watch", tenant_id: "t", project_id: "mv_6c51d572",
  external_model_version_id: "24e598ab-1", source_ifc_ref: "http://192.168.20.234:9000/bim-control/lib/root/arch/24e598ab-1/model.ifc",
  source_ifc_etag: "etag", conversion_job_id: "stream_conv_1", conversion_status: "ready", conversion_authority: "bim-streaming-server",
  review_session_id: "review_session_abc",
} as IfcReadyIntakeJob;

type Items = Array<{ session_id: string; origin: { kind: string; intake_source: string | null; project_display_name: string | null; source_object_key: string | null } }>;
function items(result: Record<string, unknown>): Items {
  return (result.sessions as { items: Items }).items;
}

describe("buildRuntimeStatus sessions.items[].origin", () => {
  it("以 ready_model_id 對 ledger 與 ifc-ready job 注入 origin", () => {
    const result = buildRuntimeStatus({
      config: loadConfig(), startedAt: Date.now(),
      sessions: [session({ ready_model_id: "mw_010792d2cce6bf9b" })],
      ifcReadyJobs: [JOB],
      conversionRecordByReadyModelId: (id) => (id === "mw_010792d2cce6bf9b" ? RECORD : null),
    });
    const [item] = items(result);
    expect(item.origin.kind).toBe("auto_conversion_ready");
    expect(item.origin.intake_source).toBe("minio_watch");
    expect(item.origin.project_display_name).toBe("東勢區許良宇紀念圖書館");
    expect(item.origin.source_object_key).toBe("lib/root/arch/24e598ab-1/model.ifc");
  });
  it("無 ready_model_id 時以 job.review_session_id 對應；無 ledger 查詢函式仍必有 origin（ledger 欄位 null）", () => {
    const result = buildRuntimeStatus({
      config: loadConfig(), startedAt: Date.now(),
      sessions: [session({ created_by: "dev_user_001" })],
      ifcReadyJobs: [JOB],
    });
    const [item] = items(result);
    expect(item.origin.kind).toBe("api_explicit");
    expect(item.origin.intake_source).toBe("minio_watch");
    expect(item.origin.project_display_name).toBeNull();
  });
  it("ledger 查詢 throw（ledger 不可用）→ 不炸整個 runtime/status，origin 的 ledger 欄位為 null、其餘照常", () => {
    const result = buildRuntimeStatus({
      config: loadConfig(), startedAt: Date.now(),
      sessions: [session({ ready_model_id: "mw_010792d2cce6bf9b" })],
      ifcReadyJobs: [JOB],
      conversionRecordByReadyModelId: () => { throw new Error("Conversion ledger unavailable"); },
    });
    const [item] = items(result);
    expect(item.origin.kind).toBe("auto_conversion_ready");
    expect(item.origin.intake_source).toBe("minio_watch");
    expect(item.origin.project_display_name).toBeNull();
  });
  it("count／active_count 不受影響", () => {
    const result = buildRuntimeStatus({ config: loadConfig(), startedAt: Date.now(), sessions: [session(), session({ session_id: "s2", status: "closed" })], ifcReadyJobs: [] });
    expect((result.sessions as { count: number; active_count: number }).count).toBe(2);
    expect((result.sessions as { count: number; active_count: number }).active_count).toBe(1);
  });
});

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (active) { active.io.close(); await new Promise<void>((resolve) => active?.server.close(() => resolve())); active = null; }
});

describe("GET /api/runtime/status origin（HTTP）", () => {
  it("POST /api/review-sessions 建立的 session 回 origin.kind=api_explicit、created_by 原字串、ledger 欄位 null", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-origin-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"), corsOrigins: ["http://127.0.0.1:5173"],
    });
    const created = await request(active.app).post("/api/review-sessions").send({
      project_id: "project_demo_001", model_version_id: "version_demo_001", created_by: "dev_user_001",
      artifact_bindings: [{
        artifact_group_id: "ag_version_demo_001", artifact_id: "auto_usdc_stream_conv_status_001", artifact_role: "derived",
        url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
        mapping_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/element_mapping.json",
        load_order: 0, ready_status: "ready", conversion_authority: "bim-streaming-server",
        conversion_job_id: "stream_conv_status_001", conversion_status: "ready",
      }],
    });
    expect(created.status).toBe(200);
    const status = await request(active.app).get("/api/runtime/status");
    expect(status.status).toBe(200);
    const item = (status.body.sessions.items as Array<{ session_id: string; origin: Record<string, unknown> }>)
      .find((entry) => entry.session_id === created.body.session_id);
    expect(item?.origin).toEqual({
      kind: "api_explicit", created_by: "dev_user_001", intake_source: null, project_display_name: null, category: null,
      bucket: null, source_object_key: null, source_ifc_filename: null, recreated_from_session_id: null, ledger_detected_at: null,
    });
  });
});
