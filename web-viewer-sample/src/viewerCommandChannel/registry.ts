// 每個 viewer 指令在這裡登記一筆：它接受哪個 vg01 訊息、送哪個 Kit 指令、如何把回覆轉回 vg01。
// Kit 結果名稱與是否 mutate 不在這裡寫，由 Kit Command Vocabulary 回答。
import type { StreamMessage } from "../types/streamMessages";
import type { KitCommand } from "../generated/kit-command-vocabulary";
import {
  buildCameraStateRequest, buildCameraViewRequest, buildClipPlaneRequest, buildFlyNavigationRequest,
} from "../clients/streamMessages";
import {
  CorrelatedRuntimeExchange, cameraStateReadback, cameraViewReadback, flyReadback, parseCameraViewInput, parseFlySpeed,
  type CameraState, type ExchangeReply,
} from "../console/cameraViewBridge";
import { MeasurementExchange, type MeasurementAction } from "../console/measurementBridge";
import { parseSectionInput, sectionReadbackMatches, type SectionInput } from "../console/sectionPlaneBridge";
import type { ViewerCommandReply, ViewerCommandType } from "./viewerEmbedProtocol";

export type TerminalOutcome = "success" | "error" | "timed-out" | "superseded";

/** Channel 交給每個指令的能力；是否 claim tracker 由 Channel 依詞彙決定。 */
export interface CommandHost {
  snapshot(): string | null;
  requestId(): string;
  send(message: StreamMessage): boolean;
  complete(requestId: string, outcome: TerminalOutcome): void;
  post(message: ViewerCommandReply): void;
}

export interface AcceptContext {
  canOperate: boolean;
  clientRequestId: string | null;
}

/** 每個指令對 Channel 呈現的內部 interface；形狀不同的實作都收斂在這裡。 */
export interface CommandExchange {
  accept(message: Record<string, unknown>, context: AcceptContext): void;
  receive(payload: Record<string, unknown>): boolean;
  fail(requestId: string, reason: "rejected" | "transport"): void;
  sync(): void;
  dispose(): void;
}

export interface ViewerCommandEntry<E extends CommandExchange = CommandExchange> {
  kitCommand: KitCommand;
  create(host: CommandHost): E;
}

interface CorrelatedSpec<I, V> {
  input(message: Record<string, unknown>): unknown;
  parse(value: unknown): I | null;
  readback(input: I, payload: Record<string, unknown>): V | null;
  build(input: I, requestId: string): StreamMessage;
  reply(reply: ExchangeReply<V>): ViewerCommandReply;
  /** 不能操作時直接回 unavailable，而不是讓 console 等到逾時。 */
  reportInoperable?: boolean;
}

function correlated<I, V>(host: CommandHost, spec: CorrelatedSpec<I, V>): CommandExchange {
  const exchange = new CorrelatedRuntimeExchange<I, V>({
    parse: spec.parse,
    readback: spec.readback,
    snapshot: () => host.snapshot(),
    requestId: () => host.requestId(),
    send: (input, requestId) => host.send(spec.build(input, requestId)),
    complete: (requestId, outcome) => host.complete(requestId, outcome),
    notify: reply => host.post(spec.reply(reply)),
  });
  return {
    accept(message, { canOperate, clientRequestId }) {
      if (!clientRequestId) return;
      if (!canOperate) {
        if (spec.reportInoperable) host.post(spec.reply({ status: "error", reason: "unavailable", clientRequestId }));
        return;
      }
      exchange.start(spec.input(message), clientRequestId);
    },
    receive: payload => exchange.receive(payload),
    fail: (requestId, reason) => exchange.fail(requestId, reason),
    sync: () => exchange.sync(),
    dispose: () => exchange.dispose(),
  };
}

function cameraReply(type: "camera_view_result" | "camera_state_result") {
  return ({ value, ...rest }: ExchangeReply<CameraState>): ViewerCommandReply =>
    ({ type, ...rest, ...(value ? { camera: value } : {}) });
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const MEASUREMENT_ACTIONS: readonly MeasurementAction[] = ["start", "cancel", "clear"];

/** 量測是有狀態的會話，而非一問一答；Window 需要讀它的輸入攔截狀態與送出選點。 */
export interface MeasurementCommand extends CommandExchange {
  readonly exchange: MeasurementExchange;
}

export const VIEWER_COMMANDS = {
  camera_view: {
    kitCommand: "cameraViewRequest",
    create: host => correlated(host, {
      input: message => message.camera,
      parse: parseCameraViewInput,
      readback: cameraViewReadback,
      build: buildCameraViewRequest,
      reply: cameraReply("camera_view_result"),
    }),
  },
  camera_state: {
    kitCommand: "cameraStateRequest",
    create: host => correlated<true, CameraState>(host, {
      input: () => true,
      parse: value => (value === true ? true : null),
      readback: (_input, payload) => cameraStateReadback(null, payload),
      build: (_input, requestId) => buildCameraStateRequest(requestId),
      reply: cameraReply("camera_state_result"),
      reportInoperable: true,
    }),
  },
  fly_navigation: {
    kitCommand: "flyNavigationRequest",
    create: host => correlated(host, {
      input: message => message.speed,
      parse: parseFlySpeed,
      readback: flyReadback,
      build: buildFlyNavigationRequest,
      reply: ({ value, ...rest }) => ({ type: "fly_navigation_result", ...rest, ...(value !== undefined ? { speed: value } : {}) }),
    }),
  },
  section_plane: {
    kitCommand: "clipPlaneRequest",
    create: host => correlated<SectionInput, SectionInput>(host, {
      input: message => message.section,
      parse: parseSectionInput,
      readback: (input, payload) => (sectionReadbackMatches(input, payload) ? input : null),
      build: (input, requestId) => {
        const normal: [number, number, number] = [0, 0, 0];
        normal[AXIS_INDEX[input.axis]] = input.direction;
        return buildClipPlaneRequest({ ...input, normal, requestId });
      },
      // 關閉剖切不把草稿座標當成生效設定回報。
      reply: ({ value, status, ...rest }) => (status === "applied" && value && !value.enabled
        ? { type: "section_result", status: "off", ...rest }
        : { type: "section_result", status, ...rest, ...(status === "applied" && value ? { effective: value } : {}) }),
    }),
  },
  measurement_control: {
    kitCommand: "measurementRequest",
    create: (host): MeasurementCommand => {
      const exchange = new MeasurementExchange({
        snapshot: () => host.snapshot(),
        requestId: () => host.requestId(),
        send: payload => host.send({ event_type: "measurementRequest", payload }),
        complete: (requestId, outcome) => host.complete(requestId, outcome),
        notify: state => host.post({ type: "measurement_state", ...state }),
      });
      return {
        exchange,
        accept(message, { canOperate }) {
          const action = message.action as MeasurementAction;
          if (!MEASUREMENT_ACTIONS.includes(action) || (action === "start" && !canOperate)) return;
          exchange.control(action);
        },
        receive: payload => exchange.receive(payload),
        fail: (requestId, reason) => exchange.fail(requestId, reason),
        sync: () => exchange.sync(),
        dispose: () => exchange.dispose(),
      };
    },
  },
} satisfies { [T in ViewerCommandType]: ViewerCommandEntry };
