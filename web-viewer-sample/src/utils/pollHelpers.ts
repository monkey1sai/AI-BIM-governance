/**
 * pollForSessionReady 重試判定
 *
 * 把「是否還要繼續 poll」抽成純函式,方便單元測試與在 App.tsx 中
 * 以固定上限 (MAX_POLL_RETRIES) 收斂重試,避免無上限輪詢。
 *
 *   retryCount < max → 還可重試 (true)
 *   retryCount >= max → 已達上限,停止 (false)
 */
export function shouldRetryPoll(retryCount: number, max: number): boolean {
    return retryCount < max;
}
