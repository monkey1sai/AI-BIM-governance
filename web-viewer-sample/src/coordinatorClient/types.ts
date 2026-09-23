// Coordinator Browser Client types (docs/architecture/coordinator-browser-client-adr.md). Contract-backed names come from
// src/contract/coordinatorApi.ts; the surfaces outside the contract (/health, /api/dev/*, Kit proxies, SSE) are written by hand.
import type { components as kitManagerComponents } from "../generated/kit-manager-api";
import type { StageBindingPreauthorizationResponse } from "../contract/coordinatorApi";
import type {
  ArtifactHealthSnapshot as ContractArtifactHealthSnapshot,
  CallbackOutboxEntry,
  CallbackOutboxSummary as ContractCallbackOutboxSummary,
  ClaimViewerLeaseResponse,
  ClosedSessionItem,
  ClosedSessionPage,
  ConversionLedgerStatus as ContractConversionLedgerStatus,
  ConversionPrioritizeResponse,
  ConversionQualityMetricsResponse as ContractConversionQualityMetricsResponse,
  ConversionRecordItem,
  ConversionRetryResponse,
  ConversionTriggerResponse,
  CreateReviewSessionBindingInput as ContractCreateReviewSessionBindingInput,
  CreateReviewSessionRequest as ContractCreateReviewSessionRequest,
  IfcReadyDetailResponse,
  IfcReadyListItem as ContractIfcReadyListItem,
  IfcReadyReviewSessionOpen,
  IssueSnapshotAccepted,
  KitMediaState as ContractKitMediaState,
  KitRuntimeHealthEntry as ContractKitRuntimeHealthEntry,
  MinioFolderBrowsePayload,
  MinioFolderNode as ContractMinioFolderNode,
  MinioNotConfiguredListing,
  MinioObjectView,
  MinioWatchDisabledStatus,
  MinioWatcherStatus,
  PublicViewerLease,
  ReadyReviewIntentRequest,
  ReadyReviewSessionResponse as ContractReadyReviewSessionResponse,
  RecreateSessionResponse,
  ReviewSession,
  RuntimeIfcReadyJob as ContractRuntimeIfcReadyJob,
  RuntimeKitBinding as ContractRuntimeKitBinding,
  RuntimeSessionSummary as ContractRuntimeSessionSummary,
  RuntimeStatusResponse,
  SessionIdlePolicyResponse,
  SourceBundleLookupResponse as ContractSourceBundleLookupResponse,
  LineageConversionReport as ContractLineageConversionReport,
  LineageConversionReportDifferences as ContractLineageConversionReportDifferences,
  LineageConversionReportList as ContractLineageConversionReportList,
  LineageDifferenceSet as ContractLineageDifferenceSet,
  StreamConfigResponse as ContractStreamConfigResponse,
  ViewerLeaseRole as ContractViewerLeaseRole,
  ViewerLeaseStatus as ContractViewerLeaseStatus,
} from "../contract/coordinatorApi";

// ── Coordinator Browser Contract：以下名稱保留給既有 call site，定義一律由生成契約推導 ──
// （src/contract/coordinatorApi.ts ← generated/coordinator-api.ts ← tests/contracts/*.openapi.json）。
// 不在契約內的面（/health、/api/dev/*、kit-manager proxy、SSE）仍手寫，見本區塊尾。

export type SessionIdlePolicy = SessionIdlePolicyResponse;
export type ArtifactHealthSnapshot = ContractArtifactHealthSnapshot;
export type RuntimeSessionSummary = ContractRuntimeSessionSummary;
export type ViewerLeaseRole = ContractViewerLeaseRole;
export type ViewerLeaseStatus = ContractViewerLeaseStatus;
export type ViewerLeaseSummary = PublicViewerLease;
export type ViewerLeaseClaimResponse = ClaimViewerLeaseResponse;
export type RuntimeKitBinding = ContractRuntimeKitBinding;
export type RuntimeIfcReadyJob = ContractRuntimeIfcReadyJob;
export type KitMediaState = ContractKitMediaState;
export type KitRuntimeHealthEntry = ContractKitRuntimeHealthEntry;
export type RuntimeStatus = RuntimeStatusResponse;
export type ClosedReviewSessionItem = ClosedSessionItem;
export type ClosedReviewSessionPage = ClosedSessionPage;
export type RecreateReviewSessionResponse = RecreateSessionResponse;
/** 明確意圖（legacy 的空物件不由前端送出）。 */
export type ReadyReviewIntent = Extract<ReadyReviewIntentRequest, { mode: string }>;
export type ReadyReviewSessionResponse = ContractReadyReviewSessionResponse;
export type IfcReadyListItem = ContractIfcReadyListItem;

export type ConversionLifecycleStatus = ContractConversionLedgerStatus;
// 值集由契約型別鎖定：陣列若多列或少列一個值，`satisfies` 與下方完整性斷言即在編譯期失敗。
export const CONVERSION_LIFECYCLE_STATUS_VALUES = ["detected", "queued", "converting", "ready", "failed"] as const satisfies readonly ConversionLifecycleStatus[];
type ConversionLifecycleValuesComplete = ConversionLifecycleStatus extends (typeof CONVERSION_LIFECYCLE_STATUS_VALUES)[number] ? true : never;
export const conversionLifecycleValuesComplete: ConversionLifecycleValuesComplete = true;

/** 契約把 trigger 回應記為上游 passthrough；前端額外依賴 ifc_ready_job_id 存在（消費端假設，非契約保證）。 */
export type TriggerConversionResponse = ConversionTriggerResponse & { ifc_ready_job_id: string };
export type IfcReadyJobDetail = IfcReadyDetailResponse;
export type IfcReadyReviewSessionResponse = IfcReadyReviewSessionOpen;
/** GET /api/external/minio-watch/status 是 enabled/disabled 兩種形狀的 union；此為既有消費端沿用的扁平化視圖。 */
export type MinioWatchStatus =
  & { enabled: boolean }
  & Partial<Omit<MinioWatcherStatus, "enabled">>
  & Partial<Omit<MinioWatchDisabledStatus, "enabled">>;
export type StreamConfigResponse = ContractStreamConfigResponse;
export type ConversionQualityMetricsResponse = ContractConversionQualityMetricsResponse;
export type ConversionControlResponse = ConversionPrioritizeResponse | ConversionRetryResponse;
export type SessionCloseResponse = Pick<ReviewSession, "session_id" | "status">;
export type CreateReviewSessionBindingInput = ContractCreateReviewSessionBindingInput;
export type CreateReviewSessionRequest = ContractCreateReviewSessionRequest;
export type CreateReviewSessionResponse = ReviewSession;
/** 前端顯示用的狀態機；wire 上契約為 string，消費端須自行 narrow。 */
export type CallbackOutboxEntryStatus = "pending" | "delivered" | "dead_letter";
export type CallbackOutboxSummaryEntry = CallbackOutboxEntry;
export type CallbackOutboxSummary = ContractCallbackOutboxSummary;
export type IssueSnapshotResponse = IssueSnapshotAccepted;
export type ConversionLedgerStatus = ContractConversionLedgerStatus;
export type ConversionRecord = ConversionRecordItem;
export type SourceBundleLookupResponse = ContractSourceBundleLookupResponse;
export type LineageConversionReport = ContractLineageConversionReport;
export type LineageConversionReportList = ContractLineageConversionReportList;
export type LineageConversionReportDifferences = ContractLineageConversionReportDifferences;
export type LineageDifferenceSet = ContractLineageDifferenceSet;
export type LineageReportFileName = "alignment_report.json" | "alignment_report.csv";
export type MinioObject = MinioObjectView;
export type MinioFolderNode = ContractMinioFolderNode;
/** getMinioFolder 永遠帶 delimiter=/，回應為 folder 瀏覽或「未設定」兩種之一；此為兩者的扁平化視圖。 */
export type MinioFolderListing =
  & Omit<MinioFolderBrowsePayload, "bucket" | "cache">
  & { bucket: string | null; cache?: MinioFolderBrowsePayload["cache"]; note?: MinioNotConfiguredListing["note"] };

// ── 契約外的面（維持手寫）─────────────────────────────────────────────────

// /health 真實回應形狀（app.ts）。不在 Coordinator Browser Contract 內。
export interface CoordinatorHealth {
  status: string;
  service: string;
  kit_signaling_port: number;
}

// Conversion-service job history pass-through (GET /api/dev/conversions → proxied to conversion service).
// /api/dev/* 不在契約內；shape is a pass-through artifact from an external service; type it loosely.
export interface DevConversionRecord {
  conversion_job_id?: string;
  status?: string;
  source_ifc_filename?: string;
  [k: string]: unknown;
}

export interface DevConversionArtifact {
  artifact_id?: string;
  role?: string;
  url?: string;
  [k: string]: unknown;
}

export interface DevConversionResult {
  status?: string;
  ready?: boolean;
  artifacts?: Record<string, DevConversionArtifact>;
  [k: string]: unknown;
}

// C1 契約收斂（2026-07-21）：KitInstanceState 改由 kit-manager-api openapi 生成型別 alias
// （generated/kit-manager-api.ts，再生成：cd web-viewer-sample && npm run generate:api-types）。
// Drift 註記：openapi 契約僅標 instance_id/status 為 required（pydantic 有 default 的欄位不入
// required），但後端序列化恆帶全部欄位——wire 上實際必存在。故以 Required<> 做最小 local 收緊。
export type KitInstanceState = Required<kitManagerComponents["schemas"]["KitInstanceState"]>;

// GET /api/kit/health 是 coordinator 對 kit-manager /health 的 forward-only proxy；body 由 kit-manager 決定。
export interface KitHealth {
  status?: string;
  [k: string]: unknown;
}

// SSE frame（GET /api/minio/events），非 REST 契約。
export interface MinioChangeEvent {
  type: "minio.changed";
  prefixes: string[];
  reason?: string;
  at: string;
}

// Task 6 chip-patch runtime guard：wire 的寬 string status → ConversionLedgerStatus runtime narrow。
const CONVERSION_LEDGER_STATUSES: readonly ConversionLedgerStatus[] = [
  "detected",
  "queued",
  "converting",
  "ready",
  "failed",
];
export function narrowConversionStatus(status: string): ConversionLedgerStatus | null {
  return (CONVERSION_LEDGER_STATUSES as readonly string[]).includes(status)
    ? (status as ConversionLedgerStatus)
    : null;
}

// ── the viewer's stage binding and session types ─────────────────────────────

export interface StageBindingArtifact {
    artifact_id: string;
    role: "primary" | "secondary";
    load_order: number;
    usdc_url: string;
}

/** 已驗證的 stage binding 預授權：primary 與每個 secondary 都帶 artifact_id 與 usdc_url。 */
export type StageBindingPreauthorization = Omit<StageBindingPreauthorizationResponse, "stage_composition"> & {
    stage_composition: {
        primary: StageBindingArtifact & { role: "primary" };
        secondary_layers: Array<StageBindingArtifact & { role: "secondary" }>;
    };
};

export interface StageBindingRevisions {
    active: string | null;
    lastGood: string | null;
}

export interface StageBindingCredentials {
    userToken: string;
    leaseToken: string;
}
