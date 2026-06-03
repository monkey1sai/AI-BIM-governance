/*
 * viewer-edge-bim-server-console:Window.tsx 的 module-level 純函式抽出檔。
 *
 * 這裡只放「無 React / DOM / window / this 副作用」的純函式,讓 Window.tsx
 * 的串流端點解析、lifecycle 判定、spectator binding 選擇等邏輯可被 vitest
 * 直接覆蓋。任何會碰到 window.location / props / AppStream 的 helper 仍留在
 * Window.tsx,不搬過來。
 */
import type { KitInstanceBinding, ReviewLifecycleStatus, ReviewStreamConfig } from "../types/review";

export interface StreamEndpoint {
    kitInstanceId: string | null;
    signalingserver: string;
    signalingport: number;
    mediaserver: string;
    // mediaport 用 undefined 表示「未指定」,與串流 library DirectConfig.mediaPort
    // （number | undefined）相容；缺值時 library 自行套預設,不傳 null。
    mediaport: number | undefined;
}

export type KitStreamEndpoint = ReviewStreamConfig["kit_instance_bindings"][number]["stream_config"];

export function sameStreamEndpoint(a: StreamEndpoint, b: StreamEndpoint): boolean {
    return a.kitInstanceId === b.kitInstanceId
        && a.signalingserver === b.signalingserver
        && a.signalingport === b.signalingport
        && a.mediaserver === b.mediaserver
        && a.mediaport === b.mediaport;
}

export function sameStreamTransportEndpoint(a: KitStreamEndpoint, b: KitStreamEndpoint): boolean {
    return a.signalingServer === b.signalingServer
        && a.signalingPort === b.signalingPort
        && a.mediaServer === b.mediaServer
        && (a.mediaPort ?? null) === (b.mediaPort ?? null);
}

export function isBlockedLifecycle(status: ReviewLifecycleStatus | null): boolean {
    // viewer-edge-bim-server-console:queued_for_conversion(C4 lifecycle)與
    // dropped_on_restart(C4 lifecycle)都不應觸發 WebRTC 連線,視為 blocked。
    return status === "blocked_conversion"
        || status === "queued_for_instance"
        || status === "queued_for_conversion"
        || status === "dropped_on_restart"
        || status === "closing"
        || status === "closed"
        || status === "failed";
}

export function lifecycleStatusText(status: ReviewLifecycleStatus | null): string {
    if (status === "blocked_conversion") return "成果檔仍在轉換或 mapping 尚未就緒";
    if (status === "queued_for_instance") return "等待 Kit / GPU instance 配額";
    // viewer-edge-bim-server-console:C4 lifecycle 對應字串。
    if (status === "queued_for_conversion") return "等待 conversion dispatch 輪到";
    if (status === "dropped_on_restart") return "coordinator restart 後 queue 已清空,operator 須重新 POST";
    if (status === "created") return "審查請求已建立，等待 session 綁定";
    if (status === "active") return "Review session 啟用中";
    if (status === "closing") return "Review session 關閉中";
    if (status === "closed") return "Review session 已關閉";
    if (status === "failed") return "Review session 建立失敗";
    return "Review bootstrap 尚未載入";
}

/**
 * @function selectSpectatorBinding
 *
 * 旁觀者要連到「不是 primary」的那一路 Kit binding。
 *
 * - primaryKitInstanceId 有值時:用 kit_instance_id 直接比對,挑第一個
 *   kit_instance_id !== primaryKitInstanceId 的 binding(身分比對優先,
 *   不依賴 transport port 差異)。
 * - primaryKitInstanceId 缺失(null / undefined / 空字串)時:退回既有
 *   port-diff 邏輯——挑 transport 與 primary 不同(!sameStreamTransportEndpoint)
 *   的第一個 binding。
 *
 * 找不到(只有 primary 一路、或所有 binding 都等於 primary)時回傳 null,
 * 呼叫端會 fallback 到 primary binding。
 */
export function selectSpectatorBinding(
    bindings: KitInstanceBinding[],
    primaryKitInstanceId: string | null | undefined,
    primaryWebrtc: KitStreamEndpoint,
): KitInstanceBinding | null {
    // primaryKitInstanceId 必須真的存在於 bindings 才用 id 顯式挑選;否則(coordinator
    // 資料不一致 / 缺 id)退回 transport port-diff fallback,避免誤選到 primary binding。
    const primaryPresent = primaryKitInstanceId
        ? bindings.some((binding) => binding.kit_instance_id === primaryKitInstanceId)
        : false;
    if (primaryPresent) {
        return bindings.find((binding) => binding.kit_instance_id !== primaryKitInstanceId) || null;
    }
    return bindings.find((binding) => !sameStreamTransportEndpoint(binding.stream_config, primaryWebrtc)) || null;
}
