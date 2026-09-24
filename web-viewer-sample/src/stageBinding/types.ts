// Stage Binding Execution: the viewer-owned module that carries one stage load
// (docs/architecture/stage-binding-execution-adr.md, CONTEXT.md).
//
// Tracer bullet 1 owns the attempt machine, the Stage Proof and preauthorization's
// deadline and cancellation barrier. Dispatch, Kit event routing and visible-frame
// promotion arrive in bullet 2; Window's privates and its stage tests go in bullet 3.
import type { StageBindingPreauthorization, StageBindingRevisions } from "../coordinatorClient";
import type { ViewerCredentials } from "../clients/viewerCredentials";
import type { RuntimeCommandOutcome } from "../viewer/core/runtimeCommandTracker";

export type StageAttemptStatus = "pending" | "provisional" | "terminal" | "completed";

/** One proposed Kit stage-load execution on the viewer side. */
export interface StageAttempt {
    generation: number;
    status: StageAttemptStatus;
    targetUrl: string;
    terminalReason?: "stage-load-timeout";
    // An exact current openedStageResult may re-key an older blocked revision
    // for one authenticated status recovery; URL equality alone never does.
    statusResyncRevision?: string;
}

export const STAGE_AUTHORIZATION_TIMEOUT_MS = 45_000;
export const STAGE_AUTHORIZATION_CANCEL_TIMEOUT_MS = 5_000;
export const STAGE_LOAD_TIMEOUT_MS = 45_000;

export interface StageBindingArtifactRef {
    artifact_id: string;
    role: "primary" | "secondary";
    load_order: number;
}

/** What the module holds; Window copies it into its own fields in one place. */
export interface StageBindingState {
    readonly attempt: StageAttempt | null;
    readonly attemptGeneration: number;
    readonly pendingStageUrl: string | null;
    readonly confirmedRevision: string | null;
    readonly proofBlockedRevision: string | null;
    readonly proofBlockGeneration: number;
    readonly unprovenStageUrl: string | null;
    /** A preauthorization request is outstanding (its 45 s deadline is armed). */
    readonly preauthorizationPending: boolean;
}

/** What an authenticated revision resync established, for Window to project. */
export interface StageProofResyncProjection {
    revision: string;
    lastGoodRevision: string | null;
    /** The URL the blocked proof was taken against; null when none was observed. */
    loadedStageUrl: string | null;
    matched: boolean;
    /** Set when the resync also completes the attempt that was awaiting proof. */
    completeAttemptGeneration: number | null;
}

/**
 * The coordinator calls this module makes. `preauthorize` runs under the module's
 * AbortSignal, so the 45 s deadline is the module's; `cancel` carries its own 5 s
 * deadline and resolves false when the cancellation could not be confirmed.
 */
export interface StageBindingCoordinatorPort {
    preauthorize(
        artifacts: StageBindingArtifactRef[],
        clientRequestId: string,
        signal: AbortSignal,
    ): Promise<StageBindingPreauthorization>;
    cancel(clientRequestId: string): Promise<boolean>;
    revisions(sessionId: string, userToken: string): Promise<StageBindingRevisions>;
}

/** Runtime command tracker. This module attaches and claims; it never registers. */
export interface StageBindingTrackerPort {
    attachStageAttempt(stageUrl: string | null, attemptGeneration: number): void;
    claimAttempt(attemptGeneration: number, outcome: RuntimeCommandOutcome): void;
}

/** Native stage dispatch fencing. The queue itself moves in with dispatch (bullet 2). */
export interface StageBindingNativeQueuePort {
    dropQueuedAttempt(attemptGeneration: number): void;
    invalidateQueuedAttempt(attemptGeneration: number | undefined): void;
}

export interface StageBindingTimersPort {
    setTimeout(handler: () => void, timeoutMs: number): number;
    clearTimeout(handle: number): void;
}

/**
 * The attempt record and the stage-intent counter Window still holds in this bullet:
 * the existing Window suites install a fabricated attempt and advance the intent
 * directly, and no production Window path assigns either once the machine moved, so a
 * delegating setter would exist only for those tests. Bullet 3 deletes this port.
 */
export interface StageBindingAttemptStorePort {
    current(): StageAttempt | null;
    replace(attempt: StageAttempt | null): void;
    intent(): number;
    /** `pendingStagePreauthorizationIntent = null; stageIntentGeneration += 1`. */
    advanceIntent(): void;
}

/**
 * Window's user-facing projection. Localized copy, `AppState` writes and the parent
 * `stage_loaded` posts stay in Window for this bullet: moving them would change what
 * renders and in what order. Bullets 2 and 3 narrow this port.
 */
export interface StageBindingViewPort {
    /** `AppState.loadedStageUrl` — the last stage Kit reported, not the requested one. */
    loadedStageUrl(): string | null;
    /** Window's `_isLoadedStageExpected`: expected URL, or conversion-job equivalence. */
    isLoadedStageExpected(loadedUrl: string): boolean;
    /** Window's half of `_finishStageLoad`: loading-state retry, poll count, first-frame latch. */
    finishLoad(attemptGeneration: number | undefined, preserveFirstFrame: boolean): void;
    /** A new attempt began: clear the first-frame latch and any visible stage-load failure. */
    attemptBegun(): void;
    /** An invalidated attempt leaves no visible stage-load failure behind. */
    stageLoadFailureCleared(): void;
    /** `_revokeStageProof`'s projection: unproven `AppState` plus the parent `stage_loaded`. */
    proofRevoked(bindingRevisionId: string | undefined): void;
    /** A binding apply that never reached coordinator preauthorization. */
    bindingApplySuperseded(): void;
    /** `changed_unconfirmed`: the blocked-proof copy and the failed apply state. */
    proofBlocked(): void;
    /** The 45 s stage-load deadline expired for `targetUrl`. */
    stageLoadTimedOut(targetUrl: string): void;
    /** An authenticated revision resync released the proof block. */
    proofResynced(projection: StageProofResyncProjection): void;
}

export interface StageBindingExecutionPorts {
    coordinator: StageBindingCoordinatorPort;
    /** The Review Session this viewer is bound to; null before one exists. */
    session(): string | null;
    /** Viewer Credentials, held or borrowed. This module never claims a lease. */
    credentials(): ViewerCredentials;
    tracker: StageBindingTrackerPort;
    nativeQueue: StageBindingNativeQueuePort;
    timers: StageBindingTimersPort;
    attempt: StageBindingAttemptStorePort;
    view: StageBindingViewPort;
    /** One snapshot per transition. */
    onState(state: StageBindingState): void;
}

export interface StageBindingExecution {
    // --- attempt lifecycle ---------------------------------------------------
    /** Supersede whatever is running and start a new attempt for `targetUrl`. */
    beginAttempt(targetUrl: string): number;
    supersedeAttempt(): void;
    /** A stream lifecycle replacement: fence the attempt and its queued dispatch. */
    invalidateAttempt(): void;
    terminalizeAttempt(attemptGeneration: number | null | undefined, bindingRevisionId?: string): void;
    isCurrentAttempt(attemptGeneration: number | undefined, status?: StageAttemptStatus): boolean;
    isCurrentAttemptAwaitingProof(attemptGeneration: number | undefined): boolean;
    /** The module's half of `_finishStageLoad`: the deadline and the pending target. */
    finishLoad(): void;
    scheduleLoadTimeout(attemptGeneration: number): void;
    clearLoadTimeout(): void;
    claimAttemptTimeout(attemptGeneration: number): void;

    // --- Stage Proof ---------------------------------------------------------
    revokeProof(bindingRevisionId?: string): void;
    /** `changed_unconfirmed`: block the proof until an authenticated resync releases it. */
    blockProofAsChangedUnconfirmed(
        bindingRevisionId: string | undefined,
        stageUrl: string | null | undefined,
        attemptGeneration: number | null | undefined,
    ): void;
    /** `changed_failed`: no proof and no block; the evidence is simply gone. */
    clearProofBlock(): void;
    resyncProof(): Promise<boolean>;

    // --- preauthorization ----------------------------------------------------
    /** The 45 s deadline and the cancellation barrier around one preauthorization. */
    preauthorizeWithinDeadline(artifacts: StageBindingArtifactRef[]): Promise<StageBindingPreauthorization>;

    // --- state ---------------------------------------------------------------
    snapshot(): StageBindingState;
    /** The stage URL this execution asked Kit to load; never proof that it loaded. */
    pendingStageUrl: string | null;
    confirmedRevision: string | null;
    unprovenStageUrl: string | null;
    proofBlockGeneration: number;
    /** Writable while the Kit result chain that re-keys a block lives in Window (bullet 2). */
    proofBlockedRevision: string | null;
    readonly attemptGeneration: number;
    dispose(): void;
}
