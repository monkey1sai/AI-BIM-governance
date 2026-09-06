import type { ConversionLedgerRecord } from "./conversionLedger.js";
import type { ObjectStorePort } from "./minioObjectStore.js";
import { deriveIntakeFromKey, idempotencyKeyFor, stripEtagQuotes } from "./minioWatcher.js";

/** Internal identity only. No presigned URLs or local paths belong in public responses. */
export interface ReadySourceIdentity {
  readyModelId: string;
  tenantId: string;
  bucket: string;
  key: string;
  etag: string;
}

export type ReadySourceResolution =
  | { ok: true; source: ReadySourceIdentity }
  | { ok: false; reason: "source_scope_invalid" | "source_not_found" | "source_ambiguous" | "source_changed" | "source_unavailable" };

/** Resolve legacy ledger rows by exact bucket/key/ETag hash, never project/version guessing.
 * Read-only: this function does not dispatch conversion or create an IFC-ready job.
 */
export async function resolveReadySourceIdentity(input: {
  record: ConversionLedgerRecord;
  tenantId: string;
  bucket: string;
  prefix: string;
  keySuffix: string;
  store: Pick<ObjectStorePort, "listObjects" | "headEtag">;
}): Promise<ReadySourceResolution> {
  const record = structuredClone(input.record);
  if (record.status !== "ready" || !/^mw_[a-f0-9]{16}$/.test(record.idempotency_key)
    || !input.tenantId.trim() || !input.bucket || /[|\r\n]/.test(input.bucket)
    || (input.prefix !== "" && !input.prefix.endsWith("/")) || !input.keySuffix.startsWith("/")
    || (record.bucket !== null && record.bucket !== input.bucket)) {
    return { ok: false, reason: "source_scope_invalid" };
  }
  try {
    // Read the raw complete adapter listing, not browse rows that can omit unsupported keys.
    const listed = await input.store.listObjects(input.prefix);
    const matches = listed.filter(object => {
      if (object.key.includes("|") || /[\r\n]/.test(object.key)) return false;
      const etag = stripEtagQuotes(object.etag);
      if (!etag || /[|\r\n]/.test(etag)) return false;
      return idempotencyKeyFor(input.bucket, object.key, etag) === record.idempotency_key;
    });
    if (matches.length === 0) return { ok: false, reason: "source_not_found" };
    if (matches.length !== 1) return { ok: false, reason: "source_ambiguous" };
    const match = matches[0];
    const derived = deriveIntakeFromKey({ key: match.key, prefix: input.prefix, keySuffix: input.keySuffix });
    if (!derived.ok || derived.projectId !== record.project_id || derived.category !== record.category
      || derived.externalModelVersionId !== record.external_model_version_id
      || (record.object_key !== null && record.object_key !== match.key)) {
      return { ok: false, reason: "source_scope_invalid" };
    }
    const etag = stripEtagQuotes(match.etag);
    const currentEtag = await input.store.headEtag(match.key);
    if (!currentEtag || stripEtagQuotes(currentEtag) !== etag) return { ok: false, reason: "source_changed" };
    return { ok: true, source: { readyModelId: record.idempotency_key, tenantId: input.tenantId,
      bucket: input.bucket, key: match.key, etag } };
  } catch {
    // Never propagate SDK messages that can contain private object keys or endpoint details.
    return { ok: false, reason: "source_unavailable" };
  }
}
