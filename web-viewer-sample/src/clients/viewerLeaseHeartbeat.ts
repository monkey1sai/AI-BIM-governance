// viewer lease heartbeat 排程政策的唯一正本（learning-ledger f4-viewer-lease-fork 收斂）。
// coordinator 下發 heartbeat_after_ms（現值 15000；lease TTL 45000），client 端的地板與預設
// 一律由本 helper 決定；console pane 與 standalone viewer 兩個消費端不得各自另定數值。
// 歷史分岔：pane 用 Math.max(5000, x || 15000)、standalone 用 Math.max(1000, x)——server 恆發
// 15000 時兩者輸出相同，但政策分岔會在 server 調整 cadence 時靜默發散，故收斂於此。

export const VIEWER_LEASE_HEARTBEAT_FLOOR_MS = 5_000;
export const VIEWER_LEASE_HEARTBEAT_DEFAULT_MS = 15_000;

/**
 * 由 coordinator 下發的 heartbeat_after_ms 計算實際排程延遲：
 * 非 finite 正數一律回退預設 15000，再套 5000 地板（保護 coordinator 不被過快輪詢）。
 */
export function viewerLeaseHeartbeatDelayMs(heartbeatAfterMs: unknown): number {
  const value = typeof heartbeatAfterMs === "number" && Number.isFinite(heartbeatAfterMs) && heartbeatAfterMs > 0
    ? heartbeatAfterMs
    : VIEWER_LEASE_HEARTBEAT_DEFAULT_MS;
  return Math.max(VIEWER_LEASE_HEARTBEAT_FLOOR_MS, value);
}
