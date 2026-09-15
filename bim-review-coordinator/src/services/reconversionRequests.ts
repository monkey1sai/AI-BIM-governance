import { ConversionLedger } from "./conversionLedger.js";
import { correlationIdFor, deriveIntakeFromKey, idempotencyKeyFor } from "./minioWatcher.js";
import type { ManualTriggerOutcome, MinioWatchSurface } from "./minioWatchSurface.js";

type Reply = { status: number; body: Record<string, unknown> };
export type ReconversionIntent = { key: string; requestId: string; expectedEtag: string };

/** Reserve before dispatch. Lost responses reuse the same intent; new intents never
 * overwrite old results. The HTTP boundary must authorize before calling submit.
 */
export class ReconversionRequests {
  private readonly running = new Map<string, { etag: string; promise: Promise<Reply> }>();
  constructor(private readonly options: {
    ledger: ConversionLedger; bucket: string; prefix: string; keySuffix: string;
    trigger: MinioWatchSurface["manualTrigger"];
  }) {}

  async submit(intent: ReconversionIntent): Promise<Reply> {
    const { ledger, bucket, prefix, keySuffix } = this.options;
    const { key, requestId, expectedEtag } = intent;
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)
      || !/^[A-Za-z0-9_-]{1,256}$/.test(expectedEtag)
      || key.includes("|") || Buffer.byteLength(key, "utf8") > 1024) {
      return { status: 400, body: { error_code: "invalid_reconversion_intent" } };
    }
    const derived = deriveIntakeFromKey({ key, prefix, keySuffix });
    if (!derived.ok) return { status: 400, body: { error_code: "invalid_source_key" } };
    const attemptSalt = `intent_${requestId}`;
    const input = `${key}#${attemptSalt}`;
    const id = idempotencyKeyFor(bucket, key, input);
    const conflict = (): Reply => ({ status: 409, body: { error_code: "reconversion_intent_conflict" } });
    const running = this.running.get(id);
    if (running) return running.etag === expectedEtag ? running.promise : conflict();
    const existing = ledger.get(id);
    if (existing && (existing.source_etag !== expectedEtag || existing.object_key !== key || existing.bucket !== bucket)) return conflict();
    // Never create another job merely because the ephemeral intake store was lost.
    if (existing && existing.status !== "detected") {
      return { status: 200, body: { ready_model_id: id, status: existing.status,
        conversion_job_id: existing.conversion_job_id, intent_replay: true } };
    }
    const sourceId = idempotencyKeyFor(bucket, key, expectedEtag);
    const active = ledger.list().find(row => row.idempotency_key !== id
      && ((row.bucket === bucket && row.object_key === key) || row.idempotency_key === sourceId)
      && ["detected", "queued", "converting"].includes(row.status));
    if (active) return { status: 409, body: { error_code: "conversion_in_progress", ready_model_id: active.idempotency_key } };
    ledger.upsert({ idempotency_key: id, correlation_id: correlationIdFor(bucket, key, input),
      project_id: derived.projectId, project_display_name: derived.projectDisplayName,
      category: derived.category, external_model_version_id: derived.externalModelVersionId,
      object_key: key, bucket, source_etag: expectedEtag, status: "detected", conversion_job_id: null,
    }, new Date().toISOString());
    const promise = this.dispatch(intent, id, attemptSalt);
    this.running.set(id, { etag: expectedEtag, promise });
    try { return await promise; } finally { this.running.delete(id); }
  }

  private async dispatch(intent: ReconversionIntent, id: string, attemptSalt: string): Promise<Reply> {
    let outcome: ManualTriggerOutcome;
    try {
      outcome = await this.options.trigger(intent.key, { forceRetrigger: true, attemptSalt, expectedEtag: intent.expectedEtag });
    } catch {
      return { status: 502, body: { error_code: "reconversion_outcome_unknown", ready_model_id: id } };
    }
    // Transport failures are uncertain. Keep the reservation and retry the same intent.
    if (outcome.kind !== "upstream") return { status: 502, body: { error_code: "reconversion_outcome_unknown", ready_model_id: id } };
    if ((outcome.status >= 400 && outcome.status < 500) || outcome.body.download_status === "failed") {
      const row = this.options.ledger.get(id);
      if (row?.status === "detected") this.options.ledger.upsert({ ...row, status: "failed",
        failure_code: outcome.body.error_code === "source_changed" || outcome.body.reason === "source_changed"
          ? "source_changed" : outcome.body.download_status === "failed" ? "source_download_failed" : "conversion_failed",
      }, new Date().toISOString());
    }
    return { status: outcome.status, body: { ...outcome.body, ready_model_id: id, intent_replay: false } };
  }
}
