import type { ConversionLedgerStatus } from "./conversionLedger.js";
import type { IfcReadyIntakeJob } from "../types.js";

// 單一權威：intake 狀態 → 轉檔生命週期狀態。重用 ConversionLedgerStatus（禁另宣告 enum）。
// 凍結映射（由上至下短路），詳見 plan §Task 2。誠實：converter 落地前不會出現 ready。
export function deriveLifecycleStatus(job: IfcReadyIntakeJob): ConversionLedgerStatus {
  if (
    job.status === "failed" ||
    job.status === "dispatch_failed" ||
    job.status === "dropped_on_restart" ||
    job.download_status === "failed"
  ) {
    return "failed";
  }
  if (job.conversion_status === "ready") return "ready";
  if (job.status === "dispatched") return "converting";
  if (job.status === "queued_for_conversion") return "queued";
  return "detected";
}
