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
  display_name?: string | null;
  source_ifc_filename?: string | null;
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

export interface ArtifactHealthFailureDetails {
  source_ifc?: string | null;
  model_usdc?: string | null;
  mapping?: string | null;
  metadata?: string | null;
}

export interface ArtifactHealthSnapshot {
  source_ifc_exists: boolean | null;
  model_usdc_reachable: boolean | null;
  mapping_reachable: boolean | null;
  metadata_reachable: boolean | null;
  all_required_ready: boolean;
  checked_at: string;
  stale_reason: string | null;
  failure_details: ArtifactHealthFailureDetails | null;
  source: "edge_health_probe";
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
export interface ConversionMappingIssueSummary {
  code?: string | null;
  message?: string | null;
  severity?: string | null;
  required_join_keys?: string[] | null;
  affected_ifc_count?: number | null;
  affected_usd_count?: number | null;
}

export interface ConversionQualityMetricsSummary {
  fixture_name?: string | null;
  conversion_job_id?: string | null;
  artifact_group_id?: string | null;
  source_ifc_entity_count?: number | null;
  sidecar_carrier_count?: number | null;
  materialization_strategy?: string | null;
  coverage_ratio?: number | null;
  coverage_status?: string | null;
  // m2a-coverage-report:additive 對應/未對應構件數,供 #conv coverage 展開顯示。
  // strictly additive + optional,既有 caller 不需提供。
  mapped_count?: number | null;
  unmapped_count?: number | null;
  conversion_duration_seconds?: number | null;
  // coordinator-forward-quality-metrics-summary:C1 fallback semantic mapping
  // 提供的三個欄位,viewer / `/ui` 用來判定 Semantic ready。strictly additive +
  // optional,既有 explicit caller 不需提供。
  semantic_mapping_fidelity?: string | null;
  mapping_has_ifc_type?: boolean | null;
  mapping_has_ifc_name?: boolean | null;
  mapping_information_status?: string | null;
  mapping_issue_code?: string | null;
  mapping_issue_count?: number | null;
  mapping_issues?: ConversionMappingIssueSummary[] | null;
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
  artifact_health?: ArtifactHealthSnapshot | null;
  // VG-01：viewer 真畫面首幀（_hasRemoteVideoFrame 證明）由 console 經
  // POST /api/review-sessions/:id/first-frame 回報後寫入；coordinator nowIso() 權威時戳。
  // in-memory（檔案）store 重啟後可能不存在 → 讀回 undefined，summarize 時 ?? null。
  first_frame_at?: string | null;
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
  // minio-watch key 結構：種類(倒數二)與專案原名(中文如實顯示)；optional。OQ1 起落 store
  // （ExternalIfcReadyStore.create）並對外曝光（summarizeIfcReadyJob: project_display_name/category，honest-null fallback）。
  project_display_name?: string | null;
  model_category?: string | null;
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
  // coordinator-serial-conversion-dispatch-queue:downloaded 之後等待 in-flight
  // dispatch slot;同時持有正整數 queue_position(1-based)。
  | "queued_for_conversion"
  | "dispatched"
  | "dispatch_failed"
  // coordinator-serial-conversion-dispatch-queue:coordinator process 重啟或
  // queue 被顯式 drain 時,仍在 queued_for_conversion 的 job 被標為此狀態。
  // operator 須重新 POST(in-memory only;非 disk-persistent queue)。
  | "dropped_on_restart"
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
  project_display_name?: string | null;
  category?: string | null;
  external_model_version_id: string;
  external_conversion_task_id?: string | null;
  source_ifc_ref: string;
  source_ifc_etag: string;
  callback_url?: string | null;
  conversion_job_id: string | null;
  conversion_status: string | null;
  conversion_authority: "bim-streaming-server" | null;
  // ifc-ready-api-field-redesign(quality Important #1):轉檔權威回報失敗時的原因文字。
  // recordConversionOutcome 在 conversion_status="failed" 時寫入(與 callback outbox payload 同源 report.reason),
  // 供 deriveFailure 投影 failure_stage="conversion" 的 failure_reason;非失敗恆 null(誠實,不留舊失敗)。
  conversion_failure?: string | null;
  dispatch_error?: string | null;
  // T5：雲端 callback outbox 連結。callback 投遞狀態與 conversion 成功分離，
  // 故為獨立欄位（outbox 各自追蹤 delivered/dead_letter）。
  callback_outbox_id?: string | null;
  // T6：data-plane shadow——本地 artifact manifest 參照（external_model_version_id
  // binding 已在上方欄位；不 mirror 公司 MySQL）。
  artifact_manifest_ref?: string | null;
  // backfill-coordinator-webhook-and-auto-session §2：conversion-ready ingestion
  // 自動建立的 review_session 反向參照，供 idempotent re-entry 對應到既有 session
  // （correlation_id / external_model_version_id 已是 job 主索引，此處只記
  // 反向 session_id，不改 SessionStore schema）。
  review_session_id?: string | null;
  // coordinator-serial-conversion-dispatch-queue:1-based position 在 conversion
  // dispatch queue 中(0 = in-flight,null = 不在 queue 內)。dispatched 後清空。
  queue_position?: number | null;
  // fast-ifc-link-demo-loop §2.2 / §3.1:同步下載階段 + viewer_url 出現條件
  download_status?: "pending" | "downloading" | "downloaded" | "failed" | null;
  download_failure?: string | null;
  local_path?: string | null;
  host_local_path?: string | null;
  web_view_session_id?: string | null;
  viewer_url?: string | null;
  artifact_health?: ArtifactHealthSnapshot | null;
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
    conversion_artifact_ready: boolean;
    viewer_open_state: "not_observed" | "open" | "blocked";
    /** @deprecated Conversion-ready is not viewer-open-ready; use conversion_artifact_ready and runtime stage_open_state. */
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
  artifact_health?: ArtifactHealthSnapshot | null;
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
