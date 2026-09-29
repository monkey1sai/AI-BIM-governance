// model-file-session-lifecycle-contract §4.4：轉檔紀錄以墓碑移除，列仍留作 watcher 水印。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversionLedger, type ConversionLedgerUpsert } from "../src/services/conversionLedger.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function tempLedgerPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-ledger-remove-"));
  roots.push(root);
  return path.join(root, "conversion-ledger.json");
}

const baseInput: ConversionLedgerUpsert = {
  idempotency_key: "mw_0123456789abcdef", correlation_id: "minio-watch-01234567",
  project_id: "proj_a", project_display_name: "專案A", category: "建築",
  external_model_version_id: "v1", conversion_job_id: "stream_conv_1", status: "ready",
  object_key: "proj_a/建築/v1/model.ifc", bucket: "bim-control",
};

describe("ConversionLedger.remove (tombstone)", () => {
  it("marks the row removed, keeps it in get()/list(), and persists", () => {
    const file = tempLedgerPath();
    const ledger = new ConversionLedger(file);
    ledger.upsert(baseInput, "2026-09-01T00:00:00.000Z");
    const removed = ledger.remove(baseInput.idempotency_key, "2026-09-29T00:00:00.000Z", "op");
    expect(removed).toMatchObject({ status: "removed", removed_at: "2026-09-29T00:00:00.000Z", removed_by: "op", object_key: baseInput.object_key });
    expect(ledger.get(baseInput.idempotency_key)?.status).toBe("removed");
    expect(ledger.list().map((row) => row.status)).toEqual(["removed"]);
    const reloaded = new ConversionLedger(file);
    expect(reloaded.get(baseInput.idempotency_key)).toMatchObject({ status: "removed", removed_by: "op" });
  });

  it("is idempotent and returns null for unknown keys", () => {
    const ledger = new ConversionLedger(null);
    expect(ledger.remove("mw_ffffffffffffffff", "2026-09-29T00:00:00.000Z", "op")).toBeNull();
    ledger.upsert(baseInput, "2026-09-01T00:00:00.000Z");
    const first = ledger.remove(baseInput.idempotency_key, "2026-09-29T00:00:00.000Z", "op");
    const second = ledger.remove(baseInput.idempotency_key, "2026-09-30T00:00:00.000Z", "other");
    expect(second).toEqual(first);
  });

  it("ignores upsert() on a tombstone and reports it through the hook", () => {
    const onUpsertIgnored = vi.fn();
    const ledger = new ConversionLedger(null, { onUpsertIgnored });
    ledger.upsert(baseInput, "2026-09-01T00:00:00.000Z");
    ledger.remove(baseInput.idempotency_key, "2026-09-29T00:00:00.000Z", "op");
    const result = ledger.upsert({ ...baseInput, status: "queued" }, "2026-09-29T01:00:00.000Z");
    expect(result.status).toBe("removed");
    expect(ledger.get(baseInput.idempotency_key)?.status).toBe("removed");
    expect(onUpsertIgnored).toHaveBeenCalledTimes(1);
    expect(onUpsertIgnored.mock.calls[0][0]).toMatchObject({ status: "removed" });
    expect(onUpsertIgnored.mock.calls[0][1]).toMatchObject({ status: "queued" });
  });
});
