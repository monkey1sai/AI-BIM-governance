import type { HighlightItem, StreamMessage } from "../types/streamMessages";

export function buildOpenStageRequest(url: string): StreamMessage {
    return {
        event_type: "openStageRequest",
        payload: { url },
    };
}

export function buildLoadingStateQuery(): StreamMessage {
    return {
        event_type: "loadingStateQuery",
        payload: {},
    };
}

export function buildGetChildrenRequest(primPath = "/World"): StreamMessage {
    return {
        event_type: "getChildrenRequest",
        payload: {
            prim_path: primPath,
            filters: ["USDGeom"],
        },
    };
}

export function buildHighlightPrimsRequest(items: HighlightItem[], focusFirst = true): StreamMessage {
    return {
        event_type: "highlightPrimsRequest",
        payload: {
            mode: "replace",
            items,
            focus_first: focusFirst,
        },
    };
}

export function buildFocusPrimRequest(primPath = "/World"): StreamMessage {
    return {
        event_type: "focusPrimRequest",
        payload: {
            prim_path: primPath,
        },
    };
}

export function buildClearHighlightRequest(): StreamMessage {
    return {
        event_type: "clearHighlightRequest",
        payload: {},
    };
}

export function severityToColor(severity: string): number[] {
    if (severity === "error") return [1, 0, 0, 1];
    if (severity === "warning") return [1, 0.75, 0, 1];
    return [0.2, 0.55, 1, 1];
}
