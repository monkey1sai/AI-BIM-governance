// 羅盤 HUD 的相機讀數來源：Kit 沒有連續相機遙測，只能以唯讀 cameraStateRequest 取樣。
// 這裡決定何時取樣（stage 顯示、拖曳中輕量輪詢、放開／滾輪後防抖一次），並保證同時最多一筆在途。
// HUD 的讀取與 console 的 camera 指令分開：request id 用 COMPASS_REQUEST_PREFIX，不經 Viewer Command Channel、
// 不佔用 console 的 camera family，也不回覆父視窗。讀數存在這裡（外部 store），只有羅盤元件訂閱，
// 讀取不會讓整個 Window 重繪。
import { parseCameraState } from "../viewerCommandChannel/camera";
import { headingFromCamera } from "./compassHeading";

export const COMPASS_REQUEST_PREFIX = "hud_cam_";
const SETTLE_MS = 200;
// Kit 對每筆唯讀指令都在主執行緒同步向 coordinator 驗證 trace（逾時 0.3–0.5 s）。拖曳輪詢因此：
// 每筆回覆（或逾時、被拒）後至少隔 DRAG_POLL_MS 才讀下一筆；輪詢遇到在途讀取就跳過，不排隊補讀；
// 單筆讀取超過 SLOW_READ_MS 表示 Kit 或 coordinator 忙，本次拖曳不再輪詢，只在放開後讀一次。
const DRAG_POLL_MS = 500;
const SLOW_READ_MS = 150;
const REPLY_TIMEOUT_MS = 3_000;
// 被拒（多半是 authority 暫時不可用）後先停一段時間，不持續對 Kit 與 coordinator 加壓。
const REFUSAL_BACKOFF_MS = 5_000;

export interface CompassCameraFeedPorts {
  /** 現在可以送 HUD 讀取：DataChannel 就緒、stage 已顯示、console 的 camera 指令沒有在途。 */
  ready(): boolean;
  /** 送出一筆唯讀 cameraStateRequest；false 表示送出管線沒送。 */
  send(requestId: string): boolean;
}

export interface CompassSnapshot {
  /** 相機水平朝向，專案北起順時針度數；null 表示尚未取得。 */
  heading: number | null;
  /** 這個 viewer 送出的 HUD 讀取筆數（不進 DataChannel 診斷紀錄，改在羅盤上照實揭露）。 */
  reads: number;
}

type Timer = ReturnType<typeof setTimeout>;

export function isCompassRequestId(requestId: string): boolean {
  return requestId.startsWith(COMPASS_REQUEST_PREFIX);
}

export class CompassCameraFeed {
  private active = false;
  private inFlight: { id: string; sentAt: number; timer: Timer } | null = null;
  private readAgain = false;
  private settleTimer: Timer | null = null;
  private pollTimer: Timer | null = null;
  private dragging = false;
  private pausedUntil = 0;
  private snapshot: CompassSnapshot = { heading: null, reads: 0 };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly ports: CompassCameraFeedPorts, private readonly nextId: () => string) {}

  /** React useSyncExternalStore 介面。 */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = (): CompassSnapshot => this.snapshot;

  start(): void {
    this.active = true;
  }

  dispose(): void {
    this.active = false;
    if (this.inFlight) clearTimeout(this.inFlight.timer);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.stopPolling();
    this.inFlight = null;
    this.settleTimer = null;
    this.dragging = false;
    this.readAgain = false;
    this.pausedUntil = 0;
  }

  /** 換了 stage 或串流：舊讀數不再代表目前畫面，先回到「方位未取得」。 */
  clearHeading(): void {
    if (this.snapshot.heading !== null) this.publish({ heading: null });
  }

  /** 立刻讀一次；已有一筆在途時，等它結束後再讀一次。 */
  refresh(): void {
    if (!this.active) return;
    if (this.inFlight) {
      this.readAgain = true;
      return;
    }
    this.sendRead();
  }

  /** 使用者操作停下後讀一次（連續事件只讀最後一次）。 */
  settleSoon(): void {
    if (!this.active) return;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.refresh();
    }, SETTLE_MS);
  }

  /** 在串流畫面上按下指標：拖曳期間輕量輪詢，讓羅盤跟著轉。 */
  pointerDown(): void {
    if (!this.active || this.dragging) return;
    this.dragging = true;
    this.schedulePoll();
  }

  /** 任何地方放開指標：結束輪詢並在停下後讀最後一次；不是從串流畫面開始的放開則忽略。 */
  pointerUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.stopPolling();
    this.settleSoon();
  }

  /**
   * 觀察 Kit 結果。所有成功的 cameraStateResult／cameraViewResult 都帶當下相機，直接更新方位；
   * 回傳 true 只代表這是 HUD 自己的讀取（呼叫端不記診斷、不再往 Viewer Command Channel 送）。
   */
  receive(eventType: string, payload: Record<string, unknown>): boolean {
    if (!this.active) return false;
    if (eventType === "cameraStateResult" || eventType === "cameraViewResult") {
      const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
      const own = eventType === "cameraStateResult" && isCompassRequestId(requestId);
      const current = !own || this.inFlight?.id === requestId;
      const camera = payload.result === "success" ? parseCameraState(payload.camera) : null;
      if (current && camera) {
        const heading = headingFromCamera(camera);
        if (heading !== this.snapshot.heading) this.publish({ heading });
      }
      if (own) this.release(requestId);
      return own;
    }
    if (eventType === "cameraFrameResult" || eventType === "resetStageResponse") this.settleSoon();
    return false;
  }

  /** Kit 拒絕了某筆指令；是 HUD 的讀取就釋放名額、暫停一段時間並回 true（不進 review log 或拒絕橫幅）。 */
  reject(requestId: string): boolean {
    if (!isCompassRequestId(requestId)) return false;
    if (this.inFlight?.id === requestId) {
      this.pausedUntil = Date.now() + REFUSAL_BACKOFF_MS;
      this.readAgain = false;
      this.release(requestId);
    }
    return true;
  }

  /** 送出失敗（DataChannel 傳輸錯誤）；是 HUD 的讀取就立刻釋放名額並回 true（不寫 review log）。 */
  fail(requestId: string): boolean {
    if (!isCompassRequestId(requestId)) return false;
    this.release(requestId);
    return true;
  }

  private sendRead(): boolean {
    if (Date.now() < this.pausedUntil || !this.ports.ready()) return false;
    const id = `${COMPASS_REQUEST_PREFIX}${this.nextId()}`;
    this.inFlight = { id, sentAt: Date.now(), timer: setTimeout(() => this.release(id), REPLY_TIMEOUT_MS) };
    let sent = false;
    try {
      sent = this.ports.send(id);
    } catch {
      sent = false;
    }
    if (!sent) {
      this.release(id);
      return false;
    }
    this.publish({ reads: this.snapshot.reads + 1 });
    return true;
  }

  private schedulePoll(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.pollTick();
    }, DRAG_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private pollTick(): void {
    if (!this.active || !this.dragging) return;
    // 有讀取在途就跳過：它結束時會排下一次輪詢，不用 readAgain 排隊補讀。
    if (this.inFlight) return;
    if (!this.sendRead()) this.schedulePoll();
  }

  private release(id: string): void {
    const inFlight = this.inFlight;
    if (!inFlight || inFlight.id !== id) return;
    clearTimeout(inFlight.timer);
    this.inFlight = null;
    if (this.dragging) {
      if (Date.now() - inFlight.sentAt > SLOW_READ_MS) this.stopPolling();
      else this.schedulePoll();
    }
    if (this.readAgain) {
      this.readAgain = false;
      this.refresh();
    }
  }

  private publish(patch: Partial<CompassSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
