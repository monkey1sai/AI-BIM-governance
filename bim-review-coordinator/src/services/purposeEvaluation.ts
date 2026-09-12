export type Purpose = "view_3d" | "locate_highlight" | "distance_measurement" | "ifc_rules";
export type PurposeOutcome = "usable" | "usable_with_limits" | "not_usable" | "not_validated";
export interface PurposePolicy {
  id: string;
  version: string;
  purpose: Purpose;
  requiredCheckIds: readonly string[];
}
export type PurposeCheck = {
  id: string;
  reasonCodes: readonly string[];
} & (
  | { state: "pass" | "fail" | "unknown" | "not_run" | "execution_failed" }
  | { state: "pass_with_limits"; limitations: readonly string[] }
);
export interface PurposeEvaluation {
  purpose: Purpose;
  outcome: PurposeOutcome;
  policyId: string | null;
  policyVersion: string | null;
  reasonCodes: string[];
  limitations: string[];
}

const ordered = (values: readonly string[]): string[] => [...new Set(values)].sort();

// Internal typed evaluator only. External schema, provenance, policy authority,
// and access checks belong to the producer before calling this function.
// Frozen conversion-validation-record/v1 outcome semantics. Introduce a new
// versioned evaluator for policy changes; retained records must keep using V1.
export function evaluatePurposeV1(
  purpose: Purpose,
  policy: PurposePolicy | null,
  checks: readonly PurposeCheck[],
): PurposeEvaluation {
  const result: PurposeEvaluation = {
    purpose, outcome: "not_validated", policyId: policy?.id ?? null,
    policyVersion: policy?.version ?? null, reasonCodes: [], limitations: [],
  };
  if (policy && policy.purpose !== purpose) throw new Error("Purpose policy mismatch");
  if (!policy || !policy.id.trim() || !policy.version.trim() || policy.requiredCheckIds.length === 0) {
    return { ...result, reasonCodes: ["policy_not_configured"] };
  }
  if (new Set(policy.requiredCheckIds).size !== policy.requiredCheckIds.length) throw new Error("Duplicate policy check");
  if (policy.requiredCheckIds.some((id) => !id.trim())) throw new Error("Empty policy check identity");
  const byId = new Map<string, PurposeCheck>();
  const requiredIds = new Set(policy.requiredCheckIds);
  for (const check of checks) {
    if (!requiredIds.has(check.id)) continue;
    if (byId.has(check.id)) throw new Error("Duplicate check identity");
    byId.set(check.id, check);
  }
  let failed = false;
  let unknown = false;
  let limited = false;
  const reasons: string[] = [];
  const limitations: string[] = [];
  for (const id of policy.requiredCheckIds) {
    const check = byId.get(id);
    if (!check) {
      unknown = true;
      reasons.push(`${id}:missing`);
      continue;
    }
    reasons.push(...check.reasonCodes);
    switch (check.state) {
      case "pass": break;
      case "pass_with_limits":
        if (check.limitations.length === 0 || check.limitations.some((value) => !value.trim())) throw new Error("Limited pass requires limitations");
        limited = true;
        limitations.push(...check.limitations);
        break;
      case "fail":
        failed = true;
        reasons.push(`${id}:fail`);
        break;
      case "unknown":
      case "not_run":
      case "execution_failed":
        unknown = true;
        reasons.push(`${id}:${check.state}`);
        break;
      default:
        throw new Error("Unknown check state");
    }
  }
  return {
    ...result,
    outcome: failed ? "not_usable" : unknown ? "not_validated" : limited ? "usable_with_limits" : "usable",
    reasonCodes: ordered(reasons), limitations: ordered(limitations),
  };
}

export const evaluatePurpose = evaluatePurposeV1;
