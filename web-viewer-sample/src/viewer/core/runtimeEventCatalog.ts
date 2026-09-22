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
import { KIT_COMMANDS, KIT_COMMAND_RESULTS, KIT_EVENTS, KIT_MUTATING_COMMANDS } from "../../generated/kit-command-vocabulary";

// 指令、事件與配對都來自 Kit Command Vocabulary（schema 的 x-kit-command），不在這裡手寫。
const viewerToKitEventTypes = new Set<string>(KIT_COMMANDS);
const kitToViewerEventTypes = new Set<string>(KIT_EVENTS);
const mutatingCommands = new Set<string>(KIT_MUTATING_COMMANDS);
const commandResults = new Map<string, ReadonlySet<string>>(
    KIT_COMMANDS.map((command): [string, ReadonlySet<string>] => [command, new Set<string>(KIT_COMMAND_RESULTS[command])]),
);

// 「result 到了就結束」是 Window 的處理方式，不是 Kit 的承諾，所以留在 viewer 手寫。
const simpleRuntimeTerminalEvents = new Set([
    "clipPlaneResult",
    "clearHighlightResult",
    "selectPrimsResult",
    "makePrimsPickableResponse",
    "resetStageResponse",
    "cameraFrameResult",
    "cameraViewResult",
    "flyNavigationResult",
    "overlayStyleResult",
]);

export function isViewerToKitEventType(eventType: string): boolean {
    return viewerToKitEventTypes.has(eventType);
}

export function isKitToViewerEventType(eventType: string): boolean {
    return kitToViewerEventTypes.has(eventType);
}

export function isRuntimeResponseForRequest(responseEventType: string, requestEventType: string): boolean {
    // tracker 只登記 mutator（Window.tsx 送出時以 isRuntimeMutator 把關）。唯讀指令的配對記在詞彙裡，
    // 但這個判斷仍只回答 mutator，與舊的手寫表完全相同。
    return mutatingCommands.has(requestEventType)
        && commandResults.get(requestEventType)?.has(responseEventType) === true;
}

/** 詞彙中的配對，唯讀指令也回答；Viewer Command Channel 以此路由結果，不另寫結果名稱。 */
export function isKitResultForCommand(resultEventType: string, commandEventType: string): boolean {
    return commandResults.get(commandEventType)?.has(resultEventType) === true;
}

export function isSimpleRuntimeTerminalEvent(eventType: string): boolean {
    return simpleRuntimeTerminalEvents.has(eventType);
}
