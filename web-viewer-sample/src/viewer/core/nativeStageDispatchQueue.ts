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
import type { StreamMessage } from "../../types/streamMessages";
import { getPayloadString } from "./runtimeCommandProtocol";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export interface NativeOpenStageDispatch {
    token: number;
    outgoing: StreamMessage;
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

export interface NativeStageDispatchHost {
    getStreamGeneration(): number;
    getActiveStageAttempt(): { generation: number; targetUrl: string } | null;
    isCurrentStageAttemptAwaitingProof(generation: number | undefined): boolean;
    failNativeOpenStageDispatch(dispatch: NativeOpenStageDispatch, diagnostic: string): void;
    appendReviewEvent(event: string): void;
    sendStreamMessage(outgoing: StreamMessage, dispatch: NativeOpenStageDispatch): boolean;
}

export class NativeStageDispatchQueue {
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

    constructor(private readonly host: NativeStageDispatchHost, private readonly timeoutMs: number) {}

    fenceReplacement(): void {
        this.nativeOpenStagePoisonedGeneration = this.host.getStreamGeneration();
        this.nativeOpenStageReplacementStartGeneration = this.host.getStreamGeneration();
        this._retireNativeOpenStageDispatches();
    }

    fenceStopped(): void {
        this.nativeOpenStagePoisonedGeneration = this.host.getStreamGeneration();
        this.nativeOpenStageReplacementStartGeneration = null;
        this._retireNativeOpenStageDispatches();
    }

    acceptStarted(streamGeneration: number): boolean {
        if (this.nativeOpenStagePoisonedGeneration === streamGeneration) {
            if (this.nativeOpenStageReplacementStartGeneration !== streamGeneration) {
                this.host.appendReviewEvent("ignored same-lifecycle AppStreamer start; reconnect is required before native stage retry");
                return false;
            }
            this.nativeOpenStagePoisonedGeneration = null;
            this.nativeOpenStageReplacementStartGeneration = null;
        }
        return true;
    }

    dropQueuedAttempt(attemptGeneration: number): void {
        if (this.queuedNativeOpenStage?.stageAttemptGeneration === attemptGeneration) {
            this.queuedNativeOpenStage = null;
        }
    }

    invalidateQueuedAttempt(attemptGeneration: number | undefined): void {
        if (!attemptGeneration || this.queuedNativeOpenStage?.stageAttemptGeneration === attemptGeneration) {
            this.queuedNativeOpenStage = null;
        }
    }

    _isCurrentNativeOpenStageDispatch(dispatch: NativeOpenStageDispatch): boolean {
        return this.nativeOpenStageSlot?.token === dispatch.token
            && dispatch.streamGeneration === this.host.getStreamGeneration();
    }

    _canDispatchNativeOpenStage(dispatch: NativeOpenStageDispatch): boolean {
        if (dispatch.streamGeneration !== this.host.getStreamGeneration()) return false;
        if (!dispatch.stageAttemptGeneration) return true;
        return this.host.isCurrentStageAttemptAwaitingProof(dispatch.stageAttemptGeneration)
            && this.host.getActiveStageAttempt()?.targetUrl === dispatch.targetUrl;
    }

    _clearNativeOpenStageSlotTimeout(): void {
        if (this.nativeOpenStageSlotTimeoutId === null) return;
        window.clearTimeout(this.nativeOpenStageSlotTimeoutId);
        this.nativeOpenStageSlotTimeoutId = null;
    }

    _scheduleNativeOpenStageSlotTimeout(dispatch: NativeOpenStageDispatch): void {
        this._clearNativeOpenStageSlotTimeout();
        this.nativeOpenStageSlotTimeoutId = window.setTimeout(() => {
            if (!this._isCurrentNativeOpenStageDispatch(dispatch)) return;
            const queued = this.queuedNativeOpenStage;
            this.nativeOpenStageSlot = null;
            this.queuedNativeOpenStage = null;
            this.nativeOpenStageSlotTimeoutId = null;
            // The SDK callback map may still retain this response type. Do not
            // reuse this AppStreamer lifecycle until it is remounted.
            this.nativeOpenStagePoisonedGeneration = this.host.getStreamGeneration();
            this.nativeOpenStageReplacementStartGeneration = null;
            this.host.appendReviewEvent("openedStageResult SDK callback timed out; reconnect AppStreamer before retry");
            const latest = queued && this._canDispatchNativeOpenStage(queued) ? queued : dispatch;
            this.host.failNativeOpenStageDispatch(latest, "sdk_open_stage_slot_stuck; reconnect stream before retry");
        }, this.timeoutMs);
    }

    _retireNativeOpenStageDispatches(): void {
        this._clearNativeOpenStageSlotTimeout();
        this.nativeOpenStageSlot = null;
        this.queuedNativeOpenStage = null;
    }

    _settleNativeOpenStageDispatch(dispatch: NativeOpenStageDispatch): void {
        if (!this._isCurrentNativeOpenStageDispatch(dispatch)) return;
        this._clearNativeOpenStageSlotTimeout();
        this.nativeOpenStageSlot = null;
        const queued = this.queuedNativeOpenStage;
        this.queuedNativeOpenStage = null;
        if (!queued || !this._canDispatchNativeOpenStage(queued)) return;
        if (!this._dispatchNativeOpenStage(queued)) {
            this.host.failNativeOpenStageDispatch(queued, "runtime_command_blocked");
        }
    }

    _matchingNativeOpenStageDataChannelTerminal(
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

    _settleNativeOpenStageDispatchFromDataChannel(
        responseEventType: string,
        payload: Record<string, unknown>,
    ): NativeOpenStageDispatch | null {
        const dispatch = this._matchingNativeOpenStageDataChannelTerminal(responseEventType, payload);
        if (!dispatch) return null;
        this._settleNativeOpenStageDispatch(dispatch);
        return dispatch;
    }

    _dispatchNativeOpenStage(dispatch: NativeOpenStageDispatch): boolean {
        if (
            this.nativeOpenStageSlot
            || this.nativeOpenStagePoisonedGeneration === this.host.getStreamGeneration()
            || !this._canDispatchNativeOpenStage(dispatch)
        ) return false;
        this.nativeOpenStageSlot = dispatch;
        this._scheduleNativeOpenStageSlotTimeout(dispatch);
        const dispatched = this.host.sendStreamMessage(
            dispatch.outgoing,
            dispatch,
        );
        if (!dispatched && this._isCurrentNativeOpenStageDispatch(dispatch)) {
            this._clearNativeOpenStageSlotTimeout();
            this.nativeOpenStageSlot = null;
        }
        return dispatched;
    }

    _enqueueNativeOpenStage(
        outgoing: StreamMessage,
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
            streamGeneration: this.host.getStreamGeneration(),
            stageAttemptGeneration: this.host.getActiveStageAttempt()?.generation,
            targetUrl: getPayloadString(payload, "url"),
            requestId,
            bindingRevisionId,
            settlesFromDataChannel: outgoing.event_type === "loadArtifactGroupRequest",
            onDispatched,
        };
        if (this.nativeOpenStagePoisonedGeneration === this.host.getStreamGeneration()) {
            this.host.appendReviewEvent("略過 stage request：AppStreamer callback lifecycle requires reconnect");
            return false;
        }
        if (this.nativeOpenStageSlot) {
            // Latest intent wins while retaining the in-flight SDK callback as
            // the sole completion authority for this lifecycle.
            this.queuedNativeOpenStage = dispatch;
            this.host.appendReviewEvent(`${outgoing.event_type} queued behind native openedStageResult SDK callback`);
            return true;
        }
        return this._dispatchNativeOpenStage(dispatch);
    }

}
