import { describe, expect, it, vi } from "vitest";
import type {
  ReviewSocketAck,
  ReviewSocketCandidate,
  ReviewSocketEvent,
} from "../clients/reviewSocket";
import {
  connectHarnessReviewSocket,
  HARNESS_REVIEW_AUTHORITY_REJECTED,
} from "./fakeReviewSocket";
import {
  HARNESS_SESSION_ID,
  HARNESS_TRACE_ID,
} from "./fixtures/reviewAuthority";

const candidate = (
  overrides: Partial<ReviewSocketCandidate> = {},
): ReviewSocketCandidate => ({
  sessionId: HARNESS_SESSION_ID,
  traceId: HARNESS_TRACE_ID,
  userId: "harness_user",
  displayName: "Harness User",
  ...overrides,
});

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
};

describe("connectHarnessReviewSocket", () => {
  it("acknowledges only the fixed tuple and does so asynchronously", async () => {
    const onStatus = vi.fn();
    const onAck = vi.fn();
    const client = connectHarnessReviewSocket({ onStatus, onAck });
    const exact = candidate();

    client.join(exact);
    expect(onStatus).not.toHaveBeenCalled();
    expect(onAck).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(onStatus).toHaveBeenCalledWith("connected");
    expect(onAck).toHaveBeenCalledWith("joinSession", exact, {
      ok: true,
      session_id: HARNESS_SESSION_ID,
      trace_id: HARNESS_TRACE_ID,
    });
  });

  it.each([
    ["session", { sessionId: `${HARNESS_SESSION_ID}_other` }],
    ["trace", { traceId: HARNESS_TRACE_ID.toUpperCase() }],
  ])("rejects a %s mismatch without echoing any trace", async (_label, overrides) => {
    const acknowledgements: Array<{
      event: ReviewSocketEvent;
      candidate: ReviewSocketCandidate;
      ack: ReviewSocketAck;
    }> = [];
    const client = connectHarnessReviewSocket({
      onAck: (event, acknowledgedCandidate, ack) => {
        acknowledgements.push({ event, candidate: acknowledgedCandidate, ack });
      },
    });

    client.join(candidate(overrides));
    await flushMicrotasks();

    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0].ack).toEqual({
      ok: false,
      error: HARNESS_REVIEW_AUTHORITY_REJECTED,
    });
    expect("trace_id" in acknowledgements[0].ack).toBe(false);
  });

  it("a newer join generation cancels a pending acknowledgement", async () => {
    const onAck = vi.fn();
    const client = connectHarnessReviewSocket({ onAck });

    client.join(candidate());
    client.join(candidate({ traceId: HARNESS_TRACE_ID.toUpperCase() }));
    await flushMicrotasks();

    expect(onAck).toHaveBeenCalledTimes(1);
    expect(onAck.mock.calls[0][2]).toEqual({
      ok: false,
      error: HARNESS_REVIEW_AUTHORITY_REJECTED,
    });
  });

  it("disconnect cancels a pending join and reports only async disconnected status", async () => {
    const onStatus = vi.fn();
    const onAck = vi.fn();
    const client = connectHarnessReviewSocket({ onStatus, onAck });

    client.join(candidate());
    client.disconnect();
    expect(onStatus).not.toHaveBeenCalled();
    await flushMicrotasks();

    expect(onAck).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("disconnected");
  });

  it("heartbeat cannot establish authority and leave clears the joined candidate", async () => {
    const onAck = vi.fn();
    const client = connectHarnessReviewSocket({ onAck });

    client.heartbeat();
    await flushMicrotasks();
    expect(onAck).not.toHaveBeenCalled();

    client.join(candidate());
    await flushMicrotasks();
    expect(onAck).toHaveBeenLastCalledWith(
      "joinSession",
      candidate(),
      expect.objectContaining({ ok: true, trace_id: HARNESS_TRACE_ID }),
    );

    client.heartbeat();
    await flushMicrotasks();
    expect(onAck).toHaveBeenLastCalledWith(
      "heartbeat",
      candidate(),
      expect.objectContaining({ ok: true, trace_id: HARNESS_TRACE_ID }),
    );

    client.leave();
    await flushMicrotasks();
    expect(onAck).toHaveBeenLastCalledWith(
      "leaveSession",
      candidate(),
      expect.objectContaining({ ok: true, trace_id: HARNESS_TRACE_ID }),
    );
    const callsAfterLeave = onAck.mock.calls.length;
    client.heartbeat();
    await flushMicrotasks();
    expect(onAck).toHaveBeenCalledTimes(callsAfterLeave);
  });

  it("acknowledges stream readiness only for the joined harness authority", async () => {
    const onAck = vi.fn();
    const client = connectHarnessReviewSocket({ onAck });

    client.setStreamReady(true);
    await flushMicrotasks();
    expect(onAck).not.toHaveBeenCalled();

    client.join(candidate());
    await flushMicrotasks();
    client.setStreamReady(true);
    await flushMicrotasks();

    expect(onAck).toHaveBeenLastCalledWith(
      "streamReadiness",
      candidate(),
      expect.objectContaining({ ok: true, trace_id: HARNESS_TRACE_ID }),
    );
  });
});
