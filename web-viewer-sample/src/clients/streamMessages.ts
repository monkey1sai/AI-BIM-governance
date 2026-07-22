import type { ArtifactBinding } from "../types/artifacts";
import type { HighlightItem, StreamMessage } from "../types/streamMessages";

interface StageCompositionRequest {
    primary: ArtifactBinding | null;
    secondary_layers: ArtifactBinding[];
}

export interface AuthorizedStageArtifact {
    artifact_id: string;
    role: "primary" | "secondary";
    load_order: number;
    usdc_url: string;
}

export interface AuthorizedStageTransaction {
    stage_binding_authorization_id: string;
    binding_revision_id: string;
    stage_composition: {
        primary: AuthorizedStageArtifact & { role: "primary" };
        secondary_layers: Array<AuthorizedStageArtifact & { role: "secondary" }>;
    };
}

export function buildOpenStageRequest(
    url: string,
    artifactBindings: ArtifactBinding[] = [],
    stageComposition?: StageCompositionRequest | null,
): StreamMessage {
    const primary = stageComposition?.primary?.url ? stageComposition.primary : null;
    const secondaryLayers = stageComposition?.secondary_layers?.filter((binding) => binding.url) || [];
    return {
        event_type: "openStageRequest",
        payload: {
            url,
            requested_stage_url: url,
            ...(primary
                ? {
                      stage_composition: {
                          primary,
                          secondary_layers: secondaryLayers,
                      },
                  }
                : {}),
            ...(artifactBindings.length > 0 ? { artifact_bindings: artifactBindings } : {}),
        },
    };
}

export function buildAuthorizedOpenStageRequest(
    transaction: AuthorizedStageTransaction,
): StreamMessage {
    const url = transaction.stage_composition.primary.usdc_url;
    return {
        event_type: "openStageRequest",
        payload: {
            url,
            requested_stage_url: url,
            stage_binding_authorization_id: transaction.stage_binding_authorization_id,
            binding_revision_id: transaction.binding_revision_id,
            stage_composition: transaction.stage_composition,
        },
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

export function buildHighlightPrimsRequest(items: HighlightItem[], focusFirst = true, requestId?: string): StreamMessage {
    return {
        event_type: "highlightPrimsRequest",
        payload: {
            ...(requestId ? { request_id: requestId } : {}),
            mode: "replace",
            items,
            focus_first: focusFirst,
        },
    };
}

export function buildFocusPrimRequest(primPath = "/World", requestId?: string): StreamMessage {
    return {
        event_type: "focusPrimRequest",
        payload: {
            ...(requestId ? { request_id: requestId } : {}),
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
