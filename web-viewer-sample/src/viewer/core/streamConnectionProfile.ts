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
import type { DirectConfig, GFNConfig, StreamEvent } from '@nvidia/omniverse-webrtc-streaming-library';

export interface StreamConnectionInputs {
    sessionId: string;
    backendUrl: string;
    signalingserver: string;
    signalingport: number;
    mediaserver: string;
    mediaport: number | undefined;
    accessToken: string;
}

export interface StreamConnectionCallbacks {
    onUpdate: (message: StreamEvent) => void;
    onStart: (message: StreamEvent) => void;
    onStreamStats: (message: StreamEvent) => void;
    onCustomEvent: NonNullable<DirectConfig['onCustomEvent']>;
    onStop: (message: StreamEvent) => void;
    onTerminate: (message: StreamEvent) => void;
}

export function buildGfnStreamConfig(
    gfnGlobal: unknown,
    defaults: Pick<GFNConfig, 'catalogClientId' | 'clientId' | 'cmsId'>,
    callbacks: Pick<StreamConnectionCallbacks, 'onUpdate' | 'onStart' | 'onCustomEvent'>,
): GFNConfig {
    return {
        GFN             : gfnGlobal,
        catalogClientId : defaults.catalogClientId,
        clientId        : defaults.clientId,
        cmsId           : defaults.cmsId,
        onUpdate        : callbacks.onUpdate,
        onStart         : callbacks.onStart,
        onCustomEvent   : callbacks.onCustomEvent
    };
}

export function buildLocalStreamConfig(
    inputs: StreamConnectionInputs,
    defaults: { server: string; signalingPort: number },
    callbacks: StreamConnectionCallbacks,
): DirectConfig {
    return {
        videoElementId: 'remote-video',
        audioElementId: 'remote-audio',
        server: inputs.signalingserver || defaults.server,
        authenticate: Boolean(inputs.accessToken),
        ...(inputs.accessToken ? { accessToken: inputs.accessToken } : {}),
        maxReconnects: 20,
        signalingServer: inputs.signalingserver || defaults.server,
        signalingPort: inputs.signalingport || defaults.signalingPort,
        mediaServer: inputs.mediaserver || defaults.server,
        // mediaport 的「未指定」哨兵有兩種：undefined（Window 路徑 StreamEndpoint
        // 缺值時）與 0（App.tsx state 初始 / _resetState 的 mediaport: number=0）。
        // 兩者都代表沒有有效 port，必須略過 mediaPort 欄交給 library 套預設；
        // 僅當 props.mediaport 為真正設定的非零 number 時才帶入（還原 EC-02 前
        // `(this.props.mediaport || StreamConfig.local.mediaPort) != null` 的 falsy-0
        // 語意，同時保留 number|undefined 型別不傳 null / undefined）。
        ...(inputs.mediaport != null && inputs.mediaport !== 0 && {
            mediaPort: inputs.mediaport,
        }),
        nativeTouchEvents: true,
        // No hardcoded width/height/fps — library defaults (1920x1080/60) match the
        // server's renderer.resolution in the .kit file. The server's actual encoded
        // size may differ (e.g. 1920x1008 in headless mode) due to streaming-layer
        // internals; onStreamStats below detects that and calls AppStreamer.resize()
        // so client and server converge on whatever size the encoder actually delivers.
        onUpdate: callbacks.onUpdate,
        onStart: callbacks.onStart,
        onStreamStats: callbacks.onStreamStats,
        onCustomEvent: callbacks.onCustomEvent,
        onStop: callbacks.onStop,
        onTerminate: callbacks.onTerminate
    };
}

export function buildRemoteStreamConfig(
    inputs: StreamConnectionInputs,
    callbacks: Omit<StreamConnectionCallbacks, 'onStreamStats'>,
): DirectConfig {
    return {
        signalingServer: inputs.signalingserver,
        signalingPort: inputs.signalingport,
        mediaServer: inputs.mediaserver,
        // 與 local 分支一致處理 mediaport 的未指定哨兵（undefined / App.tsx
        // state 初始的 0）：缺值時略過 mediaPort 欄交給 library 套預設，
        // 不把 0 / undefined 當有效 port 傳入 DirectConfig.mediaPort。
        ...(inputs.mediaport != null && inputs.mediaport !== 0 && {
            mediaPort: inputs.mediaport,
        }),
        backendUrl: inputs.backendUrl,
        sessionId: inputs.sessionId,
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
        onUpdate: callbacks.onUpdate,
        onStart: callbacks.onStart,
        onCustomEvent: callbacks.onCustomEvent,
        onStop: callbacks.onStop,
        onTerminate: callbacks.onTerminate,
    };
}
