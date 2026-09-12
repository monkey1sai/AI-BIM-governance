import type { ConversionValidationRecord } from "./conversionValidationRecord.js";

type Facts = NonNullable<ConversionValidationRecord["evidence"]>;
export type ConversionValidationReport = Omit<ConversionValidationRecord, "evidence" | "approvedScopes"> & {
  sourceValidation?: {
    byClass: Facts["byClass"]; units: Facts["units"]; coordinateEvidence: Facts["coordinateEvidence"];
    scopes: { id: string; version: string; purpose: string; requiredGuidCount: number }[];
  };
};

// Bounded disclosure guard, not a general secret detector. Producers must never store credentials.
const unsafeText = /(?:[a-z]:[\\/]|\\\\|(?:https?|file):\/\/|\bbearer\s+\S|(?:^|\s)\/\S)/i;
function assertDisplayText(value: string): void {
  if (!value.trim() || unsafeText.test(value)) throw new Error("Report text unavailable.");
}

/** Projection only: preserve stored evaluations, never evaluate current policy on a historical read. */
export function projectValidationReport(record: ConversionValidationRecord): ConversionValidationReport {
  const name = record.source.name.split(/[\\/]/).pop() ?? "";
  assertDisplayText(name);
  if (record.converterVersion !== null) assertDisplayText(record.converterVersion);
  assertDisplayText(record.validatorVersion);
  for (const item of record.purposes) {
    if (item.policy) assertDisplayText(item.policy.version);
    for (const check of item.checks) {
      if (check.state === "pass_with_limits") check.limitations.forEach(assertDisplayText);
    }
  }
  for (const item of record.evaluations) {
    if (item.policyVersion !== null) assertDisplayText(item.policyVersion);
    item.limitations.forEach(assertDisplayText);
  }
  const scopes = (record.approvedScopes ?? []).map(scope => {
    assertDisplayText(scope.id); assertDisplayText(scope.version);
    return { id: scope.id, version: scope.version, purpose: scope.purpose, requiredGuidCount: scope.requiredGuids.length };
  });
  return structuredClone({
    schemaVersion: record.schemaVersion, recordId: record.recordId,
    readyModelId: record.readyModelId, conversionJobId: record.conversionJobId,
    tenantId: record.tenantId, projectId: record.projectId, modelVersionId: record.modelVersionId,
    source: { name, sha256: record.source.sha256 }, artifacts: record.artifacts,
    converterVersion: record.converterVersion, validatorVersion: record.validatorVersion,
    validatedAt: record.validatedAt, inventory: record.inventory,
    correspondence: record.correspondence, purposes: record.purposes, evaluations: record.evaluations,
    ...(record.evidence ? { sourceValidation: {
      byClass: record.evidence.byClass, units: record.evidence.units,
      coordinateEvidence: record.evidence.coordinateEvidence ?? null, scopes,
    } } : {}),
  });
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}

/** Long-form CSV preserves every nested field as JSON; UTF-8 BOM supports spreadsheet import. */
export function serializeValidationReportCsv(dto: ConversionValidationReport): string {
  const rows: string[][] = [["record_id", "section", "item_id", "field", "value"]];
  for (const [field, value] of Object.entries(dto)) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Report field unavailable.");
    rows.push([dto.recordId, "record", dto.recordId, field, serialized]);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
