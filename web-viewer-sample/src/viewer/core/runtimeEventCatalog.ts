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
const viewerToKitEventTypes = new Set([
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "highlightPrimsRequest",
    "focusPrimRequest",
    "clearHighlightRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
    "loadingStateQuery",
    "getChildrenRequest",
]);

const kitToViewerEventTypes = new Set([
    "openedStageResult",
    "loadArtifactGroupResult",
    "highlightPrimsResult",
    "focusPrimResult",
    "selectPrimsResult",
    "makePrimsPickableResponse",
    "resetStageResponse",
    "clearHighlightResult",
    "loadingStateResponse",
    "getChildrenResponse",
    "stageSelectionChanged",
    "updateProgressAmount",
    "updateProgressActivity",
    "bindingApplied",
    "commandRejected",
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

export function isViewerToKitEventType(eventType: string): boolean {
    return viewerToKitEventTypes.has(eventType);
}

export function isKitToViewerEventType(eventType: string): boolean {
    return kitToViewerEventTypes.has(eventType);
}

export function isRuntimeResponseForRequest(responseEventType: string, requestEventType: string): boolean {
    return runtimeResponseRequestTypes.get(responseEventType)?.has(requestEventType) === true;
}

export function isSimpleRuntimeTerminalEvent(eventType: string): boolean {
    return simpleRuntimeTerminalEvents.has(eventType);
}
