import { describe, expect, it, vi } from "vitest";
import { RuntimeCommandTracker } from "./runtimeCommandTracker";

function fixture() {
    const events: Array<{ requestId: string; eventType: string; outcome: string; pendingAtNotification: boolean }> = [];
    const log = vi.fn();
    const tracker = new RuntimeCommandTracker({
        appendReviewEvent: log,
        recordTerminal: (requestId, eventType, outcome) => events.push({
            requestId, eventType, outcome, pendingAtNotification: tracker.hasContext(requestId),
        }),
    });
    return { tracker, events, log };
}

describe("RuntimeCommandTracker", () => {
    it("rejects reused identities without replacing pending or terminal context", () => {
        const f = fixture();
        expect(f.tracker.register("", { eventType: "focusPrimRequest" })).toBe(false);
        expect(f.tracker.register("a", { eventType: "focusPrimRequest" })).toBe(true);
        expect(f.tracker.register("a", { eventType: "highlightPrimsRequest" })).toBe(false);
        expect(f.tracker.getContext("a")).toEqual({ eventType: "focusPrimRequest" });
        f.tracker._claimRuntimeCommandTerminal("a", "focusPrimRequest", "success");
        expect(f.tracker.register("a", { eventType: "highlightPrimsRequest" })).toBe(false);
        expect(f.tracker.pendingCount).toBe(0);
        expect(f.tracker.terminalCount).toBe(1);
    });

    it("correlates request, event and revision without treating acceptance as completion", () => {
        const f = fixture();
        f.tracker.register("a", { eventType: "openStageRequest", bindingRevisionId: "r1", stageUrl: "/a" });
        expect(f.tracker._correlateRuntimeCommandEvent("openedStageResult", {}).disposition).toBe("uncorrelated");
        expect(f.tracker._correlateRuntimeCommandEvent("openedStageResult", { request_id: "other" }).disposition).toBe("untracked");
        expect(f.tracker._correlateRuntimeCommandEvent("focusPrimResult", { request_id: "a", binding_revision_id: "r1" }).mismatchReason).toBe("event_type");
        expect(f.tracker._correlateRuntimeCommandEvent("openedStageResult", { request_id: "a", binding_revision_id: "r2" }).mismatchReason).toBe("binding_revision");
        expect(f.tracker._correlateRuntimeCommandEvent("openedStageResult", { request_id: "a", binding_revision_id: "r1", result: "accepted" }).disposition).toBe("matched");
        expect(f.tracker.hasContext("a")).toBe(true);
        expect(f.events).toEqual([]);
    });

    it("claims the first terminal once and retains safety metadata before deleting pending", () => {
        const f = fixture();
        const context = { eventType: "openStageRequest", bindingRevisionId: "r1", stageUrl: "/a", stageAttemptGeneration: 7 };
        f.tracker.register("a", context);
        expect(f.tracker._completeRuntimeCommandEvent("openedStageResult", { request_id: "a", binding_revision_id: "r1" }, "success").disposition).toBe("matched");
        expect(f.events).toEqual([{ requestId: "a", eventType: "openStageRequest", outcome: "success", pendingAtNotification: true }]);
        expect(f.tracker.hasContext("a")).toBe(false);
        expect(f.tracker.getSafetyContext("a")).toEqual(context);
        expect(f.tracker._completeRuntimeCommandEvent("openedStageResult", { request_id: "a", binding_revision_id: "r1" }, "error").disposition).toBe("duplicate");
        expect(f.tracker.getTerminal("a")).toEqual({ eventType: "openStageRequest", outcome: "success" });
        expect(f.events).toHaveLength(1);
    });

    it("does not complete an event or revision mismatch", () => {
        const f = fixture();
        f.tracker.register("a", { eventType: "focusPrimRequest", bindingRevisionId: "r1" });
        expect(f.tracker._completeRuntimeCommandEvent("highlightPrimsResult", { request_id: "a", binding_revision_id: "r1" }, "error").disposition).toBe("mismatch");
        expect(f.tracker._completeRuntimeCommandEvent("focusPrimResult", { request_id: "a", binding_revision_id: "wrong" }, "error").disposition).toBe("mismatch");
        expect(f.tracker.hasContext("a")).toBe(true);
        expect(f.events).toEqual([]);
    });

    it("attaches only matching unassigned stage commands including falsy generation zero", () => {
        const f = fixture();
        f.tracker.register("open", { eventType: "openStageRequest", stageUrl: "/a" });
        f.tracker.register("group", { eventType: "loadArtifactGroupRequest", stageUrl: "/a", stageAttemptGeneration: 0 });
        f.tracker.register("assigned", { eventType: "openStageRequest", stageUrl: "/a", stageAttemptGeneration: 2 });
        f.tracker.register("other", { eventType: "openStageRequest", stageUrl: "/b" });
        f.tracker.register("focus", { eventType: "focusPrimRequest", stageUrl: "/a" });
        f.tracker.attachStageAttempt("/a", 3);
        expect(f.tracker.getContext("open")?.stageAttemptGeneration).toBe(3);
        expect(f.tracker.getContext("group")?.stageAttemptGeneration).toBe(3);
        expect(f.tracker.getContext("assigned")?.stageAttemptGeneration).toBe(2);
        expect(f.tracker.getContext("other")?.stageAttemptGeneration).toBeUndefined();
        expect(f.tracker.getContext("focus")?.stageAttemptGeneration).toBeUndefined();
    });

    it("claims one attempt then all remaining commands in insertion order", () => {
        const f = fixture();
        f.tracker.register("a", { eventType: "openStageRequest", stageAttemptGeneration: 1 });
        f.tracker.register("b", { eventType: "openStageRequest", stageAttemptGeneration: 2 });
        f.tracker.register("c", { eventType: "focusPrimRequest" });
        f.tracker.claimAttempt(1, "timed-out");
        expect(f.events.map(e => e.requestId)).toEqual(["a"]);
        expect(f.tracker.hasContext("b")).toBe(true);
        f.tracker.claimAll("superseded");
        expect(f.events.map(e => [e.requestId, e.outcome])).toEqual([["a", "timed-out"], ["b", "superseded"], ["c", "superseded"]]);
        expect(f.tracker.pendingCount).toBe(0);
    });

    it("evicts only the oldest pending entry at the 128-entry boundary", () => {
        const f = fixture();
        for (let n = 0; n < 129; n++) f.tracker.register(String(n), { eventType: "focusPrimRequest" });
        expect(f.tracker.pendingCount).toBe(128);
        expect(f.tracker.hasContext("0")).toBe(false);
        expect(f.tracker.hasContext("1")).toBe(true);
        expect(f.tracker.hasContext("128")).toBe(true);
        expect(f.events).toEqual([]);
        expect(f.tracker.terminalCount).toBe(0);
    });

    it("evicts terminal claim and safety snapshot together without replacing terminal shape", () => {
        const f = fixture();
        for (let n = 0; n < 129; n++) {
            f.tracker.register(String(n), { eventType: "openStageRequest", stageUrl: "/"+n });
            f.tracker._claimRuntimeCommandTerminal(String(n), "openStageRequest", "superseded");
        }
        expect(f.tracker.terminalCount).toBe(128);
        expect(f.tracker.getTerminal("0")).toBeUndefined();
        expect(f.tracker.getSafetyContext("0")).toBeUndefined();
        expect(f.tracker.getTerminal("1")).toEqual({ eventType: "openStageRequest", outcome: "superseded" });
        expect(f.tracker.getSafetyContext("128")?.stageUrl).toBe("/128");
        expect(f.tracker.register("0", { eventType: "focusPrimRequest" })).toBe(true);
    });

    it("does not expose mutable map ownership through registration or snapshot getters", () => {
        const f = fixture();
        const context = { eventType: "openStageRequest", stageUrl: "/a" };
        f.tracker.register("a", context);
        context.stageUrl = "/changed";
        const snapshot = f.tracker.getContext("a")!;
        (snapshot as { stageUrl: string }).stageUrl = "/changed-again";
        expect(f.tracker.getContext("a")?.stageUrl).toBe("/a");
        f.tracker._claimRuntimeCommandTerminal("a", "openStageRequest", "success");
        const safety = f.tracker.getSafetyContext("a")!;
        (safety as { stageUrl: string }).stageUrl = "/bad";
        const terminal = f.tracker.getTerminal("a")!;
        (terminal as { outcome: string }).outcome = "error";
        expect(f.tracker.getSafetyContext("a")?.stageUrl).toBe("/a");
        expect(f.tracker.getTerminal("a")?.outcome).toBe("success");
    });

    it("deletes an active context without inventing a terminal and isolates instances", () => {
        const a = fixture(), b = fixture();
        a.tracker.register("same", { eventType: "focusPrimRequest" });
        b.tracker.register("same", { eventType: "focusPrimRequest" });
        a.tracker.deleteContext("same");
        expect(a.tracker.hasContext("same")).toBe(false);
        expect(a.tracker.getTerminal("same")).toBeUndefined();
        expect(a.events).toEqual([]);
        expect(b.tracker.hasContext("same")).toBe(true);
        expect(b.tracker._claimRuntimeCommandTerminal("missing", "focusPrimRequest", "error")).toBe(true);
        expect(b.tracker.getSafetyContext("missing")).toBeUndefined();
        expect(b.tracker._claimRuntimeCommandTerminal("", "focusPrimRequest", "error")).toBe(false);
    });
});
