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
import EventLogPanel from "./components/EventLogPanel";
import IssuePanel from "./components/IssuePanel";
import PresencePanel from "./components/PresencePanel";
import ReviewLauncher from "./components/ReviewLauncher";
import DemoControlPanel from "./components/DemoControlPanel";
import { BimControlClient } from "./clients/bimControlClient";
import { CoordinatorClient } from "./clients/coordinatorClient";
import { connectReviewSocket, type ReviewSocketClient } from "./clients/reviewSocket";
import { buildClearHighlightRequest, buildFocusPrimRequest, buildGetChildrenRequest, buildHighlightPrimsRequest, buildLoadingStateQuery, buildOpenStageRequest, severityToColor } from "./clients/streamMessages";
import { buildDemoHighlightItem, demoIssueId, demoPrimPath } from "./clients/demoDefaults";
import { reviewEnv } from "./config/env";
import type { DemoLogEntry } from "./types/demo";
import { mappingVerificationBlockReason, type ElementMappingDocument, type ElementMappingItem, type ElementMappingSummary } from "./types/mapping";
import type { ReviewArtifact } from "./types/artifacts";
import type { ReviewIssue } from "./types/issues";
import type { ReviewStreamConfig } from "./types/review";
import type { HighlightItem, StreamMessage } from "./types/streamMessages";


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
    mediaport: number
    accessToken: string
    onStreamFailed: () => void;
}

interface AppState {
    usdAssets: USDAssetType[];
    selectedUSDAsset: USDAssetType | null;
    reviewSessionId: string | null;
    reviewStatus: string;
    reviewArtifacts: ReviewArtifact[];
    reviewIssues: ReviewIssue[];
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
    showUI: boolean;
    isLoading: boolean;
    loadingText: string; 
    streamDiagnostic: string | null;
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

function isElementMappingDocument(value: unknown): value is ElementMappingDocument {
    return isRecord(value) && (Array.isArray(value.items) || isRecord(value.summary));
}

function makeRequestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default class App extends React.Component<AppProps, AppState> {
    
    private usdStageRef = React.createRef<USDStage>();
    private coordinatorClient = new CoordinatorClient(reviewEnv.coordinatorApiBase);
    private bimControlClient = new BimControlClient(reviewEnv.bimControlApiBase);
    private reviewSocket: ReviewSocketClient | null = null;
    private streamStartTimeoutId: number | null = null;
    private pendingMappingHighlightRequestId: string | null = null;
    private pendingMappingFocusRequestId: string | null = null;
    private pendingMappingPrimPath: string | null = null;
    // private _streamConfig: StreamConfigType = getConfig();
    
    constructor(props: AppProps) {
        super(props);

        this.state = {
            usdAssets: [],
            selectedUSDAsset: null,
            reviewSessionId: null,
            reviewStatus: "Review bootstrap 尚未載入",
            reviewArtifacts: [],
            reviewIssues: [],
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
            isLoading: true
        }
    }

    componentDidMount(): void {
        this._scheduleStreamStartTimeout();
        void this._loadUSDAssets();
        void this._bootstrapReview();
    }

    componentWillUnmount(): void {
        this._clearStreamStartTimeout();
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
        AppStream.sendMessage(JSON.stringify(message));
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

    private _handleStreamStartTimeout(): void {
        this.streamStartTimeoutId = null;
        if (this._hasRemoteVideoFrame()) return;

        const seconds = Math.round(reviewEnv.streamStartTimeoutMs / 1000);
        const endpoint = `${this.props.signalingserver || StreamConfig.local.server}:${this.props.signalingport || StreamConfig.local.signalingPort}`;
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
            reviewEvents: [...state.reviewEvents, "WebRTC 串流未建立，已顯示診斷資訊"],
        }));
    }

    private _connectReviewSocket(sessionId: string): void {
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
            if (!reviewEnv.autoCreateSession && !reviewEnv.defaultSessionId) {
                this.setState({ reviewStatus: "Review session 自動建立已停用" });
                await this._loadReviewDataFromBimControl();
                return;
            }

            const sessionId = reviewEnv.defaultSessionId || (await this.coordinatorClient.createReviewSession({
                project_id: reviewEnv.defaultProjectId,
                model_version_id: reviewEnv.defaultModelVersionId,
                created_by: reviewEnv.defaultUserId,
            })).session_id;
            const [streamConfig, bootstrap] = await Promise.all([
                this.coordinatorClient.getStreamConfig(sessionId),
                this.coordinatorClient.getReviewBootstrap(reviewEnv.defaultModelVersionId),
            ]);

            const artifacts = streamConfig.artifacts.length > 0 ? streamConfig.artifacts : bootstrap.artifacts;
            const usdAssets = this._assetsFromReviewArtifacts(artifacts);
            const selectedUSDAsset = usdAssets.find((asset) => asset.url === streamConfig.model.url) ?? usdAssets[0] ?? this.state.selectedUSDAsset;

            this._connectReviewSocket(sessionId);

            this.setState({
                reviewSessionId: sessionId,
                reviewStatus: `Review session 啟用中，模型狀態：${streamConfig.model.status}`,
                reviewArtifacts: artifacts,
                reviewIssues: bootstrap.issues,
                latestStreamConfig: streamConfig,
                mappingUrl: this._resolveMappingUrl(streamConfig, artifacts),
                usdAssets: this._mergeAssets(this.state.usdAssets, usdAssets),
                selectedUSDAsset,
                reviewEvents: [...this.state.reviewEvents, reviewEnv.defaultSessionId ? "已載入 review session" : "已建立 review session"],
            }, () => {
                if (this.state.isKitReady && this.state.selectedUSDAsset && streamConfig.model.status === "ready") {
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

    private async _loadReviewDataFromBimControl(): Promise<void> {
        try {
            const [artifacts, issues] = await Promise.all([
                this.bimControlClient.getArtifacts(reviewEnv.defaultModelVersionId),
                this.bimControlClient.getReviewIssues(reviewEnv.defaultModelVersionId),
            ]);
            const usdAssets = this._assetsFromReviewArtifacts(artifacts);
            this.setState({
                reviewArtifacts: artifacts,
                reviewIssues: issues,
                usdAssets: this._mergeAssets(this.state.usdAssets, usdAssets),
                selectedUSDAsset: this.state.selectedUSDAsset || usdAssets[0] || null,
                mappingUrl: this._resolveMappingUrl(null, artifacts),
                reviewEvents: [...this.state.reviewEvents, "已從 _bim-control 載入 review 資料"],
            });
        }
        catch (error) {
            console.warn("Unable to load review data from _bim-control.", error);
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

    private _mergeAssets(existing: USDAssetType[], incoming: USDAssetType[]): USDAssetType[] {
        const byUrl = new Map<string, USDAssetType>();
        for (const asset of [...incoming, ...existing]) {
            byUrl.set(asset.url, asset);
        }
        return Array.from(byUrl.values());
    }

    private _resolveMappingUrl(streamConfig: ReviewStreamConfig | null, artifacts: ReviewArtifact[]): string | null {
        if (streamConfig?.model.mapping_url) {
            return streamConfig.model.mapping_url;
        }
        const mappedArtifact = artifacts.find((artifact) => artifact.artifact_type === "usdc" && artifact.mapping_url);
        return mappedArtifact?.mapping_url || null;
    }

    private async _loadReviewBootstrapFromCoordinator(): Promise<void> {
        try {
            const bootstrap = await this.coordinatorClient.getReviewBootstrap(reviewEnv.defaultModelVersionId);
            const usdAssets = this._assetsFromReviewArtifacts(bootstrap.artifacts);
            this.setState({
                reviewArtifacts: bootstrap.artifacts,
                reviewIssues: bootstrap.issues,
                usdAssets: this._mergeAssets(this.state.usdAssets, usdAssets),
                selectedUSDAsset: this.state.selectedUSDAsset || usdAssets[0] || null,
                mappingUrl: this._resolveMappingUrl(this.state.latestStreamConfig, bootstrap.artifacts),
            });
            this._appendReviewEvent("review-bootstrap 已載入");
        } catch (error) {
            console.warn("Unable to load review-bootstrap.", error);
            this._appendReviewEvent("review-bootstrap 載入失敗");
        }
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
            this.setState({ streamDiagnostic: null });
            this._pollForKitReady()
        }

    /**
    * @function _pollForKitReady
    *
    * Attempts to query Kit's loading state until a response is received.
    * Once received, the 'isKitReady' flag is set to true and polling ends
    */
    async _pollForKitReady() {
        if (this.state.isKitReady === true) return

        console.info("polling Kit availability")
        this._queryLoadingState()
        setTimeout(() => this._pollForKitReady(), 3000); // Poll every 3 seconds
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
    private _openSelectedAsset(): void {
        if (!this.state.selectedUSDAsset) {
            console.warn("No USD asset is selected.");
            this.setState({ loadingText: "沒有可用的 USD / USDC 成果檔", isLoading: false });
            return;
        }

        this.setState({ loadingText: "正在載入模型...", showStream: false, isLoading: true })
        this.setState({ usdPrims: [], selectedUSDPrims: new Set<USDPrimType>() });
        this.usdStageRef.current?.resetExpandedIds();
        console.log(`Sending request to open asset: ${this.state.selectedUSDAsset.url}.`);
        this._sendStreamMessage(buildOpenStageRequest(this.state.selectedUSDAsset.url));
    }

    /**
    * @function _onSelectUSDAsset
    *
    * React to user selecting an asset in the USDAsset selector.
    */
    private _onSelectUSDAsset (usdAsset: USDAssetType): void {
        console.log(`Asset selected: ${usdAsset.name}.`);
        this.setState({ selectedUSDAsset: usdAsset }, () => {
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
        const message: AppStreamMessageType = {
            event_type: "selectPrimsRequest",
            payload: {
                paths: paths
            }
        };
        AppStream.sendMessage(JSON.stringify(message));

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

    private _onIssueClick(issue: ReviewIssue): void {
        if (!issue.usd_prim_path) {
            this.setState({ reviewEvents: [...this.state.reviewEvents, `審查問題 ${issue.issue_id} 沒有 usd_prim_path，未送出 DataChannel`] });
            return;
        }

        const item = {
            prim_path: issue.usd_prim_path,
            ifc_guid: issue.ifc_guid,
            color: severityToColor(issue.severity),
            label: issue.title,
            source: issue.source,
            issue_id: issue.issue_id,
        };
        this._sendStreamMessage(buildHighlightPrimsRequest([item], true));
        if (this.state.reviewSessionId && this.reviewSocket) {
            this.reviewSocket.emitHighlight(this.state.reviewSessionId, reviewEnv.defaultUserId, issue.issue_id, [item]);
        }
        this._appendReviewEvent(`已送出高亮請求：${issue.issue_id}`);
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
            const response = await fetch(mappingUrl, { headers: { Accept: "application/json" } });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            if (!isElementMappingDocument(payload)) {
                throw new Error("mapping JSON shape is invalid");
            }
            const items = Array.isArray(payload.items) ? payload.items.filter((item) => item.usd_prim_path) : [];
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

    private _sendDemoHighlightWorld(): void {
        this._sendStreamMessage(buildHighlightPrimsRequest([buildDemoHighlightItem("web_viewer_demo_panel")], true));
    }

    private _sendDemoFocusWorld(): void {
        this._sendStreamMessage(buildFocusPrimRequest(demoPrimPath));
    }

    private _sendDemoClearHighlight(): void {
        this._sendStreamMessage(buildClearHighlightRequest());
    }

    private _emitDemoCoordinatorHighlight(): void {
        if (!this.state.reviewSessionId || !this.reviewSocket) {
            this._appendReviewEvent("略過 coordinator highlight：尚未連線 Socket.IO session");
            return;
        }
        this.reviewSocket.emitHighlight(this.state.reviewSessionId, reviewEnv.defaultUserId, demoIssueId, [buildDemoHighlightItem("web_viewer_demo_panel")]);
        this._appendReviewEvent(`已廣播 coordinator highlight：${demoIssueId}`);
    }

    private _createDemoAnnotation(): void {
        if (!this.state.reviewSessionId || !this.reviewSocket) {
            this._appendReviewEvent("略過標註建立：尚未連線 Socket.IO session");
            return;
        }
        this.reviewSocket.emitAnnotation(this.state.reviewSessionId, reviewEnv.defaultUserId, "從 Web Viewer Demo 面板建立的示範標註");
        this._appendReviewEvent("已送出 annotationCreate");
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
        this._appendDemoIncoming(event.event_type || event.messageRecipient || "streamEvent", event);

        const payload = isRecord(event.payload) ? event.payload : {};

        // response received once a USD asset is fully loaded
        if (event.event_type === "openedStageResult") {
            if (payload.result === "success") {
                this._queryLoadingState() 
            }
            else {
                console.error('Kit App communicates there was an error loading: ' + getPayloadString(payload, "url"));
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
                this.setState({ isKitReady: true })
                this._queryLoadingState()
            }
            
            else {
                const payloadUrl = getPayloadString(payload, "url");
                const loadingState = getPayloadString(payload, "loading_state");
                const usdAsset: USDAssetType = this._getAsset(payloadUrl)
                const isStageValid: boolean = !!(usdAsset.name && usdAsset.url)
                
                // set the USD Asset dropdown to the currently opened stage if it doesn't match
                if (isStageValid && usdAsset !== undefined && this.state.selectedUSDAsset !== usdAsset)
                    this.setState({ selectedUSDAsset: usdAsset })

                // if the stage is empty, force-load the selected usd asset; the loading state is irrelevant
                if (!payloadUrl)
                    this._openSelectedAsset()
                
                // if a stage has been fully loaded and isn't a part of this application, force-load the selected stage
                else if (!isStageValid && loadingState === "idle"){
                    console.log(`The loaded asset ${payloadUrl} is invalid.`)
                    this._openSelectedAsset()
                }
                
                // show stream and populate children if the stage is valid and it's done loading
                if (isStageValid && loadingState === "idle")
                {
                    this._getChildren()
                    this.setState({ showStream: true, loadingText: "模型已載入", showUI: true, isLoading: false })
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
            if (prims.length === 0) {
                console.log('Kit App communicates an empty stage selection.');
                this.setState({ selectedUSDPrims: new Set<USDPrimType>() });
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
            console.log(JSON.parse(event.data).event_type);
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
        const showDemoPanel = reviewEnv.showDemoPanel;
        const demoPanelRight = this.state.showUI ? sidebarWidth : 0;
        const streamReservedWidth = this.state.showUI
            ? sidebarWidth + (showDemoPanel ? demoPanelWidth : 0)
            : (showDemoPanel ? demoPanelWidth : 0);
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

                {/* Streamed app */}
                <AppStream
                    sessionId={this.props.sessionId}
                    backendUrl={this.props.backendUrl}
                    signalingserver={this.props.signalingserver}
                    signalingport={this.props.signalingport}
                    mediaserver={this.props.mediaserver}
                    mediaport={this.props.mediaport}
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
                    />
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
                            onLoadBootstrap={() => void this._loadReviewBootstrapFromCoordinator()}
                            onConnectSocket={() => this._connectDemoSocket()}
                            onOpenStage={() => this._openSelectedAsset()}
                            onLoadingState={() => this._queryLoadingState()}
                            onGetChildren={() => this._getChildren()}
                            onHighlightWorld={() => this._sendDemoHighlightWorld()}
                            onFocusWorld={() => this._sendDemoFocusWorld()}
                            onClearHighlight={() => this._sendDemoClearHighlight()}
                            onEmitCoordinatorHighlight={() => this._emitDemoCoordinatorHighlight()}
                            onCreateAnnotation={() => this._createDemoAnnotation()}
                            onLoadMapping={() => void this._loadElementMapping()}
                            onSelectMappingIndex={(index) => this._selectMappingIndex(index)}
                            onHighlightSelectedMapping={() => this._sendSelectedMappingHighlight()}
                            onFocusSelectedMapping={() => this._sendSelectedMappingFocus()}
                        />
                    </div>
                }

                {this.state.showUI &&
                <>
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
                        <ReviewLauncher
                            width={sidebarWidth}
                            status={this.state.reviewStatus}
                        />
                        <PresencePanel
                            width={sidebarWidth}
                            sessionId={this.state.reviewSessionId}
                        />
                        <ArtifactPanel
                            width={sidebarWidth}
                            artifacts={this.state.reviewArtifacts}
                        />
                        <IssuePanel
                            width={sidebarWidth}
                            issues={this.state.reviewIssues}
                            onIssueClick={(issue) => this._onIssueClick(issue)}
                        />
                        <EventLogPanel
                            width={sidebarWidth}
                            events={this.state.reviewEvents}
                        />
                    </div>
                        
                    {/* USD Asset Selector */}
                    <USDAsset
                        usdAssets={this.state.usdAssets}
                        selectedAssetUrl={this.state.selectedUSDAsset?.url}
                        onSelectUSDAsset={(value) => this._onSelectUSDAsset(value)}
                        width={sidebarWidth}
                    />
                    {/* USD Stage Listing */}
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
                }
            </div>
            );
        }
    }
