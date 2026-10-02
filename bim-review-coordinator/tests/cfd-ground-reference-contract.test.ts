import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cfdGroundReference, cfdRunResult } from '../src/contract/schemas/cfd.js';

const value = { schema: 'cfd-ground-reference/v1', reference: 'assumed_flat_plane', units: 'm', up_axis: 'Z',
  ground_z_m: .63, sampling_plane_z_m: 2.13, height_above_calculation_ground_m: 1.5,
  actual_ground_verified: false, vector_display_lift_m: .05 };

describe('calculation ground reference contract', () => {
  it('accepts actual recorded and explicitly unknown samples, never a verified-ground claim', () => {
    expect(cfdGroundReference.parse(value)).toEqual(value);
    expect(cfdGroundReference.safeParse({ ...value, sampling_plane_z_m: null, height_above_calculation_ground_m: null }).success).toBe(true);
  });
  it.each([{ actual_ground_verified: true }, { units: 'mm' }, { up_axis: 'Y' }, { sampling_plane_z_m: 1.5 },
    { height_above_calculation_ground_m: null }, { ground_z_m: NaN }, { vector_display_lift_m: -1 }, { unknown: true }])(
    'refuses unsupported or conflicting values: %o', override => {
      expect(cfdGroundReference.safeParse({ ...value, ...override }).success).toBe(false);
    });
  it('keeps legacy results compatible and refuses a conflicting presentation ground', () => {
    const schema = JSON.parse(fs.readFileSync(new URL('../../tests/contracts/cfd-run-result-v1.schema.json', import.meta.url), 'utf8'));
    const result = structuredClone(schema.examples[0]);
    expect(cfdRunResult.safeParse(result).success).toBe(true);
    result.directions[0].presentation = { version: 2, prims: [], sections: [], building_footprint_xy: [], ground_z_m: .63,
      ground_reference: value, animation: { fps: 24, frames: 240, growth_seconds: 6, note: 'steady' } };
    expect(cfdRunResult.safeParse(result).success).toBe(true);
    result.directions[0].presentation.ground_z_m = 0;
    expect(cfdRunResult.safeParse(result).success).toBe(false);
  });
});
