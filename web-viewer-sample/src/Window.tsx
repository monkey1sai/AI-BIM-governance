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
import ArtifactPanel from "./components/ArtifactPanel";
import DemoControlPanel from "./components/DemoControlPanel";
import { computeFileReady, computeRuntimeReady, computeSemanticReady, triReadyLabel } from "./utils/triReady";
import { isBlockedLifecycle, lifecycleStatusText, sameStreamEndpoint, sameStreamTransportEndpoint, selectSpectatorBinding, type StreamEndpoint } from "./utils/windowHelpers";
// viewer-edge-bim-server-console:ReviewLauncher / PresencePanel 已刪(fast
// MVP 不需多人協作 UI;spec REMOVED「Viewer separates runtime commands from
// collaboration events」)。
import { BimControlClient } from "./clients/bimControlClient";
import { CoordinatorClient, isQueuedForInstanceError } from "./clients/coordinatorClient";
import { connectReviewSocket, type ReviewSocketClient } from "./clients/reviewSocket";
import { buildClearHighlightRequest, buildFocusPrimRequest, buildGetChildrenRequest, buildHighlightPrimsRequest, buildLoadingStateQuery, buildOpenStageRequest } from "./clients/streamMessages";
import { demoPrimPath } from "./clients/demoDefaults";
import { reviewEnv } from "./config/env";
import type { DemoLogEntry } from "./types/demo";
import { mappingVerificationBlockReason, type ElementMappingDocument, type ElementMappingItem, type ElementMappingSummary } from "./types/mapping";
import type { ArtifactBinding, ReviewArtifact } from "./types/artifacts";
import type { ReviewLifecycleStatus, ReviewSession, ReviewSessionRequest, ReviewStreamConfig } from "./types/review";
import type { HighlightItem, StreamMessage } from "./types/streamMessages";
// 統一治理控制台 MVP：A1–A10 治理 overlay 疊在 primary viewer live 3D 上（client 主動拉，不 server-push）。
import { GovernanceOverlay, type RuleCheckState, type IssueCreateState } from "./console/GovernanceOverlay";
import { deriveOverlayInputs } from "./console/governance/windowOverlayGlue";
import { HighlightBridge, type FailedElement, type HighlightResult } from "./console/governance/highlightBridge";
import { MappingCache } from "./console/governance/mappingCache";
import { evaluateCoverageGate } from "./console/governance/govEndpoints";
// 統一治理控制台 MVP（W1/W3）：A3 rule-run / A8 issue / BCF 都打 coordinator :8004 的 /api/governance/* proxy。
import { governanceClient, type RuleResultRow, type RuleRunStatus } from "./console/governanceClient";


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
    showUI: boolean;
    isLoading: boolean;
    loadingText: string; 
    streamDiagnostic: string | null;
    expectedStageUrl: string | null;
    loadedStageUrl: string | null;
    stageLoadStatus: "unproven" | "pending" | "matched" | "mismatch" | "disconnected";
    webrtcLifecycleStatus: "initializing" | "started" | "stopped" | "terminated" | "failed";
    activeStreamEndpoint: StreamEndpoint;
    streamMountKey: number;
}

interface AppStreamMessageType {
    event_type: string;
    payload: unknown;
}

interface AppStreamEventType {
    event_type?: string;
    messageRecipient?: string;
    data?: string;
    payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
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
    private pendingMappingHighlightRequestId: string | null = null;
    private pendingMappingFocusRequestId: string | null = null;
    private pendingMappingPrimPath: string | null = null;
    // 統一治理控制台 MVP：當前 model version 的 MappingCache（鎖單一版本，Task C3 餵入）；未載入前為 null。
    private _mappingCache: MappingCache | null = null;
    // W9：cache 建立時用的 mapping_url；換 url（即使同 model version）也需重建。
    private _mappingCacheUrl: string | null = null;
    // W2：治理標示送出後，等待 Kit highlightPrimsResult 非同步確認的 request（與既有 mapping-verify 的
    // pendingMappingHighlightRequestId 分開，互不干擾）。
    // F1：一併記 rowKey（rule_code::ifc_guid），確認回來時以 rowKey 寫 govHighlightConfirm，
    // 避免同一 ifc_guid 多筆不同 rule_code 的列共用 / 互相覆蓋確認狀態。
    private _pendingGovHighlights: Record<string, { ifc_guid: string; rowKey: string; primPath: string }> = {};
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
            showUI: false,
            loadingText: "正在載入成果檔清單...",
            streamDiagnostic: null,
            expectedStageUrl: null,
            loadedStageUrl: null,
            stageLoadStatus: "unproven",
            webrtcLifecycleStatus: "initializing",
            isLoading: true,
            activeStreamEndpoint,
            streamMountKey: 0,
        }
    }

    componentDidMount(): void {
        if (reviewEnv.hasExplicitEmptySessionId) {
            void this._bootstrapReview();
            return;
        }

        void this._loadUSDAssets();
        void this._bootstrapReview();
    }

    componentWillUnmount(): void {
        this._clearStreamStartTimeout();
        this._clearLoadingStateRetry();
        this._clearStageLoadTimeout();
        this._clearDeferredOpenStage();
        this._clearPollForKitReady();
        this.reviewSocket?.disconnect();
    }

    private _appendReviewEvent(event: string): void {
        this.setState((state) => ({
            reviewEvents: [...state.reviewEvents, event].slice(-80),
        }));
    }

    private _appendDemoOutgoing(label: string, payload: unknown): void {
        this.setState((state) => ({
            demoOutgoingMessages: [{ at: new Date().toISOString(), label, payload }, ...state.demoOutgoingMessages].slice(0, 20),
        }));
    }

    private _appendDemoIncoming(label: string, payload: unknown): void {
        this.setState((state) => ({
            demoIncomingMessages: [{ at: new Date().toISOString(), label, payload }, ...state.demoIncomingMessages].slice(0, 20),
        }));
    }

    private _sendStreamMessage(message: AppStreamMessageType | StreamMessage): void {
        const mutatingEvents = new Set([
            "openStageRequest",
            "loadArtifactGroupRequest",
            "highlightPrimsRequest",
            "focusPrimRequest",
            "clearHighlightRequest",
            "selectPrimsRequest",
            "makePrimsPickable",
            "resetStage",
        ]);
        if (mutatingEvents.has(message.event_type) && isBlockedLifecycle(this.state.reviewLifecycleStatus)) {
            const lifecycle = this.state.reviewLifecycleStatus || "unknown";
            this._appendReviewEvent(`略過 ${message.event_type}：session lifecycle=${lifecycle}`);
            return;
        }
        void AppStream.sendMessage(message)
            .then((result) => {
                const responseEvent = appStreamResultToAppEvent(message.event_type, result);
                if (responseEvent) {
                    this._handleCustomEvent(responseEvent);
                }
            })
            .catch((error: unknown) => {
                const diagnostic = error instanceof Error ? error.message : String(error);
                this._appendReviewEvent(`${message.event_type} failed: ${diagnostic}`);
                if (message.event_type === "openStageRequest") {
                    this._failStageLoad("模型載入失敗", [`目標：${this.pendingStageUrl || "unknown"}`, `錯誤：${diagnostic}`].join("\n"));
                }
            });
        this._appendDemoOutgoing(message.event_type, message);
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
        this.setState((state) => ({
            loadedStageUrl: loadedUrl,
            stageLoadStatus: matched ? "matched" : "mismatch",
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

    private _completeStageLoad(loadedUrl?: string): void {
        const finalLoadedUrl = loadedUrl || this.state.loadedStageUrl;
        const hasExpectedStage = Boolean(this.state.expectedStageUrl);
        const matched = finalLoadedUrl ? this._isLoadedStageExpected(finalLoadedUrl) : !hasExpectedStage;
        this._finishStageLoad();
        this._getChildren();
        this.setState({
            showStream: true,
            loadingText: matched ? "模型已載入" : "模型畫面可見，stage URL 尚未證明",
            showUI: true,
            isLoading: false,
            streamDiagnostic: matched ? null : `expected：${this.state.expectedStageUrl || "unknown"}\nloaded：${finalLoadedUrl || "not_observed"}`,
            loadedStageUrl: finalLoadedUrl || null,
            stageLoadStatus: matched ? "matched" : "unproven",
        });
        // T3：stage 就緒後，非 debug 一般檢視也自動載入 element_mapping（否則 _mappingCache 恆 null，
        // overlay 標示永遠 unmapped）。僅在「有 mapping_url 且該 url 尚未載入」時觸發；無 mapping_url 不做事
        // （overlay 誠實顯示 unmapped / coverage 未知）。不改既有 stage-load 流程與 debug onLoadMapping 路徑。
        this._maybeAutoLoadMapping();
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
    }

    private _canOpenSelectedAsset(): boolean {
        if (!this.state.selectedUSDAsset) return false;
        if (this.state.latestStreamConfig && this.state.latestStreamConfig.model.status !== "ready") return false;
        return !isBlockedLifecycle(this.state.reviewLifecycleStatus);
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

    private async _bootstrapReview(): Promise<void> {
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
                return;
            }

            if (!reviewEnv.autoCreateSession && !reviewEnv.defaultSessionId && !reviewEnv.defaultReviewRequestId) {
                this.setState({ reviewStatus: "Review session 自動建立已停用" });
                await this._loadReviewDataFromBimControl();
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
            });
        }
        catch (error) {
            console.warn("Review bootstrap unavailable.", error);
            this.setState({
                reviewStatus: "Review coordinator 無法連線",
                reviewEvents: [...this.state.reviewEvents, "review bootstrap 載入失敗"],
            });
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
        this._sendStreamMessage(
            buildOpenStageRequest(
                targetAsset.url,
                artifactBindings,
                selectedIsPrimary ? { primary: composition.primary, secondary_layers: composition.secondary_layers || [] } : null,
            ),
        );
        this._scheduleLoadingStateQuery(1500);
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
        const message: AppStreamMessageType = {
            event_type: "selectPrimsRequest",
            payload: {
                paths: paths
            }
        };
        this._sendStreamMessage(message);

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
        this._appendDemoIncoming(event.event_type || event.messageRecipient || "streamEvent", event);

        const payload = isRecord(event.payload) ? event.payload : {};

        // response received once a USD asset is fully loaded
        if (event.event_type === "openedStageResult") {
            if (payload.result === "success") {
                const loadedUrl = getPayloadString(payload, "url");
                if (loadedUrl && !this._recordLoadedStageEvidence(loadedUrl, "openedStageResult")) {
                    return;
                }
                this._scheduleLoadingStateQuery(250)
            }
            else {
                const url = getPayloadString(payload, "url");
                const error = getPayloadString(payload, "error") || "unknown error";
                console.error(`Kit App communicates there was an error loading: ${url} (${error})`);
                this._failStageLoad(
                    "模型載入失敗",
                    [`目標：${url || this.pendingStageUrl || "unknown"}`, `錯誤：${error}`].join("\n"),
                );
            }
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
        // other messages from app to kit
        else if (event.messageRecipient === "kit") {
            console.log("onCustomEvent");
            if (typeof event.data === "string") {
                try {
                    console.log(JSON.parse(event.data).event_type);
                } catch {
                    console.log(event.data);
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
        const showDemoPanel = isDebugQueryEnabled()
            && reviewEnv.showDemoPanel
            && !reviewEnv.hasExplicitEmptySessionId;
        const demoPanelRight = this.state.showUI ? sidebarWidth : 0;
        const streamReservedWidth = this.state.showUI
            ? sidebarWidth + (showDemoPanel ? demoPanelWidth : 0)
            : (showDemoPanel ? demoPanelWidth : 0);
        const shouldRenderAppStream = !reviewEnv.hasExplicitEmptySessionId && Boolean(this.state.reviewSessionId);
        return (
            <div
                style={{
                    position: 'absolute',
                    top: headerHeight,
                    width: '100%',
                    height: '100%'
                }}
            >
                <div style={{
                            position: 'absolute',
                            height: `calc(100% - ${headerHeight}px)`,
                            width: `calc(100% - ${streamReservedWidth}px)`
                }}>
                    
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

                <div className={`stage-truth-panel stage-truth-panel--${this.state.stageLoadStatus}`}>
                    {/* viewer-edge-bim-server-console:TopBar 顯示 project_id /
                        external_model_version_id / review_session_id;欄位缺失顯示
                        「未取得」placeholder,不偽宣告(spec scenario:TopBar surfaces
                        project / version / session identity)。 */}
                    <div className="stage-truth-panel__row" data-testid="edge-console-topbar">
                        <strong>Edge BIM Data Server</strong>
                        <span data-testid="topbar-project">project: {this.state.currentProjectId || "未取得"}</span>
                        <span data-testid="topbar-version">version: {this.state.currentModelVersionId || "未取得"}</span>
                        <span data-testid="topbar-session">session: {this.state.reviewSessionId || "未取得"}</span>
                    </div>
                    {/* viewer-edge-bim-server-console:三段 ready 取代單一 ready 字樣,
                        避免使用者誤把 stage matched 等同於 IFC 語意正確。 */}
                    <div className="stage-truth-panel__row" data-testid="tri-ready-badges">
                        <span data-testid="tri-ready-file">File: <strong>{triReadyLabel(computeFileReady(this.state.latestStreamConfig))}</strong></span>
                        <span data-testid="tri-ready-runtime">Runtime: <strong>{triReadyLabel(computeRuntimeReady(this.state.webrtcLifecycleStatus, this.state.stageLoadStatus))}</strong></span>
                        <span data-testid="tri-ready-semantic">Semantic: <strong>{triReadyLabel(computeSemanticReady(this.state.latestStreamConfig?.quality_metrics_summary))}</strong></span>
                    </div>
                    <div className="stage-truth-panel__row">
                        <strong>Stage truth</strong>
                        <span>{this.state.stageLoadStatus}</span>
                    </div>
                    <div className="stage-truth-panel__line">expected: {this.state.expectedStageUrl || "not_set"}</div>
                    <div className="stage-truth-panel__line">loaded: {this.state.loadedStageUrl || "not_observed"}</div>
                    <div className="stage-truth-panel__line">WebRTC: {this.state.webrtcLifecycleStatus} · {streamEndpointLabel(this.state.activeStreamEndpoint)}</div>
                    {this.state.stageLoadStatus === "disconnected" &&
                        <button type="button" className="stage-truth-panel__button" onClick={() => this._reconnectStream()}>重新連線</button>
                    }
                </div>

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
                            maxHeight: `calc(100% - ${headerHeight}px)`,
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
                    {/* viewer-edge-bim-server-console:Inspector ① 本機資料包(BindingPanel)。
                        ReviewLauncher / PresencePanel 已刪;ArtifactPanel 保留作 binding 顯示。 */}
                    <div
                        style={{
                            position: "absolute",
                            right: sidebarWidth + (showDemoPanel ? demoPanelWidth : 0),
                            top: 0,
                            width: sidebarWidth,
                            maxHeight: `calc(100% - ${headerHeight}px)`,
                            overflow: "auto",
                            zIndex: 3,
                            boxShadow: "0 0 8px rgba(0,0,0,0.18)",
                        }}
                    >
                        <ArtifactPanel
                            width={sidebarWidth}
                            artifacts={this.state.reviewArtifacts}
                            artifactBindings={this.state.latestStreamConfig?.artifact_bindings || []}
                        />
                    </div>

                    {/* viewer-edge-bim-server-console:USDAsset / USDStage 是 debug 工具,
                        預設不渲染;`?debug=1` 才顯示作為 Inspector ④ 技術細節入口。 */}
                    {isDebugQueryEnabled() && (
                        <>
                            <USDAsset
                                usdAssets={this.state.usdAssets}
                                selectedAssetUrl={this.state.selectedUSDAsset?.url}
                                onSelectUSDAsset={(value) => this._onSelectUSDAsset(value)}
                                width={sidebarWidth}
                            />
                            <USDStage
                                ref={this.usdStageRef}
                                width={sidebarWidth}
                                usdPrims={this.state.usdPrims}
                                onSelectUSDPrims={(value) => this._onSelectUSDPrims(value)}
                                selectedUSDPrims={this.state.selectedUSDPrims}
                                fillUSDPrim={(value) => this._onFillUSDPrim(value)}
                                onReset={() => this._onStageReset()}
                            />
                        </>
                    )}
                </>
                }

                {/* 統一治理控制台 MVP：A1–A10 治理 overlay 疊在 primary viewer live 3D 上（position:absolute,
                    z-index:20，late sibling，不改既有 viewer / AppStream / DemoControlPanel / ArtifactPanel 子樹）。
                    showStream=false 時不渲染（不擋 loading 畫面）。W5：coverage 來源改為
                    streamConfig.quality_metrics_summary.coverage_ratio（型別文件規定 viewer MUST NOT compute，
                    原樣呈現）；缺值時 ratio=null → gate 判 degraded（顯「coverage 未知」降級橫幅），不捏造 coverage%。 */}
                {this.state.showStream && (() => {
                    // T6：把 review session lifecycle 是否 active 納入 overlay 可操作性。active 狀態僅 active/created；
                    // queued/blocked/failed/closing/closed/dropped 一律視為非 active（治理動作唯讀，誠實表態）。
                    const lifecycle = this.state.reviewLifecycleStatus;
                    const lifecycleActive = lifecycle === "active" || lifecycle === "created";
                    const inputs = deriveOverlayInputs({ spectator: isSpectatorStreamMode(), streamReady: this._hasRemoteVideoFrame(), lifecycleActive });
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
                    return (
                        <GovernanceOverlay
                            panelState={inputs.panelState}
                            coverage={coverage}
                            failedElements={this.state.govFailedElements ?? []}
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
                        />
                    );
                })()}
            </div>
            );
        }
    }
