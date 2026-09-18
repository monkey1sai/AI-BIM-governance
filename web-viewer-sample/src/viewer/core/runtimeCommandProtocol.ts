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
import { KIT_COMMAND_REJECTION_REASONS, KIT_MUTATING_COMMANDS } from "../../generated/kit-command-vocabulary";

// mutator 清單與拒絕原因來自 Kit Command Vocabulary，不在這裡手寫。
const runtimeMutatingEvents = new Set<string>(KIT_MUTATING_COMMANDS);
const runtimeRejectionReasons = new Set<RuntimeRejectionReason>(KIT_COMMAND_REJECTION_REASONS);

export type RuntimeRejectionReason = (typeof KIT_COMMAND_REJECTION_REASONS)[number];

export interface RuntimeCommandRejection {
    rejected_event_type: string;
    reason: RuntimeRejectionReason;
    request_id?: string;
    rejection_id?: string;
    retryable: boolean;
    runtime_state: "unchanged" | "changed_unconfirmed";
    detail_code?: string;
    binding_revision_id?: string;
}

export function isRuntimeMutator(eventType: string): boolean {
    return runtimeMutatingEvents.has(eventType);
}

function isSafeMachineField(value: string, maxLength = 128): boolean {
    return value.length > 0
        && value.length <= maxLength
        && /^[A-Za-z0-9_.:-]+$/.test(value);
}

export function getPayloadString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === "string" ? value : "";
}

export function parseRuntimeCommandRejection(payload: Record<string, unknown>): RuntimeCommandRejection | null {
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
