// Viewer Credentials（見 CONTEXT.md）：viewer 出示給 coordinator 的使用者憑證與 primary viewer lease。
//
// 一個 interface、兩個 adapter：
//   - held：自己 claim / heartbeat / release（頂層 standalone viewer、console Review Room pane）。
//   - borrowed：由父視窗餵入（嵌入 viewer、spectator），永遠不 claim。
// 呼叫端只讀不可變快照 current() 並訂閱變更；「授權是否換手」一律比對 epoch。
import type {
    ClaimViewerLeaseRequest,
    ClaimViewerLeaseResponse,
    HeartbeatViewerLeaseRequest,
    HeartbeatViewerLeaseResponse,
} from "../contract/coordinatorApi";

export interface ViewerCredentials {
    /** 使用者憑證（local-dev lab carrier）；尚未取得時為空字串。 */
    readonly userToken: string;
    readonly leaseId: string | null;
    readonly leaseToken: string | null;
    /** coordinator 配給這個 lease 的顯示資料；borrowed 或沒有 lease 時為 null。 */
    readonly leaseDetails: ViewerLeaseDetails | null;
    /** 送給 coordinator / Kit 的 source_client_id：持有 lease 時為 lease id，否則為設定值。 */
    readonly sourceClientId: string;
    /** userToken、leaseId、leaseToken 任一改變即換新值；跨實例唯一。 */
    readonly epoch: number;
    /** 最近一次失去（或取不到）lease 的原因；取得新 lease 後清空。 */
    readonly loss: ViewerCredentialsLoss | null;
}

export interface ViewerLeaseDetails {
    readonly kitInstanceId: string | null;
    readonly userId: string | null;
    readonly displayName: string | null;
}

export type ViewerCredentialsLossReason = "claim_failed" | "claim_rejected" | "lease_gone" | "expired" | "released";

export interface ViewerCredentialsLoss {
    readonly reason: ViewerCredentialsLossReason;
    readonly status: number | null;
    /** coordinator 回應的 error_code；舊 coordinator 或非 HTTP 失敗時為 null。 */
    readonly errorCode: string | null;
    readonly detail: string;
}

export interface ViewerCredentialsSource {
    current(): ViewerCredentials;
    subscribe(listener: (credentials: ViewerCredentials) => void): () => void;
    /** lease 仍有效就沿用，沒有才 claim（同時只送一個 claim）；取不到回 null。borrowed 永不 claim。 */
    ensure(): Promise<ViewerCredentials | null>;
    /** 先 release 目前的 lease，再 claim 新的；release 失敗即 reject 且不 claim。borrowed 等同 ensure()。 */
    renew(): Promise<ViewerCredentials | null>;
    /**
     * 等 coordinator 確認後才丟棄 lease；coordinator 回報 lease 已不存在時同樣丟棄。
     * 其他失敗保留 lease 並 reject。borrowed 不動父視窗的 lease。
     */
    release(): Promise<void>;
    /** 終止實例：停止計時器、release 持有的 lease（不等待）、之後遲到的結果一律丟棄。 */
    dispose(): void;
}

export interface HeldViewerCredentials extends ViewerCredentialsSource {
    /**
     * 立即送出一次帶 runtime 證據的 heartbeat（例如首幀、stage 載入）。成功時更新到期時間並重排；
     * lease 已不存在時丟棄；其他失敗不影響既有排程。
     */
    heartbeatNow(evidence: HeartbeatViewerLeaseRequest): Promise<void>;
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

const HEARTBEAT_FLOOR_MS = 5_000;
const HEARTBEAT_DEFAULT_MS = 15_000;

/**
 * coordinator 下發 heartbeat_after_ms（現值 15000；lease TTL 45000）的排程政策：
 * 非有限正數回退 15000，再套 5000 地板，保護 coordinator 不被過快輪詢。
 */
function heartbeatDelayMs(heartbeatAfterMs: unknown): number {
    const value = typeof heartbeatAfterMs === "number" && Number.isFinite(heartbeatAfterMs) && heartbeatAfterMs > 0
        ? heartbeatAfterMs
        : HEARTBEAT_DEFAULT_MS;
    return Math.max(HEARTBEAT_FLOOR_MS, value);
}

let epochCounter = 0;
const nextEpoch = (): number => ++epochCounter;

interface SnapshotInput {
    userToken: string;
    leaseId: string | null;
    leaseToken: string | null;
    leaseDetails: ViewerLeaseDetails | null;
    fallbackSourceClientId: string;
    epoch: number;
    loss: ViewerCredentialsLoss | null;
}

function snapshot(input: SnapshotInput): ViewerCredentials {
    return Object.freeze({
        userToken: input.userToken,
        leaseId: input.leaseId,
        leaseToken: input.leaseToken,
        leaseDetails: input.leaseDetails,
        sourceClientId: input.leaseId ?? input.fallbackSourceClientId,
        epoch: input.epoch,
        loss: input.loss,
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

function errorCode(error: unknown): string | null {
    const code = (error as { errorCode?: unknown } | null)?.errorCode;
    return typeof code === "string" && code ? code : null;
}

function lossFrom(reason: ViewerCredentialsLossReason, error: unknown): ViewerCredentialsLoss {
    return {
        reason,
        status: errorStatus(error),
        errorCode: errorCode(error),
        detail: error instanceof Error ? error.message : String(error),
    };
}

function localLoss(reason: ViewerCredentialsLossReason, detail: string): ViewerCredentialsLoss {
    return { reason, status: null, errorCode: null, detail };
}

/** coordinator 明確表示 lease 或 session 已不存在：立即丟棄，不再重試。 */
function leaseIsGone(error: unknown): boolean {
    const status = errorStatus(error);
    return errorCode(error) === "viewer_lease_not_found" || status === 404 || status === 409;
}

function timestampOf(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * 本機時鐘上的到期時間。expires_at 是 coordinator 的絕對時間；回應若附同一時鐘的參考時間
 * （claimed_at / last_heartbeat_at），以兩者差（剩餘 TTL）加上本機現在換算，不受本機時鐘偏差影響；
 * 沒有參考時間時才直接比對絕對時間。
 */
function localExpiryOf(expiresAt: unknown, serverReference: unknown): number | null {
    const expires = timestampOf(expiresAt);
    if (expires === null) return null;
    const reference = timestampOf(serverReference);
    return reference === null ? expires : Date.now() + (expires - reference);
}

function claimRejection(granted: ClaimViewerLeaseResponse | undefined, expiresAt: number | null): string | null {
    if (granted?.role !== "primary") return `role=${String(granted?.role)}`;
    if (!granted.lease_id || !granted.lease_token) return "lease id or token missing";
    if (!Number.isFinite(granted.heartbeat_after_ms)) return "heartbeat_after_ms missing";
    if (expiresAt === null) return "expires_at missing";
    if (expiresAt <= Date.now()) return "lease already expired";
    return null;
}

function nullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

interface HeldLease {
    readonly leaseId: string;
    readonly leaseToken: string;
    readonly details: ViewerLeaseDetails;
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
    /** 每次排程 heartbeat 附帶的 runtime 證據；預設空物件。 */
    heartbeatEvidence?: () => HeartbeatViewerLeaseRequest;
}

class HeldSource implements HeldViewerCredentials {
    private readonly listeners = new Listeners();
    private lease: HeldLease | null = null;
    private state: ViewerCredentials;
    private claimInFlight: Promise<ViewerCredentials | null> | null = null;
    private releaseInFlight: { lease: HeldLease; promise: Promise<void> } | null = null;
    private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    private attempts = 0;
    private disposed = false;

    constructor(private readonly options: HeldViewerCredentialsOptions) {
        this.state = this.build(null, nextEpoch(), null);
    }

    current(): ViewerCredentials {
        this.dropIfExpired();
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
        // 同步送出請求，讓 renew() 的 release → claim 不多等額外的 tick。
        let request: Promise<unknown>;
        try {
            request = this.options.transport.release(this.options.sessionId, lease.leaseId, lease.leaseToken);
        } catch (error) {
            request = Promise.reject(error);
        }
        const promise = request.then(
            () => {
                this.settleRelease(lease);
                if (this.lease === lease) this.drop(localLoss("released", "released"));
            },
            (error: unknown) => {
                this.settleRelease(lease);
                // coordinator 已沒有這個 lease：沒有東西可 release，與 heartbeat 相同地直接丟棄。
                if (!leaseIsGone(error)) throw error;
                if (this.lease === lease) this.drop(lossFrom("lease_gone", error));
            },
        );
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
        this.state = this.build(null, nextEpoch(), null);
        // 已有同一 lease 的 release 在途時不重送；那個請求會照常送達。
        if (lease && this.releaseInFlight?.lease !== lease) this.fireRelease(lease.leaseId, lease.leaseToken);
    }

    heartbeatNow(evidence: HeartbeatViewerLeaseRequest): Promise<void> {
        return this.sendHeartbeat(evidence, false);
    }

    private settleRelease(lease: HeldLease): void {
        if (this.releaseInFlight?.lease === lease) this.releaseInFlight = null;
    }

    private build(lease: HeldLease | null, epoch: number, loss: ViewerCredentialsLoss | null): ViewerCredentials {
        return snapshot({
            userToken: this.options.userToken,
            leaseId: lease?.leaseId ?? null,
            leaseToken: lease?.leaseToken ?? null,
            leaseDetails: lease?.details ?? null,
            fallbackSourceClientId: this.options.fallbackSourceClientId,
            epoch,
            loss,
        });
    }

    private claim(): Promise<ViewerCredentials | null> {
        if (this.disposed) return Promise.resolve(null);
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
            if (!this.disposed) this.publishLoss(lossFrom("claim_failed", error));
            return null;
        }
        if (this.disposed) {
            if (granted?.lease_id && granted?.lease_token) this.fireRelease(granted.lease_id, granted.lease_token);
            return null;
        }
        const expiresAt = localExpiryOf(granted?.expires_at, granted?.claimed_at);
        const rejection = claimRejection(granted, expiresAt);
        if (rejection !== null || expiresAt === null) {
            // coordinator 仍可能已配出這個 lease：不採用，但也不留給到期回收。
            if (granted?.lease_id && granted?.lease_token) this.fireRelease(granted.lease_id, granted.lease_token);
            this.publishLoss(localLoss("claim_rejected", rejection ?? "expires_at missing"));
            return null;
        }
        this.lease = {
            leaseId: granted.lease_id,
            leaseToken: granted.lease_token,
            details: Object.freeze({
                kitInstanceId: nullableString(granted.kit_instance_id),
                userId: nullableString(granted.user_id),
                displayName: nullableString(granted.display_name),
            }),
            expiresAt,
            heartbeatAfterMs: granted.heartbeat_after_ms,
        };
        this.publish(this.build(this.lease, nextEpoch(), null));
        this.scheduleHeartbeat(heartbeatDelayMs(granted.heartbeat_after_ms));
        return this.state;
    }

    private scheduleHeartbeat(delayMs: number): void {
        this.clearHeartbeat();
        if (this.disposed || !this.lease) return;
        this.heartbeatTimer = setTimeout(() => {
            this.heartbeatTimer = null;
            void this.scheduledHeartbeat();
        }, Math.max(0, delayMs));
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private async scheduledHeartbeat(): Promise<void> {
        const lease = this.lease;
        if (this.disposed || !lease || this.dropIfExpired()) return;
        let evidence: HeartbeatViewerLeaseRequest;
        try {
            evidence = this.options.heartbeatEvidence?.() ?? {};
        } catch {
            this.retryHeartbeat(lease);
            return;
        }
        await this.sendHeartbeat(evidence, true);
    }

    private async sendHeartbeat(evidence: HeartbeatViewerLeaseRequest, retryOnFailure: boolean): Promise<void> {
        const lease = this.lease;
        if (this.disposed || !lease || this.dropIfExpired()) return;
        try {
            const refreshed = await this.options.transport.heartbeat(
                this.options.sessionId,
                lease.leaseId,
                lease.leaseToken,
                evidence,
            );
            if (this.disposed || this.lease !== lease) return;
            const expiresAt = localExpiryOf(refreshed?.expires_at, refreshed?.last_heartbeat_at);
            if (
                refreshed?.lease_id !== lease.leaseId
                || expiresAt === null
                || !Number.isFinite(refreshed.heartbeat_after_ms)
            ) {
                if (retryOnFailure) this.retryHeartbeat(lease);
                return;
            }
            lease.expiresAt = expiresAt;
            lease.heartbeatAfterMs = refreshed.heartbeat_after_ms;
            this.scheduleHeartbeat(heartbeatDelayMs(lease.heartbeatAfterMs));
        } catch (error) {
            if (this.disposed || this.lease !== lease) return;
            if (leaseIsGone(error)) {
                this.drop(lossFrom("lease_gone", error));
                return;
            }
            if (retryOnFailure) this.retryHeartbeat(lease);
        }
    }

    /** 暫時性失敗：到本機過期時間前持續重試。 */
    private retryHeartbeat(lease: HeldLease): void {
        const remaining = lease.expiresAt - Date.now();
        if (remaining <= 0) {
            this.drop(localLoss("expired", "primary viewer lease expired"));
            return;
        }
        this.scheduleHeartbeat(Math.min(heartbeatDelayMs(lease.heartbeatAfterMs), remaining));
    }

    /** 本機時間已超過到期時間就丟棄；回傳是否丟棄。 */
    private dropIfExpired(): boolean {
        if (!this.lease || this.lease.expiresAt > Date.now()) return false;
        this.drop(localLoss("expired", "primary viewer lease expired"));
        return true;
    }

    private drop(loss: ViewerCredentialsLoss): void {
        if (!this.lease) return;
        this.lease = null;
        this.clearHeartbeat();
        this.publish(this.build(null, nextEpoch(), loss));
    }

    private publishLoss(loss: ViewerCredentialsLoss): void {
        this.publish(this.build(this.lease, this.state.epoch, loss));
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

export function createHeldViewerCredentials(options: HeldViewerCredentialsOptions): HeldViewerCredentials {
    return new HeldSource(options);
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
        return snapshot({
            userToken,
            leaseId: leaseToken ? this.options.sourceClientId : null,
            leaseToken: leaseToken || null,
            leaseDetails: null,
            fallbackSourceClientId: this.options.sourceClientId,
            epoch: nextEpoch(),
            loss: null,
        });
    }
}

export function createBorrowedViewerCredentials(options: BorrowedViewerCredentialsOptions): BorrowedViewerCredentials {
    return new BorrowedSource(options);
}

export function isBorrowedViewerCredentials(source: ViewerCredentialsSource): source is BorrowedViewerCredentials {
    return typeof (source as Partial<BorrowedViewerCredentials>).accept === "function";
}
