// S6 A1 finding → governance `IssueCreate` payload. Moved verbatim from `routes/cfdRunRoutes.ts` into the
// CFD Run Workflow (docs/architecture/cfd-run-workflow-adr.md); it stays a pure exported function.

export interface CfdFindingIssuePayload {
  title: string;
  description: string;
  severity: string;
  usd_prim_path: string;
  model_version_id: string | null;
}

/**
 * S6 A1 finding payload for the existing governance `IssueCreate` (title/description/severity/usd_prim_path/model_version_id).
 * No `ifc_guid`: a wind exceedance is a field result, not one element, so governance stores it as an annotation.
 * The text states the validation level, the assumptions and the design-comparison-only purpose verbatim from the result,
 * so a screening result can never read as a certified value.
 */
export function cfdFindingIssuePayload(input: {
  runId: string; overlayArtifactId: string; deg: number; uMax: number; threshold: number; severity: "medium" | "high";
  validationLevel: string; modelVersionId: string | null; result: Record<string, unknown>;
  origin: { wind_from_degrees: number[]; uref_m_s: number } | null; openedBy: string;
}): CfdFindingIssuePayload {
  const preprocess = (input.result.preprocess ?? {}) as { leak_fraction?: unknown; sealing_suspect?: unknown };
  const assumptions = Array.isArray(input.result.assumptions) ? (input.result.assumptions as unknown[]).map(String) : [];
  const limitations = Array.isArray(input.result.limitations) ? (input.result.limitations as unknown[]).map(String) : [];
  const source = (input.result.source ?? {}) as { conversion_job_id?: unknown };
  // The overlay layer's run prim is safe_prim_name(f"{run_id}_{tag}") (streaming cfd_job_service postprocess), with the
  // tag taken verbatim from the overlay artifact id `cfd:<run_id>:<wNNN>` (Python rounding; never recomputed here).
  // Same derivation as the viewer's cfdOverlayPrimPathForArtifact (web-viewer-sample/src/viewerCommandChannel/overlayStyle.ts).
  const [, artifactRun, artifactTag] = input.overlayArtifactId.split(":");
  const primName = safePrimName(`${artifactRun}_${artifactTag}`);
  // Mirror the streaming `_limitations` rule: the direction is relative to project north only while true north is
  // defaulted/unknown; a known or manually entered true north means the pipeline already rotated the wind.
  const northNote = assumptions.some((item) => item === "true_north_default_direction" || item === "true_north_unknown_assumed_project_north")
    ? "相對 project north；真北未知" : assumptions.includes("true_north_manual") ? "已依手動輸入的真北旋轉" : "已依模型真北旋轉";
  const lines = [
    `CFD 風環境 finding（validation_level=${input.validationLevel}；purpose=design_comparison_only；不是法規或認證依據）。`,
    `run_id=${input.runId}；conversion_job_id=${typeof source.conversion_job_id === "string" ? source.conversion_job_id : "unknown"}；風向 from ${input.deg}°（${northNote}）。`,
    `opened_by=${input.openedBy}`,
    `行人面 1.5 m |U|max = ${input.uMax.toFixed(2)} m/s，門檻 ${input.threshold} m/s（超出 ${(input.uMax / input.threshold * 100 - 100).toFixed(0)}%）。`,
    input.origin ? `送出參數：U_ref ${input.origin.uref_m_s} m/s @ 10 m；本 run 共 ${input.origin.wind_from_degrees.length} 個風向。` : null,
    typeof preprocess.leak_fraction === "number" ? `外殼洩漏率 ${(preprocess.leak_fraction * 100).toFixed(1)}%${preprocess.sealing_suspect ? "（sealing_suspect）" : ""}。` : null,
    assumptions.length ? `assumptions: ${assumptions.join(", ")}` : null,
    ...limitations.map((item) => `limitation: ${item}`),
    `疊圖 prim: /World/Overlays/Cfd/${primName}/PedestrianWind_1p5m`,
  ].filter((line): line is string => Boolean(line));
  return {
    title: `CFD 風環境 ${input.deg}°：行人面 |U|max ${input.uMax.toFixed(2)} m/s > ${input.threshold} m/s（${input.validationLevel}，設計比較用）`,
    description: lines.join("\n"),
    severity: input.severity,
    usd_prim_path: `/World/Overlays/Cfd/${primName}/PedestrianWind_1p5m`,
    model_version_id: input.modelVersionId,
  };
}

/** Same rule as the streaming `usd_results.safe_prim_name` and the viewer `cfdSafePrimName`: characters outside
 *  [A-Za-z0-9_] become `_`, and a leading character that is not a letter or `_` gets a `_` prefix. */
function safePrimName(value: string): string {
  const name = value.replace(/[^A-Za-z0-9_]/g, "_");
  return name && /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}
