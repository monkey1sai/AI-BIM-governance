import { describe, expect, it } from 'vitest';
import { groundSamplingOf } from './cfdGround';

const reference = { schema: 'cfd-ground-reference/v1', reference: 'assumed_flat_plane', units: 'm', up_axis: 'Z',
  ground_z_m: .63, sampling_plane_z_m: 2.13, height_above_calculation_ground_m: 1.5,
  actual_ground_verified: false, vector_display_lift_m: .05 };

describe('ground result provenance', () => {
  it('reads recorded elevation without claiming actual ground verification', () => {
    expect(groundSamplingOf({ presentation: { ground_reference: reference } })).toEqual({
      provenance: 'recorded', calculationGroundM: .63, samplingZ: 2.13, aboveCalculationGroundM: 1.5, displayLiftM: .05 });
  });
  it('keeps legacy ground but never guesses 1.5m or vector lift', () => {
    expect(groundSamplingOf({ presentation: { ground_z_m: 0 } })).toEqual({
      provenance: 'legacy_unverified', calculationGroundM: 0, samplingZ: null, aboveCalculationGroundM: null, displayLiftM: null });
    expect(groundSamplingOf(undefined).calculationGroundM).toBeNull();
  });
  it.each([{ actual_ground_verified: true }, { up_axis: 'Y' }, { units: 'mm' }, { sampling_plane_z_m: 1.5 },
    { height_above_calculation_ground_m: null }, { ground_z_m: Infinity }, { vector_display_lift_m: -1 }, { unexpected: true }])(
    'refuses conflicting or unsupported evidence: %o', override => {
      expect(groundSamplingOf({ presentation: { ground_reference: { ...reference, ...override } } }).provenance).toBe('legacy_unverified');
    });
});
