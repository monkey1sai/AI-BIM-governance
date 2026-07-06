import type { IfcReadyIntakeJob } from "../types.js";

export type ConversionRecoveryAction =
  | "none"
  | "dispatch_retry"
  | "repost_required"
  | "retrigger_required";

export function deriveConversionRecoveryAction(job: IfcReadyIntakeJob): ConversionRecoveryAction {
  if (job.status === "dispatch_failed") {
    return "dispatch_retry";
  }
  if (job.status === "dropped_on_restart" || job.download_status === "failed") {
    return "repost_required";
  }
  if (job.conversion_status === "failed" && job.conversion_job_id) {
    return "retrigger_required";
  }
  if (job.conversion_status === "failed") {
    return "repost_required";
  }
  return "none";
}
