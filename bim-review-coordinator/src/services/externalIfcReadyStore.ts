import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeArtifactIdPart } from "./streamingConversionClient.js";
import { maskPresignedRef } from "./presignedRef.js";
import type { ExternalIfcReadyEvent, IfcReadyIntakeJob, ShadowMetadata } from "../types.js";

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T3 §4.3）。
 *
 * 對外 IFC-ready intake 的 idempotency + 本地 conversion job 狀態。
 * 以 `idempotency_key` 為主鍵去重（並對 `correlation_id` 做次要去重），
 * 每個 job 綁定 `external_model_version_id` 供後續雲端 callback 關聯（T5）。
 *
 * 最小本地 shadow（in-memory；非 mirror 公司 MySQL）。長期投遞保證屬
 * T5 callback outbox，不在本 store 範圍。
 */
export class ExternalIfcReadyStore {
  private readonly jobsById = new Map<string, IfcReadyIntakeJob>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly correlationIndex = new Map<string, string>();
  /**
   * S2（2026-07-10）：JSON 持久化（**env opt-in**，比照 conversionLedger 的 atomic tmp+rename）。
   * 未設 EXTERNAL_IFC_READY_STORE_PATH 且未傳 persistencePath ＝維持原 volatile 行為
   * （既有測試與 app.ts 呼叫點零變更；.env.example 受工作區保護未登 key，部署區自行加 env 啟用）。
   * 修的 split-brain：coordinator 重啟後 ConversionLedger（已持久化）有紀錄、來源 job 消失。
   * 載入時誠實調和 in-flight 狀態：queued_for_conversion → dropped_on_restart（dispatch queue
   * 本身仍 volatile）；downloading → download failed（下載已中斷）。dispatched 保留原樣
   * （轉檔權威在 streaming-server，coordinator 重啟不否定其進行中結果；殘留 stale 由
   * ledger/輪詢面處理，不在本 store 擅自改寫）。
   */
  private readonly persistencePath: string | null;
  /**
   * conversion-artifact-id-sanitize（PR #206 review 修補）：sanitize 後 correlation 鍵
   * 與原始鍵分桶。只供 conversion 結果回拋（getByCorrelation fallback）查詢，
   * SHALL NOT 參與 intake 去重（findExisting）— 否則另一請求若以 sanitize 字串
   * 為真實 X-Correlation-Id，會被誤判成既有 job 的 idempotent replay（aliasing）。
   */
  private readonly sanitizedCorrelationIndex = new Map<string, string>();

  constructor(persistencePath?: string) {
    this.persistencePath = persistencePath ?? process.env.EXTERNAL_IFC_READY_STORE_PATH ?? null;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    let parsed: { jobs?: IfcReadyIntakeJob[] };
    try {
      parsed = JSON.parse(fs.readFileSync(this.persistencePath, "utf-8")) as { jobs?: IfcReadyIntakeJob[] };
    } catch {
      // 壞檔不 crash：誠實空啟動（比照 conversionLedger），舊檔會在下次 persist 被覆寫。
      return;
    }
    for (const job of parsed.jobs ?? []) {
      if (!job?.ifc_ready_job_id) continue;
      // 重啟調和（誠實）：in-flight 狀態不可能跨行程存活。
      if (job.status === "queued_for_conversion") {
        job.status = "dropped_on_restart";
        job.queue_position = null;
        job.dispatch_error = "coordinator restart dropped in-memory queue; operator must re-POST";
        job.updated_at = new Date().toISOString();
      }
      if (job.download_status === "downloading") {
        job.download_status = "failed";
        job.download_failure = "coordinator restart interrupted download; operator must re-POST";
        job.updated_at = new Date().toISOString();
      }
      this.jobsById.set(job.ifc_ready_job_id, job);
      this.idempotencyIndex.set(job.idempotency_key, job.ifc_ready_job_id);
      this.registerCorrelationKeys(job.correlation_id, job.ifc_ready_job_id);
    }
  }

  /** atomic tmp+rename（比照 conversionLedger.persist）；持久化失敗不拋出（不阻斷 intake 主流程）。 */
  private persist(): void {
    if (!this.persistencePath) return;
    try {
      const dir = path.dirname(this.persistencePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.persistencePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ jobs: Array.from(this.jobsById.values()) }, null, 2), "utf-8");
      fs.renameSync(tmp, this.persistencePath);
    } catch {
      // 磁碟寫入失敗不 crash intake；下次 mutation 再試。
    }
  }

  /** 依 idempotency_key（或 correlation_id）回傳既有 job（idempotent replay）。 */
  findExisting(idempotencyKey: string, correlationId: string): IfcReadyIntakeJob | undefined {
    const byIdem = this.idempotencyIndex.get(idempotencyKey);
    if (byIdem) return this.jobsById.get(byIdem);
    const byCorr = this.correlationIndex.get(correlationId);
    if (byCorr) return this.jobsById.get(byCorr);
    return undefined;
  }

  create(
    event: ExternalIfcReadyEvent,
    binding: {
      correlationId: string;
      idempotencyKey: string;
      tenantId: string;
      projectId: string;
      externalModelVersionId: string;
    },
  ): IfcReadyIntakeJob {
    const now = new Date().toISOString();
    const jobId = `ifcready_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const job: IfcReadyIntakeJob = {
      ifc_ready_job_id: jobId,
      status: "accepted",
      idempotent_replay: false,
      correlation_id: binding.correlationId,
      idempotency_key: binding.idempotencyKey,
      tenant_id: binding.tenantId,
      project_id: binding.projectId,
      project_display_name: event.project_display_name ?? null,
      category: event.model_category ?? null,
      external_model_version_id: binding.externalModelVersionId,
      external_conversion_task_id: event.external_conversion_task_id ?? null,
      source_ifc_ref: event.source_ifc.ref,
      source_ifc_etag: event.source_ifc.etag,
      callback_url: event.callback_url ?? null,
      conversion_job_id: null,
      conversion_status: null,
      conversion_authority: null,
      dispatch_error: null,
      // coordinator-serial-conversion-dispatch-queue:預設 null,在 enqueue
      // 階段被 markQueuedForConversion 改為 1-based,dispatched 後清回 null。
      queue_position: null,
      // fast-ifc-link-demo-loop §2:新 job 預設 download_status="pending",
      // app handler 進入同步下載後改為 downloading / downloaded / failed。
      download_status: "pending",
      download_failure: null,
      local_path: null,
      host_local_path: null,
      web_view_session_id: null,
      viewer_url: null,
      created_at: now,
      updated_at: now,
    };
    this.jobsById.set(jobId, job);
    this.idempotencyIndex.set(binding.idempotencyKey, jobId);
    this.registerCorrelationKeys(binding.correlationId, jobId);
    this.persist();
    return job;
  }

  /**
   * conversion-artifact-id-sanitize（spec 2026-06-11，cr1 對抗複驗回歸修補）：
   * coordinator dispatch 時對 correlation_id 跑 sanitize（worker 派生含冒號者會被
   * 改寫），conversion authority 儲存/回傳的是 **sanitize 後** correlation_id。
   * 結果回拋（ingestConversionReport → getByCorrelation）以該 sanitize 後鍵查詢，
   * 若只登原始鍵則必 404 閉環斷裂。故原始鍵登 correlationIndex、sanitize 後鍵
   * 登獨立的 sanitizedCorrelationIndex（兩者相同時不重複登記），讓兩種回拋都
   * 命中同一 job，且 sanitize 鍵不污染 intake 去重域（見 index 宣告處註解）。
   */
  private registerCorrelationKeys(correlationId: string, jobId: string): void {
    this.correlationIndex.set(correlationId, jobId);
    const sanitized = sanitizeArtifactIdPart(correlationId);
    if (sanitized !== correlationId) {
      this.sanitizedCorrelationIndex.set(sanitized, jobId);
    }
  }

  /**
   * ifc-ready-api-field-redesign（replay 可見性）：idempotent replay 命中既有 job 時，將
   * idempotent_replay 持久寫回 job record，使列表/詳情端點（summarizeIfcReadyJob）能誠實呈現
   * 「命中既有 job（去重生效可見）」（spec §111/§140）。原本僅在 200 replay 回應物件上覆寫
   * idempotent_replay:true、未寫回 store，導致列表投影 job.idempotent_replay 恆為 false。
   */
  markIdempotentReplay(jobId: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.idempotent_replay = true;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  markDispatched(jobId: string, conversionJobId: string, conversionStatus: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.status = "dispatched";
    job.conversion_job_id = conversionJobId;
    job.conversion_status = conversionStatus;
    job.conversion_authority = "bim-streaming-server";
    job.dispatch_error = null;
    // coordinator-serial-conversion-dispatch-queue:離開 queue,清 1-based 位置。
    job.queue_position = null;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /** coordinator-serial-conversion-dispatch-queue:downloaded 後等待 dispatch slot。 */
  markQueuedForConversion(jobId: string, queuePosition: number): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.status = "queued_for_conversion";
    job.queue_position = queuePosition;
    job.dispatch_error = null;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /**
   * coordinator-serial-conversion-dispatch-queue:coordinator process 重啟或
   * queue 被顯式 drain 時,標記未及 dispatch 的 job。operator 須重新 POST。
   */
  markDroppedOnRestart(jobId: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.status = "dropped_on_restart";
    job.queue_position = null;
    job.dispatch_error = "coordinator restart dropped in-memory queue; operator must re-POST";
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /** fast-ifc-link-demo-loop §2.2:進入同步下載階段。 */
  markDownloading(jobId: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.download_status = "downloading";
    job.download_failure = null;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /** fast-ifc-link-demo-loop §2.2:同步下載完成,寫入 local_path / host_local_path。 */
  markDownloaded(jobId: string, localPath: string, hostLocalPath: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.download_status = "downloaded";
    job.download_failure = null;
    job.local_path = localPath;
    job.host_local_path = hostLocalPath;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /** fast-ifc-link-demo-loop §2.2:同步下載失敗(timeout / network / write)。不 dispatch。 */
  markDownloadFailed(jobId: string, failure: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.download_status = "failed";
    job.download_failure = failure;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /** fast-ifc-link-demo-loop §3.2:轉檔 ready 時,coordinator 自動 spawn local web view session 並寫 viewer_url。 */
  setViewerLink(jobId: string, webViewSessionId: string, viewerUrl: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.web_view_session_id = webViewSessionId;
    job.viewer_url = viewerUrl;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  markDispatchFailed(jobId: string, error: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    // ifc-ready 已被接受並落地（local job + binding 已建立）；轉檔派工失敗
    // 為可重試狀態（重試/補派屬 T4/T5），不否定 intake 本身。
    job.status = "dispatch_failed";
    job.conversion_status = "dispatch_failed";
    job.dispatch_error = error;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /**
   * conversion 結果回拋對帳。原始鍵與 sanitize 鍵都列入候選；當兩者指向不同 job
   * （collision：某 job 的 sanitize 值恰等於另一 job 的真實 correlation）時，
   * 以 report 的 `conversion_job_id` 對 job 的 `conversion_job_id` 消歧，
   * 不單靠 correlation 字串裁決（PR #206 review P2）。無法消歧時維持原始鍵優先。
   */
  getByCorrelation(correlationId: string, conversionJobId: string | null = null): IfcReadyIntakeJob | undefined {
    const candidateIds = [this.correlationIndex.get(correlationId), this.sanitizedCorrelationIndex.get(correlationId)];
    const candidates = [...new Set(candidateIds)]
      .filter((id): id is string => Boolean(id))
      .map((id) => this.jobsById.get(id))
      .filter((job): job is IfcReadyIntakeJob => Boolean(job));
    if (candidates.length === 0) return undefined;
    if (conversionJobId) {
      const matched = candidates.find((job) => job.conversion_job_id === conversionJobId);
      if (matched) return matched;
    }
    return candidates[0];
  }

  /**
   * backfill-coordinator-webhook-and-auto-session §2 (D10/D11)：
   * 寫入 conversion-ready ingestion 自動建立的 review_session_id 反向參照，
   * 供 idempotent re-entry（同 correlation_id / external_model_version_id 重入）
   * 直接定位既有 session，不重複建立 active session。
   * 與 callback outbox 狀態獨立分類。
   */
  recordReviewSession(jobId: string, reviewSessionId: string): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.review_session_id = reviewSessionId;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /**
   * T5：記錄 conversion 結果 + 連結雲端 callback outbox。
   * callback 投遞狀態與 conversion 成功**分離**——此處只更新 conversion_status
   * 與 callback 連結；callback 是否 ack 由 outbox 各自追蹤，不回寫否定本地結果。
   */
  recordConversionOutcome(
    jobId: string,
    conversionStatus: "ready" | "failed",
    callbackOutboxId: string,
    artifactManifestRef?: string | null,
    conversionFailure?: string | null,
  ): IfcReadyIntakeJob | undefined {
    const job = this.jobsById.get(jobId);
    if (!job) return undefined;
    job.conversion_status = conversionStatus;
    job.callback_outbox_id = callbackOutboxId;
    if (artifactManifestRef !== undefined) {
      job.artifact_manifest_ref = artifactManifestRef;
    }
    // ifc-ready-api-field-redesign(quality Important #1):失敗時記錄轉檔權威回報的原因文字
    //（供 deriveFailure 投影 failure_stage="conversion"）；ready 時清空,誠實不留舊失敗殘留。
    job.conversion_failure = conversionStatus === "failed" ? (conversionFailure ?? "conversion_failed") : null;
    job.updated_at = new Date().toISOString();
    this.persist();
    return job;
  }

  /**
   * T6 §7.1：投影為最小 shadow metadata 欄位集（**不 mirror 公司 MySQL**）。
   * callback_status / last_callback_attempt_at 來自連結的 outbox entry（傳入），
   * control-plane 權威欄位（user/RBAC/license/version 歷史）一律不納入。
   *
   * 誠實鐵律（presigned 簽章遮蔽）：source_ifc_ref 在此 DTO 出口即剝除 presigned
   * 簽章（maskPresignedRef），shadow_metadata 對外永遠不含 X-Amz-* 簽章，與 list /
   * local-web-view session 出口一致。
   */
  toShadowMetadata(
    job: IfcReadyIntakeJob,
    callback?: { status: string; lastAttemptAt: string | null },
  ): ShadowMetadata {
    return {
      tenant_id: job.tenant_id,
      project_id: job.project_id,
      external_model_version_id: job.external_model_version_id,
      external_conversion_task_id: job.external_conversion_task_id ?? null,
      correlation_id: job.correlation_id,
      source_ifc_ref: maskPresignedRef(job.source_ifc_ref),
      source_ifc_etag: job.source_ifc_etag,
      conversion_job_id: job.conversion_job_id,
      artifact_manifest_ref: job.artifact_manifest_ref ?? null,
      callback_url: job.callback_url ?? null,
      callback_status: callback?.status ?? "not_enqueued",
      last_callback_attempt_at: callback?.lastAttemptAt ?? null,
    };
  }

  get(jobId: string): IfcReadyIntakeJob | undefined {
    return this.jobsById.get(jobId);
  }

  list(): IfcReadyIntakeJob[] {
    return Array.from(this.jobsById.values());
  }
}
