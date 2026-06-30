// bim-review-coordinator/tests/ledger-chip-status.test.ts
//
// 純函式單元測試：ledgerChipStatus(idempotencyKey, records)
// 根據 idempotency_key 查詢 ledger 紀錄 → chip 狀態。
// spec §2.5 第 6 點 / §3.3 第 1 點 / AC-chip：
//   ready / detected / queued / converting / failed → 對應 ledger.status
//   無紀錄 → 'untracked'（前端顯「未轉（含 baseline 既有檔）」，不臆測）
import { describe, it, expect } from "vitest";
import { ledgerChipStatus } from "../src/services/ledgerChipStatus.js";
import type { ConversionLedgerRecord } from "../src/services/conversionLedger.js";

// 最小 ledger record fixture（只需 idempotency_key + status 欄位）
function makeRecord(
  idempotency_key: string,
  status: ConversionLedgerRecord["status"],
): ConversionLedgerRecord {
  return {
    idempotency_key,
    correlation_id: null,
    project_id: "mv_test1234",
    project_display_name: "測試專案",
    category: "建築",
    external_model_version_id: "v1",
    object_key: null,
    bucket: null,
    conversion_job_id: null,
    status,
    coverage_report: null,
    usdc_key: null,
    detected_at: "2026-06-24T00:00:00.000Z",
    updated_at: "2026-06-24T00:00:00.000Z",
  };
}

describe("ledgerChipStatus", () => {
  it("無紀錄 → 回 'untracked'（誠實：不臆測轉檔狀態）", () => {
    const records: ConversionLedgerRecord[] = [];
    expect(ledgerChipStatus("mw_abc123def4567890", records)).toBe("untracked");
  });

  it("ledger 有 ready 紀錄 → 回 'ready'", () => {
    const records = [makeRecord("mw_abc123def4567890", "ready")];
    expect(ledgerChipStatus("mw_abc123def4567890", records)).toBe("ready");
  });

  it("ledger 有 queued 紀錄 → 回 'queued'", () => {
    const records = [makeRecord("mw_abc123def4567890", "queued")];
    expect(ledgerChipStatus("mw_abc123def4567890", records)).toBe("queued");
  });

  it("ledger 有 detected 紀錄 → 回 'detected'", () => {
    const records = [makeRecord("mw_key2", "detected")];
    expect(ledgerChipStatus("mw_key2", records)).toBe("detected");
  });

  it("ledger 有 converting 紀錄 → 回 'converting'", () => {
    const records = [makeRecord("mw_key3", "converting")];
    expect(ledgerChipStatus("mw_key3", records)).toBe("converting");
  });

  it("ledger 有 failed 紀錄 → 回 'failed'", () => {
    const records = [makeRecord("mw_key4", "failed")];
    expect(ledgerChipStatus("mw_key4", records)).toBe("failed");
  });

  it("records 有多筆但 key 不同 → 回 'untracked'（key 無對應）", () => {
    const records = [
      makeRecord("mw_other_key_1234", "ready"),
      makeRecord("mw_another_key_56", "queued"),
    ];
    expect(ledgerChipStatus("mw_nonexistent_key", records)).toBe("untracked");
  });

  it("records 有多筆、正確 key 在中間 → 回對應狀態", () => {
    const records = [
      makeRecord("mw_first________1", "queued"),
      makeRecord("mw_target_key123", "converting"),
      makeRecord("mw_last_________1", "ready"),
    ];
    expect(ledgerChipStatus("mw_target_key123", records)).toBe("converting");
  });
});
