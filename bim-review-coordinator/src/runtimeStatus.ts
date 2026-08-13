import type { CoordinatorConfig } from "./config.js";
import { deriveConversionRecoveryAction } from "./services/conversionRecoveryAction.js";
import { deriveFailure } from "./services/failureReason.js";
import { deriveLifecycleStatus } from "./services/lifecycleStatus.js";
import { maskPresignedRef } from "./services/presignedRef.js";
import type { PublicViewerLease } from "./services/viewerLeaseStore.js";
import type {
  ArtifactBinding,
  ArtifactHealthSnapshot,
  IfcReadyIntakeJob,
  ReviewSession,
} from "./types.js";


export interface RuntimeStatusInput {
  config: CoordinatorConfig;
  startedAt: number;
  sessions: ReviewSession[];
  ifcReadyJobs: IfcReadyIntakeJob[];
  ifcReadyDataVolatility?: "persisted" | "in_memory_volatile";
  viewerLeasesBySession?: (sessionId: string) => PublicViewerLease[];
}
export function buildRuntimeStatus(input: RuntimeStatusInput): Record<string, unknown> {
  const activeSessions = input.sessions.filter((session) => session.status === "active");
  const participantCount = input.sessions.reduce((total, session) => total + session.participants.length, 0);
  return {
    service: {
      status: "ok",
      name: "bim-review-coordinator",
      uptime_seconds: Math.max(0, Math.floor((Date.now() - input.startedAt) / 1000)),
      generated_at: new Date().toISOString(),
    },
    configured_endpoints: {
      coordinator: {
        host: input.config.host,
        port: input.config.port,
        public_host: input.config.publicHost,
        public_base_url: input.config.coordinatorPublicBaseUrl,
      },
      viewer: {
        browser_url_base: input.config.viewerPublicBaseUrl,
        handoff_path: "/ui/open?session=<review_session_id>",
        coordinator_api_base: input.config.coordinatorPublicBaseUrl,
        coordinator_socket_url: input.config.coordinatorPublicBaseUrl,
      },
      conversion_authority: {
        base_url: input.config.streamingConversionApiBase,
        authority: "bim-streaming-server",
      },
      kit: input.config.kitInstanceEndpoints.map((endpoint) => ({
        id: endpoint.id,
        signalingServer: endpoint.signalingServer,
        signalingPort: endpoint.signalingPort,
        mediaServer: endpoint.mediaServer,
        mediaPort: endpoint.mediaPort,
      })),
    },
    sessions: {
      count: input.sessions.length,
      active_count: activeSessions.length,
      participant_count: participantCount,
      items: input.sessions.map((session) =>
        summarizeSessionForRuntime(session, input.viewerLeasesBySession?.(session.session_id) ?? []),
      ),
    },
    kit_instance_bindings: input.sessions.flatMap((session) =>
      session.kit_instance_bindings.map((binding) => ({
        session_id: session.session_id,
        kit_instance_id: binding.kit_instance_id,
        status: binding.status,
        binding_intent: "capacity_allocated",
        assigned_artifact_ids: binding.assigned_artifact_ids,
        stream_config: binding.stream_config,
        started_at: binding.started_at,
        last_heartbeat_at: binding.last_heartbeat_at,
        released_at: binding.released_at,
      })),
    ),
    ifc_ready_jobs: {
      count: input.ifcReadyJobs.length,
      recent: input.ifcReadyJobs
        .slice()
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
        .slice(0, 10)
        .map((job) => {
          const session = input.sessions.find((item) => item.session_id === job.review_session_id) ?? null;
          return summarizeIfcReadyJob(
            job,
            session,
            job.artifact_health ?? session?.artifact_health ?? null,
            input.ifcReadyDataVolatility,
          );
        }),
    },
    observations: {
      classification: "coordinator_visible_runtime_summary",
      note: "read-only coordinator observations; Kit internal stage state still requires DataChannel or Kit log evidence.",
      web_plane: {
        coordinator_port: input.config.port,
        viewer_port: 5173,
      },
      host_native_plane: {
        conversion_api_base: input.config.streamingConversionApiBase,
        kit_signal_ports: input.config.kitInstanceEndpoints.map((endpoint) => endpoint.signalingPort),
        kit_media_ports: input.config.kitInstanceEndpoints.map((endpoint) => endpoint.mediaPort).filter((port) => port !== null),
      },
    },
  };
}
function summarizeSessionForRuntime(session: ReviewSession, viewerLeases: PublicViewerLease[] = []): Record<string, unknown> {
  const expectedStage = expectedStageBinding(session);
  const primaryLease = viewerLeases.find((lease) => lease.status === "active" && lease.role === "primary") ?? null;
  const stageOpenEvidence = deriveStageOpenEvidence(expectedStage?.url ?? null, primaryLease);
  return {
    session_id: session.session_id,
    status: session.status,
    project_id: session.project_id,
    model_version_id: session.model_version_id,
    participant_count: session.participants.length,
    participants: session.participants.map((participant) => ({
      user_id: participant.user_id,
      display_name: participant.display_name ?? null,
      last_seen_at: participant.last_seen_at,
    })),
    expected_stage_url: expectedStage?.url ?? null,
    expected_mapping_url: expectedStage?.mapping_url ?? null,
    conversion_job_id: expectedStage?.conversion_job_id ?? null,
    conversion_status: expectedStage?.conversion_status ?? null,
    kit_instance_ids: session.kit_instance_bindings.map((binding) => binding.kit_instance_id),
    created_at: session.created_at,
    updated_at: session.updated_at,
    first_frame_at: session.first_frame_at ?? null, // VG-01 型別鏈：runtime/status 透出真首幀證據
    stage_open_state: stageOpenEvidence.state,
    stage_open_evidence: stageOpenEvidence,
    artifact_health: session.artifact_health ?? null,
    primary_viewer_lease_id: primaryLease?.lease_id ?? null,
    primary_viewer_user_id: primaryLease?.user_id ?? null,
    viewer_leases: viewerLeases,
  };
}

function deriveStageOpenEvidence(
  expectedStageUrl: string | null,
  primaryLease: PublicViewerLease | null,
): Record<string, unknown> {
  if (!expectedStageUrl) {
    return {
      state: "not_requested",
      source: "coordinator",
      detail: "no ready stage URL is bound to this session",
      expected_stage_url: null,
      loaded_stage_url: null,
      datachannel_ready: false,
      first_frame_at: null,
    };
  }
  if (!primaryLease) {
    return {
      state: "not_requested",
      source: "coordinator",
      detail: "Kit endpoint metadata exists, but no active primary viewer lease has requested or reported a stage",
      expected_stage_url: expectedStageUrl,
      loaded_stage_url: null,
      datachannel_ready: false,
      first_frame_at: null,
    };
  }
  if (primaryLease.stage_match === true) {
    return {
      state: "open",
      source: "viewer_lease",
      detail: "active primary viewer reported loaded_stage_url matching expected_stage_url",
      expected_stage_url: expectedStageUrl,
      loaded_stage_url: primaryLease.loaded_stage_url,
      datachannel_ready: primaryLease.datachannel_ready,
      first_frame_at: primaryLease.first_frame_at,
    };
  }
  if (primaryLease.loaded_stage_url && primaryLease.stage_match === false) {
    return {
      state: "blocked",
      source: "viewer_lease",
      detail: "active primary viewer loaded a different stage URL",
      expected_stage_url: expectedStageUrl,
      loaded_stage_url: primaryLease.loaded_stage_url,
      datachannel_ready: primaryLease.datachannel_ready,
      first_frame_at: primaryLease.first_frame_at,
    };
  }
  return {
    state: primaryLease.datachannel_ready ? "requested" : "not_observed",
    source: "viewer_lease",
    detail: "active primary viewer lease exists, but no matching loaded_stage_url evidence has been observed",
    expected_stage_url: expectedStageUrl,
    loaded_stage_url: primaryLease.loaded_stage_url,
    datachannel_ready: primaryLease.datachannel_ready,
    first_frame_at: primaryLease.first_frame_at,
  };
}

export function summarizeIfcReadyJob(
  job: IfcReadyIntakeJob,
  session: ReviewSession | null,
  artifactHealth: ArtifactHealthSnapshot | null = null,
  dataVolatility: "persisted" | "in_memory_volatile" = "in_memory_volatile",
): Record<string, unknown> {
  const expectedStage = session ? expectedStageBinding(session) : null;
  const lifecycle = deriveLifecycleStatus(job);
  return {
    ifc_ready_job_id: job.ifc_ready_job_id,
    status: job.status,
    tenant_id: job.tenant_id,
    project_id: job.project_id,
    project_display_name: job.project_display_name ?? null,
    category: job.category ?? null,
    external_model_version_id: job.external_model_version_id,
    external_conversion_task_id: job.external_conversion_task_id ?? null,
    correlation_id: job.correlation_id,
    source_ifc_ref: maskPresignedRef(job.source_ifc_ref),
    source_ifc_etag: job.source_ifc_etag,
    download_status: job.download_status ?? null,
    download_failure: job.download_failure ?? null,
    artifact_health: artifactHealth ?? job.artifact_health ?? session?.artifact_health ?? null,
    conversion_job_id: job.conversion_job_id,
    conversion_status: job.conversion_status,
    conversion_lifecycle_status: lifecycle,
    conversion_authority: job.conversion_authority,
    // conv-prioritize-retry (cr1 BLOCKER 2):列表端點上 wire queue_position,否則 #conv
    // 透過列表取件時 position 永遠 undefined,插隊鈕 disabled 條件失效。additive,
    // 依規格置於 conversion_authority 之後。
    queue_position: job.queue_position ?? null,
    dispatch_error: job.dispatch_error ?? null,
    callback_outbox_id: job.callback_outbox_id ?? null,
    artifact_manifest_ref: job.artifact_manifest_ref ?? null,
    review_session_id: job.review_session_id ?? null,
    web_view_session_id: job.web_view_session_id ?? null,
    viewer_url: job.viewer_url ?? null,
    expected_stage_url: expectedStage?.url ?? null,
    expected_mapping_url: expectedStage?.mapping_url ?? null,
    // === ifc-ready-api-field-redesign：對帳鍵 + 誠實觀測投影（additive/nullable;既有 26 欄不動）===
    idempotency_key: job.idempotency_key,
    idempotent_replay: job.idempotent_replay,
    ...deriveFailure(job),
    recovery_action: deriveConversionRecoveryAction(job),
    // 誠實（spec §4.6：usdc_role 以 usdc_key 為閂門）：job 端不投影 usdc_key（IfcReadyIntakeJob 無此欄、見「明確排除」;
    // Phase 1 恆缺），Phase 2 由 callback outbox 回填 ledger 後前端由 ledger 讀 parsed → job_output 端恆 pending。
    // 禁用 lifecycle==="ready" 假報 parsed_usdc：真實轉檔完成時 conversion_status→ready 會令 lifecycle→ready,
    // 但 job 端仍無 usdc_key,依 spec §6.3/AC8「禁假 parsed USDC」必須維持 pending（這正是 must_fix 要防的假 ready、且與 ledger 端 r.usdc_key!=null 才顯 parsed 對齊）。
    usdc_role: "pending" as const,
    data_volatility: dataVolatility,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

export function expectedStageBinding(session: ReviewSession): ArtifactBinding | null {
  return session.artifact_bindings
    .filter((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && Boolean(binding.url))
    .slice()
    .sort((left, right) => left.load_order - right.load_order)[0] ?? null;
}
