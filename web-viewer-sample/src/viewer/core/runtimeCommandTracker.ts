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
import { getPayloadString } from "./runtimeCommandProtocol";
import { isRuntimeResponseForRequest } from "./runtimeEventCatalog";

export type RuntimeCommandOutcome = "success" | "rejected" | "error" | "timed-out" | "superseded";

export interface RuntimeCommandContext {
    eventType: string;
    bindingRevisionId?: string;
    stageUrl?: string;
    stageAttemptGeneration?: number;
}

export interface RuntimeCommandCorrelation {
    requestId: string;
    context?: RuntimeCommandContext;
    disposition: "matched" | "untracked" | "uncorrelated" | "duplicate" | "mismatch";
    mismatchReason?: "event_type" | "binding_revision";
}

export class RuntimeCommandTracker {
    private runtimeCommandContexts = new Map<string, RuntimeCommandContext>();
    private runtimeCommandTerminalClaims = new Map<string, { eventType: string; outcome: RuntimeCommandOutcome }>();
    // Terminal claims deliberately retain their minimal established shape.
    // Keep only the safety metadata needed to process a later authenticated
    // physical-change terminal after an intent was superseded or timed out.
    private runtimeCommandTerminalSafetyContexts = new Map<string, RuntimeCommandContext>();

    constructor(private readonly host: {
        appendReviewEvent(event: string): void;
        recordTerminal(requestId: string, eventType: string, outcome: RuntimeCommandOutcome): void;
    }) {}

    get pendingCount(): number { return this.runtimeCommandContexts.size; }
    get terminalCount(): number { return this.runtimeCommandTerminalClaims.size; }

    hasRequest(requestId: string): boolean {
        return this.runtimeCommandTerminalClaims.has(requestId) || this.runtimeCommandContexts.has(requestId);
    }

    hasContext(requestId: string): boolean { return this.runtimeCommandContexts.has(requestId); }

    getContext(requestId: string): Readonly<RuntimeCommandContext> | undefined {
        const context = this.runtimeCommandContexts.get(requestId);
        return context ? { ...context } : undefined;
    }

    getTerminal(requestId: string): Readonly<{ eventType: string; outcome: RuntimeCommandOutcome }> | undefined {
        const terminal = this.runtimeCommandTerminalClaims.get(requestId);
        return terminal ? { ...terminal } : undefined;
    }

    getSafetyContext(requestId: string): Readonly<RuntimeCommandContext> | undefined {
        const context = this.runtimeCommandTerminalSafetyContexts.get(requestId);
        return context ? { ...context } : undefined;
    }

    register(requestId: string, context: RuntimeCommandContext): boolean {
        if (!requestId || this.hasRequest(requestId)) return false;
        this.runtimeCommandContexts.set(requestId, { ...context });
        while (this.runtimeCommandContexts.size > 128) {
            const oldest = this.runtimeCommandContexts.keys().next().value as string | undefined;
            if (!oldest) break;
            this.runtimeCommandContexts.delete(oldest);
        }
        return true;
    }

    deleteContext(requestId: string): void {
        this.runtimeCommandContexts.delete(requestId);
    }

    attachStageAttempt(stageUrl: string | null, attemptGeneration: number): void {
        for (const context of this.runtimeCommandContexts.values()) {
            if (
                (context.eventType === "openStageRequest" || context.eventType === "loadArtifactGroupRequest")
                && !context.stageAttemptGeneration
                && context.stageUrl === stageUrl
            ) context.stageAttemptGeneration = attemptGeneration;
        }
    }

    claimAll(outcome: RuntimeCommandOutcome): void {
        for (const [requestId, context] of this.runtimeCommandContexts.entries()) {
            this._claimRuntimeCommandTerminal(requestId, context.eventType, outcome);
        }
    }

    claimAttempt(attemptGeneration: number, outcome: RuntimeCommandOutcome): void {
        for (const [requestId, context] of this.runtimeCommandContexts.entries()) {
            if (context.stageAttemptGeneration === attemptGeneration) {
                this._claimRuntimeCommandTerminal(requestId, context.eventType, outcome);
            }
        }
    }

    _correlateRuntimeCommandEvent(
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

        if (!isRuntimeResponseForRequest(responseEventType, context.eventType)) {
            this.host.appendReviewEvent(`忽略 ${responseEventType}：terminal 與 ${context.eventType} 不相符`);
            return { requestId, context, disposition: "mismatch", mismatchReason: "event_type" };
        }
        const expectedRevision = context.bindingRevisionId;
        const receivedRevision = getPayloadString(payload, "binding_revision_id");
        if (expectedRevision && receivedRevision !== expectedRevision) {
            this.host.appendReviewEvent(`忽略 ${responseEventType}：binding revision 與 request context 不相符`);
            return { requestId, context, disposition: "mismatch", mismatchReason: "binding_revision" };
        }
        return { requestId, context, disposition: "matched" };
    }

    _claimRuntimeCommandTerminal(
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
        this.host.recordTerminal(requestId, eventType, outcome);
        this.runtimeCommandContexts.delete(requestId);
        return true;
    }

    _completeRuntimeCommandEvent(
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

}
