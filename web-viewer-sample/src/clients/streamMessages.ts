import type { HighlightItem, StreamMessage } from "../types/streamMessages";

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

export function severityToColor(severity: string): number[] {
    if (severity === "error") return [1, 0, 0, 1];
    if (severity === "warning") return [1, 0.75, 0, 1];
    return [0.2, 0.55, 1, 1];
}
