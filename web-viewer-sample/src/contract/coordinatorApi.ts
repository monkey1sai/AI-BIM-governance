// Coordinator Browser Contract — browser-side view.
//
// Every type here is derived from web-viewer-sample/src/generated/coordinator-api.ts,
// which is generated from tests/contracts/coordinator-browser-api-v1.openapi.json,
// which is emitted from bim-review-coordinator/src/contract (zod). Nothing in this
// file restates a wire shape by hand: response types are indexed by operationId and
// status so that "which route returns this" is decided by the contract, not by a
// human picking a type name.
//
// Regenerate after a contract change:
//   cd bim-review-coordinator && npm run contract:emit
//   cd ../web-viewer-sample && npm run generate:api-types -- --only=bim-review-coordinator
import type { components, operations } from "../generated/coordinator-api";

export type CoordinatorSchemas = components["schemas"];
export type CoordinatorOperationId = keyof operations;

type JsonContent<T> = T extends { content: { "application/json": infer B } } ? B : never;

/** Response body of one operation at one status, e.g. ResponseOf<"getStreamConfig", 200>. */
export type ResponseOf<O extends CoordinatorOperationId, S extends keyof operations[O]["responses"]> =
  JsonContent<operations[O]["responses"][S]>;

/** JSON request body of one operation (caller's view: fields with server defaults are optional). */
export type RequestOf<O extends CoordinatorOperationId> =
  operations[O] extends { requestBody: infer R } ? JsonContent<NonNullable<R>> : never;

// ── Shared vocabulary ───────────────────────────────────────────────────────
export type SessionStatus = CoordinatorSchemas["SessionStatus"];
export type RoutingPolicy = CoordinatorSchemas["RoutingPolicy"];
export type ConversionLedgerStatus = CoordinatorSchemas["ConversionLedgerStatus"];
export type ViewerLeaseRole = CoordinatorSchemas["ViewerLeaseRole"];
export type ViewerLeaseStatus = CoordinatorSchemas["ViewerLeaseStatus"];
export type KitMediaState = CoordinatorSchemas["KitRuntimeHealthEntry"]["media_state"];
export type IfcReadyIntakeStatus = CoordinatorSchemas["IfcReadyIntakeStatus"];
export type FailureStage = CoordinatorSchemas["FailureStage"];
export type ConversionRecoveryAction = CoordinatorSchemas["ConversionRecoveryAction"];

// ── Building blocks ─────────────────────────────────────────────────────────
export type ArtifactHealthSnapshot = CoordinatorSchemas["ArtifactHealthSnapshot"];
export type ArtifactBinding = CoordinatorSchemas["ArtifactBinding"];
export type Artifact = CoordinatorSchemas["Artifact"];
export type KitInstance = CoordinatorSchemas["KitInstance"];
export type KitInstanceBinding = CoordinatorSchemas["KitInstanceBinding"];
export type KitStreamConfig = CoordinatorSchemas["KitStreamConfig"];
export type ReviewParticipant = CoordinatorSchemas["ReviewParticipant"];
export type ConversionQualityMetricsSummary = CoordinatorSchemas["ConversionQualityMetricsSummary"];
export type PublicViewerLease = CoordinatorSchemas["PublicViewerLease"];
export type KitRuntimeHealthEntry = CoordinatorSchemas["KitRuntimeHealthEntry"];
export type StageOpenEvidence = CoordinatorSchemas["StageOpenEvidence"];
export type WireStageComposition = CoordinatorSchemas["WireStageComposition"];
export type WireStageCompositionArtifact = CoordinatorSchemas["WireStageCompositionArtifact"];

// ── Errors ──────────────────────────────────────────────────────────────────
export type DetailError = CoordinatorSchemas["DetailError"];
export type ErrorCodeError = CoordinatorSchemas["ErrorCodeError"];
export type NamedError = CoordinatorSchemas["NamedError"];
export type ValidationError = CoordinatorSchemas["ValidationError"];

// ── Route-bound responses (operationId × status) ────────────────────────────
export type RuntimeStatusResponse = ResponseOf<"getRuntimeStatus", 200>;
export type RuntimeSessionSummary = RuntimeStatusResponse["sessions"]["items"][number];
export type RuntimeKitBinding = RuntimeStatusResponse["kit_instance_bindings"][number];
export type RuntimeIfcReadyJob = RuntimeStatusResponse["ifc_ready_jobs"]["recent"][number];

export type SessionIdlePolicyResponse = ResponseOf<"getSessionIdlePolicy", 200>;
export type SessionIdlePolicyUpdateRequest = RequestOf<"updateSessionIdlePolicy">;

export type ReviewSession = ResponseOf<"getReviewSession", 200>;
export type CreateReviewSessionRequest = RequestOf<"createReviewSession">;
export type CreateReviewSessionBindingInput = NonNullable<CreateReviewSessionRequest["artifact_bindings"]>[number];
export type QueuedForInstanceConflict = CoordinatorSchemas["QueuedForInstanceConflict"];

export type ClosedSessionPage = ResponseOf<"listClosedReviewSessions", 200>;
export type ClosedSessionItem = ClosedSessionPage["items"][number];
export type RecreateSessionResponse = ResponseOf<"recreateReviewSession", 201>;
export type StreamConfigResponse = ResponseOf<"getStreamConfig", 200>;
export type FirstFrameResponse = ResponseOf<"reportFirstFrame", 200>;
export type SessionActivityResponse = ResponseOf<"recordSessionActivity", 200>;
export type SessionIdleStatusResponse = ResponseOf<"getSessionIdleStatus", 200>;
export type IssueSnapshotAccepted = ResponseOf<"enqueueIssueSnapshot", 202>;
export type IssueSnapshotRequest = RequestOf<"enqueueIssueSnapshot">;

export type ClaimViewerLeaseRequest = RequestOf<"claimViewerLease">;
export type ClaimViewerLeaseResponse = ResponseOf<"claimViewerLease", 200>;
export type HeartbeatViewerLeaseRequest = RequestOf<"heartbeatViewerLease">;
export type HeartbeatViewerLeaseResponse = ResponseOf<"heartbeatViewerLease", 200>;
export type ReleaseViewerLeaseResponse = ResponseOf<"releaseViewerLease", 200>;
export type ViewerLeaseStatusResponse = ResponseOf<"getViewerLeaseStatus", 200>;

export type StageBindingPreauthorizationRequest = RequestOf<"preauthorizeStageBinding">;
export type StageBindingPreauthorizationResponse = ResponseOf<"preauthorizeStageBinding", 200>;
export type StageBindingCancellationResponse = ResponseOf<"cancelStageBinding", 200>;

export type A4HandoffCreateRequest = RequestOf<"createA4Handoff">;
export type A4HandoffCreateResponse = ResponseOf<"createA4Handoff", 201>;
export type A4HandoffConsumeResponse = ResponseOf<"consumeA4Handoff", 200>;

export type ConversionRecordsResponse = ResponseOf<"listConversionRecords", 200>;
export type ConversionRecordItem = ConversionRecordsResponse["items"][number];
export type ReadyReviewIntentRequest = RequestOf<"openReadyModelReviewSession">;
export type ReadyReviewSessionResponse = ResponseOf<"openReadyModelReviewSession", 200>;
export type ConversionPrioritizeResponse = ResponseOf<"prioritizeConversionJob", 200>;
export type ConversionRetryResponse = ResponseOf<"retryConversionJob", 200>;
export type ConversionTriggerRequest = RequestOf<"triggerConversion">;
export type ConversionTriggerResponse = ResponseOf<"triggerConversion", 200>;
export type ConversionQualityMetricsResponse = ResponseOf<"getConversionQualityMetrics", 200>;

export type IfcReadyListResponse = ResponseOf<"listIfcReadyJobs", 200>;
export type IfcReadyListItem = IfcReadyListResponse["items"][number];
export type IfcReadyDetailResponse = ResponseOf<"getIfcReadyJob", 200>;
export type IfcReadyReviewSessionOpen = ResponseOf<"openIfcReadyReviewSession", 200>;
export type MinioWatchStatusView = ResponseOf<"getMinioWatchStatus", 200>;
export type MinioObjectsResponse = ResponseOf<"listMinioObjects", 200>;
export type MinioWatcherStatus = CoordinatorSchemas["MinioWatcherStatus"];
export type MinioWatchDisabledStatus = CoordinatorSchemas["MinioWatchDisabledStatus"];
export type MinioObjectView = CoordinatorSchemas["MinioObjectView"];
export type MinioFolderNode = CoordinatorSchemas["MinioFolderNode"];
export type MinioFolderBrowsePayload = CoordinatorSchemas["MinioFolderBrowsePayload"];
export type MinioNotConfiguredListing = CoordinatorSchemas["MinioNotConfiguredListing"];

export type CallbackOutboxSummary = ResponseOf<"getCallbackOutboxSummary", 200>;
export type CallbackOutboxEntry = CallbackOutboxSummary["entries"][number];
