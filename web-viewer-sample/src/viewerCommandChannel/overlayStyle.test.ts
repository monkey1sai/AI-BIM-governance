import { describe, expect, it } from "vitest";
import {
  cfdOverlayPrimPath, cfdSafePrimName, overlayStyleReadback, parseDisplayOpacity, parseOverlayPrimPath, parseOverlayStyleInput,
  parseOverlayStyleReply,
} from "./overlayStyle";

const RUN = "cfd_20260921T070000Z_ui0001";
const PLANE = `/World/Overlays/Cfd/${RUN}/PedestrianWind_1p5m`;

describe("overlay style (CFD opacity) helpers", () => {
  it("derives the run prim name exactly like cfd_pipeline.usd_results.safe_prim_name", () => {
    expect(cfdSafePrimName(RUN)).toBe(RUN);
    expect(cfdSafePrimName("cfd-2026:09/21 run")).toBe("cfd_2026_09_21_run");
    expect(cfdSafePrimName("2026run")).toBe("_2026run");
    expect(cfdSafePrimName("")).toBe("_");
    expect(cfdOverlayPrimPath(RUN)).toBe(PLANE);
    expect(cfdOverlayPrimPath("9x", "Streamlines")).toBe("/World/Overlays/Cfd/_9x/Streamlines");
  });

  it("accepts only prims under /World/Overlays/Cfd with USD identifiers", () => {
    expect(parseOverlayPrimPath(PLANE)).toBe(PLANE);
    expect(parseOverlayPrimPath(`/World/Overlays/Cfd/${RUN}`)).toBe(`/World/Overlays/Cfd/${RUN}`);
    for (const bad of ["/World/Elements/Wall", "/World/Overlays/Cfd", "/World/Overlays/Cfd/", `${PLANE}/../x`, "/World/Overlays/Cfd/run 1",
      `/World/Overlays/Cfd/${"a".repeat(400)}`, 12, null, undefined]) {
      expect(parseOverlayPrimPath(bad)).toBeNull();
    }
  });

  it("bounds opacity to the vocabulary range", () => {
    expect(parseDisplayOpacity(0)).toBe(0);
    expect(parseDisplayOpacity(1)).toBe(1);
    expect(parseDisplayOpacity(0.35)).toBe(0.35);
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, "0.5", true, null]) expect(parseDisplayOpacity(bad)).toBeNull();
    expect(parseOverlayStyleInput({ primPath: PLANE, displayOpacity: 0.4 })).toEqual({ primPath: PLANE, displayOpacity: 0.4 });
    expect(parseOverlayStyleInput({ primPath: "/World", displayOpacity: 0.4 })).toBeNull();
    expect(parseOverlayStyleInput({ primPath: PLANE })).toBeNull();
    expect(parseOverlayStyleInput(null)).toBeNull();
  });

  it("takes the readback only from a success for the same prim", () => {
    const input = { primPath: PLANE, displayOpacity: 0.4 };
    expect(overlayStyleReadback(input, { result: "success", prim_path: PLANE, display_opacity: 0.4 })).toEqual(input);
    // Kit may report a clamped/rounded value; the reported value wins.
    expect(overlayStyleReadback(input, { result: "success", prim_path: PLANE, display_opacity: 0.5 })).toEqual({ primPath: PLANE, displayOpacity: 0.5 });
    expect(overlayStyleReadback(input, { result: "success", prim_path: `/World/Overlays/Cfd/${RUN}`, display_opacity: 0.4 })).toBeNull();
    expect(overlayStyleReadback(input, { result: "success", prim_path: PLANE })).toBeNull();
    expect(overlayStyleReadback(input, { result: "error", error: "x" })).toBeNull();
  });

  it("parses vg01 replies and requires prim and opacity on applied", () => {
    const applied = { status: "applied", clientRequestId: "c1", requestId: "r1", primPath: PLANE, displayOpacity: 0.4 };
    expect(parseOverlayStyleReply(applied)).toEqual(applied);
    expect(parseOverlayStyleReply({ ...applied, displayOpacity: undefined })).toBeNull();
    expect(parseOverlayStyleReply({ ...applied, primPath: "/World" })).toBeNull();
    expect(parseOverlayStyleReply({ ...applied, displayOpacity: 2 })).toBeNull();
    expect(parseOverlayStyleReply({ status: "error", reason: "rejected" })).toEqual({ status: "error", reason: "rejected" });
    expect(parseOverlayStyleReply({ status: "unconfirmed" })).toEqual({ status: "unconfirmed" });
    expect(parseOverlayStyleReply({ status: "applied" })).toBeNull();
    expect(parseOverlayStyleReply("applied")).toBeNull();
  });
});
