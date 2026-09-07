import type { ConversionLedgerRecord } from "./conversionLedger.js";
import type { ReadyRenderBundle } from "../types.js";
import { buildQualityMetricsSummary, sanitizeArtifactIdPart, type StreamingConversionResult } from "./streamingConversionClient.js";
import type { ConversionQualityMetricsSummary } from "../types.js";
import { isIfcReadySessionTraceId } from "./sessionStore.js";

/** Internal descriptor only. Never serialize this object through public ledger APIs. */
export type { ReadyRenderBundle };

export function validateCachedRenderBundle(value: unknown, record: ConversionLedgerRecord, tenantId: string, origins: readonly string[]): ReadyRenderBundle | null {
  const bundle = object(value);
  if (!bundle || bundle.readyModelId !== record.idempotency_key || bundle.conversionJobId !== record.conversion_job_id
    || bundle.correlationId !== record.correlation_id
    || bundle.tenantId !== tenantId || bundle.projectId !== record.project_id
    || bundle.modelVersionId !== record.external_model_version_id || !isIfcReadySessionTraceId(bundle.rootTraceId)
    || typeof bundle.conversionJobId !== "string" || !/^[A-Za-z0-9_-]+$/.test(bundle.conversionJobId)) return null;
  const modelValue = object(bundle.model);
  const mappingValue = object(bundle.mapping);
  const model = artifact({ url: modelValue?.url, checksum_sha256: modelValue?.sha256 }, origins, bundle.conversionJobId, "model.usdc");
  const mapping = artifact({ url: mappingValue?.url, checksum_sha256: mappingValue?.sha256 }, origins, bundle.conversionJobId, "element_mapping.json");
  if (!model || !mapping || (record.usdc_key !== null && record.usdc_key !== model.url)) return null;
  return { readyModelId: record.idempotency_key, conversionJobId: bundle.conversionJobId, correlationId: bundle.correlationId as string,
    rootTraceId: bundle.rootTraceId, tenantId, projectId: record.project_id,
    modelVersionId: record.external_model_version_id, model, mapping };
}

export type ReadyRenderResolution =
  /** `cached` = descriptor came from the persisted ledger (no authority round-trip; quality metrics are
   * only available from a fresh authority result, so they are null on the cached path). */
  | { ok: true; bundle: ReadyRenderBundle; cached: boolean; qualitySummary: ConversionQualityMetricsSummary | null }
  | { ok: false; reason: "record_not_ready" | "result_unavailable" | "result_identity_mismatch" | "artifact_invalid" };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Origins allowed to publish artifact URLs: the internal conversion API origin the coordinator
 * talks to, plus the separately configured public artifact origin the conversion authority
 * writes into results (deploy.ps1: PUBLIC_HOST:49101). In the canonical host-Kit deployment the
 * two differ (host.docker.internal vs. the LAN host), so requiring equality rejected every real
 * production result. */
export function trustedArtifactOrigins(input: { conversionOrigin: string; publicArtifactOrigin?: string }): string[] {
  return [input.conversionOrigin, input.publicArtifactOrigin].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function artifact(value: unknown, origins: readonly string[], jobId: string, filename: string): ReadyRenderBundle["model"] | null {
  const entry = object(value);
  if (!entry || typeof entry.url !== "string" || typeof entry.checksum_sha256 !== "string"
    || !/^[a-fA-F0-9]{64}$/.test(entry.checksum_sha256)) return null;
  const expectedPath = `/artifacts/${jobId}/${filename}`;
  let url: URL;
  try { url = new URL(entry.url); } catch { return null; }
  if (url.username || url.password || url.search || url.hash || url.pathname !== expectedPath
    || entry.url !== `${url.origin}${expectedPath}`) return null;
  const trusted = origins.some((origin) => {
    try {
      const configured = new URL(origin);
      return ["http:", "https:"].includes(configured.protocol) && !configured.username && !configured.password
        && configured.origin === url.origin;
    } catch { return false; }
  });
  return trusted ? { url: url.href, sha256: entry.checksum_sha256.toLowerCase() } : null;
}

/** Read-only resolution: no intake store, conversion dispatch, callback, or session side effects.
 * Validates authority metadata; it does NOT prove artifact bytes/readability or GPU readiness.
 * The caller must supply the configured tenant, not a browser-supplied identity.
 */
export async function resolveReadyRenderBundle(input: {
  record: ConversionLedgerRecord;
  configuredTenantId: string;
  conversionOrigin: string;
  /** Public origin the conversion authority publishes artifact URLs under (may differ from conversionOrigin). */
  publicArtifactOrigin?: string;
  fetchResult: (jobId: string) => Promise<StreamingConversionResult>;
}): Promise<ReadyRenderResolution> {
  const record = structuredClone(input.record);
  const jobId = record.conversion_job_id;
  if (record.status !== "ready" || !/^mw_[a-f0-9]{16}$/.test(record.idempotency_key)
    || !jobId || !/^[A-Za-z0-9_-]+$/.test(jobId)
    || !record.correlation_id || !record.project_id || !record.external_model_version_id
    || !input.configuredTenantId.trim()) return { ok: false, reason: "record_not_ready" };
  if (record.ready_render_bundle !== undefined) {
    const bundle = validateCachedRenderBundle(record.ready_render_bundle, record, input.configuredTenantId, trustedArtifactOrigins(input));
    return bundle ? { ok: true, bundle, cached: true, qualitySummary: null } : { ok: false, reason: "artifact_invalid" };
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
  const origins = trustedArtifactOrigins(input);
  const model = artifact(artifacts?.model_usdc, origins, jobId, "model.usdc");
  const mapping = artifact(artifacts?.element_mapping, origins, jobId, "element_mapping.json");
  if (!model || !mapping || raw.usdc_url !== model.url || raw.mapping_url !== mapping.url
    || result.usdc_ref !== model.url || result.element_mapping_ref !== mapping.url
    || (record.usdc_key !== null && record.usdc_key !== model.url)) {
    return { ok: false, reason: "artifact_invalid" };
  }
  return { ok: true, cached: false, qualitySummary: buildQualityMetricsSummary(result), bundle: {
    readyModelId: record.idempotency_key, conversionJobId: jobId, correlationId: record.correlation_id, rootTraceId: raw.trace_id,
    tenantId: input.configuredTenantId, projectId: record.project_id,
    modelVersionId: record.external_model_version_id, model, mapping,
  } };
}
