// Stage Binding Execution (docs/architecture/stage-binding-execution-adr.md §1).
// Tracer bullet 1: the attempt machine, the Stage Proof and preauthorization's
// deadline and cancellation barrier. The module is the single source of this state;
// a host may observe it through the optional `onState` port.
import type { StageBindingPreauthorization } from "../coordinatorClient";
import {
    STAGE_AUTHORIZATION_TIMEOUT_MS,
    STAGE_LOAD_TIMEOUT_MS,
    type StageAttempt,
    type StageAttemptStatus,
    type StageBindingArtifactRef,
    type StageBindingExecution,
    type StageBindingExecutionPorts,
    type StageBindingState,
} from "./types";

let preauthorizationSequence = 0;

function createPreauthorizationRequestId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `stage_preauth_${uuid}`;
    preauthorizationSequence += 1;
    return `stage_preauth_${Date.now().toString(36)}_${preauthorizationSequence.toString(36)}`;
}

interface ActivePreauthorization {
    clientRequestId: string;
    controller: AbortController;
    /** The coordinator POST was issued, so a cancellation has something to cancel. */
    postStarted: boolean;
    cancellationPromise: Promise<boolean> | null;
}

interface CancellationBarrier {
    request: ActivePreauthorization;
    promise: Promise<boolean>;
    status: "pending" | "failed";
}

export function createStageBindingExecution(ports: StageBindingExecutionPorts): StageBindingExecution {
    let attemptGeneration = 0;
    let pendingStageUrl: string | null = null;
    let confirmedRevision: string | null = null;
    let proofBlockedRevision: string | null = null;
    let proofBlockGeneration = 0;
    let unprovenStageUrl: string | null = null;
    let loadTimeoutId: number | null = null;
    let activePreauthorization: ActivePreauthorization | null = null;
    let cancellationBarrier: CancellationBarrier | null = null;
    let disposed = false;

    const copyOfCurrentAttempt = (): StageAttempt | null => {
        const attempt = ports.attempt.current();
        return attempt ? { ...attempt } : null;
    };
    const snapshot = (): StageBindingState => ({
        // A copy: a snapshot is an observation, not a handle on the live record.
        attempt: copyOfCurrentAttempt(),
        attemptGeneration,
        pendingStageUrl,
        confirmedRevision,
        proofBlockedRevision,
        proofBlockGeneration,
        unprovenStageUrl,
        preauthorizationPending: activePreauthorization !== null,
    });
    const emit = (): void => { ports.onState?.(snapshot()); };

    const isCurrentAttempt = (generation: number | undefined, status?: StageAttemptStatus): boolean => {
        const attempt = ports.attempt.current();
        return Boolean(generation && attempt?.generation === generation && (!status || attempt.status === status));
    };
    const isCurrentAttemptAwaitingProof = (generation: number | undefined): boolean => {
        const attempt = ports.attempt.current();
        return Boolean(
            generation
            && attempt?.generation === generation
            && (attempt.status === "pending" || attempt.status === "provisional"),
        );
    };

    const clearLoadTimeout = (): void => {
        if (loadTimeoutId === null) return;
        ports.timers.clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
    };

    /** The module's half of `_finishStageLoad`; Window's half runs through `view.finishLoad`. */
    const finishLoad = (): void => {
        clearLoadTimeout();
        pendingStageUrl = null;
        emit();
    };

    const revokeProof = (bindingRevisionId?: string): void => {
        confirmedRevision = null;
        emit();
        ports.view.proofRevoked(bindingRevisionId);
    };

    const terminalizeAttempt = (
        generation: number | null | undefined,
        bindingRevisionId?: string,
    ): void => {
        if (!generation) return;
        if (!isCurrentAttemptAwaitingProof(generation)) {
            // A post-completion binding transaction (composeStageRequest) has no
            // stage attempt of its own. Its changed terminal must still withdraw the
            // current completed proof, but must never revoke a newer attempt.
            if (isCurrentAttempt(generation, "completed")) revokeProof(bindingRevisionId);
            return;
        }
        const attempt = ports.attempt.current();
        if (attempt && generation === attempt.generation) attempt.status = "terminal";
        ports.view.finishLoad(generation, false);
        revokeProof(bindingRevisionId);
    };

    const supersedeAttempt = (): void => {
        const superseded = ports.attempt.current();
        if (!superseded) return;
        if (isCurrentAttemptAwaitingProof(superseded.generation)) {
            superseded.status = "terminal";
            ports.view.finishLoad(superseded.generation, false);
            ports.tracker.claimAttempt(superseded.generation, "superseded");
        }
        ports.nativeQueue.dropQueuedAttempt(superseded.generation);
        revokeProof();
        ports.attempt.replace(null);
        emit();
    };

    const beginAttempt = (targetUrl: string): number => {
        ports.view.bindingApplySuperseded();
        ports.attempt.advanceIntent();
        supersedeAttempt();
        attemptGeneration += 1;
        const generation = attemptGeneration;
        ports.view.attemptBegun();
        ports.attempt.replace({ generation, status: "pending", targetUrl });
        emit();
        return generation;
    };

    const invalidateAttempt = (): void => {
        ports.view.bindingApplySuperseded();
        ports.attempt.advanceIntent();
        const generation = ports.attempt.current()?.generation;
        ports.nativeQueue.invalidateQueuedAttempt(generation);
        revokeProof();
        if (!generation) {
            ports.view.stageLoadFailureCleared();
            return;
        }
        attemptGeneration = Math.max(attemptGeneration, generation) + 1;
        const attempt = ports.attempt.current();
        if (attempt?.status === "pending" || attempt?.status === "provisional") attempt.status = "terminal";
        ports.view.finishLoad(generation, false);
        ports.tracker.claimAttempt(generation, "superseded");
        // A reconnect must accept its new no-URL readiness probe. Clearing the attempt
        // still rejects any old correlated result by generation mismatch.
        ports.attempt.replace(null);
        emit();
        ports.view.stageLoadFailureCleared();
    };

    const claimAttemptTimeout = (generation: number): void => {
        const attempt = ports.attempt.current();
        if (isCurrentAttemptAwaitingProof(generation) && attempt) attempt.terminalReason = "stage-load-timeout";
        ports.tracker.claimAttempt(generation, "timed-out");
    };

    const scheduleLoadTimeout = (generation: number): void => {
        ports.tracker.attachStageAttempt(pendingStageUrl, generation);
        clearLoadTimeout();
        loadTimeoutId = ports.timers.setTimeout(() => {
            loadTimeoutId = null;
            const targetUrl = pendingStageUrl;
            if (!isCurrentAttemptAwaitingProof(generation) || !targetUrl) return;
            claimAttemptTimeout(generation);
            ports.view.stageLoadTimedOut(targetUrl);
        }, STAGE_LOAD_TIMEOUT_MS);
    };

    const blockProofAsChangedUnconfirmed = (
        bindingRevisionId: string | undefined,
        stageUrl: string | null | undefined,
        generation: number | null | undefined,
    ): void => {
        const revision = bindingRevisionId || "unknown";
        const unprovenUrl = stageUrl || ports.view.loadedStageUrl() || pendingStageUrl;
        proofBlockGeneration += 1;
        proofBlockedRevision = revision;
        confirmedRevision = null;
        unprovenStageUrl = unprovenUrl;
        const attempt = ports.attempt.current();
        if (attempt) attempt.statusResyncRevision = undefined;
        emit();
        if (generation) {
            terminalizeAttempt(generation, bindingRevisionId);
        } else if (!ports.attempt.current() || ports.attempt.current()?.status === "completed") {
            // A correlated non-stage mutation can invalidate the current completed
            // proof, but it has no authority to terminalize a newer pending attempt.
            revokeProof(bindingRevisionId);
        }
        ports.view.proofBlocked();
        if (bindingRevisionId) void resyncProof();
    };

    const clearProofBlock = (): void => {
        proofBlockGeneration += 1;
        proofBlockedRevision = null;
        confirmedRevision = null;
        unprovenStageUrl = null;
        emit();
    };

    async function resyncProof(): Promise<boolean> {
        const revision = proofBlockedRevision;
        const generation = proofBlockGeneration;
        const loadedUrl = unprovenStageUrl;
        const sessionId = ports.session();
        // A status response must not survive the attempt that requested it. Reconnect
        // and stop invalidate the object even when the block itself stays pending.
        const resyncAttempt = ports.attempt.current();
        const resyncAttemptGeneration = resyncAttempt?.generation;
        const userToken = ports.credentials().userToken;
        if (!revision || revision === "unknown" || !sessionId || !userToken) return false;
        try {
            const revisions = await ports.coordinator.revisions(sessionId, userToken);
            const activeRevision = revisions.active;
            const lastGoodRevision = revisions.lastGood;
            const activeAttempt = ports.attempt.current();
            // changed_unconfirmed is only released by the same revision. A retained
            // prior completion cannot prove that a later unconfirmed Kit mutation did
            // not change the physical stage.
            if (activeRevision !== revision) return false;
            if (
                proofBlockGeneration !== generation
                || proofBlockedRevision !== revision
                || unprovenStageUrl !== loadedUrl
            ) return false;
            if (
                resyncAttemptGeneration
                && (activeAttempt !== resyncAttempt || activeAttempt?.generation !== resyncAttemptGeneration)
            ) return false;

            // A status confirmation for an older rejected revision must not promote a
            // newer same-URL attempt while it is still awaiting its own correlated
            // terminal. Only that attempt's exact result may re-key this recovery.
            const recoveringActiveAttempt = Boolean(
                activeAttempt && isCurrentAttemptAwaitingProof(activeAttempt.generation),
            );
            if (recoveringActiveAttempt && activeAttempt?.statusResyncRevision !== revision) return false;
            if (activeAttempt?.statusResyncRevision === revision && !recoveringActiveAttempt) return false;
            const recoveryAttemptGeneration = recoveringActiveAttempt ? activeAttempt?.generation : undefined;

            const matched = Boolean(loadedUrl && ports.view.isLoadedStageExpected(loadedUrl));
            proofBlockGeneration += 1;
            proofBlockedRevision = null;
            confirmedRevision = revision;
            unprovenStageUrl = null;
            if (activeAttempt) activeAttempt.statusResyncRevision = undefined;
            emit();
            ports.view.proofResynced({
                revision,
                lastGoodRevision: lastGoodRevision || revision,
                loadedStageUrl: loadedUrl,
                matched,
                completeAttemptGeneration: recoveryAttemptGeneration && matched ? recoveryAttemptGeneration : null,
            });
            return matched;
        } catch {
            return false;
        }
    }

    /**
     * Abort `request` and hold the one outstanding cancellation for it. The barrier
     * is what a replacement waits on: the coordinator must confirm that the
     * superseded transaction is gone before another one may be posted.
     */
    function cancelPreauthorization(
        request: ActivePreauthorization,
        retryFailed = false,
    ): Promise<boolean> {
        request.controller.abort();
        const currentBarrier = cancellationBarrier;
        if (retryFailed && currentBarrier?.request === request && currentBarrier.status === "failed") {
            request.cancellationPromise = null;
        }
        if (request.cancellationPromise) return request.cancellationPromise;
        const barrier: CancellationBarrier = { request, promise: Promise.resolve(false), status: "pending" };
        barrier.promise = ports.coordinator.cancel(request.clientRequestId).then((confirmed) => {
            if (cancellationBarrier === barrier) {
                if (confirmed) cancellationBarrier = null;
                else barrier.status = "failed";
            }
            return confirmed;
        });
        request.cancellationPromise = barrier.promise;
        cancellationBarrier = barrier;
        return barrier.promise;
    }

    async function preauthorizeWithinDeadline(
        artifacts: StageBindingArtifactRef[],
    ): Promise<StageBindingPreauthorization> {
        let timeoutId: number | null = null;
        const controller = new AbortController();
        const clientRequestId = createPreauthorizationRequestId();
        const request: ActivePreauthorization = {
            clientRequestId,
            controller,
            postStarted: false,
            cancellationPromise: null,
        };
        const superseded = (): DOMException =>
            new DOMException("stage binding preauthorization superseded", "AbortError");
        // A request that lost the active slot, or whose module was disposed while it
        // waited on the barrier, must end here: it may neither post nor arm a deadline.
        const stale = (): boolean => disposed || activePreauthorization !== request;
        const supersededRequest = activePreauthorization;
        activePreauthorization = request;
        emit();
        try {
            if (supersededRequest) {
                supersededRequest.controller.abort();
                if (supersededRequest.postStarted) {
                    const confirmed = await cancelPreauthorization(supersededRequest);
                    if (!confirmed || stale()) throw superseded();
                }
            }
            const barrier = cancellationBarrier;
            if (barrier) {
                const confirmed = barrier.status === "failed"
                    ? await cancelPreauthorization(barrier.request, true)
                    : await barrier.promise;
                if (!confirmed || stale()) throw superseded();
            }
            if (stale()) throw superseded();
            request.postStarted = true;
            return await new Promise<StageBindingPreauthorization>((resolve, reject) => {
                timeoutId = ports.timers.setTimeout(
                    () => {
                        void cancelPreauthorization(request);
                        reject(new Error("stage_binding_authorization_timeout"));
                    },
                    STAGE_AUTHORIZATION_TIMEOUT_MS,
                );
                void ports.coordinator.preauthorize(artifacts, clientRequestId, controller.signal).then(resolve, reject);
            });
        } finally {
            if (timeoutId !== null) ports.timers.clearTimeout(timeoutId);
            if (activePreauthorization === request) {
                activePreauthorization = null;
                emit();
            }
        }
    }

    return {
        beginAttempt,
        supersedeAttempt,
        invalidateAttempt,
        terminalizeAttempt,
        isCurrentAttempt,
        isCurrentAttemptAwaitingProof,
        finishLoad,
        scheduleLoadTimeout,
        clearLoadTimeout,
        claimAttemptTimeout,
        revokeProof,
        blockProofAsChangedUnconfirmed,
        clearProofBlock,
        resyncProof,
        preauthorizeWithinDeadline,
        snapshot,
        get pendingStageUrl() { return pendingStageUrl; },
        set pendingStageUrl(value: string | null) { pendingStageUrl = value; emit(); },
        get confirmedRevision() { return confirmedRevision; },
        set confirmedRevision(value: string | null) { confirmedRevision = value; emit(); },
        get unprovenStageUrl() { return unprovenStageUrl; },
        set unprovenStageUrl(value: string | null) { unprovenStageUrl = value; emit(); },
        get proofBlockGeneration() { return proofBlockGeneration; },
        set proofBlockGeneration(value: number) { proofBlockGeneration = value; emit(); },
        get proofBlockedRevision() { return proofBlockedRevision; },
        set proofBlockedRevision(value: string | null) { proofBlockedRevision = value; emit(); },
        get attemptGeneration() { return attemptGeneration; },
        dispose(): void {
            disposed = true;
            clearLoadTimeout();
            activePreauthorization?.controller.abort();
            activePreauthorization = null;
            emit();
        },
    };
}
