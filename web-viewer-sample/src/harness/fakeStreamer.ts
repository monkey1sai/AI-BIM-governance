// 可決定性的 AppStreamer 替身：介面對齊 @nvidia/omniverse-webrtc-streaming-library 的
// AppStreamer.{connect,sendMessage,terminate,resize}。只換掉 transport + 假 Kit 大腦，
// 不碰前端狀態機（Window/hooks/builders/handlers 照跑）。harness 模式下由 streamer.ts 選用。
import type { StreamMessage } from "../types/streamMessages";
import {
  computeFakeKitResponse,
  createFakeKitState,
  queueFakeKitRejection,
  type FakeKitRejection,
  type FakeKitState,
} from "./fakeKit";

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
let sentEventTypes: string[] = [];

function scheduleEmit(events: StreamMessage[]): void {
  const callback = captured.onCustomEvent;
  if (!callback || events.length === 0) return;
  events.forEach((event) => {
    setTimeout(() => {
      if (event.event_type === "focusPrimResult") {
        const payload = event.payload && typeof event.payload === "object"
          ? event.payload as Record<string, unknown>
          : {};
        if (payload.result === "success" && typeof payload.prim_path === "string") {
          updateViewportLabel(`focus: ${payload.prim_path}`);
        }
      }
      callback(event);
    }, 0);
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
    sentEventTypes = [];
    connected = true;
    (globalThis as typeof globalThis & {
      __AI_BIM_FAKE_KIT__?: {
        rejectNext: (rejection: FakeKitRejection) => void;
        eventTypes: () => string[];
      };
    }).__AI_BIM_FAKE_KIT__ = {
      rejectNext: (rejection) => queueFakeKitRejection(kit, rejection),
      // Test probe intentionally exposes event types only. Payloads may carry
      // ephemeral authority and therefore never cross this harness boundary.
      eventTypes: () => [...sentEventTypes],
    };
    // 下一 tick 觸發 stream start success → AppStream.setState(streamReady) → props.onStarted()。
    setTimeout(() => {
      captured.onStart?.({ action: "start", status: "success", info: "harness" });
      updateViewportLabel("stream ready (deterministic harness)");
    }, 0);
    return Promise.resolve({ status: "success", info: "harness-connect" });
  },

  sendMessage(message: StreamMessage): Promise<unknown> {
    if (!connected) return Promise.resolve(null);
    sentEventTypes.push(message.event_type);
    const { result, asyncEvents } = computeFakeKitResponse(message, kit);
    if (message.event_type === "openStageRequest" && result?.status === "success") {
      updateViewportLabel(`stage: ${kit.currentStageUrl ?? ""}`);
    }
    scheduleEmit(asyncEvents);
    return Promise.resolve(result);
  },

  terminate(): void {
    connected = false;
    captured = {};
    delete (globalThis as typeof globalThis & {
      __AI_BIM_FAKE_KIT__?: {
        rejectNext: (rejection: FakeKitRejection) => void;
        eventTypes: () => string[];
      };
    }).__AI_BIM_FAKE_KIT__;
    sentEventTypes = [];
  },

  resize(): Promise<void> {
    return Promise.resolve();
  },
};
