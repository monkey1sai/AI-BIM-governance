export type SessionStatus = "created" | "active" | "closing" | "closed" | "failed";
export type RoutingPolicy = "same_instance" | "dedicated_instance" | "shared_state";

export interface KitInstance {
  instance_id: string;
  provider: "local_fixed";
  status: "allocated" | "starting" | "ready" | "draining" | "released" | "failed";
  stream_server: string;
  signaling_port: number;
  media_server: string;
  media_port?: number | null;
}

export interface ArtifactBinding {
  binding_id: string;
  artifact_group_id: string;
  model_version_id: string;
  artifact_id: string;
  artifact_role: "source" | "derived" | "overlay" | "mapping";
  url: string | null;
  mapping_url: string | null;
  load_order: number;
  routing_policy: RoutingPolicy;
  ready_status: "ready" | "missing_model" | "missing_mapping" | "blocked_conversion" | "converting" | "failed";
  conversion_authority?: "bim-streaming-server" | string | null;
  conversion_job_id?: string | null;
  conversion_status?: string | null;
  failure_code?: string | null;
  diagnostic?: string | null;
}

export interface KitInstanceBinding {
  kit_instance_id: string;
  provider: "local_fixed";
  tenant_id: string;
  assigned_artifact_ids: string[];
  status: "allocated" | "starting" | "ready" | "draining" | "released" | "failed";
  stream_config: {
    signalingServer: string;
    signalingPort: number;
    mediaServer: string;
    mediaPort?: number | null;
  };
  started_at: string;
  last_heartbeat_at: string;
  released_at: string | null;
  gpu_profile: {
    profile: string;
    capacity_slot: string;
  };
}

export interface ReviewParticipant {
  user_id: string;
  display_name?: string;
  joined_at: string;
  last_seen_at: string;
}

/**
 * Additive, opt-in pass-through of conversion quality metrics surfaced by the
 * streaming conversion authority.
 *
 * The coordinator does NOT compute, cache, or modify these values; it only forwards what the
 * orchestrator/caller provides at session creation time. The viewer card consumes this read-only.
 * Keep this strictly additive — never make it required, and never let it gate session creation.
 */
export interface ConversionQualityMetricsSummary {
  fixture_name?: string | null;
  conversion_job_id?: string | null;
  artifact_group_id?: string | null;
  source_ifc_entity_count?: number | null;
  sidecar_carrier_count?: number | null;
  materialization_strategy?: string | null;
  coverage_ratio?: number | null;
  coverage_status?: string | null;
  conversion_duration_seconds?: number | null;
}

export interface ReviewSession {
  session_id: string;
  review_request_id?: string;
  tenant_id: string;
  project_id: string;
  model_version_id: string;
  source_artifact_id?: string;
  usdc_artifact_id?: string;
  status: SessionStatus;
  mode: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  kit_instance: KitInstance;
  artifact_bindings: ArtifactBinding[];
  kit_instance_bindings: KitInstanceBinding[];
  participants: ReviewParticipant[];
  quality_metrics_summary?: ConversionQualityMetricsSummary | null;
}

export interface Artifact {
  artifact_id: string;
  artifact_type: string;
  name: string;
  url?: string | null;
  mapping_url?: string | null;
  status: string;
  conversion_authority?: "bim-streaming-server" | string | null;
  conversion_job_id?: string | null;
  conversion_status?: string | null;
  failure_code?: string | null;
  diagnostic?: string | null;
  quality_metrics_summary?: ConversionQualityMetricsSummary | null;
}

export interface ReviewIssue {
  issue_id: string;
  severity: string;
  title: string;
  usd_prim_path?: string | null;
  ifc_guid?: string | null;
}

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T3）：外部落地端 IFC
 * Worker → coordinator `POST /api/external/ifc-ready` 的事件。契約權威：
 * `tests/contracts/ifc_ready_payload.json` 與 spec
 * `local-coordinator-ifc-ready-intake-boundary` / `conversion-webhook-lifecycle`。
 */
export interface ExternalIfcReadyEvent {
  event: "ifc_ready";
  event_id?: string;
  // correlation_id / idempotency_key 的權威來源是 AuthProvider（X-Correlation-Id /
  // X-Idempotency-Key header）；body 內同名欄位僅為可選回顯，故型別為 optional。
  correlation_id?: string;
  idempotency_key?: string;
  tenant_id: string;
  project_id: string;
  external_model_version_id: string;
  external_conversion_task_id?: string | null;
  source_ifc: {
    ref: string;
    etag: string;
    filename?: string | null;
    format?: string | null;
  };
  requested_outputs?: string[];
  callback_url?: string | null;
}

export type IfcReadyIntakeStatus =
  | "accepted"
  | "dispatched"
  | "dispatch_failed"
  | "failed";

/**
 * 本地 data-plane conversion job 狀態（最小 shadow；非 mirror 公司 MySQL）。
 * external_model_version_id binding 供後續 cloud callback 關聯（T5）。
 */
export interface IfcReadyIntakeJob {
  ifc_ready_job_id: string;
  status: IfcReadyIntakeStatus;
  idempotent_replay: boolean;
  correlation_id: string;
  idempotency_key: string;
  tenant_id: string;
  project_id: string;
  external_model_version_id: string;
  external_conversion_task_id?: string | null;
  source_ifc_ref: string;
  source_ifc_etag: string;
  callback_url?: string | null;
  conversion_job_id: string | null;
  conversion_status: string | null;
  conversion_authority: "bim-streaming-server" | null;
  dispatch_error?: string | null;
  // T5：雲端 callback outbox 連結。callback 投遞狀態與 conversion 成功分離，
  // 故為獨立欄位（outbox 各自追蹤 delivered/dead_letter）。
  callback_outbox_id?: string | null;
  // T6：data-plane shadow——本地 artifact manifest 參照（external_model_version_id
  // binding 已在上方欄位；不 mirror 公司 MySQL）。
  artifact_manifest_ref?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T6 §7.1）。
 *
 * 客戶落地端最小 shadow metadata 欄位集——僅 idempotency / 轉檔 / web view /
 * callback retry 所需索引。**不 mirror 公司雲端 MySQL**；control-plane 權威
 * （tenant/project/user/RBAC/license/model version/版本歷史/高階 artifact
 * index）仍屬公司雲端 `bim-control`，本地僅以 `external_model_version_id`
 * 參照、不重新宣告權威。
 */
export interface ShadowMetadata {
  tenant_id: string;
  project_id: string;
  external_model_version_id: string;
  external_conversion_task_id: string | null;
  correlation_id: string;
  source_ifc_ref: string;
  source_ifc_etag: string;
  conversion_job_id: string | null;
  artifact_manifest_ref: string | null;
  callback_url: string | null;
  callback_status: string;
  last_callback_attempt_at: string | null;
}

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T7 §8.1-8.3）。
 *
 * 客戶落地端 local web view session：以 data-plane 本地 artifact 解析給
 * browser viewer（實際 USDC streaming 仍走既有 bim-streaming-server 路徑）。
 * 使用者 auth 用可替換 provider，`sso_binding` 在 OQ5 確認前恆為 `pending_oq5`
 * （不做死 EZPLUS SSO）。
 */
export interface LocalWebViewSession {
  web_view_session_id: string;
  user_id: string;
  auth_provider: string;
  sso_binding: "pending_oq5" | "bound";
  external_model_version_id: string;
  ifc_ready_job_id: string;
  artifact_resolution: {
    source_ifc_ref: string;
    artifact_manifest_ref: string | null;
    conversion_job_id: string | null;
    conversion_status: string | null;
    conversion_authority: "bim-streaming-server" | null;
    viewer_open_ready: boolean;
  };
  created_at: string;
}

export interface StreamConfigResponse {
  session_id: string;
  lifecycle_status: SessionStatus;
  source: "local_fixed";
  webrtc: {
    signalingServer: string;
    signalingPort: number;
    mediaServer: string;
    mediaPort?: number | null;
  };
  model: {
    status: "ready" | "missing" | "converting" | "failed" | "blocked";
    artifact_id: string | null;
    url: string | null;
    mapping_url: string | null;
    conversion_authority?: "bim-streaming-server" | string | null;
    conversion_job_id?: string | null;
    conversion_status?: string | null;
    failure_code?: string | null;
    diagnostic?: string | null;
  };
  artifacts: Artifact[];
  artifact_bindings: ArtifactBinding[];
  kit_instance_bindings: KitInstanceBinding[];
  quality_metrics_summary?: ConversionQualityMetricsSummary | null;
  stage_composition: {
    applied_policy: "coordinator_load_order";
    primary_artifact_id: string | null;
    secondary_artifact_ids: string[];
    primary: ArtifactBinding | null;
    secondary_layers: ArtifactBinding[];
  };
  viewport_sharing: {
    mode: string;
    primary_kit_instance_id: string | null;
    shared_state: boolean;
    spectator_ready: boolean;
  };
}
