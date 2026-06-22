// VG-01：viewer 端 parent postMessage 守衛純函式（可單測，與 Window.tsx 行為共用）。
// 跨 origin 安全：僅接受 iframe 內、來自白名單 origin、且帶協定版本 vg01 的訊息。
export function shouldAcceptParentMessage(
  e: MessageEvent,
  allowedOrigins: ReadonlySet<string>,
  isEmbedded: boolean,
): boolean {
  if (!isEmbedded) return false; // 僅 iframe 內（window.parent !== window）
  if (!allowedOrigins.has(e.origin)) return false; // origin 白名單（VITE_ALLOWED_COORDINATOR_ORIGINS）
  const m = e.data as { protocol?: string } | null;
  return Boolean(m && m.protocol === "vg01"); // 協定版本
}

// M2：spectator / 未就緒（canOperate=false）一律不處理 highlight（守 spectator 邊界，誠實鐵律）。
export function canHandleHighlight(canOperate: boolean): boolean {
  return canOperate;
}

// S3：嵌入 console iframe 時，viewer 內 GovernanceOverlay 僅作高亮引擎，失敗清單由 parent 工作台顯示（唯一權威清單）。
// 嵌入時餵空陣列使其落入「目前無治理失敗構件」分支收合；非嵌入時原樣透傳（既有單機行為零變更）。
export function failedElementsForEmbed<T>(failedElements: T[], isEmbedded: boolean): T[] {
  return isEmbedded ? [] : failedElements;
}
