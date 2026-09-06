import type { ConversionLedgerRecord } from "./conversionLedger.js";
import { sanitizeArtifactIdPart, type StreamingConversionResult } from "./streamingConversionClient.js";
import { isIfcReadySessionTraceId } from "./sessionStore.js";

/** Internal descriptor only. Never serialize this object through public ledger APIs. */
export interface ReadyRenderBundle {
  readyModelId: string;
  conversionJobId: string;
  correlationId: string;
  rootTraceId: string;
  tenantId: string;
  projectId: string;
  modelVersionId: string;
  model: { url: string; sha256: string };
  mapping: { url: string; sha256: string };
}

export function validateCachedRenderBundle(value: unknown, record: ConversionLedgerRecord, tenantId: string, origin: string): ReadyRenderBundle | null {
  const bundle = object(value);
  if (!bundle || bundle.readyModelId !== record.idempotency_key || bundle.conversionJobId !== record.conversion_job_id
    || bundle.correlationId !== record.correlation_id
    || bundle.tenantId !== tenantId || bundle.projectId !== record.project_id
    || bundle.modelVersionId !== record.external_model_version_id || !isIfcReadySessionTraceId(bundle.rootTraceId)
    || typeof bundle.conversionJobId !== "string" || !/^[A-Za-z0-9_-]+$/.test(bundle.conversionJobId)) return null;
  const modelValue = object(bundle.model);
  const mappingValue = object(bundle.mapping);
  const model = artifact({ url: modelValue?.url, checksum_sha256: modelValue?.sha256 }, origin, bundle.conversionJobId, "model.usdc");
  const mapping = artifact({ url: mappingValue?.url, checksum_sha256: mappingValue?.sha256 }, origin, bundle.conversionJobId, "element_mapping.json");
  if (!model || !mapping || (record.usdc_key !== null && record.usdc_key !== model.url)) return null;
  return { readyModelId: record.idempotency_key, conversionJobId: bundle.conversionJobId, correlationId: bundle.correlationId as string,
    rootTraceId: bundle.rootTraceId, tenantId, projectId: record.project_id,
    modelVersionId: record.external_model_version_id, model, mapping };
}

export type ReadyRenderResolution =
  | { ok: true; bundle: ReadyRenderBundle }
  | { ok: false; reason: "record_not_ready" | "result_unavailable" | "result_identity_mismatch" | "artifact_invalid" };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function artifact(value: unknown, origin: string, jobId: string, filename: string): ReadyRenderBundle["model"] | null {
  const entry = object(value);
  if (!entry || typeof entry.url !== "string" || typeof entry.checksum_sha256 !== "string"
    || !/^[a-fA-F0-9]{64}$/.test(entry.checksum_sha256)) return null;
  try {
    const configured = new URL(origin);
    const url = new URL(entry.url);
    const expectedPath = `/artifacts/${jobId}/${filename}`;
    if (!["http:", "https:"].includes(configured.protocol) || configured.username || configured.password
      || url.origin !== configured.origin || url.username || url.password || url.search || url.hash
      || url.pathname !== expectedPath
      || entry.url !== `${url.origin}${expectedPath}`) return null;
    return { url: url.href, sha256: entry.checksum_sha256.toLowerCase() };
  } catch { return null; }
}

/** Read-only resolution: no intake store, conversion dispatch, callback, or session side effects.
 * Validates authority metadata; it does NOT prove artifact bytes/readability or GPU readiness.
 * The caller must supply the configured tenant, not a browser-supplied identity.
 */
export async function resolveReadyRenderBundle(input: {
  record: ConversionLedgerRecord;
  configuredTenantId: string;
  conversionOrigin: string;
  fetchResult: (jobId: string) => Promise<StreamingConversionResult>;
}): Promise<ReadyRenderResolution> {
  const record = structuredClone(input.record);
  const jobId = record.conversion_job_id;
  if (record.status !== "ready" || !/^mw_[a-f0-9]{16}$/.test(record.idempotency_key)
    || !jobId || !/^[A-Za-z0-9_-]+$/.test(jobId)
    || !record.correlation_id || !record.project_id || !record.external_model_version_id
    || !input.configuredTenantId.trim()) return { ok: false, reason: "record_not_ready" };
  if (record.ready_render_bundle !== undefined) {
    const bundle = validateCachedRenderBundle(record.ready_render_bundle, record, input.configuredTenantId, input.conversionOrigin);
    return bundle ? { ok: true, bundle } : { ok: false, reason: "artifact_invalid" };
  }
  let result: StreamingConversionResult;
  try { result = await input.fetchResult(jobId); }
  catch { return { ok: false, reason: "result_unavailable" }; }
  const raw = object(result.raw);
  if (!raw || result.conversion_job_id !== jobId || raw.conversion_job_id !== jobId
    || raw.authority !== "bim-streaming-server" || raw.ready !== true || result.ready !== true
    || !["succeeded", "succeeded_with_warnings"].includes(String(raw.status))
    || result.status !== raw.status
    || (result.model_status !== undefined && result.model_status !== "ready")
    || (object(raw.model)?.status !== undefined && object(raw.model)?.status !== "ready")
    || raw.tenant_id !== sanitizeArtifactIdPart(input.configuredTenantId)
    || raw.project_id !== sanitizeArtifactIdPart(record.project_id)
    || raw.model_version_id !== sanitizeArtifactIdPart(record.external_model_version_id)
    || raw.correlation_id !== sanitizeArtifactIdPart(record.correlation_id)
    || !isIfcReadySessionTraceId(raw.trace_id)) {
    return { ok: false, reason: "result_identity_mismatch" };
  }
  const artifacts = object(raw.artifacts);
  const model = artifact(artifacts?.model_usdc, input.conversionOrigin, jobId, "model.usdc");
  const mapping = artifact(artifacts?.element_mapping, input.conversionOrigin, jobId, "element_mapping.json");
  if (!model || !mapping || raw.usdc_url !== model.url || raw.mapping_url !== mapping.url
    || result.usdc_ref !== model.url || result.element_mapping_ref !== mapping.url
    || (record.usdc_key !== null && record.usdc_key !== model.url)) {
    return { ok: false, reason: "artifact_invalid" };
  }
  return { ok: true, bundle: {
    readyModelId: record.idempotency_key, conversionJobId: jobId, correlationId: record.correlation_id, rootTraceId: raw.trace_id,
    tenantId: input.configuredTenantId, projectId: record.project_id,
    modelVersionId: record.external_model_version_id, model, mapping,
  } };
}
