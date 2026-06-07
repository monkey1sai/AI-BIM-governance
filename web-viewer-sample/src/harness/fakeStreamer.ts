// 可決定性的 AppStreamer 替身：介面對齊 @nvidia/omniverse-webrtc-streaming-library 的
// AppStreamer.{connect,sendMessage,terminate,resize}。只換掉 transport + 假 Kit 大腦，
// 不碰前端狀態機（Window/hooks/builders/handlers 照跑）。harness 模式下由 streamer.ts 選用。
import type { StreamMessage } from "../types/streamMessages";
import { computeFakeKitResponse, createFakeKitState, type FakeKitState } from "./fakeKit";

type EventCallback = (message: unknown) => void;

interface CapturedCallbacks {
  onStart?: (message: unknown) => void;
  onCustomEvent?: EventCallback;
  onStreamStats?: EventCallback;
}

// 模組級單例（鏡像真實 AppStreamer 的全域 singleton 性質）。
let captured: CapturedCallbacks = {};
let kit: FakeKitState = createFakeKitState();
let connected = false;

function scheduleEmit(events: StreamMessage[]): void {
  const callback = captured.onCustomEvent;
  if (!callback || events.length === 0) return;
  events.forEach((event) => {
    setTimeout(() => callback(event), 0);
  });
}

function updateViewportLabel(text: string): void {
  if (typeof document === "undefined") return;
  const element = document.getElementById("harness-viewport-label");
  if (element) element.textContent = `HARNESS VIEWPORT — ${text}`;
}

export const FakeAppStreamer = {
  connect(streamProps: unknown): Promise<unknown> {
    const config = ((streamProps as { streamConfig?: Record<string, unknown> })?.streamConfig ?? {}) as Record<
      string,
      unknown
    >;
    captured = {
      onStart: config.onStart as CapturedCallbacks["onStart"],
      onCustomEvent: config.onCustomEvent as EventCallback,
      onStreamStats: config.onStreamStats as EventCallback,
    };
    kit = createFakeKitState();
    connected = true;
    // 下一 tick 觸發 stream start success → AppStream.setState(streamReady) → props.onStarted()。
    setTimeout(() => {
      captured.onStart?.({ action: "start", status: "success", info: "harness" });
      updateViewportLabel("stream ready (deterministic harness)");
    }, 0);
    return Promise.resolve({ status: "success", info: "harness-connect" });
  },

  sendMessage(message: StreamMessage): Promise<unknown> {
    if (!connected) return Promise.resolve(null);
    const { result, asyncEvents } = computeFakeKitResponse(message, kit);
    if (message.event_type === "openStageRequest") {
      updateViewportLabel(`stage: ${kit.currentStageUrl ?? ""}`);
    } else if (message.event_type === "focusPrimRequest") {
      const primPath = (message.payload as { prim_path?: string })?.prim_path ?? "";
      updateViewportLabel(`focus: ${primPath}`);
    }
    scheduleEmit(asyncEvents);
    return Promise.resolve(result);
  },

  terminate(_flag?: boolean): void {
    connected = false;
    captured = {};
  },

  resize(_width: number, _height: number): Promise<void> {
    return Promise.resolve();
  },
};
