// 羅盤 HUD 的相機讀數來源：Kit 沒有連續相機遙測，只能以唯讀 cameraStateRequest 取樣。
// 這裡決定何時取樣（stage 顯示、拖曳中輕量輪詢、放開／滾輪後防抖一次），並保證同時最多一筆在途。
// HUD 的讀取與 console 的 camera 指令分開：request id 用 COMPASS_REQUEST_PREFIX，不經 Viewer Command Channel、
// 不佔用 console 的 camera family，也不回覆父視窗。
import { parseCameraState } from "../viewerCommandChannel/camera";
import { headingFromCamera } from "./compassHeading";

export const COMPASS_REQUEST_PREFIX = "hud_cam_";
const SETTLE_MS = 200;
const DRAG_POLL_MS = 250;
const REPLY_TIMEOUT_MS = 3_000;
// Kit 對每筆唯讀指令都同步向 coordinator 驗證 trace；被拒（多半是 authority 暫時不可用）後先停一段時間，
// 不在拖曳輪詢中持續對 Kit 與 coordinator 加壓。
const REFUSAL_BACKOFF_MS = 5_000;

export interface CompassCameraFeedPorts {
  /** 現在可以送 HUD 讀取：DataChannel 就緒、stage 已顯示、console 的 camera 指令沒有在途。 */
  ready(): boolean;
  /** 送出一筆唯讀 cameraStateRequest；false 表示送出管線沒送。 */
  send(requestId: string): boolean;
  heading(value: number | null): void;
}

type Timer = ReturnType<typeof setTimeout>;

export class CompassCameraFeed {
  private active = false;
  private inFlight: { id: string; timer: Timer } | null = null;
  private readAgain = false;
  private settleTimer: Timer | null = null;
  private dragPoll: ReturnType<typeof setInterval> | null = null;
  private pausedUntil = 0;

  constructor(private readonly ports: CompassCameraFeedPorts, private readonly nextId: () => string) {}

  start(): void {
    this.active = true;
  }

  dispose(): void {
    this.active = false;
    if (this.inFlight) clearTimeout(this.inFlight.timer);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    if (this.dragPoll !== null) clearInterval(this.dragPoll);
    this.inFlight = null;
    this.settleTimer = null;
    this.dragPoll = null;
    this.readAgain = false;
    this.pausedUntil = 0;
  }

  /** 立刻讀一次；已有一筆在途時，等它結束後再讀一次。 */
  refresh(): void {
    if (!this.active) return;
    if (this.inFlight) {
      this.readAgain = true;
      return;
    }
    if (Date.now() < this.pausedUntil || !this.ports.ready()) return;
    const id = `${COMPASS_REQUEST_PREFIX}${this.nextId()}`;
    this.inFlight = { id, timer: setTimeout(() => this.release(id), REPLY_TIMEOUT_MS) };
    let sent = false;
    try {
      sent = this.ports.send(id);
    } catch {
      sent = false;
    }
    if (!sent) this.release(id);
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
    if (!this.active || this.dragPoll !== null) return;
    this.dragPoll = setInterval(() => this.refresh(), DRAG_POLL_MS);
  }

  /** 任何地方放開指標：結束輪詢並在停下後讀最後一次；不是從串流畫面開始的放開則忽略。 */
  pointerUp(): void {
    if (this.dragPoll === null) return;
    clearInterval(this.dragPoll);
    this.dragPoll = null;
    this.settleSoon();
  }

  /**
   * 觀察 Kit 結果。所有成功的 cameraStateResult／cameraViewResult 都帶當下相機，直接更新方位；
   * 回傳 true 只代表這是 HUD 自己的讀取（呼叫端不再往 Viewer Command Channel 送）。
   */
  receive(eventType: string, payload: Record<string, unknown>): boolean {
    if (!this.active) return false;
    if (eventType === "cameraStateResult" || eventType === "cameraViewResult") {
      const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
      const own = eventType === "cameraStateResult" && requestId.startsWith(COMPASS_REQUEST_PREFIX);
      const current = !own || this.inFlight?.id === requestId;
      const camera = payload.result === "success" ? parseCameraState(payload.camera) : null;
      if (current && camera) this.ports.heading(headingFromCamera(camera));
      if (own) this.release(requestId);
      return own;
    }
    if (eventType === "cameraFrameResult" || eventType === "resetStageResponse") this.settleSoon();
    return false;
  }

  /** Kit 拒絕了某筆指令；是 HUD 的讀取就釋放名額、暫停一段時間並回 true（不進 review log 或拒絕橫幅）。 */
  reject(requestId: string): boolean {
    if (!requestId.startsWith(COMPASS_REQUEST_PREFIX)) return false;
    if (this.inFlight?.id === requestId) {
      this.pausedUntil = Date.now() + REFUSAL_BACKOFF_MS;
      this.readAgain = false;
      this.release(requestId);
    }
    return true;
  }

  private release(id: string): void {
    const inFlight = this.inFlight;
    if (!inFlight || inFlight.id !== id) return;
    clearTimeout(inFlight.timer);
    this.inFlight = null;
    if (this.readAgain) {
      this.readAgain = false;
      this.refresh();
    }
  }
}
