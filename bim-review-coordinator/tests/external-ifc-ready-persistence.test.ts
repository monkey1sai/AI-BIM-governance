// S2（2026-07-10）：externalIfcReadyStore 落 JSON 持久化（env opt-in）——修 coordinator 重啟後
// 「ConversionLedger 有紀錄、來源 ifc-ready job 消失」的 split-brain。比照 conversionLedger 的
// atomic tmp+rename 範式；持久化全在 store 內部，app.ts 呼叫點零變更。
// 重啟調和（誠實）：queued_for_conversion → dropped_on_restart（dispatch queue 本身 volatile）；
// downloading → download failed（下載已中斷）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import type { ExternalIfcReadyEvent } from "../src/types.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-eirs-test-"));
afterEach(() => { /* 檔案留在 tmpRoot，最後一次性清 */ });
process.on("exit", () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ } });

const event = {
  event: "ifc_ready",
  tenant_id: "tenant_demo_001",
  project_id: "270",
  external_model_version_id: "mv_ext_1",
  source_ifc: { ref: "http://minio.local/bucket/model.ifc?X-Amz-Signature=s", etag: "e1" },
} as unknown as ExternalIfcReadyEvent;

const binding = {
  correlationId: "corr:with:colons",
  idempotencyKey: "idem_key_1",
  tenantId: "tenant_demo_001",
  projectId: "270",
  externalModelVersionId: "mv_ext_1",
};

describe("ExternalIfcReadyStore 持久化（S2，env opt-in）", () => {
  it("roundtrip：重建 store 後 job/idempotency/correlation（含 sanitize 鍵）全部找得回", () => {
    const p = path.join(tmpRoot, "roundtrip.json");
    const s1 = new ExternalIfcReadyStore(p);
    const job = s1.create(event, binding);
    s1.markDownloaded(job.ifc_ready_job_id, "/data/x.ifc", "C:/host/x.ifc");
    s1.markDispatched(job.ifc_ready_job_id, "conv_1", "queued");

    const s2 = new ExternalIfcReadyStore(p);
    const loaded = s2.get(job.ifc_ready_job_id);
    expect(loaded?.status).toBe("dispatched");
    expect(loaded?.host_local_path).toBe("C:/host/x.ifc");
    expect(s2.findExisting("idem_key_1", "corr:with:colons")?.ifc_ready_job_id).toBe(job.ifc_ready_job_id);
    // sanitize 鍵索引重建（corr:with:colons 的 sanitize 值可回查同一 job）
    expect(s2.getByCorrelation("corrwithcolons", "conv_1")?.ifc_ready_job_id ?? s2.getByCorrelation("corr:with:colons")?.ifc_ready_job_id).toBe(job.ifc_ready_job_id);
  });

  it("重啟調和：queued_for_conversion → dropped_on_restart；downloading → download failed", () => {
    const p = path.join(tmpRoot, "reconcile.json");
    const s1 = new ExternalIfcReadyStore(p);
    const j1 = s1.create(event, { ...binding, idempotencyKey: "idem_q", correlationId: "corr_q" });
    s1.markQueuedForConversion(j1.ifc_ready_job_id, 1);
    const j2 = s1.create(event, { ...binding, idempotencyKey: "idem_d", correlationId: "corr_d" });
    s1.markDownloading(j2.ifc_ready_job_id);

    const s2 = new ExternalIfcReadyStore(p);
    expect(s2.get(j1.ifc_ready_job_id)?.status).toBe("dropped_on_restart");
    expect(s2.get(j2.ifc_ready_job_id)?.download_status).toBe("failed");
  });

  it("壞 JSON 檔：不 crash、空啟動（誠實降級）", () => {
    const p = path.join(tmpRoot, "corrupt.json");
    fs.writeFileSync(p, "{not json", "utf-8");
    const s = new ExternalIfcReadyStore(p);
    expect(s.list()).toEqual([]);
  });

  it("未給路徑（且無 env）→ 維持現行 volatile 行為", () => {
    const s = new ExternalIfcReadyStore();
    const job = s.create(event, { ...binding, idempotencyKey: "idem_v", correlationId: "corr_v" });
    expect(s.get(job.ifc_ready_job_id)).toBeDefined();
  });
});
