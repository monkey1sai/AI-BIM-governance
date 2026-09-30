import { describe, expect, it } from "vitest";
import { headingFromCamera } from "./compassHeading";

const S = 1 / Math.sqrt(3);
const UP_Z = [0, 0, 1];

describe("headingFromCamera (degrees clockwise from project north = model +Y)", () => {
  it.each([
    ["north", [0, 1, 0], 0],
    ["east", [1, 0, 0], 90],
    ["south", [0, -1, 0], 180],
    ["west", [-1, 0, 0], 270],
  ])("reads a level look %s", (_name, direction, heading) => {
    expect(headingFromCamera({ direction, up: UP_Z })).toBeCloseTo(heading as number, 9);
  });

  it("uses the horizontal part of a tilted look (the iso preset looks north-west and down)", () => {
    expect(headingFromCamera({ direction: [-S, S, -S], up: [0, 0, 1] })).toBeCloseTo(315, 9);
    expect(headingFromCamera({ direction: [0.5, 0.5, -0.7071], up: [0, 0, 1] })).toBeCloseTo(45, 9);
  });

  it("falls back to screen-up for a top view", () => {
    expect(headingFromCamera({ direction: [0, 0, -1], up: [0, 1, 0] })).toBe(0);
    expect(headingFromCamera({ direction: [0, 0, -1], up: [1, 0, 0] })).toBeCloseTo(90, 9);
    expect(headingFromCamera({ direction: [0.0002, 0.0001, -1], up: [-1, 0, 0] })).toBeCloseTo(270, 9);
  });

  it("never returns negative zero or 360", () => {
    const north = headingFromCamera({ direction: [-0, 1, 0], up: UP_Z });
    expect(Object.is(north, -0)).toBe(false);
    const almostNorth = headingFromCamera({ direction: [-1e-12, 1, 0], up: UP_Z })!;
    expect(almostNorth).toBeGreaterThanOrEqual(0);
    expect(almostNorth).toBeLessThan(360);
  });

  it("returns null when neither the look nor screen-up has a horizontal direction", () => {
    expect(headingFromCamera({ direction: [0, 0, -1], up: [0, 0, 1] })).toBeNull();
    expect(headingFromCamera({ direction: [0, 0, 0], up: [0, 0, 0] })).toBeNull();
  });

  it("returns null for malformed vectors", () => {
    expect(headingFromCamera({ direction: [Number.NaN, 1, 0], up: UP_Z })).toBeNull();
    expect(headingFromCamera({ direction: [1], up: UP_Z })).toBeNull();
    expect(headingFromCamera({ direction: [0, 0, -1], up: [Number.POSITIVE_INFINITY, 0, 0] })).toBeNull();
  });
});
