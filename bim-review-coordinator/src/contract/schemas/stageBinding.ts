// Coordinator Browser Contract — Stage Binding Transaction (browser preauthorization).
import { z } from "zod/v4";
import { isoTimestamp, named } from "../primitives.js";
import { authScope } from "./viewerLeases.js";

const safeCommandId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export const stageArtifactSelection = named("StageArtifactSelection", z.strictObject({
  artifact_id: z.string().trim().min(1).max(200),
  role: z.enum(["primary", "secondary"]),
  load_order: z.number().int().nonnegative().max(10_000),
}));

export const stageBindingPreauthorizationRequest = named("StageBindingPreauthorizationRequest", z.strictObject({
  source_client_id: z.string().trim().min(1).max(200),
  role: z.literal("primary"),
  client_request_id: safeCommandId.optional(),
  artifacts: z.array(stageArtifactSelection).min(1).max(64),
}));

export const stageBindingCancellationRequest = named("StageBindingCancellationRequest", z.strictObject({
  source_client_id: z.string().trim().min(1).max(200),
  client_request_id: safeCommandId,
}));

export const wireStageCompositionArtifact = named("WireStageCompositionArtifact", z.strictObject({
  artifact_id: z.string(),
  role: z.enum(["primary", "secondary"]),
  load_order: z.number(),
  usdc_url: z.string(),
}));

export const wireStageComposition = named("WireStageComposition", z.strictObject({
  primary: wireStageCompositionArtifact,
  secondary_layers: z.array(wireStageCompositionArtifact),
}));

export const stageBindingPreauthorizationResponse = named("StageBindingPreauthorizationResponse", z.strictObject({
  status: z.literal("pending"),
  session_id: z.string(),
  auth_scope: authScope,
  stage_binding_authorization_id: z.string(),
  binding_revision_id: z.string(),
  stage_composition: wireStageComposition,
  pending_expires_at: isoTimestamp,
}));

export const stageBindingCancellationResponse = named("StageBindingCancellationResponse", z.strictObject({
  cancelled: z.literal(true),
  client_request_id: z.string(),
  idempotent_replay: z.boolean(),
}));

export const stageBindingNotAbortableError = named("StageBindingNotAbortableError", z.strictObject({
  cancelled: z.literal(false),
  client_request_id: z.string(),
  detail: z.literal("stage_binding_transaction_not_abortable"),
}));
