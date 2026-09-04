/*
 * SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-NvidiaProprietary
 *
 * NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
 * property and proprietary rights in and to this material, related
 * documentation and any modifications thereto. Any use, reproduction,
 * disclosure or distribution of this material and related documentation
 * without an express license agreement from NVIDIA CORPORATION or
 * its affiliates is strictly prohibited.
 */
import React from 'react';
import './App.css';
import AppStream from './AppStream'; // Ensure .tsx extension if needed
import StreamConfig from '../stream.config.json';
import USDAsset from "./USDAsset";
import USDStage from "./USDStage";
import { headerHeight } from './App';
import { fetchUSDAssets, type USDAsset as USDAssetType } from './assetsApi';
import DemoControlPanel from "./components/DemoControlPanel";
import { StructuredLogDiagnostics } from "./components/StructuredLogDiagnostics";
import { isBlockedLifecycle, lifecycleStatusText, sameStreamEndpoint, sameStreamTransportEndpoint, selectSpectatorBinding, type StreamEndpoint } from "./utils/windowHelpers";
// viewer-edge-bim-server-console:ReviewLauncher / PresencePanel 已刪(fast
// MVP 不需多人協作 UI;spec REMOVED「Viewer separates runtime commands from
// collaboration events」)。
import { BimControlClient } from "./clients/bimControlClient";
import { CoordinatorClient, CoordinatorHttpError, isQueuedForInstanceError } from "./clients/coordinatorClient";
import { viewerLeaseHeartbeatDelayMs } from "./clients/viewerLeaseHeartbeat";
import {
    connectReviewSocket,
    type ReviewSocketAck,
    type ReviewSocketCandidate,
    type ReviewSocketClient,
    type ReviewSocketEvent,
    type ReviewSocketHandlers,
} from "./clients/reviewSocket";
import { buildAuthorizedOpenStageRequest, buildClearHighlightRequest, buildFocusPrimRequest, buildGetChildrenRequest, buildHighlightPrimsRequest, buildLoadingStateQuery, buildOpenStageRequest } from "./clients/streamMessages";
import {
    A4_HANDOFF_COMMAND_TIMEOUT_MS,
    a4ServerAuthorityBlockReason,
    buildA4HandoffCommand,
    evaluateA4LocalAuthority,
    type A4HandoffAction,
    type A4HandoffIntent,
} from "./clients/a4Handoff";
import { demoPrimPath } from "./clients/demoDefaults";
import { allowedCoordinatorOrigins, reviewEnv } from "./config/env";
import { canHandleHighlight, failedElementsForEmbed, shouldAcceptParentMessage } from "./parentMessageGuard";
import { harnessAuthorityRequired, harnessEnabled } from "./harness/harnessConfig";
import { connectHarnessReviewSocket } from "./harness/fakeReviewSocket";
import {
    HARNESS_REVIEW_AUTHORITY,
    HARNESS_SESSION_ID,
    HARNESS_TRACE_ID,
} from "./harness/fixtures/reviewAuthority";
import { HARNESS_STAGE_URL } from "./harness/fixtures/usdStageTree";
import { computeFileReady, computeRuntimeReady, computeSemanticReady } from "./utils/triReady";
import type { DemoLogEntry } from "./types/demo";
import { mappingVerificationBlockReason, type ElementMappingDocument, type ElementMappingItem, type ElementMappingSummary } from "./types/mapping";
import type { ArtifactBinding, ReviewArtifact } from "./types/artifacts";
import type { ReviewLifecycleStatus, ReviewSession, ReviewSessionRequest, ReviewStreamConfig } from "./types/review";
import type { HighlightItem, StreamMessage } from "./types/streamMessages";
import type { ViewerLogDeliveryAuthority } from "./lib/structLog";
import { traceIdFromSearch } from "./lib/structLogBootstrap";
// 統一治理控制台 MVP：A1–A10 治理 overlay 疊在 primary viewer live 3D 上（client 主動拉，不 server-push）。
import { GovernanceOverlay, type RuleCheckState, type IssueCreateState, type StageArtifactBinding, type BindingApplyState } from "./console/GovernanceOverlay";
import { deriveOverlayInputs } from "./console/governance/windowOverlayGlue";
import { HighlightBridge, type FailedElement, type HighlightManyResult, type HighlightResult } from "./console/governance/highlightBridge";
import { MappingCache } from "./console/governance/mappingCache";
import { MockViewport } from "./console/viewer/MockViewport";
import { SessionIdleCountdownBanner } from "./console/viewer/SessionIdleCountdownBanner";
import "./console/viewer/viewer.css";
import { evaluateCoverageGate } from "./console/governance/govEndpoints";
// 統一治理控制台 MVP（W1/W3）：A3 rule-run / A8 issue / BCF 都打 coordinator :8004 的 /api/governance/* proxy。
import { governanceClient, type RuleResultRow, type RuleRunStatus } from "./console/governanceClient";
import { t } from "./console/i18n";


interface USDPrimType {
    name?: string;
    path: string;
    children?: USDPrimType[];
}

export interface AppProps {
    sessionId: string
    backendUrl: string
    signalingserver: string
    signalingport: number
    mediaserver: string
    mediaport: number | undefined
    accessToken: string
    onStreamFailed: () => void;
}

interface AppState {
    usdAssets: USDAssetType[];
    selectedUSDAsset: USDAssetType | null;
    reviewSessionId: string | null;
    reviewRequestId: string | null;
    // viewer-edge-bim-server-console:TopBar 用 project / version identity。
    // 來源 = ReviewSession.project_id / model_version_id(BIM control schema);
    // 缺失時 TopBar 顯示「未取得」placeholder,不偽宣告。
    currentProjectId: string | null;
    currentModelVersionId: string | null;
    reviewLifecycleStatus: ReviewLifecycleStatus | null;
    reviewStatus: string;
    reviewArtifacts: ReviewArtifact[];
    reviewEvents: string[];
    latestStreamConfig: ReviewStreamConfig | null;
    mappingUrl: string | null;
    mappingStatus: string;
    mappingSummary: ElementMappingSummary | null;
    mappingItems: ElementMappingItem[];
    selectedMappingIndex: number;
    lastMappingVerification: string | null;
    mappingVerificationBlockedReason: string | null;
    demoOutgoingMessages: DemoLogEntry[];
    demoIncomingMessages: DemoLogEntry[];
    usdPrims: USDPrimType[];
    selectedUSDPrims: Set<USDPrimType>;
    isKitReady: boolean;
    showStream: boolean;
    // 統一治理控制台 MVP：治理失敗構件（A3 rule-run 失敗）餵給 overlay 在 3D 標紅；初期空陣列（誠實，無假資料）。
    govFailedElements?: FailedElement[];
    // W1：A3 rule-run id + 執行狀態（idle/running/succeeded/failed/error）。
    govRuleRunId?: string;
    govRuleCheck?: RuleCheckState;
    // W2：Kit 非同步回傳的標示確認（key=ifc_guid → 誠實確認文案）。
    govHighlightConfirm?: Record<string, string>;
    // W3：A8 從 rule-run 開 issue 的結果。
    govIssueCreate?: IssueCreateState;
    // W4：點 live 3D 構件反查到的 ifc_guid（帶進治理）。
    govSelectedGuid?: string | null;
    // CH-F：Stage / Artifact Binding 狀態（active / last-good revision + 套用交易狀態）。
    govBindingActiveRevision?: string | null;
    govBindingLastGoodRevision?: string | null;
    govBindingApplyState?: BindingApplyState;
    // 完整問題分頁：viewer 分頁（模型=語意檢視 / 問題=治理操作全幅）。
    viewerTab: "model" | "issues";
    showUI: boolean;
    isLoading: boolean;
    loadingText: string; 
    streamDiagnostic: string | null;
    expectedStageUrl: string | null;
    loadedStageUrl: string | null;
    stageLoadStatus: "unproven" | "pending" | "matched" | "mismatch" | "disconnected";
    runtimeCommandRejection: RuntimeCommandRejection | null;
    runtimeCommandLifecycles: RuntimeCommandLifecycle[];
    a4Handoff: A4HandoffViewState;
    webrtcLifecycleStatus: "initializing" | "started" | "stopped" | "terminated" | "failed";
    activeStreamEndpoint: StreamEndpoint;
    streamMountKey: number;
    idleCountdownRemainingSeconds: number | null;
    idleClosedReason: string | null;
}

interface StandaloneViewerLease {
    lease_id: string;
    lease_token: string;
    role: "primary" | "spectator";
    expires_at: string;
    heartbeat_after_ms: number;
}

interface AppStreamMessageType {
    event_type: string;
    payload: unknown;
}

const runtimeMutatingEvents = new Set([
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "highlightPrimsRequest",
    "focusPrimRequest",
    "clearHighlightRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
]);

const viewerToKitEventTypes = new Set([
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "highlightPrimsRequest",
    "focusPrimRequest",
    "clearHighlightRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
    "loadingStateQuery",
    "getChildrenRequest",
]);

const kitToViewerEventTypes = new Set([
    "openedStageResult",
    "loadArtifactGroupResult",
    "highlightPrimsResult",
    "focusPrimResult",
    "selectPrimsResult",
    "makePrimsPickableResponse",
    "resetStageResponse",
    "clearHighlightResult",
    "loadingStateResponse",
    "getChildrenResponse",
    "stageSelectionChanged",
    "updateProgressAmount",
    "updateProgressActivity",
    "bindingApplied",
    "commandRejected",
]);

const runtimeResponseRequestTypes = new Map<string, ReadonlySet<string>>([
    ["openedStageResult", new Set(["openStageRequest", "loadArtifactGroupRequest"])],
    ["loadArtifactGroupResult", new Set(["loadArtifactGroupRequest", "composeStageRequest"])],
    ["bindingApplied", new Set(["loadArtifactGroupRequest", "composeStageRequest"])],
    ["highlightPrimsResult", new Set(["highlightPrimsRequest"])],
    ["focusPrimResult", new Set(["focusPrimRequest"])],
    ["clearHighlightResult", new Set(["clearHighlightRequest"])],
    ["selectPrimsResult", new Set(["selectPrimsRequest"])],
    ["makePrimsPickableResponse", new Set(["makePrimsPickable"])],
    ["resetStageResponse", new Set(["resetStage"])],
]);

const simpleRuntimeTerminalEvents = new Set([
    "clearHighlightResult",
    "selectPrimsResult",
    "makePrimsPickableResponse",
    "resetStageResponse",
]);

interface AppStreamEventType {
    event_type?: string;
    messageRecipient?: string;
    data?: string;
    payload?: unknown;
}

interface VerifiedDataChannelAuthority {
    sessionId: string;
    traceId: string;
    connectionGeneration: number;
}

const runtimeRejectionReasons = new Set([
    "spectator_readonly",
    "lease_invalid",
    "session_lifecycle_blocked",
    "unauthorized_source_client",
    "unsupported_command",
    "invalid_payload",
] as const);

type RuntimeRejectionReason =
    | "spectator_readonly"
    | "lease_invalid"
    | "session_lifecycle_blocked"
    | "unauthorized_source_client"
    | "unsupported_command"
    | "invalid_payload";

type LocalizedCopy = Readonly<{ zh: string; en: string }>;

const runtimeRejectionReasonCopy: Readonly<Record<RuntimeRejectionReason, LocalizedCopy>> = {
    spectator_readonly: {
        zh: "目前為僅檢視模式，無法執行此操作",
        en: "This action is unavailable in read-only spectator mode.",
    },
    lease_invalid: {
        zh: "檢視者 lease 無效或已過期",
        en: "The viewer lease is invalid or has expired.",
    },
    session_lifecycle_blocked: {
        zh: "目前 session 狀態不允許此操作",
        en: "The current session state does not allow this action.",
    },
    unauthorized_source_client: {
        zh: "目前來源無權執行此操作",
        en: "The current source is not authorized to perform this action.",
    },
    unsupported_command: {
        zh: "目前 runtime 不支援此操作",
        en: "The current runtime does not support this action.",
    },
    invalid_payload: {
        zh: "操作資料無效，未執行任何變更",
        en: "The command data is invalid; no change was performed.",
    },
};

const runtimeRejectionPresentation = {
    title: {
        zh: "執行階段命令遭拒絕",
        en: "Runtime command rejected",
    },
    authorityUnavailable: {
        zh: "操作授權服務暫時不可用",
        en: "The operation authority service is temporarily unavailable.",
    },
    authorityUnavailableDetail: {
        zh: "請稍後重新執行原操作，系統不會重播舊 transaction。",
        en: "Retry the original action later; the system will not replay an old transaction.",
    },
    stageUnproven: {
        zh: "stage 已變更但尚未由 coordinator 證實",
        en: "The stage changed but is not yet confirmed.",
    },
    stageUnprovenDetail: {
        zh: "handoff 已阻擋。",
        en: "Handoff is blocked.",
    },
    retryable: {
        zh: "可安全重試原操作",
        en: "You can safely retry the original action.",
    },
    doNotRetry: {
        zh: "請勿盲目重試",
        en: "Do not retry blindly.",
    },
    resync: {
        zh: "重新同步 stage proof",
        en: "Resync stage proof",
    },
} as const satisfies Record<string, LocalizedCopy>;

const runtimeRejectionReviewCopy = {
    malformed: {
        zh: "忽略格式錯誤的 commandRejected",
        en: "Ignored malformed commandRejected.",
    },
    duplicate: {
        zh: "忽略重複的 commandRejected 終態事件",
        en: "Ignored duplicate commandRejected terminal.",
    },
    requestContextMismatch: {
        zh: "忽略 commandRejected：被拒絕的事件與請求內容不相符",
        en: "Ignored commandRejected: rejected event does not match the request context.",
    },
    changedUnconfirmed: {
        zh: "執行階段已變更但尚未確認；已阻擋重試與交接",
        en: "The runtime changed but is unconfirmed; retry and handoff are blocked.",
    },
    rejectedVerb: {
        zh: "已遭拒絕",
        en: "was rejected",
    },
    stageLoadRejected: {
        zh: "模型載入遭拒",
        en: "Model loading was rejected",
    },
} as const satisfies Record<string, LocalizedCopy>;

const stageLoadTimeoutPresentation = {
    title: {
        zh: "模型載入逾時",
        en: "Model loading timed out",
    },
    target: {
        zh: "目標",
        en: "Target",
    },
    diagnostic: {
        zh: "診斷",
        en: "Diagnostic",
    },
    lastState: {
        zh: "最後狀態",
        en: "Last state",
    },
    missingCompletion: {
        zh: "Kit 已連線但沒有回報模型載入完成，請檢查該 USDC 是否可由 Kit 開啟。",
        en: "Kit is connected but did not report model loading as complete. Verify that Kit can open this USDC.",
    },
} as const satisfies Record<string, LocalizedCopy>;

const stageLoadFailurePresentation = {
    title: { zh: "模型載入失敗", en: "Model loading failed" },
    target: { zh: "目標", en: "Target" },
    error: { zh: "錯誤", en: "Error" },
    revisionMismatch: { zh: "Stage authorization 不符", en: "Stage authorization mismatch" },
    expectedRevision: { zh: "預期 revision", en: "Expected revision" },
    receivedRevision: { zh: "收到 revision", en: "Received revision" },
    authorizationFailed: {
        zh: "無法建立 stage binding authorization，已阻擋載入指令",
        en: "Could not create stage binding authorization; the stage-load command was blocked.",
    },
    authorizationTimedOut: {
        zh: "等待 stage binding authorization 逾時；尚未向 Kit 送出載入指令",
        en: "Stage binding authorization timed out before a load command was sent to Kit.",
    },
    commandNotSent: {
        zh: "Kit 尚未接受載入指令；本次模型載入已終止",
        en: "Kit did not accept the load command; this model load was terminated.",
    },
    missingUrl: { zh: "模型載入狀態未回傳 URL", en: "Stage loading state did not report a URL" },
    missingStageEvidence: {
        zh: "Kit 成功回應未附載入 URL；缺少 stage 完成證據",
        en: "Kit reported success without a loaded URL; stage completion evidence is missing.",
    },
    invalidStage: { zh: "模型載入狀態不符合目前清單", en: "Stage loading state does not match the current artifact list" },
    kitReported: { zh: "Kit 回報", en: "Kit reported" },
    currentSelection: { zh: "目前選擇", en: "Current selection" },
} as const satisfies Record<string, LocalizedCopy>;

function runtimeRejectionReviewEvent(rejectedEventType: string, reason: string): string {
    return `${rejectedEventType} ${t(
        runtimeRejectionReviewCopy.rejectedVerb.zh,
        runtimeRejectionReviewCopy.rejectedVerb.en,
    )}${t("：", ": ")}${reason}`;
}

interface RuntimeCommandRejection {
    rejected_event_type: string;
    reason: RuntimeRejectionReason;
    request_id?: string;
    rejection_id?: string;
    retryable: boolean;
    runtime_state: "unchanged" | "changed_unconfirmed";
    detail_code?: string;
    binding_revision_id?: string;
}

type RuntimeCommandPhase = "pending" | "executing" | "terminal";
type RuntimeCommandOutcome = "success" | "rejected" | "error" | "timed-out" | "superseded";

interface RuntimeCommandLifecycle {
    request_id: string;
    event_type: string;
    phases: RuntimeCommandPhase[];
    outcome?: RuntimeCommandOutcome;
}

interface RuntimeCommandContext {
    eventType: string;
    bindingRevisionId?: string;
    stageUrl?: string;
    stageAttemptGeneration?: number;
}

type StageAttemptStatus = "pending" | "provisional" | "terminal" | "completed";

interface StageAttempt {
    generation: number;
    status: StageAttemptStatus;
    targetUrl: string;
    terminalReason?: "stage-load-timeout";
    // An exact current openedStageResult may re-key an older blocked revision
    // for one authenticated status recovery; URL equality alone never does.
    statusResyncRevision?: string;
}

const STAGE_AUTHORIZATION_TIMEOUT_MS = 45_000;
const STAGE_AUTHORIZATION_CANCEL_TIMEOUT_MS = 5_000;
const STAGE_LOAD_TIMEOUT_MS = 45_000;
const STREAM_CONFIG_REFRESH_INTERVAL_MS = 3_000;
const IDLE_ACTIVITY_TRANSPORT_TIMEOUT_MS = 1_000;
// Let the user-facing proof deadline claim the terminal result first. The
// SDK slot watchdog runs immediately after it and only fences lifecycle reuse.
const NATIVE_OPEN_STAGE_SLOT_TIMEOUT_MS = STAGE_LOAD_TIMEOUT_MS + 1;

interface NativeOpenStageDispatch {
    token: number;
    outgoing: AppStreamMessageType | StreamMessage;
    streamGeneration: number;
    stageAttemptGeneration?: number;
    targetUrl: string;
    requestId: string;
    bindingRevisionId: string;
    // openStageRequest resolves through the SDK Promise callback. The SDK
    // treats loadArtifactGroupRequest as an unknown command and acknowledges
    // its send immediately, so that slot is released only by its correlated
    // DataChannel terminal (openedStageResult / commandRejected).
    settlesFromDataChannel: boolean;
    onDispatched?: () => void;
}

interface RuntimeCommandCorrelation {
    requestId: string;
    context?: RuntimeCommandContext;
    disposition: "matched" | "untracked" | "uncorrelated" | "duplicate" | "mismatch";
    mismatchReason?: "event_type" | "binding_revision";
}

type A4HandoffStatus = "idle" | "pending" | "succeeded" | "rejected" | "timed-out";
type A4HandoffPhase = "idle" | "waiting-session" | "consuming" | "waiting-readiness" | "revalidating" | "command-pending" | "terminal";

interface A4HandoffViewState {
    status: A4HandoffStatus;
    phase: A4HandoffPhase;
    handoff_id: string | null;
    action: A4HandoffAction | null;
    request_id: string | null;
    retry_of_request_id: string | null;
    detail: string | null;
    retryable: boolean;
}

interface StageBindingArtifact {
    artifact_id: string;
    role: "primary" | "secondary";
    load_order: number;
    usdc_url: string;
}

interface StageBindingPreauthorization {
    status: "pending";
    session_id: string;
    stage_binding_authorization_id: string;
    binding_revision_id: string;
    stage_composition: {
        primary: StageBindingArtifact & { role: "primary" };
        secondary_layers: Array<StageBindingArtifact & { role: "secondary" }>;
    };
    pending_expires_at: string;
}

interface ActiveStagePreauthorization {
    clientRequestId: string;
    controller: AbortController;
    postStarted: boolean;
    cancellationPromise: Promise<boolean> | null;
}

interface StagePreauthorizationCancellationBarrier {
    request: ActiveStagePreauthorization;
    promise: Promise<boolean>;
    status: "pending" | "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isRuntimeMutator(eventType: string): boolean {
    return runtimeMutatingEvents.has(eventType);
}

function isSensitiveDiagnosticKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalized.includes("token")
        || normalized.includes("authorization")
        || normalized.includes("credential")
        || normalized.includes("secret")
        || normalized === "cookie"
        || normalized === "setcookie"
        || normalized === "rawresponse"
        || normalized === "responsebody"
        || normalized === "upstreamresponse"
        || normalized === "upstreambody"
        || normalized === "rawbody"
        || normalized === "data";
}

function redactDiagnosticValue(
    value: unknown,
    depth = 0,
    seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
    if (depth > 8) return "[truncated]";
    if (typeof value === "string") return redactRuntimeDiagnosticText(value);
    if (Array.isArray(value)) {
        if (seen.has(value)) return "[circular]";
        seen.add(value);
        return value.slice(0, 200).map((item) => redactDiagnosticValue(item, depth + 1, seen));
    }
    if (!isRecord(value)) return value;
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, 200)) {
        redacted[key] = isSensitiveDiagnosticKey(key)
            ? "[redacted]"
            : redactDiagnosticValue(child, depth + 1, seen);
    }
    return redacted;
}

function redactStreamPayload(payload: unknown): unknown {
    return redactDiagnosticValue(payload);
}

function isSafeMachineField(value: string, maxLength = 128): boolean {
    return value.length > 0
        && value.length <= maxLength
        && /^[A-Za-z0-9_.:-]+$/.test(value);
}

// VG-01（Important #2）：parent postMessage 的 highlight item 執行期形狀守衛。
// 跨 origin 反序列化的 payload 不可信，最低要求是物件且帶字串 ifc_guid，才當作合法 FailedElement。
function isHighlightItem(value: unknown): value is FailedElement {
    return isRecord(value) && typeof value.ifc_guid === "string";
}

function getPayloadString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === "string" ? value : "";
}

function getPayloadStringArray(payload: Record<string, unknown>, key: string): string[] {
    const value = payload[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getPayloadObjectArray(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
    const value = payload[key];
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
}

let runtimeRequestSequence = 0;
let stageBindingPreauthorizationSequence = 0;

function createRuntimeRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `cmd_${uuid}`;
    runtimeRequestSequence += 1;
    return `cmd_${Date.now().toString(36)}_${runtimeRequestSequence.toString(36)}`;
}

function createStageBindingPreauthorizationRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `stage_preauth_${uuid}`;
    stageBindingPreauthorizationSequence += 1;
    return `stage_preauth_${Date.now().toString(36)}_${stageBindingPreauthorizationSequence.toString(36)}`;
}

function parseRuntimeCommandRejection(payload: Record<string, unknown>): RuntimeCommandRejection | null {
    const reason = getPayloadString(payload, "reason");
    const runtimeState = getPayloadString(payload, "runtime_state");
    const rejectedEventType = getPayloadString(payload, "rejected_event_type");
    const requestId = getPayloadString(payload, "request_id");
    const rejectionId = getPayloadString(payload, "rejection_id");
    if (
        !runtimeRejectionReasons.has(reason as RuntimeRejectionReason)
        || (runtimeState !== "unchanged" && runtimeState !== "changed_unconfirmed")
        || !isRuntimeMutator(rejectedEventType)
        || typeof payload.retryable !== "boolean"
        || (Boolean(requestId) === Boolean(rejectionId))
        || (requestId ? !isSafeMachineField(requestId) : false)
        || (rejectionId ? !isSafeMachineField(rejectionId) : false)
    ) {
        return null;
    }
    const detailCode = getPayloadString(payload, "detail_code");
    if (detailCode && !isSafeMachineField(detailCode, 64)) return null;
    return {
        rejected_event_type: rejectedEventType,
        reason: reason as RuntimeRejectionReason,
        ...(requestId ? { request_id: requestId } : {}),
        ...(rejectionId ? { rejection_id: rejectionId } : {}),
        retryable: payload.retryable,
        runtime_state: runtimeState,
        ...(detailCode ? { detail_code: detailCode } : {}),
    };
}

function isNvidiaOpenStageEvent(result: Record<string, unknown>): boolean {
    // SDK 5.18.2 fromStageOpenedEvent() maps Kit's StageOpenedEvent to this
    // concrete wrapper shape. Requiring every stable field keeps arbitrary
    // trace-less AppStream results fail-closed. Only success is promoted to
    // success below; every other concrete status is a terminal failure.
    return result.action === "message"
        && typeof result.url === "string"
        && result.url.length > 0
        && typeof result.info === "string"
        && typeof result.status === "string";
}

function requestUsesNativeOpenedStageResult(requestEventType: string): boolean {
    // Both stage commands can produce Kit's openedStageResult. NVIDIA SDK
    // resolves openStageRequest from its callback map, while its unknown
    // loadArtifactGroupRequest gets only an immediate generic ACK; they still
    // share one per-lifecycle slot so neither result can be misattributed.
    return requestEventType === "openStageRequest"
        || requestEventType === "loadArtifactGroupRequest";
}

// #783：outbound trace 只能補給「形狀正確」的 native 成功回應。欄位名對齊 SDK
// LogFormatter.fromLoadingStateEvent / fromGetChildrenEvent 的產出；值域對齊
// tests/contracts/kit-datachannel-v1.schema.json（loadingStateResponse.loading_state 只准
// idle|busy；getChildrenResponse.children 每個元素都必須是物件）。任何不在契約內的值
// 都不得被補上 trace 後放進 _handleCustomEvent——那條路會直接改 isKitReady / usdPrims。
const NATIVE_LOADING_STATES: ReadonlySet<string> = new Set(["idle", "busy"]);

function isExpectedNativeResult(
    requestEventType: string,
    result: Record<string, unknown>,
    requestPayload: Record<string, unknown>,
): boolean {
    if (getPayloadString(result, "status") !== "success") return false;
    if (requestEventType === "loadingStateQuery") {
        return typeof result.loadingState === "string" && NATIVE_LOADING_STATES.has(result.loadingState);
    }
    if (requestEventType === "getChildrenRequest") {
        // 回應必須答的是**這一次**請求的節點：primPath 逐字等於 outbound prim_path。
        // 這同時擋掉切換模型後遲到的舊 stage 回應被當成新樹的 root 回應（review P2）。
        const requestedPrimPath = getPayloadString(requestPayload, "prim_path");
        return typeof result.primPath === "string"
            && requestedPrimPath !== ""
            && result.primPath === requestedPrimPath
            && Array.isArray(result.children)
            && result.children.every(isNativeChildPrimRecord);
    }
    return false;
}

// 契約 `children.items: object` 排除陣列；handler 之後會把元素當 USDPrimType 用、
// _makePickable 直接取 `prim.path`、USDStage 展開節點時再遞迴讀 `children`，所以這裡要求
// 「非陣列物件、path 為字串，且巢狀 children 若存在也必須是同樣合法的陣列」；
// 不讓 `[[]]`、缺 path、或 `{ children: [null] }` 這類元素被補上 trace 後進 handler。
function isNativeChildPrimRecord(value: unknown, depth = 0): boolean {
    if (!isRecord(value) || Array.isArray(value) || typeof value.path !== "string") return false;
    if (!Object.prototype.hasOwnProperty.call(value, "children")) return true;
    // 深度上限只防惡意／損壞的超深巢狀把驗證拖垮；正常 lazy-load 回應只帶一層。
    if (depth >= 32) return false;
    return Array.isArray(value.children)
        && value.children.every((child) => isNativeChildPrimRecord(child, depth + 1));
}

// USD 的 pseudo-root `/` 與本 viewer 的預設 root `/World` 都視為 root 請求：
// stage_management 明確支援對 `/` 回傳頂層子節點，handler 對 root 也是整棵樹重建。
const NATIVE_ROOT_PRIM_PATHS: ReadonlySet<string> = new Set(["/", "/World"]);

function appStreamResultToAppEvent(
    requestEventType: string,
    result: unknown,
    requestPayload?: unknown,
    allowNativeOpenStageFallback = false,
): AppStreamEventType | null {
    if (!isRecord(result)) return null;
    const requestPayloadRecord: Record<string, unknown> = isRecord(requestPayload) ? requestPayload : {};

    if (requestUsesNativeOpenedStageResult(requestEventType)) {
        // A production AppStreamer OpenStageEvent has no data-channel
        // correlation at all. Any partial native correlation is ambiguous and
        // must not be completed by mixing in outbound fields. A trace-less
        // fallback is only safe while the per-lifecycle single-flight slot is
        // current, and only when the complete native wrapper matches the
        // exact outbound target and authority tuple.
        const outboundTraceId = getPayloadString(requestPayloadRecord, "trace_id");
        const outboundRequestId = getPayloadString(requestPayloadRecord, "request_id");
        const outboundBindingRevisionId = getPayloadString(requestPayloadRecord, "binding_revision_id");
        const hasInboundCorrelation = ["trace_id", "request_id", "binding_revision_id"]
            .some((key) => Object.prototype.hasOwnProperty.call(result, key));
        const nativeOpenStageResponse = !hasInboundCorrelation
            && allowNativeOpenStageFallback
            && isNvidiaOpenStageEvent(result);

        if (hasInboundCorrelation) {
            if (
                !outboundTraceId
                || !outboundRequestId
                || getPayloadString(result, "trace_id") !== outboundTraceId
                || getPayloadString(result, "request_id") !== outboundRequestId
                || (
                    outboundBindingRevisionId
                        ? getPayloadString(result, "binding_revision_id") !== outboundBindingRevisionId
                        : Object.prototype.hasOwnProperty.call(result, "binding_revision_id")
                )
            ) return null;
        } else if (
            !nativeOpenStageResponse
            || !outboundTraceId
            || !outboundRequestId
            || !outboundBindingRevisionId
            || getPayloadString(result, "url") !== getPayloadString(requestPayloadRecord, "url")
        ) {
            return null;
        }

        const status = getPayloadString(result, "status");
        const info = getPayloadString(result, "info");
        // The SDK treats loadArtifactGroupRequest as an unknown custom
        // command. Its returned wrapper is only an immediate transport ACK;
        // the authenticated DataChannel terminal carries changed_failed and
        // must remain the sole completion authority for this transaction.
        if (nativeOpenStageResponse && requestEventType === "loadArtifactGroupRequest") return null;

        const responseResult = status === "success" ? "success" : "error";
        return {
            event_type: "openedStageResult",
            payload: {
                trace_id: outboundTraceId,
                result: responseResult,
                url: getPayloadString(result, "url"),
                error: responseResult === "error" ? info || [requestEventType, status || "failed"].join(" ") : "",
                request_id: outboundRequestId,
                ...(outboundBindingRevisionId ? { binding_revision_id: outboundBindingRevisionId } : {}),
            },
        };
    }

    // #783：SDK 對 native 指令（loadingStateQuery / getChildrenRequest）會自己攔下 Kit 的
    // 同名回應，並以 fromLoadingStateEvent / fromGetChildrenEvent 重組成
    // `{ action, status, info, loadingState|primPath, url|children }` 後 resolve 這個 promise
    // ——**trace_id 在這一步被 SDK 剝掉**（Kit 端確實有送，同 payload 換名探針逐則到達）。
    // 之前只認 result.trace_id，等於把每一則正常回應都靜默丟掉：isKitReady 永遠 false、
    // 永不送 openStageRequest、3D 全黑（181 與本機皆重現）。
    // 這裡改用送出時由 _withVerifiedDataChannelTrace 寫入、且已對照 authority 驗證過的
    // outbound trace_id；SDK 的 native callback map 保證此 result 就是該次請求的回應。
    // 兩道守門（review P2）：
    //   (1) result 若「帶有」trace_id 屬性但值為空／null／非字串，是明確損壞的 correlation
    //       carrier，必須 fail closed，不得用 outbound 補位（帶錯值的 trace 本來就會被拒）。
    //   (2) 只有 result 長得像該指令預期的 native 回應（status=success 且帶請求專屬欄位）
    //       才允許補位；SDK 對 warning／error／generic ACK 也會 resolve 同一個 promise，
    //       那些不得被補上 trace 後當成合法回應放進 _handleCustomEvent。
    const hasInboundTrace = Object.prototype.hasOwnProperty.call(result, "trace_id");
    const inboundTraceId = getPayloadString(result, "trace_id");
    if (hasInboundTrace && !inboundTraceId) return null;
    const traceId = inboundTraceId
        || (isExpectedNativeResult(requestEventType, result, requestPayloadRecord)
            ? getPayloadString(requestPayloadRecord, "trace_id")
            : "");
    if (!traceId) return null;

    if (requestEventType === "loadingStateQuery") {
        return {
            event_type: "loadingStateResponse",
            payload: {
                trace_id: traceId,
                loading_state: getPayloadString(result, "loadingState"),
                url: getPayloadString(result, "url"),
            },
        };
    }

    if (requestEventType === "getChildrenRequest") {
        return {
            event_type: "getChildrenResponse",
            payload: {
                trace_id: traceId,
                prim_path: getPayloadString(result, "primPath"),
                children: Array.isArray(result.children) ? result.children : [],
            },
        };
    }

    return null;
}

function isElementMappingDocument(value: unknown): value is ElementMappingDocument {
    return isRecord(value) && (Array.isArray(value.items) || isRecord(value.summary));
}

function getQueryParam(...names: string[]): string | null {
    const params = new URLSearchParams(window.location.search);
    for (const name of names) {
        const value = params.get(name);
        if (value && value.trim().length > 0) return value.trim();
    }
    return null;
}

function getQueryPort(...names: string[]): number | null {
    const value = getQueryParam(...names);
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function isSpectatorStreamMode(): boolean {
    const mode = getQueryParam("streamRole", "stream_role", "viewerMode", "viewer_mode");
    return mode?.toLowerCase() === "spectator" || mode?.toLowerCase() === "view_only";
}

// viewer-edge-bim-server-console:`?debug=1` 控制 legacy USDAsset 下拉、
// USDStage tree、DemoControlPanel debug 區段是否渲染。預設(無 query)
// 主畫面收斂為 Edge BIM Data Server Console;debug 等價於把 Inspector ④
// 「技術細節」展開。
function isDebugQueryEnabled(): boolean {
    const params = new URLSearchParams(window.location.search);
    return params.get("debug") === "1";
}

function hasDirectStreamEndpointOverride(): boolean {
    const params = new URLSearchParams(window.location.search);
    return params.has("signalingPort") || params.has("signalingport") || params.has("mediaPort") || params.has("mediaport");
}

function resolveInitialStreamEndpoint(props: AppProps): StreamEndpoint {
    return {
        kitInstanceId: getQueryParam("kitInstanceId", "kit_instance_id"),
        signalingserver: getQueryParam("signalingServer", "signalingserver") || props.signalingserver || StreamConfig.local.server,
        signalingport: getQueryPort("signalingPort", "signalingport") || props.signalingport || StreamConfig.local.signalingPort,
        mediaserver: getQueryParam("mediaServer", "mediaserver") || props.mediaserver || StreamConfig.local.server,
        mediaport: getQueryPort("mediaPort", "mediaport") ?? props.mediaport ?? StreamConfig.local.mediaPort ?? undefined,
    };
}

function streamEndpointLabel(endpoint: StreamEndpoint): string {
    const kit = endpoint.kitInstanceId ? `${endpoint.kitInstanceId} ` : "";
    const media = endpoint.mediaport !== undefined ? `/${endpoint.mediaport}` : "";
    return `${kit}${endpoint.signalingserver}:${endpoint.signalingport}${media}`;
}

function makeRequestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function expectedStageUrlFromStreamConfig(streamConfig: ReviewStreamConfig | null): string | null {
    return streamConfig?.stage_composition?.primary?.url || streamConfig?.model?.url || null;
}

function displayNameFromStageUrl(url: string): string {
    const tail = url.split(/[\\/]/).pop() || "model.usdc";
    return tail.includes("?") ? tail.split("?")[0] : tail;
}

function redactStageUrlForDiagnostic(url: string | null | undefined): string {
    const value = url || "unknown";
    try {
        const parsed = new URL(value);
        if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) return value;
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
        return value.replace(/[?#].*$/, "");
    }
}

function redactRuntimeDiagnosticText(value: string): string {
    const withoutUrls = value.replace(
        /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi,
        (candidate) => redactStageUrlForDiagnostic(candidate),
    );
    const withoutSensitiveAssignments = withoutUrls
        .replace(
            /\b(access[_-]?token|authorization|cookie|password|secret|token|x-amz-(?:signature|credential|security-token))\s*=\s*(?:(?:bearer|basic|token)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
            (_match, key: string) => `${key}=[redacted]`,
        );
    const withoutStandaloneCredentials = withoutSensitiveAssignments.replace(
        /\b(?:(authorization)\s+)?(bearer|basic)\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        (_match, authorization: string | undefined, scheme: string) => (
            authorization ? `${authorization} ${scheme} [redacted]` : `${scheme} [redacted]`
        ),
    );
    return withoutStandaloneCredentials
        .replace(
            /\b(access[_-]?token|authorization|cookie|password|secret|token|x-amz-(?:signature|credential|security-token))\s*:\s*[^\r\n]+/gi,
            (_match, key: string) => `${key}:[redacted]`,
        );
}

function isStageAuthorizationTimeout(error: unknown): boolean {
    return error instanceof Error && error.message === "stage_binding_authorization_timeout";
}

export default class App extends React.Component<AppProps, AppState> {
    
    private usdStageRef = React.createRef<USDStage>();
    private coordinatorClient = new CoordinatorClient(reviewEnv.coordinatorApiBase);
    private bimControlClient = new BimControlClient(reviewEnv.bimControlApiBase);
    private reviewSocket: ReviewSocketClient | null = null;
    private verifiedDataChannelAuthority: VerifiedDataChannelAuthority | null = null;
    private reviewSocketEpoch = 0;
    private streamStartTimeoutId: number | null = null;
    private streamConfigRefreshTimeoutId: number | null = null;
    private loadingStateRetryId: number | null = null;
    private stageLoadTimeoutId: number | null = null;
    private deferredOpenStageId: number | null = null;
    private _pollForKitReadyId: number | null = null;
    private loadingStatePollCount = 0;
    private pendingStageUrl: string | null = null;
    private stageAttemptGeneration = 0;
    // Tracks user/runtime intent while coordinator preauthorization is pending.
    // It is deliberately separate from request correlation generation: a new
    // open/reconnect must revoke an older binding transaction before it can
    // create a new stage attempt.
    private stageIntentGeneration = 0;
    private pendingStagePreauthorizationIntent: number | null = null;
    private activeStagePreauthorization: ActiveStagePreauthorization | null = null;
    private stagePreauthorizationCancellationBarrier: StagePreauthorizationCancellationBarrier | null = null;
    private activeStageAttempt: StageAttempt | null = null;
    // React state remounts <AppStream>, but callbacks can run before React commits that state.
    // Keep the lifetime authority outside React so a retired stream is fenced synchronously.
    private streamGeneration = 0;
    // NVIDIA SDK 5.18.2 registers openStageRequest callbacks by response event
    // type rather than request id, while loadArtifactGroupRequest's immediate
    // generic ACK must wait for its DataChannel terminal. Never issue either
    // native stage command on the same AppStreamer lifecycle until the prior
    // opened-stage slot settles.
    private nativeOpenStageSlot: NativeOpenStageDispatch | null = null;
    private queuedNativeOpenStage: NativeOpenStageDispatch | null = null;
    private nativeOpenStageSlotTimeoutId: number | null = null;
    private nativeOpenStageSlotSequence = 0;
    private nativeOpenStagePoisonedGeneration: number | null = null;
    // Only a fresh React-keyed AppStream lifecycle may clear a poison fence.
    // AppStream waits for the prior physical teardown before it reports started.
    private nativeOpenStageReplacementStartGeneration: number | null = null;
    private stageDispatchCallbacks = new WeakMap<AppStreamMessageType | StreamMessage, () => void>();
    private bindingApplyGeneration = 0;
    private pendingBindingApplyGeneration: number | null = null;
    private pendingBindingApplyStageAttemptGeneration: number | null = null;
    private stageLoadFailureActive = false;
    // Stable machine-readable reason for the currently visible stage-load
    // failure. Only "stage-load-timeout" is populated today; every other
    // stage-load failure keeps this null so its DOM anchor (data-stage-
    // failure-reason) stays state-specific instead of colliding with the
    // shared "stage-load-failure" testid across unrelated failure causes.
    private stageLoadFailureReason: "stage-load-timeout" | null = null;
    // VG-01 M1：first_frame 只送一次的閂（防失敗/斷線/開檔路徑誤觸→偽證據）。
    private _firstFramePosted = false;
    // Important #3：白名單為空導致 _postToParent 全 reject 時，只 warn 一次（_postToParent 在 first_frame/heartbeat 高頻呼叫）。
    private _postToParentEmptyAllowlistWarned = false;
    // VG-01：parent（console iframe 容器）postMessage listener 的穩定參考，供 add/removeEventListener 對稱掛卸。
    private _onParentMessage = (e: MessageEvent): void => this._handleParentMessage(e);
    private pendingMappingHighlightRequestId: string | null = null;
    private pendingMappingFocusRequestId: string | null = null;
    private pendingMappingPrimPath: string | null = null;
    private runtimeCommandContexts = new Map<string, RuntimeCommandContext>();
    private runtimeCommandTerminalClaims = new Map<string, { eventType: string; outcome: RuntimeCommandOutcome }>();
    // Terminal claims deliberately retain their minimal established shape.
    // Keep only the safety metadata needed to process a later authenticated
    // physical-change terminal after an intent was superseded or timed out.
    private runtimeCommandTerminalSafetyContexts = new Map<string, RuntimeCommandContext>();
    private a4HandoffIntent: A4HandoffIntent | null = null;
    private a4HandoffStarted = false;
    private a4HandoffAttemptInFlight = false;
    private a4HandoffReadinessTimerId: number | null = null;
    private a4HandoffCommandTimeoutId: number | null = null;
    private a4HandoffPendingRequestId: string | null = null;
    private a4HandoffUserCarrier: string | null = null;
    private a4HandoffLeaseId: string | null = null;
    private a4HandoffLeaseToken: string | null = null;
    private stageProofBlockedRevision: string | null = null;
    private unprovenStageUrl: string | null = null;
    private stageProofBlockGeneration = 0;
    private confirmedStageBindingRevision: string | null = null;
    // 統一治理控制台 MVP：當前 model version 的 MappingCache（鎖單一版本，Task C3 餵入）；未載入前為 null。
    private _mappingCache: MappingCache | null = null;
    // W9：cache 建立時用的 mapping_url；換 url（即使同 model version）也需重建。
    private _mappingCacheUrl: string | null = null;
    // W2：治理標示送出後，等待 Kit highlightPrimsResult 非同步確認的 request（與既有 mapping-verify 的
    // pendingMappingHighlightRequestId 分開，互不干擾）。
    // F1：一併記 rowKey（rule_code::ifc_guid），確認回來時以 rowKey 寫 govHighlightConfirm，
    // 避免同一 ifc_guid 多筆不同 rule_code 的列共用 / 互相覆蓋確認狀態。
    private _pendingGovHighlights: Record<string, { ifc_guid: string; rowKey: string; primPath: string }> = {};
    private standaloneViewerLease: StandaloneViewerLease | null = null;
    private standaloneViewerLeaseClaim: Promise<StandaloneViewerLease | null> | null = null;
    private standaloneViewerLeaseHeartbeatId: number | null = null;
    private componentMounted = false;
    private idleActivityRequestInFlight = false;
    private passiveIdleActivityRequestInFlight = false;
    private lastIdleActivityReportAt = 0;
    private readonly standaloneViewerId = reviewEnv.sourceClientId;
    // private _streamConfig: StreamConfigType = getConfig();
    
    constructor(props: AppProps) {
        super(props);
        const activeStreamEndpoint = resolveInitialStreamEndpoint(props);

        this.state = {
            usdAssets: [],
            selectedUSDAsset: null,
            reviewSessionId: null,
            reviewRequestId: null,
            currentProjectId: null,
            currentModelVersionId: null,
            reviewLifecycleStatus: null,
            reviewStatus: "Review bootstrap 尚未載入",
            reviewArtifacts: [],
            reviewEvents: [],
            latestStreamConfig: null,
            mappingUrl: null,
            mappingStatus: "尚未載入 mapping",
            mappingSummary: null,
            mappingItems: [],
            selectedMappingIndex: 0,
            lastMappingVerification: null,
            mappingVerificationBlockedReason: null,
            demoOutgoingMessages: [],
            demoIncomingMessages: [],
            usdPrims: [],
            selectedUSDPrims: new Set<USDPrimType>(),
            isKitReady: false,
            showStream: false,
            viewerTab: "model",
            showUI: false,
            loadingText: "正在載入成果檔清單...",
            streamDiagnostic: null,
            expectedStageUrl: null,
            loadedStageUrl: null,
            stageLoadStatus: "unproven",
            runtimeCommandRejection: null,
            runtimeCommandLifecycles: [],
            a4Handoff: reviewEnv.hasInvalidA4HandoffId
                ? {
                    status: "rejected",
                    phase: "terminal",
                    handoff_id: null,
                    action: null,
                    request_id: null,
                    retry_of_request_id: null,
                    detail: "invalid_a4_handoff",
                    retryable: false,
                }
                : {
                    status: reviewEnv.a4HandoffId ? "pending" : "idle",
                    phase: reviewEnv.a4HandoffId ? "waiting-session" : "idle",
                    handoff_id: reviewEnv.a4HandoffId,
                    action: null,
                    request_id: null,
                    retry_of_request_id: null,
                    detail: reviewEnv.a4HandoffId ? "waiting_for_review_session" : null,
                    retryable: false,
                },
            webrtcLifecycleStatus: "initializing",
            isLoading: true,
            activeStreamEndpoint,
            streamMountKey: 0,
            idleCountdownRemainingSeconds: null,
            idleClosedReason: null,
        }
    }

    private _notifyParentViewerReady = (): void => {
        if (window.parent !== window) this._postToParent({ type: "viewer_ready" });
    };

    componentDidMount(): void {
        this.componentMounted = true;
        window.__structLog?.logger.setDeliveryAuthorityProvider(() => this._currentViewerLogDeliveryAuthority());
        // VG-01：嵌入 console iframe 時掛上 parent postMessage 橋（unmount 對稱移除），並通知 parent listener 已就緒。
        // 嚴格 additive：非嵌入（window.parent === window）時 listener 永遠 reject、不送任何訊息，既有單機/直連行為零變更。
        window.addEventListener("message", this._onParentMessage);
        window.addEventListener("load", this._notifyParentViewerReady);
        window.addEventListener("keydown", this._onViewerUserActivity);
        window.addEventListener("pointerdown", this._onViewerUserActivity);
        window.addEventListener("wheel", this._onViewerUserActivity, { passive: true });
        this._notifyParentViewerReady();

        if (reviewEnv.hasExplicitEmptySessionId) {
            void this._bootstrapReview();
            return;
        }

        if (!harnessEnabled()) void this._loadUSDAssets();
        void this._bootstrapReview();
    }

    componentWillUnmount(): void {
        this.componentMounted = false;
        this.reviewSocketEpoch += 1;
        this.verifiedDataChannelAuthority = null;
        window.__structLog?.logger.setDeliveryAuthorityProvider(null);
        window.removeEventListener("load", this._notifyParentViewerReady);
        window.removeEventListener("keydown", this._onViewerUserActivity);
        window.removeEventListener("pointerdown", this._onViewerUserActivity);
        window.removeEventListener("wheel", this._onViewerUserActivity);
        this._releaseStandaloneViewerLease();
        this._clearStreamStartTimeout();
        this._clearStreamConfigRefresh();
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this._clearDeferredOpenStage();
        this._retireNativeOpenStageDispatches();
        this._clearPollForKitReady();
        this._clearA4HandoffReadinessTimer();
        this._clearA4HandoffCommandTimeout();
        this.a4HandoffUserCarrier = null;
        this.a4HandoffLeaseToken = null;
        this.reviewSocket?.leave();
        this.reviewSocket?.disconnect();
        window.removeEventListener("message", this._onParentMessage);
    }

    private _appendReviewEvent(event: string): void {
        this.setState((state) => ({
            reviewEvents: [...state.reviewEvents, event].slice(-80),
        }));
    }

    private _appendDemoOutgoing(label: string, payload: unknown): void {
        this.setState((state) => ({
            demoOutgoingMessages: [
                { at: new Date().toISOString(), label, payload: redactDiagnosticValue(payload) },
                ...state.demoOutgoingMessages,
            ].slice(0, 20),
        }));
    }

    private _appendDemoIncoming(label: string, payload: unknown): void {
        this.setState((state) => ({
            demoIncomingMessages: [
                { at: new Date().toISOString(), label, payload: redactDiagnosticValue(payload) },
                ...state.demoIncomingMessages,
            ].slice(0, 20),
        }));
    }

    private _onViewerUserActivity = (event: Event): void => {
        const target = event.target;
        if (target instanceof Element && target.closest('[data-testid="session-idle-keepalive-btn"]')) return;
        this._reportViewerActivity();
    };

    private _reportViewerActivity(): void {
        const authority = this.verifiedDataChannelAuthority;
        const sessionId = this.state.reviewSessionId;
        if (
            !authority
            || !sessionId
            || authority.sessionId !== sessionId
            || authority.connectionGeneration !== this.reviewSocketEpoch
        ) return;
        const now = Date.now();
        if (this.passiveIdleActivityRequestInFlight || now - this.lastIdleActivityReportAt < 5_000) return;
        this.passiveIdleActivityRequestInFlight = true;
        void this._recordSessionActivity()
            .finally(() => {
                this.passiveIdleActivityRequestInFlight = false;
            });
    }

    private async _recordSessionActivity(): Promise<boolean> {
        const authority = this.verifiedDataChannelAuthority;
        const sessionId = this.state.reviewSessionId;
        if (
            !authority
            || !sessionId
            || authority.sessionId !== sessionId
            || authority.connectionGeneration !== this.reviewSocketEpoch
        ) return false;
        if (this.idleActivityRequestInFlight) return false;
        this.idleActivityRequestInFlight = true;
        try {
            let leaseDeadlineId: number | null = null;
            const leaseAuthority = await Promise.race([
                this._ensureViewerLogDeliveryAuthority().catch(() => null),
                new Promise<null>((resolve) => {
                    leaseDeadlineId = window.setTimeout(() => resolve(null), IDLE_ACTIVITY_TRANSPORT_TIMEOUT_MS);
                }),
            ]).finally(() => {
                if (leaseDeadlineId !== null) window.clearTimeout(leaseDeadlineId);
            });
            const currentAuthority = this.verifiedDataChannelAuthority;
            if (
                !currentAuthority
                || currentAuthority !== authority
                || currentAuthority.connectionGeneration !== this.reviewSocketEpoch
            ) return false;

            let acknowledged = false;
            if (leaseAuthority?.reviewSessionId === sessionId) {
                let activityDeadlineId: number | null = null;
                const response = await Promise.race([
                    this.coordinatorClient.recordSessionActivity(
                        sessionId,
                        leaseAuthority.leaseId,
                        leaseAuthority.leaseToken,
                    ).catch(() => null),
                    new Promise<null>((resolve) => {
                        activityDeadlineId = window.setTimeout(
                            () => resolve(null),
                            IDLE_ACTIVITY_TRANSPORT_TIMEOUT_MS,
                        );
                    }),
                ]).finally(() => {
                    if (activityDeadlineId !== null) window.clearTimeout(activityDeadlineId);
                });
                acknowledged = response?.ok === true && response.session_id === sessionId;
            }
            let fallbackSocket: ReviewSocketClient | null = null;
            if (!acknowledged) {
                fallbackSocket = this.reviewSocket;
                if (fallbackSocket) {
                    let socketDeadlineId: number | null = null;
                    acknowledged = await Promise.race([
                        fallbackSocket.userActivity().catch(() => false),
                        new Promise<false>((resolve) => {
                            socketDeadlineId = window.setTimeout(
                                () => resolve(false),
                                IDLE_ACTIVITY_TRANSPORT_TIMEOUT_MS,
                            );
                        }),
                    ]).finally(() => {
                        if (socketDeadlineId !== null) window.clearTimeout(socketDeadlineId);
                    });
                }
            }
            const finalAuthority = this.verifiedDataChannelAuthority;
            if (
                !acknowledged
                || !finalAuthority
                || finalAuthority !== authority
                || finalAuthority.connectionGeneration !== this.reviewSocketEpoch
                || (fallbackSocket !== null && fallbackSocket !== this.reviewSocket)
            ) return false;
            this.lastIdleActivityReportAt = Date.now();
            if (this.componentMounted) this.setState({ idleCountdownRemainingSeconds: null });
            return true;
        } finally {
            this.idleActivityRequestInFlight = false;
        }
    }

    private _clearA4HandoffReadinessTimer(): void {
        if (this.a4HandoffReadinessTimerId === null) return;
        window.clearTimeout(this.a4HandoffReadinessTimerId);
        this.a4HandoffReadinessTimerId = null;
    }

    private _clearA4HandoffCommandTimeout(): void {
        if (this.a4HandoffCommandTimeoutId === null) return;
        window.clearTimeout(this.a4HandoffCommandTimeoutId);
        this.a4HandoffCommandTimeoutId = null;
    }

    private _setA4HandoffRejected(detail: string, retryable: boolean, requestId?: string): void {
        this._clearA4HandoffReadinessTimer();
        this._clearA4HandoffCommandTimeout();
        this.a4HandoffPendingRequestId = null;
        this.setState((state) => ({
            a4Handoff: {
                ...state.a4Handoff,
                status: "rejected",
                phase: "terminal",
                handoff_id: state.a4Handoff.handoff_id || reviewEnv.a4HandoffId,
                request_id: requestId || state.a4Handoff.request_id,
                detail,
                retryable,
            },
            reviewEvents: [...state.reviewEvents, `A4 handoff rejected：${detail}`].slice(-80),
        }));
    }

    private _rejectA4HandoffBeforeConsume(detail: string): void {
        if (!reviewEnv.a4HandoffId && !reviewEnv.hasInvalidA4HandoffId) return;
        this._setA4HandoffRejected(detail, false);
    }

    private _a4HandoffError(error: unknown): { detail: string; retryable: boolean } {
        if (error instanceof CoordinatorHttpError) {
            return {
                detail: error.errorCode,
                retryable: error.status >= 500,
            };
        }
        return { detail: "a4_handoff_request_failed", retryable: true };
    }

    private async _beginA4Handoff(sessionId: string): Promise<void> {
        if (reviewEnv.hasInvalidA4HandoffId) {
            this._setA4HandoffRejected("invalid_a4_handoff", false);
            return;
        }
        const handoffId = reviewEnv.a4HandoffId;
        if (!handoffId || this.a4HandoffStarted || this.a4HandoffIntent) return;
        if (isSpectatorStreamMode()) {
            this._setA4HandoffRejected("spectator_readonly", false);
            return;
        }

        this.a4HandoffStarted = true;
        this.setState((state) => ({
            a4Handoff: {
                ...state.a4Handoff,
                status: "pending",
                phase: "consuming",
                handoff_id: handoffId,
                detail: "authorizing_trusted_handoff",
                retryable: false,
            },
        }));

        try {
            const userCarrier = reviewEnv.userToken || this._ensureStandaloneLabUserToken();
            const leaseToken = await this._ensurePrimaryViewerLease();
            const leaseId = reviewEnv.sourceClientId;
            if (!userCarrier || !leaseToken || !leaseId) {
                throw new CoordinatorHttpError(401, "local:a4-handoff", "a4_viewer_authority_missing");
            }
            const intent = await this.coordinatorClient.consumeA4Handoff(
                sessionId,
                handoffId,
                userCarrier,
                leaseToken,
            );
            if (!this.componentMounted) return;
            this.a4HandoffIntent = intent;
            this.a4HandoffUserCarrier = userCarrier;
            this.a4HandoffLeaseId = leaseId;
            this.a4HandoffLeaseToken = leaseToken;
            this.setState((state) => ({
                a4Handoff: {
                    ...state.a4Handoff,
                    status: "pending",
                    phase: "waiting-readiness",
                    action: intent.action,
                    detail: "waiting_for_bound_stage_and_datachannel",
                    retryable: false,
                },
            }));
            this._scheduleA4HandoffAttempt();
        } catch (error) {
            if (!this.componentMounted) return;
            this.a4HandoffStarted = false;
            const failure = this._a4HandoffError(error);
            this._setA4HandoffRejected(failure.detail, failure.retryable);
        }
    }

    private _scheduleA4HandoffAttempt(delayMs = 0, retryOfRequestId?: string): void {
        this._clearA4HandoffReadinessTimer();
        if (!this.a4HandoffIntent || this.a4HandoffPendingRequestId) return;
        this.a4HandoffReadinessTimerId = window.setTimeout(() => {
            this.a4HandoffReadinessTimerId = null;
            void this._attemptA4HandoffCommand(retryOfRequestId);
        }, delayMs);
    }

    private _a4LocalAuthority() {
        const intent = this.a4HandoffIntent;
        if (!intent) return { kind: "reject", code: "a4_handoff_unavailable" } as const;
        const streamConfig = this.state.latestStreamConfig;
        const primaryArtifactId = streamConfig?.stage_composition?.primary_artifact_id
            || streamConfig?.model.artifact_id
            || null;
        const loadedStageUrl = this.state.loadedStageUrl;
        return evaluateA4LocalAuthority(intent, {
            session_id: this.state.reviewSessionId,
            model_version_id: this.state.currentModelVersionId,
            primary_artifact_id: primaryArtifactId,
            active_binding_revision: this.confirmedStageBindingRevision,
            lifecycle_status: this.state.reviewLifecycleStatus,
            stage_status: this.state.stageLoadStatus,
            stage_matches_expected: Boolean(loadedStageUrl && this._isLoadedStageExpected(loadedStageUrl)),
            datachannel_ready: this.state.webrtcLifecycleStatus === "started" && this.state.isKitReady,
            spectator: isSpectatorStreamMode(),
        });
    }

    private async _attemptA4HandoffCommand(retryOfRequestId?: string): Promise<void> {
        const intent = this.a4HandoffIntent;
        if (!intent || this.a4HandoffAttemptInFlight || this.a4HandoffPendingRequestId) return;

        const localGate = this._a4LocalAuthority();
        if (localGate.kind === "wait") {
            this.setState((state) => ({
                a4Handoff: {
                    ...state.a4Handoff,
                    status: "pending",
                    phase: "waiting-readiness",
                    retry_of_request_id: retryOfRequestId || null,
                    detail: localGate.code,
                    retryable: false,
                },
            }));
            this._scheduleA4HandoffAttempt(250, retryOfRequestId);
            return;
        }
        if (localGate.kind === "reject") {
            this._setA4HandoffRejected(localGate.code, false);
            return;
        }

        const userCarrier = reviewEnv.userToken;
        const leaseId = reviewEnv.sourceClientId;
        const leaseToken = reviewEnv.viewerLeaseToken;
        if (
            !userCarrier
            || !leaseId
            || !leaseToken
            || userCarrier !== this.a4HandoffUserCarrier
            || leaseId !== this.a4HandoffLeaseId
            || leaseToken !== this.a4HandoffLeaseToken
        ) {
            this._setA4HandoffRejected("principal_or_primary_lease_changed", false);
            return;
        }

        this.a4HandoffAttemptInFlight = true;
        this.setState((state) => ({
            a4Handoff: {
                ...state.a4Handoff,
                status: "pending",
                phase: "revalidating",
                retry_of_request_id: retryOfRequestId || null,
                detail: "revalidating_current_authority",
                retryable: false,
            },
        }));
        try {
            const [session, streamConfig, leaseStatus] = await Promise.all([
                this.coordinatorClient.getReviewSession(intent.binding.review_session_id),
                this.coordinatorClient.getStreamConfig(intent.binding.review_session_id),
                this.coordinatorClient.getA4ViewerLeaseStatus(
                    intent.binding.review_session_id,
                    userCarrier,
                    leaseToken,
                ),
            ]);
            if (!this.componentMounted) return;
            if (
                reviewEnv.userToken !== userCarrier
                || reviewEnv.sourceClientId !== leaseId
                || reviewEnv.viewerLeaseToken !== leaseToken
            ) {
                this._setA4HandoffRejected("principal_or_primary_lease_changed", false);
                return;
            }
            const expectedStageUrl = this.state.expectedStageUrl;
            if (!expectedStageUrl) {
                this._setA4HandoffRejected("loaded_stage_invalid", false);
                return;
            }
            const serverBlockReason = a4ServerAuthorityBlockReason(
                intent,
                { session, stream_config: streamConfig, lease_status: leaseStatus },
                leaseId,
                expectedStageUrl,
            );
            if (serverBlockReason) {
                this._setA4HandoffRejected(serverBlockReason, false);
                return;
            }
            const finalLocalGate = this._a4LocalAuthority();
            if (finalLocalGate.kind === "wait") {
                this.setState((state) => ({
                    a4Handoff: {
                        ...state.a4Handoff,
                        status: "pending",
                        phase: "waiting-readiness",
                        detail: finalLocalGate.code,
                        retryable: false,
                    },
                }));
                this._scheduleA4HandoffAttempt(250, retryOfRequestId);
                return;
            }
            if (finalLocalGate.kind === "reject") {
                this._setA4HandoffRejected(finalLocalGate.code, false);
                return;
            }

            const requestId = createRuntimeRequestId();
            const message = buildA4HandoffCommand(intent, requestId, retryOfRequestId);
            this.a4HandoffPendingRequestId = requestId;
            this.setState((state) => ({
                a4Handoff: {
                    ...state.a4Handoff,
                    status: "pending",
                    phase: "command-pending",
                    request_id: requestId,
                    retry_of_request_id: retryOfRequestId || null,
                    detail: "waiting_for_runtime_result",
                    retryable: false,
                },
            }));
            if (!this._sendStreamMessage(message)) {
                this.a4HandoffPendingRequestId = null;
                this._setA4HandoffRejected("runtime_command_blocked", false, requestId);
                return;
            }
            this._clearA4HandoffCommandTimeout();
            this.a4HandoffCommandTimeoutId = window.setTimeout(() => {
                this.a4HandoffCommandTimeoutId = null;
                if (this.a4HandoffPendingRequestId !== requestId) return;
                if (!this._claimRuntimeCommandTerminal(requestId, message.event_type, "timed-out")) return;
                this._finishA4HandoffCommand(requestId, "timed-out", "runtime_result_timeout", true);
            }, A4_HANDOFF_COMMAND_TIMEOUT_MS);
        } catch (error) {
            if (!this.componentMounted) return;
            const failure = this._a4HandoffError(error);
            this._setA4HandoffRejected(failure.detail, failure.retryable);
        } finally {
            this.a4HandoffAttemptInFlight = false;
        }
    }

    private _finishA4HandoffCommand(
        requestId: string,
        status: "succeeded" | "rejected" | "timed-out",
        detail: string,
        retryable: boolean,
    ): void {
        if (this.a4HandoffPendingRequestId !== requestId) return;
        this._clearA4HandoffCommandTimeout();
        this.a4HandoffPendingRequestId = null;
        this.setState((state) => ({
            a4Handoff: {
                ...state.a4Handoff,
                status,
                phase: "terminal",
                request_id: requestId,
                detail,
                retryable,
            },
            reviewEvents: [...state.reviewEvents, `A4 handoff ${status}：${detail}`].slice(-80),
        }));
    }

    private _retryA4Handoff(): void {
        const current = this.state.a4Handoff;
        if ((current.status !== "rejected" && current.status !== "timed-out") || !current.retryable) return;
        if (!this.a4HandoffIntent) {
            const sessionId = this.state.reviewSessionId;
            if (!sessionId) {
                this._setA4HandoffRejected("review_session_unavailable", false);
                return;
            }
            this.a4HandoffStarted = false;
            void this._beginA4Handoff(sessionId);
            return;
        }
        this.setState((state) => ({
            a4Handoff: {
                ...state.a4Handoff,
                status: "pending",
                phase: "revalidating",
                retry_of_request_id: current.request_id,
                detail: "retry_revalidating_current_authority",
                retryable: false,
            },
        }));
        void this._attemptA4HandoffCommand(current.request_id || undefined);
    }

    private _a4RuntimeResultSucceeded(eventType: string, payload: Record<string, unknown>): boolean | null {
        const requestId = getPayloadString(payload, "request_id");
        const intent = this.a4HandoffIntent;
        if (!requestId || requestId !== this.a4HandoffPendingRequestId || !intent) return null;
        if (getPayloadString(payload, "result") !== "success") return false;
        if (intent.action === "focus") {
            return eventType === "focusPrimResult"
                && getPayloadString(payload, "prim_path") === intent.prim_paths[0]
                && !getPayloadString(payload, "fallback_path");
        }
        if (eventType !== "highlightPrimsResult") return false;
        const selectedPaths = getPayloadStringArray(payload, "selected_paths");
        const missingPaths = getPayloadStringArray(payload, "missing_paths");
        const fallbackPaths = getPayloadObjectArray(payload, "fallback_paths");
        return selectedPaths.length === intent.prim_paths.length
            && intent.prim_paths.every((path) => selectedPaths.includes(path))
            && missingPaths.length === 0
            && fallbackPaths.length === 0;
    }

    private _recordRuntimeCommandPhase(
        requestId: string,
        eventType: string,
        phase: RuntimeCommandPhase,
        outcome?: RuntimeCommandOutcome,
    ): void {
        if (!requestId || !eventType) return;
        this.setState((state) => {
            const current = state.runtimeCommandLifecycles.find((entry) => entry.request_id === requestId);
            // A request has one terminal outcome. Late or duplicate protocol
            // events remain observable elsewhere but cannot rewrite UI truth.
            if (current?.phases.includes("terminal")) return null;
            const phases = current ? [...current.phases] : [];
            if (phases[phases.length - 1] !== phase) phases.push(phase);
            const next: RuntimeCommandLifecycle = {
                request_id: requestId,
                event_type: current?.event_type || eventType,
                phases,
                ...(outcome ? { outcome } : current?.outcome ? { outcome: current.outcome } : {}),
            };
            return {
                runtimeCommandLifecycles: [
                    next,
                    ...state.runtimeCommandLifecycles.filter((entry) => entry.request_id !== requestId),
                ].slice(0, 12),
            };
        });
    }

    private _correlateRuntimeCommandEvent(
        responseEventType: string,
        payload: Record<string, unknown>,
    ): RuntimeCommandCorrelation {
        const requestId = getPayloadString(payload, "request_id");
        if (!requestId) return { requestId, disposition: "uncorrelated" };
        if (this.runtimeCommandTerminalClaims.has(requestId)) {
            return { requestId, disposition: "duplicate" };
        }
        const context = requestId ? this.runtimeCommandContexts.get(requestId) : undefined;
        if (!context) return { requestId, disposition: "untracked" };

        const allowedRequests = runtimeResponseRequestTypes.get(responseEventType);
        if (!allowedRequests?.has(context.eventType)) {
            this._appendReviewEvent(`忽略 ${responseEventType}：terminal 與 ${context.eventType} 不相符`);
            return { requestId, context, disposition: "mismatch", mismatchReason: "event_type" };
        }
        const expectedRevision = context.bindingRevisionId;
        const receivedRevision = getPayloadString(payload, "binding_revision_id");
        if (expectedRevision && receivedRevision !== expectedRevision) {
            this._appendReviewEvent(`忽略 ${responseEventType}：binding revision 與 request context 不相符`);
            return { requestId, context, disposition: "mismatch", mismatchReason: "binding_revision" };
        }
        return { requestId, context, disposition: "matched" };
    }

    private _claimRuntimeCommandTerminal(
        requestId: string,
        eventType: string,
        outcome: RuntimeCommandOutcome,
    ): boolean {
        if (!requestId || this.runtimeCommandTerminalClaims.has(requestId)) return false;
        const context = this.runtimeCommandContexts.get(requestId);
        this.runtimeCommandTerminalClaims.set(requestId, { eventType, outcome });
        if (context) this.runtimeCommandTerminalSafetyContexts.set(requestId, context);
        while (this.runtimeCommandTerminalClaims.size > 128) {
            const oldest = this.runtimeCommandTerminalClaims.keys().next().value as string | undefined;
            if (!oldest) break;
            this.runtimeCommandTerminalClaims.delete(oldest);
            this.runtimeCommandTerminalSafetyContexts.delete(oldest);
        }
        this._recordRuntimeCommandPhase(requestId, eventType, "terminal", outcome);
        this.runtimeCommandContexts.delete(requestId);
        return true;
    }

    private _completeRuntimeCommandEvent(
        responseEventType: string,
        payload: Record<string, unknown>,
        outcome: RuntimeCommandOutcome,
    ): RuntimeCommandCorrelation {
        const correlation = this._correlateRuntimeCommandEvent(responseEventType, payload);
        if (correlation.disposition === "matched" && correlation.requestId && correlation.context) {
            const eventType = correlation.context.eventType;
            if (!this._claimRuntimeCommandTerminal(correlation.requestId, eventType, outcome)) {
                return { ...correlation, disposition: "duplicate" };
            }
        }
        return correlation;
    }

    private _runtimeMutatorBlockReason(eventType: string): string | null {
        if (!isRuntimeMutator(eventType)) return null;
        if (
            requestUsesNativeOpenedStageResult(eventType)
            && (this.state.webrtcLifecycleStatus === "stopped" || this.state.webrtcLifecycleStatus === "terminated")
        ) {
            return `webrtc lifecycle=${this.state.webrtcLifecycleStatus}; reconnect required`;
        }
        if (this.stageProofBlockedRevision) return "stage binding proof resync required";
        if (isSpectatorStreamMode()) return "spectator view-only";
        if (isBlockedLifecycle(this.state.reviewLifecycleStatus)) {
            return `session lifecycle=${this.state.reviewLifecycleStatus || "unknown"}`;
        }
        if (window.parent === window && this.standaloneViewerLease && !this._standaloneViewerLeaseIsFresh()) {
            this._dropStandaloneViewerLease("primary viewer lease 已過期；請重新執行操作以取得新 lease");
            return "primary viewer lease expired; reclaim required";
        }
        // NOTE(scope Task3->Task5)：以下第三條「primary 需 viewer lease token」與 _withRuntimeAuthority 的 payload
        // 注入，超出 Task3 Step2/3 字面範圍（Task3 只要求 spectator / lifecycle 兩道 gate）。此為 plan 同檔
        // 「Task5: Kit-Side Runtime Mutator Authorization」之 _is_authorized_mutator 消費契約的前端半。
        // 誠實界線：此前端 gate 僅 UX、直呼 AppStream.sendMessage 可繞過。Task5 Kit 端 runtime_authority.py
        // 是第二道 defense-in-depth gate，但它目前只驗 payload 的 role/session_id/lease_token 字串「形狀」
        // （非空 + role==primary），並未回 coordinator ViewerLeaseStore 驗證 token 真偽（P5 finding f1，見
        // final-report Known limitations 與 follow-up issue）。真正的 lease 簽發/spectator 唯讀權威在 coordinator。
        // 保留此前端 gate 而非移除，因 6 個 unit test 與 Task5 payload 契約依賴之。
        // 範圍（刻意）：此 gate 位於中央 _sendStreamMessage，故同時覆蓋 standalone 直送與 VG-01 embedded postMessage
        // 橋（_handleParentMessage 的 highlight / focus / clear，即 EmbeddedViewer/ReviewSessionViewerPane 實作 A1
        // 「在 3D 高亮失敗構件」的核心路徑）——embedded 端無 lease 亦不送 mutating（與 standalone 一致，非漏網）；
        // 實務上 ReviewSessionViewerPane 先推 viewer_lease_token 再 enable 高亮鈕，故有 lease 才送。回歸證據見
        // windowParentMessage.dom.test.tsx「VG-01 postMessage 橋真穿越 lease 閘門至 AppStream.sendMessage」。
        if ((!harnessEnabled() || harnessAuthorityRequired()) && (!this.state.reviewSessionId || !reviewEnv.viewerLeaseToken)) {
            return "primary viewer lease token required";
        }
        return null;
    }

    private _withRuntimeAuthority(message: AppStreamMessageType | StreamMessage): AppStreamMessageType | StreamMessage {
        // NOTE(scope Task3->Task5)：runtime authority payload 注入超出 Task3 字面範圍，提供 plan Task5 Kit 端
        // _is_authorized_mutator 消費的 role / source_client_id / viewer_lease_token / session_id 形狀（見上方 gate 註解）。
        if (!isRuntimeMutator(message.event_type)) return message;
        const payload = isRecord(message.payload) ? { ...message.payload } : {};
        const requestId = getPayloadString(payload, "request_id") || createRuntimeRequestId();
        return {
            ...message,
            payload: {
                ...payload,
                request_id: requestId,
                role: isSpectatorStreamMode() ? "spectator" : "primary",
                source_client_id: reviewEnv.sourceClientId,
                ...(reviewEnv.viewerLeaseToken ? { viewer_lease_token: reviewEnv.viewerLeaseToken } : {}),
            },
        };
    }

    private _currentVerifiedDataChannelAuthority(): VerifiedDataChannelAuthority | null {
        const authority = this.verifiedDataChannelAuthority;
        const streamConfig = this.state.latestStreamConfig;
        if (!authority || authority.connectionGeneration !== this.reviewSocketEpoch || !streamConfig) return null;
        if (
            this.state.reviewSessionId !== authority.sessionId
            || streamConfig.session_id !== authority.sessionId
            || streamConfig.trace_id !== authority.traceId
            || traceIdFromSearch(window.location.search) !== authority.traceId
            || !this._harnessRouteAuthorityMatches(authority.sessionId, authority.traceId)
        ) return null;
        return authority;
    }

    private _harnessRouteAuthorityMatches(sessionId: string, traceId: string): boolean {
        if (!harnessEnabled()) return true;
        const routeSessions = new URLSearchParams(window.location.search).getAll("session");
        return sessionId === HARNESS_SESSION_ID
            && traceId === HARNESS_TRACE_ID
            && routeSessions.length === 1
            && routeSessions[0] === HARNESS_SESSION_ID
            && traceIdFromSearch(window.location.search) === HARNESS_TRACE_ID;
    }

    private _withVerifiedDataChannelTrace(
        message: AppStreamMessageType | StreamMessage,
    ): AppStreamMessageType | StreamMessage | null {
        if (!viewerToKitEventTypes.has(message.event_type) || !isRecord(message.payload)) return null;
        const authority = this._currentVerifiedDataChannelAuthority();
        if (!authority) return null;
        const hasSessionId = Object.prototype.hasOwnProperty.call(message.payload, "session_id");
        const hasTraceId = Object.prototype.hasOwnProperty.call(message.payload, "trace_id");
        if (
            (hasSessionId && (
                typeof message.payload.session_id !== "string"
                || message.payload.session_id !== authority.sessionId
            ))
            || (hasTraceId && (
                typeof message.payload.trace_id !== "string"
                || message.payload.trace_id !== authority.traceId
            ))
        ) return null;
        return {
            ...message,
            payload: {
                ...message.payload,
                ...(hasSessionId ? {} : { session_id: authority.sessionId }),
                ...(hasTraceId ? {} : { trace_id: authority.traceId }),
            },
        };
    }

    private _isCurrentNativeOpenStageDispatch(dispatch: NativeOpenStageDispatch): boolean {
        return this.nativeOpenStageSlot?.token === dispatch.token
            && dispatch.streamGeneration === this.streamGeneration;
    }

    private _canDispatchNativeOpenStage(dispatch: NativeOpenStageDispatch): boolean {
        if (dispatch.streamGeneration !== this.streamGeneration) return false;
        if (!dispatch.stageAttemptGeneration) return true;
        return this._isCurrentStageAttemptAwaitingProof(dispatch.stageAttemptGeneration)
            && this.activeStageAttempt?.targetUrl === dispatch.targetUrl;
    }

    private _clearNativeOpenStageSlotTimeout(): void {
        if (this.nativeOpenStageSlotTimeoutId === null) return;
        window.clearTimeout(this.nativeOpenStageSlotTimeoutId);
        this.nativeOpenStageSlotTimeoutId = null;
    }

    private _failNativeOpenStageDispatch(
        dispatch: NativeOpenStageDispatch,
        diagnostic: string,
    ): void {
        if (
            dispatch.stageAttemptGeneration
            && this._isCurrentStageAttemptAwaitingProof(dispatch.stageAttemptGeneration)
        ) {
            this._failStageLoad(
                t(stageLoadFailurePresentation.title.zh, stageLoadFailurePresentation.title.en),
                diagnostic,
                dispatch.stageAttemptGeneration,
            );
        }
    }

    private _scheduleNativeOpenStageSlotTimeout(dispatch: NativeOpenStageDispatch): void {
        this._clearNativeOpenStageSlotTimeout();
        this.nativeOpenStageSlotTimeoutId = window.setTimeout(() => {
            if (!this._isCurrentNativeOpenStageDispatch(dispatch)) return;
            const queued = this.queuedNativeOpenStage;
            this.nativeOpenStageSlot = null;
            this.queuedNativeOpenStage = null;
            this.nativeOpenStageSlotTimeoutId = null;
            // The SDK callback map may still retain this response type. Do not
            // reuse this AppStreamer lifecycle until it is remounted.
            this.nativeOpenStagePoisonedGeneration = this.streamGeneration;
            this.nativeOpenStageReplacementStartGeneration = null;
            this._appendReviewEvent("openedStageResult SDK callback timed out; reconnect AppStreamer before retry");
            const latest = queued && this._canDispatchNativeOpenStage(queued) ? queued : dispatch;
            this._failNativeOpenStageDispatch(latest, "sdk_open_stage_slot_stuck; reconnect stream before retry");
        }, NATIVE_OPEN_STAGE_SLOT_TIMEOUT_MS);
    }

    private _retireNativeOpenStageDispatches(): void {
        this._clearNativeOpenStageSlotTimeout();
        this.nativeOpenStageSlot = null;
        this.queuedNativeOpenStage = null;
    }

    private _settleNativeOpenStageDispatch(dispatch: NativeOpenStageDispatch): void {
        if (!this._isCurrentNativeOpenStageDispatch(dispatch)) return;
        this._clearNativeOpenStageSlotTimeout();
        this.nativeOpenStageSlot = null;
        const queued = this.queuedNativeOpenStage;
        this.queuedNativeOpenStage = null;
        if (!queued || !this._canDispatchNativeOpenStage(queued)) return;
        if (!this._dispatchNativeOpenStage(queued)) {
            this._failNativeOpenStageDispatch(queued, "runtime_command_blocked");
        }
    }

    private _matchingNativeOpenStageDataChannelTerminal(
        responseEventType: string,
        payload: Record<string, unknown>,
    ): NativeOpenStageDispatch | null {
        const dispatch = this.nativeOpenStageSlot;
        if (
            !dispatch
            || !dispatch.settlesFromDataChannel
            || dispatch.outgoing.event_type !== "loadArtifactGroupRequest"
            || getPayloadString(payload, "request_id") !== dispatch.requestId
        ) return null;
        if (responseEventType === "commandRejected") {
            // commandRejected is a validated protocol terminal but intentionally
            // does not carry binding_revision_id. The current DataChannel trace,
            // exact request_id, and rejected event type are its correlation tuple.
            return getPayloadString(payload, "rejected_event_type") === dispatch.outgoing.event_type
                ? dispatch
                : null;
        }
        if (
            !dispatch.bindingRevisionId
            || getPayloadString(payload, "binding_revision_id") !== dispatch.bindingRevisionId
        ) return null;
        if (responseEventType === "openedStageResult") {
            const result = getPayloadString(payload, "result");
            return result === "success" || result === "error" ? dispatch : null;
        } else if (
            responseEventType !== "loadArtifactGroupResult"
            || getPayloadString(payload, "result") !== "error"
        ) {
            return null;
        }
        return dispatch;
    }

    private _settleNativeOpenStageDispatchFromDataChannel(
        responseEventType: string,
        payload: Record<string, unknown>,
    ): NativeOpenStageDispatch | null {
        const dispatch = this._matchingNativeOpenStageDataChannelTerminal(responseEventType, payload);
        if (!dispatch) return null;
        this._settleNativeOpenStageDispatch(dispatch);
        return dispatch;
    }

    private _dispatchNativeOpenStage(dispatch: NativeOpenStageDispatch): boolean {
        if (
            this.nativeOpenStageSlot
            || this.nativeOpenStagePoisonedGeneration === this.streamGeneration
            || !this._canDispatchNativeOpenStage(dispatch)
        ) return false;
        this.nativeOpenStageSlot = dispatch;
        this._scheduleNativeOpenStageSlotTimeout(dispatch);
        const dispatched = this._sendStreamMessage(
            dispatch.outgoing,
            dispatch,
        );
        if (!dispatched && this._isCurrentNativeOpenStageDispatch(dispatch)) {
            this._clearNativeOpenStageSlotTimeout();
            this.nativeOpenStageSlot = null;
        }
        return dispatched;
    }

    private _enqueueNativeOpenStage(
        outgoing: AppStreamMessageType | StreamMessage,
        onDispatched?: () => void,
    ): boolean {
        const payload = isRecord(outgoing.payload) ? outgoing.payload : {};
        const requestId = getPayloadString(payload, "request_id");
        if (!requestId) return false;
        const bindingRevisionId = getPayloadString(payload, "binding_revision_id");
        if (outgoing.event_type === "loadArtifactGroupRequest" && !bindingRevisionId) return false;
        const dispatch: NativeOpenStageDispatch = {
            token: ++this.nativeOpenStageSlotSequence,
            outgoing,
            streamGeneration: this.streamGeneration,
            stageAttemptGeneration: this.activeStageAttempt?.generation,
            targetUrl: getPayloadString(payload, "url"),
            requestId,
            bindingRevisionId,
            settlesFromDataChannel: outgoing.event_type === "loadArtifactGroupRequest",
            onDispatched,
        };
        if (this.nativeOpenStagePoisonedGeneration === this.streamGeneration) {
            this._appendReviewEvent("略過 stage request：AppStreamer callback lifecycle requires reconnect");
            return false;
        }
        if (this.nativeOpenStageSlot) {
            // Latest intent wins while retaining the in-flight SDK callback as
            // the sole completion authority for this lifecycle.
            this.queuedNativeOpenStage = dispatch;
            this._appendReviewEvent(`${outgoing.event_type} queued behind native openedStageResult SDK callback`);
            return true;
        }
        return this._dispatchNativeOpenStage(dispatch);
    }

    private _sendStreamMessage(
        message: AppStreamMessageType | StreamMessage,
        nativeOpenStageDispatch?: NativeOpenStageDispatch,
        activitySource: "background" | "user" = "user",
    ): boolean {
        const onDispatched = nativeOpenStageDispatch?.onDispatched
            || this.stageDispatchCallbacks.get(message);
        const tracedMessage = this._withVerifiedDataChannelTrace(message);
        if (!tracedMessage) return false;
        const blockReason = this._runtimeMutatorBlockReason(tracedMessage.event_type);
        if (blockReason) {
            this._appendReviewEvent(`略過 ${tracedMessage.event_type}：${blockReason}`);
            return false;
        }
        const outgoing = this._withRuntimeAuthority(tracedMessage);
        if (
            requestUsesNativeOpenedStageResult(outgoing.event_type)
            && !harnessEnabled()
            && !nativeOpenStageDispatch
            && this.activeStageAttempt
        ) {
            return this._enqueueNativeOpenStage(outgoing, onDispatched);
        }
        let runtimeRequestId = "";
        let runtimeStageAttemptGeneration: number | undefined;
        const isStageLoadRequest = outgoing.event_type === "openStageRequest"
            || outgoing.event_type === "loadArtifactGroupRequest";
        if (isRuntimeMutator(outgoing.event_type) && isRecord(outgoing.payload)) {
            const requestId = getPayloadString(outgoing.payload, "request_id");
            if (requestId) {
                if (this.runtimeCommandTerminalClaims.has(requestId) || this.runtimeCommandContexts.has(requestId)) {
                    this._appendReviewEvent(`略過 ${outgoing.event_type}：request_id 已使用`);
                    return false;
                }
                runtimeRequestId = requestId;
                const bindingRevisionId = getPayloadString(outgoing.payload, "binding_revision_id");
                const stageUrl = getPayloadString(outgoing.payload, "url");
                this.runtimeCommandContexts.set(requestId, {
                    eventType: outgoing.event_type,
                    ...(bindingRevisionId ? { bindingRevisionId } : {}),
                    ...(stageUrl ? { stageUrl } : {}),
                    ...(isStageLoadRequest && this.activeStageAttempt
                        ? { stageAttemptGeneration: this.activeStageAttempt.generation }
                        : {}),
                });
                runtimeStageAttemptGeneration = isStageLoadRequest
                    ? this.activeStageAttempt?.generation
                    : undefined;
                while (this.runtimeCommandContexts.size > 128) {
                    const oldest = this.runtimeCommandContexts.keys().next().value as string | undefined;
                    if (!oldest) break;
                    this.runtimeCommandContexts.delete(oldest);
                }
                this._recordRuntimeCommandPhase(requestId, outgoing.event_type, "pending");
            }
            this.setState({ runtimeCommandRejection: null });
        }
        const streamGenerationAtSend = this.streamGeneration;
        // #783（review P2）：native getChildren 回應沒有 stage 相關性。切換模型時 WebRTC
        // stream generation 與 session trace 都不變，_openSelectedAsset 又會先清空 usdPrims，
        // 於是舊 stage 遲到的回應會被 handler 當成新樹的 root 回應整棵換掉。送出時記下
        // stage intent / attempt generation，回來時任一變了就丟棄。
        const stageIntentGenerationAtSend = this.stageIntentGeneration;
        const stageAttemptGenerationAtSend = this.activeStageAttempt?.generation ?? null;
        // attempt 失敗／逾時只把 status 轉 terminal、不推進任何 generation；遲到的子節點
        // 回應不得在 viewer 已進入失敗態後重新填樹並送 makePrimsPickable。
        const stageAttemptWasTerminalAtSend = this.activeStageAttempt?.status === "terminal";
        let nativeTransportFailed = false;
        void AppStream.sendMessage(outgoing)
            .then((result) => {
                const responseEvent = appStreamResultToAppEvent(
                    outgoing.event_type,
                    result,
                    outgoing.payload,
                    Boolean(nativeOpenStageDispatch),
                );
                if (!responseEvent) return;
                if (outgoing.event_type === "getChildrenRequest") {
                    if (
                        this.stageIntentGeneration !== stageIntentGenerationAtSend
                        || (this.activeStageAttempt?.generation ?? null) !== stageAttemptGenerationAtSend
                    ) {
                        this._appendReviewEvent("略過遲到的 getChildrenResponse：stage 已切換");
                        return;
                    }
                    if (!stageAttemptWasTerminalAtSend && this.activeStageAttempt?.status === "terminal") {
                        this._appendReviewEvent("略過遲到的 getChildrenResponse：stage attempt 已終止");
                        return;
                    }
                    // 同一 stage 內：handler 對「樹裡找不到的 prim_path」一律當 root 回應整棵換掉
                    // （_findUSDPrimByPath === null → usdPrims = children）。這條只圍**借用 outbound
                    // trace** 的 trace-less native 回應——那是本 PR 新開的路，不得因此讓過期節點
                    // 的回應整棵換樹；帶真實 inbound trace 的回應維持既有行為。非 root 節點若已不在
                    // 目前的樹上（同 stage refresh 期間消失、或 request_stage_tree 指到過期節點）就丟。
                    const borrowedTrace = !(isRecord(result) && Object.prototype.hasOwnProperty.call(result, "trace_id"));
                    const requestedPrimPath = isRecord(outgoing.payload) ? getPayloadString(outgoing.payload, "prim_path") : "";
                    if (
                        borrowedTrace
                        && !NATIVE_ROOT_PRIM_PATHS.has(requestedPrimPath)
                        && this._findUSDPrimByPath(requestedPrimPath) === null
                    ) {
                        this._appendReviewEvent("略過 getChildrenResponse：請求的節點已不在目前的 stage 樹上");
                        return;
                    }
                }
                this._handleCustomEvent(responseEvent, streamGenerationAtSend);
            })
            .catch(() => {
                nativeTransportFailed = true;
                if (!this._isCurrentStreamCallback(streamGenerationAtSend, `${outgoing.event_type}-error`)) return;
                const diagnostic = "stream_transport_error";
                if (runtimeRequestId) {
                    if (!this._claimRuntimeCommandTerminal(runtimeRequestId, outgoing.event_type, "error")) return;
                    this._finishA4HandoffCommand(runtimeRequestId, "rejected", diagnostic, true);
                }
                this._appendReviewEvent(`${outgoing.event_type} failed: ${diagnostic}`);
                if (isStageLoadRequest) {
                    this._failStageLoad(
                        t(stageLoadFailurePresentation.title.zh, stageLoadFailurePresentation.title.en),
                        [
                            `${t(stageLoadFailurePresentation.target.zh, stageLoadFailurePresentation.target.en)}${t("：", ": ")}${redactStageUrlForDiagnostic(this.pendingStageUrl)}`,
                            `${t(stageLoadFailurePresentation.error.zh, stageLoadFailurePresentation.error.en)}${t("：", ": ")}${diagnostic}`,
                        ].join("\n"),
                        runtimeStageAttemptGeneration,
                    );
                }
            })
            .finally(() => {
                if (
                    nativeOpenStageDispatch
                    && (!nativeOpenStageDispatch.settlesFromDataChannel || nativeTransportFailed)
                ) {
                    this._settleNativeOpenStageDispatch(nativeOpenStageDispatch);
                }
            });
        onDispatched?.();
        this._appendDemoOutgoing(outgoing.event_type, { ...outgoing, payload: redactStreamPayload(outgoing.payload) });
        if (activitySource === "user") this._reportViewerActivity();
        return true;
    }

    private _dispatchStageRequest(
        message: AppStreamMessageType | StreamMessage,
        attemptGeneration: number,
        blockDiagnostic = "runtime_command_blocked",
    ): boolean {
        const onDispatched = () => {
            if (!this._isCurrentStageAttemptAwaitingProof(attemptGeneration)) return;
            this._scheduleStageLoadTimeout(attemptGeneration);
            this._scheduleLoadingStateQuery(1500);
        };
        this.stageDispatchCallbacks.set(message, onDispatched);
        let dispatched: boolean;
        try {
            dispatched = this._sendStreamMessage(message);
        } finally {
            this.stageDispatchCallbacks.delete(message);
        }
        if (dispatched === false && this._isCurrentStageAttemptAwaitingProof(attemptGeneration)) {
            this._failStageLoad(
                t(stageLoadFailurePresentation.title.zh, stageLoadFailurePresentation.title.en),
                blockDiagnostic,
                attemptGeneration,
            );
        }
        return dispatched;
    }

    private _scheduleStreamStartTimeout(): void {
        this._clearStreamStartTimeout();
        if (
            StreamConfig.source === "gfn"
            || !this.state.reviewSessionId
            || isBlockedLifecycle(this.state.reviewLifecycleStatus)
            || this.state.latestStreamConfig?.model.status !== "ready"
        ) return;
        this.streamStartTimeoutId = window.setTimeout(() => {
            this._handleStreamStartTimeout();
        }, reviewEnv.streamStartTimeoutMs);
    }

    private _clearStreamStartTimeout(): void {
        if (this.streamStartTimeoutId === null) return;
        window.clearTimeout(this.streamStartTimeoutId);
        this.streamStartTimeoutId = null;
    }

    private _scheduleStreamConfigRefresh(sessionId: string): void {
        this._clearStreamConfigRefresh();
        if (
            !this.componentMounted
            || this.state.reviewSessionId !== sessionId
            || isBlockedLifecycle(this.state.reviewLifecycleStatus)
            || this.state.latestStreamConfig?.model.status === "ready"
        ) return;
        this.streamConfigRefreshTimeoutId = window.setTimeout(() => {
            this.streamConfigRefreshTimeoutId = null;
            void this._refreshStreamConfig(sessionId);
        }, STREAM_CONFIG_REFRESH_INTERVAL_MS);
    }

    private async _refreshStreamConfig(sessionId: string): Promise<void> {
        try {
            const streamConfig = await this.coordinatorClient.getStreamConfig(sessionId);
            if (
                !this.componentMounted
                || this.state.reviewSessionId !== sessionId
                || isBlockedLifecycle(this.state.reviewLifecycleStatus)
                || streamConfig.session_id !== sessionId
                || streamConfig.trace_id !== this.state.latestStreamConfig?.trace_id
            ) return;

            const artifacts = streamConfig.artifacts;
            const usdAssets = this._mergeAssets(
                this._assetsFromArtifactBindings(streamConfig.artifact_bindings || []),
                this._assetsFromReviewArtifacts(artifacts),
            );
            const expectedStageUrl = expectedStageUrlFromStreamConfig(streamConfig);
            const expectedStageAsset = expectedStageUrl
                ? (usdAssets.find((asset) => asset.url === expectedStageUrl)
                    || { name: displayNameFromStageUrl(expectedStageUrl), url: expectedStageUrl })
                : null;
            const mergedUSDAssets = this._mergeAssets(
                this.state.usdAssets,
                expectedStageAsset ? [expectedStageAsset, ...usdAssets] : usdAssets,
            );
            const selectedUSDAsset = expectedStageAsset
                ?? usdAssets.find((asset) => asset.url === streamConfig.model.url)
                ?? usdAssets[0]
                ?? this.state.selectedUSDAsset;
            const activeStreamEndpoint = this._resolveStreamEndpoint(streamConfig);
            const streamEndpointChanged = !sameStreamEndpoint(this.state.activeStreamEndpoint, activeStreamEndpoint);
            const streamMountKey = streamEndpointChanged
                ? this._replaceStreamLifecycle()
                : this.streamGeneration;

            this.setState({
                reviewLifecycleStatus: streamConfig.lifecycle_status,
                reviewStatus: `${lifecycleStatusText(streamConfig.lifecycle_status)}，模型狀態：${streamConfig.model.status}`,
                reviewArtifacts: artifacts,
                latestStreamConfig: streamConfig,
                mappingUrl: this._resolveMappingUrl(streamConfig, artifacts),
                usdAssets: mergedUSDAssets,
                selectedUSDAsset,
                expectedStageUrl,
                loadedStageUrl: streamEndpointChanged ? null : this.state.loadedStageUrl,
                stageLoadStatus: streamEndpointChanged ? (expectedStageUrl ? "pending" : "unproven") : this.state.stageLoadStatus,
                isKitReady: streamEndpointChanged ? false : this.state.isKitReady,
                showStream: streamEndpointChanged ? false : this.state.showStream,
                webrtcLifecycleStatus: streamEndpointChanged ? "initializing" : this.state.webrtcLifecycleStatus,
                streamDiagnostic: streamEndpointChanged ? null : this.state.streamDiagnostic,
                activeStreamEndpoint,
                streamMountKey,
            }, () => {
                if (streamConfig.model.status === "ready" && !isBlockedLifecycle(streamConfig.lifecycle_status)) {
                    this._scheduleStreamStartTimeout();
                } else if (streamConfig.model.status === "missing" || streamConfig.model.status === "converting") {
                    if (!isBlockedLifecycle(streamConfig.lifecycle_status)) {
                        this._scheduleStreamConfigRefresh(sessionId);
                    }
                }
                if (
                    !streamEndpointChanged
                    && this.state.isKitReady
                    && this.state.selectedUSDAsset
                    && streamConfig.model.status === "ready"
                    && !isBlockedLifecycle(streamConfig.lifecycle_status)
                ) this._openSelectedAsset();
            });
        } catch (error) {
            console.warn("Stream config refresh unavailable.", error);
            if (
                this.componentMounted
                && this.state.reviewSessionId === sessionId
                && !isBlockedLifecycle(this.state.reviewLifecycleStatus)
            ) this._scheduleStreamConfigRefresh(sessionId);
        }
    }

    private _clearStreamConfigRefresh(): void {
        if (this.streamConfigRefreshTimeoutId === null) return;
        window.clearTimeout(this.streamConfigRefreshTimeoutId);
        this.streamConfigRefreshTimeoutId = null;
    }

    private _scheduleLoadingStateQuery(delayMs = 1000): void {
        this._clearLoadingStateRetry();
        this.loadingStateRetryId = window.setTimeout(() => {
            this.loadingStateRetryId = null;
            this._queryLoadingState();
        }, delayMs);
    }

    private _clearLoadingStateRetry(): void {
        if (this.loadingStateRetryId === null) return;
        window.clearTimeout(this.loadingStateRetryId);
        this.loadingStateRetryId = null;
    }

    private _scheduleStageLoadTimeout(attemptGeneration: number): void {
        for (const context of this.runtimeCommandContexts.values()) {
            if (
                (context.eventType === "openStageRequest" || context.eventType === "loadArtifactGroupRequest")
                && !context.stageAttemptGeneration
                && context.stageUrl === this.pendingStageUrl
            ) context.stageAttemptGeneration = attemptGeneration;
        }
        this._clearStageLoadTimeout();
        this.stageLoadTimeoutId = window.setTimeout(() => {
            this.stageLoadTimeoutId = null;
            if (!this._isCurrentStageAttemptAwaitingProof(attemptGeneration) || !this.pendingStageUrl) return;
            this._claimStageAttemptTimeout(attemptGeneration);
            this._failStageLoad(
                t(stageLoadTimeoutPresentation.title.zh, stageLoadTimeoutPresentation.title.en),
                [
                    `${t(stageLoadTimeoutPresentation.target.zh, stageLoadTimeoutPresentation.target.en)}${t("：", ": ")}${redactStageUrlForDiagnostic(this.pendingStageUrl)}`,
                    `${t(stageLoadTimeoutPresentation.diagnostic.zh, stageLoadTimeoutPresentation.diagnostic.en)}${t("：", ": ")}${this._getVideoDiagnosticText()}`,
                    t(stageLoadTimeoutPresentation.missingCompletion.zh, stageLoadTimeoutPresentation.missingCompletion.en),
                ].join("\n"),
                undefined,
                undefined,
                "stage-load-timeout",
            );
        }, STAGE_LOAD_TIMEOUT_MS);
    }

    private _clearStageLoadTimeout(): void {
        if (this.stageLoadTimeoutId === null) return;
        window.clearTimeout(this.stageLoadTimeoutId);
        this.stageLoadTimeoutId = null;
    }

    private _scheduleDeferredOpenStage(delayMs = 3000): void {
        this._clearDeferredOpenStage();
        this.deferredOpenStageId = window.setTimeout(() => {
            this.deferredOpenStageId = null;
            if (!this.state.showStream && !this._hasRemoteVideoFrame() && !this.state.isKitReady) {
                this._scheduleDeferredOpenStage(1000);
                return;
            }
            if (this._canOpenSelectedAsset()) {
                this._openSelectedAsset();
                return;
            }
            this._scheduleLoadingStateQuery(500);
        }, delayMs);
    }

    private _clearDeferredOpenStage(): void {
        if (this.deferredOpenStageId === null) return;
        window.clearTimeout(this.deferredOpenStageId);
        this.deferredOpenStageId = null;
    }

    private _replaceStreamLifecycle(): number {
        this.reviewSocket?.setStreamReady(false);
        this.setState({ idleCountdownRemainingSeconds: null });
        // Advance before stopping or remounting AppStream: its callbacks and sendMessage
        // continuations may settle synchronously while React still exposes the old state key.
        this.streamGeneration += 1;
        // The adapter serializes connect behind physical teardown. Keep native
        // stage dispatch fenced until the replacement lifecycle reports started.
        this.nativeOpenStagePoisonedGeneration = this.streamGeneration;
        this.nativeOpenStageReplacementStartGeneration = this.streamGeneration;
        this._retireNativeOpenStageDispatches();
        this._invalidateStageAttempt();
        const pendingA4HandoffRequestId = this.a4HandoffPendingRequestId;
        // Every outstanding command belongs to the retired stream. Its later
        // callback is generation-fenced, so terminalize it now instead of
        // leaving a visible pending lifecycle entry until map eviction.
        for (const [requestId, context] of this.runtimeCommandContexts.entries()) {
            this._claimRuntimeCommandTerminal(requestId, context.eventType, "superseded");
        }
        // The A4 command timeout only completes a request it can terminal-claim.
        // A stream replacement claims the runtime command first, so retire its
        // visible handoff explicitly and expose the existing retry path.
        if (pendingA4HandoffRequestId) {
            this._finishA4HandoffCommand(
                pendingA4HandoffRequestId,
                "rejected",
                "stream_lifecycle_superseded",
                true,
            );
        }
        this.pendingStageUrl = null;
        this.loadingStatePollCount = 0;
        this._clearStreamStartTimeout();
        this._clearPollForKitReady();
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this._clearDeferredOpenStage();
        return this.streamGeneration;
    }

    private _supersedeActiveStageAttempt(): void {
        const supersededAttempt = this.activeStageAttempt;
        if (!supersededAttempt) return;
        if (supersededAttempt && this._isCurrentStageAttemptAwaitingProof(supersededAttempt.generation)) {
            supersededAttempt.status = "terminal";
            this._finishStageLoad(supersededAttempt.generation);
            for (const [requestId, context] of this.runtimeCommandContexts.entries()) {
                if (context.stageAttemptGeneration === supersededAttempt.generation) {
                    this._claimRuntimeCommandTerminal(requestId, context.eventType, "superseded");
                }
            }
        }
        if (this.queuedNativeOpenStage?.stageAttemptGeneration === supersededAttempt.generation) {
            this.queuedNativeOpenStage = null;
        }
        this._revokeStageProof();
        this.activeStageAttempt = null;
    }

    private _beginStageAttempt(targetUrl: string): number {
        this._failPendingBindingApplyAsSuperseded();
        this.pendingStagePreauthorizationIntent = null;
        this.stageIntentGeneration += 1;
        this._supersedeActiveStageAttempt();
        const generation = ++this.stageAttemptGeneration;
        this._firstFramePosted = false;
        this.stageLoadFailureActive = false;
        this.stageLoadFailureReason = null;
        this.activeStageAttempt = {
            generation,
            status: "pending",
            targetUrl,
        };
        return generation;
    }

    private _isCurrentStageAttempt(generation: number | undefined, status?: StageAttemptStatus): boolean {
        return Boolean(
            generation
            && this.activeStageAttempt?.generation === generation
            && (!status || this.activeStageAttempt.status === status),
        );
    }

    private _isCurrentStageAttemptAwaitingProof(generation: number | undefined): boolean {
        return Boolean(
            generation
            && this.activeStageAttempt?.generation === generation
            && (this.activeStageAttempt.status === "pending" || this.activeStageAttempt.status === "provisional"),
        );
    }

    private _finishStageLoad(attemptGeneration?: number, preserveFirstFrame = false): void {
        if (attemptGeneration && !this._isCurrentStageAttempt(attemptGeneration)) return;
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this.pendingStageUrl = null;
        this.loadingStatePollCount = 0;
        // Important #2：stage 重載清理點同時歸零 first_frame 閂。否則同一 session 內換載另一個
        // stage（多模型切換）時第二次完成後 parent 收不到 first_frame / stage_loaded，
        // IX-A1-06 無法重滿足、「在 3D 高亮」鈕保持 disabled。重置後由 _completeStageLoad 的
        // 閂保證「每次真完成」各送一次（_failStageLoad 失敗路徑不送，誠實鐵律不變）。
        if (!preserveFirstFrame) this._firstFramePosted = false;
    }

    private _revokeStageProof(bindingRevisionId?: string): void {
        this.confirmedStageBindingRevision = null;
        this.setState({
            loadedStageUrl: null,
            stageLoadStatus: "unproven",
        });
        if (window.parent !== window) {
            this._postToParent({
                type: "stage_loaded",
                stageUrl: null,
                status: "unproven",
                ...(bindingRevisionId ? { binding_revision_id: bindingRevisionId } : {}),
            });
        }
    }

    private _applyChangedUnconfirmedStageSafety(
        bindingRevisionId: string | undefined,
        stageUrl: string | null | undefined,
        stageAttemptGeneration: number | null | undefined,
    ): void {
        const revision = bindingRevisionId || "unknown";
        const unprovenUrl = stageUrl || this.state.loadedStageUrl || this.pendingStageUrl;
        const changedUnconfirmedReviewEvent = t(
            runtimeRejectionReviewCopy.changedUnconfirmed.zh,
            runtimeRejectionReviewCopy.changedUnconfirmed.en,
        );
        const changedUnconfirmedBindingReason = t(
            runtimeRejectionPresentation.stageUnproven.zh,
            runtimeRejectionPresentation.stageUnproven.en,
        );
        this.stageProofBlockGeneration += 1;
        this.stageProofBlockedRevision = revision;
        this.confirmedStageBindingRevision = null;
        this.unprovenStageUrl = unprovenUrl;
        if (this.activeStageAttempt) this.activeStageAttempt.statusResyncRevision = undefined;
        if (stageAttemptGeneration) {
            this._terminalizeStageAttempt(stageAttemptGeneration, bindingRevisionId);
        } else if (!this.activeStageAttempt || this.activeStageAttempt.status === "completed") {
            // A correlated non-stage mutation can invalidate the current
            // completed proof, but it has no authority to terminalize a newer
            // pending/provisional stage attempt.
            this._revokeStageProof(bindingRevisionId);
        }
        this.setState((state) => ({
            loadedStageUrl: null,
            stageLoadStatus: "unproven",
            govBindingApplyState: {
                status: "failed",
                reason: changedUnconfirmedBindingReason,
            },
            reviewEvents: [...state.reviewEvents, changedUnconfirmedReviewEvent].slice(-80),
        }));
        if (bindingRevisionId) void this._resyncStageBindingProof();
    }

    private _applyChangedFailedStageSafety(
        context: RuntimeCommandContext | undefined,
        bindingRevisionId: string | undefined,
        stageUrl: string,
        error: string,
    ): boolean {
        if (!context) return false;
        const attemptGeneration = context.stageAttemptGeneration;
        const activeAttempt = this.activeStageAttempt;
        if (
            attemptGeneration
            && activeAttempt
            && (
                activeAttempt.generation !== attemptGeneration
                || activeAttempt.status === "completed"
            )
        ) return false;
        if (!attemptGeneration && activeAttempt && activeAttempt.status !== "completed") return false;

        this.stageProofBlockGeneration += 1;
        this.stageProofBlockedRevision = null;
        this.confirmedStageBindingRevision = null;
        this.unprovenStageUrl = null;
        if (attemptGeneration && this._isCurrentStageAttemptAwaitingProof(attemptGeneration)) {
            this._terminalizeStageAttempt(attemptGeneration, bindingRevisionId);
        } else {
            this._revokeStageProof(bindingRevisionId);
        }
        this._clearPendingBindingApplyForAttempt(attemptGeneration);
        this.stageLoadFailureActive = true;
        this.stageLoadFailureReason = null;
        this.setState((state) => ({
            loadingText: "模型組合僅部分套用",
            streamDiagnostic: [
                `目標：${redactStageUrlForDiagnostic(stageUrl || context.stageUrl)}`,
                `錯誤：${error}`,
            ].join("\n"),
            showStream: this._hasRemoteVideoFrame(),
            isLoading: false,
            loadedStageUrl: null,
            stageLoadStatus: "unproven",
            runtimeCommandRejection: null,
            govBindingActiveRevision: null,
            govBindingApplyState: {
                status: "failed",
                reason: "runtime_changed_transaction_failed",
            },
            reviewEvents: [
                ...state.reviewEvents,
                "runtime changed_failed；已清除active evidence並阻擋handoff",
            ].slice(-80),
        }));
        return true;
    }

    private _terminalizeStageAttempt(
        attemptGeneration: number | null | undefined,
        bindingRevisionId?: string,
    ): void {
        if (!attemptGeneration) return;
        if (attemptGeneration && !this._isCurrentStageAttemptAwaitingProof(attemptGeneration)) {
            // A post-completion binding transaction (composeStageRequest) has
            // no stageAttemptGeneration of its own. Its changed terminal must
            // still withdraw the current completed stage proof, but must never
            // revoke a newer attempt that superseded this one.
            if (this._isCurrentStageAttempt(attemptGeneration, "completed")) {
                this._revokeStageProof(bindingRevisionId);
            }
            return;
        }
        if (this.activeStageAttempt && attemptGeneration === this.activeStageAttempt.generation) {
            this.activeStageAttempt.status = "terminal";
        }
        this._finishStageLoad(attemptGeneration);
        this._revokeStageProof(bindingRevisionId);
    }

    private _invalidateStageAttempt(): void {
        this._failPendingBindingApplyAsSuperseded();
        this.pendingStagePreauthorizationIntent = null;
        this.stageIntentGeneration += 1;
        const attemptGeneration = this.activeStageAttempt?.generation;
        if (
            !attemptGeneration
            || this.queuedNativeOpenStage?.stageAttemptGeneration === attemptGeneration
        ) {
            this.queuedNativeOpenStage = null;
        }
        this._revokeStageProof();
        if (!attemptGeneration) {
            this.stageLoadFailureActive = false;
            this.stageLoadFailureReason = null;
            return;
        }
        this.stageAttemptGeneration = Math.max(this.stageAttemptGeneration, attemptGeneration) + 1;
        if (this.activeStageAttempt?.status === "pending" || this.activeStageAttempt?.status === "provisional") {
            this.activeStageAttempt.status = "terminal";
        }
        this._finishStageLoad(attemptGeneration);
        for (const [requestId, context] of this.runtimeCommandContexts.entries()) {
            if (context.stageAttemptGeneration === attemptGeneration) {
                this._claimRuntimeCommandTerminal(requestId, context.eventType, "superseded");
            }
        }
        // A reconnect must accept its new no-URL readiness probe. Keeping a
        // terminal attempt here would reject that probe, while clearing it
        // still rejects any old correlated result by generation mismatch.
        this.activeStageAttempt = null;
        this.stageLoadFailureActive = false;
        this.stageLoadFailureReason = null;
    }

    private _failPendingBindingApplyAsSuperseded(): void {
        const pendingApplyGeneration = this.pendingBindingApplyGeneration;
        if (!pendingApplyGeneration) return;
        this.pendingBindingApplyGeneration = null;
        this.pendingBindingApplyStageAttemptGeneration = null;
        if (this.bindingApplyGeneration !== pendingApplyGeneration) return;
        this.setState((state) => (
            state.govBindingApplyState?.status === "applying"
                ? {
                    govBindingApplyState: {
                        status: "failed" as const,
                        reason: "stage_binding_apply_superseded",
                    },
                    reviewEvents: [
                        ...state.reviewEvents,
                        "binding apply superseded before coordinator preauthorization completed",
                    ].slice(-80),
                }
                : null
        ));
    }

    private _clearPendingBindingApplyForAttempt(attemptGeneration: number | null | undefined): void {
        if (!attemptGeneration || this.pendingBindingApplyStageAttemptGeneration !== attemptGeneration) return;
        this.pendingBindingApplyGeneration = null;
        this.pendingBindingApplyStageAttemptGeneration = null;
    }

    private _canApplyLoadingStateResponse(stageUrl: string): boolean {
        // An uncorrelated loading-state probe must not consume an attempt while
        // coordinator preauthorization still owns whether a Kit command exists.
        if (this.pendingStagePreauthorizationIntent === this.stageIntentGeneration) return false;
        const attempt = this.activeStageAttempt;
        if (!attempt) {
            // A terminal preauthorization failure has no command/attempt to
            // correlate. Keep it terminal until an explicit new stage intent.
            return !this.stageLoadFailureActive
                && this.state.webrtcLifecycleStatus === "started";
        }
        if (attempt.status === "terminal") return false;
        if (!stageUrl) return false;
        return stageUrl === attempt.targetUrl;
    }

    private _claimStageAttemptTimeout(attemptGeneration: number): void {
        if (this._isCurrentStageAttemptAwaitingProof(attemptGeneration) && this.activeStageAttempt) {
            this.activeStageAttempt.terminalReason = "stage-load-timeout";
        }
        for (const [requestId, context] of this.runtimeCommandContexts.entries()) {
            if (context.stageAttemptGeneration === attemptGeneration) {
                this._claimRuntimeCommandTerminal(requestId, context.eventType, "timed-out");
            }
        }
    }

    private _expectedStageAsset(): USDAssetType | null {
        const expectedStageUrl = this.state.expectedStageUrl;
        if (!expectedStageUrl) return null;
        return this.state.usdAssets.find((asset) => asset.url === expectedStageUrl)
            || { name: displayNameFromStageUrl(expectedStageUrl), url: expectedStageUrl };
    }

    private _isLoadedStageExpected(loadedUrl: string): boolean {
        const expectedStageUrl = this.state.expectedStageUrl || this.pendingStageUrl;
        if (!expectedStageUrl || !loadedUrl) return false;
        if (loadedUrl === expectedStageUrl) return true;
        const conversionJobId = this.state.latestStreamConfig?.model.conversion_job_id;
        return Boolean(conversionJobId && expectedStageUrl.includes(conversionJobId) && loadedUrl.includes(conversionJobId));
    }

    private _recordLoadedStageEvidence(loadedUrl: string, source: string, loadingState?: string): boolean {
        if (!loadedUrl) return false;
        const matched = this._isLoadedStageExpected(loadedUrl);
        const stageProven = harnessEnabled() || Boolean(this.confirmedStageBindingRevision);
        this.setState((state) => ({
            loadedStageUrl: loadedUrl,
            stageLoadStatus: matched ? (stageProven ? "matched" : "unproven") : "mismatch",
            reviewEvents: [
                ...state.reviewEvents,
                matched
                    ? `Kit stage-load matched expected URL (${source})`
                    : `stale_stage_or_mismatch (${source})`,
            ].slice(-80),
        }));
        if (!matched) {
            this._failStageLoad(
                "stale_stage_or_mismatch",
                [
                    `expected：${redactStageUrlForDiagnostic(this.state.expectedStageUrl || this.pendingStageUrl)}`,
                    `loaded：${redactStageUrlForDiagnostic(loadedUrl)}`,
                    `state：${loadingState || "unknown"}`,
                ].join("\n"),
            );
        }
        return matched;
    }

    private _completeStageLoad(loadedUrl?: string, bindingRevisionId?: string, attemptGeneration?: number): void {
        const currentAttempt = attemptGeneration ?? this.activeStageAttempt?.generation;
        if (currentAttempt && !this._isCurrentStageAttemptAwaitingProof(currentAttempt)) return;
        const promotingProvisional = Boolean(
            currentAttempt
            && this._isCurrentStageAttempt(currentAttempt, "provisional"),
        );
        // ⚠️ 誠實鐵律：finalLoadedUrl 只取「Kit 真回報過的 loaded URL」（呼叫參數或既有 state.loadedStageUrl），
        // 不得 fallback 成 pendingStageUrl。pendingStageUrl 只是「我們請求載入的目標」，不是 Kit 證實已載入的事實。
        // Visible-stream fallback never calls this completion path: it remains provisional
        // until Kit supplies an exact URL through a correlated openedStageResult.
        const finalLoadedUrl = loadedUrl || this.state.loadedStageUrl;
        const hasExpectedStage = Boolean(this.state.expectedStageUrl);
        const matched = finalLoadedUrl ? this._isLoadedStageExpected(finalLoadedUrl) : !hasExpectedStage;
        const activeRevision = bindingRevisionId || this.confirmedStageBindingRevision;
        const stageProven = harnessEnabled() || Boolean(activeRevision);
        const active = matched && stageProven;
        if (this.activeStageAttempt && currentAttempt === this.activeStageAttempt.generation) {
            this.activeStageAttempt.status = "completed";
        }
        this.stageLoadFailureActive = false;
        this.stageLoadFailureReason = null;
        this._finishStageLoad(currentAttempt, promotingProvisional);
        this._getChildren();
        this.setState({
            showStream: true,
            loadingText: active ? "模型已載入" : "模型畫面可見，stage authority 尚未證明",
            showUI: true,
            isLoading: false,
            streamDiagnostic: active ? null : `expected：${redactStageUrlForDiagnostic(this.state.expectedStageUrl)}\nloaded：${finalLoadedUrl ? redactStageUrlForDiagnostic(finalLoadedUrl) : "not_observed"}`,
            loadedStageUrl: finalLoadedUrl || null,
            stageLoadStatus: active ? "matched" : "unproven",
        });
        // T3：stage 就緒後，非 debug 一般檢視也自動載入 element_mapping（否則 _mappingCache 恆 null，
        // overlay 標示永遠 unmapped）。僅在「有 mapping_url 且該 url 尚未載入」時觸發；無 mapping_url 不做事
        // （overlay 誠實顯示 unmapped / coverage 未知）。不改既有 stage-load 流程與 debug onLoadMapping 路徑。
        this._maybeAutoLoadMapping();
        // VG-01 M1：first_frame 每個 attempt 只送一次；provisional frame 已送過時，
        // 精確 stage 證據只補送 active stage_loaded，不重送 first_frame。
        if (window.parent !== window) {
            if (!this._firstFramePosted) {
                this._firstFramePosted = true;
                this._postToParent({ type: "first_frame", stageUrl: finalLoadedUrl ?? null });
            }
            this._postToParent({
                type: "stage_loaded",
                stageUrl: active ? finalLoadedUrl ?? null : null,
                status: active ? "active" : "unproven",
                ...(activeRevision ? { binding_revision_id: activeRevision } : {}),
            });
        }
    }

    // T3：自動載入 element_mapping 的守門。reuse _loadElementMapping（其內以 _mappingCacheUrl 守重建），
    // 此處只負責「避免對同一 url 重複起 fetch」。誠實：無 mapping_url 時不觸發（不捏造對映）。
    private _maybeAutoLoadMapping(): void {
        const mappingUrl = this.state.mappingUrl || this._resolveMappingUrl(this.state.latestStreamConfig, this.state.reviewArtifacts);
        if (!mappingUrl) return; // 無 mapping_url → 誠實不做事（overlay 顯示 unmapped / coverage 未知）。
        if (this._mappingCacheUrl === mappingUrl) return; // 該 url 已載入 → 不重複拉。
        void this._loadElementMapping();
    }

    private _completeStageLoadFromVisibleStream(): boolean {
        const attemptGeneration = this.activeStageAttempt?.generation
            ?? this._beginStageAttempt(this.pendingStageUrl || "");
        if (!attemptGeneration || !this._isCurrentStageAttempt(attemptGeneration, "pending") || !this.pendingStageUrl || !this._hasRemoteVideoFrame()) return false;
        if (this.activeStageAttempt) this.activeStageAttempt.status = "provisional";
        this._clearLoadingStateRetry();
        this.loadingStatePollCount = 0;
        // A visible frame is provisional evidence. Keep polling for correlated stage
        // proof, but do not replace or extend the original hard terminal deadline.
        this._scheduleLoadingStateQuery(1000);
        this.setState((state) => ({
            showStream: true,
            loadingText: "模型畫面可見，stage authority 尚未證明",
            showUI: true,
            isLoading: false,
            streamDiagnostic: `expected：${redactStageUrlForDiagnostic(this.state.expectedStageUrl || this.pendingStageUrl)}\nloaded：not_observed`,
            loadedStageUrl: null,
            stageLoadStatus: "unproven",
            reviewEvents: [...state.reviewEvents, "WebRTC 畫面已可見，等待精確 stage 證據"],
        }));
        if (window.parent !== window) {
            if (!this._firstFramePosted) {
                this._firstFramePosted = true;
                this._postToParent({ type: "first_frame", stageUrl: null });
            }
            this._postToParent({ type: "stage_loaded", stageUrl: null, status: "unproven" });
        }
        return true;
    }

    private _failStageLoad(
        loadingText: string,
        diagnostic?: string,
        attemptGeneration: number | null | undefined = this.activeStageAttempt?.generation,
        bindingFailureReason = loadingText,
        reasonCode?: "stage-load-timeout",
    ): void {
        const invalidatesStageProof = Boolean(
            attemptGeneration && this._isCurrentStageAttemptAwaitingProof(attemptGeneration),
        );
        const failedAttemptGeneration = attemptGeneration === null
            ? null
            : attemptGeneration ?? this.activeStageAttempt?.generation;
        if (attemptGeneration !== null) {
            if (attemptGeneration && !this._isCurrentStageAttemptAwaitingProof(attemptGeneration)) return;
            this._terminalizeStageAttempt(attemptGeneration);
            this._clearPendingBindingApplyForAttempt(failedAttemptGeneration);
        }
        this.stageLoadFailureActive = true;
        this.stageLoadFailureReason = reasonCode ?? null;
        this.setState((state) => ({
            loadingText,
            streamDiagnostic: diagnostic || null,
            showStream: this._hasRemoteVideoFrame(),
            isLoading: false,
            loadedStageUrl: invalidatesStageProof ? null : state.loadedStageUrl,
            stageLoadStatus: loadingText === "stale_stage_or_mismatch"
                ? "mismatch"
                : (invalidatesStageProof ? "unproven" : state.stageLoadStatus),
            reviewEvents: [...state.reviewEvents, loadingText],
            ...(state.govBindingApplyState?.status === "applying"
                ? { govBindingApplyState: { status: "failed" as const, reason: bindingFailureReason } }
                : {}),
        }));
        if (window.parent !== window && !invalidatesStageProof) {
            this._postToParent({ type: "stage_loaded", stageUrl: null, status: "unproven" });
        }
    }

    private _getVideoDiagnosticText(): string {
        const video = document.getElementById("remote-video") as HTMLVideoElement | null;
        if (!video) {
            return "remote-video element not found";
        }

        return [
            `readyState=${video.readyState}`,
            `networkState=${video.networkState}`,
            `paused=${video.paused}`,
            `currentTime=${video.currentTime.toFixed(2)}`,
            `videoWidth=${video.videoWidth}`,
            `videoHeight=${video.videoHeight}`,
            `srcObject=${video.srcObject ? "true" : "false"}`,
        ].join(", ");
    }

    private _hasRemoteVideoFrame(): boolean {
        const videos = ["remote-video", "gfn-stream-player-video"]
            .map((id) => document.getElementById(id) as HTMLVideoElement | null)
            .filter((video): video is HTMLVideoElement => video !== null);
        return videos.some((video) => (
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            && video.videoWidth > 0
            && video.videoHeight > 0
        ));
    }

    // 統一治理控制台 MVP：治理失敗構件 → HighlightBridge 經既有 DataChannel 在 3D 標紅（client 主動拉）。
    // MappingCache 未載入時誠實回 unmapped（沒有對映可標示，不捏造 prim、不假裝成功）。
    private _overlayHighlight(failed: FailedElement): HighlightResult {
        if (!this._mappingCache) {
            return { ok: false, reason: "unmapped" };
        }
        const bridge = new HighlightBridge({
            cache: this._mappingCache,
            sendMessage: (m) => this._sendStreamMessage(m),
            dataChannelReady: () => this.state.showStream && this._hasRemoteVideoFrame(),
        });
        const res = bridge.highlightFailed(failed);
        // W2：送出成功只代表「已送出」，Kit 是否真的選到該構件由 highlightPrimsResult 非同步確認。
        // 記下 requestId → (ifc_guid, rowKey, primPath)，待回應比對 selected/missing 後寫 govHighlightConfirm。
        if (res.ok) {
            // F1：rowKey 鏡像 overlay 的 `${rule_code ?? "norule"}::${ifc_guid}`，每列獨立確認。
            const rowKey = `${failed.rule_code ?? "norule"}::${failed.ifc_guid}`;
            this._pendingGovHighlights[res.requestId] = { ifc_guid: failed.ifc_guid, rowKey, primPath: res.primPath };
        }
        return res;
    }

    // A2 F2⑥ 批次疊加：多構件裝進「一個」highlightPrimsRequest → Kit 端一次 set_selected_prim_paths
    // 聯集選取（逐筆各發 replace request 會互相清除，見 highlightBridge.highlightMany 註）。
    // 不掛 _pendingGovHighlights per-row 確認（W2 機制是 GovernanceOverlay 逐列確認用；批次 ack 為
    // 送達層級，selected/missing 細節仍由 highlightPrimsResult 流入既有 handler 誠實記錄事件）。
    private _overlayHighlightMany(failedList: FailedElement[]): HighlightManyResult {
        if (!this._mappingCache) {
            return { ok: false, reason: "unmapped" };
        }
        const bridge = new HighlightBridge({
            cache: this._mappingCache,
            sendMessage: (m) => this._sendStreamMessage(m),
            dataChannelReady: () => this.state.showStream && this._hasRemoteVideoFrame(),
        });
        return bridge.highlightMany(failedList);
    }

    // VG-01（M5）：parent origin 由 document.referrer parse（交叉驗），須在 VITE_ALLOWED_COORDINATOR_ORIGINS 白名單內。
    private _consoleParentOrigin(): string | null {
        try { return document.referrer ? new URL(document.referrer).origin : null; } catch { return null; }
    }

    // VG-01：對 parent（console iframe 容器）送訊息。非嵌入或無可信 parent origin → 不送（不對 "*" 廣播，守跨 origin 安全）。
    // Important #3：可選 allowedOriginsCache —— _handleParentMessage 的 highlight 迴圈每筆都呼一次本方法，
    // 不傳時每次都重 parse env / split / normalize / new Set。caller 已建白名單時傳入複用（行為不變，省重複工作）。
    private _postToParent(msg: Record<string, unknown>, allowedOriginsCache?: ReadonlySet<string>): void {
        if (window.parent === window) return; // 非嵌入（standalone viewer）：早返，免每次 3D 點選都無謂 parse document.referrer
        const origin = this._consoleParentOrigin();
        if (!origin) return;
        const allowed = allowedOriginsCache ?? allowedCoordinatorOrigins();
        if (!allowed.has(origin)) {
            // Important #3：白名單為空（多半是 deploy 忘設 VITE_ALLOWED_COORDINATOR_ORIGINS）時，
            // viewer 對任何 parent origin 都 reject → 永遠送不出 viewer_ready / first_frame，A1 高亮鈕永不 enable
            // 卻無任何線索。此處留一次性 console.warn 作診斷（不改安全行為：仍不對未授權 origin 送）。
            if (allowed.size === 0 && !this._postToParentEmptyAllowlistWarned) {
                this._postToParentEmptyAllowlistWarned = true;
                console.warn(
                    "[VG-01] VITE_ALLOWED_COORDINATOR_ORIGINS 為空：viewer 無法對 console 送 viewer_ready/first_frame，" +
                    `A1「在 3D 高亮」鈕將永不啟用（parent origin=${origin}）。請於 deploy 設定該 env var。`,
                );
            }
            return; // 白名單守衛（複用 env.ts 來源）
        }
        window.parent.postMessage({ protocol: "vg01", ...msg }, origin);
    }

    // VG-01：viewer 端 parent postMessage listener。嚴格 additive：通過守衛後才走既有路徑（_overlayHighlight / focusPrim /
    // clearHighlight）；不改 AppStream / GovernanceOverlay props 形狀 / spectator 既有路徑。
    private _handleParentMessage(e: MessageEvent): void {
        const isEmbedded = window.parent !== window;
        // Important #3：一次 parse 白名單供守衛與後續 _postToParent 共用（同一 call stack 內 env 不變，避免重複 new Set）。
        const allowedOrigins = allowedCoordinatorOrigins();
        if (!shouldAcceptParentMessage(e, allowedOrigins, isEmbedded)) return;
        if (e.origin !== this._consoleParentOrigin()) return; // 再交叉驗：event.origin 須等於 referrer parent origin
        // Important #1：canOperate / spectator 守衛是「全部 mutating handler」的共同要求（spec §2.2），非僅 highlight。
        // 與 render / highlight 用同一 deriveOverlayInputs：spectator 或未就緒（無 issues 分頁 / 無串流 / lifecycle 非 active）
        // 一律靜默丟棄，不送任何 mutating 指令（focus / clear 亦在 _sendStreamMessage 的 mutatingEvents 內，誠實鐵律：
        // spectator 不送 mutating，見 _onSelectUSDPrims 的 CH-B gate）。
        const lifecycle = this.state.reviewLifecycleStatus;
        const lifecycleActive = lifecycle === "active" || lifecycle === "created";
        const issuesTabReady = this.state.viewerTab === "issues" && Boolean(this.state.reviewSessionId);
        const inputs = deriveOverlayInputs({
            spectator: isSpectatorStreamMode(),
            streamReady: harnessEnabled() || this._hasRemoteVideoFrame() || issuesTabReady,
            lifecycleActive,
        });
        const canOperate = canHandleHighlight(inputs.panelState.canOperate);
        const m = e.data as {
            type?: string;
            items?: unknown;
            ifc_guid?: string;
            token?: unknown;
            user_token?: unknown;
            clientRequestId?: unknown;
            prim_path?: string;
            action?: string;
            camera_view?: string;
            multi_select?: boolean;
        };
        // 僅做 console↔iframe 的本地 ACK 關聯；Kit runtime 的 requestId 仍由
        // _overlayHighlight / _overlayHighlightMany 產生，絕不以瀏覽器輸入覆寫。
        const clientRequestId = typeof m.clientRequestId === "string"
            && m.clientRequestId.length > 0
            && m.clientRequestId.length <= 200
            ? m.clientRequestId
            : null;
        if (m.type === "viewer_lease_token") {
            if (typeof m.token !== "string") return;
            const previousToken = reviewEnv.viewerLeaseToken;
            const previousUserToken = reviewEnv.userToken;
            const nextToken = m.token;
            const nextUserToken = typeof m.user_token === "string" ? m.user_token : previousUserToken;
            reviewEnv.viewerLeaseToken = nextToken;
            reviewEnv.userToken = nextUserToken;
            const completeAuthorityAvailable = Boolean(nextToken && nextUserToken);
            const authorityChanged = nextToken !== previousToken || nextUserToken !== previousUserToken;
            if (
                completeAuthorityAvailable
                && authorityChanged
                && isEmbedded
                && this.state.stageLoadStatus !== "matched"
                && this._canOpenSelectedAsset()
            ) {
                // Reuse the existing scheduler so a late trusted lease replaces
                // any older timer and cannot create a parallel open path.
                this._scheduleDeferredOpenStage(0);
            }
            return;
        }
        switch (m.type) {
            case "highlight": {
                if (!canOperate) return; // spectator / 未就緒靜默丟棄
                // Important #2：postMessage 跨 origin 反序列化，TS cast 不做執行期檢查。origin 已驗白名單，
                // payload 也須驗：items 非陣列直接丟棄；每筆須是帶字串 ifc_guid 的物件，否則跳過該筆
                // （不把非法 FailedElement 餵進 _overlayHighlight / HighlightBridge）。
                if (!Array.isArray(m.items)) return;
                for (const raw of m.items) {
                    if (!isHighlightItem(raw)) continue; // 非法 item（null / 數字 / 缺 ifc_guid）跳過
                    const res = this._overlayHighlight(raw);
                    this._postToParent({
                        type: "highlight_result",
                        requestId: res.ok ? res.requestId : "",
                        ...(clientRequestId ? { clientRequestId } : {}),
                        ok: res.ok,
                        ...(res.ok ? {} : { reason: res.reason }),
                    }, allowedOrigins); // Important #3：複用本 call stack 已建白名單，免迴圈內重 parse
                }
                break;
            }
            case "highlight_batch": {
                if (!canOperate) return; // spectator / 未就緒靜默丟棄（與 highlight 同一守衛）
                // 與 highlight 同一 payload 執行期守衛：items 非陣列丟棄；非法 item（缺字串 ifc_guid）跳過。
                if (!Array.isArray(m.items)) return;
                const validItems = m.items.filter(isHighlightItem);
                if (validItems.length === 0) return;
                // 批次 = 單一 highlightPrimsRequest（Kit 聯集選取）；回「一個」批次層級 highlight_result，
                // 帶 sent_count / unmapped_count / unmapped_guids 誠實計數（console 端據以顯示，不虛報）。
                const batchRes = this._overlayHighlightMany(validItems);
                this._postToParent({
                    type: "highlight_result",
                    requestId: batchRes.ok ? batchRes.requestId : "",
                    ...(clientRequestId ? { clientRequestId } : {}),
                    ok: batchRes.ok,
                    ...(batchRes.ok
                        ? {
                            sent_count: batchRes.sent.length,
                            unmapped_count: batchRes.unmapped.length,
                            unmapped_guids: batchRes.unmapped,
                        }
                        : { reason: batchRes.reason }),
                }, allowedOrigins);
                break;
            }
            case "focus":
                if (!canOperate) return; // spectator / 未就緒靜默丟棄（不送 focusPrimRequest）
                // 對齊 highlight 的 isHighlightItem 嚴格守衛：postMessage 跨 origin 反序列化，TS cast 不做執行期
                // 檢查；非字串 ifc_guid（如 {toString} 物件）須擋在 primPathForGuid 之前，避免與 highlight 守衛不對稱。
                if (typeof m.ifc_guid === "string" && m.ifc_guid) {
                    // 既有反查 / focus 路徑：ifc_guid → primPath 後送 focusPrim（沿用 _overlayHighlight 內的 cache 解析慣例）。
                    const primPath = this._mappingCache?.primPathForGuid(m.ifc_guid) ?? null;
                    if (primPath) this._sendStreamMessage(buildFocusPrimRequest(primPath));
                }
                break;
            case "clear":
                if (!canOperate) return; // spectator / 未就緒靜默丟棄（不送 clearHighlightRequest）
                this._sendStreamMessage(buildClearHighlightRequest());
                break;
            case "request_stage_tree": {
                const primPath = typeof m.prim_path === "string" && m.prim_path ? m.prim_path : "/World";
                if (this.state.usdPrims && this.state.usdPrims.length > 0) {
                    this._postToParent({
                        type: "stage_tree",
                        prim_path: primPath,
                        children: this.state.usdPrims,
                    }, allowedOrigins);
                }
                if (canOperate || harnessEnabled()) {
                    this._getChildren(primPath === "/World" ? null : { path: primPath, name: primPath });
                }
                break;
            }
            case "select_prim": {
                if (!canOperate && !harnessEnabled()) return;
                if (typeof m.prim_path === "string" && m.prim_path) {
                    const prim = { path: m.prim_path, name: m.prim_path };
                    this._onSelectUSDPrims(new Set([prim]));
                }
                break;
            }
            case "toolbar_action": {
                if (typeof m.action === "string") {
                    if (m.action === "reset_camera") {
                        this._onStageReset();
                    } else if (m.action === "toggle_fullscreen") {
                        if (!document.fullscreenElement) {
                            void document.documentElement.requestFullscreen?.().catch(() => {});
                        } else {
                            void document.exitFullscreen?.().catch(() => {});
                        }
                    }
                }
                break;
            }
            default:
                break; // 未知 type 忽略（協定前向相容）
        }
    }

    // W1：A3 rule-run —— 由當前 review session 起跑（coordinator 端解析 server IFC 路徑），輪詢狀態，
    // succeeded 後取 failed 結果映射成 FailedElement 餵 overlay。誠實：無 session / 失敗都據實表態。
    private async _runGovernanceRuleCheck(): Promise<void> {
        // R1：禁止重入（避免重複觸發多條輪詢）。running 中再點直接忽略。
        if (this.state.govRuleCheck?.status === "running") return;
        const sessionId = this.state.reviewSessionId;
        if (!sessionId) {
            this.setState({ govRuleCheck: { status: "error", error: "尚無 review session" } });
            return;
        }
        // R1：開新 run 前清空上一輪殘留狀態（failed 構件 / 確認 / issue / runId / pending highlights），
        // 避免舊結果殘留誤導操作員。
        this._pendingGovHighlights = {};
        this.setState({
            govRuleCheck: { status: "running" },
            govFailedElements: [],
            govHighlightConfirm: {},
            govIssueCreate: undefined,
            govRuleRunId: undefined,
        });
        this._appendReviewEvent("A3 規則檢核：建立 rule-run（for-session）");
        try {
            const { rule_run_id } = await governanceClient.createRuleRunForSession(sessionId);
            this.setState({ govRuleRunId: rule_run_id });
            // 輪詢最多 60×1s（沿用 IssuesRuleCenterPage.doRun 節奏）。
            let status: RuleRunStatus | null = null;
            for (let i = 0; i < 60; i++) {
                status = await governanceClient.getRuleRun(rule_run_id);
                if (status.status === "succeeded" || status.status === "failed") break;
                await new Promise((r) => setTimeout(r, 1000));
            }
            if (!status || status.status === "failed") {
                this.setState({ govRuleCheck: { status: "failed" } });
                this._appendReviewEvent("A3 規則檢核：rule-run 回報 failed");
                return;
            }
            if (status.status !== "succeeded") {
                this.setState({ govRuleCheck: { status: "error", error: "rule-run 逾時未完成（>60s）" } });
                return;
            }
            const rows = await governanceClient.getResults(rule_run_id, "failed");
            const failedElements: FailedElement[] = rows
                .filter((r): r is RuleResultRow & { ifc_guid: string } => typeof r.ifc_guid === "string" && r.ifc_guid.length > 0)
                .map((r) => ({ ifc_guid: r.ifc_guid, severity: r.severity, rule_code: r.rule_code, label: r.message }));
            this.setState({
                govFailedElements: failedElements,
                govRuleCheck: {
                    status: "succeeded",
                    score: status.score,
                    total: status.summary?.total,
                    failed: status.summary?.failed,
                },
            });
            this._appendReviewEvent(`A3 規則檢核完成：治理分 ${status.score ?? "—"}，failed=${status.summary?.failed ?? "?"}（含 ifc_guid 可標示 ${failedElements.length} 筆）`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setState({ govRuleCheck: { status: "error", error: message } });
            this._appendReviewEvent(`A3 規則檢核失敗：${message}`);
        }
    }

    // W3：A8 從本次 rule-run 開 issue（須先有 succeeded 的 govRuleRunId）。誠實：無 run / 失敗皆據實表態。
    private async _createGovIssues(): Promise<void> {
        // R2：禁止重入（避免連點導致重複開 issue）。creating 中再點直接忽略。
        if (this.state.govIssueCreate?.status === "creating") return;
        const runId = this.state.govRuleRunId;
        if (!runId) {
            this._appendReviewEvent("A8 開 issue 略過：尚無成功的 rule-run");
            this.setState({ govIssueCreate: { status: "error", error: "尚無 rule-run" } });
            return;
        }
        this.setState({ govIssueCreate: { status: "creating" } });
        try {
            const { created } = await governanceClient.issuesFromRuleRun(runId);
            this.setState({ govIssueCreate: { status: "created", created } });
            this._appendReviewEvent(`已從 rule-run 開 ${created} 筆 issue`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setState({ govIssueCreate: { status: "error", error: message } });
            this._appendReviewEvent(`A8 開 issue 失敗：${message}`);
        }
    }

    // W4：live 3D 點選 / debug 清單共用的 prim → ifc_guid 反查（DRY）。誠實：無對映記事件且 guid=null。
    private _reverseLookupGuid(path: string): void {
        // R8：live viewport 點選常落在 child mesh prim（如 …/G_<guid>/mesh_0），exact path 非 mapping key；
        // 改用 ancestor 解析（往父層走，直到命中 mapped prim），命不中才回 null（誠實，不捏造）。
        const guid = this._mappingCache?.guidForPrimPathOrAncestor(path) ?? null;
        this._appendReviewEvent(guid ? `點選 3D 構件 → ifc_guid=${guid}（帶進治理）` : `點選 3D 構件 ${path} → 無對映 ifc_guid`);
        this.setState({ govSelectedGuid: guid });
        this._postToParent({ type: "selected_guid", ifcGuid: guid }); // VG-01 七區塊第7：3D 點構件 → 清單反查
    }

    private _canOpenSelectedAsset(): boolean {
        // Important #1：spectator（view-only）不驅動 stage 載入（由 primary 驅動）。與姊妹函式 _applyBinding
        //（Window.tsx:1092）一致，讓 _scheduleDeferredOpenStage / loadingStateResponse / _onSelectUSDAsset
        // 等 automatic 路徑對 spectator 短路，不進入 _openSelectedAsset 的 primary viewer lease claim 流程。
        if (isSpectatorStreamMode()) return false;
        if (!this.state.selectedUSDAsset) return false;
        if (this.state.latestStreamConfig && this.state.latestStreamConfig.model.status !== "ready") return false;
        return !isBlockedLifecycle(this.state.reviewLifecycleStatus);
    }

    private _ensureStandaloneLabUserToken(): string {
        if (reviewEnv.userToken) return reviewEnv.userToken;
        if (window.parent !== window) return "";
        const random = typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        reviewEnv.userToken = `standalone_viewer_operator_${random}`;
        return reviewEnv.userToken;
    }

    private async _ensurePrimaryViewerLease(): Promise<string | null> {
        if (isSpectatorStreamMode()) return null;
        if (this.standaloneViewerLease?.lease_token) {
            if (this._standaloneViewerLeaseIsFresh()) return this.standaloneViewerLease.lease_token;
            this._dropStandaloneViewerLease("primary viewer lease 已過期；正在重新取得");
        }
        if (reviewEnv.viewerLeaseToken) return reviewEnv.viewerLeaseToken;

        const sessionId = this.state.reviewSessionId;
        if (!sessionId || window.parent !== window) return null;
        const userToken = this._ensureStandaloneLabUserToken();
        if (!userToken) {
            this._appendReviewEvent("primary viewer lease 取得失敗：未設定 local-dev user token");
            return null;
        }

        if (!this.standaloneViewerLeaseClaim) {
            this.standaloneViewerLeaseClaim = fetch(`${reviewEnv.coordinatorApiBase}/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/claim`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-User-Token": userToken,
                },
                body: JSON.stringify({
                    viewer_id: this.standaloneViewerId,
                    // Legacy body identity must match the authenticated lab
                    // carrier; URL userId remains display/correlation only.
                    user_id: userToken,
                    display_name: reviewEnv.defaultDisplayName,
                    requested_role: "primary",
                    client_nonce: `standalone:${this.standaloneViewerId}:${sessionId}`,
                    preferred_kit_instance_id: this.state.activeStreamEndpoint.kitInstanceId,
                }),
            })
                .then(async (response) => {
                    if (!response.ok) {
                        this._appendReviewEvent(`primary viewer lease 取得失敗（${response.status}）`);
                        return null;
                    }
                    const lease = await response.json() as StandaloneViewerLease;
                    if (
                        lease.role !== "primary"
                        || !lease.lease_id
                        || !lease.lease_token
                        || !Number.isFinite(lease.heartbeat_after_ms)
                        || Number.isNaN(Date.parse(lease.expires_at))
                        || Date.parse(lease.expires_at) <= Date.now()
                    ) {
                        this._appendReviewEvent(`primary viewer lease 不是 primary（role=${lease.role}）`);
                        return null;
                    }
                    this.standaloneViewerLease = lease;
                    reviewEnv.viewerLeaseToken = lease.lease_token;
                    reviewEnv.sourceClientId = lease.lease_id;
                    this._scheduleStandaloneViewerLeaseHeartbeat(sessionId, lease);
                    this._appendReviewEvent(`已取得 primary viewer lease：${lease.lease_id}`);
                    return lease;
                })
                .catch((error) => {
                    this._appendReviewEvent(`primary viewer lease 取得失敗：${error instanceof Error ? error.message : String(error)}`);
                    return null;
                })
                .finally(() => {
                    this.standaloneViewerLeaseClaim = null;
                });
        }

        const lease = await this.standaloneViewerLeaseClaim;
        return lease?.lease_token ?? null;
    }

    private _currentViewerLogDeliveryAuthority(): ViewerLogDeliveryAuthority | null {
        const reviewSessionId = this.state.reviewSessionId;
        const leaseId = reviewEnv.sourceClientId;
        const leaseToken = reviewEnv.viewerLeaseToken;
        const loggerTraceId = window.__structLog?.logger.traceId;
        const authority = this._currentVerifiedDataChannelAuthority();
        if (
            !reviewSessionId
            || !leaseId
            || !leaseToken
            || !authority
            || authority.sessionId !== reviewSessionId
            || loggerTraceId !== authority.traceId
        ) return null;
        if (this.standaloneViewerLease && !this._standaloneViewerLeaseIsFresh()) return null;
        return { reviewSessionId, leaseId, leaseToken };
    }

    private async _ensureViewerLogDeliveryAuthority(): Promise<ViewerLogDeliveryAuthority | null> {
        const current = this._currentViewerLogDeliveryAuthority();
        if (current) return current;
        // Structured-log delivery never upgrades a spectator into a primary.
        // A supplied active spectator lease may be reused; otherwise the batch
        // is retained and no primary claim request is sent.
        if (isSpectatorStreamMode()) return null;
        await this._ensurePrimaryViewerLease();
        return this._currentViewerLogDeliveryAuthority();
    }

    private _standaloneViewerLeaseIsFresh(): boolean {
        const expiresAt = this.standaloneViewerLease?.expires_at;
        return Boolean(expiresAt && Date.parse(expiresAt) > Date.now());
    }

    private _clearStandaloneViewerLeaseHeartbeat(): void {
        if (this.standaloneViewerLeaseHeartbeatId !== null) {
            window.clearTimeout(this.standaloneViewerLeaseHeartbeatId);
            this.standaloneViewerLeaseHeartbeatId = null;
        }
    }

    private _dropStandaloneViewerLease(reason?: string): void {
        const lease = this.standaloneViewerLease;
        this._clearStandaloneViewerLeaseHeartbeat();
        this.standaloneViewerLease = null;
        if (lease && reviewEnv.viewerLeaseToken === lease.lease_token) {
            reviewEnv.viewerLeaseToken = "";
        }
        if (lease && reviewEnv.sourceClientId === lease.lease_id) {
            reviewEnv.sourceClientId = this.standaloneViewerId;
        }
        if (reason) this._appendReviewEvent(reason);
    }

    private _scheduleStandaloneViewerLeaseHeartbeat(sessionId: string, lease: StandaloneViewerLease): void {
        this._clearStandaloneViewerLeaseHeartbeat();
        if (!this.componentMounted) return;
        const delayMs = viewerLeaseHeartbeatDelayMs(lease.heartbeat_after_ms);
        this.standaloneViewerLeaseHeartbeatId = window.setTimeout(() => {
            this.standaloneViewerLeaseHeartbeatId = null;
            void this._heartbeatStandaloneViewerLease(sessionId, lease);
        }, delayMs);
    }

    private async _heartbeatStandaloneViewerLease(sessionId: string, lease: StandaloneViewerLease): Promise<void> {
        if (
            !this.componentMounted
            || this.state.reviewSessionId !== sessionId
            || this.standaloneViewerLease?.lease_id !== lease.lease_id
            || this.standaloneViewerLease.lease_token !== lease.lease_token
        ) return;
        try {
            const response = await fetch(
                `${reviewEnv.coordinatorApiBase}/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/${encodeURIComponent(lease.lease_id)}/heartbeat`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Viewer-Lease-Token": lease.lease_token,
                    },
                    body: "{}",
                },
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const refreshed = await response.json() as Partial<StandaloneViewerLease>;
            if (
                refreshed.lease_id !== lease.lease_id
                || typeof refreshed.expires_at !== "string"
                || Number.isNaN(Date.parse(refreshed.expires_at))
                || !Number.isFinite(refreshed.heartbeat_after_ms)
            ) throw new Error("malformed heartbeat response");
            const nextLease = {
                ...lease,
                expires_at: refreshed.expires_at,
                heartbeat_after_ms: refreshed.heartbeat_after_ms as number,
            };
            this.standaloneViewerLease = nextLease;
            this._scheduleStandaloneViewerLeaseHeartbeat(sessionId, nextLease);
        } catch (error) {
            this._dropStandaloneViewerLease(
                `primary viewer lease heartbeat 失敗：${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async _preauthorizeStageBinding(
        artifacts: Array<{ artifact_id: string; role: "primary" | "secondary"; load_order: number }>,
        clientRequestId: string,
        signal?: AbortSignal,
    ): Promise<StageBindingPreauthorization> {
        if (this.stageProofBlockedRevision) {
            throw new Error("stage binding proof resync required");
        }
        const sessionId = this.state.reviewSessionId;
        if (!sessionId) throw new Error("review session is required");
        const userToken = this._ensureStandaloneLabUserToken();
        if (!userToken) throw new Error("local-dev user token is required");
        const leaseToken = await this._ensurePrimaryViewerLease();
        if (!leaseToken) throw new Error("primary viewer lease is required");

        const response = await fetch(
            `${reviewEnv.coordinatorApiBase}/api/review-sessions/${encodeURIComponent(sessionId)}/stage-binding`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-User-Token": userToken,
                    "X-Viewer-Lease-Token": leaseToken,
                },
                body: JSON.stringify({
                    source_client_id: reviewEnv.sourceClientId,
                    role: "primary",
                    client_request_id: clientRequestId,
                    artifacts: artifacts.map((artifact) => ({
                        artifact_id: artifact.artifact_id,
                        role: artifact.role,
                        load_order: artifact.load_order,
                    })),
                }),
                signal,
            },
        );
        if (!response.ok) {
            throw new Error(`stage binding preauthorization failed (${response.status})`);
        }
        const raw = await response.json() as unknown;
        if (!isRecord(raw) || !isRecord(raw.stage_composition)) {
            throw new Error("stage binding preauthorization response is malformed");
        }
        const primary = raw.stage_composition.primary;
        const secondaryLayers = raw.stage_composition.secondary_layers;
        if (
            raw.status !== "pending"
            || raw.session_id !== sessionId
            || !getPayloadString(raw, "stage_binding_authorization_id")
            || !getPayloadString(raw, "binding_revision_id")
            || !getPayloadString(raw, "pending_expires_at")
            || !isRecord(primary)
            || primary.role !== "primary"
            || !getPayloadString(primary, "artifact_id")
            || !getPayloadString(primary, "usdc_url")
            || !Array.isArray(secondaryLayers)
            || secondaryLayers.some((artifact) => (
                !isRecord(artifact)
                || artifact.role !== "secondary"
                || !getPayloadString(artifact, "artifact_id")
                || !getPayloadString(artifact, "usdc_url")
            ))
        ) {
            throw new Error("stage binding preauthorization response is malformed");
        }
        return raw as unknown as StageBindingPreauthorization;
    }

    private async _cancelStageBindingPreauthorization(clientRequestId: string): Promise<boolean> {
        const sessionId = this.state.reviewSessionId;
        if (!sessionId) return false;
        const userToken = this._ensureStandaloneLabUserToken();
        if (!userToken) return false;
        const controller = new AbortController();
        let timeoutId: number | null = null;
        const cancellationAttempt = (async (): Promise<boolean> => {
            const leaseToken = await this._ensurePrimaryViewerLease();
            if (!leaseToken || controller.signal.aborted) return false;
            const response = await fetch(
                `${reviewEnv.coordinatorApiBase}/api/review-sessions/${encodeURIComponent(sessionId)}/stage-binding-cancellations`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-User-Token": userToken,
                        "X-Viewer-Lease-Token": leaseToken,
                    },
                    body: JSON.stringify({
                        source_client_id: reviewEnv.sourceClientId,
                        client_request_id: clientRequestId,
                    }),
                    signal: controller.signal,
                },
            );
            return response.ok;
        })().catch(() => false);
        const deadline = new Promise<boolean>((resolve) => {
            timeoutId = window.setTimeout(() => {
                controller.abort();
                resolve(false);
            }, STAGE_AUTHORIZATION_CANCEL_TIMEOUT_MS);
        });
        try {
            return await Promise.race([cancellationAttempt, deadline]);
        } finally {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
    }

    private _cancelActiveStagePreauthorization(
        request: ActiveStagePreauthorization,
        retryFailed = false,
    ): Promise<boolean> {
        request.controller.abort();
        const currentBarrier = this.stagePreauthorizationCancellationBarrier;
        if (retryFailed && currentBarrier?.request === request && currentBarrier.status === "failed") {
            request.cancellationPromise = null;
        }
        if (request.cancellationPromise) return request.cancellationPromise;
        const barrier: StagePreauthorizationCancellationBarrier = {
            request,
            promise: Promise.resolve(false),
            status: "pending",
        };
        barrier.promise = this._cancelStageBindingPreauthorization(request.clientRequestId).then((confirmed) => {
            if (this.stagePreauthorizationCancellationBarrier === barrier) {
                if (confirmed) {
                    this.stagePreauthorizationCancellationBarrier = null;
                } else {
                    barrier.status = "failed";
                }
            }
            return confirmed;
        });
        request.cancellationPromise = barrier.promise;
        this.stagePreauthorizationCancellationBarrier = barrier;
        return barrier.promise;
    }

    private async _preauthorizeStageBindingWithinDeadline(
        artifacts: Array<{ artifact_id: string; role: "primary" | "secondary"; load_order: number }>,
    ): Promise<StageBindingPreauthorization> {
        let timeoutId: number | null = null;
        const controller = new AbortController();
        const clientRequestId = createStageBindingPreauthorizationRequestId();
        const request: ActiveStagePreauthorization = {
            clientRequestId,
            controller,
            postStarted: false,
            cancellationPromise: null,
        };
        const supersededRequest = this.activeStagePreauthorization;
        this.activeStagePreauthorization = request;
        try {
            if (supersededRequest) {
                supersededRequest.controller.abort();
                if (supersededRequest.postStarted) {
                    const cancellationConfirmed = await this._cancelActiveStagePreauthorization(supersededRequest);
                    if (!cancellationConfirmed || this.activeStagePreauthorization !== request) {
                        throw new DOMException("stage binding preauthorization superseded", "AbortError");
                    }
                }
            }
            const cancellationBarrier = this.stagePreauthorizationCancellationBarrier;
            if (cancellationBarrier) {
                const cancellationConfirmed = cancellationBarrier.status === "failed"
                    ? await this._cancelActiveStagePreauthorization(cancellationBarrier.request, true)
                    : await cancellationBarrier.promise;
                if (!cancellationConfirmed || this.activeStagePreauthorization !== request) {
                    throw new DOMException("stage binding preauthorization superseded", "AbortError");
                }
            }
            if (this.activeStagePreauthorization !== request) {
                throw new DOMException("stage binding preauthorization superseded", "AbortError");
            }
            request.postStarted = true;
            return await new Promise<StageBindingPreauthorization>((resolve, reject) => {
                timeoutId = window.setTimeout(
                    () => {
                        void this._cancelActiveStagePreauthorization(request);
                        reject(new Error("stage_binding_authorization_timeout"));
                    },
                    STAGE_AUTHORIZATION_TIMEOUT_MS,
                );
                void this._preauthorizeStageBinding(artifacts, clientRequestId, controller.signal).then(resolve, reject);
            });
        } finally {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (this.activeStagePreauthorization === request) {
                this.activeStagePreauthorization = null;
            }
        }
    }

    private _releaseStandaloneViewerLease(): void {
        const lease = this.standaloneViewerLease;
        const sessionId = this.state.reviewSessionId;
        if (!lease || !sessionId) return;

        this._dropStandaloneViewerLease();
        void fetch(`${reviewEnv.coordinatorApiBase}/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/${encodeURIComponent(lease.lease_id)}/release`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Viewer-Lease-Token": lease.lease_token,
            },
            body: "{}",
            keepalive: true,
        }).catch(() => {});
    }

    private _handleStreamStartTimeout(): void {
        this.streamStartTimeoutId = null;
        if (this._hasRemoteVideoFrame()) return;

        const seconds = Math.round(reviewEnv.streamStartTimeoutMs / 1000);
        const endpoint = streamEndpointLabel(this.state.activeStreamEndpoint);
        const diagnostic = [
            t(
                `WebRTC 串流未建立（${seconds} 秒內沒有收到影片）。`,
                `WebRTC stream was not established (no video within ${seconds}s).`,
            ),
            `${t("診斷", "Diagnostic")}${t("：", ": ")}${this._getVideoDiagnosticText()}`,
            `${t("端點", "Endpoint")}${t("：", ": ")}${endpoint}`,
            t(
                "請將此視為 demo blocker：Kit signaling 可能已連上，但 browser 尚未取得 media stream。",
                "Treat this as a demo blocker: Kit signaling may be connected, but the browser has not received a media stream.",
            ),
        ].join("\n");

        this.setState((state) => ({
            loadingText: t("WebRTC 串流未建立", "WebRTC stream was not established"),
            streamDiagnostic: diagnostic,
            isLoading: false,
            webrtcLifecycleStatus: "failed",
            reviewEvents: [...state.reviewEvents, "WebRTC 串流未建立，已顯示診斷資訊"],
        }));
    }

    private _resolveStreamEndpoint(streamConfig: ReviewStreamConfig): StreamEndpoint {
        if (hasDirectStreamEndpointOverride()) {
            return this.state.activeStreamEndpoint;
        }

        const requestedKitInstanceId = this.state.activeStreamEndpoint.kitInstanceId;
        const requestedBinding = requestedKitInstanceId
            ? streamConfig.kit_instance_bindings.find((binding) => binding.kit_instance_id === requestedKitInstanceId)
            : null;
        const primaryBinding = streamConfig.kit_instance_bindings.find((binding) =>
            sameStreamTransportEndpoint(binding.stream_config, streamConfig.webrtc)
        ) || streamConfig.kit_instance_bindings[0] || null;
        // viewer-edge-bim-server-console:旁觀者優先用 viewport_sharing
        // primary_kit_instance_id 直接比 kit_instance_id 挑非 primary 那一路;
        // 缺 primary_kit_instance_id 時退回 transport port-diff(既有行為)。
        const primaryKitInstanceId = streamConfig.viewport_sharing?.primary_kit_instance_id ?? null;
        const spectatorBinding = isSpectatorStreamMode() && primaryBinding
            ? selectSpectatorBinding(
                streamConfig.kit_instance_bindings,
                primaryKitInstanceId,
                primaryBinding.stream_config,
            )
            : null;
        const selectedBinding = requestedBinding || spectatorBinding || primaryBinding;
        const selectedConfig = selectedBinding?.stream_config || streamConfig.webrtc;

        return {
            kitInstanceId: selectedBinding?.kit_instance_id || requestedKitInstanceId,
            signalingserver: selectedConfig.signalingServer,
            signalingport: selectedConfig.signalingPort,
            mediaserver: selectedConfig.mediaServer,
            mediaport: selectedConfig.mediaPort ?? undefined,
        };
    }

    private _applyAuthoritativeSessionClosed(reason: string): void {
        this.reviewSocketEpoch += 1;
        this.verifiedDataChannelAuthority = null;
        this.reviewSocket?.disconnect();
        this.reviewSocket = null;
        const streamMountKey = this._replaceStreamLifecycle();
        AppStream.stop();
        this.setState({
            reviewLifecycleStatus: "closed",
            idleCountdownRemainingSeconds: null,
            idleClosedReason: reason,
            isKitReady: false,
            isLoading: false,
            showStream: false,
            loadingText: "會議已結束",
            loadedStageUrl: null,
            stageLoadStatus: "disconnected",
            webrtcLifecycleStatus: "stopped",
            streamMountKey,
        });
    }

    private _connectReviewSocket(sessionId: string, traceId: string): void {
        if (isBlockedLifecycle(this.state.reviewLifecycleStatus)) {
            this._appendReviewEvent(`略過 Socket.IO join：session lifecycle=${this.state.reviewLifecycleStatus}`);
            return;
        }
        this.reviewSocketEpoch += 1;
        const socketEpoch = this.reviewSocketEpoch;
        this.verifiedDataChannelAuthority = null;
        this.reviewSocket?.disconnect();
        this.reviewSocket = null;
        this.setState({ idleCountdownRemainingSeconds: null, idleClosedReason: null });

        const routeTraceId = traceIdFromSearch(window.location.search);
        const streamConfig = this.state.latestStreamConfig;
        if (
            !this.componentMounted
            || !routeTraceId
            || routeTraceId !== traceId
            || streamConfig?.session_id !== sessionId
            || streamConfig.trace_id !== traceId
            || !this._harnessRouteAuthorityMatches(sessionId, traceId)
        ) {
            this._appendReviewEvent("略過 Socket.IO join：session trace authority mismatch");
            return;
        }

        const candidate: ReviewSocketCandidate = {
            sessionId,
            userId: reviewEnv.defaultUserId,
            displayName: reviewEnv.defaultDisplayName,
            traceId,
        };
        const socketHandlers: ReviewSocketHandlers = {
            onStatus: (status) => {
                if (socketEpoch !== this.reviewSocketEpoch) return;
                this.verifiedDataChannelAuthority = null;
                if (status === "disconnected") {
                    this.setState({ idleCountdownRemainingSeconds: null });
                }
                this._appendReviewEvent(`Socket.IO ${status === "connected" ? "已連線，等待 trace 驗證" : "已中斷"}`);
            },
            onAck: (event, acknowledgedCandidate, ack) => {
                this._handleReviewSocketAck(socketEpoch, event, acknowledgedCandidate, ack);
            },
            onEvent: (event, payload) => {
                if (
                    event === "presenceUpdated"
                    && (
                        !isRecord(payload)
                        || !this.verifiedDataChannelAuthority
                        || this.verifiedDataChannelAuthority.connectionGeneration !== socketEpoch
                        || payload.session_id !== this.verifiedDataChannelAuthority.sessionId
                        || payload.trace_id !== this.verifiedDataChannelAuthority.traceId
                    )
                ) return;
                if (
                    event === "session:idle_countdown"
                    || event === "session:idle_countdown_cancelled"
                    || event === "session:closed"
                ) {
                    const authority = this.verifiedDataChannelAuthority;
                    if (
                        !isRecord(payload)
                        || !authority
                        || authority.connectionGeneration !== socketEpoch
                        || payload.session_id !== authority.sessionId
                        || payload.trace_id !== authority.traceId
                    ) return;
                    if (event === "session:idle_countdown") {
                        const remaining = payload.remaining_seconds;
                        if (!Number.isInteger(remaining) || (remaining as number) < 0 || (remaining as number) > 10) return;
                        this.setState({ idleCountdownRemainingSeconds: remaining as number, idleClosedReason: null });
                    } else if (event === "session:idle_countdown_cancelled") {
                        this.setState({ idleCountdownRemainingSeconds: null });
                    } else {
                        this._applyAuthoritativeSessionClosed(
                            typeof payload.reason === "string" ? payload.reason : "inactivity",
                        );
                    }
                }
                this._appendReviewEvent(`收到 Socket.IO 事件：${event}`);
                this._appendDemoIncoming(`socket:${event}`, payload);
            },
        };
        this.reviewSocket = harnessEnabled()
            ? connectHarnessReviewSocket(socketHandlers, HARNESS_REVIEW_AUTHORITY)
            : connectReviewSocket(reviewEnv.coordinatorSocketUrl, socketHandlers);
        this.reviewSocket.join(candidate);
    }

    private _handleReviewSocketAck(
        socketEpoch: number,
        event: ReviewSocketEvent,
        candidate: ReviewSocketCandidate,
        ack: ReviewSocketAck,
    ): void {
        if (socketEpoch !== this.reviewSocketEpoch || !this.componentMounted) return;
        if (
            event === "joinSession"
            && !ack.ok
            && ack.lifecycle_status === "closed"
            && ack.session_id === candidate.sessionId
            && ack.trace_id === candidate.traceId
            && candidate.sessionId === this.state.reviewSessionId
            && candidate.traceId === this.state.latestStreamConfig?.trace_id
            && candidate.traceId === traceIdFromSearch(window.location.search)
            && this._harnessRouteAuthorityMatches(candidate.sessionId, candidate.traceId)
        ) {
            this._applyAuthoritativeSessionClosed(ack.reason ?? "recovered_close");
            this._appendReviewEvent("Socket.IO 已同步會議關閉狀態");
            return;
        }
        if (event === "userActivity" && !ack.ok) {
            const authority = this.verifiedDataChannelAuthority;
            const matchesJoinedAuthority = authority
                && authority.connectionGeneration === socketEpoch
                && authority.sessionId === candidate.sessionId
                && authority.traceId === candidate.traceId;
            if (!matchesJoinedAuthority) this.verifiedDataChannelAuthority = null;
            this._appendReviewEvent("Socket.IO userActivity 未獲接受");
            return;
        }
        if (
            !ack.ok
            || ack.trace_id !== candidate.traceId
            || (ack.session_id !== undefined && ack.session_id !== candidate.sessionId)
            || candidate.sessionId !== this.state.reviewSessionId
            || candidate.traceId !== this.state.latestStreamConfig?.trace_id
            || candidate.traceId !== traceIdFromSearch(window.location.search)
            || !this._harnessRouteAuthorityMatches(candidate.sessionId, candidate.traceId)
        ) {
            this.verifiedDataChannelAuthority = null;
            this._appendReviewEvent(`Socket.IO ${event} trace 驗證失敗`);
            return;
        }
        if (event === "leaveSession") {
            this.verifiedDataChannelAuthority = null;
            return;
        }
        if (event === "heartbeat" || event === "streamReadiness" || event === "userActivity") {
            const authority = this.verifiedDataChannelAuthority;
            if (
                !authority
                || authority.connectionGeneration !== socketEpoch
                || authority.sessionId !== candidate.sessionId
                || authority.traceId !== ack.trace_id
            ) this.verifiedDataChannelAuthority = null;
            else if (event === "userActivity") this._appendReviewEvent("Socket.IO userActivity 已確認");
            return;
        }

        this.verifiedDataChannelAuthority = {
            sessionId: candidate.sessionId,
            traceId: ack.trace_id,
            connectionGeneration: socketEpoch,
        };
        window.__structLog?.logger.setTraceId(ack.trace_id);
        this._appendReviewEvent(`Socket.IO trace 已驗證：${ack.trace_id}`);
        this._reportStreamReadinessIfFrame();
    }

    private _getReadyLoadingText(): string {
        return StreamConfig.source === "gfn" ? "請先登入 GeForce NOW 才能觀看串流" : (StreamConfig.source === "stream" ? "等待串流初始化":  "等待串流開始");
    }

    private async _loadUSDAssets(): Promise<void> {
        try {
            const usdAssets = await fetchUSDAssets();
            const selectedUSDAsset = usdAssets[0] ?? null;

            this.setState({
                usdAssets,
                selectedUSDAsset,
                loadingText: selectedUSDAsset ? this._getReadyLoadingText() : "沒有可用的 USD / USDC 成果檔",
                isLoading: selectedUSDAsset ? StreamConfig.source === "stream" : false,
            }, () => {
                if (this.state.isKitReady && this.state.selectedUSDAsset && !this.state.showStream) {
                    this._openSelectedAsset();
                }
            });
        }
        catch (error) {
            console.error("Unable to load USD assets.", error);
            this.setState({
                usdAssets: [],
                selectedUSDAsset: null,
                loadingText: "無法載入成果檔清單",
                isLoading: false,
            });
        }
    }

    // Harness 專用 bootstrap：注入可決定性 session + ready 的 HARNESS_STAGE_URL，
    // 跳過 coordinator（避免 CORS / 真轉檔依賴）。只造「後端資料」，前端狀態機
    // （openStage / loadingState / USD 樹 / overlay）全部照真實邏輯跑，由 FakeAppStreamer 回應 Kit。
    // CH-F：交易式套用 Stage / Artifact Binding。spectator / 未就緒不送 mutating 指令（前端 gate 僅 UX）。
    // Production 走既有 Kit loadArtifactGroupRequest + stage_composition handler；harness 仍保留 fakeKit compose ack。
    private _applyBinding(selection: StageArtifactBinding[], revisionId: string): void {
        const applyGeneration = ++this.bindingApplyGeneration;
        if (isSpectatorStreamMode()) {
            this._appendReviewEvent(`spectator（view-only）：略過 binding 套用（${revisionId}）`);
            return;
        }
        const primary = selection.find((s) => s.role === "primary");
        if (!primary) {
            this.setState({ govBindingApplyState: { status: "failed", reason: "缺少 primary artifact" } });
            return;
        }
        this.setState({ govBindingApplyState: { status: "applying" } });
        this._appendReviewEvent(`套用 binding revision=${revisionId}（primary=${primary.artifact_id}, layers=${selection.length}）`);
        if (harnessEnabled()) {
            this._sendStreamMessage({
                event_type: "composeStageRequest",
                payload: { binding_revision_id: revisionId, artifacts: selection },
            });
            return;
        }
        if (this.stageProofBlockedRevision) {
            this._appendReviewEvent("略過 binding 套用：stage binding proof resync required");
            this.setState({
                govBindingApplyState: {
                    status: "failed",
                    reason: "stage binding proof resync required",
                },
            });
            return;
        }
        if (!this.state.reviewSessionId) {
            this.setState({ govBindingApplyState: { status: "failed", reason: "缺少 review session" } });
            return;
        }

        // A newer user selection revokes completion authority from every prior
        // stage attempt before its coordinator preauthorization resolves.
        const applyStageIntentGeneration = ++this.stageIntentGeneration;
        this.pendingBindingApplyGeneration = applyGeneration;
        this.pendingStagePreauthorizationIntent = applyStageIntentGeneration;
        this._supersedeActiveStageAttempt();
        const applyThroughCoordinator = async () => {
            const transaction = await this._preauthorizeStageBindingWithinDeadline(
                selection.map((artifact) => ({
                    artifact_id: artifact.artifact_id,
                    role: artifact.role,
                    load_order: artifact.load_order,
                })),
            );
            if (
                applyGeneration !== this.bindingApplyGeneration
                || applyStageIntentGeneration !== this.stageIntentGeneration
            ) return;
            this.pendingStagePreauthorizationIntent = null;
            this.pendingBindingApplyGeneration = null;
            this._appendReviewEvent(`coordinator 已建立 pending binding：${transaction.binding_revision_id}`);
            const targetUrl = transaction.stage_composition.primary.usdc_url;
            const targetAsset = this.state.usdAssets.find((asset) => asset.url === targetUrl)
                || { name: displayNameFromStageUrl(targetUrl), url: targetUrl };
            const mappingTargetChanged = this.state.selectedUSDAsset?.url !== targetUrl;
            const mappingUrl = this._resolveMappingUrlForAsset(targetAsset);
            if (mappingTargetChanged) {
                this._mappingCache = null;
                this._mappingCacheUrl = null;
            }
            const attemptGeneration = this._beginStageAttempt(targetUrl);
            this.pendingBindingApplyGeneration = applyGeneration;
            this.pendingBindingApplyStageAttemptGeneration = attemptGeneration;
            this.pendingStageUrl = targetUrl;
            this.confirmedStageBindingRevision = null;
            this.unprovenStageUrl = null;
            this.loadingStatePollCount = 0;
            this._clearLoadingStateRetry();
            this.setState({
                loadingText: t("正在載入模型...", "Loading model..."),
                showStream: this._hasRemoteVideoFrame(),
                streamDiagnostic: null,
                usdAssets: this._mergeAssets(this.state.usdAssets, [targetAsset]),
                selectedUSDAsset: targetAsset,
                mappingUrl: mappingTargetChanged ? mappingUrl : this.state.mappingUrl,
                mappingStatus: mappingTargetChanged
                    ? (mappingUrl ? "尚未載入 mapping" : "此成果檔沒有 mapping URL")
                    : this.state.mappingStatus,
                mappingSummary: mappingTargetChanged ? null : this.state.mappingSummary,
                mappingItems: mappingTargetChanged ? [] : this.state.mappingItems,
                selectedMappingIndex: mappingTargetChanged ? 0 : this.state.selectedMappingIndex,
                lastMappingVerification: mappingTargetChanged ? null : this.state.lastMappingVerification,
                mappingVerificationBlockedReason: mappingTargetChanged
                    ? null
                    : this.state.mappingVerificationBlockedReason,
                expectedStageUrl: targetUrl,
                loadedStageUrl: null,
                stageLoadStatus: "pending",
                isLoading: true,
            });
            this._dispatchStageRequest({
                event_type: "loadArtifactGroupRequest",
                payload: {
                    url: transaction.stage_composition.primary.usdc_url,
                    requested_stage_url: transaction.stage_composition.primary.usdc_url,
                    stage_binding_authorization_id: transaction.stage_binding_authorization_id,
                    binding_revision_id: transaction.binding_revision_id,
                    stage_composition: transaction.stage_composition,
                },
            }, attemptGeneration, t(
                stageLoadFailurePresentation.commandNotSent.zh,
                stageLoadFailurePresentation.commandNotSent.en,
            ));
        };
        void applyThroughCoordinator().catch((error) => {
            if (
                applyGeneration !== this.bindingApplyGeneration
                || applyStageIntentGeneration !== this.stageIntentGeneration
            ) return;
            this.pendingStagePreauthorizationIntent = null;
            this.pendingBindingApplyGeneration = null;
            this.pendingBindingApplyStageAttemptGeneration = null;
            const authorizationTimedOut = isStageAuthorizationTimeout(error);
            this.setState({
                govBindingApplyState: {
                    status: "failed",
                    reason: authorizationTimedOut
                        ? "stage_binding_authorization_timeout"
                        : "coordinator stage binding preauthorization 失敗",
                },
            });
            this._failStageLoad(
                t(stageLoadFailurePresentation.title.zh, stageLoadFailurePresentation.title.en),
                authorizationTimedOut
                    ? t(stageLoadFailurePresentation.authorizationTimedOut.zh, stageLoadFailurePresentation.authorizationTimedOut.en)
                    : t(stageLoadFailurePresentation.authorizationFailed.zh, stageLoadFailurePresentation.authorizationFailed.en),
                null,
                authorizationTimedOut ? "stage_binding_authorization_timeout" : undefined,
            );
        });
    }

    private _bootstrapHarnessSession(): void {
        this.verifiedDataChannelAuthority = null;
        this.reviewSocketEpoch += 1;
        this.reviewSocket?.disconnect();
        this.reviewSocket = null;
        const stageUrl = HARNESS_STAGE_URL;
        const harnessAsset: USDAssetType = { name: "Sample Building (harness)", url: stageUrl };
        // The alternate assets let the controlled browser harness exercise a real
        // A -> B stage replacement without changing production asset selection.
        const harnessAssets: USDAssetType[] = [
            harnessAsset,
            { name: "Levels Overlay (harness)", url: "harness://stage/World/levels.usdc" },
            { name: "MEP Overlay (harness)", url: "harness://stage/World/mep.usdc" },
        ];
        // CH-F：harness 提供多個 ready derived USDC artifact，供 BindingComposer 選 1..N / 指定 primary / 調 load_order。
        const harnessBindings: ArtifactBinding[] = [
            { binding_id: "b_h_building", artifact_group_id: "ag_harness", model_version_id: "version_harness_demo", artifact_id: "artifact_h_building", display_name: "Building Shell", source_ifc_filename: "sample-building.ifc", artifact_role: "derived", url: stageUrl, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready" },
            { binding_id: "b_h_levels", artifact_group_id: "ag_harness", model_version_id: "version_harness_demo", artifact_id: "artifact_h_levels", display_name: "Levels Overlay", source_ifc_filename: "sample-building.ifc", artifact_role: "derived", url: "harness://stage/World/levels.usdc", mapping_url: null, load_order: 1, routing_policy: "same_instance", ready_status: "ready" },
            { binding_id: "b_h_mep", artifact_group_id: "ag_harness", model_version_id: "version_harness_demo", artifact_id: "artifact_h_mep", display_name: "MEP Overlay", source_ifc_filename: "sample-building.ifc", artifact_role: "derived", url: "harness://stage/World/mep.usdc", mapping_url: null, load_order: 2, routing_policy: "same_instance", ready_status: "ready" },
        ];
        const streamConfig: ReviewStreamConfig = {
            session_id: HARNESS_SESSION_ID,
            trace_id: HARNESS_TRACE_ID,
            lifecycle_status: "active",
            source: "local_fixed",
            webrtc: { signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: null },
            model: { status: "ready", artifact_id: "artifact_h_building", url: stageUrl, mapping_url: null },
            artifacts: [],
            artifact_bindings: harnessBindings,
            kit_instance_bindings: [],
        };
        this.setState({
            reviewSessionId: streamConfig.session_id,
            reviewRequestId: null,
            currentProjectId: "project_harness_demo",
            currentModelVersionId: "version_harness_demo",
            reviewLifecycleStatus: "active",
            reviewStatus: "harness session（deterministic，無 coordinator / 無真實 Kit）",
            reviewArtifacts: [],
            latestStreamConfig: streamConfig,
            mappingUrl: null,
            usdAssets: harnessAssets,
            selectedUSDAsset: harnessAsset,
            expectedStageUrl: stageUrl,
            loadedStageUrl: null,
            stageLoadStatus: "pending",
            showUI: true,
            reviewEvents: [...this.state.reviewEvents, "harness session 已注入（deterministic）"],
        }, () => {
            if (
                !this.componentMounted
                || !harnessEnabled()
                || this.state.latestStreamConfig?.session_id !== HARNESS_SESSION_ID
                || this.state.latestStreamConfig.trace_id !== HARNESS_TRACE_ID
            ) return;
            this._connectReviewSocket(HARNESS_SESSION_ID, HARNESS_TRACE_ID);
        });
    }

    private async _bootstrapReview(sessionIdOverride?: string): Promise<void> {
        this._clearStreamConfigRefresh();
        if (harnessEnabled()) {
            this._bootstrapHarnessSession();
            this._rejectA4HandoffBeforeConsume("harness_handoff_not_authorized");
            return;
        }
        try {
            if (reviewEnv.hasExplicitEmptySessionId) {
                this.setState((state) => ({
                    reviewLifecycleStatus: null,
                    reviewStatus: "Review session URL 缺少 sessionId",
                    reviewArtifacts: [],
                    latestStreamConfig: null,
                    mappingUrl: null,
                    usdAssets: [],
                    selectedUSDAsset: null,
                    showStream: false,
                    showUI: false,
                    loadingText: "請從本場會議開啟瀏覽器審查端",
                    streamDiagnostic: [
                        "目前 URL 帶有空的 sessionId=，viewer 已停止自動建立新 session。",
                        "請回到 http://127.0.0.1:8004/ui，完成轉檔與建立會議後按「用本場會議開啟瀏覽器審查端」。",
                    ].join("\n"),
                    isLoading: false,
                    reviewEvents: [...state.reviewEvents, "空 sessionId 已阻止自動建立 review session"],
                }));
                this._rejectA4HandoffBeforeConsume("review_session_unavailable");
                return;
            }

            if (!reviewEnv.autoCreateSession && !reviewEnv.defaultSessionId && !reviewEnv.defaultReviewRequestId) {
                this.setState({ reviewStatus: "Review session 自動建立已停用" });
                await this._loadReviewDataFromBimControl();
                this._rejectA4HandoffBeforeConsume("review_session_unavailable");
                return;
            }

            let reviewRequest: ReviewSessionRequest | null = null;
            if (reviewEnv.defaultReviewRequestId) {
                reviewRequest = await this.bimControlClient.getReviewSessionRequest(reviewEnv.defaultReviewRequestId);
                const requestAssets = this._assetsFromArtifactBindings(reviewRequest.artifact_bindings || []);
                if (isBlockedLifecycle(reviewRequest.status) && !reviewRequest.session_id) {
                    this.setState({
                        reviewRequestId: reviewRequest.review_request_id,
                        reviewLifecycleStatus: reviewRequest.status,
                        reviewStatus: lifecycleStatusText(reviewRequest.status),
                        usdAssets: this._mergeAssets(this.state.usdAssets, requestAssets),
                        selectedUSDAsset: this.state.selectedUSDAsset || requestAssets[0] || null,
                        loadingText: lifecycleStatusText(reviewRequest.status),
                        isLoading: false,
                        reviewEvents: [...this.state.reviewEvents, `已載入 review request：${reviewRequest.status}`],
                    });
                    this._rejectA4HandoffBeforeConsume("session_lifecycle_blocked");
                    return;
                }
            }

            const loadedSessionId = sessionIdOverride || reviewEnv.defaultSessionId;
            const loadedSession: ReviewSession | null = loadedSessionId
                ? await this.coordinatorClient.getReviewSession(loadedSessionId)
                : null;
            let createdSession: ReviewSession | null = null;
            if (!sessionIdOverride && !reviewEnv.defaultSessionId && !reviewRequest?.session_id) {
                try {
                    createdSession = await this.coordinatorClient.createReviewSession({
                        review_request_id: reviewRequest?.review_request_id,
                        tenant_id: reviewRequest?.tenant_id,
                        project_id: reviewRequest?.project_id || reviewEnv.defaultProjectId,
                        model_version_id: reviewRequest?.model_version_id || reviewEnv.defaultModelVersionId,
                        created_by: reviewEnv.defaultUserId,
                        routing_policy: (reviewRequest?.startup_policy?.routing_policy as "same_instance" | "dedicated_instance" | "shared_state" | undefined) || "same_instance",
                        artifact_bindings: reviewRequest?.artifact_bindings || [],
                        kit_profile: reviewRequest?.kit_profile || {},
                    });
                } catch (error) {
                    if (isQueuedForInstanceError(error)) {
                        await this._handleQueuedForInstance(reviewRequest, error.response.artifact_bindings);
                        this._rejectA4HandoffBeforeConsume("session_lifecycle_blocked");
                        return;
                    }
                    throw error;
                }
            }
            const sessionId = loadedSession?.session_id || reviewRequest?.session_id || createdSession?.session_id || "";
            if (!sessionId) {
                this.setState({
                    reviewLifecycleStatus: reviewRequest?.status || null,
                    reviewStatus: lifecycleStatusText(reviewRequest?.status || null),
                    isLoading: false,
                });
                this._rejectA4HandoffBeforeConsume("review_session_unavailable");
                return;
            }
            const bootstrapModelVersionId = loadedSession?.model_version_id
                || reviewRequest?.model_version_id
                || createdSession?.model_version_id
                || reviewEnv.defaultModelVersionId;
            const streamConfig = await this.coordinatorClient.getStreamConfig(sessionId);

            const artifacts = streamConfig.artifacts;
            const usdAssets = this._mergeAssets(this._assetsFromArtifactBindings(streamConfig.artifact_bindings || []), this._assetsFromReviewArtifacts(artifacts));
            const expectedStageUrl = expectedStageUrlFromStreamConfig(streamConfig);
            const expectedStageAsset = expectedStageUrl
                ? (usdAssets.find((asset) => asset.url === expectedStageUrl) || { name: displayNameFromStageUrl(expectedStageUrl), url: expectedStageUrl })
                : null;
            const mergedUSDAssets = this._mergeAssets(this.state.usdAssets, expectedStageAsset ? [expectedStageAsset, ...usdAssets] : usdAssets);
            const selectedUSDAsset = expectedStageAsset
                ?? usdAssets.find((asset) => asset.url === streamConfig.model.url)
                ?? usdAssets[0]
                ?? this.state.selectedUSDAsset;
            const shouldShowReviewUI = mergedUSDAssets.length > 0 || artifacts.length > 0 || streamConfig.artifact_bindings.length > 0;

            if (reviewRequest && createdSession) {
                void this.bimControlClient.patchReviewSessionRequest(reviewRequest.review_request_id, {
                    status: streamConfig.lifecycle_status,
                    session_id: sessionId,
                    artifact_bindings: streamConfig.artifact_bindings,
                    kit_instance_bindings: streamConfig.kit_instance_bindings,
                    lifecycle_event: { type: "sessionBound", session_id: sessionId },
                }).catch((error) => console.warn("Unable to patch review request binding.", error));
            }

            const activeStreamEndpoint = this._resolveStreamEndpoint(streamConfig);
            const streamEndpointChanged = !sameStreamEndpoint(this.state.activeStreamEndpoint, activeStreamEndpoint);
            const endpointEvent = `Kit endpoint：${streamEndpointLabel(activeStreamEndpoint)}`;
            const streamMountKey = streamEndpointChanged
                ? this._replaceStreamLifecycle()
                : this.streamGeneration;

            // viewer-edge-bim-server-console:TopBar 顯示 project / version identity。
            // 來源優先序:ReviewSession → ReviewSessionRequest → reviewEnv defaults。
            const currentProjectId = loadedSession?.project_id
                || createdSession?.project_id
                || reviewRequest?.project_id
                || reviewEnv.defaultProjectId
                || null;
            const currentModelVersionId = loadedSession?.model_version_id
                || createdSession?.model_version_id
                || reviewRequest?.model_version_id
                || bootstrapModelVersionId
                || null;

            this.setState({
                reviewSessionId: sessionId,
                reviewRequestId: reviewRequest?.review_request_id || loadedSession?.review_request_id || null,
                currentProjectId,
                currentModelVersionId,
                reviewLifecycleStatus: streamConfig.lifecycle_status,
                reviewStatus: `${lifecycleStatusText(streamConfig.lifecycle_status)}，模型狀態：${streamConfig.model.status}`,
                reviewArtifacts: artifacts,
                latestStreamConfig: streamConfig,
                mappingUrl: this._resolveMappingUrl(streamConfig, artifacts),
                usdAssets: mergedUSDAssets,
                selectedUSDAsset,
                expectedStageUrl,
                loadedStageUrl: null,
                stageLoadStatus: expectedStageUrl ? "pending" : "unproven",
                showUI: this.state.showUI || shouldShowReviewUI,
                // A replacement AppStream must establish readiness itself. Carrying this
                // flag across endpoints can make bootstrap open once before onStarted
                // schedules a second open for the same stage.
                isKitReady: streamEndpointChanged ? false : this.state.isKitReady,
                showStream: streamEndpointChanged ? false : this.state.showStream,
                webrtcLifecycleStatus: streamEndpointChanged ? "initializing" : this.state.webrtcLifecycleStatus,
                streamDiagnostic: streamEndpointChanged ? null : this.state.streamDiagnostic,
                activeStreamEndpoint,
                streamMountKey,
                reviewEvents: [
                    ...this.state.reviewEvents,
                    reviewEnv.defaultSessionId || reviewRequest?.session_id ? "已載入 review session" : "已建立 review session",
                    endpointEvent,
                ],
            }, () => {
                this._connectReviewSocket(sessionId, streamConfig.trace_id);
                if (streamConfig.model.status === "ready" && !isBlockedLifecycle(streamConfig.lifecycle_status)) {
                    this._scheduleStreamStartTimeout();
                } else if (streamConfig.model.status === "missing" || streamConfig.model.status === "converting") {
                    if (!isBlockedLifecycle(streamConfig.lifecycle_status)) {
                        this._scheduleStreamConfigRefresh(sessionId);
                    }
                }
                if (!streamEndpointChanged && this.state.isKitReady && this.state.selectedUSDAsset && streamConfig.model.status === "ready" && !isBlockedLifecycle(streamConfig.lifecycle_status)) {
                    this._openSelectedAsset();
                }
                void this._beginA4Handoff(sessionId);
            });
        }
        catch (error) {
            console.warn("Review bootstrap unavailable.", error);
            if (
                sessionIdOverride
                && this.componentMounted
                && this.state.reviewSessionId === sessionIdOverride
                && !isBlockedLifecycle(this.state.reviewLifecycleStatus)
            ) {
                this._scheduleStreamConfigRefresh(sessionIdOverride);
                return;
            }
            this.setState({
                reviewStatus: "Review coordinator 無法連線",
                reviewEvents: [...this.state.reviewEvents, "review bootstrap 載入失敗"],
            });
            this._rejectA4HandoffBeforeConsume("review_bootstrap_failed");
            await this._loadReviewDataFromBimControl();
        }
    }

    private async _handleQueuedForInstance(reviewRequest: ReviewSessionRequest | null, artifactBindings: ArtifactBinding[]): Promise<void> {
        const queuedBindings = artifactBindings.length > 0 ? artifactBindings : reviewRequest?.artifact_bindings || [];
        const queuedAssets = this._assetsFromArtifactBindings(queuedBindings);
        if (reviewRequest) {
            try {
                await this.bimControlClient.patchReviewSessionRequest(reviewRequest.review_request_id, {
                    status: "queued_for_instance",
                    artifact_bindings: queuedBindings,
                    lifecycle_event: {
                        type: "queuedForKitInstance",
                        reason: "capacity_slots",
                    },
                });
            } catch (error) {
                console.warn("Unable to patch queued review request.", error);
            }
        }
        this.setState({
            reviewRequestId: reviewRequest?.review_request_id || null,
            reviewLifecycleStatus: "queued_for_instance",
            reviewStatus: lifecycleStatusText("queued_for_instance"),
            usdAssets: this._mergeAssets(this.state.usdAssets, queuedAssets),
            selectedUSDAsset: this.state.selectedUSDAsset || queuedAssets[0] || null,
            loadingText: lifecycleStatusText("queued_for_instance"),
            isLoading: false,
            reviewEvents: [...this.state.reviewEvents, "等待 Kit / GPU instance 配額"],
        });
    }

    private async _loadReviewDataFromBimControl(): Promise<void> {
        try {
            const artifacts = await this.bimControlClient.getArtifacts(reviewEnv.defaultModelVersionId);
            const usdAssets = this._assetsFromReviewArtifacts(artifacts);
            this.setState({
                reviewArtifacts: artifacts,
                usdAssets: this._mergeAssets(this.state.usdAssets, usdAssets),
                selectedUSDAsset: this.state.selectedUSDAsset || usdAssets[0] || null,
                mappingUrl: this._resolveMappingUrl(null, artifacts),
                reviewEvents: [...this.state.reviewEvents, "已從 coordinator / control-plane shadow 載入 review 資料"],
            });
        }
        catch (error) {
            console.warn("Unable to load review data from coordinator/control-plane shadow.", error);
        }
    }

    private _assetsFromReviewArtifacts(artifacts: ReviewArtifact[]): USDAssetType[] {
        return artifacts
            .filter((artifact) => artifact.artifact_type === "usdc" && artifact.status === "ready" && artifact.url)
            .map((artifact) => ({
                name: artifact.name || artifact.artifact_id,
                url: artifact.url as string,
            }));
    }

    private _assetsFromArtifactBindings(bindings: ArtifactBinding[]): USDAssetType[] {
        return bindings
            .filter((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && binding.url)
            .sort((left, right) => left.load_order - right.load_order)
            .map((binding) => ({
                name: binding.display_name || binding.source_ifc_filename || binding.artifact_id || binding.artifact_group_id,
                url: binding.url as string,
            }));
    }

    private _mergeAssets(existing: USDAssetType[], incoming: USDAssetType[]): USDAssetType[] {
        const byUrl = new Map<string, USDAssetType>();
        for (const asset of existing) {
            if (!byUrl.has(asset.url)) byUrl.set(asset.url, asset);
        }
        for (const asset of incoming) {
            byUrl.set(asset.url, asset);
        }
        return Array.from(byUrl.values());
    }

    private _resolveMappingUrlForAsset(asset: USDAssetType): string | null {
        const binding = this.state.latestStreamConfig?.artifact_bindings?.find((item) => item.url === asset.url && item.mapping_url);
        if (binding?.mapping_url) return binding.mapping_url;
        const artifact = this.state.reviewArtifacts.find((item) => item.url === asset.url && item.mapping_url);
        return artifact?.mapping_url || null;
    }

    private _resolveMappingUrl(streamConfig: ReviewStreamConfig | null, artifacts: ReviewArtifact[]): string | null {
        if (streamConfig?.model.mapping_url) {
            return streamConfig.model.mapping_url;
        }
        const mappedBinding = streamConfig?.artifact_bindings?.find((binding) => binding.mapping_url);
        if (mappedBinding?.mapping_url) {
            return mappedBinding.mapping_url;
        }
        const mappedArtifact = artifacts.find((artifact) => artifact.artifact_type === "usdc" && artifact.mapping_url);
        return mappedArtifact?.mapping_url || null;
    }

    /**
    * @function _queryLoadingState
    *
    * Sends Kit a message to find out what the loading state is.
    * Receives a 'loadingStateResponse' event type
    */
    private _queryLoadingState(activitySource: "background" | "user" = "background"): void {
        const message: AppStreamMessageType = {
            ...buildLoadingStateQuery()
        };
        this._sendStreamMessage(message, undefined, activitySource);
    }

    /**
     * @function _onStreamStarted
     *
     * Sends a request to open an asset. If the stream is from GDN it is assumed that the
     * application will automatically load an asset on startup so a request to open a stage
     * is not sent. Instead, we wait for the streamed application to send a
     * openedStageResult message.
     */
    private _reportStreamReadinessIfFrame(streamGeneration = this.streamGeneration): void {
        if (
            !this._isCurrentStreamCallback(streamGeneration, "video-ready")
            || this.state.webrtcLifecycleStatus !== "started"
            || !this._hasRemoteVideoFrame()
        ) return;
        this.reviewSocket?.setStreamReady(true);
        this._queryLoadingState();
    }

        private _onStreamStarted(streamGeneration = this.streamGeneration): void {
            if (!this._isCurrentStreamCallback(streamGeneration, "started")) return;
        if (this.nativeOpenStagePoisonedGeneration === streamGeneration) {
            if (this.nativeOpenStageReplacementStartGeneration !== streamGeneration) {
                this._appendReviewEvent("ignored same-lifecycle AppStreamer start; reconnect is required before native stage retry");
                return;
            }
            this.nativeOpenStagePoisonedGeneration = null;
            this.nativeOpenStageReplacementStartGeneration = null;
        }
        this.setState(
            { streamDiagnostic: null, webrtcLifecycleStatus: "started" },
            () => this._reportStreamReadinessIfFrame(streamGeneration),
        );
            this._clearStreamStartTimeout();
            if (isSpectatorStreamMode()) {
                // viewer-edge-bim-server-console:spectator 沿用 primary 已載入的 Kit stage,
                // 本端不自行 openStage;但僅當 coordinator 標記 viewport_sharing.spectator_ready
                // 才視為 stage_truth=matched,否則維持 pending(不偽宣告 Runtime ready)。
                const spectatorReady = this.state.latestStreamConfig?.viewport_sharing?.spectator_ready === true;
                this.setState((state) => ({
                    showStream: true,
                    showUI: true,
                    isLoading: false,
                    loadingText: spectatorReady ? "旁觀串流已連線" : "旁觀串流已連線，等待 primary stage 就緒",
                    stageLoadStatus: spectatorReady ? 'matched' : 'pending',
                    reviewEvents: [...state.reviewEvents, "Spectator stream 已連線，沿用目前 Kit stage"],
                }));
                return;
            }
            this.setState((state) => ({
                showStream: true,
                showUI: true,
                isLoading: false,
                loadingText: "串流已連線，等待 Kit 狀態回應",
                reviewEvents: [...state.reviewEvents, "WebRTC stream 已連線，正在確認 Kit stage state"],
            }), () => {
                // A replacement stream cannot inherit the previous endpoint's
                // readiness. Wait for this generation's probe before it can open.
                if (this.state.isKitReady && this._canOpenSelectedAsset()) {
                    this._scheduleDeferredOpenStage();
                    return;
                }
                this._pollForKitReady();
            })
        }

    /**
    * @function _pollForKitReady
    *
    * Attempts to query Kit's loading state until a response is received.
    * Once received, the 'isKitReady' flag is set to true and polling ends
    */
    async _pollForKitReady() {
        // 進入點先取消任何 pending chain:正常遞迴時舊 timer 已觸發(clearTimeout 為 no-op),
        // in-mount 重入(_onStreamStarted 多次觸發)時取消孤兒 timer,確保同時只有一條 poll chain。
        this._clearPollForKitReady();
        if (this.state.isKitReady === true) return

        console.info("polling Kit availability")
        this._queryLoadingState()
        // Poll every 3 seconds;存 id 讓 componentWillUnmount 能取消,避免卸載後 setState。
        this._pollForKitReadyId = window.setTimeout(() => this._pollForKitReady(), 3000);
    }

    private _clearPollForKitReady(): void {
        if (this._pollForKitReadyId === null) return;
        window.clearTimeout(this._pollForKitReadyId);
        this._pollForKitReadyId = null;
    }

    /**
     * @function _getAsset
     * 
     * Attempts to retrieve an asset from the list of USD assets based on a supplied USD path
     * If a match is not found, a USDAssetType with empty values is returned.
     */
    private _getAsset(path: string): USDAssetType {
        if (!path)
            return {name: "", url: ""}
        
        // returns the file name from a path
        const getFileNameFromPath = (path: string): string | undefined => path.split(/[/\\]/).pop();

        for (const asset of this.state.usdAssets) {
            if (getFileNameFromPath(asset.url) === getFileNameFromPath(path))
                return asset
        }
        
        return {name: "", url: ""}
    }

    /**
    * @function _onLoggedIn
    *
    * Runs when the user logs in
    */
    private _onLoggedIn(userId: string, streamGeneration = this.streamGeneration): void {
        if (!this._isCurrentStreamCallback(streamGeneration, "logged-in")) return;
        if (StreamConfig.source === "gfn"){
            console.info(`Logged in to GeForce NOW as ${userId}`)
            this.setState({ loadingText: "等待串流開始", isLoading: false})
        }
    }

    /**
    * @function _openSelectedAsset
    *
    * Send a request to load an asset based on the currently selected asset
    */
    private _handleStreamStopped(
        kind: "stopped" | "terminated",
        message: unknown,
        streamGeneration = this.streamGeneration,
    ): void {
        if (!this._isCurrentStreamCallback(streamGeneration, kind)) return;
        this.reviewSocket?.setStreamReady(false);
        // A stopped AppStreamer lifecycle can still deliver a late callback.
        // Advance synchronously before React remounts so focus/highlight/A4
        // results cannot mutate the terminal disconnect state.
        this.streamGeneration += 1;
        const pendingA4HandoffRequestId = this.a4HandoffPendingRequestId;
        // AppStreamer keeps response callbacks in the old lifecycle. A later
        // stage request must remount before it can safely reuse this slot.
        this.nativeOpenStagePoisonedGeneration = this.streamGeneration;
        this.nativeOpenStageReplacementStartGeneration = null;
        this._retireNativeOpenStageDispatches();
        this._invalidateStageAttempt();
        for (const [requestId, context] of this.runtimeCommandContexts.entries()) {
            this._claimRuntimeCommandTerminal(requestId, context.eventType, "superseded");
        }
        if (pendingA4HandoffRequestId) {
            this._finishA4HandoffCommand(
                pendingA4HandoffRequestId,
                "rejected",
                "stream_lifecycle_superseded",
                true,
            );
        }
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this._clearDeferredOpenStage();
        const endpoint = streamEndpointLabel(this.state.activeStreamEndpoint);
        const diagnostic = [
            `webrtc_disconnected=${kind}`,
            `${t("端點", "Endpoint")}${t("：", ": ")}${endpoint}`,
            `${t("診斷", "Diagnostic")}${t("：", ": ")}${this._getVideoDiagnosticText()}`,
            `event${t("：", ": ")}${JSON.stringify(message)}`,
            t(
                "請按「重新連線」重建 viewer 端 AppStreamer；若仍停在 busy/disconnected，需重啟 Kit/WebRTC runtime。",
                "Press 「Reconnect WebRTC」 to rebuild the viewer-side AppStreamer; if it stays busy or disconnected, restart the Kit/WebRTC runtime.",
            ),
        ].join("\n");
        // 失敗態矩陣 stream-disconnected（task 5.6 slice-3）：讓 console parent 於
        // 終止當下即收到可見斷線訊號（額外於既有 stage_loaded/unproven 撤銷之上，
        // 因 unproven 也會由 stage-unproven 等其他路徑發出，parent 無法據以區分斷線）。
        this._postToParent({ type: "stream_state", state: "disconnected", kind });
        this.setState((state) => ({
            loadingText: "webrtc_disconnected",
            streamDiagnostic: diagnostic,
            showStream: false,
            isLoading: false,
            loadedStageUrl: null,
            stageLoadStatus: "disconnected",
            webrtcLifecycleStatus: kind,
            idleCountdownRemainingSeconds: null,
            reviewEvents: [...state.reviewEvents, `WebRTC ${kind}`].slice(-80),
        }));
    }

    private _reconnectStream(): void {
        const streamMountKey = this._replaceStreamLifecycle();
        AppStream.stop();
        this.setState((state) => ({
            isKitReady: false,
            showStream: false,
            isLoading: true,
            loadingText: "正在重新連線 WebRTC...",
            streamDiagnostic: null,
            loadedStageUrl: null,
            stageLoadStatus: state.expectedStageUrl ? "pending" : "unproven",
            webrtcLifecycleStatus: "initializing",
            streamMountKey,
            reviewEvents: [...state.reviewEvents, "重新建立 AppStreamer lifecycle"].slice(-80),
        }), () => this._scheduleStreamStartTimeout());
    }

    private _openSelectedAsset(): void {
        // Important #1：spectator（view-only）不得驅動 openStageRequest / 索取 primary viewer lease。
        // 涵蓋直呼路徑（?debug=1 DemoControlPanel「Open Stage」、_loadUSDAssets / review bootstrap 的內聯
        // 守衛未含 spectator）；否則下方 openStage 包裝會先 await _ensurePrimaryViewerLease() → standalone
        // 情境真 POST viewer-leases/claim requested_role:"primary" 搶占同 session 唯一 primary lease，且
        // isLoading 會卡在「正在載入模型...」。與姊妹函式 _applyBinding（Window.tsx:1092）一致，進入點即 return。
        if (isSpectatorStreamMode()) {
            this._appendReviewEvent("spectator（view-only）：略過 openStageRequest（stage 由 primary 驅動）");
            this.setState({ isLoading: false });
            return;
        }
        if (this.stageProofBlockedRevision) {
            this._appendReviewEvent("略過 openStageRequest：stage binding proof resync required");
            this.setState({
                loadingText: "stage binding proof 尚未重新同步",
                isLoading: false,
                stageLoadStatus: "unproven",
            });
            return;
        }
        const targetAsset = harnessEnabled()
            ? this.state.selectedUSDAsset
            : this._expectedStageAsset() || this.state.selectedUSDAsset;
        if (!targetAsset) {
            console.warn("No USD asset is selected.");
            this.setState({ loadingText: "沒有可用的 USD / USDC 成果檔", isLoading: false });
            return;
        }

        if (this.state.latestStreamConfig && this.state.latestStreamConfig.model.status !== "ready") {
            const status = this.state.latestStreamConfig.model.status;
            console.warn(`Model is not ready for openStageRequest: ${status}.`);
            this.setState({ loadingText: `模型尚未就緒：${status}`, showStream: false, isLoading: false });
            return;
        }

        const attemptGeneration = this._beginStageAttempt(targetAsset.url);
        this.pendingStageUrl = targetAsset.url;
        this.confirmedStageBindingRevision = null;
        this.unprovenStageUrl = null;
        this.loadingStatePollCount = 0;
        this._clearLoadingStateRetry();
        this.setState({
            loadingText: "正在載入模型...",
            showStream: this._hasRemoteVideoFrame(),
            streamDiagnostic: null,
            selectedUSDAsset: targetAsset,
            expectedStageUrl: harnessEnabled()
                ? targetAsset.url
                : this.state.expectedStageUrl || targetAsset.url,
            loadedStageUrl: null,
            stageLoadStatus: "pending",
            isLoading: true
        })
        this.setState({ usdPrims: [], selectedUSDPrims: new Set<USDPrimType>() });
        this.usdStageRef.current?.resetExpandedIds();
        console.log(`Sending request to open asset: ${redactStageUrlForDiagnostic(targetAsset.url)}.`);
        const artifactBindings = this.state.latestStreamConfig?.artifact_bindings?.filter((binding) => binding.url === targetAsset.url) || [];
        const composition = this.state.latestStreamConfig?.stage_composition;
            const selectedIsPrimary = composition?.primary?.url === targetAsset.url;
            const openStage = async () => {
                if (harnessEnabled()) {
                this._dispatchStageRequest(
                    buildOpenStageRequest(
                        targetAsset.url,
                        artifactBindings,
                        selectedIsPrimary ? { primary: composition.primary, secondary_layers: composition.secondary_layers || [] } : null,
                    ),
                    attemptGeneration,
                    t(
                        stageLoadFailurePresentation.commandNotSent.zh,
                        stageLoadFailurePresentation.commandNotSent.en,
                    ),
                );
                return;
            }

            const selectedBindings = selectedIsPrimary && composition?.primary
                ? [
                    {
                        artifact_id: composition.primary.artifact_id,
                        role: "primary" as const,
                        load_order: composition.primary.load_order,
                    },
                    ...(composition.secondary_layers || []).map((binding) => ({
                        artifact_id: binding.artifact_id,
                        role: "secondary" as const,
                        load_order: binding.load_order,
                    })),
                ]
                : artifactBindings.slice(0, 1).map((binding) => ({
                    artifact_id: binding.artifact_id,
                    role: "primary" as const,
                    load_order: 0,
                }));
            if (selectedBindings.length === 0) {
                throw new Error("selected stage has no server-owned artifact binding");
            }
            this.pendingStagePreauthorizationIntent = this.stageIntentGeneration;
            const transaction = await this._preauthorizeStageBindingWithinDeadline(selectedBindings);
            if (!this._isCurrentStageAttempt(attemptGeneration, "pending")) return;
            this.pendingStagePreauthorizationIntent = null;
            this.pendingStageUrl = transaction.stage_composition.primary.usdc_url;
            if (this.activeStageAttempt) this.activeStageAttempt.targetUrl = this.pendingStageUrl;
            this._dispatchStageRequest(
                buildAuthorizedOpenStageRequest(transaction),
                attemptGeneration,
                t(
                    stageLoadFailurePresentation.commandNotSent.zh,
                    stageLoadFailurePresentation.commandNotSent.en,
                ),
            );
        };
        void openStage().catch((error) => {
            if (!this._isCurrentStageAttempt(attemptGeneration, "pending")) return;
            this.pendingStagePreauthorizationIntent = null;
            const authorizationTimedOut = isStageAuthorizationTimeout(error);
            this._failStageLoad(
                t(stageLoadFailurePresentation.title.zh, stageLoadFailurePresentation.title.en),
                authorizationTimedOut
                    ? t(stageLoadFailurePresentation.authorizationTimedOut.zh, stageLoadFailurePresentation.authorizationTimedOut.en)
                    : t(stageLoadFailurePresentation.authorizationFailed.zh, stageLoadFailurePresentation.authorizationFailed.en),
                attemptGeneration,
                authorizationTimedOut ? "stage_binding_authorization_timeout" : undefined,
            );
        });
    }

    /**
    * @function _onSelectUSDAsset
    *
    * React to user selecting an asset in the USDAsset selector.
    */
    private _onSelectUSDAsset (usdAsset: USDAssetType): void {
        console.log(`Asset selected: ${usdAsset.name}.`);
        const mappingUrl = this._resolveMappingUrlForAsset(usdAsset);
        this.setState({
            selectedUSDAsset: usdAsset,
            mappingUrl,
            mappingStatus: mappingUrl ? "尚未載入 mapping" : "此成果檔沒有 mapping URL",
            mappingSummary: null,
            mappingItems: [],
            selectedMappingIndex: 0,
            lastMappingVerification: null,
            mappingVerificationBlockedReason: null,
        }, () => {
            if (!this._canOpenSelectedAsset()) {
                this._appendReviewEvent(`已選擇 ${usdAsset.name}，等待 Kit ready 後載入`);
                this._scheduleLoadingStateQuery(500);
                return;
            }
            if (!this.state.showStream || !this._hasRemoteVideoFrame()) {
                this._appendReviewEvent(`已選擇 ${usdAsset.name}，等待 WebRTC streamReady 後載入`);
                this._scheduleDeferredOpenStage();
                return;
            }
            this._openSelectedAsset();
        });
    }
    
    /**
    * @function _getChildren
    *
    * Send a request for the child prims of the given usdPrim.
    * Note that a filter is supported.
    */
    private _getChildren (usdPrim: USDPrimType | null = null): void {
        // Get geometry prims. If no usdPrim is specified then get children of /World.
        console.log(`Requesting children for path: ${usdPrim ? usdPrim.path : '/World'}.`);
        this._sendStreamMessage(buildGetChildrenRequest(usdPrim ? usdPrim.path : '/World'));
    }

    /**
    * @function _makePickable
    *
    * Send a request to make prims pickable/selectable.
    * By default the client requests to make only a handful of the prims selectable - leaving the background items unselectable.
    */
    private _makePickable (usdPrims: USDPrimType[]): void {
        const paths: string[] = usdPrims.map(prim => prim.path);
        if (paths.length === 0) return;
        console.log(`Sending request to make prims pickable: ${paths}.`);
        const message: AppStreamMessageType = {
            event_type: "makePrimsPickable",
            payload: {
                paths   : paths,
            }
        };
        this._sendStreamMessage(message);
    }

    /**
    * @function _onSelectUSDPrims
    *
    * React to user selecting items in the USDStage list.
    * Sends a request to change the selection in the USD Stage.
    */
    private _onSelectUSDPrims (selectedUsdPrims: Set<USDPrimType>): void {
        console.log(`Sending request to select: ${selectedUsdPrims}.`);
        this.setState({ selectedUSDPrims: selectedUsdPrims });
        const paths: string[] = Array.from(selectedUsdPrims).map(obj => obj.path);
        // 統一治理控制台 MVP（W4 點 3D → ifc_guid 方向）：經 MappingCache 反查 ifc_guid 帶進治理；
        // 無對映誠實記事件（不捏造 guid）。與 live viewport 點選（stageSelectionChanged）共用 _reverseLookupGuid。
        if (paths[0]) this._reverseLookupGuid(paths[0]);

        // CH-B spectator gate：view-only 角色不送任何 mutating 指令（誠實，不做 best-effort 隱性送出）。
        // 後端權威另在 streaming server 以 source_client_id 驗證（CH-C），前端 gate 僅 UX。
        if (isSpectatorStreamMode()) {
            this._appendReviewEvent(`spectator（view-only）：略過 select / focus（${paths[0] || "none"}）`);
            return;
        }

        const message: AppStreamMessageType = { event_type: "selectPrimsRequest", payload: { paths } };
        this._sendStreamMessage(message);
        // CH-B：點語意樹節點 → 相機以該元件聚焦（spec：點 prim path → 相機聚焦）。
        if (paths[0]) {
            this._sendStreamMessage(buildFocusPrimRequest(paths[0]));
        }

        selectedUsdPrims.forEach(usdPrim => {this._onFillUSDPrim(usdPrim)});
    }

    /**
    * @function _onStageReset
    *
    * Clears the selection and sends a request to reset the stage to how it was at the time it loaded.
    */
    private _onStageReset (): void {
        this.setState({ selectedUSDPrims: new Set<USDPrimType>() });
        const selection_message: AppStreamMessageType = {
            event_type: "selectPrimsRequest",
            payload: {
                paths: []
            }
        };
        this._sendStreamMessage(selection_message);

        const reset_message: AppStreamMessageType = {
            event_type: "resetStage",
            payload: {}
        };
        this._sendStreamMessage(reset_message);
    }

    private async _loadElementMapping(): Promise<void> {
        const mappingUrl = this.state.mappingUrl || this._resolveMappingUrl(this.state.latestStreamConfig, this.state.reviewArtifacts);
        if (!mappingUrl) {
            this.setState({
                mappingStatus: "沒有 mapping_url，無法載入 element_mapping.json",
                mappingItems: [],
                mappingSummary: null,
                selectedMappingIndex: 0,
                mappingVerificationBlockedReason: null,
            });
            return;
        }

        this.setState({ mappingStatus: "正在載入 element_mapping.json", mappingUrl });
        try {
            // console-mapping-proxy：有 review session 時經 coordinator :8004 proxy 載入
            // （守邊界：viewer SHALL NOT HTTP 直連 :49101，且解 hybrid/LAN 跨來源 CORS —— 直連
            // artifact 端點無 CORS 會 Failed to fetch、使 MappingCache 空、標示恆誤判未對映）。
            // 無 review session（debug / 本機直開檔）才 fallback 直抓 mapping_url。
            const sessionId = this.state.reviewSessionId;
            let payload: unknown;
            if (sessionId) {
                // 帶 mappingUrl：多 binding 時讓 coordinator 以 session binding 白名單選對該 asset 的 mapping。
                payload = await governanceClient.elementMappingForSession(sessionId, mappingUrl);
            } else {
                const response = await fetch(mappingUrl, { headers: { Accept: "application/json" } });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                payload = await response.json();
            }
            if (!isElementMappingDocument(payload)) {
                throw new Error("mapping JSON shape is invalid");
            }
            // 統一治理控制台 MVP（Q2）：鎖當前 model version 的 MappingCache；換版本則重建（不跨版本智能失效）。
            // W9：mapping_url 改變（即使同 model version，例如重轉換產出新 artifact）也需重建，避免讀到舊對映。
            // fake mapping 由 MappingCache 內部拒絕（不冒充真實覆蓋 / 不提供假 prim）。
            const mvId = this.state.currentModelVersionId;
            if (!this._mappingCache || !this._mappingCache.belongsTo(mvId) || this._mappingCacheUrl !== mappingUrl) {
                this._mappingCache = MappingCache.fromDocument(payload, mvId);
                this._mappingCacheUrl = mappingUrl;
            }
            const items = Array.isArray(payload.items)
                ? payload.items.filter((item): item is Record<string, unknown> => isRecord(item) && Boolean(item['usd_prim_path']))
                : [];
            const summary = payload.summary || {
                mapped_count: items.length,
                unmapped_ifc_count: payload.unmapped_ifc_guids?.length || 0,
                unmapped_usd_count: payload.unmapped_usd_prims?.length || 0,
                fake_mapping_count: 0,
            };
            const blockedReason = mappingVerificationBlockReason(payload);
            const mappedCount = summary.mapped_count ?? items.length;
            const fakeCount = summary.fake_mapping_count ?? 0;
            const status = blockedReason
                ? `已載入 mapping，但偵測到 mock/fake 資料；正式驗證已停用`
                : items.length > 0
                ? `已載入 ${items.length} 筆可送到 Kit 的 mapping item`
                : `已載入 mapping，但 mapped_count=${mappedCount}、fake_mapping_count=${fakeCount}，目前沒有可驗證 item`;

            this.setState({
                mappingUrl,
                mappingStatus: status,
                mappingSummary: summary,
                mappingItems: items,
                selectedMappingIndex: 0,
                lastMappingVerification: blockedReason || (items.length > 0 ? null : "mapping items 為空；請先產出真實 ifc_guid -> usd_prim_path 對應"),
                mappingVerificationBlockedReason: blockedReason,
            });
            this._appendReviewEvent(status);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setState({
                mappingStatus: `mapping 載入失敗：${message}`,
                mappingItems: [],
                mappingSummary: null,
                selectedMappingIndex: 0,
                lastMappingVerification: null,
                mappingVerificationBlockedReason: null,
            });
            this._appendReviewEvent(`mapping 載入失敗：${message}`);
        }
    }

    private _selectMappingIndex(index: number): void {
        const safeIndex = Number.isFinite(index) ? Math.max(0, Math.min(index, Math.max(this.state.mappingItems.length - 1, 0))) : 0;
        this.setState({ selectedMappingIndex: safeIndex });
    }

    private _getSelectedMappingItem(): ElementMappingItem | null {
        return this.state.mappingItems[this.state.selectedMappingIndex] || null;
    }

    private _buildSelectedMappingHighlightItem(): HighlightItem | null {
        if (this.state.mappingVerificationBlockedReason) {
            return null;
        }
        const mappingItem = this._getSelectedMappingItem();
        if (!mappingItem?.usd_prim_path) {
            return null;
        }
        const label = mappingItem.name || mappingItem.ifc_class || mappingItem.ifc_guid || mappingItem.usd_prim_path;
        return {
            prim_path: mappingItem.usd_prim_path,
            ifc_guid: mappingItem.ifc_guid,
            color: [0.1, 0.7, 1, 1],
            label: `Mapping 驗證：${label}`,
            source: "element_mapping",
            issue_id: mappingItem.ifc_guid ? `mapping:${mappingItem.ifc_guid}` : "mapping:selected",
            mapping_method: mappingItem.mapping_method,
            mapping_confidence: mappingItem.mapping_confidence,
        };
    }

    private _sendSelectedMappingHighlight(): void {
        const item = this._buildSelectedMappingHighlightItem();
        if (!item) {
            const reason = this.state.mappingVerificationBlockedReason || "沒有選取含 usd_prim_path 的 mapping item";
            this.setState({ lastMappingVerification: reason });
            this._appendReviewEvent(`mapping 驗證略過：${reason}`);
            return;
        }
        const requestId = makeRequestId("mapping-highlight");
        this.pendingMappingHighlightRequestId = requestId;
        this.pendingMappingPrimPath = item.prim_path;
        this._sendStreamMessage(buildHighlightPrimsRequest([item], true, requestId));
        this.setState({ lastMappingVerification: `已送出 mapping highlight：${item.ifc_guid || "no-guid"} -> ${item.prim_path} (${requestId})` });
    }

    private _sendSelectedMappingFocus(): void {
        const item = this._buildSelectedMappingHighlightItem();
        if (!item) {
            const reason = this.state.mappingVerificationBlockedReason || "沒有選取含 usd_prim_path 的 mapping item";
            this.setState({ lastMappingVerification: reason });
            this._appendReviewEvent(`mapping 聚焦略過：${reason}`);
            return;
        }
        const requestId = makeRequestId("mapping-focus");
        this.pendingMappingFocusRequestId = requestId;
        this.pendingMappingPrimPath = item.prim_path;
        this._sendStreamMessage(buildFocusPrimRequest(item.prim_path, requestId));
        this.setState({ lastMappingVerification: `已送出 mapping focus：${item.ifc_guid || "no-guid"} -> ${item.prim_path} (${requestId})` });
    }

    private _sendDemoFocusWorld(): void {
        this._sendStreamMessage(buildFocusPrimRequest(demoPrimPath));
    }

    private _sendDemoClearHighlight(): void {
        this._sendStreamMessage(buildClearHighlightRequest());
    }

    private _connectDemoSocket(): void {
        const traceId = this.state.latestStreamConfig?.trace_id;
        if (!this.state.reviewSessionId || !traceId) {
            this._appendReviewEvent("略過 Socket.IO 連線：尚未建立 review session");
            return;
        }
        this._connectReviewSocket(this.state.reviewSessionId, traceId);
    }

    /**
    * @function _onFillUSDPrim
    *
    * If the usdPrim has a children property a request is sent for its children.
    * When the streaming app sends an empty children value it is not an array.
    * When a prim does not have children the streaming app does not provide a children
    * property to begin with.
    */
    private _onFillUSDPrim (usdPrim: USDPrimType): void {
        if (usdPrim !== null && "children" in usdPrim && !Array.isArray(usdPrim.children)) {
            this._getChildren(usdPrim);
        }
    }
    
    /**
    * @function _findUSDPrimByPath
    *
    * Recursive search for a USDPrimType object by path.
    */
    private _findUSDPrimByPath (path: string, array: USDPrimType[] = this.state.usdPrims): USDPrimType | null {
        if (Array.isArray(array)) {
            for (const obj of array) {
                if (obj.path === path) {
                    return obj;
                }
                if (obj.children && obj.children.length > 0) {
                    const found = this._findUSDPrimByPath(path, obj.children);
                    if (found) {
                        return found;
                    }
                }
            }
        }
        return null;
    }

    private async _resyncStageBindingProof(): Promise<boolean> {
        const revision = this.stageProofBlockedRevision;
        const generation = this.stageProofBlockGeneration;
        const loadedUrl = this.unprovenStageUrl;
        const sessionId = this.state.reviewSessionId;
        // A status response must not survive the StageAttempt that requested it.
        // Reconnect/stop invalidates the object even if the proof block itself
        // remains pending for an explicit, fresh recovery.
        const resyncAttempt = this.activeStageAttempt;
        const resyncAttemptGeneration = resyncAttempt?.generation;
        if (!revision || revision === "unknown" || !sessionId || !reviewEnv.userToken) return false;
        try {
            const response = await fetch(
                `${reviewEnv.coordinatorApiBase}/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/status`,
                {
                    headers: {
                        Accept: "application/json",
                        "X-User-Token": reviewEnv.userToken,
                    },
                },
            );
            if (!response.ok) return false;
            const raw = await response.json() as unknown;
            if (!isRecord(raw) || !isRecord(raw.stage_binding)) return false;
            const stageBinding = raw.stage_binding;
            const activeRevision = getPayloadString(stageBinding, "active_binding_revision");
            const activeAttempt = this.activeStageAttempt;
            // changed_unconfirmed is only released by the same revision. A
            // retained prior completion cannot prove that a later unconfirmed
            // Kit mutation did not change the physical stage.
            if (activeRevision !== revision) return false;
            if (
                this.stageProofBlockGeneration !== generation
                || this.stageProofBlockedRevision !== revision
                || this.unprovenStageUrl !== loadedUrl
            ) return false;
            if (
                resyncAttemptGeneration
                && (
                    this.activeStageAttempt !== resyncAttempt
                    || this.activeStageAttempt?.generation !== resyncAttemptGeneration
                )
            ) return false;

            // A status confirmation for an older rejected revision must not
            // promote a newer same-URL attempt while it is still awaiting its
            // own correlated terminal. URL equality alone is not proof of B;
            // only B's exact openedStageResult may re-key this recovery.
            const recoveringActiveAttempt = Boolean(
                activeAttempt
                && this._isCurrentStageAttemptAwaitingProof(activeAttempt.generation)
            );
            if (recoveringActiveAttempt && activeAttempt?.statusResyncRevision !== revision) return false;
            if (
                activeAttempt?.statusResyncRevision === revision
                && !recoveringActiveAttempt
            ) return false;
            const recoveryAttemptGeneration = recoveringActiveAttempt
                ? activeAttempt?.generation
                : undefined;

            const matched = Boolean(loadedUrl && this._isLoadedStageExpected(loadedUrl));
            this.stageProofBlockGeneration += 1;
            this.stageProofBlockedRevision = null;
            this.confirmedStageBindingRevision = revision;
            this.unprovenStageUrl = null;
            if (activeAttempt) activeAttempt.statusResyncRevision = undefined;
            if (recoveryAttemptGeneration && matched) {
                this._completeStageLoad(loadedUrl || undefined, revision, recoveryAttemptGeneration);
                this.setState((state) => ({
                    runtimeCommandRejection: null,
                    govBindingActiveRevision: revision,
                    govBindingLastGoodRevision: getPayloadString(stageBinding, "last_good_binding_revision") || revision,
                    reviewEvents: [...state.reviewEvents, "stage binding resync：active"].slice(-80),
                }));
                return true;
            }
            this.setState((state) => ({
                loadedStageUrl: matched ? loadedUrl : null,
                stageLoadStatus: matched ? "matched" : "unproven",
                runtimeCommandRejection: null,
                govBindingActiveRevision: revision,
                govBindingLastGoodRevision: getPayloadString(stageBinding, "last_good_binding_revision") || revision,
                reviewEvents: [...state.reviewEvents, `stage binding resync：${matched ? "active" : "URL mismatch"}`].slice(-80),
            }));
            if (window.parent !== window) {
                this._postToParent({
                    type: "stage_loaded",
                    stageUrl: matched ? loadedUrl : null,
                    status: matched ? "active" : "unproven",
                    binding_revision_id: revision,
                });
            }
            return matched;
        } catch {
            return false;
        }
    }
    
    /**
    * @function _handleCustomEvent
    *
    * Handle message from stream.
    */
    private _handleCustomEvent(
        event: AppStreamEventType | null,
        streamGeneration = this.streamGeneration,
    ): void {
        if (!event) {
            return;
        }
        if (!this._isCurrentStreamCallback(streamGeneration, "custom-event")) return;
        if (!event.event_type && event.messageRecipient === "kit" && typeof event.data === "string") {
            try {
                const parsed = JSON.parse(event.data);
                if (isRecord(parsed)) {
                    event = {
                        ...event,
                        ...parsed,
                        payload: isRecord(parsed.payload) ? parsed.payload : event.payload,
                    };
                }
            } catch {
                // Keep the original event shape so the fallback logger below can surface it.
            }
        }
        if (!event.event_type || !kitToViewerEventTypes.has(event.event_type) || !isRecord(event.payload)) {
            return;
        }
        const authority = this._currentVerifiedDataChannelAuthority();
        if (!authority || event.payload.trace_id !== authority.traceId) return;
        const payload = event.payload;

        if (event.event_type === "commandRejected") {
            const parsed = parseRuntimeCommandRejection(payload);
            if (!parsed) {
                this._appendReviewEvent(t(
                    runtimeRejectionReviewCopy.malformed.zh,
                    runtimeRejectionReviewCopy.malformed.en,
                ));
                return;
            }
            const terminalClaim = parsed.request_id
                ? this.runtimeCommandTerminalClaims.get(parsed.request_id)
                : undefined;
            const terminalSafetyContext = parsed.request_id
                ? this.runtimeCommandTerminalSafetyContexts.get(parsed.request_id)
                : undefined;
            const nativeDataChannelDispatch = this._matchingNativeOpenStageDataChannelTerminal(
                "commandRejected",
                payload,
            );
            const nativeChangedUnconfirmed = Boolean(
                nativeDataChannelDispatch
                && parsed.runtime_state === "changed_unconfirmed",
            );
            if (nativeChangedUnconfirmed && nativeDataChannelDispatch) {
                // A superseded manual load may already have lost its logical
                // request context. Its authenticated physical terminal still
                // proves that Kit changed state without confirmation, so fence
                // the queued intent before releasing the native SDK slot.
                this._applyChangedUnconfirmedStageSafety(
                    nativeDataChannelDispatch.bindingRevisionId,
                    nativeDataChannelDispatch.targetUrl,
                    nativeDataChannelDispatch.stageAttemptGeneration,
                );
            }
            // This must precede duplicate/current-attempt guards: a manual
            // loadArtifactGroupRequest receives only an immediate SDK ACK, and
            // its later DataChannel terminal owns physical slot release.
            this._settleNativeOpenStageDispatchFromDataChannel("commandRejected", payload);
            if (terminalClaim) {
                if (
                    !nativeChangedUnconfirmed
                    && (terminalClaim.outcome === "superseded" || terminalClaim.outcome === "timed-out")
                    && terminalClaim.eventType === parsed.rejected_event_type
                    && parsed.runtime_state === "changed_unconfirmed"
                ) {
                    // A superseded or timed-out stage retires its logical
                    // context, but a late authenticated changed_unconfirmed
                    // still means Kit may have changed state. Preserve exactly
                    // the metadata required to fence a later intent before
                    // this duplicate is discarded.
                    this._applyChangedUnconfirmedStageSafety(
                        terminalSafetyContext?.bindingRevisionId,
                        terminalSafetyContext?.stageUrl,
                        terminalSafetyContext?.stageAttemptGeneration,
                    );
                }
                this._appendReviewEvent(t(
                    runtimeRejectionReviewCopy.duplicate.zh,
                    runtimeRejectionReviewCopy.duplicate.en,
                ));
                return;
            }
            const context = parsed.request_id
                ? this.runtimeCommandContexts.get(parsed.request_id)
                : undefined;
            if (context && context.eventType !== parsed.rejected_event_type) {
                this._appendReviewEvent(t(
                    runtimeRejectionReviewCopy.requestContextMismatch.zh,
                    runtimeRejectionReviewCopy.requestContextMismatch.en,
                ));
                return;
            }
            if (parsed.request_id) {
                if (!this._claimRuntimeCommandTerminal(
                    parsed.request_id,
                    context?.eventType || parsed.rejected_event_type,
                    "rejected",
                )) return;
            } else {
                this._recordRuntimeCommandPhase(
                    parsed.rejection_id || "",
                    parsed.rejected_event_type,
                    "terminal",
                    "rejected",
                );
            }
            this._appendDemoIncoming("commandRejected", {
                event_type: "commandRejected",
                payload: parsed,
            });
            const rejection: RuntimeCommandRejection = {
                ...parsed,
                ...(context?.bindingRevisionId
                    ? { binding_revision_id: context.bindingRevisionId }
                    : {}),
            };
            if (parsed.request_id) {
                this._finishA4HandoffCommand(
                    parsed.request_id,
                    "rejected",
                    parsed.detail_code || parsed.reason,
                    parsed.retryable,
                );
            }
            if (rejection.runtime_state === "changed_unconfirmed") {
                if (!nativeChangedUnconfirmed) {
                    this._applyChangedUnconfirmedStageSafety(
                        context?.bindingRevisionId,
                        context?.stageUrl,
                        context?.stageAttemptGeneration,
                    );
                }
                if (
                    context?.stageAttemptGeneration
                    && !this._isCurrentStageAttemptAwaitingProof(context.stageAttemptGeneration)
                ) return;
                this.setState({ runtimeCommandRejection: rejection });
                return;
            }

            if (
                context?.stageAttemptGeneration
                && !this._isCurrentStageAttemptAwaitingProof(context.stageAttemptGeneration)
            ) return;

            const genericRejectionReviewEvent = runtimeRejectionReviewEvent(
                rejection.rejected_event_type,
                rejection.reason,
            );
            this.setState((state) => ({
                runtimeCommandRejection: rejection,
                reviewEvents: [
                    ...state.reviewEvents,
                    genericRejectionReviewEvent,
                ].slice(-80),
            }));
            if (
                rejection.rejected_event_type === "openStageRequest"
                || rejection.rejected_event_type === "loadArtifactGroupRequest"
            ) {
                this._failStageLoad(
                    t(
                        runtimeRejectionReviewCopy.stageLoadRejected.zh,
                        runtimeRejectionReviewCopy.stageLoadRejected.en,
                    ),
                    rejection.detail_code || rejection.reason,
                    context?.stageAttemptGeneration,
                );
            }
            return;
        }

        this._appendDemoIncoming(event.event_type || event.messageRecipient || "streamEvent", event);

        // response received once a USD asset is fully loaded
        if (event.event_type === "openedStageResult") {
            this._settleNativeOpenStageDispatchFromDataChannel("openedStageResult", payload);
            let correlation = this._correlateRuntimeCommandEvent("openedStageResult", payload);
            if (correlation.disposition !== "matched") {
                if (correlation.disposition === "duplicate") {
                    const requestId = getPayloadString(payload, "request_id");
                    const terminalClaim = this.runtimeCommandTerminalClaims.get(requestId);
                    const terminalSafetyContext = this.runtimeCommandTerminalSafetyContexts.get(requestId);
                    const bindingRevisionId = getPayloadString(payload, "binding_revision_id");
                    if (
                        terminalClaim
                        && terminalSafetyContext
                        && (terminalClaim.outcome === "superseded" || terminalClaim.outcome === "timed-out")
                        && runtimeResponseRequestTypes.get("openedStageResult")?.has(terminalClaim.eventType)
                        && getPayloadString(payload, "result") !== "success"
                        && getPayloadString(payload, "runtime_state") === "changed_failed"
                        && (
                            !terminalSafetyContext.bindingRevisionId
                            || terminalSafetyContext.bindingRevisionId === bindingRevisionId
                        )
                    ) {
                        this._applyChangedFailedStageSafety(
                            terminalSafetyContext,
                            bindingRevisionId || terminalSafetyContext.bindingRevisionId,
                            getPayloadString(payload, "url") || terminalSafetyContext.stageUrl || "",
                            redactRuntimeDiagnosticText(getPayloadString(payload, "error") || "unknown error"),
                        );
                    }
                }
                if (correlation.mismatchReason === "binding_revision" && correlation.context) {
                    this._claimRuntimeCommandTerminal(correlation.requestId, correlation.context.eventType, "error");
                    if (correlation.context.stageAttemptGeneration) {
                        this._failStageLoad(
                            t(stageLoadFailurePresentation.revisionMismatch.zh, stageLoadFailurePresentation.revisionMismatch.en),
                            [
                                `${t(stageLoadFailurePresentation.expectedRevision.zh, stageLoadFailurePresentation.expectedRevision.en)}${t("：", ": ")}${correlation.context.bindingRevisionId}`,
                                `${t(stageLoadFailurePresentation.receivedRevision.zh, stageLoadFailurePresentation.receivedRevision.en)}${t("：", ": ")}${getPayloadString(payload, "binding_revision_id") || "missing"}`,
                            ].join("\n"),
                            correlation.context.stageAttemptGeneration,
                        );
                    }
                }
                return;
            }
            if (
                correlation.context?.stageAttemptGeneration
                && !this._isCurrentStageAttemptAwaitingProof(correlation.context.stageAttemptGeneration)
            ) return;
            correlation = this._completeRuntimeCommandEvent(
                "openedStageResult",
                payload,
                payload.result === "success" ? "success" : "error",
            );
            if (correlation.disposition !== "matched") return;
            if (payload.result === "success") {
                const loadedUrl = getPayloadString(payload, "url");
                const bindingRevisionId = getPayloadString(payload, "binding_revision_id");
                if (this.stageProofBlockedRevision) {
                    const stageAttemptGeneration = correlation.context?.stageAttemptGeneration;
                    const currentAttemptCanRecover = Boolean(
                        bindingRevisionId
                        && loadedUrl
                        && this._isLoadedStageExpected(loadedUrl)
                        && stageAttemptGeneration
                        && this._isCurrentStageAttemptAwaitingProof(stageAttemptGeneration)
                    );
                    if (currentAttemptCanRecover && this.activeStageAttempt) {
                        // This is B's exact correlated terminal. Re-key status
                        // recovery to B so an older A block cannot strand B.
                        this.stageProofBlockedRevision = bindingRevisionId;
                        this.activeStageAttempt.statusResyncRevision = bindingRevisionId;
                        this.unprovenStageUrl = loadedUrl;
                        this.stageProofBlockGeneration += 1;
                    } else if (
                        bindingRevisionId === this.stageProofBlockedRevision
                        && loadedUrl
                        && this._isLoadedStageExpected(loadedUrl)
                    ) {
                        this.unprovenStageUrl = loadedUrl;
                        this.stageProofBlockGeneration += 1;
                    }
                    this.setState((state) => ({
                        loadedStageUrl: null,
                        stageLoadStatus: "unproven",
                        reviewEvents: [
                            ...state.reviewEvents,
                            "忽略未經 authenticated status resync 的 late openedStageResult",
                        ].slice(-80),
                    }));
                    void this._resyncStageBindingProof();
                    return;
                }
                if (bindingRevisionId) {
                    this.confirmedStageBindingRevision = bindingRevisionId;
                }
                // 誠實鐵律：只有「Kit 回報且與 expected 相符的 loaded URL」才算 stage-match 證據。
                // 缺 loaded URL（loadedUrl 為空字串）時 stageEvidenceMatched=false，不得偽宣告 applied。
                const stageEvidenceMatched = loadedUrl ? this._recordLoadedStageEvidence(loadedUrl, "openedStageResult") : false;
                if (loadedUrl && !stageEvidenceMatched) {
                    if (bindingRevisionId) {
                        this._clearPendingBindingApplyForAttempt(correlation.context?.stageAttemptGeneration);
                        this.setState({
                            govBindingApplyState: {
                                status: "failed",
                                reason: "stale_stage_or_mismatch",
                            },
                        });
                    }
                    return;
                }
                if (bindingRevisionId) {
                    if (!stageEvidenceMatched) {
                        // success 但缺 loaded URL 證據 → 誠實標 failed，不宣告 applied（不在缺證據下偽成功）。
                        this.setState({
                            govBindingApplyState: {
                                status: "failed",
                                reason: "missing_stage_evidence",
                            },
                        });
                        this._appendReviewEvent(`binding 未確認：openedStageResult success 但缺 loaded URL 證據（${bindingRevisionId}）`);
                    } else {
                        this._clearPendingBindingApplyForAttempt(correlation.context?.stageAttemptGeneration);
                        this.setState({
                            govBindingActiveRevision: bindingRevisionId,
                            govBindingLastGoodRevision: bindingRevisionId,
                            govBindingApplyState: { status: "applied" },
                        });
                        this._appendReviewEvent(`binding 已套用（Kit openedStageResult 確認）：${bindingRevisionId}`);
                    }
                }
                if (loadedUrl && stageEvidenceMatched) {
                    this._completeStageLoad(loadedUrl, bindingRevisionId || undefined, correlation.context?.stageAttemptGeneration);
                } else {
                    this._failStageLoad(
                        t(stageLoadFailurePresentation.missingStageEvidence.zh, stageLoadFailurePresentation.missingStageEvidence.en),
                        [
                            `${t(stageLoadFailurePresentation.target.zh, stageLoadFailurePresentation.target.en)}${t("：", ": ")}${redactStageUrlForDiagnostic(this.pendingStageUrl || this.state.expectedStageUrl)}`,
                            `${t(stageLoadFailurePresentation.error.zh, stageLoadFailurePresentation.error.en)}${t("：", ": ")}${t(stageLoadFailurePresentation.missingStageEvidence.zh, stageLoadFailurePresentation.missingStageEvidence.en)}`,
                        ].join("\n"),
                        correlation.context?.stageAttemptGeneration,
                        "missing_stage_evidence",
                    );
                }
            }
            else {
                const url = getPayloadString(payload, "url");
                const error = redactRuntimeDiagnosticText(getPayloadString(payload, "error") || "unknown error");
                const runtimeState = getPayloadString(payload, "runtime_state");
                const bindingRevisionId = getPayloadString(payload, "binding_revision_id");
                const requestId = getPayloadString(payload, "request_id");
                if (requestId) this.runtimeCommandContexts.delete(requestId);
                console.error(`Kit App communicates there was an error loading: ${redactStageUrlForDiagnostic(url)} (${error})`);
                if (runtimeState === "changed_failed") {
                    this._applyChangedFailedStageSafety(
                        correlation.context,
                        bindingRevisionId || undefined,
                        url,
                        error,
                    );
                    return;
                }
                this._failStageLoad(
                    t(stageLoadFailurePresentation.title.zh, stageLoadFailurePresentation.title.en),
                    [
                        `${t(stageLoadFailurePresentation.target.zh, stageLoadFailurePresentation.target.en)}${t("：", ": ")}${redactStageUrlForDiagnostic(url || this.pendingStageUrl)}`,
                        `${t(stageLoadFailurePresentation.error.zh, stageLoadFailurePresentation.error.en)}${t("：", ": ")}${error}`,
                    ].join("\n"),
                    correlation.context?.stageAttemptGeneration,
                );
            }
        }

        else if (event.event_type === "loadArtifactGroupResult") {
            this._settleNativeOpenStageDispatchFromDataChannel("loadArtifactGroupResult", payload);
            const result = getPayloadString(payload, "result") || "unknown";
            const requestId = getPayloadString(payload, "request_id");
            const correlation = result === "error"
                ? this._completeRuntimeCommandEvent("loadArtifactGroupResult", payload, "error")
                : this._correlateRuntimeCommandEvent("loadArtifactGroupResult", payload);
            if (correlation.disposition !== "matched") return;
            const context = correlation.context;
            if (requestId && context) {
                if (result === "accepted") {
                    this._recordRuntimeCommandPhase(
                        requestId,
                        context.eventType,
                        "executing",
                    );
                }
            }
            if (result === "error") {
                const error = redactRuntimeDiagnosticText(getPayloadString(payload, "error") || "loadArtifactGroupResult error");
                this.setState({
                    govBindingApplyState: {
                        status: "failed",
                        reason: error,
                    },
                });
                if (context?.stageAttemptGeneration) {
                    this._failStageLoad(
                        t(stageLoadFailurePresentation.title.zh, stageLoadFailurePresentation.title.en),
                        [
                            `${t(stageLoadFailurePresentation.target.zh, stageLoadFailurePresentation.target.en)}${t("：", ": ")}${redactStageUrlForDiagnostic(context.stageUrl || this.pendingStageUrl)}`,
                            `${t(stageLoadFailurePresentation.error.zh, stageLoadFailurePresentation.error.en)}${t("：", ": ")}${error}`,
                        ].join("\n"),
                        context.stageAttemptGeneration,
                    );
                }
            }
            this._appendReviewEvent(`artifact group load result：${result}`);
        }
        
        // response received from the 'loadingStateQuery' request
        else if (event.event_type == "loadingStateResponse") {
            const payloadUrl = getPayloadString(payload, "url");
            if (!this._canApplyLoadingStateResponse(payloadUrl)) return;
            const loadingState = getPayloadString(payload, "loading_state");
            // loadingStateRequest is used to poll Kit for proof of life.
            // For the first loadingStateResponse we set isKitReady to true
            // and run one more query to find out what the current loading state
            // is in Kit
            if (this.state.isKitReady === false) {
                console.info("Kit is ready to load assets")
                this.setState({ isKitReady: true }, () => {
                    // The response can belong to an already-authorized stage load.
                    // Do not issue a duplicate open while that attempt owns the URL.
                    if (this.activeStageAttempt) {
                        if (loadingState === "busy" && this._completeStageLoadFromVisibleStream()) return;
                        this._queryLoadingState();
                        return;
                    }
                    if (this._canOpenSelectedAsset()) {
                        this._openSelectedAsset();
                    } else {
                        this._queryLoadingState();
                    }
                })
            }
            
            else {
                if (this.activeStageAttempt?.status === "completed") {
                    // A completed attempt may still receive a late matching idle probe that
                    // contributes evidence, but it must never reopen loading or polling.
                    if (payloadUrl && loadingState === "idle") {
                        this._recordLoadedStageEvidence(payloadUrl, "loadingStateResponse", loadingState);
                    }
                    return;
                }
                this._clearLoadingStateRetry();
                this.loadingStatePollCount += 1;
                const usdAsset: USDAssetType = this._getAsset(payloadUrl);
                const isStageValid: boolean = !!(usdAsset.name && usdAsset.url);
                const attemptGeneration = this.activeStageAttempt?.generation;

                if (payloadUrl && loadingState === "idle") {
                    if (!this._isLoadedStageExpected(payloadUrl)) {
                        this._recordLoadedStageEvidence(payloadUrl, "loadingStateResponse", loadingState);
                        return;
                    }
                    // loadingStateResponse has no request / attempt correlation. Even an exact
                    // URL can be a delayed response from an older same-URL attempt, so it may
                    // inform the UI but cannot complete or prove the active attempt.
                    this.setState((state) => ({
                        loadingText: t(
                            "stage 已觀察，等待已關聯的完成證據",
                            "Stage observed; awaiting correlated completion evidence.",
                        ),
                        stageLoadStatus: "unproven",
                        reviewEvents: [
                            ...state.reviewEvents,
                            t(
                                "忽略未關聯的 idle loadingStateResponse 完成宣告",
                                "Ignored uncorrelated idle loadingStateResponse completion claim.",
                            ),
                        ].slice(-80),
                    }));
                    return;
                }

                if (loadingState === "busy") {
                    // loadingStateResponse has no request / attempt correlation. A delayed
                    // same-URL busy response must not terminalize the active attempt; its
                    // viewer-owned deadline remains the sole timeout authority.
                    if (attemptGeneration) {
                        if (this._completeStageLoadFromVisibleStream()) return;
                        this.setState({ loadingText: "正在載入模型...", isLoading: true });
                        this._scheduleLoadingStateQuery(1000);
                        return;
                    }
                    if (this.loadingStatePollCount <= 90) {
                        this.setState({ loadingText: "正在載入模型...", isLoading: true });
                        this._scheduleLoadingStateQuery(1000);
                    } else {
                        this._failStageLoad(
                            t(stageLoadTimeoutPresentation.title.zh, stageLoadTimeoutPresentation.title.en),
                            [
                                `${t(stageLoadTimeoutPresentation.target.zh, stageLoadTimeoutPresentation.target.en)}${t("：", ": ")}${redactStageUrlForDiagnostic(this.pendingStageUrl || this.state.selectedUSDAsset?.url)}`,
                                `${t(stageLoadTimeoutPresentation.lastState.zh, stageLoadTimeoutPresentation.lastState.en)}${t("：", ": ")}${payloadUrl ? redactStageUrlForDiagnostic(payloadUrl) : "empty"} busy`,
                                t(stageLoadTimeoutPresentation.missingCompletion.zh, stageLoadTimeoutPresentation.missingCompletion.en),
                            ].join("\n"),
                            undefined,
                            undefined,
                            "stage-load-timeout",
                        );
                    }
                    return;
                }
                
                // set the USD Asset dropdown to the currently opened stage if it doesn't match
                if (isStageValid && usdAsset !== undefined && this.state.selectedUSDAsset !== usdAsset)
                    this.setState({ selectedUSDAsset: usdAsset })

                // if the stage is empty, force-load the selected usd asset; the loading state is irrelevant
                if (!payloadUrl) {
                    if (this.pendingStageUrl && this.loadingStatePollCount <= 3) {
                        this._scheduleLoadingStateQuery(1000);
                    } else {
                        this._failStageLoad(
                            t(stageLoadFailurePresentation.missingUrl.zh, stageLoadFailurePresentation.missingUrl.en),
                            `${t(stageLoadFailurePresentation.target.zh, stageLoadFailurePresentation.target.en)}${t("：", ": ")}${redactStageUrlForDiagnostic(this.pendingStageUrl || this.state.selectedUSDAsset?.url)}`,
                        );
                    }
                    return;
                }
                
            }
        }
        
        // Loading progress amount notification.
        else if (event.event_type === "updateProgressAmount") {
            console.log('Kit App communicates progress amount.');
        }
            
        // Loading activity notification.
        else if (event.event_type === "updateProgressActivity") {
            if (this.activeStageAttempt?.status !== "pending") return;
            console.log('Kit App communicates progress activity.');
            const activityText = getPayloadString(payload, "text");
            // Progress notifications carry no URL or request correlation. `None`
            // is advisory only; completion requires a correlated openedStageResult
            // or exact-target idle loading state backed by an authenticated confirmed revision.
            if (activityText === "None") return;
            if (this.state.loadingText !== "正在載入模型...")
                this.setState( {loadingText: "正在載入模型...", isLoading: true} )
        }

        else if (event.event_type === "highlightPrimsResult") {
            const result = getPayloadString(payload, "result") || "unknown";
            const selectedPaths = getPayloadStringArray(payload, "selected_paths");
            const missingPaths = getPayloadStringArray(payload, "missing_paths");
            const fallbackPaths = getPayloadObjectArray(payload, "fallback_paths");
            const requestId = getPayloadString(payload, "request_id");
            const a4Succeeded = this._a4RuntimeResultSucceeded("highlightPrimsResult", payload);
            const correlation = this._completeRuntimeCommandEvent(
                "highlightPrimsResult",
                payload,
                result === "success" && a4Succeeded !== false ? "success" : "error",
            );
            if (correlation.disposition !== "matched") return;
            if (a4Succeeded !== null && requestId) {
                this._finishA4HandoffCommand(
                    requestId,
                    a4Succeeded ? "succeeded" : "rejected",
                    a4Succeeded ? "matching_highlight_result" : "runtime_result_mismatch",
                    !a4Succeeded,
                );
            }
            const nextState: Partial<AppState> = {
                reviewEvents: [...this.state.reviewEvents, `高亮結果：${result}`],
            };

            if (requestId && requestId === this.pendingMappingHighlightRequestId) {
                const expectedPath = this.pendingMappingPrimPath;
                const passed = result === "success"
                    && !!expectedPath
                    && selectedPaths.includes(expectedPath)
                    && missingPaths.length === 0
                    && fallbackPaths.length === 0;
                nextState.lastMappingVerification = passed
                    ? `mapping highlight 通過：selected=${expectedPath}, missing=0, fallback=0`
                    : `mapping highlight 失敗：result=${result}, expected=${expectedPath || "unknown"}, selected=${selectedPaths.join(",") || "none"}, missing=${missingPaths.length}, fallback=${fallbackPaths.length}`;
                this.pendingMappingHighlightRequestId = null;
            }

            // W2：治理 overlay 標示的非同步確認（與上方 mapping-verify 分開的 pending map）。誠實判定：
            // Kit 真的選到該 primPath 且無 missing 才算「已標示」，否則標 missing/fallback。
            const govPending = requestId ? this._pendingGovHighlights[requestId] : undefined;
            if (govPending) {
                // R6 誠實：Kit 用 fallback path 不算真正確認（鏡像上方 mapping-verify predicate 的 fallback 檢查）。
                const confirmed = result === "success"
                    && selectedPaths.includes(govPending.primPath)
                    && missingPaths.length === 0
                    && fallbackPaths.length === 0;
                nextState.govHighlightConfirm = {
                    ...this.state.govHighlightConfirm,
                    // F1：以 rowKey 為 key（與 overlay 讀取一致），同一 ifc_guid 多筆不同 rule_code 各自獨立確認。
                    [govPending.rowKey]: confirmed ? "已在 3D 標示（Kit 已選取）" : "Kit 未選到該構件（missing/fallback）",
                };
                delete this._pendingGovHighlights[requestId];
            }

            this.setState(nextState as Pick<AppState, keyof AppState>);
        }

        else if (event.event_type === "focusPrimResult") {
            const result = getPayloadString(payload, "result") || "unknown";
            const requestId = getPayloadString(payload, "request_id");
            const a4Succeeded = this._a4RuntimeResultSucceeded("focusPrimResult", payload);
            const correlation = this._completeRuntimeCommandEvent(
                "focusPrimResult",
                payload,
                result === "success" && a4Succeeded !== false ? "success" : "error",
            );
            if (correlation.disposition !== "matched") return;
            if (a4Succeeded !== null && requestId) {
                this._finishA4HandoffCommand(
                    requestId,
                    a4Succeeded ? "succeeded" : "rejected",
                    a4Succeeded ? "matching_focus_result" : "runtime_result_mismatch",
                    !a4Succeeded,
                );
            }
            const nextState: Partial<AppState> = {
                reviewEvents: [...this.state.reviewEvents, `聚焦結果：${result}`],
            };

            if (requestId && requestId === this.pendingMappingFocusRequestId) {
                const expectedPath = this.pendingMappingPrimPath;
                const focusedPath = getPayloadString(payload, "prim_path");
                const fallbackPath = getPayloadString(payload, "fallback_path");
                const passed = result === "success"
                    && !!expectedPath
                    && focusedPath === expectedPath
                    && !fallbackPath;
                nextState.lastMappingVerification = passed
                    ? `mapping focus 通過：focused=${focusedPath}, fallback=0`
                    : `mapping focus 失敗：result=${result}, expected=${expectedPath || "unknown"}, focused=${focusedPath || "none"}, fallback=${fallbackPath || "none"}`;
                this.pendingMappingFocusRequestId = null;
            }

            this.setState(nextState as Pick<AppState, keyof AppState>);
        }

        else if (event.event_type && simpleRuntimeTerminalEvents.has(event.event_type)) {
            const result = getPayloadString(payload, "result") || "unknown";
            const correlation = this._completeRuntimeCommandEvent(
                event.event_type,
                payload,
                result === "success" ? "success" : "error",
            );
            if (correlation.disposition !== "matched") return;
            this._appendReviewEvent(`${event.event_type}：${result}`);
        }
            
        // Notification from Kit about user changing the selection via the viewport.
        else if (event.event_type === "stageSelectionChanged") {
            const prims = Array.isArray(payload.prims)
                ? payload.prims.filter((prim): prim is string => typeof prim === "string")
                : [];

            console.log(prims.constructor.name);
            // W4：live viewport 點選 → 反查 ifc_guid 帶進治理（與 USDStage 清單點選共用 helper，DRY）。
            if (prims[0]) this._reverseLookupGuid(prims[0]);
            if (prims.length === 0) {
                console.log('Kit App communicates an empty stage selection.');
                // F3：取消選取時一併清掉治理選取 guid，避免 overlay 的 gov-selected-guid 行殘留舊 guid（誠實）。
                this.setState({ selectedUSDPrims: new Set<USDPrimType>(), govSelectedGuid: null });
            }
            else {
                console.log('Kit App communicates selection of a USDPrimType: ' + prims.join(', '));
                const usdPrimsToSelect: Set<USDPrimType> = new Set<USDPrimType>();
                prims.forEach((obj) => {
                    const result = this._findUSDPrimByPath(obj);
                    if (result !== null) {
                        usdPrimsToSelect.add(result);
                    }
                });
                this.setState({ selectedUSDPrims: usdPrimsToSelect });
            }
        }
        // Streamed app provides children of a parent USDPrimType
        else if (event.event_type === "getChildrenResponse") {
            console.log('Kit App sent stage prims');
            const prim_path = getPayloadString(payload, "prim_path");
            const children = Array.isArray(payload.children) ? payload.children as USDPrimType[] : [];
            const usdPrim = this._findUSDPrimByPath(prim_path);
            let nextTree = this.state.usdPrims;
            if (usdPrim === null) {
                nextTree = children;
                this.setState({ usdPrims: children });
            }
            else {
                usdPrim.children = children;
                nextTree = this.state.usdPrims;
                this.setState({ usdPrims: this.state.usdPrims });
            }
            if (Array.isArray(children)){
                this._makePickable(children);
            }
            // VG-01: 下傳 USD stage 樹給 parent console
            this._postToParent({
                type: "stage_tree",
                prim_path: prim_path || "/World",
                children: nextTree,
            });
        }
        // CH-F：Kit 確認 binding 已套用 → 更新 active + last-good revision（交易完成；誠實：只有確認才宣告 applied）。
        else if (event.event_type === "bindingApplied") {
            const revision = getPayloadString(payload, "binding_revision_id");
            const correlation = this._completeRuntimeCommandEvent("bindingApplied", payload, "success");
            if (correlation.disposition !== "matched") return;
            if (revision) {
                if (this.stageProofBlockedRevision) {
                    this._appendReviewEvent("忽略未經 authenticated status resync 的 late bindingApplied");
                    void this._resyncStageBindingProof();
                    return;
                }
                this.setState((state) => ({
                    govBindingActiveRevision: revision,
                    govBindingLastGoodRevision: revision,
                    govBindingApplyState: { status: "applied" },
                    reviewEvents: [...state.reviewEvents, `binding 已套用（Kit 確認）：${revision}`],
                }));
            }
        }
        // other messages from app to kit
        else if (event.messageRecipient === "kit") {
            console.log("onCustomEvent");
            if (typeof event.data === "string") {
                try {
                    const parsed = JSON.parse(event.data) as unknown;
                    console.log(isRecord(parsed) ? getPayloadString(parsed, "event_type") || "kit event" : "kit event");
                } catch {
                    console.log("unparseable kit event data");
                }
            }
        }
    }

    /**
    * @function _handleAppStreamFocus
    *
    * Update state when AppStream is in focus.
    */
    private _handleAppStreamFocus (): void {
        console.log('User is interacting in streamed viewer');
    }

    /**
    * @function _handleAppStreamBlur
    *
    * Update state when AppStream is not in focus.
    */
    private _handleAppStreamBlur (): void {
        console.log('User is not interacting in streamed viewer');
    }

    private _isCurrentStreamCallback(streamGeneration: number, kind: string): boolean {
        if (streamGeneration === this.streamGeneration) return true;
        this._appendReviewEvent(`忽略舊 AppStreamer ${kind} 回呼（generation=${streamGeneration}）`);
        return false;
    }
    
    render() {

        const sidebarWidth = 300;
        const demoPanelWidth = 360;
        // viewer-edge-bim-server-console:DemoControlPanel 含 mapping verification +
        // Socket.IO log + issue 試標等 debug 區段,fast MVP 主流程不顯示。
        // 預設只有 `?debug=1` 才渲染(對齊 Inspector ④ 技術細節 spec scenario)。
        const showDebugAssetPanel = this.state.showUI && isDebugQueryEnabled();
        const showDemoPanel = isDebugQueryEnabled()
            && reviewEnv.showDemoPanel
            && !reviewEnv.hasExplicitEmptySessionId;
        const demoPanelRight = showDebugAssetPanel ? sidebarWidth : 0;
        const streamReservedWidth = (showDebugAssetPanel ? sidebarWidth : 0) + (showDemoPanel ? demoPanelWidth : 0);
            const shouldRenderAppStream = !reviewEnv.hasExplicitEmptySessionId
                && Boolean(this.state.reviewSessionId)
                && !isBlockedLifecycle(this.state.reviewLifecycleStatus)
                && this.state.latestStreamConfig?.model.status === "ready";
            const streamRole = isSpectatorStreamMode() ? "spectator" : "primary";
            const renderedStreamGeneration = this.state.streamMountKey;
            const liveFrameObserved = this._hasRemoteVideoFrame();
        const runtimeCommandRejection = this.state.runtimeCommandRejection;
        const runtimeAuthorityUnavailable = runtimeCommandRejection?.detail_code === "authority_unavailable";
        const runtimeCommandRejectionReason = runtimeCommandRejection
            ? runtimeCommandRejection.runtime_state === "changed_unconfirmed"
                ? runtimeRejectionPresentation.stageUnproven
                : runtimeRejectionReasonCopy[runtimeCommandRejection.reason]
            : null;
        const runtimeCommandCanSafelyRetry = runtimeCommandRejection?.retryable === true
            && runtimeCommandRejection.runtime_state !== "changed_unconfirmed";
        const triReady = {
            file: computeFileReady(this.state.latestStreamConfig),
            runtime: computeRuntimeReady(this.state.webrtcLifecycleStatus, this.state.stageLoadStatus),
            semantic: computeSemanticReady(this.state.latestStreamConfig?.quality_metrics_summary),
        };
        const showUsdStageDock = this.state.showUI
            && this.state.viewerTab === "model"
            && (isDebugQueryEnabled() || this.state.usdPrims.length > 0);
        return (
            <div
                style={{
                    position: 'absolute',
                    top: headerHeight,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                }}
            >
                {this.state.reviewSessionId && (
                    <SessionIdleCountdownBanner
                        sessionId={this.state.reviewSessionId}
                        remainingSeconds={this.state.idleCountdownRemainingSeconds}
                        closedReason={this.state.idleClosedReason}
                        recordActivity={() => this._recordSessionActivity()}
                    />
                )}
                <div style={{
                            position: 'absolute',
                            height: "100%",
                            width: `calc(100% - ${streamReservedWidth}px)`
                }}>
                    
                {/* 完整問題分頁：viewer 層分頁列（模型=語意檢視 / 問題=治理操作全幅 / 批註等 roadmap 誠實 disabled）。
                    lift 自 MockViewport section nav，使「問題」分頁隱 MockViewport 後仍可切回。 */}
                {(harnessEnabled() || Boolean(this.state.reviewSessionId)) && (
                    <nav className="gv-tabbar" data-testid="gv-nav" aria-label="viewer sections" style={{ zIndex: 21 }}>
                        <button className={`gv-nav__item ${this.state.viewerTab === "model" ? "active" : ""}`} data-testid="nav-model"
                                aria-current={this.state.viewerTab === "model" ? "page" : undefined}
                                onClick={() => this.setState({ viewerTab: "model" })}>模型</button>
                        <button className={`gv-nav__item ${this.state.viewerTab === "issues" ? "active" : ""}`} data-testid="nav-issues"
                                aria-current={this.state.viewerTab === "issues" ? "page" : undefined}
                                onClick={() => this.setState({ viewerTab: "issues" })}>問題 · 治理</button>
                        {["批註", "測量", "創切", "書籤"].map((label) => (
                            <button key={label} className="gv-nav__item" data-testid={`nav-${label}`} disabled aria-disabled
                                    title="需 live 3D 工具（DataChannel）— roadmap，未實作不假裝可用">{label}<span className="gv-nav__rm">⌛</span></button>
                        ))}
                    </nav>
                )}

                {this.state.a4Handoff.status !== "idle" && (
                    <section
                        role={this.state.a4Handoff.status === "rejected" || this.state.a4Handoff.status === "timed-out" ? "alert" : "status"}
                        aria-live="polite"
                        data-testid="a4-handoff-status"
                        data-status={this.state.a4Handoff.status}
                        data-phase={this.state.a4Handoff.phase}
                        style={{
                            position: "absolute",
                            zIndex: 31,
                            top: this.state.runtimeCommandRejection ? 136 : 52,
                            left: 16,
                            right: 16,
                            padding: "10px 12px",
                            border: "1px solid #38bdf8",
                            background: "rgba(8, 30, 45, 0.96)",
                            color: "#e0f2fe",
                        }}
                    >
                        <strong>A4 3D handoff</strong>
                        {this.state.a4Handoff.action ? ` · ${this.state.a4Handoff.action}` : ""}
                        {`：${this.state.a4Handoff.status}`}
                        {this.state.a4Handoff.detail ? `（${this.state.a4Handoff.detail}）` : ""}
                        {this.state.a4Handoff.handoff_id && (
                            <span data-testid="a4-handoff-id"> · handoff <code>{this.state.a4Handoff.handoff_id}</code></span>
                        )}
                        {this.state.a4Handoff.request_id && (
                            <span data-testid="a4-handoff-request-id"> · request <code>{this.state.a4Handoff.request_id}</code></span>
                        )}
                        {this.state.a4Handoff.retry_of_request_id && (
                            <span data-testid="a4-handoff-retry-link"> · retry of <code>{this.state.a4Handoff.retry_of_request_id}</code></span>
                        )}
                        {(this.state.a4Handoff.status === "rejected" || this.state.a4Handoff.status === "timed-out")
                            && this.state.a4Handoff.retryable
                            && (
                            <button
                                type="button"
                                data-testid="a4-handoff-retry"
                                onClick={() => this._retryA4Handoff()}
                                style={{ marginLeft: 12 }}
                            >
                                Retry
                            </button>
                        )}
                    </section>
                )}

                {runtimeCommandRejection && runtimeCommandRejectionReason && (
                    <div
                        role="alert"
                        aria-live="assertive"
                        data-testid="runtime-command-rejection"
                        style={{
                            position: "absolute",
                            zIndex: 30,
                            top: 52,
                            left: 16,
                            right: 16,
                            padding: "10px 12px",
                            border: "1px solid #f59e0b",
                            background: "rgba(46, 27, 7, 0.96)",
                            color: "#fff7ed",
                        }}
                    >
                        <strong>{t(runtimeRejectionPresentation.title.zh, runtimeRejectionPresentation.title.en)}</strong>
                        {runtimeAuthorityUnavailable ? (
                            <span data-testid="runtime-authority-unavailable">
                                {`：${t(runtimeRejectionPresentation.authorityUnavailable.zh, runtimeRejectionPresentation.authorityUnavailable.en)}；${t(runtimeRejectionPresentation.authorityUnavailableDetail.zh, runtimeRejectionPresentation.authorityUnavailableDetail.en)}`}
                            </span>
                        ) : (
                            `：${t(runtimeCommandRejectionReason.zh, runtimeCommandRejectionReason.en)}`
                        )}
                        {runtimeAuthorityUnavailable && runtimeCommandRejection.runtime_state === "changed_unconfirmed" && (
                            <span data-testid="runtime-command-rejection-stage-unproven">
                                {`；${t(runtimeRejectionPresentation.stageUnproven.zh, runtimeRejectionPresentation.stageUnproven.en)}`}
                            </span>
                        )}
                        <span data-testid="runtime-command-rejection-reason-code"> (<code>{runtimeCommandRejection.reason}</code>)</span>
                        {runtimeCommandCanSafelyRetry
                            ? `（${t(runtimeRejectionPresentation.retryable.zh, runtimeRejectionPresentation.retryable.en)}）`
                            : `（${t(runtimeRejectionPresentation.doNotRetry.zh, runtimeRejectionPresentation.doNotRetry.en)}）`}
                        {runtimeCommandRejection.runtime_state === "changed_unconfirmed" && (
                            <>
                                <span>{`；${t(runtimeRejectionPresentation.stageUnprovenDetail.zh, runtimeRejectionPresentation.stageUnprovenDetail.en)}`}</span>
                                <button
                                    type="button"
                                    data-testid="runtime-command-resync"
                                    onClick={() => { void this._resyncStageBindingProof(); }}
                                    style={{ marginLeft: 12 }}
                                >
                                    {t(runtimeRejectionPresentation.resync.zh, runtimeRejectionPresentation.resync.en)}
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* Loading text indicator */}
                {(!this.state.showStream || this.stageLoadFailureActive) &&
                    <div
                        className="loading-indicator-label"
                        data-testid={this.stageLoadFailureActive ? "stage-load-failure" : undefined}
                        data-stage-failure-reason={this.stageLoadFailureActive ? (this.stageLoadFailureReason ?? "generic") : undefined}
                        role={this.stageLoadFailureActive ? "alert" : "status"}
                        aria-live={this.stageLoadFailureActive ? "assertive" : "polite"}
                        style={this.stageLoadFailureActive ? {
                            position: "absolute",
                            zIndex: 29,
                            top: 52,
                            left: 16,
                            right: 16,
                            width: "auto",
                            marginTop: 0,
                        } : undefined}
                    >
                        {this.state.loadingText}
                        {this.state.streamDiagnostic &&
                            <pre className="stream-diagnostic-panel" data-testid="stream-diagnostic-panel">{this.state.streamDiagnostic}</pre>
                        }
                        <div className="spinner-border" role="status" style={{ marginTop: 10, visibility: this.state.isLoading? 'visible': 'hidden' }} />
                    </div>
                }

                {/* Streamed app */}
                {shouldRenderAppStream &&
                <AppStream
                    key={renderedStreamGeneration}
                    sessionId={this.props.sessionId}
                    backendUrl={this.props.backendUrl}
                    signalingserver={this.state.activeStreamEndpoint.signalingserver}
                    signalingport={this.state.activeStreamEndpoint.signalingport}
                    mediaserver={this.state.activeStreamEndpoint.mediaserver}
                    mediaport={this.state.activeStreamEndpoint.mediaport}
                    accessToken={this.props.accessToken}
                    onStarted={() => this._onStreamStarted(renderedStreamGeneration)}
                    onVideoReady={() => this._reportStreamReadinessIfFrame(renderedStreamGeneration)}
                    onFocus={() => this._handleAppStreamFocus()}
                    onBlur={() => this._handleAppStreamBlur()}
                    style={{
                        position: 'relative',
                        visibility: this.state.showStream? 'visible' : 'hidden'
                    }}
                    onLoggedIn={(userId) => this._onLoggedIn(userId, renderedStreamGeneration)}
                    handleCustomEvent={(event) => this._handleCustomEvent(event, renderedStreamGeneration)}
                    onStreamFailed={() => {
                        if (!this._isCurrentStreamCallback(renderedStreamGeneration, "failed")) return;
                        this.props.onStreamFailed();
                    }}
                    onStopped={(message) => this._handleStreamStopped("stopped", message, renderedStreamGeneration)}
                    onTerminated={(message) => this._handleStreamStopped("terminated", message, renderedStreamGeneration)}
                    />}
                </div>

                {showDemoPanel &&
                    <div
                        style={{
                            position: "absolute",
                            right: demoPanelRight,
                            top: 0,
                            width: demoPanelWidth,
                            maxHeight: "100%",
                            overflow: "auto",
                            zIndex: 5,
                        }}
                    >
                        <DemoControlPanel
                            width={demoPanelWidth}
                            sessionId={this.state.reviewSessionId}
                            reviewStatus={this.state.reviewStatus}
                            selectedAssetUrl={this.state.selectedUSDAsset?.url || null}
                            streamConfig={this.state.latestStreamConfig}
                            mappingUrl={this.state.mappingUrl}
                            mappingStatus={this.state.mappingStatus}
                            mappingSummary={this.state.mappingSummary}
                            mappingItems={this.state.mappingItems}
                            selectedMappingIndex={this.state.selectedMappingIndex}
                            lastMappingVerification={this.state.lastMappingVerification}
                            mappingVerificationBlockedReason={this.state.mappingVerificationBlockedReason}
                            outgoingMessages={this.state.demoOutgoingMessages}
                            incomingMessages={this.state.demoIncomingMessages}
                            socketEvents={this.state.reviewEvents}
                            onCreateOrLoadSession={() => void this._bootstrapReview()}
                            onConnectSocket={() => this._connectDemoSocket()}
                            onOpenStage={() => this._openSelectedAsset()}
                            onLoadingState={() => this._queryLoadingState("user")}
                            onGetChildren={() => this._getChildren()}
                            onFocusWorld={() => this._sendDemoFocusWorld()}
                            onClearHighlight={() => this._sendDemoClearHighlight()}
                            onLoadMapping={() => void this._loadElementMapping()}
                            onSelectMappingIndex={(index) => this._selectMappingIndex(index)}
                            onHighlightSelectedMapping={() => this._sendSelectedMappingHighlight()}
                            onFocusSelectedMapping={() => this._sendSelectedMappingFocus()}
                        />
                    </div>
                }

                {this.state.showUI &&
                <>
                    {/* viewer-edge-bim-server-console:USDAsset / USDStage 是 debug 工具,
                        預設不渲染;`?debug=1` 才顯示作為 Inspector ④ 技術細節入口。 */}
                    {showDebugAssetPanel && (
                        <USDAsset
                            usdAssets={this.state.usdAssets}
                            selectedAssetUrl={this.state.selectedUSDAsset?.url}
                            onSelectUSDAsset={(value) => this._onSelectUSDAsset(value)}
                            width={sidebarWidth}
                        />
                    )}
                    {/* CH-B：USD/BIM 語意樹。有 usdPrims（stage 已載入）即顯示為可操作面板，
                        不再僅限 ?debug=1（USDAsset 下拉維持 debug 工具）。 */}
                    {showUsdStageDock && (
                        <div
                            data-testid="usd-stage-left-dock"
                            style={{
                                position: "absolute",
                                left: 0,
                                top: headerHeight,
                                width: sidebarWidth,
                                // 明確高度（top..bottom）讓 dock 真正撐開；底部只保留一般工具列安全距離。
                                bottom: 12,
                                overflow: "hidden",
                                // 左側語意樹須在治理 overlay（z-index 20）之上才可點選操作（spec：左側 USD 樹）。
                                zIndex: 25,
                            }}
                        >
                            <USDStage
                                ref={this.usdStageRef}
                                width={sidebarWidth}
                                usdPrims={this.state.usdPrims}
                                onSelectUSDPrims={(value) => this._onSelectUSDPrims(value)}
                                selectedUSDPrims={this.state.selectedUSDPrims}
                                fillUSDPrim={(value) => this._onFillUSDPrim(value)}
                                onReset={() => this._onStageReset()}
                            />
                        </div>
                    )}
                </>
                }

                {/* CH-H1/H3：模型分頁語意檢視（①模型資訊 ②IFC語意 ③結構 ④對構 ⑥空間）。
                    無真實 WebRTC 幀（harness 或尚未出幀）→ 中央資訊濃密 mock viewport（deterministic·no-GPU，非壞掉）；
                    CH-H3：取得真實 Kit 幀（_hasRemoteVideoFrame）後**不再卸載**，改以 liveMode 切左側語意側欄，與中央
                    <video> live 3D 並存（對齊 AI-BIM-Geo Viewer 範本：①③ 左欄 + ②④⑥ 隨點構件），GPU 出畫面時語意
                    面板不消失。additive：不改 AppStream / spectator 既有機制；不回復 artifact/stage-truth 浮層；
                    問題分頁仍 viewerTab!=="model" 不掛載（不擾全幅治理）。 */}
                {this.state.viewerTab === "model"
                    && (harnessEnabled() || Boolean(this.state.reviewSessionId))
                    && (
                    <MockViewport
                        liveMode={liveFrameObserved}
                        harness={harnessEnabled()}
                        stageUrl={this.state.expectedStageUrl}
                        loadedStageUrl={this.state.loadedStageUrl}
                        webrtcStatus={this.state.webrtcLifecycleStatus}
                        streamRole={streamRole}
                        lifecycleStatus={this.state.reviewLifecycleStatus}
                        frameObserved={liveFrameObserved}
                        selectedGuid={this.state.govSelectedGuid ?? null}
                        bindings={this.state.latestStreamConfig?.artifact_bindings ?? []}
                        model={this.state.latestStreamConfig?.model ?? null}
                        metrics={this.state.latestStreamConfig?.quality_metrics_summary ?? null}
                        projectId={this.state.currentProjectId}
                        modelVersionId={this.state.currentModelVersionId}
                        mappedCount={this._mappingCache?.mappedCount ?? null}
                        isFake={this._mappingCache?.isFake}
                        mappingUrl={this.state.latestStreamConfig?.model?.mapping_url ?? null}
                        onSelectGuid={(g) => this.setState({ govSelectedGuid: g })}
                        onReconnect={() => this._reconnectStream()}
                        reservedRight={0}
                        reservedLeft={showUsdStageDock ? sidebarWidth : 0}
                        sessionId={this.state.reviewSessionId}
                        triReady={triReady}
                    />
                )}

                {/* Task3：DataChannel 送出證據（demo-outgoing-log），供 E2E 驗證「UI-local 選取（如對構表選列）
                    不觸發 runtime mutator」。不依賴 ?debug=1 的 DemoControlPanel（該區塊預設隱藏）；本列複用同一份
                    已追蹤的 demoOutgoingMessages 真實狀態（_sendStreamMessage 每次真送出才 append），非另造假資料。 */}
                {this.state.viewerTab === "model"
                    && (harnessEnabled() || Boolean(this.state.reviewSessionId))
                    && (
                    <p className="ec-note" data-testid="demo-outgoing-log">
                        {this.state.demoOutgoingMessages.length > 0
                            ? this.state.demoOutgoingMessages.map((m) => m.label).join(", ")
                            : "（尚無 DataChannel 送出紀錄）"}
                    </p>
                )}

                {(harnessEnabled() || Boolean(this.state.reviewSessionId))
                    && this.state.runtimeCommandLifecycles.length > 0
                    && (
                    <ol
                        className="ec-note"
                        data-testid="runtime-command-lifecycle"
                        aria-label="runtime command lifecycle"
                        aria-live="polite"
                    >
                        {this.state.runtimeCommandLifecycles.map((entry) => (
                            <li
                                key={entry.request_id}
                                data-testid="runtime-command-lifecycle-entry"
                                data-request-id={entry.request_id}
                            >
                                {entry.event_type}: {entry.phases.join(" → ")}
                                {entry.outcome ? ` (${entry.outcome})` : ""}
                            </li>
                        ))}
                    </ol>
                )}

                {/* 統一治理控制台 MVP：A1–A10 治理面板只在「問題 · 治理」分頁渲染，
                    避免模型分頁被治理/成果檔 UI 壓住；不改 AppStream / backend / DataChannel command path。
                    W5：coverage 來源改為
                    streamConfig.quality_metrics_summary.coverage_ratio（型別文件規定 viewer MUST NOT compute，
                    原樣呈現）；缺值時 ratio=null → gate 判 degraded（顯「coverage 未知」降級橫幅），不捏造 coverage%。 */}
                {(this.state.viewerTab === "issues" && Boolean(this.state.reviewSessionId)) && (() => {
                    // T6：把 review session lifecycle 是否 active 納入 overlay 可操作性。active 狀態僅 active/created；
                    // queued/blocked/failed/closing/closed/dropped 一律視為非 active（治理動作唯讀，誠實表態）。
                    const lifecycle = this.state.reviewLifecycleStatus;
                    const lifecycleActive = lifecycle === "active" || lifecycle === "created";
                    // CH-F：harness 模式下假串流已連（onStart 已觸發 streamReady），對 overlay 視為 dataChannel-ready，
                    // 讓 primary 可操作（binding/highlight/rule-check）；spectator 仍由 isSpectatorStreamMode() 擋下。
                    // 問題分頁（有 session）：治理面板可操作（rule-run 經 for-session、issue/BCF 經 proxy，皆不需 live 3D）；
                    // 需 DataChannel 的 3D 高亮/binding 仍由各自 send-level dataChannelReady 守門誠實降級，不假裝成功。
                    const issuesTabReady = this.state.viewerTab === "issues" && Boolean(this.state.reviewSessionId);
                    const inputs = deriveOverlayInputs({ spectator: isSpectatorStreamMode(), streamReady: harnessEnabled() || liveFrameObserved || issuesTabReady, lifecycleActive });
                    const ratio = this.state.latestStreamConfig?.quality_metrics_summary?.coverage_ratio ?? null;
                    // R6（誠實）：_mappingCache 為 null（尚未載入 / 未知）視為 fake → degraded，
                    // 不在 client 無法標示時仍顯示有把握的 coverage%（保守誠實）。
                    const gate = evaluateCoverageGate({ coverageRatio: ratio, isFake: this._mappingCache?.isFake ?? true });
                    // R7：把 warnOnly 透傳給 overlay —— coverage ∈ [0.9,1.0) 時非 degraded 但低於鎖定 1.0，
                    // overlay 顯示 measure-first 警示（非 fallback 降級），讓操作員看見「未達 100%」。
                    const coverage = { coverageOk: gate.coverageOk, degraded: gate.degraded, ratio, warnOnly: gate.warnOnly };
                    const bcfUrl = this.state.currentModelVersionId
                        ? governanceClient.bcfExportUrl({ model_version_id: this.state.currentModelVersionId })
                        : undefined;
                    // CH-F：ready USDC artifacts（coordinator artifact_bindings 過濾 ready + derived + 有 url）供 BindingComposer。
                    const bindingArtifacts = (this.state.latestStreamConfig?.artifact_bindings ?? []).filter(
                        (b) => b.ready_status === "ready" && b.artifact_role === "derived" && Boolean(b.url),
                    );
                    return (
                        <>
                        {/* S3：嵌入 console iframe 時，本 3D 視窗僅作高亮引擎；失敗清單由 parent 工作台顯示（唯一權威清單），
                            避免「console 25 筆 / iframe 另列一份」雙清單矛盾。誠實標註空清單非「真的無失敗」。 */}
                        {window.parent !== window && (
                          <p className="ec-note" data-testid="viewer-embedded-list-collapsed">失敗清單由治理工作台（parent）顯示，此 3D 視窗僅作高亮引擎。</p>
                        )}
                        <GovernanceOverlay
                            variant={this.state.viewerTab === "issues" ? "panel" : "overlay"}
                            panelState={inputs.panelState}
                            coverage={coverage}
                            failedElements={failedElementsForEmbed(this.state.govFailedElements ?? [], window.parent !== window)}
                            onHighlight={(f) => this._overlayHighlight(f)}
                            onClearHighlight={() => {
                                if (!inputs.panelState.canOperate) return;
                                this._sendStreamMessage(buildClearHighlightRequest());
                                // T1：清除 3D 標示時一併清掉每列確認狀態（govHighlightConfirm）與 pending highlight 對映，
                                // 否則操作員仍看到殘留「已在 3D 標示 / 已送出…」誤導（overlay 端另清本地 lastResult）。
                                this._pendingGovHighlights = {};
                                this.setState({ govHighlightConfirm: {} });
                            }}
                            onRunRuleCheck={() => { void this._runGovernanceRuleCheck(); }}
                            ruleCheck={this.state.govRuleCheck}
                            highlightConfirm={this.state.govHighlightConfirm}
                            onCreateIssues={() => { void this._createGovIssues(); }}
                            issueCreate={this.state.govIssueCreate}
                            bcfUrl={bcfUrl}
                            selectedGuid={this.state.govSelectedGuid ?? null}
                            bindingArtifacts={bindingArtifacts}
                            bindingActiveRevision={this.state.govBindingActiveRevision ?? null}
                            bindingLastGoodRevision={this.state.govBindingLastGoodRevision ?? null}
                            bindingApplyState={this.state.govBindingApplyState}
                            onApplyBinding={(selection, revisionId) => this._applyBinding(selection, revisionId)}
                        />
                        </>
                    );
                })()}
                <StructuredLogDiagnostics
                    search={window.location.search}
                    logger={window.__structLog?.logger ?? null}
                    reviewSessionId={this.state.reviewSessionId}
                    conversionJobId={this.state.latestStreamConfig?.model.conversion_job_id ?? null}
                    kitInstanceId={this.state.activeStreamEndpoint.kitInstanceId || null}
                    ensureViewerLogAuthority={() => this._ensureViewerLogDeliveryAuthority()}
                    closeReviewSession={(sessionId) => this.coordinatorClient.closeReviewSession(sessionId)}
                />
            </div>
            );
        }
    }
