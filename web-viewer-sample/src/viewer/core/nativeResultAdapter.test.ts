import { describe, expect, it } from "vitest";
import { appStreamResultToAppEvent as adapt, requestUsesNativeOpenedStageResult } from "./nativeResultAdapter";

describe("native result transcript", () => {
  const request = { trace_id: "trace-a", request_id: "request-a", binding_revision_id: "revision-a", url: "https://example.test/model.usdc" };
  const opened = { action: "message", status: "success", info: "opened", url: request.url };

  it("preserves stage request names", () => {
    expect(requestUsesNativeOpenedStageResult("openStageRequest")).toBe(true);
    expect(requestUsesNativeOpenedStageResult("loadArtifactGroupRequest")).toBe(true);
    expect(requestUsesNativeOpenedStageResult("getChildrenRequest")).toBe(false);
  });
  it("requires caller fallback decision and exact target", () => {
    expect(adapt("openStageRequest", opened, request)).toBeNull();
    expect(adapt("openStageRequest", { ...opened, url: "https://example.test/other.usdc" }, request, true)).toBeNull();
    expect(adapt("openStageRequest", opened, request, true)).toEqual({
      event_type: "openedStageResult",
      payload: { trace_id: "trace-a", request_id: "request-a", binding_revision_id: "revision-a", result: "success", url: request.url, error: "" },
    });
  });
  it("rejects generic custom ACK and partial or stale correlation", () => {
    expect(adapt("loadArtifactGroupRequest", opened, request, true)).toBeNull();
    expect(adapt("openStageRequest", { ...opened, trace_id: "trace-a" }, request, true)).toBeNull();
    expect(adapt("openStageRequest", { ...opened, ...request, request_id: "old" }, request, true)).toBeNull();
  });
  it("preserves loading response and rejects malformed trace-less replies", () => {
    expect(adapt("loadingStateQuery", { status: "success", loadingState: "idle", url: request.url }, request)).toEqual({
      event_type: "loadingStateResponse", payload: { trace_id: "trace-a", loading_state: "idle", url: request.url },
    });
    expect(adapt("loadingStateQuery", { status: "warning", loadingState: "idle" }, request)).toBeNull();
    expect(adapt("loadingStateQuery", { status: "success", loadingState: "unknown" }, request)).toBeNull();
    expect(adapt("loadingStateQuery", { status: "success", loadingState: "idle", trace_id: null }, request)).toBeNull();
  });
  it("matches queried prim and accepts more than 32 siblings", () => {
    const children = Array.from({ length: 40 }, (_, i) => ({ path: "/World/P" + i }));
    const result = { status: "success", primPath: "/World", children };
    expect(adapt("getChildrenRequest", result, { ...request, prim_path: "/World" })).toEqual({
      event_type: "getChildrenResponse", payload: { trace_id: "trace-a", prim_path: "/World", children },
    });
    expect(adapt("getChildrenRequest", result, { ...request, prim_path: "/Other" })).toBeNull();
    expect(adapt("getChildrenRequest", { ...result, children: [{ path: "/World/A", children: [null] }] }, { ...request, prim_path: "/World" })).toBeNull();
  });
  it("preserves explicit failure and rejects unknown commands", () => {
    expect(adapt("openStageRequest", { ...opened, status: "error", info: "cannot open" }, request, true)).toMatchObject({
      payload: { result: "error", error: "cannot open" },
    });
    expect(adapt("unknown", { trace_id: "trace-a" }, request)).toBeNull();
    expect(adapt("loadingStateQuery", null, request)).toBeNull();
  });
});
