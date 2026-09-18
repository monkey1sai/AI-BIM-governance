// Viewer Command Channel 的 iframe 端：把 vg01 指令轉成 Kit 指令，並把 Kit 結果、拒絕與傳輸失敗
// 路由回對應的 vg01 回覆。送出管線（mutator 阻擋、lease 蓋章、tracker 註冊）仍屬 Window。
import type { StreamMessage } from "../types/streamMessages";
import type { MeasurementExchange } from "./measurement";
import { isRuntimeMutator } from "../viewer/core/runtimeCommandProtocol";
import { isKitResultForCommand } from "../viewer/core/runtimeEventCatalog";
import { VIEWER_COMMANDS, type CommandExchange, type TerminalOutcome } from "./registry";
import type { ViewerCommandReply, ViewerCommandType } from "./viewerEmbedProtocol";

export interface KitSidePorts {
  /** 目前可操作狀態的指紋；變動即讓進行中與已確認的回覆失效。null 表示不能送。 */
  snapshot(): string | null;
  requestId(): string;
  /** Window 的送出管線；false 表示被阻擋或尚未就緒。 */
  send(message: StreamMessage): boolean;
  /** Runtime command tracker 已比對到這個 mutator 結果。 */
  correlate(eventType: string, payload: Record<string, unknown>): boolean;
  claimTerminal(requestId: string, command: string, outcome: TerminalOutcome): void;
  post(message: ViewerCommandReply): void;
}

export interface ParentMessageContext {
  /** 訊息來自直接嵌入本 viewer 的父視窗。 */
  fromParent: boolean;
  canOperate: boolean;
}

export interface ViewerCommandKitSide {
  /** 屬於 Channel 的 vg01 指令回傳 true（即使因閘門被丟棄），其餘交回呼叫端。 */
  acceptParentMessage(message: unknown, context: ParentMessageContext): boolean;
  /** 回傳 true 表示結果已由 Channel 處理。 */
  receiveKitEvent(eventType: string, payload: Record<string, unknown>): boolean;
  rejectCommand(command: string, requestId: string): void;
  failTransport(command: string, requestId: string): void;
  sync(): void;
  dispose(): void;
  readonly measurement: MeasurementExchange;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function clientRequestIdOf(message: Record<string, unknown>): string | null {
  const id = message.clientRequestId;
  return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

export function createViewerCommandKitSide(ports: KitSidePorts): ViewerCommandKitSide {
  const hostFor = (command: string) => {
    const mutates = isRuntimeMutator(command);
    return {
      snapshot: () => ports.snapshot(),
      requestId: () => ports.requestId(),
      send: (message: StreamMessage) => ports.send(message),
      // 唯讀指令不經 tracker 登記，所以也不 claim。
      complete: (requestId: string, outcome: TerminalOutcome) => {
        if (mutates) ports.claimTerminal(requestId, command, outcome);
      },
      post: (message: ViewerCommandReply) => ports.post(message),
    };
  };
  const measurement = VIEWER_COMMANDS.measurement_control.create(hostFor(VIEWER_COMMANDS.measurement_control.kitCommand));
  const exchanges = new Map<ViewerCommandType, { kitCommand: string; exchange: CommandExchange }>();
  for (const [type, entry] of Object.entries(VIEWER_COMMANDS) as [ViewerCommandType, (typeof VIEWER_COMMANDS)[ViewerCommandType]][]) {
    const exchange = type === "measurement_control" ? measurement : entry.create(hostFor(entry.kitCommand));
    exchanges.set(type, { kitCommand: entry.kitCommand, exchange });
  }
  const byKitCommand = (command: string) => [...exchanges.values()].find(entry => entry.kitCommand === command)?.exchange;

  return {
    acceptParentMessage(message, { fromParent, canOperate }) {
      if (!record(message)) return false;
      const target = exchanges.get(message.type as ViewerCommandType);
      if (!target) return false;
      if (fromParent) target.exchange.accept(message, { canOperate, clientRequestId: clientRequestIdOf(message) });
      return true;
    },
    receiveKitEvent(eventType, payload) {
      for (const { kitCommand, exchange } of exchanges.values()) {
        if (!isKitResultForCommand(eventType, kitCommand)) continue;
        if (isRuntimeMutator(kitCommand) && !ports.correlate(eventType, payload)) return false;
        return exchange.receive(payload);
      }
      return false;
    },
    rejectCommand(command, requestId) {
      byKitCommand(command)?.fail(requestId, "rejected");
    },
    failTransport(command, requestId) {
      byKitCommand(command)?.fail(requestId, "transport");
    },
    sync() {
      for (const { exchange } of exchanges.values()) exchange.sync();
    },
    dispose() {
      for (const { exchange } of exchanges.values()) exchange.dispose();
    },
    measurement: measurement.exchange,
  };
}
