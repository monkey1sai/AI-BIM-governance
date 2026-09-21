// Viewer Command Channel 的 console 端：發出 vg01 指令，並以 clientRequestId 把 viewer 回覆對回請求。
// 同一 family 同時只允許一筆；viewer 廣播的 unconfirmed（無 clientRequestId）讓所有進行中的請求一起失效。
import { PendingReply } from "./camera";
import { parseMeasurementState, type MeasurementAction, type MeasurementState } from "./measurement";
import {
  VIEWER_COMMAND_REQUESTS, type CorrelatedViewerCommand, type ViewerCommandInputs, type ViewerCommandReplies,
} from "./registry";
import type { ViewerCommandRequest } from "./viewerEmbedProtocol";

export interface ViewerCommandPort {
  send<C extends CorrelatedViewerCommand>(command: C, input: ViewerCommandInputs[C]): Promise<ViewerCommandReplies[C]>;
  /** 量測是會話：回傳 false 表示沒有送出（動作無效或 viewer 尚未就緒）。 */
  controlMeasurement(action: MeasurementAction): boolean;
}

export interface ParentSidePorts {
  /** viewer 已回報 viewer_ready，且 iframe 仍在。 */
  ready(): boolean;
  /** 送出失敗時丟出例外，回覆會是 transport。 */
  post(message: ViewerCommandRequest): void;
  newId(): string;
  /** viewer 宣告已確認的結果失效（stage、lease 或連線改變）。 */
  onInvalidated(): void;
  onMeasurementState(state: MeasurementState): void;
}

export interface ViewerCommandParentSide {
  readonly port: ViewerCommandPort;
  /** 屬於 Channel 的 viewer 訊息回傳 true，其餘交回呼叫端。 */
  acceptViewerMessage(message: Record<string, unknown>): boolean;
  /** 讓所有進行中的請求以 unconfirmed 結束（iframe 重新載入、卸載）。 */
  cancel(): void;
}

type AnyReply = ViewerCommandReplies[CorrelatedViewerCommand];
const MEASUREMENT_ACTIONS: readonly MeasurementAction[] = ["start", "cancel", "clear"];
const error = <C extends CorrelatedViewerCommand>(reason: "invalid" | "unavailable" | "busy" | "transport") =>
  ({ status: "error", reason }) as ViewerCommandReplies[C];

const COMMANDS = Object.keys(VIEWER_COMMAND_REQUESTS) as CorrelatedViewerCommand[];

export function createViewerCommandParentSide(ports: ParentSidePorts): ViewerCommandParentSide {
  const families = new Map<string, PendingReply<AnyReply>>();
  for (const command of COMMANDS) {
    const { family } = VIEWER_COMMAND_REQUESTS[command];
    if (!families.has(family)) {
      families.set(family, new PendingReply<AnyReply>({ status: "error", reason: "timeout" }, { status: "unconfirmed" }));
    }
  }
  const cancel = () => { for (const pending of families.values()) pending.cancel(); };

  const port: ViewerCommandPort = {
    send(command, input) {
      const entry = VIEWER_COMMAND_REQUESTS[command];
      if (!entry.validate(input)) return Promise.resolve(error("invalid"));
      if (!ports.ready()) return Promise.resolve(error("unavailable"));
      const pending = families.get(entry.family)!;
      if (pending.busy) return Promise.resolve(error("busy"));
      const id = ports.newId();
      return pending.start(id, () => ports.post(entry.request(input, id)), error("transport")) as Promise<ViewerCommandReplies[typeof command]>;
    },
    controlMeasurement(action) {
      if (!MEASUREMENT_ACTIONS.includes(action) || !ports.ready()) return false;
      ports.post({ type: "measurement_control", action });
      return true;
    },
  };

  return {
    port,
    acceptViewerMessage(message) {
      if (message.type === "measurement_state") {
        const state = parseMeasurementState(message);
        if (state) ports.onMeasurementState(state);
        return true;
      }
      const command = COMMANDS.find(name => VIEWER_COMMAND_REQUESTS[name].replyType === message.type);
      if (!command) return false;
      const entry = VIEWER_COMMAND_REQUESTS[command];
      const reply = entry.parseReply(message);
      if (!reply) return true;
      if (reply.status === "unconfirmed" && !reply.clientRequestId) {
        cancel();
        ports.onInvalidated();
        return true;
      }
      families.get(entry.family)!.settle(reply);
      return true;
    },
    cancel,
  };
}

const UNAVAILABLE = { status: "error", reason: "unavailable" } as const;

/**
 * 經過其他層轉交的 port：目標不在或被擋住時回 unavailable。
 * 擋住時仍允許取消與清除量測，只擋開始。
 */
export function forwardViewerCommandPort(
  target: () => ViewerCommandPort | null | undefined,
  blocked: () => boolean = () => false,
): ViewerCommandPort {
  return {
    send(command, input) {
      const port = blocked() ? null : target();
      return port ? port.send(command, input) : Promise.resolve(UNAVAILABLE as ViewerCommandReplies[typeof command]);
    },
    controlMeasurement(action) {
      if (action === "start" && blocked()) return false;
      return target()?.controlMeasurement(action) ?? false;
    },
  };
}
