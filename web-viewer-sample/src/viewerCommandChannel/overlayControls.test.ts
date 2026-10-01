import { describe, expect, it } from "vitest";
import { parseOverlayVisibilityInput, overlayVisibilityReadback, parseOverlayPlaybackInput,
  overlayPlaybackReadback, parseOverlayPlaybackReply, parseOverlayVisibilityReply } from "./overlayControls";

const path = "/World/Overlays/Cfd/run/FlowParticles";
const input = { items: [{ primPath: path, visible: true }] };
describe("overlay control boundaries and readback", () => {
  it("seeks only a bounded computed sample and requires that same sample in the reply", () => {
    expect(parseOverlayPlaybackInput({action:"seek",sampleIndex:18})).toEqual({action:"seek",sampleIndex:18});
    for (const sampleIndex of [-1,64,1.5,NaN,"1",undefined]) {
      expect(parseOverlayPlaybackInput({action:"seek",sampleIndex})).toBeNull();
    }
    expect(parseOverlayPlaybackInput({action:"query",sampleIndex:0})).toBeNull();
    const payload={result:"success",playing:false,rate:2,time_seconds:.25,run_id:"cfd_current_run",sample_index:1,physical_time_seconds:1};
    expect(overlayPlaybackReadback({action:"seek",sampleIndex:1},payload)).toMatchObject({sampleIndex:1,physicalTimeSeconds:1});
    expect(overlayPlaybackReadback({action:"seek",sampleIndex:0},payload)).toBeNull();
    expect(overlayPlaybackReadback({action:"query"},{...payload,physical_time_seconds:undefined})).toBeNull();
  });
  it.each([[], Array(33).fill(input.items[0]), [{ primPath: "/World/Elements/Wall", visible: true }],
    [{ primPath: path, visible: 1 }], [input.items[0], input.items[0]]])("rejects invalid visibility batch %j", items => {
    expect(parseOverlayVisibilityInput({ items })).toBeNull();
  });
  it("accepts actual visibility rather than echoing the requested value", () => {
    expect(overlayVisibilityReadback(input, { result: "success", items: [{ prim_path: path, visible: false, present: true }] }))
      .toEqual({ items: [{ primPath: path, visible: false, present: true }] });
    expect(overlayVisibilityReadback(input, { result: "success", items: [{ prim_path: `${path}/Other`, visible: true, present: true }] })).toBeNull();
    expect(overlayVisibilityReadback(input, { result: "success", items: [] })).toBeNull();
    expect(overlayVisibilityReadback(input, { result: "success", items: [{ prim_path: path, visible: true, present: false }] })).toBeNull();
  });
  it.each([0, 4.01, Infinity, NaN, true, "2", undefined])("rejects invalid rate %j", rate => {
    expect(parseOverlayPlaybackInput({ action: "set_rate", rate })).toBeNull();
  });
  it("requires rate only for set_rate and validates timeline readback", () => {
    expect(parseOverlayPlaybackInput({ action: "pause", rate: 1 })).toBeNull();
    expect(parseOverlayPlaybackInput({ action: "pause" })).toEqual({ action: "pause" });
    expect(parseOverlayPlaybackInput({ action: "set_rate", rate: 0.25 })).toEqual({ action: "set_rate", rate: 0.25 });
    expect(overlayPlaybackReadback({ action: "play" }, { result: "success", playing: false, rate: 4, time_seconds: 0.5 }))
      .toEqual({ playing: false, rate: 4, timeSeconds: 0.5 });
    expect(overlayPlaybackReadback({ action: "play" }, { result: "success", playing: true, rate: 1, time_seconds: -1 })).toBeNull();
  });
  it("never accepts applied without readback or leaks old values through unconfirmed", () => {
    expect(parseOverlayPlaybackReply({ status: "applied", clientRequestId: "c", requestId: "r" })).toBeNull();
    expect(parseOverlayVisibilityReply({ status: "applied", clientRequestId: "c", requestId: "r" })).toBeNull();
    expect(parseOverlayPlaybackReply({ status: "unconfirmed", playing: true, rate: 2, timeSeconds: 1 })).toEqual({ status: "unconfirmed" });
    expect(parseOverlayVisibilityReply({ status: "unconfirmed", items: [{ primPath: path, visible: true, present: true }] })).toEqual({ status: "unconfirmed" });
  });
});
