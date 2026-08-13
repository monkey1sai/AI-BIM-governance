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

  it("只允許 restart-interrupted download 沿用同一 job 重新開始；一般失敗保持封閉", () => {
    const retryPath = path.join(tmpRoot, "restart-download-retry.json");
    const first = new ExternalIfcReadyStore(retryPath);
    const restartBinding = {
      ...binding,
      idempotencyKey: "idem_restart_download",
      correlationId: "corr_restart_download",
    };
    const interrupted = first.create(event, restartBinding);
    first.markDownloading(interrupted.ifc_ready_job_id);

    const afterRestart = new ExternalIfcReadyStore(retryPath);
    const freshEvent = {
      ...event,
      source_ifc: {
        ...event.source_ifc,
        ref: "http://minio.local/bucket/model.ifc?X-Amz-Signature=fresh",
      },
    };
    const mismatchedAttempts = [
      { event: freshEvent, binding: { ...restartBinding, idempotencyKey: "other_idem" } },
      { event: freshEvent, binding: { ...restartBinding, correlationId: "other_corr" } },
      {
        event: { ...freshEvent, tenant_id: "tenant_b" },
        binding: { ...restartBinding, tenantId: "tenant_b" },
      },
      {
        event: { ...freshEvent, project_id: "project_b" },
        binding: { ...restartBinding, projectId: "project_b" },
      },
      {
        event: { ...freshEvent, external_model_version_id: "version_b" },
        binding: { ...restartBinding, externalModelVersionId: "version_b" },
      },
      {
        event: { ...freshEvent, source_ifc: { ...freshEvent.source_ifc, etag: "etag_b" } },
        binding: restartBinding,
      },
      {
        event: {
          ...freshEvent,
          source_ifc: {
            ...freshEvent.source_ifc,
            ref: "http://minio.local/other/model.ifc?X-Amz-Signature=fresh",
          },
        },
        binding: restartBinding,
      },
      {
        event: { ...freshEvent, requested_outputs: ["usdc"] },
        binding: restartBinding,
      },
      {
        event: { ...freshEvent, external_conversion_task_id: "task_b" },
        binding: restartBinding,
      },
      {
        event: {
          ...freshEvent,
          source_ifc: { ...freshEvent.source_ifc, filename: "other.ifc" },
        },
        binding: restartBinding,
      },
    ];
    for (const attempt of mismatchedAttempts) {
      expect(afterRestart.resumeRestartInterruptedDownload(
        interrupted.ifc_ready_job_id,
        attempt.event,
        attempt.binding,
      ).kind).toBe("binding_mismatch");
    }
    expect(afterRestart.get(interrupted.ifc_ready_job_id)?.download_status).toBe("failed");
    expect(afterRestart.get(interrupted.ifc_ready_job_id)?.source_ifc_ref).toBe(event.source_ifc.ref);

    const resumed = afterRestart.resumeRestartInterruptedDownload(
      interrupted.ifc_ready_job_id,
      freshEvent,
      restartBinding,
    );
    expect(resumed.kind).toBe("resumed");
    if (resumed.kind !== "resumed") throw new Error("expected restart download to resume");
    expect(resumed.job.ifc_ready_job_id).toBe(interrupted.ifc_ready_job_id);
    expect(resumed.job.download_status).toBe("downloading");
    expect(resumed.job.download_failure).toBeNull();
    expect(resumed.job.source_ifc_ref).toBe(
      "http://minio.local/bucket/model.ifc?X-Amz-Signature=fresh",
    );

    const permanentPath = path.join(tmpRoot, "permanent-download-failure.json");
    const permanentStore = new ExternalIfcReadyStore(permanentPath);
    const permanent = permanentStore.create(event, {
      ...binding,
      idempotencyKey: "idem_permanent_download",
      correlationId: "corr_permanent_download",
    });
    permanentStore.markDownloadFailed(permanent.ifc_ready_job_id, "http_error: 404");
    const closed = new ExternalIfcReadyStore(permanentPath);
    expect(closed.resumeRestartInterruptedDownload(
      permanent.ifc_ready_job_id,
      event,
      {
        ...binding,
        idempotencyKey: "idem_permanent_download",
        correlationId: "corr_permanent_download",
      },
    ).kind).toBe("not_resumable");
    expect(closed.get(permanent.ifc_ready_job_id)?.download_status).toBe("failed");
  });

  it("壞 JSON 檔：不 crash、空啟動（誠實降級）", () => {
    const p = path.join(tmpRoot, "corrupt.json");
    fs.writeFileSync(p, "{not json", "utf-8");
    const s = new ExternalIfcReadyStore(p);
    expect(s.list()).toEqual([]);
    expect(s.isPersistent()).toBe(false);
  });

  it.each([
    ["jobs 不是 array", { jobs: {} }],
    ["job 缺必要 identity", { jobs: [{ ifc_ready_job_id: "ifcready_incomplete" }] }],
  ])("合法 JSON 但結構錯誤（%s）不 crash 且誠實降級", (_label, payload) => {
    const p = path.join(tmpRoot, `malformed-${String(_label)}.json`);
    fs.writeFileSync(p, JSON.stringify(payload), "utf-8");
    const s = new ExternalIfcReadyStore(p);
    expect(s.list()).toEqual([]);
    expect(s.isPersistent()).toBe(false);
  });

  it("valid + malformed mixed records 不做 partial restore", () => {
    const p = path.join(tmpRoot, "mixed-malformed.json");
    const seeded = new ExternalIfcReadyStore(p);
    seeded.create(event, {
      ...binding,
      idempotencyKey: "idem_mixed_valid",
      correlationId: "corr_mixed_valid",
    });
    const payload = JSON.parse(fs.readFileSync(p, "utf-8")) as { jobs: unknown[] };
    payload.jobs.push({ ifc_ready_job_id: "ifcready_incomplete" });
    fs.writeFileSync(p, JSON.stringify(payload), "utf-8");

    const restored = new ExternalIfcReadyStore(p);
    expect(restored.list()).toEqual([]);
    expect(restored.isPersistent()).toBe(false);
  });

  it("未給路徑（且無 env）→ 維持現行 volatile 行為", () => {
    const s = new ExternalIfcReadyStore();
    const job = s.create(event, { ...binding, idempotencyKey: "idem_v", correlationId: "corr_v" });
    expect(s.get(job.ifc_ready_job_id)).toBeDefined();
    expect(s.isPersistent()).toBe(false);
  });

  it("明示持久路徑時 store 回報 persisted capability", () => {
    const s = new ExternalIfcReadyStore(path.join(tmpRoot, "durability.json"));
    s.create(event, { ...binding, idempotencyKey: "idem_p", correlationId: "corr_p" });
    expect(s.isPersistent()).toBe(true);
  });

  it("持久寫入失敗時誠實回報 volatile", () => {
    const blockingParent = path.join(tmpRoot, "not-a-directory");
    fs.writeFileSync(blockingParent, "fixture");
    const s = new ExternalIfcReadyStore(path.join(blockingParent, "durability.json"));
    s.create(event, { ...binding, idempotencyKey: "idem_failed", correlationId: "corr_failed" });
    expect(s.isPersistent()).toBe(false);
  });
});
