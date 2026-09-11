import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeStageDispatchQueue, type NativeOpenStageDispatch } from "./nativeStageDispatchQueue";
import type { StreamMessage } from "../../types/streamMessages";

function fixture() {
    const state = { stream: 1, attempt: 1, target: "/a", awaiting: true, sendAllowed: true };
    const sent: NativeOpenStageDispatch[] = [];
    const failures: Array<{ requestId: string; diagnostic: string }> = [];
    const logs: string[] = [];
    const queue = new NativeStageDispatchQueue({
        getStreamGeneration: () => state.stream,
        getActiveStageAttempt: () => ({ generation: state.attempt, targetUrl: state.target }),
        isCurrentStageAttemptAwaitingProof: generation => generation === state.attempt && state.awaiting,
        failNativeOpenStageDispatch: (dispatch, diagnostic) => failures.push({ requestId: dispatch.requestId, diagnostic }),
        appendReviewEvent: event => logs.push(event),
        sendStreamMessage: (_outgoing, dispatch) => {
            sent.push(dispatch);
            return state.sendAllowed;
        },
    }, 45_001);
    const message = (id: string, group = false): StreamMessage => ({
        event_type: group ? "loadArtifactGroupRequest" : "openStageRequest",
        payload: { request_id: id, url: state.target, ...(group ? { binding_revision_id: "revision-1" } : {}) },
    });
    return { state, sent, failures, logs, queue, message };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("NativeStageDispatchQueue", () => {
    it("sends one native request and releases only the latest queued intent", () => {
        const f = fixture();
        expect(f.queue._enqueueNativeOpenStage(f.message("a"))).toBe(true);
        f.state.attempt = 2; f.state.target = "/b";
        expect(f.queue._enqueueNativeOpenStage(f.message("b"))).toBe(true);
        f.state.attempt = 3; f.state.target = "/c";
        expect(f.queue._enqueueNativeOpenStage(f.message("c"))).toBe(true);
        expect(f.sent.map(d => d.requestId)).toEqual(["a"]);
        f.queue._settleNativeOpenStageDispatch(f.sent[0]);
        expect(f.sent.map(d => d.requestId)).toEqual(["a", "c"]);
        f.queue._settleNativeOpenStageDispatch(f.sent[0]);
        expect(f.sent.map(d => d.requestId)).toEqual(["a", "c"]);
        f.queue._retireNativeOpenStageDispatches();
    });

    it("keeps exact dispatch marker and callback identity at the sole send boundary", () => {
        const f = fixture();
        const callback = vi.fn();
        const outgoing = f.message("a");
        f.queue._enqueueNativeOpenStage(outgoing, callback);
        expect(f.sent[0].outgoing).toBe(outgoing);
        expect(f.sent[0].onDispatched).toBe(callback);
        expect(f.queue._isCurrentNativeOpenStageDispatch(f.sent[0])).toBe(true);
        expect(callback).not.toHaveBeenCalled();
        f.queue._retireNativeOpenStageDispatches();
    });

    it("rejects missing request identity or group binding without dispatching", () => {
        const f = fixture();
        expect(f.queue._enqueueNativeOpenStage({ event_type: "openStageRequest", payload: {} })).toBe(false);
        expect(f.queue._enqueueNativeOpenStage({ event_type: "loadArtifactGroupRequest", payload: { request_id: "g" } })).toBe(false);
        expect(f.sent).toEqual([]);
    });

    it("waits for an exact DataChannel terminal and never settles on accepted or mismatched proof", () => {
        const f = fixture();
        f.queue._enqueueNativeOpenStage(f.message("g", true));
        const slot = f.sent[0];
        const terminal = { request_id: "g", binding_revision_id: "revision-1", result: "success" };
        expect(f.queue._matchingNativeOpenStageDataChannelTerminal("openedStageResult", { ...terminal, result: "accepted" })).toBeNull();
        expect(f.queue._matchingNativeOpenStageDataChannelTerminal("openedStageResult", { ...terminal, request_id: "old" })).toBeNull();
        expect(f.queue._matchingNativeOpenStageDataChannelTerminal("openedStageResult", { ...terminal, binding_revision_id: "other" })).toBeNull();
        expect(f.queue._matchingNativeOpenStageDataChannelTerminal("loadArtifactGroupResult", terminal)).toBeNull();
        expect(f.queue._matchingNativeOpenStageDataChannelTerminal("commandRejected", { request_id: "g", rejected_event_type: "openStageRequest" })).toBeNull();
        expect(f.queue._matchingNativeOpenStageDataChannelTerminal("commandRejected", { request_id: "g", rejected_event_type: "loadArtifactGroupRequest" })).toBe(slot);
        expect(f.queue._settleNativeOpenStageDispatchFromDataChannel("openedStageResult", terminal)).toBe(slot);
        expect(f.queue._isCurrentNativeOpenStageDispatch(slot)).toBe(false);
        f.queue._retireNativeOpenStageDispatches();
    });

    it("ignores retired callbacks without releasing a replacement slot", () => {
        const f = fixture();
        f.queue._enqueueNativeOpenStage(f.message("old"));
        const old = f.sent[0];
        f.state.stream += 1;
        f.queue.fenceReplacement();
        expect(f.queue._enqueueNativeOpenStage(f.message("blocked"))).toBe(false);
        expect(f.queue.acceptStarted(f.state.stream)).toBe(true);
        f.queue._enqueueNativeOpenStage(f.message("new"));
        const current = f.sent[1];
        f.queue._settleNativeOpenStageDispatch(old);
        expect(f.queue._isCurrentNativeOpenStageDispatch(current)).toBe(true);
        f.queue._retireNativeOpenStageDispatches();
    });

    it("poisons at 45001ms, fails the latest intent, and recovers only through replacement start", () => {
        vi.useFakeTimers();
        const f = fixture();
        f.queue._enqueueNativeOpenStage(f.message("a"));
        f.state.attempt = 2; f.state.target = "/b";
        f.queue._enqueueNativeOpenStage(f.message("b"));
        vi.advanceTimersByTime(45_000);
        expect(f.failures).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(f.failures).toEqual([{ requestId: "b", diagnostic: "sdk_open_stage_slot_stuck; reconnect stream before retry" }]);
        expect(f.queue.acceptStarted(f.state.stream)).toBe(false);
        expect(f.queue._enqueueNativeOpenStage(f.message("retry"))).toBe(false);
        f.state.stream += 1;
        f.queue.fenceReplacement();
        expect(f.queue._enqueueNativeOpenStage(f.message("before-start"))).toBe(false);
        expect(f.queue.acceptStarted(f.state.stream)).toBe(true);
        expect(f.queue._enqueueNativeOpenStage(f.message("after-start"))).toBe(true);
        f.queue._retireNativeOpenStageDispatches();
    });

    it("keeps a stopped generation fenced and clears retired watchdog timers", () => {
        vi.useFakeTimers();
        const f = fixture();
        f.queue._enqueueNativeOpenStage(f.message("a"));
        f.state.stream += 1;
        f.queue.fenceStopped();
        expect(f.queue.acceptStarted(f.state.stream)).toBe(false);
        expect(f.queue._enqueueNativeOpenStage(f.message("retry"))).toBe(false);
        vi.advanceTimersByTime(50_000);
        expect(f.failures).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("drops only the superseded queued attempt and preserves the in-flight slot", () => {
        const f = fixture();
        f.queue._enqueueNativeOpenStage(f.message("a"));
        const active = f.sent[0];
        f.state.attempt = 2; f.state.target = "/b";
        f.queue._enqueueNativeOpenStage(f.message("b"));
        f.queue.dropQueuedAttempt(1);
        f.queue._settleNativeOpenStageDispatch(active);
        expect(f.sent.map(d => d.requestId)).toEqual(["a", "b"]);
        f.state.attempt = 3; f.state.target = "/c";
        f.queue._enqueueNativeOpenStage(f.message("c"));
        f.queue.dropQueuedAttempt(3);
        f.queue._settleNativeOpenStageDispatch(f.sent[1]);
        expect(f.sent.map(d => d.requestId)).toEqual(["a", "b"]);
        f.queue._retireNativeOpenStageDispatches();
    });

    it("preserves falsy-generation invalidation and retires all pending timers", () => {
        vi.useFakeTimers();
        const f = fixture();
        f.queue._enqueueNativeOpenStage(f.message("a"));
        f.state.attempt = 2; f.state.target = "/b";
        f.queue._enqueueNativeOpenStage(f.message("b"));
        f.queue.invalidateQueuedAttempt(undefined);
        f.queue._settleNativeOpenStageDispatch(f.sent[0]);
        expect(f.sent.map(d => d.requestId)).toEqual(["a"]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("clears a synchronously blocked send and does not hold the next valid request", () => {
        const f = fixture();
        f.state.sendAllowed = false;
        expect(f.queue._enqueueNativeOpenStage(f.message("blocked"))).toBe(false);
        f.state.sendAllowed = true;
        expect(f.queue._enqueueNativeOpenStage(f.message("allowed"))).toBe(true);
        expect(f.sent.map(d => d.requestId)).toEqual(["blocked", "allowed"]);
        f.queue._retireNativeOpenStageDispatches();
    });

    it("keeps separate Window queue instances isolated", () => {
        const a = fixture();
        const b = fixture();
        a.queue._enqueueNativeOpenStage(a.message("a"));
        b.queue._enqueueNativeOpenStage(b.message("b"));
        a.queue._retireNativeOpenStageDispatches();
        expect(b.queue._isCurrentNativeOpenStageDispatch(b.sent[0])).toBe(true);
        expect(b.sent.map(d => d.requestId)).toEqual(["b"]);
        b.queue._retireNativeOpenStageDispatches();
    });
});
