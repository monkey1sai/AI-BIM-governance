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
export interface AppStreamEventType {
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

function isNvidiaOpenStageEvent(result: Record<string, unknown>): boolean {
    // SDK 5.18.2 fromStageOpenedEvent() maps Kit's StageOpenedEvent to this
    // concrete wrapper shape. Requiring every stable field keeps arbitrary
    // trace-less AppStream results fail-closed. Only success is promoted to
    // success below; every other concrete status is a terminal failure.
    return result.action === "message"
        && typeof result.url === "string"
        && result.url.length > 0
        && typeof result.info === "string"
        && typeof result.status === "string";
}

export function requestUsesNativeOpenedStageResult(requestEventType: string): boolean {
    // Both stage commands can produce Kit's openedStageResult. NVIDIA SDK
    // resolves openStageRequest from its callback map, while its unknown
    // loadArtifactGroupRequest gets only an immediate generic ACK; they still
    // share one per-lifecycle slot so neither result can be misattributed.
    return requestEventType === "openStageRequest"
        || requestEventType === "loadArtifactGroupRequest";
}

// #783：outbound trace 只能補給「形狀正確」的 native 成功回應。欄位名對齊 SDK
// LogFormatter.fromLoadingStateEvent / fromGetChildrenEvent 的產出；值域對齊
// tests/contracts/kit-datachannel-v1.schema.json（loadingStateResponse.loading_state 只准
// idle|busy；getChildrenResponse.children 每個元素都必須是物件）。任何不在契約內的值
// 都不得被補上 trace 後放進 _handleCustomEvent——那條路會直接改 isKitReady / usdPrims。
const NATIVE_LOADING_STATES: ReadonlySet<string> = new Set(["idle", "busy"]);

function isExpectedNativeResult(
    requestEventType: string,
    result: Record<string, unknown>,
    requestPayload: Record<string, unknown>,
): boolean {
    if (getPayloadString(result, "status") !== "success") return false;
    if (requestEventType === "loadingStateQuery") {
        return typeof result.loadingState === "string" && NATIVE_LOADING_STATES.has(result.loadingState);
    }
    if (requestEventType === "getChildrenRequest") {
        // 回應必須答的是**這一次**請求的節點：primPath 逐字等於 outbound prim_path。
        // 這同時擋掉切換模型後遲到的舊 stage 回應被當成新樹的 root 回應（review P2）。
        const requestedPrimPath = getPayloadString(requestPayload, "prim_path");
        return typeof result.primPath === "string"
            && requestedPrimPath !== ""
            && result.primPath === requestedPrimPath
            && Array.isArray(result.children)
            // 明確只傳 child：Array.every 的第二個引數是 index，直接傳函式會把
            // 兄弟節點的序號當成遞迴深度，第 33 個兄弟就會被誤拒（gate correctness:1）。
            && result.children.every((child) => isNativeChildPrimRecord(child));
    }
    return false;
}

// 契約 `children.items: object` 排除陣列；handler 之後會把元素當 USDPrimType 用、
// _makePickable 直接取 `prim.path`、USDStage 展開節點時再遞迴讀 `children`，所以這裡要求
// 「非陣列物件、path 為字串，且巢狀 children 若存在也必須是同樣合法的陣列」；
// 不讓 `[[]]`、缺 path、或 `{ children: [null] }` 這類元素被補上 trace 後進 handler。
function isNativeChildPrimRecord(value: unknown, depth = 0): boolean {
    if (!isRecord(value) || Array.isArray(value) || typeof value.path !== "string") return false;
    if (!Object.prototype.hasOwnProperty.call(value, "children")) return true;
    // 深度上限只防惡意／損壞的超深巢狀把驗證拖垮；正常 lazy-load 回應只帶一層。
    if (depth >= 32) return false;
    return Array.isArray(value.children)
        && value.children.every((child) => isNativeChildPrimRecord(child, depth + 1));
}

// USD 的 pseudo-root `/` 與本 viewer 的預設 root `/World` 都視為 root 請求：
// stage_management 明確支援對 `/` 回傳頂層子節點，handler 對 root 也是整棵樹重建。


export function appStreamResultToAppEvent(
    requestEventType: string,
    result: unknown,
    requestPayload?: unknown,
    allowNativeOpenStageFallback = false,
): AppStreamEventType | null {
    if (!isRecord(result)) return null;
    const requestPayloadRecord: Record<string, unknown> = isRecord(requestPayload) ? requestPayload : {};

    if (requestUsesNativeOpenedStageResult(requestEventType)) {
        // A production AppStreamer OpenStageEvent has no data-channel
        // correlation at all. Any partial native correlation is ambiguous and
        // must not be completed by mixing in outbound fields. A trace-less
        // fallback is only safe while the per-lifecycle single-flight slot is
        // current, and only when the complete native wrapper matches the
        // exact outbound target and authority tuple.
        const outboundTraceId = getPayloadString(requestPayloadRecord, "trace_id");
        const outboundRequestId = getPayloadString(requestPayloadRecord, "request_id");
        const outboundBindingRevisionId = getPayloadString(requestPayloadRecord, "binding_revision_id");
        const hasInboundCorrelation = ["trace_id", "request_id", "binding_revision_id"]
            .some((key) => Object.prototype.hasOwnProperty.call(result, key));
        const nativeOpenStageResponse = !hasInboundCorrelation
            && allowNativeOpenStageFallback
            && isNvidiaOpenStageEvent(result);

        if (hasInboundCorrelation) {
            if (
                !outboundTraceId
                || !outboundRequestId
                || getPayloadString(result, "trace_id") !== outboundTraceId
                || getPayloadString(result, "request_id") !== outboundRequestId
                || (
                    outboundBindingRevisionId
                        ? getPayloadString(result, "binding_revision_id") !== outboundBindingRevisionId
                        : Object.prototype.hasOwnProperty.call(result, "binding_revision_id")
                )
            ) return null;
        } else if (
            !nativeOpenStageResponse
            || !outboundTraceId
            || !outboundRequestId
            || !outboundBindingRevisionId
            || getPayloadString(result, "url") !== getPayloadString(requestPayloadRecord, "url")
        ) {
            return null;
        }

        const status = getPayloadString(result, "status");
        const info = getPayloadString(result, "info");
        // The SDK treats loadArtifactGroupRequest as an unknown custom
        // command. Its returned wrapper is only an immediate transport ACK;
        // the authenticated DataChannel terminal carries changed_failed and
        // must remain the sole completion authority for this transaction.
        if (nativeOpenStageResponse && requestEventType === "loadArtifactGroupRequest") return null;

        const responseResult = status === "success" ? "success" : "error";
        return {
            event_type: "openedStageResult",
            payload: {
                trace_id: outboundTraceId,
                result: responseResult,
                url: getPayloadString(result, "url"),
                error: responseResult === "error" ? info || [requestEventType, status || "failed"].join(" ") : "",
                request_id: outboundRequestId,
                ...(outboundBindingRevisionId ? { binding_revision_id: outboundBindingRevisionId } : {}),
            },
        };
    }

    // #783：SDK 對 native 指令（loadingStateQuery / getChildrenRequest）會自己攔下 Kit 的
    // 同名回應，並以 fromLoadingStateEvent / fromGetChildrenEvent 重組成
    // `{ action, status, info, loadingState|primPath, url|children }` 後 resolve 這個 promise
    // ——**trace_id 在這一步被 SDK 剝掉**（Kit 端確實有送，同 payload 換名探針逐則到達）。
    // 之前只認 result.trace_id，等於把每一則正常回應都靜默丟掉：isKitReady 永遠 false、
    // 永不送 openStageRequest、3D 全黑（181 與本機皆重現）。
    // 這裡改用送出時由 _withVerifiedDataChannelTrace 寫入、且已對照 authority 驗證過的
    // outbound trace_id；SDK 的 native callback map 保證此 result 就是該次請求的回應。
    // 兩道守門（review P2）：
    //   (1) result 若「帶有」trace_id 屬性但值為空／null／非字串，是明確損壞的 correlation
    //       carrier，必須 fail closed，不得用 outbound 補位（帶錯值的 trace 本來就會被拒）。
    //   (2) 只有 result 長得像該指令預期的 native 回應（status=success 且帶請求專屬欄位）
    //       才允許補位；SDK 對 warning／error／generic ACK 也會 resolve 同一個 promise，
    //       那些不得被補上 trace 後當成合法回應放進 _handleCustomEvent。
    const hasInboundTrace = Object.prototype.hasOwnProperty.call(result, "trace_id");
    const inboundTraceId = getPayloadString(result, "trace_id");
    if (hasInboundTrace && !inboundTraceId) return null;
    const traceId = inboundTraceId
        || (isExpectedNativeResult(requestEventType, result, requestPayloadRecord)
            ? getPayloadString(requestPayloadRecord, "trace_id")
            : "");
    if (!traceId) return null;

    if (requestEventType === "loadingStateQuery") {
        return {
            event_type: "loadingStateResponse",
            payload: {
                trace_id: traceId,
                loading_state: getPayloadString(result, "loadingState"),
                url: getPayloadString(result, "url"),
            },
        };
    }

    if (requestEventType === "getChildrenRequest") {
        return {
            event_type: "getChildrenResponse",
            payload: {
                trace_id: traceId,
                prim_path: getPayloadString(result, "primPath"),
                children: Array.isArray(result.children) ? result.children : [],
            },
        };
    }

    return null;
}
