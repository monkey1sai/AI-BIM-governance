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
import { HARNESS_REVIEW_AUTHORITY } from "./fixtures/reviewAuthority";

type EventCallback = (message: unknown) => void;

interface CapturedCallbacks {
  onStart?: (message: unknown) => void;
  onCustomEvent?: EventCallback;
  onStreamStats?: EventCallback;
}

// 模組級單例（鏡像真實 AppStreamer 的全域 singleton 性質）。
let captured: CapturedCallbacks = {};
let kit: FakeKitState = createFakeKitState(HARNESS_REVIEW_AUTHORITY);
let connected = false;
let sentEventTypes: string[] = [];
let connectionGeneration = 0;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function clearPendingTimers(): void {
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
}

function scheduleForGeneration(generation: number, action: () => void): void {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    if (!connected || connectionGeneration !== generation) return;
    action();
  }, 0);
  pendingTimers.add(timer);
}

function scheduleEmit(
  events: StreamMessage[],
  generation: number,
  callback: EventCallback | undefined,
): void {
  if (!callback || events.length === 0) return;
  events.forEach((event) => {
    scheduleForGeneration(generation, () => {
      if (event.event_type === "focusPrimResult") {
        const payload = event.payload && typeof event.payload === "object"
          ? event.payload as Record<string, unknown>
          : {};
        if (payload.result === "success" && typeof payload.prim_path === "string") {
          updateViewportLabel(`focus: ${payload.prim_path}`);
        }
      }
      callback(event);
    });
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
    connectionGeneration += 1;
    clearPendingTimers();
    const generation = connectionGeneration;
    const callbacks: CapturedCallbacks = {
      onStart: config.onStart as CapturedCallbacks["onStart"],
      onCustomEvent: config.onCustomEvent as EventCallback,
      onStreamStats: config.onStreamStats as EventCallback,
    };
    captured = callbacks;
    kit = createFakeKitState(HARNESS_REVIEW_AUTHORITY);
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
    scheduleForGeneration(generation, () => {
      callbacks.onStart?.({ action: "start", status: "success", info: "harness" });
      updateViewportLabel("stream ready (deterministic harness)");
    });
    return Promise.resolve({ status: "success", info: "harness-connect" });
  },

  sendMessage(message: StreamMessage): Promise<unknown> {
    if (!connected) return Promise.resolve(null);
    const generation = connectionGeneration;
    const callback = captured.onCustomEvent;
    sentEventTypes.push(message.event_type);
    const { result, asyncEvents } = computeFakeKitResponse(message, kit);
    if (message.event_type === "openStageRequest" && result?.status === "success") {
      updateViewportLabel(`stage: ${kit.currentStageUrl ?? ""}`);
    }
    scheduleEmit(asyncEvents, generation, callback);
    return Promise.resolve(result);
  },

  terminate(): void {
    connectionGeneration += 1;
    connected = false;
    clearPendingTimers();
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
