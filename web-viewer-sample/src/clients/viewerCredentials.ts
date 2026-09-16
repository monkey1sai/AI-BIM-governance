// Viewer Credentials（見 CONTEXT.md）：viewer 出示給 coordinator 的使用者憑證與 primary viewer lease。
//
// 一個 interface、兩個 adapter：
//   - held：自己 claim / heartbeat / release（standalone viewer；console pane 於後續改用）。
//   - borrowed：由父視窗餵入（嵌入 viewer、spectator），永遠不 claim。
// 呼叫端只讀不可變快照 current() 並訂閱變更；「授權是否換手」一律比對 epoch。
import type {
    ClaimViewerLeaseRequest,
    ClaimViewerLeaseResponse,
    HeartbeatViewerLeaseRequest,
    HeartbeatViewerLeaseResponse,
} from "../contract/coordinatorApi";
import { viewerLeaseHeartbeatDelayMs } from "./viewerLeaseHeartbeat";

export interface ViewerCredentials {
    /** 使用者憑證（local-dev lab carrier）；尚未取得時為空字串。 */
    readonly userToken: string;
    readonly leaseId: string | null;
    readonly leaseToken: string | null;
    /** 送給 coordinator / Kit 的 source_client_id：持有 lease 時為 lease id，否則為設定值。 */
    readonly sourceClientId: string;
    /** userToken、leaseId、leaseToken 任一改變即換新值；跨實例唯一。 */
    readonly epoch: number;
    /** 最近一次失去（或取不到）lease 的原因；取得新 lease 後清空。 */
    readonly loss: ViewerCredentialsLoss | null;
}

export type ViewerCredentialsLossReason = "claim_failed" | "claim_rejected" | "lease_gone" | "expired" | "released";

export interface ViewerCredentialsLoss {
    readonly reason: ViewerCredentialsLossReason;
    readonly status: number | null;
    readonly detail: string;
}

export interface ViewerCredentialsSource {
    current(): ViewerCredentials;
    subscribe(listener: (credentials: ViewerCredentials) => void): () => void;
    /** lease 仍有效就沿用，沒有才 claim（同時只送一個 claim）；取不到回 null。borrowed 永不 claim。 */
    ensure(): Promise<ViewerCredentials | null>;
    /** 先 release 目前的 lease，再 claim 新的；release 失敗即 reject 且不 claim。borrowed 等同 ensure()。 */
    renew(): Promise<ViewerCredentials | null>;
    /** 等 coordinator 確認後才丟棄 lease；失敗時保留 lease 並 reject。borrowed 不動父視窗的 lease。 */
    release(): Promise<void>;
    /** 終止實例：停止計時器、release 持有的 lease（不等待）、之後遲到的結果一律丟棄。 */
    dispose(): void;
}

export interface ViewerLeaseTransport {
    claim(sessionId: string, body: ClaimViewerLeaseRequest, userToken: string): Promise<ClaimViewerLeaseResponse>;
    heartbeat(
        sessionId: string,
        leaseId: string,
        leaseToken: string,
        body: HeartbeatViewerLeaseRequest,
    ): Promise<HeartbeatViewerLeaseResponse>;
    release(sessionId: string, leaseId: string, leaseToken: string): Promise<unknown>;
}

let epochCounter = 0;
const nextEpoch = (): number => ++epochCounter;

function snapshot(
    userToken: string,
    leaseId: string | null,
    leaseToken: string | null,
    fallbackSourceClientId: string,
    epoch: number,
    loss: ViewerCredentialsLoss | null,
): ViewerCredentials {
    return Object.freeze({
        userToken,
        leaseId,
        leaseToken,
        sourceClientId: leaseId ?? fallbackSourceClientId,
        epoch,
        loss,
    });
}

class Listeners {
    private readonly listeners = new Set<(credentials: ViewerCredentials) => void>();

    add(listener: (credentials: ViewerCredentials) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify(credentials: ViewerCredentials): void {
        for (const listener of [...this.listeners]) listener(credentials);
    }

    clear(): void {
        this.listeners.clear();
    }
}

function errorStatus(error: unknown): number | null {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function errorDetail(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** coordinator 明確表示 lease 或 session 已不存在：立即丟棄，不再重試。 */
function leaseIsGone(error: unknown): boolean {
    const code = (error as { errorCode?: unknown } | null)?.errorCode;
    const status = errorStatus(error);
    return code === "viewer_lease_not_found" || status === 404 || status === 409;
}

function expiryOf(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

interface HeldLease {
    readonly leaseId: string;
    readonly leaseToken: string;
    expiresAt: number;
    heartbeatAfterMs: number;
}

export interface HeldViewerCredentialsOptions {
    sessionId: string;
    userToken: string;
    /** 沒有 lease 時的 source_client_id。 */
    fallbackSourceClientId: string;
    transport: ViewerLeaseTransport;
    /** 第 attempt 次 claim 的 request body（attempt 從 1 起算）。 */
    claimRequest: (attempt: number) => ClaimViewerLeaseRequest;
    /** 每次 heartbeat 附帶的 runtime 證據；預設空物件。 */
    heartbeatEvidence?: () => HeartbeatViewerLeaseRequest;
}

class HeldViewerCredentials implements ViewerCredentialsSource {
    private readonly listeners = new Listeners();
    private lease: HeldLease | null = null;
    private state: ViewerCredentials;
    private claimInFlight: Promise<ViewerCredentials | null> | null = null;
    private releaseInFlight: { lease: HeldLease; promise: Promise<void> } | null = null;
    private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    private attempts = 0;
    private disposed = false;

    constructor(private readonly options: HeldViewerCredentialsOptions) {
        this.state = snapshot(options.userToken, null, null, options.fallbackSourceClientId, nextEpoch(), null);
    }

    current(): ViewerCredentials {
        if (this.lease && this.lease.expiresAt <= Date.now()) {
            this.drop({ reason: "expired", status: null, detail: "primary viewer lease expired" });
        }
        return this.state;
    }

    subscribe(listener: (credentials: ViewerCredentials) => void): () => void {
        return this.listeners.add(listener);
    }

    async ensure(): Promise<ViewerCredentials | null> {
        if (this.disposed) return null;
        const credentials = this.current();
        if (this.lease) return credentials;
        return this.claim();
    }

    async renew(): Promise<ViewerCredentials | null> {
        if (this.disposed) return null;
        if (this.claimInFlight) await this.claimInFlight;
        if (this.lease) await this.release();
        return this.claim();
    }

    release(): Promise<void> {
        const lease = this.lease;
        if (this.disposed || !lease) return Promise.resolve();
        if (this.releaseInFlight?.lease === lease) return this.releaseInFlight.promise;
        const promise = Promise.resolve()
            .then(() => this.options.transport.release(this.options.sessionId, lease.leaseId, lease.leaseToken))
            .then(() => {
                if (this.lease === lease) this.drop({ reason: "released", status: null, detail: "released" });
            })
            .finally(() => {
                if (this.releaseInFlight?.promise === promise) this.releaseInFlight = null;
            });
        this.releaseInFlight = { lease, promise };
        return promise;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.listeners.clear();
        this.clearHeartbeat();
        const lease = this.lease;
        this.lease = null;
        this.state = snapshot(this.options.userToken, null, null, this.options.fallbackSourceClientId, nextEpoch(), null);
        if (lease) this.fireRelease(lease.leaseId, lease.leaseToken);
    }

    private claim(): Promise<ViewerCredentials | null> {
        if (this.claimInFlight) return this.claimInFlight;
        const attempt = ++this.attempts;
        const request = this.runClaim(attempt).finally(() => {
            if (this.claimInFlight === request) this.claimInFlight = null;
        });
        this.claimInFlight = request;
        return request;
    }

    private async runClaim(attempt: number): Promise<ViewerCredentials | null> {
        const { sessionId, transport, userToken } = this.options;
        let granted: ClaimViewerLeaseResponse;
        try {
            granted = await transport.claim(sessionId, this.options.claimRequest(attempt), userToken);
        } catch (error) {
            if (!this.disposed) {
                this.publishLoss({ reason: "claim_failed", status: errorStatus(error), detail: errorDetail(error) });
            }
            return null;
        }
        if (this.disposed) {
            if (granted?.lease_id && granted?.lease_token) this.fireRelease(granted.lease_id, granted.lease_token);
            return null;
        }
        const expiresAt = expiryOf(granted?.expires_at);
        if (
            granted?.role !== "primary"
            || !granted.lease_id
            || !granted.lease_token
            || !Number.isFinite(granted.heartbeat_after_ms)
            || expiresAt === null
            || expiresAt <= Date.now()
        ) {
            this.publishLoss({
                reason: "claim_rejected",
                status: null,
                detail: `role=${String(granted?.role)}`,
            });
            return null;
        }
        this.lease = {
            leaseId: granted.lease_id,
            leaseToken: granted.lease_token,
            expiresAt,
            heartbeatAfterMs: granted.heartbeat_after_ms,
        };
        this.publish(snapshot(
            userToken,
            granted.lease_id,
            granted.lease_token,
            this.options.fallbackSourceClientId,
            nextEpoch(),
            null,
        ));
        this.scheduleHeartbeat(viewerLeaseHeartbeatDelayMs(granted.heartbeat_after_ms));
        return this.state;
    }

    private scheduleHeartbeat(delayMs: number): void {
        this.clearHeartbeat();
        if (this.disposed || !this.lease) return;
        this.heartbeatTimer = setTimeout(() => {
            this.heartbeatTimer = null;
            void this.heartbeat();
        }, Math.max(0, delayMs));
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private async heartbeat(): Promise<void> {
        const lease = this.lease;
        if (this.disposed || !lease) return;
        if (lease.expiresAt <= Date.now()) {
            this.drop({ reason: "expired", status: null, detail: "primary viewer lease expired" });
            return;
        }
        const evidence = this.options.heartbeatEvidence?.() ?? {};
        try {
            const refreshed = await this.options.transport.heartbeat(
                this.options.sessionId,
                lease.leaseId,
                lease.leaseToken,
                evidence,
            );
            if (this.disposed || this.lease !== lease) return;
            const expiresAt = expiryOf(refreshed?.expires_at);
            if (
                refreshed?.lease_id !== lease.leaseId
                || expiresAt === null
                || !Number.isFinite(refreshed.heartbeat_after_ms)
            ) {
                this.retryHeartbeat(lease);
                return;
            }
            lease.expiresAt = expiresAt;
            lease.heartbeatAfterMs = refreshed.heartbeat_after_ms;
            this.scheduleHeartbeat(viewerLeaseHeartbeatDelayMs(lease.heartbeatAfterMs));
        } catch (error) {
            if (this.disposed || this.lease !== lease) return;
            if (leaseIsGone(error)) {
                this.drop({ reason: "lease_gone", status: errorStatus(error), detail: errorDetail(error) });
                return;
            }
            this.retryHeartbeat(lease);
        }
    }

    /** 暫時性失敗：到本機過期時間前持續重試。 */
    private retryHeartbeat(lease: HeldLease): void {
        const remaining = lease.expiresAt - Date.now();
        if (remaining <= 0) {
            this.drop({ reason: "expired", status: null, detail: "primary viewer lease expired" });
            return;
        }
        this.scheduleHeartbeat(Math.min(viewerLeaseHeartbeatDelayMs(lease.heartbeatAfterMs), remaining));
    }

    private drop(loss: ViewerCredentialsLoss): void {
        if (!this.lease) return;
        this.lease = null;
        this.clearHeartbeat();
        this.publish(snapshot(
            this.options.userToken,
            null,
            null,
            this.options.fallbackSourceClientId,
            nextEpoch(),
            loss,
        ));
    }

    private publishLoss(loss: ViewerCredentialsLoss): void {
        const s = this.state;
        this.publish(snapshot(s.userToken, s.leaseId, s.leaseToken, this.options.fallbackSourceClientId, s.epoch, loss));
    }

    private publish(next: ViewerCredentials): void {
        this.state = next;
        if (!this.disposed) this.listeners.notify(next);
    }

    /** 同步送出（pagehide 期間必須在事件處理內發出 keepalive 請求），不等待結果。 */
    private fireRelease(leaseId: string, leaseToken: string): void {
        try {
            void this.options.transport.release(this.options.sessionId, leaseId, leaseToken).catch(() => {});
        } catch {
            // 文件卸載中的同步失敗只能交給 coordinator 的 lease 到期回收。
        }
    }
}

export function createHeldViewerCredentials(options: HeldViewerCredentialsOptions): ViewerCredentialsSource {
    return new HeldViewerCredentials(options);
}

export interface BorrowedViewerCredentialsOptions {
    /** 父視窗配給的 lease id（URL handoff）；同時作為 source_client_id。 */
    sourceClientId: string;
    initial?: { leaseToken?: string; userToken?: string };
}

export interface BorrowedViewerCredentials extends ViewerCredentialsSource {
    /** 父視窗送來的憑證；leaseToken 為空字串代表收回 lease，userToken 省略則沿用。 */
    accept(update: { leaseToken: string; userToken?: string }): void;
}

class BorrowedSource implements BorrowedViewerCredentials {
    private readonly listeners = new Listeners();
    private state: ViewerCredentials;
    private disposed = false;

    constructor(private readonly options: BorrowedViewerCredentialsOptions) {
        this.state = this.build(options.initial?.userToken ?? "", options.initial?.leaseToken ?? "");
    }

    current(): ViewerCredentials {
        return this.state;
    }

    subscribe(listener: (credentials: ViewerCredentials) => void): () => void {
        return this.listeners.add(listener);
    }

    async ensure(): Promise<ViewerCredentials | null> {
        return this.state.leaseToken ? this.state : null;
    }

    renew(): Promise<ViewerCredentials | null> {
        return this.ensure();
    }

    async release(): Promise<void> {
        // 父視窗擁有這個 lease；借用者不 release。
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.listeners.clear();
        this.state = this.build("", "");
    }

    accept(update: { leaseToken: string; userToken?: string }): void {
        if (this.disposed) return;
        const userToken = update.userToken ?? this.state.userToken;
        const leaseToken = update.leaseToken || null;
        if (userToken === this.state.userToken && leaseToken === this.state.leaseToken) return;
        this.state = this.build(userToken, leaseToken ?? "");
        this.listeners.notify(this.state);
    }

    private build(userToken: string, leaseToken: string): ViewerCredentials {
        return snapshot(
            userToken,
            leaseToken ? this.options.sourceClientId : null,
            leaseToken || null,
            this.options.sourceClientId,
            nextEpoch(),
            null,
        );
    }
}

export function createBorrowedViewerCredentials(options: BorrowedViewerCredentialsOptions): BorrowedViewerCredentials {
    return new BorrowedSource(options);
}

export function isBorrowedViewerCredentials(source: ViewerCredentialsSource): source is BorrowedViewerCredentials {
    return typeof (source as Partial<BorrowedViewerCredentials>).accept === "function";
}
