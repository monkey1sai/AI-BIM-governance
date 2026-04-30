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
import type { ReviewArtifact } from "./types/artifacts";
import type { ReviewIssue } from "./types/issues";
import type { ReviewStreamConfig } from "./types/review";
import type { StreamMessage } from "./types/streamMessages";


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
    demoOutgoingMessages: DemoLogEntry[];
    demoIncomingMessages: DemoLogEntry[];
    usdPrims: USDPrimType[];
    selectedUSDPrims: Set<USDPrimType>;
    isKitReady: boolean;
    showStream: boolean;
    showUI: boolean;
    isLoading: boolean;
    loadingText: string; 
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

export default class App extends React.Component<AppProps, AppState> {
    
    private usdStageRef = React.createRef<USDStage>();
    private coordinatorClient = new CoordinatorClient(reviewEnv.coordinatorApiBase);
    private bimControlClient = new BimControlClient(reviewEnv.bimControlApiBase);
    private reviewSocket: ReviewSocketClient | null = null;
    // private _streamConfig: StreamConfigType = getConfig();
    
    constructor(props: AppProps) {
        super(props);

        this.state = {
            usdAssets: [],
            selectedUSDAsset: null,
            reviewSessionId: null,
            reviewStatus: "Review bootstrap pending",
            reviewArtifacts: [],
            reviewIssues: [],
            reviewEvents: [],
            latestStreamConfig: null,
            demoOutgoingMessages: [],
            demoIncomingMessages: [],
            usdPrims: [],
            selectedUSDPrims: new Set<USDPrimType>(),
            isKitReady: false,
            showStream: false,
            showUI: false,
            loadingText: "Loading asset list...",
            isLoading: true
        }
    }

    componentDidMount(): void {
        void this._loadUSDAssets();
        void this._bootstrapReview();
    }

    componentWillUnmount(): void {
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

    private _connectReviewSocket(sessionId: string): void {
        this.reviewSocket?.disconnect();
        this.reviewSocket = connectReviewSocket(reviewEnv.coordinatorSocketUrl, {
            onStatus: (status) => this._appendReviewEvent(`socket ${status}`),
            onEvent: (event, payload) => {
                this._appendReviewEvent(`socket event: ${event}`);
                this._appendDemoIncoming(`socket:${event}`, payload);
            },
        });
        this.reviewSocket.join(sessionId, reviewEnv.defaultUserId, reviewEnv.defaultDisplayName);
    }

    private _getReadyLoadingText(): string {
        return StreamConfig.source === "gfn" ? "Log in to GeForce NOW to view stream" : (StreamConfig.source === "stream" ? "Waiting for stream to initialize":  "Waiting for stream to begin");
    }

    private async _loadUSDAssets(): Promise<void> {
        try {
            const usdAssets = await fetchUSDAssets();
            const selectedUSDAsset = usdAssets[0] ?? null;

            this.setState({
                usdAssets,
                selectedUSDAsset,
                loadingText: selectedUSDAsset ? this._getReadyLoadingText() : "No USD assets available",
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
                loadingText: "Unable to load asset list",
                isLoading: false,
            });
        }
    }

    private async _bootstrapReview(): Promise<void> {
        try {
            if (!reviewEnv.autoCreateSession && !reviewEnv.defaultSessionId) {
                this.setState({ reviewStatus: "Review auto-create disabled" });
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
                reviewStatus: `Review session active: ${streamConfig.model.status}`,
                reviewArtifacts: artifacts,
                reviewIssues: bootstrap.issues,
                latestStreamConfig: streamConfig,
                usdAssets: this._mergeAssets(this.state.usdAssets, usdAssets),
                selectedUSDAsset,
                reviewEvents: [...this.state.reviewEvents, reviewEnv.defaultSessionId ? "review session loaded" : "review session created"],
            }, () => {
                if (this.state.isKitReady && this.state.selectedUSDAsset && streamConfig.model.status === "ready") {
                    this._openSelectedAsset();
                }
            });
        }
        catch (error) {
            console.warn("Review bootstrap unavailable.", error);
            this.setState({
                reviewStatus: "Review coordinator unavailable",
                reviewEvents: [...this.state.reviewEvents, "review bootstrap failed"],
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
                reviewEvents: [...this.state.reviewEvents, "loaded review data from _bim-control"],
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

    private async _loadReviewBootstrapFromCoordinator(): Promise<void> {
        try {
            const bootstrap = await this.coordinatorClient.getReviewBootstrap(reviewEnv.defaultModelVersionId);
            const usdAssets = this._assetsFromReviewArtifacts(bootstrap.artifacts);
            this.setState({
                reviewArtifacts: bootstrap.artifacts,
                reviewIssues: bootstrap.issues,
                usdAssets: this._mergeAssets(this.state.usdAssets, usdAssets),
                selectedUSDAsset: this.state.selectedUSDAsset || usdAssets[0] || null,
            });
            this._appendReviewEvent("review-bootstrap loaded");
        } catch (error) {
            console.warn("Unable to load review-bootstrap.", error);
            this._appendReviewEvent("review-bootstrap failed");
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
            this.setState({ loadingText: "Waiting for stream to begin", isLoading: false})
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
            this.setState({ loadingText: "No USD assets available", isLoading: false });
            return;
        }

        this.setState({ loadingText: "Loading Asset...", showStream: false, isLoading: true })
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
            this.setState({ reviewEvents: [...this.state.reviewEvents, `issue ${issue.issue_id} has no prim path`] });
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
        this._appendReviewEvent(`highlight requested: ${issue.issue_id}`);
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
            this._appendReviewEvent("coordinator highlight skipped: no socket session");
            return;
        }
        this.reviewSocket.emitHighlight(this.state.reviewSessionId, reviewEnv.defaultUserId, demoIssueId, [buildDemoHighlightItem("web_viewer_demo_panel")]);
        this._appendReviewEvent(`coordinator highlight emitted: ${demoIssueId}`);
    }

    private _createDemoAnnotation(): void {
        if (!this.state.reviewSessionId || !this.reviewSocket) {
            this._appendReviewEvent("annotation skipped: no socket session");
            return;
        }
        this.reviewSocket.emitAnnotation(this.state.reviewSessionId, reviewEnv.defaultUserId, "Demo annotation from Web Viewer Demo Panel");
        this._appendReviewEvent("annotationCreate emitted");
    }

    private _connectDemoSocket(): void {
        if (!this.state.reviewSessionId) {
            this._appendReviewEvent("socket connect skipped: no review session");
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
                    this.setState({ showStream: true, loadingText: "Asset loaded", showUI: true, isLoading: false })
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
            if (this.state.loadingText !== "Loading Asset...")
                this.setState( {loadingText: "Loading Asset...", isLoading: true} )
        }

        else if (event.event_type === "highlightPrimsResult") {
            const result = getPayloadString(payload, "result") || "unknown";
            this.setState({ reviewEvents: [...this.state.reviewEvents, `highlight result: ${result}`] });
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
