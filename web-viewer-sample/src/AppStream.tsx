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
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { StreamEvent, StreamProps, DirectConfig, GFNConfig, StreamStats, StreamType } from '@nvidia/omniverse-webrtc-streaming-library';
import StreamConfig from '../stream.config.json';
import { buildGfnStreamConfig, buildLocalStreamConfig, buildRemoteStreamConfig } from './viewer/core/streamConnectionProfile';
// 串流引擎一律經 getStreamer()：harness 關閉時 === 真實 AppStreamer（prod 行為零變更），
// harness 開啟時為可決定性 FakeAppStreamer（只換 transport + 假 Kit 大腦，不碰前端狀態機）。
import { getStreamer } from './harness/streamer';
import { harnessEnabled } from './harness/harnessConfig';
import { terminateStreamer, waitForStreamerTeardown } from "./viewer/core/streamerLifecycle";
// #624 exactly-once 緩解：帶 request_id 的 Kit runtime 回應在此咽喉點做短時窗 LRU 去重。
import {
    KitRuntimeResponseDeduper,
    readKitRuntimeResponseIdentity,
} from './clients/kitRuntimeResponseDedup';

type StreamPayload = StreamEvent & {
    action?: string;
    status?: string;
    info?: string | TypeError;
    stats?: StreamStats;
};

type AppStreamCustomEvent = {
    event_type?: string;
    messageRecipient?: string;
    data?: string;
    payload?: unknown;
} | null;

interface AppStreamProps {
    sessionId: string
    backendUrl: string
    signalingserver: string
    signalingport: number
    mediaserver: string
    mediaport: number | undefined
    accessToken: string
    style?: React.CSSProperties;
    onStarted: () => void;
    onVideoReady?: () => void;
    onStreamFailed: () => void;
    onLoggedIn: (userId: string) => void;
    handleCustomEvent: (event: AppStreamCustomEvent) => void;
    onFocus: () => void;
    onBlur: () => void;
    onStopped?: (event: StreamEvent) => void;
    onTerminated?: (event: StreamEvent) => void;
}

interface AppStreamState {
    streamReady: boolean;
}

export default class AppStream extends Component<AppStreamProps, AppStreamState> {
    private _requested: boolean;
    private _negotiatedSize: { w: number; h: number } | null;
    private _disposed: boolean;
    private _gfnPlayer: HTMLVideoElement | null = null;
    private _gfnPlayerObserver: MutationObserver | null = null;
    // 每個掛載實例各自一份：remount 後重置等於放行（fail-open），
    // 絕不讓跨連線的舊記憶誤殺新 stream 的第一則回應。
    private _kitResponseDeduper: KitRuntimeResponseDeduper;

    static defaultProps = {
        style: {}
    };

    static propTypes = {
        onStarted: PropTypes.func.isRequired,
        onVideoReady: PropTypes.func,
        handleCustomEvent: PropTypes.func.isRequired,
        style: PropTypes.object
    };

    constructor(props: AppStreamProps) {
        super(props);

        this._requested = false;
        this._negotiatedSize = null;
        this._disposed = false;
        this._kitResponseDeduper = new KitRuntimeResponseDeduper();
        this.state = {
            streamReady: false
        };
    }

    componentDidMount() {
        this._disposed = false;
        if (!this._requested) {
            this._requested = true;

            // The GFN client SDK exposes a `GFN` global that the GFN stream config
            // depends on. Load it lazily and only for the gfn source so non-gfn
            // builds (local / stream) don't pull NVIDIA CDN script at all.
            if (StreamConfig.source === 'gfn') {
                const existing = document.getElementById('gfn-client-sdk-script');
                if (existing) {
                    // script 標籤已存在但全域 GFN 可能仍在下載中(remount 命中既有 script);
                    // ready 才直接 init,否則補掛 load/error 等就緒,避免 GFN 未定義就 _initStream 觸 ReferenceError。
                    // @ts-expect-error GFN global is provided by the lazily-loaded SDK script
                    if (typeof GFN !== 'undefined') {
                        this._initStream();
                    } else {
                        existing.addEventListener('load', () => this._initStream());
                        existing.addEventListener('error', () => {
                            console.error('Failed to load GFN client SDK script');
                            this.props.onStreamFailed();
                        });
                    }
                } else {
                    const script = document.createElement('script');
                    script.id = 'gfn-client-sdk-script';
                    script.src = 'https://sdk.nvidia.com/gfn/client-sdk/1.x/gfn-client-sdk.js';
                    script.onload = () => this._initStream();
                    script.onerror = () => {
                        console.error('Failed to load GFN client SDK script');
                        this.props.onStreamFailed();
                    };
                    document.head.appendChild(script);
                }
            } else {
                this._initStream();
            }
        }
    }

    async _initStream() {
        let streamProps: StreamProps;
        let streamConfig: DirectConfig | GFNConfig;
        let streamSource: StreamType.DIRECT | StreamType.GFN;

        if (StreamConfig.source === 'gfn') {
            // #32:用 globalThis 讀取 GFN(缺失時為 undefined 而非裸變數 ReferenceError),
            // 未就緒就走可控失敗回饋,確保 CSP / 離線 / 載入失敗不炸整頁。
            // @ts-expect-error GFN global is provided by the lazily-loaded SDK script
            const gfnGlobal = globalThis.GFN;
            if (gfnGlobal === undefined) {
                console.error('GFN client SDK global is not available');
                this.props.onStreamFailed();
                return;
            }
            streamSource = StreamType.GFN;
            streamConfig = buildGfnStreamConfig(gfnGlobal, StreamConfig.gfn, {
                onUpdate        : (message: StreamEvent) => this._onUpdate(message),
                onStart         : (message: StreamEvent) => this._onStart(message),
                onCustomEvent   : (message) => this._onCustomEvent(message as AppStreamCustomEvent)
            });
        }

        else if (StreamConfig.source === 'local') {
            streamSource = StreamType.DIRECT;
            streamConfig = buildLocalStreamConfig(this.props, StreamConfig.local, {
                onUpdate: (message: StreamEvent) => this._onUpdate(message),
                onStart: (message: StreamEvent) => this._onStart(message),
                onStreamStats: (message: StreamEvent) => this._onStreamStats(message),
                onCustomEvent: (message) => this._onCustomEvent(message as AppStreamCustomEvent),
                onStop: (message: StreamEvent) => this._onStop(message),
                onTerminate: (message: StreamEvent) => this._onTerminate(message)
            });
        }

        else if (StreamConfig.source === 'stream') {
            streamSource =  StreamType.DIRECT;
            streamConfig = buildRemoteStreamConfig(this.props, {
                onUpdate: (message: StreamEvent) => this._onUpdate(message),
                onStart: (message: StreamEvent) => this._onStart(message),
                onCustomEvent: (message) => this._onCustomEvent(message as AppStreamCustomEvent),
                onStop: (message: StreamEvent) => this._onStop(message),
                onTerminate: (message: StreamEvent) => this._onTerminate(message),
            });
        }

        else {
            console.error(`Unknown stream source: ${StreamConfig.source}`);
            return
        }

        try {
            const teardownSucceeded = await waitForStreamerTeardown();
            if (this._disposed) return;
            if (!teardownSucceeded) {
                this.props.onStreamFailed();
                return;
            }
            streamProps = {streamConfig, streamSource}
            getStreamer().connect(streamProps)
            .then((result: StreamEvent) => {
                console.info(result);
            })
            .catch((error: StreamEvent) => {
                console.error(error);
            });
        }
        catch (error) {
            console.error(error);
        }
    }

    componentWillUnmount() {
        this._disposed = true;
        this._gfnPlayerObserver?.disconnect();
        this._gfnPlayerObserver = null;
        this._gfnPlayer?.removeEventListener('loadeddata', this._onGfnVideoReady);
        this._gfnPlayer = null;
        void terminateStreamer();
    }

    componentDidUpdate(_prevProps: AppStreamProps, prevState: AppStreamState) {
        if (prevState.streamReady === false && this.state.streamReady === true) {
            this._observeGfnPlayer();
        }
    }

    private readonly _onGfnVideoReady = (): void => {
        this.props.onVideoReady?.();
    };

    private _observeGfnPlayer(): void {
        if (StreamConfig.source !== 'gfn') return;
        const attach = (): boolean => {
            const player = document.getElementById("gfn-stream-player-video") as HTMLVideoElement | null;
            if (!player) return false;
            if (this._gfnPlayer !== player) {
                this._gfnPlayer?.removeEventListener('loadeddata', this._onGfnVideoReady);
                this._gfnPlayer = player;
                player.addEventListener('loadeddata', this._onGfnVideoReady);
            }
            player.tabIndex = -1;
            player.playsInline = true;
            player.muted = true;
            void player.play().catch(() => undefined);
            if (player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) this._onGfnVideoReady();
            this._gfnPlayerObserver?.disconnect();
            this._gfnPlayerObserver = null;
            return true;
        };
        if (attach() || this._gfnPlayerObserver) return;
        const view = document.getElementById("view");
        if (!view) return;
        this._gfnPlayerObserver = new MutationObserver(() => attach());
        this._gfnPlayerObserver.observe(view, { childList: true, subtree: true });
    }

    static sendMessage(message: unknown): Promise<unknown> {
        return getStreamer().sendMessage(message);
    }

    static stop() {
        void terminateStreamer();
    }

    _onStart(message: StreamPayload) {
        if (message.action === 'start' && message.status === 'success' && !this.state.streamReady) {
            console.info('streamReady');
            this.setState({ streamReady: true });
            this.props.onStarted();
        }

        if (message.status === "error" && StreamConfig.source === "stream")
        {
            console.log(message.info);
            alert(message.info);
            this.props.onStreamFailed();
            return;
        }
    }

    _onUpdate(message: StreamPayload) {
        try {
            if (message.action === 'authUser' && message.status === 'success') {
                if (typeof message.info === "string") {
                    this.props.onLoggedIn(message.info);
                } else {
                    console.error('AppStream authUser success ignored: info must be a string');
                }
            }
        } catch {
            console.error('AppStream authUser callback failed');
        }
    }

    _onCustomEvent(message: AppStreamCustomEvent) {
        // #624 exactly-once 緩解。gfn / local / stream 三種 stream source 的 onCustomEvent
        // 都收斂到這裡，是 Kit custom event 進入應用的單一咽喉點；在此以
        // (event_type, request_id) 去重，stage_loading / stage_management 回應、
        // commandRejected 等所有下游一體受惠，毋須各自防重。
        // 無 request_id 的事件由 readKitRuntimeResponseIdentity 回 null 直接放行。
        const identity = readKitRuntimeResponseIdentity(message);
        if (identity && !this._kitResponseDeduper.admit(identity)) {
            console.warn(
                'AppStream dropped duplicate Kit runtime response',
                { event_type: identity.eventType, request_id: identity.requestId },
            );
            return;
        }
        this.props.handleCustomEvent(message);
    }

    _onStreamStats(message: StreamPayload) {
        const stats: StreamStats | undefined = message?.stats;
        if (!stats) return;
        const w = stats.streamingResolutionWidth;
        const h = stats.streamingResolutionHeight;
        if (!w || !h) return;
        if (this._negotiatedSize && this._negotiatedSize.w === w && this._negotiatedSize.h === h) return;
        this._negotiatedSize = { w, h };
        getStreamer().resize(w, h).catch((err: unknown) => console.warn('AppStreamer.resize failed', err));
    }

    _onStop(message: StreamEvent) {
        console.info('Stream stopped', message);
        this.setState({ streamReady: false });
        this.props.onStopped?.(message);
    }

    _onTerminate(message: StreamEvent) {
        console.info('Stream terminated', message);
        this.setState({ streamReady: false });
        this.props.onTerminated?.(message);
    }

    render() {
        const source = StreamConfig.source;

        if (source === 'gfn') {
            return (
                <div
                    id="view"
                    style={{
                        backgroundColor: this.state.streamReady ? 'white': '#dddddd',
                        display: 'flex', justifyContent: 'space-between',
                        height: "100%",
                        width: "100%",
                        ...this.props.style
                    }}
                />
            );
        } else if (source === 'local' || source === 'stream') {
            return (
                <div
                    key={'stream-canvas'}
                    id={'main-div'}
                    style={{
                        backgroundColor:this.state.streamReady ? 'white': '#dddddd',
                        visibility: this.state.streamReady ? 'visible' : 'hidden',
                        ...this.props.style
                    }}
                >
                    {harnessEnabled() && (
                        <div
                            id="harness-viewport-label"
                            data-testid="harness-viewport-label"
                            style={{ position: 'fixed', zIndex: 50, top: 70, left: 320, padding: '4px 8px', background: 'rgba(118,185,0,0.9)', color: '#04210b', fontWeight: 700, fontSize: 12, borderRadius: 4, fontFamily: 'monospace' }}
                        >
                            HARNESS VIEWPORT — initializing…
                        </div>
                    )}
                    <video
                        key={'video-canvas'}
                        id={'remote-video'}
                        style={{
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                        }}
                        tabIndex={-1}
                        playsInline muted
                        autoPlay
                        onLoadedData={this.props.onVideoReady}
                    />
                    <audio id="remote-audio" muted></audio>
                    <h3 style={{ visibility: 'hidden' }} id="message-display">...</h3>
                </div>
            );
        }

        return null;
    }
}
