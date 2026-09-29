// S6 A1 finding → governance `IssueCreate` payload. Moved verbatim from `routes/cfdRunRoutes.ts` into the
// CFD Run Workflow (docs/architecture/cfd-run-workflow-adr.md); it stays a pure exported function.

export interface CfdFindingIssuePayload {
  title: string;
  description: string;
  severity: string;
  usd_prim_path: string;
  model_version_id: string | null;
  /** Pedestrian Wind Field: present on an element-level finding only; governance stores it as `kind=issue` when the
   *  payload also carries a model binding, and as an annotation otherwise (its own rule, not restated here). */
  ifc_guid?: string;
}

/** One direction's exceedance zone that belongs to the element (Pedestrian Wind Field attribution). */
export interface CfdElementZoneHit {
  deg: number;
  /** The overlay artifact id `cfd:<run_id>:<wNNN>` of that direction (its `wNNN` names the pedestrian plane prim). */
  overlayArtifactId: string;
  zoneUMax: number;
  zoneAreaM2: number;
  distanceM: number;
}

/**
 * Pedestrian Wind Field element-level payload: one governance issue per element whose exceedance zones (across every
 * evaluated direction) lie within the attribution rule, so the finding can be highlighted in 3D and exported as BCF.
 * The `usd_prim_path` stays the pedestrian plane prim of the worst direction (the overlay Kit can show), while
 * `ifc_guid` names the element; the description lists every direction with its zone.
 */
export function cfdElementFindingIssuePayload(input: {
  runId: string; ifcGuid: string; ifcType: string; hits: readonly CfdElementZoneHit[]; threshold: number; severity: "medium" | "high";
  validationLevel: string; modelVersionId: string | null; result: Record<string, unknown>;
  origin: { wind_from_degrees: number[]; uref_m_s?: number | null; zref_m?: number | null } | null; openedBy: string;
}): CfdFindingIssuePayload {
  const worst = input.hits.reduce((best, hit) => (hit.zoneUMax > best.zoneUMax ? hit : best), input.hits[0]);
  const base = cfdFindingIssuePayload({
    runId: input.runId, overlayArtifactId: worst.overlayArtifactId, deg: worst.deg, uMax: worst.zoneUMax, threshold: input.threshold,
    severity: input.severity, validationLevel: input.validationLevel, modelVersionId: input.modelVersionId, result: input.result,
    origin: input.origin, openedBy: input.openedBy,
  });
  const totalArea = input.hits.reduce((sum, hit) => sum + hit.zoneAreaM2, 0);
  // One line per direction: a direction may hit the element through several zones (bullet 4 evidence: four zones of
  // 0° on one slab), so zones are merged per direction and the direction count is the count of distinct directions.
  const byDirection = new Map<number, { uMax: number; areaM2: number; distanceM: number; zones: number }>();
  for (const hit of input.hits) {
    const row = byDirection.get(hit.deg) ?? { uMax: hit.zoneUMax, areaM2: 0, distanceM: hit.distanceM, zones: 0 };
    row.uMax = Math.max(row.uMax, hit.zoneUMax);
    row.areaM2 += hit.zoneAreaM2;
    row.distanceM = Math.min(row.distanceM, hit.distanceM);
    row.zones += 1;
    byDirection.set(hit.deg, row);
  }
  const perDirection = [...byDirection.entries()].sort(([left], [right]) => left - right).map(([deg, row]) =>
    `  風向 ${deg}°：${row.zones} 個區域，|U|max ${row.uMax.toFixed(2)} m/s，面積 ${row.areaM2.toFixed(1)} m²，距構件 ${row.distanceM.toFixed(2)} m`);
  return {
    title: `CFD 風環境 ${input.ifcType} ${input.ifcGuid}：行人面 |U|max ${worst.zoneUMax.toFixed(2)} m/s > ${input.threshold} m/s（${byDirection.size} 個風向，${input.validationLevel}，設計比較用）`,
    description: [
      `構件 ${input.ifcType} ifc_guid=${input.ifcGuid}；歸屬規則：行人帶 [地面, +3 m]、XY 距離 ≤ 2 m、每區最多 3 個構件、不計平躺的地面構件（樓板／基地／基礎／覆面）（docs/architecture/pedestrian-wind-field-adr.md）。`,
      `超標區域合計 ${totalArea.toFixed(1)} m²，最差風向 ${worst.deg}°；逐風向：`,
      ...perDirection,
      base.description,
    ].join("\n"),
    severity: input.severity,
    usd_prim_path: base.usd_prim_path,
    model_version_id: input.modelVersionId,
    ifc_guid: input.ifcGuid,
  };
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
  // The ledger origin records every CFD Settings Catalog key as the request carried it (nullable, optional).
  origin: { wind_from_degrees: number[]; uref_m_s?: number | null; zref_m?: number | null } | null; openedBy: string;
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
  // S8 made z_ref adjustable and records it in the origin; an origin recorded before S8 has none, and the panel
  // submitted a fixed 10 m then.
  const zrefM = typeof input.origin?.zref_m === "number" ? input.origin.zref_m : 10;
  const lines = [
    `CFD 風環境 finding（validation_level=${input.validationLevel}；purpose=design_comparison_only；不是法規或認證依據）。`,
    `run_id=${input.runId}；conversion_job_id=${typeof source.conversion_job_id === "string" ? source.conversion_job_id : "unknown"}；風向 from ${input.deg}°（${northNote}）。`,
    `opened_by=${input.openedBy}`,
    `行人面 1.5 m |U|max = ${input.uMax.toFixed(2)} m/s，門檻 ${input.threshold} m/s（超出 ${(input.uMax / input.threshold * 100 - 100).toFixed(0)}%）。`,
    input.origin ? `送出參數：U_ref ${input.origin.uref_m_s ?? "未記錄"} m/s @ ${zrefM} m；本 run 共 ${input.origin.wind_from_degrees.length} 個風向。` : null,
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
