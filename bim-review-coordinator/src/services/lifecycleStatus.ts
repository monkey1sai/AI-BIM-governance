import type { ConversionLedgerStatus } from "./conversionLedger.js";
import type { IfcReadyIntakeJob } from "../types.js";

// 單一權威：intake 狀態 → 轉檔生命週期狀態。重用 ConversionLedgerStatus（禁另宣告 enum）。
// 凍結映射（由上至下短路），詳見 plan §Task 2。誠實：converter 落地前不會出現 ready。
export function deriveLifecycleStatus(job: IfcReadyIntakeJob): ConversionLedgerStatus {
  if (
    job.status === "failed" ||
    job.status === "dispatch_failed" ||
    job.status === "dropped_on_restart" ||
    job.download_status === "failed" ||
    // lifecycle-conversion-failed:轉檔權威回報失敗時 recordConversionOutcome 只改 conversion_status,
    // job.status 仍為 markDispatched 設的 "dispatched"。若不在此最高優先 failed 判斷收斂,會短路回
    // "converting" 與同 job 的 failure_stage="conversion" 自相矛盾,前端輪詢永遠卡等看不到失敗。
    job.conversion_status === "failed"
  ) {
    return "failed";
  }
  if (job.conversion_status === "ready") return "ready";
  if (job.status === "dispatched") return "converting";
  if (job.status === "queued_for_conversion") return "queued";
  return "detected";
}
