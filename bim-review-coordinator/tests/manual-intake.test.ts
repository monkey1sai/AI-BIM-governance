// bim-review-coordinator/tests/manual-intake.test.ts
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { triggerManualIntake } from "../src/services/manualIntake.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { idempotencyKeyFor } from "../src/services/minioWatcher.js";

let stub: http.Server | null = null; let stubUrl = ""; let root: string | null = null;
function startS3Stub(keys: string[]): Promise<void> {
  stub = http.createServer((_req, res) => {
    const contents = keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e1"</ETag></Contents>`).join("");
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
  });
  return new Promise((r) => stub!.listen(0, "127.0.0.1", () => {
    stubUrl = `http://127.0.0.1:${(stub!.address() as { port: number }).port}`; r();
  }));
}
afterEach(async () => {
  if (stub) await new Promise<void>((r) => stub!.close(() => { stub = null; r(); }));
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
const cfg = () => ({ endpoint: stubUrl, bucket: "bim-control", accessKey: "ak", secretKey: "sk", keySuffix: "/model.ifc" });
function makeLedger() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-intake-"));
  // ConversionLedger 是 constructor-based（spec §6.1 已驗證；無 createConversionLedger 工廠）。
  return new ConversionLedger(path.join(root, "ledger.json"));
}

describe("triggerManualIntake", () => {
  it("合法 key → ok:true + ledger 落帳（idempotency_key 由非空 etag 衍生）", async () => {
    await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
    const ledger = makeLedger();
    const r = await triggerManualIntake("東勢區許良宇紀念圖書館/root/main/000001/model.ifc", '"e1"', cfg(), ledger, "2026-06-24T00:00:00Z");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.idempotency_key).toBe(idempotencyKeyFor("bim-control", "東勢區許良宇紀念圖書館/root/main/000001/model.ifc", '"e1"'));
      expect(ledger.get(r.idempotency_key)).not.toBeNull();
    }
  });
  it("key 含 .. → ok:false（deriveIntakeFromKey 拒）", async () => {
    await startS3Stub(["a/b/c/model.ifc"]);
    const r = await triggerManualIntake("../../etc/model.ifc", '"e1"', cfg(), makeLedger(), "2026-06-24T00:00:00Z");
    expect(r.ok).toBe(false);
  });
});
