// Coordinator Browser Contract — callback outbox operator summary.
import { z } from "zod/v4";
import { isoTimestamp, named } from "../primitives.js";

export const callbackOutboxEntry = named("CallbackOutboxEntry", z.strictObject({
  outbox_id: z.string(),
  event: z.string(),
  status: z.string(),
  attempts: z.number(),
  max_attempts: z.number(),
  last_error: z.literal("callback_delivery_failed").nullable(),
  created_at: isoTimestamp,
  delivered_at: isoTimestamp.nullable(),
  correlation_id: z.string().nullable(),
  conversion_job_id: z.string().nullable(),
}));

export const callbackOutboxSummary = named("CallbackOutboxSummary", z.strictObject({
  total: z.number(),
  limit: z.number(),
  entries: z.array(callbackOutboxEntry),
}));

export const issueSnapshotRequest = named("IssueSnapshotRequest", z.object({
  rule_run_id: z.string().trim().min(1).max(200),
  model_version_id: z.string().min(1).max(200).optional(),
}));

export const issueSnapshotAccepted = named("IssueSnapshotAccepted", z.strictObject({
  outbox_id: z.string(),
}));
