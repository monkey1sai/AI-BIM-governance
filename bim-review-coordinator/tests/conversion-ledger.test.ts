// bim-review-coordinator/tests/conversion-ledger.test.ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversionLedger, publicConversionRecord } from "../src/services/conversionLedger.js";
import type { ReadyRenderBundle } from "../src/services/readyModelResolver.js";

let tmp: string | null = null;
function storePath(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-ledger-"));
  return path.join(tmp, "conversion-ledger.json");
}
afterEach(() => { if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; } });

const base = {
  idempotency_key: "mw_abc123def4567890", correlation_id: "minio-watch-abc123de",
  project_id: "mv_1a2b3c4d", project_display_name: "松風庵", category: "機電",
  external_model_version_id: "000001", conversion_job_id: null, status: "queued" as const,
};

describe("ConversionLedger", () => {
  it("upsert 去重：同 idempotency_key 第二次只更新 status，保留 detected_at", () => {
    const led = new ConversionLedger(storePath());
    const a = led.upsert(base, "2026-06-23T01:00:00.000Z");
    const b = led.upsert({ ...base, status: "converting", conversion_job_id: "ifcready_1_aa" }, "2026-06-23T01:05:00.000Z");
    expect(led.list()).toHaveLength(1);
    expect(b.detected_at).toBe(a.detected_at);             // 保留首次
    expect(b.updated_at).toBe("2026-06-23T01:05:00.000Z"); // 更新
    expect(b.status).toBe("converting");
    expect(b.conversion_job_id).toBe("ifcready_1_aa");
  });
  it("持久化：重啟 reload 還在", () => {
    const p = storePath();
    new ConversionLedger(p).upsert(base, "2026-06-23T01:00:00.000Z");
    const reloaded = new ConversionLedger(p);
    expect(reloaded.get("mw_abc123def4567890")?.category).toBe("機電");
  });
  it("壞檔禁止存取與覆寫，保留原檔供復原", () => {
    const p = storePath();
    fs.writeFileSync(p, "{ not json", "utf-8");
    const led = new ConversionLedger(p);
    expect(() => led.list()).toThrow("unavailable");
    expect(() => led.get(base.idempotency_key)).toThrow("unavailable");
    expect(() => led.upsert(base, "2026-06-23T01:00:00.000Z")).toThrow("unavailable");
    expect(fs.readFileSync(p, "utf-8")).toBe("{ not json");
  });
  it("upsert 傳 conversion_job_id: null 不清除既有 job_id（?? 語意）", () => {
    const led = new ConversionLedger(storePath());
    // 第一次 upsert：設定 conversion_job_id
    led.upsert({ ...base, conversion_job_id: "ifcready_1_aa" }, "2026-06-23T02:00:00.000Z");
    // 第二次 upsert：顯式傳 null — 應保留既有，不清除
    const result = led.upsert({ ...base, conversion_job_id: null, status: "converting" }, "2026-06-23T02:05:00.000Z");
    expect(result.conversion_job_id).toBe("ifcready_1_aa");
  });
  it.each(["conversion-ledger/v99", "invalid"])("未知版本 %s 不覆寫", schema => {
    const p = storePath();
    const original = JSON.stringify({ schema_version: schema, records: [] });
    fs.writeFileSync(p, original);
    expect(() => new ConversionLedger(p).upsert(base, "2026-01-01")).toThrow("unavailable");
    expect(fs.readFileSync(p, "utf-8")).toBe(original);
  });
  it("v1 可遷移但不能授予私有 descriptor；公開投影採欄位白名單", () => {
    const p = storePath();
    const record = new ConversionLedger().upsert(base, "2026-01-01");
    fs.writeFileSync(p, JSON.stringify({ schema_version: "conversion-ledger/v1", records: [{ ...record, ready_render_bundle: { untrusted: true }, private_future_field: "private" }] }));
    const ledger = new ConversionLedger(p);
    expect(ledger.get(base.idempotency_key)?.ready_render_bundle).toBeUndefined();
    expect(publicConversionRecord(ledger.get(base.idempotency_key)!)).not.toHaveProperty("private_future_field");
    ledger.upsert(base, "2026-01-02");
    expect(JSON.parse(fs.readFileSync(p, "utf-8")).schema_version).toBe("conversion-ledger/v2");
  });
  it("descriptor 可重啟讀回且回傳物件不會修改持久紀錄", () => {
    const p = storePath();
    const ledger = new ConversionLedger(p);
    const input = { ...base, status: "ready" as const, conversion_job_id: "stream_conv_test" };
    ledger.upsert(input, "2026-01-01");
    const bundle: ReadyRenderBundle = {
      readyModelId: base.idempotency_key, conversionJobId: input.conversion_job_id,
      correlationId: base.correlation_id,
      tenantId: "tenant-test", projectId: base.project_id, modelVersionId: base.external_model_version_id,
      rootTraceId: "ifcready_test", model: { url: "http://127.0.0.1/artifacts/stream_conv_test/model.usdc", sha256: "a".repeat(64) },
      mapping: { url: "http://127.0.0.1/artifacts/stream_conv_test/element_mapping.json", sha256: "b".repeat(64) },
    };
    ledger.rememberRenderBundle(bundle);
    bundle.model.sha256 = "mutated";
    const reloaded = new ConversionLedger(p);
    const snapshot = reloaded.get(base.idempotency_key)!;
    expect(snapshot.ready_render_bundle?.model.sha256).toBe("a".repeat(64));
    expect(publicConversionRecord(snapshot)).not.toHaveProperty("ready_render_bundle");
    snapshot.ready_render_bundle!.model.sha256 = "mutated";
    expect(reloaded.get(base.idempotency_key)?.ready_render_bundle?.model.sha256).toBe("a".repeat(64));
    reloaded.upsert({ ...input, correlation_id: "different" }, "2026-01-02");
    expect(reloaded.get(base.idempotency_key)?.ready_render_bundle).toBeUndefined();
  });
  it("重複持久鍵禁止部分載入", () => {
    const p = storePath();
    const record = new ConversionLedger().upsert(base, "2026-01-01");
    fs.writeFileSync(p, JSON.stringify({ schema_version: "conversion-ledger/v2", records: [record, record] }));
    expect(() => new ConversionLedger(p).list()).toThrow("unavailable");
  });
});
