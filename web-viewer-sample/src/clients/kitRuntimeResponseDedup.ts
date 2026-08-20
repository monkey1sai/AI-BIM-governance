// #624 exactly-once 緩解（client 端，不依賴根因結論）。
//
// 背景：Kit runtime 回應目前經 `ezplus.bim_review_stream.messaging/client_send_bridge.py`
// 的雙路徑橋接送出（上游 register + legacy message bus push）。實測併發下 client 端曾對
// 同一個 request_id 收到兩則相同的 `commandRejected`——重複發生在 bridge 送出之後、
// AppStream 的 onCustomEvent 之前，因此既無法在 Kit 端修掉，也不該讓每個下游 handler
// 各自長一套防重邏輯。本模組把「時窗內同一 (event_type, request_id) 只放行一次」
// 收斂成單一純狀態機，由 AppStream._onCustomEvent（三種 stream source 共用的咽喉點）呼叫。
//
// 政策邊界（刻意保守，寧可漏擋不可誤殺）：
//   - 只有帶 request_id 的訊息進入去重。request_id 是送出端產生的 correlation id
//     （見 clients/streamMessages.ts 的 buildHighlightPrimsRequest / buildFocusPrimRequest
//     與 Window.tsx 對 runtime mutator 的自動編號），協定上同一個 request_id 的同型別
//     回應恰好一則。
//   - 沒有 request_id 的事件（stageSelectionChanged、updateProgressActivity、
//     未帶 correlation 的 loadingStateResponse 輪詢…）一律放行，不做任何判斷。
//   - 本模組不 throw；無法辨識形狀時回 null，等同放行。

/**
 * LRU 容量上限。取 Window.tsx `runtimeCommandContexts` 上限（128）的兩倍，
 * 讓去重記憶必然活得比它所保護的 correlation context 久，同時把最壞記憶體
 * 固定在數百個短字串。
 */
export const KIT_RUNTIME_RESPONSE_DEDUP_CAPACITY = 256;

/**
 * 去重時窗（ms）。必須長於 client 端最長的 runtime 指令逾時
 * （Window.tsx `STAGE_LOAD_TIMEOUT_MS` = 45_000），遲到的重複才不會在該次指令
 * 仍可能被觀測時漏擋；又不宜再長，避免 request_id 生命週期早已退場後仍佔用去重記憶。
 */
export const KIT_RUNTIME_RESPONSE_DEDUP_WINDOW_MS = 60_000;

/** 咽喉點看到的原始 custom event 形狀（AppStream.tsx 的 AppStreamCustomEvent 的結構子集）。 */
export type KitCustomEventLike = {
  event_type?: unknown;
  messageRecipient?: unknown;
  data?: unknown;
  payload?: unknown;
} | null | undefined;

export interface KitRuntimeResponseIdentity {
  eventType: string;
  requestId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "";
}

/**
 * 由咽喉點事件抽出 (event_type, request_id)。回 null 代表「不參與去重、直接放行」：
 * 事件為空、非 Kit 事件形狀、缺 event_type、payload 非物件，或 payload 未帶 request_id。
 *
 * 同時處理 streaming library 的包裝形狀（messageRecipient 為 "kit" 且 data 是 JSON 字串），
 * 與 Window.tsx `_handleCustomEvent` 的解包條件逐字對齊，避免兩層對「同一則事件」
 * 的認定分岔。
 */
export function readKitRuntimeResponseIdentity(
  message: KitCustomEventLike,
): KitRuntimeResponseIdentity | null {
  if (!isRecord(message)) return null;

  let eventType = nonEmptyString(message.event_type);
  let payload = message.payload;

  if (!eventType && message.messageRecipient === "kit" && typeof message.data === "string") {
    try {
      const parsed: unknown = JSON.parse(message.data);
      if (isRecord(parsed)) {
        eventType = nonEmptyString(parsed.event_type);
        payload = isRecord(parsed.payload) ? parsed.payload : payload;
      }
    } catch {
      // 形狀不明的入站訊息交由下游既有邏輯處理，去重不介入。
      return null;
    }
  }

  if (!eventType || !isRecord(payload)) return null;

  const requestId = nonEmptyString(payload.request_id);
  if (!requestId) return null;

  return { eventType, requestId };
}

function dedupKey(identity: KitRuntimeResponseIdentity): string {
  // 用 JSON 陣列序列化組合鍵：兩個欄位都是送出端給的自由字串，
  // 任何字面分隔符都可能被內容本身撞號，JSON 轉義則天然無歧義。
  return JSON.stringify([identity.eventType, identity.requestId]);
}

export interface KitRuntimeResponseDeduperOptions {
  capacity?: number;
  windowMs?: number;
  /** 可注入的時鐘，僅供測試；正式路徑一律 Date.now。 */
  now?: () => number;
}

/**
 * (event_type, request_id) 的短時窗 LRU 去重器。
 *
 * 時窗自「首次放行」起算，重複命中不會延長時窗；命中僅更新 LRU 順位，
 * 讓仍在被重複轟炸的鍵不會先被容量淘汰掉。
 */
export class KitRuntimeResponseDeduper {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  /** key 對應「首次放行」的時間戳（ms）。Map 迭代順序即 LRU 順序（最舊在前）。 */
  private readonly seen = new Map<string, number>();

  constructor(options: KitRuntimeResponseDeduperOptions = {}) {
    this.capacity = options.capacity ?? KIT_RUNTIME_RESPONSE_DEDUP_CAPACITY;
    this.windowMs = options.windowMs ?? KIT_RUNTIME_RESPONSE_DEDUP_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * @returns true 代表首見、應放行；false 代表時窗內重複、應丟棄。
   */
  admit(identity: KitRuntimeResponseIdentity): boolean {
    const now = this.now();
    this.evictExpired(now);

    const key = dedupKey(identity);
    const firstSeenAt = this.seen.get(key);
    if (firstSeenAt !== undefined) {
      this.seen.delete(key);
      this.seen.set(key, firstSeenAt);
      return false;
    }

    this.seen.set(key, now);
    this.evictOverflow();
    return true;
  }

  /** 目前記憶中的鍵數，僅供測試與診斷。 */
  size(): number {
    return this.seen.size;
  }

  private evictExpired(now: number): void {
    // 容量上限 256，全掃成本可忽略；LRU 重排後插入序不再等於時間序，故不做提前 break。
    for (const [key, firstSeenAt] of this.seen) {
      if (now - firstSeenAt >= this.windowMs) this.seen.delete(key);
    }
  }

  private evictOverflow(): void {
    while (this.seen.size > this.capacity) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }
}
