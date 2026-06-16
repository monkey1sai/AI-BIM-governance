/**
 * coordinator-serial-conversion-dispatch-queue
 *
 * In-memory FIFO that serializes the dispatch step
 * (`POST /api/conversions/ifc-to-usdc`) from coordinator to
 * `bim-streaming-server`. Only one job is in-flight at any time; additional jobs
 * wait with `queued_for_conversion` lifecycle + integer queue_position.
 *
 * Not a generic queue. Not disk-persistent. Not cross-process.
 * On coordinator restart the in-memory queue is empty; the spec-level
 * `dropped_on_restart` lifecycle is applied via {@link drain} when callers
 * (e.g. tests, future graceful-shutdown hooks) explicitly drain.
 */
export type DispatcherFn = (jobId: string) => Promise<void>;

export class ConversionDispatchQueue {
  private readonly queued: string[] = [];
  private inFlightJobId: string | null = null;
  private dispatcher: DispatcherFn | null = null;
  private workerActive = false;

  /** Inject the dispatcher closure. Must be called before {@link enqueue}. */
  setDispatcher(dispatcher: DispatcherFn): void {
    this.dispatcher = dispatcher;
  }

  enqueue(jobId: string): void {
    this.queued.push(jobId);
    void this.runWorker();
  }

  /**
   * Returns 0 when `jobId` is the in-flight job, 1-based position when queued,
   * or `null` when not present.
   */
  getQueuePosition(jobId: string): number | null {
    if (this.inFlightJobId === jobId) return 0;
    const index = this.queued.indexOf(jobId);
    return index === -1 ? null : index + 1;
  }

  getInFlight(): string | null {
    return this.inFlightJobId;
  }

  getQueuedJobIds(): string[] {
    return [...this.queued];
  }

  /**
   * Drain all queued (not-yet-dispatched) job ids. Does not affect in-flight
   * dispatch (in-flight may still complete naturally). Returns dropped ids so
   * callers can mark them `dropped_on_restart` in the store.
   */
  drain(): string[] {
    const dropped = this.queued.splice(0, this.queued.length);
    return dropped;
  }

  /**
   * 把 queued job 移到隊首（插隊）。in-flight 不可被搶下；不碰 worker。
   * 回 true：已在隊首（no-op）或成功移到隊首；回 false：in-flight 或不在 queue。
   */
  prioritize(jobId: string): boolean {
    const index = this.queued.indexOf(jobId);
    if (index === -1) return false;
    if (index === 0) return true;
    this.queued.splice(index, 1);
    this.queued.unshift(jobId);
    return true;
  }

  /** 重新 enqueue（retry 用）並回新的 1-based queue position。 */
  requeue(jobId: string): number {
    this.enqueue(jobId);
    return this.getQueuePosition(jobId) ?? 0;
  }

  private async runWorker(): Promise<void> {
    if (this.workerActive) return;
    this.workerActive = true;
    try {
      while (this.queued.length > 0) {
        const jobId = this.queued.shift()!;
        this.inFlightJobId = jobId;
        const dispatcher = this.dispatcher;
        if (!dispatcher) {
          // Dispatcher not yet wired; drop in-flight back to queue head and
          // bail. Test harness should always setDispatcher before enqueue.
          this.queued.unshift(jobId);
          this.inFlightJobId = null;
          return;
        }
        try {
          await dispatcher(jobId);
        } catch {
          // Dispatcher already records failure into the store; never let an
          // in-flight failure block the worker loop.
        } finally {
          this.inFlightJobId = null;
        }
      }
    } finally {
      this.workerActive = false;
    }
  }
}
