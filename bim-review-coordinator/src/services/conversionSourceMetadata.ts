import { createHash } from "node:crypto";
import { conversionFactsSchema, type ConversionValidationFacts } from "./conversionValidationFacts.js";
import { sanitizeArtifactIdPart, type StreamingConversionResult } from "./streamingConversionClient.js";

export interface ConversionSourceBinding {
  conversionJobId: string; correlationId: string; tenantId: string;
  projectId: string; modelVersionId: string;
}
export interface ConversionSourceFacts {
  sourceSha256: string; sourceSizeBytes: number; modelVersionId: string;
  metadataSha256: string; declaredUsdcSha256: string; declaredMappingSha256: string;
  converterVersion: string | null; observation: "before_after_match";
  validation?: ConversionValidationFacts;
}
export type ConversionSourceReadResult =
  | { ok: true; facts: ConversionSourceFacts }
  | { ok: false; reason: "binding_invalid" | "result_identity_mismatch" |
      "artifact_invalid" | "metadata_unavailable" | "metadata_too_large" |
      "metadata_checksum_mismatch" | "metadata_invalid" };
type Reason = Extract<ConversionSourceReadResult, { ok: false }>["reason"];
const fail = (reason: Reason): ConversionSourceReadResult => ({ ok: false, reason });
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
function origin(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) throw new Error("Invalid configured origin.");
  return url.origin;
}
function descriptor(value: unknown, publisher: string, job: string, filename: string): string | null {
  const item = object(value);
  if (!item || typeof item.url !== "string" || typeof item.checksum_sha256 !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(item.checksum_sha256)) return null;
  return item.url === publisher + "/artifacts/" + job + "/" + filename
    ? item.checksum_sha256.toLowerCase() : null;
}

/** Internal read-only port. Metadata checksum is not independent source attestation,
 * and declared artifact digests do not prove their bytes or any GPU/purpose result. */
export async function readConversionSourceMetadata(input: {
  binding: ConversionSourceBinding; result: StreamingConversionResult;
  conversionOrigin: string; publicArtifactOrigin?: string; fetchImpl?: typeof fetch;
}): Promise<ConversionSourceReadResult> {
  let snapshot: Omit<typeof input, "fetchImpl">;
  try {
    snapshot = structuredClone({ binding: input.binding, result: input.result,
      conversionOrigin: input.conversionOrigin, publicArtifactOrigin: input.publicArtifactOrigin });
  } catch { return fail("binding_invalid"); }
  const { binding: b, result: r } = snapshot;
  if (!b || typeof b.conversionJobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(b.conversionJobId) ||
      [b.correlationId, b.tenantId, b.projectId, b.modelVersionId].some(
        value => typeof value !== "string" || !value.trim())) return fail("binding_invalid");
  const raw = object(r?.raw);
  const model = object(raw?.model);
  if (!raw || r.conversion_job_id !== b.conversionJobId || raw.conversion_job_id !== b.conversionJobId ||
      raw.authority !== "bim-streaming-server" || raw.ready !== true || r.ready !== true ||
      !["succeeded", "succeeded_with_warnings"].includes(String(raw.status)) || r.status !== raw.status ||
      (r.model_status !== undefined && r.model_status !== "ready") ||
      (raw.model !== undefined && (!model || (model.status !== undefined && model.status !== "ready"))) ||
      raw.tenant_id !== sanitizeArtifactIdPart(b.tenantId) ||
      raw.project_id !== sanitizeArtifactIdPart(b.projectId) ||
      raw.model_version_id !== sanitizeArtifactIdPart(b.modelVersionId) ||
      raw.correlation_id !== sanitizeArtifactIdPart(b.correlationId) ||
      r.correlation_id !== raw.correlation_id) return fail("result_identity_mismatch");
  let internal: string, publisher: string;
  try {
    internal = origin(snapshot.conversionOrigin);
    publisher = snapshot.publicArtifactOrigin ? origin(snapshot.publicArtifactOrigin) : internal;
  } catch { return fail("artifact_invalid"); }
  const artifacts = object(raw.artifacts);
  const metadataSha = descriptor(artifacts?.metadata, publisher, b.conversionJobId, "metadata.json");
  const usdcSha = descriptor(artifacts?.model_usdc, publisher, b.conversionJobId, "model.usdc");
  const mappingSha = descriptor(artifacts?.element_mapping, publisher, b.conversionJobId, "element_mapping.json");
  if (!metadataSha || !usdcSha || !mappingSha) return fail("artifact_invalid");
  const signal = AbortSignal.timeout(10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  let bytes: Buffer;
  try {
    const response = await (input.fetchImpl ?? fetch)(
      internal + "/artifacts/" + b.conversionJobId + "/metadata.json",
      { method: "GET", redirect: "error", headers: { Accept: "application/json" }, signal });
    if (response.status !== 200 || !response.body) {
      void response.body?.cancel().catch(() => {});
      return fail("metadata_unavailable");
    }
    reader = response.body.getReader();
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > MAX_METADATA_BYTES) return fail("metadata_too_large");
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Native fetch aborts body reads. Race explicitly also covers a pending injected stream.
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error("Metadata read aborted."));
      signal.addEventListener("abort", rejectAbort, { once: true });
      if (signal.aborted) rejectAbort();
    });
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), aborted]);
        if (chunk.done) { finished = true; break; }
        total += chunk.value.byteLength;
        if (total > MAX_METADATA_BYTES) return fail("metadata_too_large");
        chunks.push(chunk.value.slice());
      }
      bytes = Buffer.concat(chunks, total);
    } finally {
      if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
    }
  } catch { return fail("metadata_unavailable"); }
  finally {
    if (reader) {
      // Cancellation must not let a stalled upstream delay the bounded failure.
      if (!finished) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (createHash("sha256").update(bytes).digest("hex") !== metadataSha)
    return fail("metadata_checksum_mismatch");
  try {
    const metadata = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const fingerprint = object(metadata?.source_fingerprint);
    if (!fingerprint || fingerprint.schema_version !== "ifc-source-fingerprint/v1" ||
        fingerprint.observation !== "before_after_match" ||
        typeof fingerprint.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint.sha256) ||
        typeof fingerprint.size_bytes !== "number" || !Number.isSafeInteger(fingerprint.size_bytes) ||
        fingerprint.size_bytes < 0 || fingerprint.model_version_id !== sanitizeArtifactIdPart(b.modelVersionId))
      return fail("metadata_invalid");
    const version = metadata?.converter_version;
    const validation = metadata?.conversion_validation === undefined ? undefined
      : conversionFactsSchema.parse(metadata.conversion_validation);
    if (validation && (validation.sourceSha256 !== fingerprint.sha256 ||
        validation.modelVersionId !== fingerprint.model_version_id ||
        validation.artifacts.usdcSha256 !== usdcSha || validation.artifacts.mappingSha256 !== mappingSha))
      return fail("metadata_invalid");
    if (version !== undefined && (typeof version !== "string" || !version.trim() || version.length > 256))
      return fail("metadata_invalid");
    return { ok: true, facts: {
      sourceSha256: fingerprint.sha256, sourceSizeBytes: fingerprint.size_bytes,
      modelVersionId: b.modelVersionId, metadataSha256: metadataSha,
      declaredUsdcSha256: usdcSha, declaredMappingSha256: mappingSha,
      converterVersion: typeof version === "string" ? version : null,
      observation: "before_after_match",
      ...(validation ? { validation } : {}),
    } };
  } catch { return fail("metadata_invalid"); }
}
