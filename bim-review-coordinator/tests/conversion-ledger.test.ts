// bim-review-coordinator/tests/conversion-ledger.test.ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversionLedger } from "../src/services/conversionLedger.js";

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
  it("壞檔不 crash：JSON 損毀時當空 ledger 起手", () => {
    const p = storePath();
    fs.writeFileSync(p, "{ not json", "utf-8");
    const led = new ConversionLedger(p);
    expect(led.list()).toEqual([]);
    expect(() => led.upsert(base, "2026-06-23T01:00:00.000Z")).not.toThrow();
  });
});
