// Coordinator Browser Contract — Review Session family.
// Every schema whose output must equal an existing src/types.ts interface carries
// an `Expect<Equal<…>>` assertion; tsc enforces the match.
import { z } from "zod/v4";
import type {
  Artifact,
  ArtifactBinding,
  ArtifactHealthFailureDetails,
  ArtifactHealthSnapshot,
  ConversionMappingIssueSummary,
  ConversionQualityMetricsSummary,
  KitInstance,
  KitInstanceBinding,
  ReadyReviewSourceSnapshot,
  ReviewParticipant,
  ReviewSession,
  StreamConfigResponse,
} from "../../types.js";
import type { Equal, Expect } from "../typecheck.js";
import { isoTimestamp, named, routingPolicy, sessionStatus } from "../primitives.js";

// ── Building blocks mirrored from src/types.ts ───────────────────────────────

export const kitInstance = named("KitInstance", z.strictObject({
  instance_id: z.string(),
  provider: z.literal("local_fixed"),
  status: z.enum(["allocated", "starting", "ready", "draining", "released", "failed"]),
  stream_server: z.string(),
  signaling_port: z.number(),
  media_server: z.string(),
  media_port: z.number().nullable().optional(),
}));
export type _KitInstance = Expect<Equal<z.output<typeof kitInstance>, KitInstance>>;

export const artifactBinding = named("ArtifactBinding", z.strictObject({
  binding_id: z.string(),
  artifact_group_id: z.string(),
  model_version_id: z.string(),
  artifact_id: z.string(),
  display_name: z.string().nullable().optional(),
  source_ifc_filename: z.string().nullable().optional(),
  artifact_role: z.enum(["source", "derived", "overlay", "mapping"]),
  url: z.string().nullable(),
  mapping_url: z.string().nullable(),
  load_order: z.number(),
  routing_policy: routingPolicy,
  ready_status: z.enum(["ready", "missing_model", "missing_mapping", "blocked_conversion", "converting", "failed"]),
  conversion_authority: z.string().nullable().optional(),
  conversion_job_id: z.string().nullable().optional(),
  conversion_status: z.string().nullable().optional(),
  failure_code: z.string().nullable().optional(),
  diagnostic: z.string().nullable().optional(),
}));
export type _ArtifactBinding = Expect<Equal<z.output<typeof artifactBinding>, ArtifactBinding>>;

export const artifactHealthFailureDetails = named("ArtifactHealthFailureDetails", z.strictObject({
  source_ifc: z.string().nullable().optional(),
  model_usdc: z.string().nullable().optional(),
  mapping: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(),
}));
export type _ArtifactHealthFailureDetails =
  Expect<Equal<z.output<typeof artifactHealthFailureDetails>, ArtifactHealthFailureDetails>>;

export const artifactHealthSnapshot = named("ArtifactHealthSnapshot", z.strictObject({
  source_ifc_exists: z.boolean().nullable(),
  model_usdc_reachable: z.boolean().nullable(),
  mapping_reachable: z.boolean().nullable(),
  metadata_reachable: z.boolean().nullable(),
  all_required_ready: z.boolean(),
  checked_at: isoTimestamp,
  stale_reason: z.string().nullable(),
  failure_details: artifactHealthFailureDetails.nullable(),
  source: z.literal("edge_health_probe"),
}));
export type _ArtifactHealthSnapshot = Expect<Equal<z.output<typeof artifactHealthSnapshot>, ArtifactHealthSnapshot>>;

export const kitStreamConfig = named("KitStreamConfig", z.strictObject({
  signalingServer: z.string(),
  signalingPort: z.number(),
  mediaServer: z.string(),
  mediaPort: z.number().nullable().optional(),
}));
export type _KitStreamConfig = Expect<Equal<z.output<typeof kitStreamConfig>, KitInstanceBinding["stream_config"]>>;

export const kitInstanceBinding = named("KitInstanceBinding", z.strictObject({
  kit_instance_id: z.string(),
  provider: z.literal("local_fixed"),
  tenant_id: z.string(),
  assigned_artifact_ids: z.array(z.string()),
  status: z.enum(["allocated", "starting", "ready", "draining", "released", "failed"]),
  stream_config: kitStreamConfig,
  started_at: isoTimestamp,
  last_heartbeat_at: isoTimestamp,
  released_at: isoTimestamp.nullable(),
  gpu_profile: z.strictObject({ profile: z.string(), capacity_slot: z.string() }),
}));
export type _KitInstanceBinding = Expect<Equal<z.output<typeof kitInstanceBinding>, KitInstanceBinding>>;

export const reviewParticipant = named("ReviewParticipant", z.strictObject({
  user_id: z.string(),
  display_name: z.string().optional(),
  joined_at: isoTimestamp,
  last_seen_at: isoTimestamp,
}));
export type _ReviewParticipant = Expect<Equal<z.output<typeof reviewParticipant>, ReviewParticipant>>;

export const conversionMappingIssueSummary = named("ConversionMappingIssueSummary", z.strictObject({
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  required_join_keys: z.array(z.string()).nullable().optional(),
  affected_ifc_count: z.number().nullable().optional(),
  affected_usd_count: z.number().nullable().optional(),
}));
export type _ConversionMappingIssueSummary =
  Expect<Equal<z.output<typeof conversionMappingIssueSummary>, ConversionMappingIssueSummary>>;

export const conversionQualityMetricsSummary = named("ConversionQualityMetricsSummary", z.strictObject({
  fixture_name: z.string().nullable().optional(),
  conversion_job_id: z.string().nullable().optional(),
  artifact_group_id: z.string().nullable().optional(),
  source_ifc_entity_count: z.number().nullable().optional(),
  sidecar_carrier_count: z.number().nullable().optional(),
  materialization_strategy: z.string().nullable().optional(),
  coverage_ratio: z.number().nullable().optional(),
  coverage_status: z.string().nullable().optional(),
  mapped_count: z.number().nullable().optional(),
  unmapped_count: z.number().nullable().optional(),
  conversion_duration_seconds: z.number().nullable().optional(),
  semantic_mapping_fidelity: z.string().nullable().optional(),
  mapping_has_ifc_type: z.boolean().nullable().optional(),
  mapping_has_ifc_name: z.boolean().nullable().optional(),
  mapping_information_status: z.string().nullable().optional(),
  mapping_issue_code: z.string().nullable().optional(),
  mapping_issue_count: z.number().nullable().optional(),
  mapping_issues: z.array(conversionMappingIssueSummary).nullable().optional(),
}));
export type _ConversionQualityMetricsSummary =
  Expect<Equal<z.output<typeof conversionQualityMetricsSummary>, ConversionQualityMetricsSummary>>;

export const readyReviewSourceSnapshot = named("ReadyReviewSourceSnapshot", z.strictObject({
  schema_version: z.literal("ready-review-source/v1"),
  ready_model_id: z.string(),
  conversion_job_id: z.string(),
  correlation_id: z.string(),
  root_trace_id: z.string(),
  tenant_id: z.string(),
  project_id: z.string(),
  model_version_id: z.string(),
  model: z.strictObject({ url: z.string(), sha256: z.string() }),
  mapping: z.strictObject({ url: z.string(), sha256: z.string() }),
}));
export type _ReadyReviewSourceSnapshot =
  Expect<Equal<z.output<typeof readyReviewSourceSnapshot>, ReadyReviewSourceSnapshot>>;

export const reviewSession = named("ReviewSession", z.strictObject({
  ready_model_id: z.string().optional(),
  session_id: z.string(),
  recreated_from_session_id: z.string().optional(),
  trace_id: z.string().optional(),
  review_request_id: z.string().optional(),
  review_request_fingerprint: z.string().optional(),
  ready_review_source: readyReviewSourceSnapshot.optional(),
  tenant_id: z.string(),
  project_id: z.string(),
  model_version_id: z.string(),
  source_artifact_id: z.string().optional(),
  usdc_artifact_id: z.string().optional(),
  status: sessionStatus,
  mode: z.string(),
  created_by: z.string(),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
  kit_instance: kitInstance,
  artifact_bindings: z.array(artifactBinding),
  kit_instance_bindings: z.array(kitInstanceBinding),
  participants: z.array(reviewParticipant),
  quality_metrics_summary: conversionQualityMetricsSummary.nullable().optional(),
  artifact_health: artifactHealthSnapshot.nullable().optional(),
  first_frame_at: isoTimestamp.nullable().optional(),
  close_checkpoint: z.strictObject({
    checkpoint_id: z.string(),
    expected_final_event_count: z.number(),
  }).optional(),
}), "Coordinator-owned Review Session record as returned by session routes.");
export type _ReviewSession = Expect<Equal<z.output<typeof reviewSession>, ReviewSession>>;

export const artifact = named("Artifact", z.strictObject({
  artifact_id: z.string(),
  artifact_type: z.string(),
  name: z.string(),
  url: z.string().nullable().optional(),
  mapping_url: z.string().nullable().optional(),
  status: z.string(),
  conversion_authority: z.string().nullable().optional(),
  conversion_job_id: z.string().nullable().optional(),
  conversion_status: z.string().nullable().optional(),
  failure_code: z.string().nullable().optional(),
  diagnostic: z.string().nullable().optional(),
  quality_metrics_summary: conversionQualityMetricsSummary.nullable().optional(),
}));
export type _Artifact = Expect<Equal<z.output<typeof artifact>, Artifact>>;

export const streamConfigResponse = named("StreamConfigResponse", z.strictObject({
  session_id: z.string(),
  trace_id: z.string(),
  lifecycle_status: sessionStatus,
  source: z.literal("local_fixed"),
  webrtc: kitStreamConfig,
  model: z.strictObject({
    status: z.enum(["ready", "missing", "converting", "failed", "blocked"]),
    artifact_id: z.string().nullable(),
    url: z.string().nullable(),
    mapping_url: z.string().nullable(),
    conversion_authority: z.string().nullable().optional(),
    conversion_job_id: z.string().nullable().optional(),
    conversion_status: z.string().nullable().optional(),
    failure_code: z.string().nullable().optional(),
    diagnostic: z.string().nullable().optional(),
  }),
  artifacts: z.array(artifact),
  artifact_bindings: z.array(artifactBinding),
  kit_instance_bindings: z.array(kitInstanceBinding),
  quality_metrics_summary: conversionQualityMetricsSummary.nullable().optional(),
  artifact_health: artifactHealthSnapshot.nullable().optional(),
  stage_composition: z.strictObject({
    applied_policy: z.literal("coordinator_load_order"),
    primary_artifact_id: z.string().nullable(),
    secondary_artifact_ids: z.array(z.string()),
    primary: artifactBinding.nullable(),
    secondary_layers: z.array(artifactBinding),
  }),
  viewport_sharing: z.strictObject({
    mode: z.string(),
    primary_kit_instance_id: z.string().nullable(),
    shared_state: z.boolean(),
    spectator_ready: z.boolean(),
  }),
}), "GET /api/review-sessions/{sessionId}/stream-config — the browser's bootstrap for Kit streaming.");
export type _StreamConfigResponse = Expect<Equal<z.output<typeof streamConfigResponse>, StreamConfigResponse>>;

// ── Requests ─────────────────────────────────────────────────────────────────

export const createSessionRequest = named("CreateSessionRequest", z.object({
  review_request_id: z.string().min(1).optional(),
  tenant_id: z.string().min(1).default("tenant_demo_001"),
  project_id: z.string().min(1),
  model_version_id: z.string().min(1),
  federated_set_id: z.string().min(1).max(200).optional(),
  source_artifact_id: z.string().min(1).optional(),
  usdc_artifact_id: z.string().min(1).optional(),
  created_by: z.string().min(1).default("dev_user_001"),
  mode: z.string().min(1).default("single_kit_shared_state"),
  routing_policy: routingPolicy.default("same_instance"),
  artifact_bindings: z.array(z.looseObject({
    binding_id: z.string().optional(),
    artifact_group_id: z.string().min(1),
    model_version_id: z.string().min(1).optional(),
    artifact_id: z.string().min(1),
    display_name: z.string().nullable().optional(),
    source_ifc_filename: z.string().nullable().optional(),
    artifact_role: z.enum(["source", "derived", "overlay", "mapping"]).default("derived"),
    url: z.string().nullable().optional(),
    mapping_url: z.string().nullable().optional(),
    load_order: z.number().int().nonnegative().default(0),
    routing_policy: routingPolicy.optional(),
    ready_status: z.enum(["ready", "missing_model", "missing_mapping", "blocked_conversion", "converting", "failed"]).default("ready"),
    conversion_authority: z.string().nullable().optional(),
    conversion_job_id: z.string().nullable().optional(),
    conversion_status: z.string().nullable().optional(),
    failure_code: z.string().nullable().optional(),
    diagnostic: z.string().nullable().optional(),
  })).default([]),
  kit_profile: z.record(z.string(), z.unknown()).default({}),
  options: z.object({ auto_allocate_kit: z.boolean().optional() }).optional(),
  quality_metrics_summary: z.looseObject({
    fixture_name: z.string().nullish(),
    conversion_job_id: z.string().nullish(),
    artifact_group_id: z.string().nullish(),
    source_ifc_entity_count: z.number().nullish(),
    sidecar_carrier_count: z.number().nullish(),
    materialization_strategy: z.string().nullish(),
    coverage_ratio: z.number().nullish(),
    coverage_status: z.string().nullish(),
    conversion_duration_seconds: z.number().nullish(),
    semantic_mapping_fidelity: z.string().nullish(),
    mapping_has_ifc_type: z.boolean().nullish(),
    mapping_has_ifc_name: z.boolean().nullish(),
  }).nullish(),
}));

export const recreateSessionRequest = named("RecreateSessionRequest", z.strictObject({}));

export const closeSessionRequest = named("CloseSessionRequest", z.looseObject({
  final_events: z.array(z.unknown()).optional(),
  reason: z.string().max(500).optional(),
}));

export const sessionActivityRequest = named("SessionActivityRequest", z.strictObject({
  lease_id: z.string().trim().min(1).max(200),
}));

export const sessionIdlePolicyUpdateRequest = named("SessionIdlePolicyUpdateRequest", z.strictObject({
  timeout_ms: z.number().int().min(1).nullable(),
  expected_revision: z.number().int().nonnegative(),
  expected_process_epoch: z.string().regex(/^[0-9a-f]{32}$/),
  reason: z.string().trim().min(1).max(500),
}));

// ── Responses without a src/types.ts counterpart (written from the handlers) ─

export const sessionRebuildability = named("SessionRebuildability", z.strictObject({
  state: z.enum(["ready", "stale", "unavailable"]),
  reason: z.string().nullable(),
  checked_at: isoTimestamp.nullable(),
}));

export const closedSessionItem = named("ClosedSessionItem", z.strictObject({
  session_id: z.string(),
  status: sessionStatus,
  project_id: z.string(),
  model_version_id: z.string(),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
  recreated_from_session_id: z.string().nullable(),
  rebuildability: sessionRebuildability,
}));

export const closedSessionPage = named("ClosedSessionPage", z.strictObject({
  items: z.array(closedSessionItem),
  next_cursor: z.string().nullable(),
}));

export const recreateSessionResponse = named("RecreateSessionResponse", z.strictObject({
  session_id: z.string(),
  status: sessionStatus,
  recreated_from_session_id: z.string(),
  idempotent_replay: z.boolean(),
}));

export const recreateNotRebuildableError = named("RecreateNotRebuildableError", z.strictObject({
  detail: z.string(),
  rebuildability: sessionRebuildability.optional(),
}));

export const firstFrameResponse = named("FirstFrameResponse", z.strictObject({
  session_id: z.string(),
  first_frame_at: isoTimestamp.nullable(),
}));

export const sessionActivityResponse = named("SessionActivityResponse", z.strictObject({
  ok: z.literal(true),
  session_id: z.string(),
  recorded_at: isoTimestamp,
}));

export const sessionIdleStatusResponse = named("SessionIdleStatusResponse", z.strictObject({
  session_id: z.string(),
  enabled: z.boolean(),
  has_connected_viewer: z.boolean(),
  is_counting_down: z.boolean(),
  remaining_seconds: z.number().nullable(),
  last_activity_at: isoTimestamp.nullable(),
}));

export const sessionIdlePolicyResponse = named("SessionIdlePolicyResponse", z.strictObject({
  enabled: z.boolean(),
  timeout_ms: z.number().nullable(),
  source: z.string(),
  revision: z.number(),
  process_epoch: z.string(),
  countdown_seconds: z.number(),
  apply_mode: z.literal("live_process"),
  restart_behavior: z.literal("environment_value_restored"),
  active_session_behavior: z.literal("ready_sessions_restart_idle_clock"),
}));
