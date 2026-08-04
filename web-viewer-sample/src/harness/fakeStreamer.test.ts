import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamMessage } from "../types/streamMessages";
import { FakeAppStreamer } from "./fakeStreamer";
import { HARNESS_REVIEW_AUTHORITY } from "./fixtures/reviewAuthority";

type FakeKitControl = {
  stallNextStageLoad(): void;
  failStalledStageLoadChangedFailed(): void;
};

function streamProps(onStart: (message: unknown) => void, onCustomEvent: (message: unknown) => void) {
  return {
    streamConfig: {
      onStart,
      onCustomEvent,
      onStreamStats: vi.fn(),
    },
  };
}

function focusRequest(requestId: string): StreamMessage {
  return {
    event_type: "focusPrimRequest",
    payload: {
      session_id: HARNESS_REVIEW_AUTHORITY.sessionId,
      trace_id: HARNESS_REVIEW_AUTHORITY.traceId,
      request_id: requestId,
      prim_path: "/World/Door",
    },
  };
}

function openStageRequest(requestId: string, url: string): StreamMessage {
  return {
    event_type: "openStageRequest",
    payload: {
      session_id: HARNESS_REVIEW_AUTHORITY.sessionId,
      trace_id: HARNESS_REVIEW_AUTHORITY.traceId,
      request_id: requestId,
      url,
    },
  };
}

describe("FakeAppStreamer connection generations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAppStreamer.terminate();
  });

  afterEach(() => {
    FakeAppStreamer.terminate();
    vi.useRealTimers();
  });

  it("cancels pending start and Kit callbacks on terminate", async () => {
    const onStart = vi.fn();
    const onCustomEvent = vi.fn();
    await FakeAppStreamer.connect(streamProps(onStart, onCustomEvent));
    await FakeAppStreamer.sendMessage(focusRequest("request_old_terminate"));

    FakeAppStreamer.terminate();
    await vi.runAllTimersAsync();

    expect(onStart).not.toHaveBeenCalled();
    expect(onCustomEvent).not.toHaveBeenCalled();
  });

  it("does not replay an old connection terminal after reconnect", async () => {
    const firstStart = vi.fn();
    const firstEvent = vi.fn();
    const secondStart = vi.fn();
    const secondEvent = vi.fn();
    await FakeAppStreamer.connect(streamProps(firstStart, firstEvent));
    await FakeAppStreamer.sendMessage(focusRequest("request_old_generation"));

    await FakeAppStreamer.connect(streamProps(secondStart, secondEvent));
    await vi.runAllTimersAsync();

    expect(firstStart).not.toHaveBeenCalled();
    expect(firstEvent).not.toHaveBeenCalled();
    expect(secondStart).toHaveBeenCalledTimes(1);
    expect(secondEvent).not.toHaveBeenCalled();

    await FakeAppStreamer.sendMessage(focusRequest("request_current_generation"));
    await vi.runAllTimersAsync();

    expect(secondEvent).toHaveBeenCalledTimes(1);
    expect(secondEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "focusPrimResult",
      payload: expect.objectContaining({
        request_id: "request_current_generation",
        trace_id: HARNESS_REVIEW_AUTHORITY.traceId,
      }),
    }));
  });

  it("keeps a replacement stage request stalled while failing the older request", async () => {
    const onStart = vi.fn();
    const onCustomEvent = vi.fn();
    await FakeAppStreamer.connect(streamProps(onStart, onCustomEvent));
    const control = (globalThis as typeof globalThis & { __AI_BIM_FAKE_KIT__?: FakeKitControl })
      .__AI_BIM_FAKE_KIT__;
    if (!control) throw new Error("FakeKit control is unavailable");

    control.stallNextStageLoad();
    const first = FakeAppStreamer.sendMessage(openStageRequest("request_a", "harness://stage/a.usd"));
    control.stallNextStageLoad();
    const replacement = FakeAppStreamer.sendMessage(openStageRequest("request_b", "harness://stage/b.usd"));

    control.failStalledStageLoadChangedFailed();
    await vi.runAllTimersAsync();

    await expect(first).resolves.toBeNull();
    expect(onCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "openedStageResult",
      payload: expect.objectContaining({
        request_id: "request_a",
        runtime_state: "changed_failed",
      }),
    }));

    let replacementSettled = false;
    void replacement.then(() => { replacementSettled = true; });
    await Promise.resolve();
    expect(replacementSettled).toBe(false);

    FakeAppStreamer.terminate();
    await expect(replacement).resolves.toBeNull();
  });
});
