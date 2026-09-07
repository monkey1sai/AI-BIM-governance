/**
 * #809 第 5 項：MinIO watcher intake 的 in-process provenance。
 *
 * watcher（minioWatchSurface）與外部 IFC worker 走同一條公開 `/api/external/ifc-ready`、
 * 同一把 webhook secret，request 本身沒有任何可信的來源訊號；`mw_` key 形狀是 caller 可控的。
 * 唯一外部呼叫者做不到的事，是在 coordinator process 內、self-POST 之前先登記
 * (idempotency_key, correlation_id)。route 消費到登記才把 job 標成 `intake_source="minio_watch"`，
 * 之後只有這種 job 的 auto session 才會綁 `ready_model_id`。
 *
 * 一次性消費：第一個帶同一組鍵的 request 拿走登記；watcher 重試（transient download 失敗、
 * 下一輪 tick）會重新 expect。TTL 防止 self-POST 從未送達時無限累積。
 */
const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_PENDING = 10_000;

export type IntakeSource = "minio_watch" | "external";

export class WatcherIntakeRegistry {
  private readonly pending = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** watcher 在 self-POST 之前呼叫。 */
  expect(idempotencyKey: string, correlationId: string): void {
    this.sweep();
    if (this.pending.size >= MAX_PENDING) return;
    this.pending.set(keyOf(idempotencyKey, correlationId), this.now() + this.ttlMs);
  }

  /** intake route 對每個已驗證的 request 呼叫一次；命中即消費，回 true 代表 watcher 來源。 */
  consume(idempotencyKey: string, correlationId: string): boolean {
    this.sweep();
    const key = keyOf(idempotencyKey, correlationId);
    const expiresAt = this.pending.get(key);
    if (expiresAt === undefined) return false;
    this.pending.delete(key);
    return expiresAt >= this.now();
  }

  /** @internal 測試觀測用。 */
  get size(): number {
    return this.pending.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.pending) {
      if (expiresAt < now) this.pending.delete(key);
    }
  }
}

function keyOf(idempotencyKey: string, correlationId: string): string {
  return `${idempotencyKey}\n${correlationId}`;
}
