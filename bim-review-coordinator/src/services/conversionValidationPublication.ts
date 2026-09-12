import { createHash } from "node:crypto";
import { purposeFacts, type ApprovedPurposeScope } from "./conversionValidationFacts.js";
import type { IfcReadyIntakeJob } from "../types.js";
import type { ExternalIfcReadyStore } from "./externalIfcReadyStore.js";
import type { ConversionLedger } from "./conversionLedger.js";
import type { StreamingConversionResult } from "./streamingConversionClient.js";
import { readConversionSourceMetadata } from "./conversionSourceMetadata.js";
import { createConversionValidationRecord } from "./conversionValidationRecord.js";

export type ValidationPublication =
  | { status: "stored" | "replayed"; recordId: string }
  | { status: "not_recorded"; reason:
      "source_not_ready" | "metadata_unavailable" | "source_changed" |
      "record_invalid" | "persistence_failed" | "publisher_unavailable" };
const fail = (reason: Extract<ValidationPublication, { status: "not_recorded" }>["reason"]): ValidationPublication =>
  ({ status: "not_recorded", reason });
const producerVersion = "conversion-validation-publication/v1";

/** Local provenance history only: conversion ready never grants a purpose outcome.
 * No await is allowed between the final binding check and the atomic ledger append. */
export async function publishConversionValidation(input: {
  store: ExternalIfcReadyStore; ledger: ConversionLedger; jobId: string;
  result: StreamingConversionResult; conversionOrigin: string; publicArtifactOrigin?: string;
  readMetadata?: typeof readConversionSourceMetadata; now?: () => string;
  approvedScopes?: readonly ApprovedPurposeScope[];
}): Promise<ValidationPublication> {
  const { store, ledger, jobId, readMetadata = readConversionSourceMetadata, now = () => new Date().toISOString() } = input;
  let job: IfcReadyIntakeJob, result: StreamingConversionResult;
  const approvedScopes = structuredClone(input.approvedScopes ?? []);
  function currentBinding(candidate: IfcReadyIntakeJob | undefined): string | null {
    if (!candidate || candidate.conversion_authority !== "bim-streaming-server" ||
        candidate.conversion_status !== "ready" || !candidate.conversion_job_id ||
        candidate.conversion_job_id !== result.conversion_job_id) return null;
    const row = ledger.get(candidate.idempotency_key);
    if (!row || row.status !== "ready" || row.idempotency_key !== candidate.idempotency_key ||
        row.correlation_id !== candidate.correlation_id || row.project_id !== candidate.project_id ||
        row.external_model_version_id !== candidate.external_model_version_id ||
        row.conversion_job_id !== candidate.conversion_job_id || !result.usdc_ref || row.usdc_key !== result.usdc_ref) return null;
    return JSON.stringify([candidate.ifc_ready_job_id, candidate.idempotency_key, candidate.tenant_id,
      candidate.project_id, candidate.external_model_version_id, candidate.conversion_job_id,
      candidate.correlation_id, candidate.source_ifc_ref, candidate.source_ifc_etag, row.usdc_key]);
  }
  let binding: string | null;
  try {
    result = structuredClone(input.result);
    const current = store.get(jobId);
    if (!current) return fail("source_not_ready");
    job = structuredClone(current);
    binding = currentBinding(job);
    if (binding === null) return fail("source_not_ready");
  } catch { return fail("source_not_ready"); }
  let metadata;
  try {
    const read = await readMetadata({
      binding: { conversionJobId: job.conversion_job_id!, correlationId: job.correlation_id,
        tenantId: job.tenant_id, projectId: job.project_id, modelVersionId: job.external_model_version_id },
      result, conversionOrigin: input.conversionOrigin, publicArtifactOrigin: input.publicArtifactOrigin,
    });
    if (!read.ok) return fail("metadata_unavailable");
    metadata = read.facts;
  } catch { return fail("metadata_unavailable"); }
  try {
    if (currentBinding(store.get(jobId)) !== binding) return fail("source_changed");
  } catch { return fail("source_changed"); }
  const observed = metadata.validation;
  const facts = {
    readyModelId: job.idempotency_key, conversionJobId: job.conversion_job_id,
    tenantId: job.tenant_id, projectId: job.project_id, modelVersionId: job.external_model_version_id,
    source: { name: observed?.sourceName ?? "來源名稱未提供", sha256: metadata.sourceSha256 },
    artifacts: { usdcSha256: metadata.declaredUsdcSha256, mappingSha256: metadata.declaredMappingSha256 },
    converterVersion: metadata.converterVersion, validatorVersion: observed?.validatorVersion ?? "source-metadata-validator/v1",
    inventory: observed?.inventory ?? { observation: "not_run", expectedRenderable: null, convertedRenderable: null, missing: [], excluded: [] },
    correspondence: observed?.correspondence ?? null,
    ...(observed ? { evidence: observed, approvedScopes } : {}),
    purposes: observed ? purposeFacts(observed, approvedScopes, { tenantId: job.tenant_id, projectId: job.project_id, modelVersionId: job.external_model_version_id })
      : ["view_3d", "locate_highlight", "distance_measurement", "ifc_rules"].map(purpose => ({
      purpose, policy: null, checks: [{ id: "purpose_checks", state: "not_run", reasonCodes: ["checks_not_executed"] }],
    })),
  };
  let record, previous;
  try {
    const recordId = "validation_" + createHash("sha256")
      .update(JSON.stringify([producerVersion, facts, metadata.metadataSha256])).digest("hex");
    previous = ledger.listValidationRecords(job.idempotency_key).find(entry => entry.recordId === recordId);
    record = createConversionValidationRecord({ ...facts, recordId,
      validatedAt: previous?.validatedAt ?? observed?.validatedAt ?? now() });
  } catch { return fail("record_invalid"); }
  try {
    const { schemaVersion: _schema, evaluations: _evaluations, ...validatedInput } = record;
    ledger.appendValidationRecord(job.idempotency_key, validatedInput);
    return { status: previous ? "replayed" : "stored", recordId: record.recordId };
  } catch { return fail("persistence_failed"); }
}
