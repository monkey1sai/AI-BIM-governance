export interface GroundSampling {
  provenance: 'recorded' | 'legacy_unverified';
  calculationGroundM: number | null;
  samplingZ: number | null;
  aboveCalculationGroundM: number | null;
  displayLiftM: number | null;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const nullable = (value: unknown): value is number | null => value === null || finite(value);

/** Old prim names and API field names are compatibility identifiers, not proof of height above IFC ground. */
export function groundSamplingOf(direction: unknown): GroundSampling {
  const presentation = record(direction) && record(direction.presentation) ? direction.presentation : null;
  const legacy: GroundSampling = { provenance: 'legacy_unverified',
    calculationGroundM: finite(presentation?.ground_z_m) ? presentation.ground_z_m : null,
    samplingZ: null, aboveCalculationGroundM: null, displayLiftM: null };
  const value = presentation?.ground_reference;
  const keys = ['schema', 'reference', 'units', 'up_axis', 'ground_z_m', 'sampling_plane_z_m',
    'height_above_calculation_ground_m', 'actual_ground_verified', 'vector_display_lift_m'];
  if (!record(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || value.schema !== 'cfd-ground-reference/v1' || value.reference !== 'assumed_flat_plane'
    || value.units !== 'm' || value.up_axis !== 'Z' || value.actual_ground_verified !== false || !finite(value.ground_z_m)
    || !nullable(value.sampling_plane_z_m) || !nullable(value.height_above_calculation_ground_m)
    || !nullable(value.vector_display_lift_m) || (value.vector_display_lift_m !== null && value.vector_display_lift_m < 0)
    || ((value.sampling_plane_z_m === null) !== (value.height_above_calculation_ground_m === null))
    || (value.sampling_plane_z_m !== null && value.height_above_calculation_ground_m !== null
      && Math.abs(value.sampling_plane_z_m - value.ground_z_m - value.height_above_calculation_ground_m) > 1e-6)
    || (finite(presentation?.ground_z_m) && Math.abs(presentation.ground_z_m - value.ground_z_m) > 1e-6)) return legacy;
  return { provenance: 'recorded', calculationGroundM: value.ground_z_m, samplingZ: value.sampling_plane_z_m,
    aboveCalculationGroundM: value.height_above_calculation_ground_m, displayLiftM: value.vector_display_lift_m };
}

/** HUD crosses a postMessage boundary; unsupported verification claims are refused. */
export function isGroundSampling(value: unknown): value is GroundSampling {
  if (!record(value) || Object.keys(value).length !== 5
    || Object.keys(value).some(key => !['provenance', 'calculationGroundM', 'samplingZ', 'aboveCalculationGroundM', 'displayLiftM'].includes(key))
    || typeof value.provenance !== 'string' || !['recorded', 'legacy_unverified'].includes(value.provenance)
    || ![value.calculationGroundM, value.samplingZ, value.aboveCalculationGroundM, value.displayLiftM].every(nullable)
    || (value.displayLiftM !== null && (value.displayLiftM as number) < 0)) return false;
  if (value.provenance === 'legacy_unverified') return value.samplingZ === null && value.aboveCalculationGroundM === null && value.displayLiftM === null;
  return finite(value.calculationGroundM) && ((value.samplingZ === null && value.aboveCalculationGroundM === null)
    || (finite(value.samplingZ) && finite(value.aboveCalculationGroundM)
      && Math.abs(value.samplingZ - value.calculationGroundM - value.aboveCalculationGroundM) <= 1e-6));
}
