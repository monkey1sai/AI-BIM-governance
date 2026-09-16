// Contract-complete fixtures for tests that stub coordinator responses.
//
// Every base object below is checked by `satisfies` against the generated contract
// types, so a fixture can only ever be as wrong as the contract itself. Tests take
// a builder and override the fields they care about; the deep merge keeps every
// other field wire-faithful instead of leaving it missing or invented.
import type {
  ClaimViewerLeaseResponse,
  ConversionPrioritizeResponse,
  ConversionRecordItem,
  ConversionRetryResponse,
  IfcReadyDetailResponse,
  IfcReadyListItem,
  IfcReadyReviewSessionOpen,
  KitInstanceBinding,
  PublicViewerLease,
  RecreateSessionResponse,
  ReviewSession,
  RuntimeIfcReadyJob,
  RuntimeKitBinding,
  RuntimeSessionSummary,
  RuntimeStatusResponse,
  StreamConfigResponse,
} from "../../contract/coordinatorApi";

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? ReadonlyArray<DeepPartial<U>> | DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge: objects recurse, arrays and primitives are replaced by the override. */
export function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(current) && isPlainObject(value)
      ? deepMerge(current, value as DeepPartial<typeof current>)
      : value;
  }
  return out as T;
}

const ISO = "2026-09-16T00:00:00.000Z";

const kitStreamConfig = { signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 49101 };

const kitInstanceBinding = {
  kit_instance_id: "kit_1",
  provider: "local_fixed",
  tenant_id: "tenant_demo_001",
  assigned_artifact_ids: ["artifact_1"],
  status: "ready",
  stream_config: kitStreamConfig,
  started_at: ISO,
  last_heartbeat_at: ISO,
  released_at: null,
  gpu_profile: { profile: "rtx", capacity_slot: "slot_1" },
} satisfies KitInstanceBinding;

const publicViewerLease = {
  lease_id: "lease_1",
  session_id: "review_session_1",
  viewer_id: "viewer_1",
  user_id: "user_1",
  display_name: null,
  role: "primary",
  status: "active",
  kit_instance_id: "kit_1",
  stream_config: kitStreamConfig,
  client_nonce: null,
  claimed_at: ISO,
  expires_at: ISO,
  last_heartbeat_at: ISO,
  released_at: null,
  first_frame_at: null,
  loaded_stage_url: null,
  datachannel_ready: false,
  datachannel_ready_at: null,
  stage_match: null,
} satisfies PublicViewerLease;

const claimViewerLeaseResponse = {
  ...publicViewerLease,
  lease_token: "lease_token_1",
  auth_scope: "local_dev_lab",
  primary: true,
  heartbeat_after_ms: 5000,
  idempotent_replay: false,
} satisfies ClaimViewerLeaseResponse;

const runtimeSessionSummary = {
  session_id: "review_session_1",
  status: "active",
  ready_model_id: null,
  project_id: "project_1",
  model_version_id: "version_1",
  participant_count: 0,
  participants: [],
  expected_stage_url: null,
  expected_mapping_url: null,
  conversion_job_id: null,
  conversion_status: null,
  kit_instance_ids: [],
  created_at: ISO,
  updated_at: ISO,
  first_frame_at: null,
  stage_open_state: "not_requested",
  stage_open_evidence: {
    state: "not_requested",
    source: "coordinator",
    detail: "no ready stage URL is bound to this session",
    expected_stage_url: null,
    loaded_stage_url: null,
    datachannel_ready: false,
    first_frame_at: null,
  },
  artifact_health: null,
  primary_viewer_lease_id: null,
  primary_viewer_user_id: null,
  viewer_leases: [],
} satisfies RuntimeSessionSummary;

const runtimeKitBinding = {
  session_id: "review_session_1",
  kit_instance_id: "kit_1",
  status: "ready",
  binding_intent: "capacity_allocated",
  assigned_artifact_ids: ["artifact_1"],
  stream_config: kitStreamConfig,
  started_at: ISO,
  last_heartbeat_at: ISO,
  released_at: null,
} satisfies RuntimeKitBinding;

const ifcReadySummary = {
  ifc_ready_job_id: "ifcready_1",
  status: "dispatched",
  tenant_id: "tenant_demo_001",
  project_id: "project_1",
  project_display_name: null,
  category: null,
  external_model_version_id: "version_1",
  external_conversion_task_id: null,
  correlation_id: "corr_1",
  source_ifc_ref: "https://minio.local/bucket/model.ifc",
  source_ifc_etag: "etag_1",
  download_status: "downloaded",
  download_failure: null,
  artifact_health: null,
  conversion_job_id: "conv_1",
  conversion_status: "ready",
  conversion_lifecycle_status: "ready",
  conversion_authority: "bim-streaming-server",
  queue_position: null,
  dispatch_error: null,
  callback_outbox_id: null,
  artifact_manifest_ref: null,
  review_session_id: null,
  web_view_session_id: null,
  viewer_url: null,
  expected_stage_url: null,
  expected_mapping_url: null,
  idempotency_key: "mw_0000000000000001",
  idempotent_replay: false,
  failure_reason: null,
  failure_stage: null,
  recovery_action: "none",
  usdc_role: "pending",
  data_volatility: "persisted",
  created_at: ISO,
  updated_at: ISO,
} satisfies RuntimeIfcReadyJob;

const ifcReadyListItem = { ...ifcReadySummary, source_object_key: null } satisfies IfcReadyListItem;

const ifcReadyDetail = {
  ifc_ready_job_id: "ifcready_1",
  status: "dispatched",
  idempotent_replay: false,
  correlation_id: "corr_1",
  idempotency_key: "mw_0000000000000001",
  tenant_id: "tenant_demo_001",
  project_id: "project_1",
  external_model_version_id: "version_1",
  source_ifc_ref: "https://minio.local/bucket/model.ifc",
  source_ifc_etag: "etag_1",
  conversion_job_id: "conv_1",
  conversion_status: "ready",
  conversion_authority: "bim-streaming-server",
  created_at: ISO,
  updated_at: ISO,
  artifact_health: null,
  conversion_lifecycle_status: "ready",
  failure_reason: null,
  failure_stage: null,
  recovery_action: "none",
  usdc_role: "pending",
  data_volatility: "persisted",
} satisfies IfcReadyDetailResponse;

const conversionRecord = {
  idempotency_key: "mw_0000000000000001",
  correlation_id: "corr_1",
  project_id: "project_1",
  project_display_name: "Project 1",
  category: "建築",
  external_model_version_id: "version_1",
  object_key: "project_1/建築/version_1/model.ifc",
  bucket: "bim-control",
  conversion_job_id: "conv_1",
  status: "ready",
  coverage_report: null,
  usdc_key: null,
  detected_at: ISO,
  updated_at: ISO,
  converter_version: null,
  failure_code: null,
  dispatch_state: null,
  source_sha256: null,
} satisfies ConversionRecordItem;

const runtimeStatus = {
  service: { status: "ok", name: "bim-review-coordinator", uptime_seconds: 1, generated_at: ISO },
  configured_endpoints: {
    coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
    viewer: {
      browser_url_base: "http://127.0.0.1:5173",
      handoff_path: "/ui/open?session=<review_session_id>",
      coordinator_api_base: "http://127.0.0.1:8004",
      coordinator_socket_url: "http://127.0.0.1:8004",
    },
    conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
    kit: [{ id: "kit_1", signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 49101 }],
  },
  sessions: { count: 0, active_count: 0, participant_count: 0, items: [] },
  kit_runtime_health: [],
  kit_instance_bindings: [],
  ifc_ready_jobs: { count: 0, recent: [] },
  observations: {
    classification: "coordinator_visible_runtime_summary",
    note: "read-only coordinator observations",
    web_plane: { coordinator_port: 8004, viewer_port: 5173 },
    host_native_plane: { conversion_api_base: "http://127.0.0.1:49101", kit_signal_ports: [49100], kit_media_ports: [49101] },
  },
} satisfies RuntimeStatusResponse;

const reviewSession = {
  session_id: "review_session_1",
  tenant_id: "tenant_demo_001",
  project_id: "project_1",
  model_version_id: "version_1",
  status: "active",
  mode: "single_kit_shared_state",
  created_by: "dev_user_001",
  created_at: ISO,
  updated_at: ISO,
  kit_instance: {
    instance_id: "kit_1",
    provider: "local_fixed",
    status: "ready",
    stream_server: "127.0.0.1",
    signaling_port: 49100,
    media_server: "127.0.0.1",
    media_port: 49101,
  },
  artifact_bindings: [],
  kit_instance_bindings: [],
  participants: [],
} satisfies ReviewSession;

const streamConfig = {
  session_id: "review_session_1",
  trace_id: "trace_1",
  lifecycle_status: "active",
  source: "local_fixed",
  webrtc: kitStreamConfig,
  model: { status: "ready", artifact_id: "artifact_1", url: "http://127.0.0.1:49101/artifacts/model.usdc", mapping_url: null },
  artifacts: [],
  artifact_bindings: [],
  kit_instance_bindings: [],
  stage_composition: {
    applied_policy: "coordinator_load_order",
    primary_artifact_id: null,
    secondary_artifact_ids: [],
    primary: null,
    secondary_layers: [],
  },
  viewport_sharing: { mode: "single_kit_shared_state", primary_kit_instance_id: null, shared_state: true, spectator_ready: false },
} satisfies StreamConfigResponse;

const recreateSessionResponse = {
  session_id: "review_session_2",
  status: "active",
  recreated_from_session_id: "review_session_1",
  idempotent_replay: false,
  activation_state: "not_requested",
  kit_availability: "unavailable",
  session: { ...reviewSession, session_id: "review_session_2", recreated_from_session_id: "review_session_1" },
} satisfies RecreateSessionResponse;

const conversionPrioritizeResponse = {
  ifc_ready_job_id: "ifcready_1",
  status: "queued_for_conversion",
  queue_position: 1,
  queued_order: ["ifcready_1"],
  reason: "",
} satisfies ConversionPrioritizeResponse;

const conversionRetryResponse = {
  ifc_ready_job_id: "ifcready_1",
  status: "queued_for_conversion",
  queue_position: 1,
  reason: "",
} satisfies ConversionRetryResponse;

const ifcReadyReviewSessionOpen = {
  ifc_ready_job_id: "ifcready_1",
  trace_id: "trace_1",
  conversion_job_id: "conv_1",
  conversion_status: "ready",
  review_session_id: "review_session_1",
  session_status: "active",
  session_replay: false,
  open_url: "http://127.0.0.1:8004/ui/open?session=review_session_1",
  viewer_url: "http://127.0.0.1:8004/ui/open?session=review_session_1",
  expected_stage_url: null,
  expected_mapping_url: null,
  artifact_health: null,
} satisfies IfcReadyReviewSessionOpen;

const builder = <T>(base: T) => (override?: DeepPartial<T>): T => deepMerge(structuredClone(base) as T, override);

/** Contract-faithful builders; pass only the fields the test asserts on. */
export const fx = {
  kitInstanceBinding: builder<KitInstanceBinding>(kitInstanceBinding),
  publicViewerLease: builder<PublicViewerLease>(publicViewerLease),
  claimViewerLeaseResponse: builder<ClaimViewerLeaseResponse>(claimViewerLeaseResponse),
  runtimeSessionSummary: builder<RuntimeSessionSummary>(runtimeSessionSummary),
  runtimeKitBinding: builder<RuntimeKitBinding>(runtimeKitBinding),
  ifcReadySummary: builder<RuntimeIfcReadyJob>(ifcReadySummary),
  ifcReadyListItem: builder<IfcReadyListItem>(ifcReadyListItem),
  ifcReadyDetail: builder<IfcReadyDetailResponse>(ifcReadyDetail),
  conversionRecord: builder<ConversionRecordItem>(conversionRecord),
  runtimeStatus: builder<RuntimeStatusResponse>(runtimeStatus),
  reviewSession: builder<ReviewSession>(reviewSession),
  streamConfig: builder<StreamConfigResponse>(streamConfig),
  recreateSessionResponse: builder<RecreateSessionResponse>(recreateSessionResponse),
  conversionPrioritizeResponse: builder<ConversionPrioritizeResponse>(conversionPrioritizeResponse),
  conversionRetryResponse: builder<ConversionRetryResponse>(conversionRetryResponse),
  ifcReadyReviewSessionOpen: builder<IfcReadyReviewSessionOpen>(ifcReadyReviewSessionOpen),
};
