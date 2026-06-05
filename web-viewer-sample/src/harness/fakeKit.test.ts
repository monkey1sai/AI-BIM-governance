import { describe, it, expect } from "vitest";
import { computeFakeKitResponse, createFakeKitState } from "./fakeKit";

describe("computeFakeKitResponse — 鎖定假 Kit 對既有協定的保真度", () => {
  it("loadingStateQuery 回 idle + 目前 stage url", () => {
    const kit = createFakeKitState();
    const res = computeFakeKitResponse({ event_type: "loadingStateQuery", payload: {} }, kit);
    expect(res.result).toEqual({ status: "success", loadingState: "idle", url: "" });
    expect(res.asyncEvents).toHaveLength(0);
  });

  it("openStageRequest 記住 url、回 success.url、推 updateProgressActivity:None 觸發完成", () => {
    const kit = createFakeKitState();
    const url = "harness://stage/World/x.usd";
    const res = computeFakeKitResponse({ event_type: "openStageRequest", payload: { url } }, kit);
    expect(res.result).toEqual({ status: "success", url });
    expect(kit.currentStageUrl).toBe(url);
    expect(res.asyncEvents).toEqual([{ event_type: "updateProgressActivity", payload: { text: "None" } }]);
    // 開 stage 後，loadingStateQuery 應回報該 url（讓 _completeStageLoad 能比對）。
    const follow = computeFakeKitResponse({ event_type: "loadingStateQuery", payload: {} }, kit);
    expect((follow.result as Record<string, unknown>).url).toBe(url);
  });

  it("getChildrenRequest(/World) 回 Building 與 Site 兩個 root 子節點", () => {
    const kit = createFakeKitState();
    const res = computeFakeKitResponse({ event_type: "getChildrenRequest", payload: { prim_path: "/World" } }, kit);
    const children = (res.result as { children: Array<{ path: string }> }).children;
    expect(children.map((child) => child.path)).toEqual(["/World/Building", "/World/Site"]);
  });

  it("getChildrenRequest(/World/Building/Level_1) 回 Wall_001 / Door_001", () => {
    const kit = createFakeKitState();
    const res = computeFakeKitResponse(
      { event_type: "getChildrenRequest", payload: { prim_path: "/World/Building/Level_1" } },
      kit,
    );
    const children = (res.result as { children: Array<{ path: string }> }).children;
    expect(children.map((child) => child.path)).toEqual([
      "/World/Building/Level_1/Wall_001",
      "/World/Building/Level_1/Door_001",
    ]);
  });

  it("focusPrimRequest 非同步回 focusPrimResult(success) 並帶回 prim_path / request_id", () => {
    const kit = createFakeKitState();
    const res = computeFakeKitResponse(
      { event_type: "focusPrimRequest", payload: { prim_path: "/World/Building/Level_1/Wall_001", request_id: "req-1" } },
      kit,
    );
    expect(res.result).toBeNull();
    expect(res.asyncEvents).toEqual([
      {
        event_type: "focusPrimResult",
        payload: { result: "success", prim_path: "/World/Building/Level_1/Wall_001", request_id: "req-1" },
      },
    ]);
  });

  it("highlightPrimsRequest 非同步回 highlightPrimsResult，selected=請求 prim_path，無 missing/fallback", () => {
    const kit = createFakeKitState();
    const res = computeFakeKitResponse(
      {
        event_type: "highlightPrimsRequest",
        payload: { request_id: "req-2", items: [{ prim_path: "/World/Building/Level_1/Door_001" }] },
      },
      kit,
    );
    expect(res.result).toBeNull();
    expect(res.asyncEvents).toEqual([
      {
        event_type: "highlightPrimsResult",
        payload: {
          result: "success",
          selected_paths: ["/World/Building/Level_1/Door_001"],
          missing_paths: [],
          fallback_paths: [],
          request_id: "req-2",
        },
      },
    ]);
  });

  it("selectPrimsRequest 模擬 Kit 回 stageSelectionChanged（驅動 viewport→樹 回灌）", () => {
    const kit = createFakeKitState();
    const res = computeFakeKitResponse(
      { event_type: "selectPrimsRequest", payload: { prim_paths: ["/World/Building/Level_2/Slab_002"] } },
      kit,
    );
    expect(res.asyncEvents).toEqual([
      { event_type: "stageSelectionChanged", payload: { prims: ["/World/Building/Level_2/Slab_002"] } },
    ]);
  });

  it("composeStageRequest 記住 revision、回 success + bindingApplied ack", () => {
    const kit = createFakeKitState();
    const res = computeFakeKitResponse(
      { event_type: "composeStageRequest", payload: { binding_revision_id: "rev-42" } },
      kit,
    );
    expect(res.result).toEqual({ status: "success" });
    expect(kit.bindingRevisionId).toBe("rev-42");
    expect(res.asyncEvents).toEqual([{ event_type: "bindingApplied", payload: { binding_revision_id: "rev-42" } }]);
  });
});
