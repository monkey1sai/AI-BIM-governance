import { describe, expect, it } from "vitest";
import { evaluatePurpose, type PurposeCheck, type PurposePolicy } from "../src/services/purposeEvaluation.js";

const policy: PurposePolicy = {
  id: "test-view-policy", version: "1", purpose: "view_3d",
  requiredCheckIds: ["artifact", "geometry"],
};
const pass = (id: string): PurposeCheck => ({ id, state: "pass", reasonCodes: [] });

describe("evaluatePurpose", () => {
  it("requires a non-empty configured policy", () => {
    expect(evaluatePurpose("view_3d", null, []).outcome).toBe("not_validated");
    expect(evaluatePurpose("view_3d", { ...policy, requiredCheckIds: [] }, []).outcome).toBe("not_validated");
  });
  it("does not accept a policy for a different purpose", () => {
    expect(() => evaluatePurpose("ifc_rules", policy, [])).toThrow("Purpose policy mismatch");
  });
  it("does not treat absence of failure as pass", () => {
    expect(evaluatePurpose("view_3d", policy, [pass("artifact")])).toEqual({
      purpose: "view_3d", outcome: "not_validated", policyId: policy.id,
      policyVersion: "1", reasonCodes: ["geometry:missing"], limitations: [],
    });
  });
  it("preserves a known blocker when another required check is missing", () => {
    const result = evaluatePurpose("view_3d", policy, [
      { id: "artifact", state: "fail", reasonCodes: ["invalid_usdc"] },
    ]);
    expect(result.outcome).toBe("not_usable");
    expect(result.reasonCodes).toEqual(["artifact:fail", "geometry:missing", "invalid_usdc"]);
  });
  it.each(["unknown", "not_run", "execution_failed"] as const)("keeps %s distinct from a model failure", (state) => {
    const result = evaluatePurpose("view_3d", policy, [pass("artifact"), { id: "geometry", state, reasonCodes: [] }]);
    expect(result.outcome).toBe("not_validated");
    expect(result.reasonCodes).toEqual([`geometry:${state}`]);
  });
  it("only declares usable when every required check explicitly passes", () => {
    expect(evaluatePurpose("view_3d", policy, [pass("geometry"), pass("artifact")]).outcome).toBe("usable");
  });
  it("preserves explicit limitations and canonical ordering", () => {
    const checks: PurposeCheck[] = [pass("artifact"), {
      id: "geometry", state: "pass_with_limits", reasonCodes: ["partial"],
      limitations: ["missing_noncritical_components", "missing_noncritical_components"],
    }];
    const result = evaluatePurpose("view_3d", policy, checks);
    expect(result.outcome).toBe("usable_with_limits");
    expect(result.limitations).toEqual(["missing_noncritical_components"]);
    expect(evaluatePurpose("view_3d", policy, [...checks].reverse())).toEqual(result);
  });
  it("rejects an unexplained limited pass", () => {
    expect(() => evaluatePurpose("view_3d", policy, [
      { id: "artifact", state: "pass_with_limits", limitations: [], reasonCodes: [] },
    ])).toThrow("Limited pass requires limitations");
  });
  it("does not make IFC rules depend on a GPU or USDC result", () => {
    const rulesPolicy: PurposePolicy = { id: "test-ifc-policy", version: "1", purpose: "ifc_rules", requiredCheckIds: ["ifc_readable", "rule_preconditions"] };
    expect(evaluatePurpose("ifc_rules", rulesPolicy, [
      pass("ifc_readable"), pass("rule_preconditions"),
      { id: "gpu", state: "execution_failed", reasonCodes: ["gpu_unavailable"] },
      { id: "usdc", state: "fail", reasonCodes: ["invalid_usdc"] },
    ])).toEqual({ purpose: "ifc_rules", outcome: "usable", policyId: "test-ifc-policy", policyVersion: "1", reasonCodes: [], limitations: [] });
  });
  it("rejects duplicate check identities rather than selecting a passing duplicate", () => {
    expect(() => evaluatePurpose("view_3d", policy, [pass("artifact"), { id: "artifact", state: "fail", reasonCodes: [] }])).toThrow("Duplicate check identity");
    expect(() => evaluatePurpose("view_3d", { ...policy, requiredCheckIds: ["artifact", "artifact"] }, [])).toThrow("Duplicate policy check");
  });
  it("ignores malformed identities outside the required dependency set", () => {
    const rulesPolicy: PurposePolicy = { id: "test-ifc-policy", version: "1", purpose: "ifc_rules", requiredCheckIds: ["ifc_readable"] };
    expect(evaluatePurpose("ifc_rules", rulesPolicy, [pass("ifc_readable"), pass("gpu"), pass("gpu"), pass("")]).outcome).toBe("usable");
  });
  it("retains observed limitations without granting usability after another check fails", () => {
    const result = evaluatePurpose("view_3d", policy, [
      { id: "artifact", state: "fail", reasonCodes: [] },
      { id: "geometry", state: "pass_with_limits", reasonCodes: [], limitations: ["partial_geometry"] },
    ]);
    expect(result.outcome).toBe("not_usable");
    expect(result.limitations).toEqual(["partial_geometry"]);
  });
  it("does not mutate inputs or allow output mutation to change a subsequent evaluation", () => {
    const checks = [pass("artifact"), pass("geometry")];
    const before = JSON.stringify({ policy, checks });
    const first = evaluatePurpose("view_3d", policy, checks);
    first.reasonCodes.push("caller_mutation");
    expect(JSON.stringify({ policy, checks })).toBe(before);
    expect(evaluatePurpose("view_3d", policy, checks).reasonCodes).toEqual([]);
  });
});
