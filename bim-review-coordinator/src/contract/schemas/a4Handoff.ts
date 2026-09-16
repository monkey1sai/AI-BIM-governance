// Coordinator Browser Contract — A4 3D handoff intents.
import { z } from "zod/v4";
import type { A4HandoffAction } from "../../services/a4HandoffStore.js";
import type { Equal, Expect } from "../typecheck.js";
import { isoTimestamp, named } from "../primitives.js";

export const a4HandoffAction = named("A4HandoffAction", z.enum(["focus", "highlight"]));
export type _A4HandoffAction = Expect<Equal<z.output<typeof a4HandoffAction>, A4HandoffAction>>;

/** Browser supplies only the action and opaque governance evidence proofs; the coordinator verifies them upstream. */
export const a4HandoffCreateRequest = named("A4HandoffCreateRequest", z.strictObject({
  action: a4HandoffAction,
  evidence_proofs: z.array(z.unknown()).min(1).max(64),
}));

export const a4HandoffCreateResponse = named("A4HandoffCreateResponse", z.strictObject({
  handoff_id: z.string(),
  action: a4HandoffAction,
  expires_at: isoTimestamp,
  open_url: z.string(),
  viewer_url: z.string(),
  row_count: z.number(),
}));

export const a4HandoffConsumeResponse = named("A4HandoffConsumeResponse", z.strictObject({
  handoff_id: z.string(),
  action: a4HandoffAction,
  expires_at: isoTimestamp,
  prim_paths: z.array(z.string()),
  binding: z.strictObject({
    review_session_id: z.string(),
    model_version_id: z.string(),
    primary_artifact_id: z.string(),
    active_binding_revision: z.string(),
  }),
}));

export const a4HandoffEvidenceRejected = named("A4HandoffEvidenceRejected", z.strictObject({
  error_code: z.string(),
  detail: z.string(),
  failed_index: z.number().optional(),
}));
