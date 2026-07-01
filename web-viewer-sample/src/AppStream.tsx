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
// 串流引擎一律經 getStreamer()：harness 關閉時 === 真實 AppStreamer（prod 行為零變更），
// harness 開啟時為可決定性 FakeAppStreamer（只換 transport + 假 Kit 大腦，不碰前端狀態機）。
import { getStreamer } from './harness/streamer';
import { harnessEnabled } from './harness/harnessConfig';

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

    static defaultProps = {
        style: {}
    };

    static propTypes = {
        onStarted: PropTypes.func.isRequired,
        handleCustomEvent: PropTypes.func.isRequired,
        style: PropTypes.object
    };

    constructor(props: AppStreamProps) {
        super(props);

        this._requested = false;
        this._negotiatedSize = null;
        this.state = {
            streamReady: false
        };
    }

    componentDidMount() {
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

    _initStream() {
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
            streamConfig = {
                GFN             : gfnGlobal,
                catalogClientId : StreamConfig.gfn.catalogClientId,
                clientId        : StreamConfig.gfn.clientId,
                cmsId           : StreamConfig.gfn.cmsId,
                onUpdate        : (message: StreamEvent) => this._onUpdate(message),
                onStart         : (message: StreamEvent) => this._onStart(message),
                onCustomEvent   : (message) => this._onCustomEvent(message as AppStreamCustomEvent)
            }
        }

        else if (StreamConfig.source === 'local') {
            streamSource = StreamType.DIRECT;
            streamConfig = {
                videoElementId: 'remote-video',
                audioElementId: 'remote-audio',
                server: this.props.signalingserver || StreamConfig.local.server,
                authenticate: Boolean(this.props.accessToken),
                ...(this.props.accessToken ? { accessToken: this.props.accessToken } : {}),
                maxReconnects: 20,
                signalingServer: this.props.signalingserver || StreamConfig.local.server,
                signalingPort: this.props.signalingport || StreamConfig.local.signalingPort,
                mediaServer: this.props.mediaserver || StreamConfig.local.server,
                // mediaport 的「未指定」哨兵有兩種：undefined（Window 路徑 StreamEndpoint
                // 缺值時）與 0（App.tsx state 初始 / _resetState 的 mediaport: number=0）。
                // 兩者都代表沒有有效 port，必須略過 mediaPort 欄交給 library 套預設；
                // 僅當 props.mediaport 為真正設定的非零 number 時才帶入（還原 EC-02 前
                // `(this.props.mediaport || StreamConfig.local.mediaPort) != null` 的 falsy-0
                // 語意，同時保留 number|undefined 型別不傳 null / undefined）。
                ...(this.props.mediaport != null && this.props.mediaport !== 0 && {
                    mediaPort: this.props.mediaport,
                }),
                nativeTouchEvents: true,
                // No hardcoded width/height/fps — library defaults (1920x1080/60) match the
                // server's renderer.resolution in the .kit file. The server's actual encoded
                // size may differ (e.g. 1920x1008 in headless mode) due to streaming-layer
                // internals; onStreamStats below detects that and calls AppStreamer.resize()
                // so client and server converge on whatever size the encoder actually delivers.
                onUpdate: (message: StreamEvent) => this._onUpdate(message),
                onStart: (message: StreamEvent) => this._onStart(message),
                onStreamStats: (message: StreamEvent) => this._onStreamStats(message),
                onCustomEvent: (message) => this._onCustomEvent(message as AppStreamCustomEvent),
                onStop: (message: StreamEvent) => this._onStop(message),
                onTerminate: (message: StreamEvent) => this._onTerminate(message)
            };
        }

        else if (StreamConfig.source === 'stream') {
            streamSource =  StreamType.DIRECT;
            streamConfig = {
                signalingServer: this.props.signalingserver,
                signalingPort: this.props.signalingport,
                mediaServer: this.props.mediaserver,
                // 與 local 分支一致處理 mediaport 的未指定哨兵（undefined / App.tsx
                // state 初始的 0）：缺值時略過 mediaPort 欄交給 library 套預設，
                // 不把 0 / undefined 當有效 port 傳入 DirectConfig.mediaPort。
                ...(this.props.mediaport != null && this.props.mediaport !== 0 && {
                    mediaPort: this.props.mediaport,
                }),
                backendUrl: this.props.backendUrl,
                sessionId: this.props.sessionId,
                autoLaunch: true,
                cursor: 'free',
                mic: false,
                videoElementId: 'remote-video',
                audioElementId: 'remote-audio',
                authenticate: false,
                maxReconnects: 20,
                nativeTouchEvents: true,
                width: 1920,
                height: 1080,
                fps: 60,
                onUpdate: (message: StreamEvent) => this._onUpdate(message),
                onStart: (message: StreamEvent) => this._onStart(message),
                onCustomEvent: (message) => this._onCustomEvent(message as AppStreamCustomEvent),
                onStop: (message: StreamEvent) => this._onStop(message),
                onTerminate: (message: StreamEvent) => this._onTerminate(message),
            };
        }

        else {
            console.error(`Unknown stream source: ${StreamConfig.source}`);
            return
        }

        try {
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
        getStreamer().terminate(false);
    }

    componentDidUpdate(_prevProps: AppStreamProps, prevState: AppStreamState) {
        if (prevState.streamReady === false && this.state.streamReady === true) {
            const player = document.getElementById("gfn-stream-player-video") as HTMLVideoElement;
            if (player) {
                player.tabIndex = -1;
                player.playsInline = true;
                player.muted = true;
                player.play();
            }
        }
    }

    static sendMessage(message: unknown): Promise<unknown> {
        return getStreamer().sendMessage(message);
    }

    static stop() {
        getStreamer().terminate(false);
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
                }
            }
        } catch (error) {
            console.error(message);
        }
    }

    _onCustomEvent(message: AppStreamCustomEvent) {
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
                    />
                    <audio id="remote-audio" muted></audio>
                    <h3 style={{ visibility: 'hidden' }} id="message-display">...</h3>
                </div>
            );
        }

        return null;
    }
}
