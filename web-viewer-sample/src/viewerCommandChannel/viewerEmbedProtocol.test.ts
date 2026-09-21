// 由 tests/test_runtime_command_contracts.py 的三個 vg01 schema 測試移植而來；schema 已退役，規則改由解析器實作。
import { describe, expect, it } from "vitest";
import {
  carriesCredential, parseStageBindingSelection, parseViewerEvent, parseViewerLeaseToken,
  type ViewerEvent, type ViewerParentMessage,
} from "./viewerEmbedProtocol";

const vg = (m: Record<string, unknown>) => ({ protocol: "vg01", ...m });

describe("viewer_lease_token carries the ephemeral user token", () => {
  it("accepts a lease token with and without a user token", () => {
    expect(parseViewerLeaseToken({ type: "viewer_lease_token", token: "lease-token", user_token: "lab-user-carrier" }))
      .toEqual({ type: "viewer_lease_token", token: "lease-token", user_token: "lab-user-carrier" });
    expect(parseViewerLeaseToken({ type: "viewer_lease_token", token: "lease-token" }))
      .toEqual({ type: "viewer_lease_token", token: "lease-token" });
  });
  it.each([
    { type: "viewer_lease_token" },
    { type: "viewer_lease_token", token: "" },
    { type: "viewer_lease_token", token: 1 },
    { type: "viewer_lease_token", token: "lease-token", user_token: "" },
    { type: "stage_loaded", token: "lease-token" },
  ])("rejects %j", value => {
    expect(parseViewerLeaseToken(value)).toBeNull();
  });
});

describe("stage_loaded carries the stage proof status", () => {
  it("accepts an unproven stage with a binding revision", () => {
    expect(parseViewerEvent(vg({ type: "stage_loaded", stageUrl: null, status: "unproven", binding_revision_id: "binding_rev_001" })))
      .toEqual({ protocol: "vg01", type: "stage_loaded", stageUrl: null, status: "unproven", binding_revision_id: "binding_rev_001" });
  });
  it("normalises a missing or unknown status to unproven and drops the URL", () => {
    expect(parseViewerEvent(vg({ type: "stage_loaded", stageUrl: "stage://model.usdc" })))
      .toEqual({ protocol: "vg01", type: "stage_loaded", stageUrl: null, status: "unproven" });
    expect(parseViewerEvent(vg({ type: "stage_loaded", stageUrl: "stage://model.usdc", status: "loaded" })))
      .toEqual({ protocol: "vg01", type: "stage_loaded", stageUrl: null, status: "unproven" });
  });
  it("drops any event that carries a credential", () => {
    expect(parseViewerEvent(vg({ type: "stage_loaded", stageUrl: null, status: "unproven", token: "must-not-serialize" }))).toBeNull();
    expect(parseViewerEvent(vg({ type: "first_frame", stageUrl: null, viewer_lease_token: "x" }))).toBeNull();
    expect(carriesCredential({ user_token: "x" })).toBe(true);
    expect(carriesCredential({ requestId: "x" })).toBe(false);
  });
});

describe("stream_state disconnect is typed and fail-closed", () => {
  it.each(["stopped", "terminated"] as const)("accepts disconnected/%s", kind => {
    expect(parseViewerEvent(vg({ type: "stream_state", state: "disconnected", kind })))
      .toEqual({ protocol: "vg01", type: "stream_state", state: "disconnected", kind });
  });
  it.each([
    { type: "stream_state", state: "disconnected" },
    { type: "stream_state", state: "connected", kind: "stopped" },
    { type: "stream_state", state: "disconnected", kind: "paused" },
    { type: "stream_state", state: "disconnected", kind: "stopped", token: "must-not-serialize" },
  ])("rejects %j", value => {
    expect(parseViewerEvent(vg(value))).toBeNull();
  });
});

describe("stage tree, selection, toolbar and multi-colour highlight", () => {
  it("accepts a nested stage tree with optional selected paths", () => {
    const tree = { type: "stage_tree", prim_path: "/World", children: [
      { name: "Building", path: "/World/Building", type: "Xform", children: [{ name: "Wall_01", path: "/World/Building/Wall_01", type: "Mesh" }] },
    ] };
    expect(parseViewerEvent(vg(tree))).toEqual({ protocol: "vg01", ...tree });
    expect(parseViewerEvent(vg({ ...tree, selected_paths: ["/World/Building/Wall_01"] })))
      .toMatchObject({ selected_paths: ["/World/Building/Wall_01"] });
  });
  it.each([
    { type: "stage_tree", children: [] },
    { type: "stage_tree", prim_path: "/World", children: [{ name: "no-path" }] },
    { type: "stage_tree", prim_path: "/World", children: [], selected_paths: [1] },
  ])("rejects malformed stage tree %j", value => {
    expect(parseViewerEvent(vg(value))).toBeNull();
  });
  it("types the console → viewer requests the schema used to describe", () => {
    // 這些形狀由 TypeScript 檢查；viewer 端的執行期驗證在 Window 與 Channel 的解析器。
    const requests: ViewerParentMessage[] = [
      { type: "request_stage_tree", prim_path: "/World" },
      { type: "request_stage_tree" },
      { type: "select_prim", prim_path: "/World/Building/Wall_01", multi_select: true },
      { type: "toolbar_action", action: "reset_camera" },
      { type: "toolbar_action", action: "camera_view", camera_view: "top" },
      { type: "toolbar_action", action: "toggle_fullscreen" },
      { type: "highlight", items: [{ ifc_guid: "12345678-1234-1234-1234-1234567890ab", severity: "error", label: "Clash", color: [1, 0.2, 0.2, 1] }] },
      { type: "highlight_batch", items: [{ ifc_guid: "12345678-1234-1234-1234-1234567890ab", color: [0.2, 0.8, 0.2, 1] }] },
    ];
    expect(requests.map(request => request.type)).toHaveLength(8);
  });
});

describe("remaining viewer events", () => {
  it("accepts well-formed events and ignores unknown types", () => {
    expect(parseViewerEvent(vg({ type: "viewer_ready", extra: 1 }))).toEqual({ protocol: "vg01", type: "viewer_ready" });
    expect(parseViewerEvent(vg({ type: "first_frame", stageUrl: "stage://x" }))).toEqual({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    expect(parseViewerEvent(vg({ type: "selected_guid", ifcGuid: null }))).toEqual({ protocol: "vg01", type: "selected_guid", ifcGuid: null });
    const result: ViewerEvent | null = parseViewerEvent(vg({ type: "highlight_result", requestId: "r1", clientRequestId: "c1", ok: false, reason: "unmapped", sent_count: 2 }));
    expect(result).toMatchObject({ type: "highlight_result", requestId: "r1", clientRequestId: "c1", ok: false, sent_count: 2 });
    expect(parseViewerEvent(vg({ type: "issue_view_result", requestId: "r1", ok: true, action: "focus" }))).toMatchObject({ type: "issue_view_result", action: "focus" });
    expect(parseViewerEvent(vg({ type: "camera_view_result", status: "applied" }))).toBeNull(); // Channel 的回覆不走這裡
    expect(parseViewerEvent(vg({ type: "something_new" }))).toBeNull();
  });
  it.each([
    { type: "first_frame" },
    { type: "first_frame", stageUrl: 1 },
    { type: "highlight_result", ok: true },
    { type: "highlight_result", requestId: "r1", ok: "yes" },
    { type: "issue_view_result", requestId: "r1", ok: true, action: "highlight" },
    { type: "selected_guid" },
  ])("rejects %j", value => {
    expect(parseViewerEvent(vg(value))).toBeNull();
  });
  it("rejects messages without the protocol tag or that are not objects", () => {
    expect(parseViewerEvent({ type: "viewer_ready" })).toBeNull();
    expect(parseViewerEvent("viewer_ready")).toBeNull();
    expect(parseViewerEvent(null)).toBeNull();
  });
});

describe("S3 CFD overlay: apply_stage_binding / stage_binding_result", () => {
  it("parses a stage binding selection with exactly one primary", () => {
    const selection = [
      { artifact_id: "auto_usdc_stream_conv_x", role: "primary", load_order: 0 },
      { artifact_id: "cfd:cfd_20260921T070000Z_a1b2c3:w000", role: "secondary", load_order: 1 },
    ];
    expect(parseStageBindingSelection(selection)).toEqual(selection);
  });
  it.each([
    [],
    [{ artifact_id: "a", role: "secondary", load_order: 1 }],
    [{ artifact_id: "a", role: "primary", load_order: 0 }, { artifact_id: "b", role: "primary", load_order: 1 }],
    [{ artifact_id: "", role: "primary", load_order: 0 }],
    [{ artifact_id: "a", role: "primary", load_order: -1 }],
    [{ artifact_id: "a", role: "owner", load_order: 0 }],
    "not-an-array",
  ])("rejects malformed selection %j", value => {
    expect(parseStageBindingSelection(value)).toBeNull();
  });
  it("accepts applied results with the Kit-reported layer list and failed results with a reason", () => {
    expect(parseViewerEvent(vg({ type: "stage_binding_result", status: "applied", clientRequestId: "c1", revision_id: "binding_rev_1", applied_secondary_layers: ["cfd:run:w000"] })))
      .toEqual({ protocol: "vg01", type: "stage_binding_result", status: "applied", clientRequestId: "c1", revision_id: "binding_rev_1", applied_secondary_layers: ["cfd:run:w000"] });
    expect(parseViewerEvent(vg({ type: "stage_binding_result", status: "failed", revision_id: null, reason: "artifact_not_in_session" })))
      .toEqual({ protocol: "vg01", type: "stage_binding_result", status: "failed", revision_id: null, reason: "artifact_not_in_session" });
    // A missing revision_id is normalised to null; a missing layer list stays absent (Kit did not report it).
    expect(parseViewerEvent(vg({ type: "stage_binding_result", status: "applied" }))).toEqual({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: null });
  });
  it.each([
    { type: "stage_binding_result", status: "pending", revision_id: null },
    { type: "stage_binding_result", status: "applied", revision_id: 7 },
    { type: "stage_binding_result", status: "applied", applied_secondary_layers: [1] },
    { type: "stage_binding_result", status: "applied", revision_id: "r", token: "leak" },
  ])("rejects malformed stage_binding_result %j", value => {
    expect(parseViewerEvent(vg(value))).toBeNull();
  });
  it("types the console → viewer apply_stage_binding request", () => {
    const request: ViewerParentMessage = { type: "apply_stage_binding", clientRequestId: "c1", artifacts: [{ artifact_id: "a", role: "primary", load_order: 0 }] };
    expect(request.type).toBe("apply_stage_binding");
  });
});
