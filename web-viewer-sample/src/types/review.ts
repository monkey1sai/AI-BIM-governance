import type {
  ArtifactBinding as ContractArtifactBinding,
  ConversionQualityMetricsSummary as ContractConversionQualityMetricsSummary,
  KitInstanceBinding as ContractKitInstanceBinding,
  ReviewSession as ContractReviewSession,
  SessionStatus,
  StreamConfigResponse,
} from "../contract/coordinatorApi";

// Coordinator Browser Contract：viewer 側的 session/stream 型別一律由生成契約推導
// （src/contract/coordinatorApi.ts）。此檔只保留 viewer 私有的補充語意，不再手抄 wire 形狀。

export type ConversionQualityMetricsSummary = ContractConversionQualityMetricsSummary;

// coordinator 的 SessionStatus 只有五個值；其餘為 viewer 私有的 pseudo-state
// （queued_for_instance 來自 409 body、其餘來自 intake/lifecycle 投影），viewer 對 queued 不嘗試 WebRTC。
export type ReviewLifecycleStatus =
    | SessionStatus
    | "blocked_conversion"
    | "queued_for_instance"
    | "queued_for_conversion"
    | "dropped_on_restart";

export type KitInstanceBinding = ContractKitInstanceBinding;

/** viewer 只消費 ReviewSession 的這個子集；status 放寬為 viewer 的 pseudo-state 聯集。 */
export type ReviewSession =
    & Pick<ContractReviewSession,
        | "session_id" | "trace_id" | "review_request_id" | "project_id" | "model_version_id"
        | "created_by" | "artifact_bindings" | "kit_instance_bindings">
    & {
        status: ReviewLifecycleStatus;
        kit_instance: Pick<ContractReviewSession["kit_instance"], "stream_server" | "signaling_port" | "media_server">;
    };

export type ReviewStreamConfig = StreamConfigResponse;

// /api/review-session-requests/* 不在 Coordinator Browser Contract 內（未註冊 route）；維持手寫。
export interface ReviewSessionRequest {
    review_request_id: string;
    requested_by: string;
    tenant_id: string;
    project_id: string;
    model_version_id: string;
    artifact_group_ids: string[];
    selected_artifact_ids: string[];
    startup_policy: Record<string, unknown>;
    kit_profile: Record<string, unknown>;
    status: ReviewLifecycleStatus;
    blocker?: string | null;
    missing_refs?: string[];
    session_id?: string | null;
    artifact_bindings: ContractArtifactBinding[];
    kit_instance_bindings: KitInstanceBinding[];
}
