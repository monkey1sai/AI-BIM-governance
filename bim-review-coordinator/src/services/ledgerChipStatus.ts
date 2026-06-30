// bim-review-coordinator/src/services/ledgerChipStatus.ts
//
// 純函式：bucket .ifc 物件 → chip 狀態（ledger 為真相來源）。
// spec §2.5 第 6 點、§3.3 第 1 點、AC-chip。
// 無 I/O，前端 Task 7 import 同義常數。

import type { ConversionLedgerRecord, ConversionLedgerStatus } from "./conversionLedger.js";

/**
 * chip 狀態型別：
 * - ConversionLedgerStatus 五值（ready / detected / queued / converting / failed）
 * - 'untracked'：ledger 無紀錄（前端顯「未轉（含 baseline 既有檔）」，不臆測）
 */
export type ChipStatus = ConversionLedgerStatus | "untracked";

/**
 * 根據 idempotency_key 從 ledger 紀錄列表查詢對應 chip 狀態。
 *
 * @param idempotencyKey  mw_<hash16>（由後端 idempotencyKeyFor(bucket,key,etag) 算出）
 * @param records         ConversionLedger.list() 或 GET /api/conversion/records 回傳值
 * @returns               對應的 chip 狀態；無紀錄回 'untracked'（誠實不臆測）
 */
export function ledgerChipStatus(
  idempotencyKey: string,
  records: ConversionLedgerRecord[],
): ChipStatus {
  const record = records.find((r) => r.idempotency_key === idempotencyKey);
  return record ? record.status : "untracked";
}
