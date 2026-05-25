/**
 * viewer-edge-bim-server-console:三段 ready 狀態計算
 *
 * 取代 viewer 主畫面單一 `ready` 字樣為三段 ready,避免使用者把
 * stage matched 誤解為 IFC 語意正確。
 *
 *   File ready     = stream_config.model.status === "ready" + model.url 存在
 *   Runtime ready  = WebRTC started + stageLoadStatus === "matched"
 *   Semantic ready = quality_metrics_summary.semantic_mapping_fidelity set
 *                    + mapping_has_ifc_type=true + mapping_has_ifc_name=true
 *
 * Semantic ready 三條件全到位 → "yes";部分到位 → "incomplete";完全缺
 * → "no"。viewer 不偽宣告。
 */
import type { ConversionQualityMetricsSummary, ReviewStreamConfig } from "../types/review";

export type TriReadyState = "yes" | "no" | "incomplete";

export type WebRtcLifecycle = "initializing" | "started" | "stopped" | "terminated" | "failed";
export type StageLoadStatus = "unproven" | "pending" | "matched" | "mismatch" | "disconnected";

export function computeFileReady(streamConfig: ReviewStreamConfig | null): TriReadyState {
    if (!streamConfig?.model) return "no";
    if (streamConfig.model.status === "ready" && streamConfig.model.url) return "yes";
    return "no";
}

export function computeRuntimeReady(
    webrtcLifecycle: WebRtcLifecycle,
    stageLoadStatus: StageLoadStatus,
): TriReadyState {
    if (webrtcLifecycle === "started" && stageLoadStatus === "matched") return "yes";
    if (webrtcLifecycle === "started" && (stageLoadStatus === "pending" || stageLoadStatus === "unproven")) {
        return "incomplete";
    }
    return "no";
}

export function computeSemanticReady(
    summary: ConversionQualityMetricsSummary | null | undefined,
): TriReadyState {
    if (!summary) return "no";
    const hasFidelity = typeof summary.semantic_mapping_fidelity === "string"
        && summary.semantic_mapping_fidelity.length > 0;
    const hasType = summary.mapping_has_ifc_type === true;
    const hasName = summary.mapping_has_ifc_name === true;
    if (hasFidelity && hasType && hasName) return "yes";
    if (hasFidelity || hasType || hasName) return "incomplete";
    return "no";
}

export function triReadyLabel(state: TriReadyState): string {
    if (state === "yes") return "yes";
    if (state === "incomplete") return "incomplete";
    return "no";
}
