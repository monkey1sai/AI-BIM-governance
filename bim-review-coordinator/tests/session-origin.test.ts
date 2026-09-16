// session 來源（origin）推導純函式：只用 server-owned 事實，不讀 session_id 前綴；查無資料一律 null。
import { describe, expect, it } from "vitest";
import { deriveSessionOrigin, objectKeyFromSourceIfcRef } from "../src/services/sessionOrigin.js";
import type { ConversionLedgerRecord } from "../src/services/conversionLedger.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../src/types.js";

const ISO = "2026-09-16T05:08:55.017Z";
function session(over: Partial<ReviewSession> = {}): ReviewSession {
  return {
    session_id: "review_session_abc", tenant_id: "t", project_id: "mv_6c51d572", model_version_id: "24e598ab-1",
    status: "active", mode: "single_kit_shared_state", created_by: "dev_user_001", created_at: ISO, updated_at: ISO,
    kit_instance: { instance_id: "kit_local_001", provider: "local_fixed", status: "ready", stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1", media_port: 1024 },
    artifact_bindings: [], kit_instance_bindings: [], participants: [],
    ...over,
  };
}
function record(over: Partial<ConversionLedgerRecord> = {}): ConversionLedgerRecord {
  return {
    idempotency_key: "mw_010792d2cce6bf9b", correlation_id: "minio-watch-010792d2", project_id: "mv_6c51d572",
    project_display_name: "東勢區許良宇紀念圖書館", category: "建築", external_model_version_id: "24e598ab-1",
    object_key: null, bucket: "bim-control", conversion_job_id: "stream_conv_1", status: "ready",
    coverage_report: null, usdc_key: null, detected_at: "2026-09-08T08:42:32.485Z", updated_at: ISO,
    ...over,
  };
}
function job(over: Partial<IfcReadyIntakeJob> = {}): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: "ifcready_1", status: "dispatched", idempotent_replay: false, correlation_id: "minio-watch-010792d2",
    idempotency_key: "mw_010792d2cce6bf9b", intake_source: "minio_watch", tenant_id: "t", project_id: "mv_6c51d572",
    external_model_version_id: "24e598ab-1",
    source_ifc_ref: "http://192.168.20.234:9000/bim-control/%E6%9D%B1%E5%8B%A2/root/%E5%BB%BA%E7%AF%89/24e598ab-1/model.ifc",
    source_ifc_etag: "etag", conversion_job_id: "stream_conv_1", conversion_status: "ready", conversion_authority: "bim-streaming-server",
    ...over,
  } as IfcReadyIntakeJob;
}

describe("objectKeyFromSourceIfcRef", () => {
  it("解出 bucket 之後的 URL-decoded key", () => {
    expect(objectKeyFromSourceIfcRef("http://h:9000/bim-control/a%20b/c/model.ifc")).toBe("a b/c/model.ifc");
  });
  it("非 http(s)、無 key 段或非法 URL → null", () => {
    expect(objectKeyFromSourceIfcRef("ftp://h/bucket/k")).toBeNull();
    expect(objectKeyFromSourceIfcRef("http://h/bucket-only")).toBeNull();
    expect(objectKeyFromSourceIfcRef("not a url")).toBeNull();
    expect(objectKeyFromSourceIfcRef(null)).toBeNull();
  });
});

describe("deriveSessionOrigin", () => {
  it("recreated_from_session_id 優先於 created_by → recreated", () => {
    const o = deriveSessionOrigin(session({ created_by: "coordinator-auto-conversion-ready", recreated_from_session_id: "review_session_old" }), null, null);
    expect(o.kind).toBe("recreated");
    expect(o.recreated_from_session_id).toBe("review_session_old");
  });
  it("coordinator-auto-conversion-ready → auto_conversion_ready，intake_source 取自 job", () => {
    const o = deriveSessionOrigin(session({ created_by: "coordinator-auto-conversion-ready" }), null, job());
    expect(o.kind).toBe("auto_conversion_ready");
    expect(o.intake_source).toBe("minio_watch");
  });
  it("coordinator-ready-review-request → console_request", () => {
    expect(deriveSessionOrigin(session({ created_by: "coordinator-ready-review-request" }), null, null).kind).toBe("console_request");
  });
  it("其他 created_by → api_explicit 並保留 created_by 原字串", () => {
    const o = deriveSessionOrigin(session({ created_by: "dev_user_001" }), null, null);
    expect(o.kind).toBe("api_explicit");
    expect(o.created_by).toBe("dev_user_001");
  });
  it("ledger 命中：display_name／category／bucket／detected_at；object_key null 時由 job source_ifc_ref 解出 key 與 filename", () => {
    const o = deriveSessionOrigin(session(), record(), job());
    expect(o.project_display_name).toBe("東勢區許良宇紀念圖書館");
    expect(o.category).toBe("建築");
    expect(o.bucket).toBe("bim-control");
    expect(o.ledger_detected_at).toBe("2026-09-08T08:42:32.485Z");
    expect(o.source_object_key).toBe("東勢/root/建築/24e598ab-1/model.ifc");
    expect(o.source_ifc_filename).toBe("model.ifc");
  });
  it("ledger object_key 有值時優先於 job", () => {
    const o = deriveSessionOrigin(session(), record({ object_key: "ifc-test/architecture/v1/model.ifc" }), job({ source_ifc_ref: "http://h/b/other/x.ifc" }));
    expect(o.source_object_key).toBe("ifc-test/architecture/v1/model.ifc");
  });
  it("ledger 與 job 皆無：全部 null；filename 退回 artifact_bindings.source_ifc_filename", () => {
    const o = deriveSessionOrigin(session({ artifact_bindings: [{ binding_id: "b1", artifact_group_id: "g", model_version_id: "v", artifact_id: "a", source_ifc_filename: "legacy.ifc", artifact_role: "derived", url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready" }] }), null, null);
    expect(o.project_display_name).toBeNull();
    expect(o.category).toBeNull();
    expect(o.bucket).toBeNull();
    expect(o.source_object_key).toBeNull();
    expect(o.source_ifc_filename).toBe("legacy.ifc");
    expect(o.intake_source).toBeNull();
    expect(o.ledger_detected_at).toBeNull();
    expect(o.recreated_from_session_id).toBeNull();
  });
  it("category 空字串 → null；job 缺 intake_source → null；source_ifc_ref 非法 → key null", () => {
    const o = deriveSessionOrigin(session(), record({ category: "" }), job({ intake_source: undefined, source_ifc_ref: "nope" }));
    expect(o.category).toBeNull();
    expect(o.intake_source).toBeNull();
    expect(o.source_object_key).toBeNull();
    expect(o.source_ifc_filename).toBeNull();
  });
});
