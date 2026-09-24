// Stage Binding Execution, tracer bullet 1: begin, supersede, timeout, cancel
// barrier, proof block and resync against fake ports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStageBindingExecution } from "./execution";
import {
    STAGE_LOAD_TIMEOUT_MS,
    type StageAttempt,
    type StageBindingArtifactRef,
    type StageBindingExecution,
    type StageBindingExecutionPorts,
    type StageBindingState,
    type StageProofResyncProjection,
} from "./types";
import type { ViewerCredentials } from "../clients/viewerCredentials";
import type { StageBindingPreauthorization, StageBindingRevisions } from "../coordinatorClient";

const ARTIFACTS: StageBindingArtifactRef[] = [{ artifact_id: "a_1", role: "primary", load_order: 0 }];

const CREDENTIALS: ViewerCredentials = {
    userToken: "user_1",
    leaseId: "lease_1",
    leaseToken: "lease_token_1",
    leaseDetails: null,
    sourceClientId: "lease_1",
    epoch: 1,
    loss: null,
};

const PREAUTHORIZATION = { binding_revision_id: "rev_1" } as unknown as StageBindingPreauthorization;

interface Harness {
    execution: StageBindingExecution;
    calls: string[];
    states: StageBindingState[];
    attempt: StageAttempt | null;
    intent: number;
    loadedStageUrl: string | null;
    expectedStageUrl: string | null;
    session: string | null;
    credentials: ViewerCredentials;
    revisions: StageBindingRevisions;
    revisionsError: Error | null;
    resyncProjections: StageProofResyncProjection[];
    preauthorize: (clientRequestId: string, signal: AbortSignal) => Promise<StageBindingPreauthorization>;
    cancel: (clientRequestId: string) => Promise<boolean>;
    preauthorizeCalls: Array<{ clientRequestId: string; signal: AbortSignal }>;
    cancelCalls: string[];
    armedTimers: number[];
    clearedTimers: number[];
}

function harness(): Harness {
    const h: Partial<Harness> & { calls: string[]; states: StageBindingState[] } = {
        calls: [],
        states: [],
        attempt: null,
        intent: 0,
        loadedStageUrl: null,
        expectedStageUrl: null,
        session: "session_1",
        credentials: CREDENTIALS,
        revisions: { active: null, lastGood: null },
        revisionsError: null,
        resyncProjections: [],
        preauthorizeCalls: [],
        cancelCalls: [],
        armedTimers: [],
        clearedTimers: [],
    };
    const self = h as Harness;
    self.preauthorize = () => Promise.resolve(PREAUTHORIZATION);
    self.cancel = () => Promise.resolve(true);

    const ports: StageBindingExecutionPorts = {
        coordinator: {
            preauthorize: (_artifacts, clientRequestId, signal) => {
                self.calls.push(`coordinator.preauthorize:${clientRequestId}`);
                self.preauthorizeCalls.push({ clientRequestId, signal });
                return self.preauthorize(clientRequestId, signal);
            },
            cancel: (clientRequestId) => {
                self.calls.push(`coordinator.cancel:${clientRequestId}`);
                self.cancelCalls.push(clientRequestId);
                return self.cancel(clientRequestId);
            },
            revisions: (sessionId, userToken) => {
                self.calls.push(`coordinator.revisions:${sessionId}:${userToken}`);
                return self.revisionsError ? Promise.reject(self.revisionsError) : Promise.resolve(self.revisions);
            },
        },
        session: () => self.session,
        credentials: () => self.credentials,
        tracker: {
            attachStageAttempt: (stageUrl, generation) => {
                self.calls.push(`tracker.attach:${stageUrl ?? "null"}:${generation}`);
            },
            claimAttempt: (generation, outcome) => {
                self.calls.push(`tracker.claim:${generation}:${outcome}`);
            },
        },
        nativeQueue: {
            dropQueuedAttempt: (generation) => { self.calls.push(`queue.drop:${generation ?? "null"}`); },
            invalidateQueuedAttempt: (generation) => { self.calls.push(`queue.invalidate:${generation ?? "null"}`); },
        },
        timers: {
            setTimeout: (handler, timeoutMs) => {
                const handle = globalThis.setTimeout(handler, timeoutMs) as unknown as number;
                self.armedTimers.push(handle);
                return handle;
            },
            clearTimeout: (handle) => { self.clearedTimers.push(handle); globalThis.clearTimeout(handle); },
        },
        attempt: {
            current: () => self.attempt,
            replace: (attempt) => { self.attempt = attempt; },
            advanceIntent: () => { self.intent += 1; self.calls.push("attempt.advanceIntent"); },
        },
        view: {
            loadedStageUrl: () => self.loadedStageUrl,
            isLoadedStageExpected: (loadedUrl) => Boolean(self.expectedStageUrl) && loadedUrl === self.expectedStageUrl,
            finishLoad: (generation, preserveFirstFrame) => {
                self.calls.push(`view.finishLoad:${generation ?? "null"}:${preserveFirstFrame}`);
                // Window's `_finishStageLoad` guards on the current attempt and then calls
                // back into the module; mirror that so deadline clearing is exercised.
                if (generation && !self.execution.isCurrentAttempt(generation)) return;
                self.execution.finishLoad();
            },
            attemptBegun: () => { self.calls.push("view.attemptBegun"); },
            stageLoadFailureCleared: () => { self.calls.push("view.stageLoadFailureCleared"); },
            proofRevoked: (bindingRevisionId) => { self.calls.push(`view.proofRevoked:${bindingRevisionId ?? "none"}`); },
            bindingApplySuperseded: () => { self.calls.push("view.bindingApplySuperseded"); },
            proofBlocked: () => { self.calls.push("view.proofBlocked"); },
            stageLoadTimedOut: (targetUrl) => { self.calls.push(`view.stageLoadTimedOut:${targetUrl}`); },
            proofResynced: (projection) => {
                self.calls.push(`view.proofResynced:${projection.revision}:${projection.matched}:${projection.completeAttemptGeneration ?? "null"}`);
                self.resyncProjections.push(projection);
            },
        },
        onState: (state) => { self.states.push(state); },
    };
    self.execution = createStageBindingExecution(ports);
    return self;
}

/** Start an attempt and drop the bookkeeping calls it emits. */
function begun(h: Harness, targetUrl = "s3://stage/a.usdc"): number {
    const generation = h.execution.beginAttempt(targetUrl);
    h.execution.pendingStageUrl = targetUrl;
    h.calls.length = 0;
    return generation;
}

const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("Stage Binding Execution: attempt lifecycle", () => {
    it("begin advances the intent, supersedes nothing on a first attempt and hands back generation 1", () => {
        const h = harness();
        const generation = h.execution.beginAttempt("s3://stage/a.usdc");

        expect(generation).toBe(1);
        expect(h.attempt).toEqual({ generation: 1, status: "pending", targetUrl: "s3://stage/a.usdc" });
        expect(h.intent).toBe(1);
        expect(h.calls).toEqual(["view.bindingApplySuperseded", "attempt.advanceIntent", "view.attemptBegun"]);
        expect(h.execution.attemptGeneration).toBe(1);
    });

    it("begin supersedes the attempt awaiting proof before it starts the next one", () => {
        const h = harness();
        begun(h, "s3://stage/a.usdc");

        const second = h.execution.beginAttempt("s3://stage/b.usdc");

        expect(second).toBe(2);
        expect(h.calls).toEqual([
            "view.bindingApplySuperseded",
            "attempt.advanceIntent",
            "view.finishLoad:1:false",
            "tracker.claim:1:superseded",
            "queue.drop:1",
            "view.proofRevoked:none",
            "view.attemptBegun",
        ]);
        expect(h.attempt).toEqual({ generation: 2, status: "pending", targetUrl: "s3://stage/b.usdc" });
    });

    it.each<[string, StageAttempt["status"], boolean]>([
        ["pending", "pending", true],
        ["provisional", "provisional", true],
        ["completed", "completed", false],
        ["terminal", "terminal", false],
    ])("supersede terminalizes a %s attempt only while it awaits proof", (_label, status, terminalized) => {
        const h = harness();
        begun(h);
        h.attempt!.status = status;

        h.execution.supersedeAttempt();

        expect(h.calls.includes("view.finishLoad:1:false")).toBe(terminalized);
        expect(h.calls.includes("tracker.claim:1:superseded")).toBe(terminalized);
        expect(h.calls).toContain("queue.drop:1");
        expect(h.calls).toContain("view.proofRevoked:none");
        expect(h.attempt).toBeNull();
    });

    it("supersede with no attempt does nothing", () => {
        const h = harness();
        h.execution.supersedeAttempt();
        expect(h.calls).toEqual([]);
    });

    it("invalidate fences the generation so a later same-generation result is stale", () => {
        const h = harness();
        begun(h);

        h.execution.invalidateAttempt();

        expect(h.calls).toEqual([
            "view.bindingApplySuperseded",
            "attempt.advanceIntent",
            "queue.invalidate:1",
            "view.proofRevoked:none",
            "view.finishLoad:1:false",
            "tracker.claim:1:superseded",
            "view.stageLoadFailureCleared",
        ]);
        expect(h.attempt).toBeNull();
        expect(h.execution.attemptGeneration).toBe(2);
        expect(h.execution.isCurrentAttempt(1)).toBe(false);
    });

    it("invalidate without an attempt still advances the intent and clears the visible failure", () => {
        const h = harness();
        h.execution.invalidateAttempt();
        expect(h.calls).toEqual([
            "view.bindingApplySuperseded",
            "attempt.advanceIntent",
            "queue.invalidate:null",
            "view.proofRevoked:none",
            "view.stageLoadFailureCleared",
        ]);
        expect(h.execution.attemptGeneration).toBe(0);
    });

    it("terminalize revokes a completed attempt's proof without touching a newer attempt", () => {
        const h = harness();
        const first = begun(h);
        h.attempt!.status = "completed";

        h.execution.terminalizeAttempt(first, "rev_1");

        expect(h.calls).toEqual(["view.proofRevoked:rev_1"]);
        expect(h.attempt!.status).toBe("completed");
    });

    it("terminalize ignores a generation that is not the current attempt", () => {
        const h = harness();
        begun(h);
        h.execution.terminalizeAttempt(99, "rev_1");
        expect(h.calls).toEqual([]);
    });

    it("terminalize finishes and revokes an attempt awaiting proof", () => {
        const h = harness();
        const generation = begun(h);

        h.execution.terminalizeAttempt(generation, "rev_1");

        expect(h.attempt!.status).toBe("terminal");
        expect(h.calls).toEqual(["view.finishLoad:1:false", "view.proofRevoked:rev_1"]);
    });
});

describe("Stage Binding Execution: the 45 s stage-load deadline", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("arms the deadline against the tracker and fails the attempt when it expires", () => {
        const h = harness();
        const generation = begun(h);

        h.execution.scheduleLoadTimeout(generation);
        expect(h.calls).toEqual(["tracker.attach:s3://stage/a.usdc:1"]);

        vi.advanceTimersByTime(STAGE_LOAD_TIMEOUT_MS);

        expect(h.attempt!.terminalReason).toBe("stage-load-timeout");
        expect(h.calls).toEqual([
            "tracker.attach:s3://stage/a.usdc:1",
            "tracker.claim:1:timed-out",
            "view.stageLoadTimedOut:s3://stage/a.usdc",
        ]);
    });

    it.each<[string, (h: Harness, generation: number) => void]>([
        ["the attempt was superseded", (h) => { h.execution.supersedeAttempt(); }],
        ["the attempt completed", (h) => { h.attempt!.status = "completed"; }],
        ["there is no pending target", (h) => { h.execution.pendingStageUrl = null; }],
        // The target is restored: only a genuinely cleared deadline keeps this quiet.
        ["the load finished", (h) => {
            h.execution.finishLoad();
            h.execution.pendingStageUrl = "s3://stage/a.usdc";
        }],
    ])("does not fire once %s", (_label, arrange) => {
        const h = harness();
        const generation = begun(h);
        h.execution.scheduleLoadTimeout(generation);
        arrange(h, generation);
        h.calls.length = 0;

        vi.advanceTimersByTime(STAGE_LOAD_TIMEOUT_MS * 2);

        expect(h.calls.some(call => call.startsWith("view.stageLoadTimedOut"))).toBe(false);
    });

    it("re-arming replaces the previous deadline instead of adding one", () => {
        const h = harness();
        const generation = begun(h);
        h.execution.scheduleLoadTimeout(generation);
        vi.advanceTimersByTime(STAGE_LOAD_TIMEOUT_MS - 1);
        h.execution.scheduleLoadTimeout(generation);
        h.calls.length = 0;

        vi.advanceTimersByTime(1);
        expect(h.calls.some(call => call.startsWith("view.stageLoadTimedOut"))).toBe(false);

        vi.advanceTimersByTime(STAGE_LOAD_TIMEOUT_MS);
        expect(h.calls.filter(call => call.startsWith("view.stageLoadTimedOut"))).toHaveLength(1);
    });

    it("finishLoad clears the deadline and the pending target", () => {
        const h = harness();
        const generation = begun(h);
        h.execution.scheduleLoadTimeout(generation);
        const armed = h.armedTimers[h.armedTimers.length - 1];

        h.execution.finishLoad();

        expect(h.execution.pendingStageUrl).toBeNull();
        expect(h.clearedTimers).toContain(armed);
        // With the target back, only a cleared deadline can keep this quiet.
        h.execution.pendingStageUrl = "s3://stage/a.usdc";
        vi.advanceTimersByTime(STAGE_LOAD_TIMEOUT_MS * 2);
        expect(h.calls.some(call => call.startsWith("view.stageLoadTimedOut"))).toBe(false);
    });

    it.each<[string, (h: Harness, generation: number) => void]>([
        ["supersede", (h) => { h.execution.supersedeAttempt(); }],
        ["terminalize", (h, generation) => { h.execution.terminalizeAttempt(generation); }],
        ["invalidate", (h) => { h.execution.invalidateAttempt(); }],
    ])("%s clears the armed deadline through Window's finishLoad", (_label, act) => {
        const h = harness();
        const generation = begun(h);
        h.execution.scheduleLoadTimeout(generation);
        const armed = h.armedTimers[h.armedTimers.length - 1];

        act(h, generation);

        expect(h.clearedTimers).toContain(armed);
    });
});

describe("Stage Binding Execution: the Stage Proof", () => {
    it("revoke drops the confirmed revision and projects the unproven stage", () => {
        const h = harness();
        h.execution.confirmedRevision = "rev_1";

        h.execution.revokeProof("rev_2");

        expect(h.execution.confirmedRevision).toBeNull();
        expect(h.calls).toEqual(["view.proofRevoked:rev_2"]);
    });

    it("changed_unconfirmed blocks the proof, terminalizes the attempt and resyncs", async () => {
        const h = harness();
        const generation = begun(h);
        h.execution.confirmedRevision = "rev_1";
        h.revisions = { active: "rev_1", lastGood: "rev_0" };

        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", generation);

        expect(h.execution.proofBlockedRevision).toBe("rev_1");
        expect(h.execution.confirmedRevision).toBeNull();
        expect(h.execution.unprovenStageUrl).toBe("s3://stage/a.usdc");
        expect(h.execution.proofBlockGeneration).toBe(1);
        expect(h.attempt!.status).toBe("terminal");
        expect(h.calls.slice(0, 3)).toEqual([
            "view.finishLoad:1:false",
            "view.proofRevoked:rev_1",
            "view.proofBlocked",
        ]);
        await flush();
        expect(h.calls).toContain("coordinator.revisions:session_1:user_1");
    });

    it("changed_unconfirmed without a revision blocks as unknown and never resyncs", async () => {
        const h = harness();
        h.loadedStageUrl = "s3://stage/loaded.usdc";

        h.execution.blockProofAsChangedUnconfirmed(undefined, null, null);
        await flush();

        expect(h.execution.proofBlockedRevision).toBe("unknown");
        expect(h.execution.unprovenStageUrl).toBe("s3://stage/loaded.usdc");
        expect(h.calls).toEqual(["view.proofRevoked:none", "view.proofBlocked"]);
    });

    it("changed_unconfirmed with no attempt generation leaves a pending attempt alone", () => {
        const h = harness();
        begun(h);

        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);

        expect(h.attempt!.status).toBe("pending");
        expect(h.calls.filter(call => call.startsWith("view."))).toEqual(["view.proofBlocked"]);
    });

    it("changed_unconfirmed drops a stale status recovery key from the current attempt", () => {
        const h = harness();
        begun(h);
        h.attempt!.statusResyncRevision = "rev_old";

        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);

        expect(h.attempt!.statusResyncRevision).toBeUndefined();
    });

    it("changed_failed clears the block without leaving a blocked revision behind", () => {
        const h = harness();
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);

        h.execution.clearProofBlock();

        expect(h.execution.proofBlockedRevision).toBeNull();
        expect(h.execution.confirmedRevision).toBeNull();
        expect(h.execution.unprovenStageUrl).toBeNull();
        expect(h.execution.proofBlockGeneration).toBe(2);
    });
});

describe("Stage Binding Execution: authenticated proof resync", () => {
    it("releases the block and projects a matched stage when the active revision is the blocked one", async () => {
        const h = harness();
        h.expectedStageUrl = "s3://stage/a.usdc";
        h.loadedStageUrl = "s3://stage/a.usdc";
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);
        h.revisions = { active: "rev_1", lastGood: "rev_0" };
        h.calls.length = 0;

        await expect(h.execution.resyncProof()).resolves.toBe(true);

        expect(h.execution.proofBlockedRevision).toBeNull();
        expect(h.execution.confirmedRevision).toBe("rev_1");
        expect(h.execution.unprovenStageUrl).toBeNull();
        expect(h.resyncProjections).toEqual([{
            revision: "rev_1",
            lastGoodRevision: "rev_0",
            loadedStageUrl: "s3://stage/a.usdc",
            matched: true,
            completeAttemptGeneration: null,
        }]);
    });

    it.each<[string, (h: Harness) => void]>([
        ["the active revision moved on", (h) => { h.revisions = { active: "rev_2", lastGood: "rev_1" }; }],
        ["there is no session", (h) => { h.session = null; }],
        ["there is no user token", (h) => { h.credentials = { ...CREDENTIALS, userToken: "" }; }],
        ["the coordinator read failed", (h) => { h.revisionsError = new Error("boom"); }],
    ])("refuses to release the block when %s", async (_label, arrange) => {
        const h = harness();
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);
        h.revisions = { active: "rev_1", lastGood: "rev_0" };
        arrange(h);
        h.calls.length = 0;

        await expect(h.execution.resyncProof()).resolves.toBe(false);

        expect(h.execution.proofBlockedRevision).toBe("rev_1");
        expect(h.execution.confirmedRevision).toBeNull();
        expect(h.resyncProjections).toEqual([]);
    });

    it("refuses an unknown block: it names no revision to authenticate against", async () => {
        const h = harness();
        h.execution.blockProofAsChangedUnconfirmed(undefined, "s3://stage/a.usdc", null);
        h.calls.length = 0;

        await expect(h.execution.resyncProof()).resolves.toBe(false);
        expect(h.calls).toEqual([]);
    });

    it("refuses when a newer block superseded the one it read against", async () => {
        const h = harness();
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);
        h.revisions = { active: "rev_1", lastGood: "rev_0" };

        const resync = h.execution.resyncProof();
        // A second unconfirmed change lands while the status read is in flight.
        h.execution.blockProofAsChangedUnconfirmed(undefined, "s3://stage/b.usdc", null);

        await expect(resync).resolves.toBe(false);
        expect(h.execution.proofBlockedRevision).toBe("unknown");
        expect(h.execution.confirmedRevision).toBeNull();
        expect(h.resyncProjections).toEqual([]);
    });

    it("completes the attempt awaiting proof only when its exact result re-keyed the block", async () => {
        const h = harness();
        h.expectedStageUrl = "s3://stage/a.usdc";
        const generation = begun(h);
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);
        h.attempt!.statusResyncRevision = "rev_1";
        h.revisions = { active: "rev_1", lastGood: "rev_0" };
        h.calls.length = 0;

        await expect(h.execution.resyncProof()).resolves.toBe(true);

        expect(h.attempt!.statusResyncRevision).toBeUndefined();
        expect(h.resyncProjections).toEqual([{
            revision: "rev_1",
            lastGoodRevision: "rev_0",
            loadedStageUrl: "s3://stage/a.usdc",
            matched: true,
            completeAttemptGeneration: generation,
        }]);
    });

    it("refuses to promote an attempt awaiting proof that was never re-keyed", async () => {
        const h = harness();
        h.expectedStageUrl = "s3://stage/a.usdc";
        begun(h);
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);
        h.revisions = { active: "rev_1", lastGood: "rev_0" };
        h.calls.length = 0;

        await expect(h.execution.resyncProof()).resolves.toBe(false);
        expect(h.execution.proofBlockedRevision).toBe("rev_1");
        expect(h.resyncProjections).toEqual([]);
    });

    it("refuses a re-keyed revision once its attempt stopped awaiting proof", async () => {
        const h = harness();
        h.expectedStageUrl = "s3://stage/a.usdc";
        begun(h);
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);
        h.attempt!.statusResyncRevision = "rev_1";
        h.attempt!.status = "completed";
        h.revisions = { active: "rev_1", lastGood: "rev_0" };

        await expect(h.execution.resyncProof()).resolves.toBe(false);
        expect(h.execution.proofBlockedRevision).toBe("rev_1");
    });

    it("projects a URL mismatch as unproven and reports it", async () => {
        const h = harness();
        h.expectedStageUrl = "s3://stage/expected.usdc";
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/other.usdc", null);
        h.revisions = { active: "rev_1", lastGood: null };
        h.calls.length = 0;

        await expect(h.execution.resyncProof()).resolves.toBe(false);

        expect(h.execution.confirmedRevision).toBe("rev_1");
        expect(h.resyncProjections).toEqual([{
            revision: "rev_1",
            lastGoodRevision: "rev_1",
            loadedStageUrl: "s3://stage/other.usdc",
            matched: false,
            completeAttemptGeneration: null,
        }]);
    });

    it("refuses when the attempt object was replaced while the status read was in flight", async () => {
        const h = harness();
        h.expectedStageUrl = "s3://stage/a.usdc";
        begun(h);
        h.execution.blockProofAsChangedUnconfirmed("rev_1", "s3://stage/a.usdc", null);
        h.attempt!.statusResyncRevision = "rev_1";
        h.revisions = { active: "rev_1", lastGood: "rev_0" };

        const resync = h.execution.resyncProof();
        h.attempt = { generation: 2, status: "pending", targetUrl: "s3://stage/b.usdc" };

        await expect(resync).resolves.toBe(false);
        expect(h.execution.proofBlockedRevision).toBe("rev_1");
    });
});

describe("Stage Binding Execution: preauthorization deadline and cancellation barrier", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("hands back the transaction and reports the request no longer pending", async () => {
        const h = harness();
        const transaction = await h.execution.preauthorizeWithinDeadline(ARTIFACTS);

        expect(transaction).toBe(PREAUTHORIZATION);
        expect(h.preauthorizeCalls).toHaveLength(1);
        expect(h.preauthorizeCalls[0].clientRequestId).toMatch(/^stage_preauth_/);
        expect(h.execution.snapshot().preauthorizationPending).toBe(false);
    });

    it("reports the request pending from the moment it is made until it settles", async () => {
        const h = harness();
        h.preauthorize = () => new Promise(() => {});

        const inFlight = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        expect(h.execution.snapshot().preauthorizationPending).toBe(true);
        expect(h.states.some(state => state.preauthorizationPending)).toBe(true);

        await vi.advanceTimersByTimeAsync(45_000);

        expect(await inFlight).toBeInstanceOf(Error);
        expect(h.execution.snapshot().preauthorizationPending).toBe(false);
    });

    it("dispose ends a request waiting on the cancellation barrier without posting it", async () => {
        const h = harness();
        h.preauthorize = () => new Promise(() => {});
        let releaseCancel: (value: boolean) => void = () => {};

        const first = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        h.cancel = () => new Promise<boolean>((resolve) => { releaseCancel = resolve; });
        const second = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        expect(h.preauthorizeCalls).toHaveLength(1);

        h.execution.dispose();
        // The superseded request's cancellation is confirmed after the disposal.
        releaseCancel(true);
        await flush();

        expect((await second as Error).name).toBe("AbortError");
        expect(h.preauthorizeCalls).toHaveLength(1);
        expect(h.execution.snapshot().preauthorizationPending).toBe(false);

        await vi.advanceTimersByTimeAsync(45_000);
        expect(h.preauthorizeCalls).toHaveLength(1);
        void first;
    });

    it("dispose abandons a posted request that would otherwise never settle", async () => {
        const h = harness();
        h.preauthorize = () => new Promise(() => {});

        const inFlight = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        expect(h.execution.snapshot().preauthorizationPending).toBe(true);

        h.execution.dispose();

        expect(h.execution.snapshot().preauthorizationPending).toBe(false);
        expect(h.preauthorizeCalls[0].signal.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(45_000);
        void inFlight;
    });

    it("refuses a preauthorization requested after disposal", async () => {
        const h = harness();
        h.execution.dispose();

        const refused = await h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);

        expect((refused as Error).name).toBe("AbortError");
        expect(h.preauthorizeCalls).toEqual([]);
        expect(h.execution.snapshot().preauthorizationPending).toBe(false);
    });

    it("times out at 45 s and cancels the request it gave up on", async () => {
        const h = harness();
        h.preauthorize = () => new Promise(() => {});

        const failure = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        await vi.advanceTimersByTimeAsync(45_000);

        expect(await failure).toMatchObject({ message: "stage_binding_authorization_timeout" });
        expect(h.cancelCalls).toEqual(h.preauthorizeCalls.map(call => call.clientRequestId));
        expect(h.preauthorizeCalls[0].signal.aborted).toBe(true);
    });

    it("a second request aborts the first, confirms its cancellation and only then posts", async () => {
        const h = harness();
        let releaseFirst: (value: StageBindingPreauthorization) => void = () => {};
        h.preauthorize = () => new Promise((resolve) => { releaseFirst = resolve; });

        const first = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        h.preauthorize = () => Promise.resolve(PREAUTHORIZATION);

        const second = h.execution.preauthorizeWithinDeadline(ARTIFACTS);
        await flush();
        releaseFirst(PREAUTHORIZATION);

        expect(await second).toBe(PREAUTHORIZATION);
        expect(await first).toBe(PREAUTHORIZATION);
        expect(h.cancelCalls).toHaveLength(1);
        // The cancel of the superseded request precedes the replacement's post.
        expect(h.calls.indexOf("coordinator.cancel:" + h.cancelCalls[0]))
            .toBeLessThan(h.calls.lastIndexOf("coordinator.preauthorize:" + h.preauthorizeCalls[1].clientRequestId));
    });

    it("an unconfirmed cancellation bars the replacement until a later retry confirms it", async () => {
        const h = harness();
        h.preauthorize = () => new Promise(() => {});
        h.cancel = () => Promise.resolve(false);

        const first = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        const second = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();

        expect((await second as Error).name).toBe("AbortError");
        expect(h.preauthorizeCalls).toHaveLength(1);

        h.cancel = () => Promise.resolve(true);
        h.preauthorize = () => Promise.resolve(PREAUTHORIZATION);
        const third = h.execution.preauthorizeWithinDeadline(ARTIFACTS);
        await flush();

        expect(await third).toBe(PREAUTHORIZATION);
        expect(h.preauthorizeCalls).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(45_000);
        void first;
    });

    it("never cancels a superseded request that had not posted yet", async () => {
        const h = harness();
        h.cancel = () => Promise.resolve(false);
        let releaseCancel: (value: boolean) => void = () => {};
        const firstBarrier = new Promise<boolean>((resolve) => { releaseCancel = resolve; });
        h.preauthorize = () => new Promise(() => {});

        const first = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        h.cancel = () => firstBarrier;
        const second = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        const third = h.execution.preauthorizeWithinDeadline(ARTIFACTS).catch((error: Error) => error);
        await flush();
        releaseCancel(false);
        await flush();

        // Only the posted first request is cancelled; the second never posted.
        expect(h.cancelCalls).toEqual([h.preauthorizeCalls[0].clientRequestId]);
        expect((await second as Error).name).toBe("AbortError");
        expect((await third as Error).name).toBe("AbortError");
        await vi.advanceTimersByTimeAsync(45_000);
        void first;
    });

    it("dispose clears the stage-load deadline", () => {
        const h = harness();
        const generation = begun(h);
        h.execution.scheduleLoadTimeout(generation);

        h.execution.dispose();
        vi.advanceTimersByTime(STAGE_LOAD_TIMEOUT_MS * 2);

        expect(h.calls.some(call => call.startsWith("view.stageLoadTimedOut"))).toBe(false);
    });
});

describe("Stage Binding Execution: state projection", () => {
    it("emits one snapshot per transition and carries the machine's whole state", () => {
        const h = harness();
        h.execution.beginAttempt("s3://stage/a.usdc");
        h.execution.pendingStageUrl = "s3://stage/a.usdc";
        h.execution.confirmedRevision = "rev_1";

        // One per transition: the attempt, then each of the two setters.
        expect(h.states).toHaveLength(3);
        const latest = h.states[h.states.length - 1];
        expect(latest).toEqual({
            attempt: { generation: 1, status: "pending", targetUrl: "s3://stage/a.usdc" },
            attemptGeneration: 1,
            pendingStageUrl: "s3://stage/a.usdc",
            confirmedRevision: "rev_1",
            proofBlockedRevision: null,
            proofBlockGeneration: 0,
            unprovenStageUrl: null,
            preauthorizationPending: false,
        });
        expect(h.execution.snapshot()).toEqual(latest);
    });
});
