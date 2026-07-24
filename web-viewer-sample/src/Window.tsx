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
import { isBlockedLifecycle, lifecycleStatusText, sameStreamEndpoint, sameStreamTransportEndpoint, selectSpectatorBinding, type StreamEndpoint } from "./utils/windowHelpers";
// viewer-edge-bim-server-console:ReviewLauncher / PresencePanel 已刪(fast
// MVP 不需多人協作 UI;spec REMOVED「Viewer separates runtime commands from
// collaboration events」)。
import { BimControlClient } from "./clients/bimControlClient";
import { CoordinatorClient, CoordinatorHttpError, isQueuedForInstanceError } from "./clients/coordinatorClient";
import { connectReviewSocket, type ReviewSocketClient } from "./clients/reviewSocket";
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
import { HARNESS_STAGE_URL } from "./harness/fixtures/usdStageTree";
import { computeFileReady, computeRuntimeReady, computeSemanticReady } from "./utils/triReady";
import type { DemoLogEntry } from "./types/demo";
import { mappingVerificationBlockReason, type ElementMappingDocument, type ElementMappingItem, type ElementMappingSummary } from "./types/mapping";
import type { ArtifactBinding, ReviewArtifact } from "./types/artifacts";
import type { ReviewLifecycleStatus, ReviewSession, ReviewSessionRequest, ReviewStreamConfig } from "./types/review";
import type { HighlightItem, StreamMessage } from "./types/streamMessages";
// 統一治理控制台 MVP：A1–A10 治理 overlay 疊在 primary viewer live 3D 上（client 主動拉，不 server-push）。
import { GovernanceOverlay, type RuleCheckState, type IssueCreateState, type StageArtifactBinding, type BindingApplyState } from "./console/GovernanceOverlay";
import { deriveOverlayInputs } from "./console/governance/windowOverlayGlue";
import { HighlightBridge, type FailedElement, type HighlightManyResult, type HighlightResult } from "./console/governance/highlightBridge";
import { MappingCache } from "./console/governance/mappingCache";
import { MockViewport } from "./console/viewer/MockViewport";
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
type RuntimeCommandOutcome = "success" | "rejected" | "error" | "timed-out";

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
}

interface RuntimeCommandCorrelation {
    requestId: string;
    context?: RuntimeCommandContext;
    disposition: "matched" | "untracked" | "uncorrelated" | "duplicate" | "mismatch";
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

function createRuntimeRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `cmd_${uuid}`;
    runtimeRequestSequence += 1;
    return `cmd_${Date.now().toString(36)}_${runtimeRequestSequence.toString(36)}`;
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

function appStreamResultToAppEvent(requestEventType: string, result: unknown): AppStreamEventType | null {
    if (!isRecord(result)) return null;
    const status = getPayloadString(result, "status");
    const info = getPayloadString(result, "info");
    const responseResult = status === "error" ? "error" : "success";

    if (requestEventType === "openStageRequest") {
        return {
            event_type: "openedStageResult",
            payload: {
                result: responseResult,
                url: getPayloadString(result, "url"),
                error: responseResult === "error" ? info || "openStageRequest failed" : "",
                ...(getPayloadString(result, "request_id")
                    ? { request_id: getPayloadString(result, "request_id") }
                    : {}),
                ...(getPayloadString(result, "binding_revision_id")
                    ? { binding_revision_id: getPayloadString(result, "binding_revision_id") }
                    : {}),
            },
        };
    }

    if (requestEventType === "loadingStateQuery") {
        return {
            event_type: "loadingStateResponse",
            payload: {
                loading_state: getPayloadString(result, "loadingState"),
                url: getPayloadString(result, "url"),
            },
        };
    }

    if (requestEventType === "getChildrenRequest") {
        return {
            event_type: "getChildrenResponse",
            payload: {
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

export default class App extends React.Component<AppProps, AppState> {
    
    private usdStageRef = React.createRef<USDStage>();
    private coordinatorClient = new CoordinatorClient(reviewEnv.coordinatorApiBase);
    private bimControlClient = new BimControlClient(reviewEnv.bimControlApiBase);
    private reviewSocket: ReviewSocketClient | null = null;
    private streamStartTimeoutId: number | null = null;
    private loadingStateRetryId: number | null = null;
    private stageLoadTimeoutId: number | null = null;
    private deferredOpenStageId: number | null = null;
    private _pollForKitReadyId: number | null = null;
    private loadingStatePollCount = 0;
    private pendingStageUrl: string | null = null;
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
        }
    }

    private _notifyParentViewerReady = (): void => {
        if (window.parent !== window) this._postToParent({ type: "viewer_ready" });
    };

    componentDidMount(): void {
        this.componentMounted = true;
        // VG-01：嵌入 console iframe 時掛上 parent postMessage 橋（unmount 對稱移除），並通知 parent listener 已就緒。
        // 嚴格 additive：非嵌入（window.parent === window）時 listener 永遠 reject、不送任何訊息，既有單機/直連行為零變更。
        window.addEventListener("message", this._onParentMessage);
        window.addEventListener("load", this._notifyParentViewerReady);
        this._notifyParentViewerReady();

        if (reviewEnv.hasExplicitEmptySessionId) {
            void this._bootstrapReview();
            return;
        }

        void this._loadUSDAssets();
        void this._bootstrapReview();
    }

    componentWillUnmount(): void {
        this.componentMounted = false;
        window.removeEventListener("load", this._notifyParentViewerReady);
        this._releaseStandaloneViewerLease();
        this._clearStreamStartTimeout();
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this._clearDeferredOpenStage();
        this._clearPollForKitReady();
        this._clearA4HandoffReadinessTimer();
        this._clearA4HandoffCommandTimeout();
        this.a4HandoffUserCarrier = null;
        this.a4HandoffLeaseToken = null;
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
            return { requestId, context, disposition: "mismatch" };
        }
        return { requestId, context, disposition: "matched" };
    }

    private _claimRuntimeCommandTerminal(
        requestId: string,
        eventType: string,
        outcome: RuntimeCommandOutcome,
    ): boolean {
        if (!requestId || this.runtimeCommandTerminalClaims.has(requestId)) return false;
        this.runtimeCommandTerminalClaims.set(requestId, { eventType, outcome });
        while (this.runtimeCommandTerminalClaims.size > 128) {
            const oldest = this.runtimeCommandTerminalClaims.keys().next().value as string | undefined;
            if (!oldest) break;
            this.runtimeCommandTerminalClaims.delete(oldest);
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
                ...(this.state.reviewSessionId ? { session_id: this.state.reviewSessionId } : {}),
            },
        };
    }

    private _sendStreamMessage(message: AppStreamMessageType | StreamMessage): boolean {
        const blockReason = this._runtimeMutatorBlockReason(message.event_type);
        if (blockReason) {
            this._appendReviewEvent(`略過 ${message.event_type}：${blockReason}`);
            return false;
        }
        const outgoing = this._withRuntimeAuthority(message);
        let runtimeRequestId = "";
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
                });
                while (this.runtimeCommandContexts.size > 128) {
                    const oldest = this.runtimeCommandContexts.keys().next().value as string | undefined;
                    if (!oldest) break;
                    this.runtimeCommandContexts.delete(oldest);
                }
                this._recordRuntimeCommandPhase(requestId, outgoing.event_type, "pending");
            }
            this.setState({ runtimeCommandRejection: null });
        }
        void AppStream.sendMessage(outgoing)
            .then((result) => {
                const responseEvent = appStreamResultToAppEvent(outgoing.event_type, result);
                if (responseEvent) {
                    this._handleCustomEvent(responseEvent);
                }
            })
            .catch(() => {
                const diagnostic = "stream_transport_error";
                if (runtimeRequestId) {
                    if (!this._claimRuntimeCommandTerminal(runtimeRequestId, outgoing.event_type, "error")) return;
                    this._finishA4HandoffCommand(runtimeRequestId, "rejected", diagnostic, true);
                }
                this._appendReviewEvent(`${outgoing.event_type} failed: ${diagnostic}`);
                if (outgoing.event_type === "openStageRequest") {
                    this._failStageLoad("模型載入失敗", [`目標：${this.pendingStageUrl || "unknown"}`, `錯誤：${diagnostic}`].join("\n"));
                }
            });
        this._appendDemoOutgoing(outgoing.event_type, { ...outgoing, payload: redactStreamPayload(outgoing.payload) });
        return true;
    }

    private _scheduleStreamStartTimeout(): void {
        this._clearStreamStartTimeout();
        if (StreamConfig.source === "gfn") return;
        this.streamStartTimeoutId = window.setTimeout(() => {
            this._handleStreamStartTimeout();
        }, reviewEnv.streamStartTimeoutMs);
    }

    private _clearStreamStartTimeout(): void {
        if (this.streamStartTimeoutId === null) return;
        window.clearTimeout(this.streamStartTimeoutId);
        this.streamStartTimeoutId = null;
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

    private _scheduleStageLoadTimeout(): void {
        this._clearStageLoadTimeout();
        const timeoutMs = Math.max(reviewEnv.streamStartTimeoutMs, 45000);
        this.stageLoadTimeoutId = window.setTimeout(() => {
            this.stageLoadTimeoutId = null;
            if (!this.pendingStageUrl) return;
            if (this._completeStageLoadFromVisibleStream()) return;
            this._failStageLoad(
                "模型載入逾時",
                [
                    `目標：${this.pendingStageUrl}`,
                    `診斷：${this._getVideoDiagnosticText()}`,
                    "Kit 已連線但沒有回報模型載入完成，請檢查該 USDC 是否可由 Kit 開啟。",
                ].join("\n"),
            );
        }, timeoutMs);
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

    private _finishStageLoad(): void {
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this.pendingStageUrl = null;
        this.loadingStatePollCount = 0;
        // Important #2：stage 重載清理點同時歸零 first_frame 閂。否則同一 session 內換載另一個
        // stage（多模型切換）時第二次完成後 parent 收不到 first_frame / stage_loaded，
        // IX-A1-06 無法重滿足、「在 3D 高亮」鈕保持 disabled。重置後由 _completeStageLoad 的
        // 閂保證「每次真完成」各送一次（_failStageLoad 失敗路徑不送，誠實鐵律不變）。
        this._firstFramePosted = false;
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
                    `expected：${this.state.expectedStageUrl || this.pendingStageUrl || "unknown"}`,
                    `loaded：${loadedUrl}`,
                    `state：${loadingState || "unknown"}`,
                ].join("\n"),
            );
        }
        return matched;
    }

    private _completeStageLoad(loadedUrl?: string, bindingRevisionId?: string): void {
        // ⚠️ 誠實鐵律：finalLoadedUrl 只取「Kit 真回報過的 loaded URL」（呼叫參數或既有 state.loadedStageUrl），
        // 不得 fallback 成 pendingStageUrl。pendingStageUrl 只是「我們請求載入的目標」，不是 Kit 證實已載入的事實。
        // 當 _completeStageLoadFromVisibleStream 因「畫面可見但 Kit 尚未回 loaded URL」觸發時 loadedUrl 為空，
        // 此時 finalLoadedUrl 留空 → matched=!hasExpectedStage（有 expected 即 unproven），first_frame 帶 stageUrl:null，
        // A1 gate 的 stage matched 維持 false、3D 高亮鈕保持 disabled，直到 Kit 真回報相符 URL（防舊模型殘影誤判為已對齊）。
        const finalLoadedUrl = loadedUrl || this.state.loadedStageUrl;
        const hasExpectedStage = Boolean(this.state.expectedStageUrl);
        const matched = finalLoadedUrl ? this._isLoadedStageExpected(finalLoadedUrl) : !hasExpectedStage;
        const activeRevision = bindingRevisionId || this.confirmedStageBindingRevision;
        const stageProven = harnessEnabled() || Boolean(activeRevision);
        const active = matched && stageProven;
        this._finishStageLoad();
        this._getChildren();
        this.setState({
            showStream: true,
            loadingText: active ? "模型已載入" : "模型畫面可見，stage authority 尚未證明",
            showUI: true,
            isLoading: false,
            streamDiagnostic: active ? null : `expected：${this.state.expectedStageUrl || "unknown"}\nloaded：${finalLoadedUrl || "not_observed"}`,
            loadedStageUrl: finalLoadedUrl || null,
            stageLoadStatus: active ? "matched" : "unproven",
        });
        // T3：stage 就緒後，非 debug 一般檢視也自動載入 element_mapping（否則 _mappingCache 恆 null，
        // overlay 標示永遠 unmapped）。僅在「有 mapping_url 且該 url 尚未載入」時觸發；無 mapping_url 不做事
        // （overlay 誠實顯示 unmapped / coverage 未知）。不改既有 stage-load 流程與 debug onLoadMapping 路徑。
        this._maybeAutoLoadMapping();
        // VG-01 M1：真畫面已到達且 stage 完成（此處為唯一真完成點，由 kit handler 1807/1826 與
        // _completeStageLoadFromVisibleStream（含 _hasRemoteVideoFrame guard）抵達）→ 通知 parent。
        // _firstFramePosted 閂保證只送一次；不接在 _failStageLoad（失敗）/ 斷線 / 開檔等路徑（防偽證據）。
        if (!this._firstFramePosted && window.parent !== window) {
            this._firstFramePosted = true;
            this._postToParent({ type: "first_frame", stageUrl: finalLoadedUrl ?? null });
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
        if (!this.pendingStageUrl || !this._hasRemoteVideoFrame()) return false;
        this._completeStageLoad();
        this.setState((state) => ({
            reviewEvents: [...state.reviewEvents, "模型已載入（WebRTC 畫面已可見）"],
        }));
        return true;
    }

    private _failStageLoad(loadingText: string, diagnostic?: string): void {
        this._finishStageLoad();
        this.setState((state) => ({
            loadingText,
            streamDiagnostic: diagnostic || null,
            showStream: this._hasRemoteVideoFrame(),
            isLoading: false,
            stageLoadStatus: loadingText === "stale_stage_or_mismatch" ? "mismatch" : state.stageLoadStatus,
            reviewEvents: [...state.reviewEvents, loadingText],
        }));
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
        const video = document.getElementById("remote-video") as HTMLVideoElement | null;
        if (!video) return false;
        return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
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
        const m = e.data as { type?: string; items?: unknown; ifc_guid?: string; token?: unknown; user_token?: unknown };
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
        const delayMs = Math.max(1_000, lease.heartbeat_after_ms);
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
                    artifacts: artifacts.map((artifact) => ({
                        artifact_id: artifact.artifact_id,
                        role: artifact.role,
                        load_order: artifact.load_order,
                    })),
                }),
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
            `WebRTC 串流未建立（${seconds} 秒內沒有收到影片）。`,
            `診斷：${this._getVideoDiagnosticText()}`,
            `端點：${endpoint}`,
            "請將此視為 demo blocker：Kit signaling 可能已連上，但 browser 尚未取得 media stream。",
        ].join("\n");

        this.setState((state) => ({
            loadingText: "WebRTC 串流未建立",
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

    private _connectReviewSocket(sessionId: string): void {
        if (isBlockedLifecycle(this.state.reviewLifecycleStatus)) {
            this._appendReviewEvent(`略過 Socket.IO join：session lifecycle=${this.state.reviewLifecycleStatus}`);
            return;
        }
        this.reviewSocket?.disconnect();
        this.reviewSocket = connectReviewSocket(reviewEnv.coordinatorSocketUrl, {
            onStatus: (status) => this._appendReviewEvent(`Socket.IO ${status === "connected" ? "已連線" : "已中斷"}`),
            onEvent: (event, payload) => {
                this._appendReviewEvent(`收到 Socket.IO 事件：${event}`);
                this._appendDemoIncoming(`socket:${event}`, payload);
            },
        });
        this.reviewSocket.join(sessionId, reviewEnv.defaultUserId, reviewEnv.defaultDisplayName);
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

        const applyThroughCoordinator = async () => {
            const transaction = await this._preauthorizeStageBinding(
                selection.map((artifact) => ({
                    artifact_id: artifact.artifact_id,
                    role: artifact.role,
                    load_order: artifact.load_order,
                })),
            );
            this._appendReviewEvent(`coordinator 已建立 pending binding：${transaction.binding_revision_id}`);
            this._sendStreamMessage({
                event_type: "loadArtifactGroupRequest",
                payload: {
                    url: transaction.stage_composition.primary.usdc_url,
                    requested_stage_url: transaction.stage_composition.primary.usdc_url,
                    stage_binding_authorization_id: transaction.stage_binding_authorization_id,
                    binding_revision_id: transaction.binding_revision_id,
                    stage_composition: transaction.stage_composition,
                },
            });
        };
        void applyThroughCoordinator().catch(() => {
            this.setState({
                govBindingApplyState: {
                    status: "failed",
                    reason: "coordinator stage binding preauthorization 失敗",
                },
            });
        });
    }

    private _bootstrapHarnessSession(): void {
        const stageUrl = HARNESS_STAGE_URL;
        const harnessAsset: USDAssetType = { name: "Sample Building (harness)", url: stageUrl };
        // CH-F：harness 提供多個 ready derived USDC artifact，供 BindingComposer 選 1..N / 指定 primary / 調 load_order。
        const harnessBindings: ArtifactBinding[] = [
            { binding_id: "b_h_building", artifact_group_id: "ag_harness", model_version_id: "version_harness_demo", artifact_id: "artifact_h_building", display_name: "Building Shell", source_ifc_filename: "sample-building.ifc", artifact_role: "derived", url: stageUrl, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready" },
            { binding_id: "b_h_levels", artifact_group_id: "ag_harness", model_version_id: "version_harness_demo", artifact_id: "artifact_h_levels", display_name: "Levels Overlay", source_ifc_filename: "sample-building.ifc", artifact_role: "derived", url: "harness://stage/World/levels.usdc", mapping_url: null, load_order: 1, routing_policy: "same_instance", ready_status: "ready" },
            { binding_id: "b_h_mep", artifact_group_id: "ag_harness", model_version_id: "version_harness_demo", artifact_id: "artifact_h_mep", display_name: "MEP Overlay", source_ifc_filename: "sample-building.ifc", artifact_role: "derived", url: "harness://stage/World/mep.usdc", mapping_url: null, load_order: 2, routing_policy: "same_instance", ready_status: "ready" },
        ];
        const streamConfig: ReviewStreamConfig = {
            session_id: "review_session_harness0001",
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
            usdAssets: [harnessAsset],
            selectedUSDAsset: harnessAsset,
            expectedStageUrl: stageUrl,
            loadedStageUrl: null,
            stageLoadStatus: "pending",
            showUI: true,
            reviewEvents: [...this.state.reviewEvents, "harness session 已注入（deterministic）"],
        });
    }

    private async _bootstrapReview(): Promise<void> {
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

            const loadedSession: ReviewSession | null = reviewEnv.defaultSessionId
                ? await this.coordinatorClient.getReviewSession(reviewEnv.defaultSessionId)
                : null;
            let createdSession: ReviewSession | null = null;
            if (!reviewEnv.defaultSessionId && !reviewRequest?.session_id) {
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

            this._connectReviewSocket(sessionId);
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
                activeStreamEndpoint,
                streamMountKey: streamEndpointChanged ? this.state.streamMountKey + 1 : this.state.streamMountKey,
                reviewEvents: [
                    ...this.state.reviewEvents,
                    reviewEnv.defaultSessionId || reviewRequest?.session_id ? "已載入 review session" : "已建立 review session",
                    endpointEvent,
                ],
            }, () => {
                this._scheduleStreamStartTimeout();
                if (this.state.isKitReady && this.state.selectedUSDAsset && streamConfig.model.status === "ready" && !isBlockedLifecycle(streamConfig.lifecycle_status)) {
                    this._openSelectedAsset();
                }
                void this._beginA4Handoff(sessionId);
            });
        }
        catch (error) {
            console.warn("Review bootstrap unavailable.", error);
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
    private _queryLoadingState(): void {
        const message: AppStreamMessageType = {
            ...buildLoadingStateQuery()
        };
        this._sendStreamMessage(message);
    }

    /**
     * @function _onStreamStarted
     *
     * Sends a request to open an asset. If the stream is from GDN it is assumed that the
     * application will automatically load an asset on startup so a request to open a stage
     * is not sent. Instead, we wait for the streamed application to send a
     * openedStageResult message.
     */
        private _onStreamStarted(): void {
            this.setState({ streamDiagnostic: null, webrtcLifecycleStatus: "started" });
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
                if (this._canOpenSelectedAsset()) {
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
    private _onLoggedIn(userId: string): void {
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
    private _handleStreamStopped(kind: "stopped" | "terminated", message: unknown): void {
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this._clearDeferredOpenStage();
        const endpoint = streamEndpointLabel(this.state.activeStreamEndpoint);
        const diagnostic = [
            `webrtc_disconnected=${kind}`,
            `端點：${endpoint}`,
            `診斷：${this._getVideoDiagnosticText()}`,
            `event：${JSON.stringify(message)}`,
            "請按「重新連線」重建 viewer 端 AppStreamer；若仍停在 busy/disconnected，需重啟 Kit/WebRTC runtime。",
        ].join("\n");
        this.setState((state) => ({
            loadingText: "webrtc_disconnected",
            streamDiagnostic: diagnostic,
            showStream: this._hasRemoteVideoFrame(),
            isLoading: false,
            stageLoadStatus: "disconnected",
            webrtcLifecycleStatus: kind,
            reviewEvents: [...state.reviewEvents, `WebRTC ${kind}`].slice(-80),
        }));
    }

    private _reconnectStream(): void {
        AppStream.stop();
        this.pendingStageUrl = null;
        this.loadingStatePollCount = 0;
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this._clearDeferredOpenStage();
        this.setState((state) => ({
            isKitReady: false,
            showStream: false,
            isLoading: true,
            loadingText: "正在重新連線 WebRTC...",
            streamDiagnostic: null,
            loadedStageUrl: null,
            stageLoadStatus: state.expectedStageUrl ? "pending" : "unproven",
            webrtcLifecycleStatus: "initializing",
            streamMountKey: state.streamMountKey + 1,
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
        const targetAsset = this._expectedStageAsset() || this.state.selectedUSDAsset;
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

        this.pendingStageUrl = targetAsset.url;
        this.confirmedStageBindingRevision = null;
        this.unprovenStageUrl = null;
        this.loadingStatePollCount = 0;
        this._clearLoadingStateRetry();
        this._scheduleStageLoadTimeout();
        this.setState({
            loadingText: "正在載入模型...",
            showStream: this._hasRemoteVideoFrame(),
            streamDiagnostic: null,
            selectedUSDAsset: targetAsset,
            expectedStageUrl: this.state.expectedStageUrl || targetAsset.url,
            loadedStageUrl: null,
            stageLoadStatus: "pending",
            isLoading: true
        })
        this.setState({ usdPrims: [], selectedUSDPrims: new Set<USDPrimType>() });
        this.usdStageRef.current?.resetExpandedIds();
        console.log(`Sending request to open asset: ${targetAsset.url}.`);
        const artifactBindings = this.state.latestStreamConfig?.artifact_bindings?.filter((binding) => binding.url === targetAsset.url) || [];
        const composition = this.state.latestStreamConfig?.stage_composition;
        const selectedIsPrimary = composition?.primary?.url === targetAsset.url;
        const openStage = async () => {
            if (harnessEnabled()) {
                this._sendStreamMessage(
                    buildOpenStageRequest(
                        targetAsset.url,
                        artifactBindings,
                        selectedIsPrimary ? { primary: composition.primary, secondary_layers: composition.secondary_layers || [] } : null,
                    ),
                );
                this._scheduleLoadingStateQuery(1500);
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
            const transaction = await this._preauthorizeStageBinding(selectedBindings);
            this.pendingStageUrl = transaction.stage_composition.primary.usdc_url;
            this._sendStreamMessage(buildAuthorizedOpenStageRequest(transaction));
            this._scheduleLoadingStateQuery(1500);
        };
        void openStage().catch(() => {
            this._failStageLoad(
                "模型載入失敗",
                "無法建立 stage binding authorization，已阻擋 openStageRequest",
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
        if (!this.state.reviewSessionId) {
            this._appendReviewEvent("略過 Socket.IO 連線：尚未建立 review session");
            return;
        }
        this._connectReviewSocket(this.state.reviewSessionId);
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
            if (activeRevision !== revision) return false;
            if (
                this.stageProofBlockGeneration !== generation
                || this.stageProofBlockedRevision !== revision
                || this.unprovenStageUrl !== loadedUrl
            ) return false;

            const matched = Boolean(loadedUrl && this._isLoadedStageExpected(loadedUrl));
            this.stageProofBlockGeneration += 1;
            this.stageProofBlockedRevision = null;
            this.confirmedStageBindingRevision = revision;
            this.unprovenStageUrl = null;
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
    private _handleCustomEvent (event: AppStreamEventType | null): void {
        if (!event) {
            return;
        }
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
        const payload = isRecord(event.payload) ? event.payload : {};

        if (event.event_type === "commandRejected") {
            const parsed = parseRuntimeCommandRejection(payload);
            if (!parsed) {
                this._appendReviewEvent("忽略 malformed commandRejected");
                return;
            }
            const context = parsed.request_id
                ? this.runtimeCommandContexts.get(parsed.request_id)
                : undefined;
            if (parsed.request_id && this.runtimeCommandTerminalClaims.has(parsed.request_id)) {
                this._appendReviewEvent("忽略 duplicate commandRejected terminal");
                return;
            }
            if (context && context.eventType !== parsed.rejected_event_type) {
                this._appendReviewEvent("忽略 commandRejected：rejected event 與 request context 不相符");
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
                const revision = context?.bindingRevisionId || "unknown";
                const unprovenUrl = context?.stageUrl || this.state.loadedStageUrl || this.pendingStageUrl;
                this.stageProofBlockGeneration += 1;
                this.stageProofBlockedRevision = revision;
                this.confirmedStageBindingRevision = null;
                this.unprovenStageUrl = unprovenUrl;
                this._finishStageLoad();
                this.setState((state) => ({
                    runtimeCommandRejection: rejection,
                    loadedStageUrl: null,
                    stageLoadStatus: "unproven",
                    govBindingApplyState: {
                        status: "failed",
                        reason: "runtime changed but coordinator confirmation is unproven",
                    },
                    reviewEvents: [...state.reviewEvents, "runtime changed_unconfirmed；已阻擋 retry/handoff"].slice(-80),
                }));
                if (window.parent !== window) {
                    this._postToParent({
                        type: "stage_loaded",
                        stageUrl: null,
                        status: "unproven",
                        ...(context?.bindingRevisionId
                            ? { binding_revision_id: context.bindingRevisionId }
                            : {}),
                    });
                }
                if (context?.bindingRevisionId) void this._resyncStageBindingProof();
                return;
            }

            this.setState((state) => ({
                runtimeCommandRejection: rejection,
                reviewEvents: [
                    ...state.reviewEvents,
                    `${rejection.rejected_event_type} rejected：${rejection.reason}`,
                ].slice(-80),
            }));
            if (
                rejection.rejected_event_type === "openStageRequest"
                || rejection.rejected_event_type === "loadArtifactGroupRequest"
            ) {
                this._failStageLoad("模型載入遭拒", rejection.detail_code || rejection.reason);
            }
            return;
        }

        this._appendDemoIncoming(event.event_type || event.messageRecipient || "streamEvent", event);

        // response received once a USD asset is fully loaded
        if (event.event_type === "openedStageResult") {
            const correlation = this._completeRuntimeCommandEvent(
                "openedStageResult",
                payload,
                payload.result === "success" ? "success" : "error",
            );
            if (correlation.disposition !== "matched") return;
            if (payload.result === "success") {
                const loadedUrl = getPayloadString(payload, "url");
                const bindingRevisionId = getPayloadString(payload, "binding_revision_id");
                if (this.stageProofBlockedRevision) {
                    if (
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
                        this.setState({
                            govBindingActiveRevision: bindingRevisionId,
                            govBindingLastGoodRevision: bindingRevisionId,
                            govBindingApplyState: { status: "applied" },
                        });
                        this._appendReviewEvent(`binding 已套用（Kit openedStageResult 確認）：${bindingRevisionId}`);
                    }
                }
                if (loadedUrl && stageEvidenceMatched) {
                    this._completeStageLoad(loadedUrl, bindingRevisionId || undefined);
                } else {
                    this._scheduleLoadingStateQuery(250);
                }
            }
            else {
                const url = getPayloadString(payload, "url");
                const error = getPayloadString(payload, "error") || "unknown error";
                const runtimeState = getPayloadString(payload, "runtime_state");
                const bindingRevisionId = getPayloadString(payload, "binding_revision_id");
                const requestId = getPayloadString(payload, "request_id");
                if (requestId) this.runtimeCommandContexts.delete(requestId);
                console.error(`Kit App communicates there was an error loading: ${url} (${error})`);
                if (runtimeState === "changed_failed") {
                    this.stageProofBlockGeneration += 1;
                    this.stageProofBlockedRevision = null;
                    this.confirmedStageBindingRevision = null;
                    this.unprovenStageUrl = null;
                    this._finishStageLoad();
                    this.setState((state) => ({
                        loadingText: "模型組合僅部分套用",
                        streamDiagnostic: [`目標：${url || "unknown"}`, `錯誤：${error}`].join("\n"),
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
                    if (window.parent !== window) {
                        this._postToParent({
                            type: "stage_loaded",
                            stageUrl: null,
                            status: "unproven",
                            ...(bindingRevisionId ? { binding_revision_id: bindingRevisionId } : {}),
                        });
                    }
                    return;
                }
                this._failStageLoad(
                    "模型載入失敗",
                    [`目標：${url || this.pendingStageUrl || "unknown"}`, `錯誤：${error}`].join("\n"),
                );
            }
        }

        else if (event.event_type === "loadArtifactGroupResult") {
            const result = getPayloadString(payload, "result") || "unknown";
            const bindingRevisionId = getPayloadString(payload, "binding_revision_id");
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
            if (result === "error" && bindingRevisionId) {
                this.setState({
                    govBindingApplyState: {
                        status: "failed",
                        reason: getPayloadString(payload, "error") || "loadArtifactGroupResult error",
                    },
                });
            }
            this._appendReviewEvent(`artifact group load result：${result}`);
        }
        
        // response received from the 'loadingStateQuery' request
        else if (event.event_type == "loadingStateResponse") {
            // loadingStateRequest is used to poll Kit for proof of life.
            // For the first loadingStateResponse we set isKitReady to true
            // and run one more query to find out what the current loading state
            // is in Kit
            if (this.state.isKitReady === false) {
                console.info("Kit is ready to load assets")
                this.setState({ isKitReady: true }, () => {
                    if (this._canOpenSelectedAsset()) {
                        this._openSelectedAsset();
                    } else {
                        this._queryLoadingState();
                    }
                })
            }
            
            else {
                this._clearLoadingStateRetry();
                this.loadingStatePollCount += 1;
                const payloadUrl = getPayloadString(payload, "url");
                const loadingState = getPayloadString(payload, "loading_state");
                const usdAsset: USDAssetType = this._getAsset(payloadUrl)
                const isStageValid: boolean = !!(usdAsset.name && usdAsset.url)

                if (payloadUrl && loadingState === "idle" && !this._recordLoadedStageEvidence(payloadUrl, "loadingStateResponse", loadingState)) {
                    return;
                }

                if (loadingState === "busy") {
                    if (this.loadingStatePollCount <= 90) {
                        this.setState({ loadingText: "正在載入模型...", isLoading: true });
                        this._scheduleLoadingStateQuery(1000);
                    } else {
                        this._failStageLoad(
                            "模型載入逾時",
                            [`目標：${this.pendingStageUrl || this.state.selectedUSDAsset?.url || "unknown"}`, `最後狀態：${payloadUrl || "empty"} busy`].join("\n"),
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
                        this._failStageLoad("模型載入狀態未回傳 URL", `目標：${this.pendingStageUrl || this.state.selectedUSDAsset?.url || "unknown"}`);
                    }
                    return;
                }
                
                // if a stage has been fully loaded and isn't a part of this application, force-load the selected stage
                else if (!isStageValid && loadingState === "idle"){
                    console.log(`The loaded asset ${payloadUrl} is invalid.`)
                    this._failStageLoad(
                        "模型載入狀態不符合目前清單",
                        [`Kit 回報：${payloadUrl}`, `目前選擇：${this.state.selectedUSDAsset?.url || "none"}`].join("\n"),
                    )
                    return;
                }
                
                // show stream and populate children if the stage is valid and it's done loading
                if (isStageValid && loadingState === "idle")
                {
                    if (!harnessEnabled() && !this.confirmedStageBindingRevision) {
                        this.setState({
                            loadingText: "stage 已觀察，等待 coordinator confirmation",
                            stageLoadStatus: "unproven",
                        });
                        this._scheduleLoadingStateQuery(500);
                        return;
                    }
                    this._completeStageLoad(payloadUrl)
                }
            }
        }
        
        // Loading progress amount notification.
        else if (event.event_type === "updateProgressAmount") {
            console.log('Kit App communicates progress amount.');
        }
            
        // Loading activity notification.
        else if (event.event_type === "updateProgressActivity") {
            console.log('Kit App communicates progress activity.');
            const activityText = getPayloadString(payload, "text");
            if (this.pendingStageUrl && activityText === "None") {
                const loadedUrl = this.pendingStageUrl;
                if (!this._recordLoadedStageEvidence(loadedUrl, "updateProgressActivity", activityText)) {
                    return;
                }
                if (!harnessEnabled() && !this.confirmedStageBindingRevision) {
                    this.setState({
                        loadingText: "stage 已觀察，等待 coordinator confirmation",
                        stageLoadStatus: "unproven",
                    });
                    return;
                }
                this._completeStageLoad(loadedUrl);
                return;
            }
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
            if (usdPrim === null) {
                this.setState({ usdPrims: children });
            }
            else {
                usdPrim.children = children;
                this.setState({ usdPrims: this.state.usdPrims });
            }
            if (Array.isArray(children)){
                this._makePickable(children);
            }
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
        const shouldRenderAppStream = !reviewEnv.hasExplicitEmptySessionId && Boolean(this.state.reviewSessionId);
        const streamRole = isSpectatorStreamMode() ? "spectator" : "primary";
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
                {!this.state.showStream &&
                    <div className="loading-indicator-label">
                        {this.state.loadingText}
                        {this.state.streamDiagnostic &&
                            <pre className="stream-diagnostic-panel">{this.state.streamDiagnostic}</pre>
                        }
                        <div className="spinner-border" role="status" style={{ marginTop: 10, visibility: this.state.isLoading? 'visible': 'hidden' }} />
                    </div>
                }

                {/* Streamed app */}
                {shouldRenderAppStream &&
                <AppStream
                    key={this.state.streamMountKey}
                    sessionId={this.props.sessionId}
                    backendUrl={this.props.backendUrl}
                    signalingserver={this.state.activeStreamEndpoint.signalingserver}
                    signalingport={this.state.activeStreamEndpoint.signalingport}
                    mediaserver={this.state.activeStreamEndpoint.mediaserver}
                    mediaport={this.state.activeStreamEndpoint.mediaport}
                    accessToken={this.props.accessToken}
                    onStarted={() => this._onStreamStarted()}
                    onFocus={() => this._handleAppStreamFocus()}
                    onBlur={() => this._handleAppStreamBlur()}
                    style={{
                        position: 'relative',
                        visibility: this.state.showStream? 'visible' : 'hidden'
                    }}
                    onLoggedIn={(userId) => this._onLoggedIn(userId)}
                    handleCustomEvent={(event) => this._handleCustomEvent(event)}
                    onStreamFailed={this.props.onStreamFailed}
                    onStopped={(message) => this._handleStreamStopped("stopped", message)}
                    onTerminated={(message) => this._handleStreamStopped("terminated", message)}
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
                            onLoadingState={() => this._queryLoadingState()}
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
            </div>
            );
        }
    }
