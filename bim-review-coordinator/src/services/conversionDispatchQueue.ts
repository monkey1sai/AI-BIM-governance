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

  /**
   * 重新 enqueue（retry 用）並回 1-based queue position。
   *
   * Idempotent：若 `jobId` 已在 queue（queued[]），視為 no-op 直接回現有 1-based
   * position（不重複 append）。這道去重防線在此 method 內自足，不依賴上游 route
   * 的 state guard——避免 retry 被重複觸發（雙擊／競態的兩個 HTTP 請求）時把同一
   * jobId append 兩次，導致 worker 對 downstream streaming server 重複 dispatch。
   *
   * 若 `jobId` 正 in-flight，回 `null`：in-flight job 重新 enqueue 無意義（worker
   * 正在派工），且 `getQueuePosition` 對 in-flight 回的 0 是 in-flight 專用哨兵
   * （見 {@link getQueuePosition}）。requeue **不可**把這個 0 當 position 洩漏出去
   * ——否則 retry route 的 `markQueuedForConversion(id, 0)` 會讓下游讀者（前端／
   * 監控）誤判該 job 為 in-flight 而非排隊中。呼叫端（retry route）的狀態守門已
   * 排除 in-flight，故正常路徑不會走到此分支；此 null 是合約自足的安全網。
   */
  requeue(jobId: string): number | null {
    // 單一守門:直接讀 getQueuePosition 一次,依其三態裁決,不疊第二道 inFlightJobId 檢查
    // (避免 fragile dual-guard——若日後有人移除其中一道,0 哨兵可能洩漏)。
    const pos = this.getQueuePosition(jobId);
    if (pos === 0) return null; // in-flight:0 是 in-flight 專用哨兵,requeue 無意義且不可洩漏
    if (pos !== null) return pos; // 已排隊(1-based):冪等,回現有 position
    this.enqueue(jobId); // 不在 queue:重新入列
    return this.getQueuePosition(jobId);
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
