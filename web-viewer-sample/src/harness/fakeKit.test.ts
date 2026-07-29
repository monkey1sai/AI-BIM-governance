import { describe, it, expect } from "vitest";
import { computeFakeKitResponse, createFakeKitState, queueFakeKitRejection } from "./fakeKit";
import {
  HARNESS_REVIEW_AUTHORITY,
  HARNESS_SESSION_ID,
  HARNESS_TRACE_ID,
} from "./fixtures/reviewAuthority";
import { resolveHarnessAuthorityRequired, resolveHarnessEnabled } from "./harnessConfig";

const createKit = () => createFakeKitState(HARNESS_REVIEW_AUTHORITY);
const exactPayload = (payload: Record<string, unknown> = {}) => ({
  session_id: HARNESS_SESSION_ID,
  trace_id: HARNESS_TRACE_ID,
  ...payload,
});
const traced = (payload: Record<string, unknown> = {}) => ({
  trace_id: HARNESS_TRACE_ID,
  ...payload,
});

const REQUEST_FIXTURES = [
  ["openStageRequest", { request_id: "req-open", url: "harness://stage/open.usdc" }],
  ["loadArtifactGroupRequest", {
    request_id: "req-group",
    binding_revision_id: "binding-group",
    stage_composition: {
      primary: { usdc_url: "harness://stage/group.usdc" },
      secondary_layers: [],
    },
  }],
  ["composeStageRequest", { request_id: "req-compose", binding_revision_id: "binding-compose" }],
  ["highlightPrimsRequest", { request_id: "req-highlight", items: [{ prim_path: "/World/Wall" }] }],
  ["focusPrimRequest", { request_id: "req-focus", prim_path: "/World/Wall" }],
  ["clearHighlightRequest", { request_id: "req-clear" }],
  ["selectPrimsRequest", { request_id: "req-select", prim_paths: ["/World/Wall"] }],
  ["makePrimsPickable", { request_id: "req-pickable" }],
  ["resetStage", { request_id: "req-reset" }],
  ["loadingStateQuery", {}],
  ["getChildrenRequest", { prim_path: "/World" }],
] as const;

const KIT_TO_VIEWER_EVENTS = [
  "openedStageResult",
  "loadArtifactGroupResult",
  "highlightPrimsResult",
  "focusPrimResult",
  "selectPrimsResult",
  "makePrimsPickableResponse",
  "resetStageResponse",
  "clearHighlightResult",
  "loadingStateResponse",
  "getChildrenResponse",
  "stageSelectionChanged",
  "updateProgressAmount",
  "updateProgressActivity",
  "bindingApplied",
  "commandRejected",
] as const;

const PROMISE_EVENT_BY_REQUEST: Readonly<Record<string, string>> = {
  openStageRequest: "openedStageResult",
  loadingStateQuery: "loadingStateResponse",
  getChildrenRequest: "getChildrenResponse",
};

describe("computeFakeKitResponse — 鎖定假 Kit 對既有協定的保真度", () => {
  it.each([
    ["missing authority", {}],
    ["session mismatch", { session_id: `${HARNESS_SESSION_ID}_other`, trace_id: HARNESS_TRACE_ID }],
    ["trace mismatch", { session_id: HARNESS_SESSION_ID, trace_id: HARNESS_TRACE_ID.toUpperCase() }],
  ])("all 11 requests are zero-action before state reads for %s", (_label, authorityCandidate) => {
    for (const [eventType, requestPayload] of REQUEST_FIXTURES) {
      const kit = createKit();
      Object.defineProperties(kit, {
        currentStageUrl: { get: () => { throw new Error("business state read"); } },
        bindingRevisionId: { get: () => { throw new Error("binding state read"); } },
        nextRejection: { get: () => { throw new Error("rejection queue read"); } },
      });

      expect(computeFakeKitResponse({
        event_type: eventType,
        payload: { ...requestPayload, ...authorityCandidate },
      }, kit)).toEqual({ result: null, asyncEvents: [] });
    }
  });

  it("invalid trace does not consume a queued rejection", () => {
    const kit = createKit();
    queueFakeKitRejection(kit, {
      rejected_event_type: "openStageRequest",
      reason: "lease_invalid",
      retryable: false,
      runtime_state: "unchanged",
    });

    const invalid = computeFakeKitResponse({
      event_type: "openStageRequest",
      payload: {
        session_id: HARNESS_SESSION_ID,
        trace_id: HARNESS_TRACE_ID.toUpperCase(),
        request_id: "req-invalid",
        url: "harness://stage/invalid.usdc",
      },
    }, kit);
    expect(invalid).toEqual({ result: null, asyncEvents: [] });
    expect(kit.nextRejection).not.toBeNull();
    expect(kit.currentStageUrl).toBeNull();

    const exact = computeFakeKitResponse({
      event_type: "openStageRequest",
      payload: exactPayload({ request_id: "req-exact", url: "harness://stage/exact.usdc" }),
    }, kit);
    expect(exact.asyncEvents).toEqual([
      {
        event_type: "commandRejected",
        payload: traced({
          rejected_event_type: "openStageRequest",
          reason: "lease_invalid",
          retryable: false,
          runtime_state: "unchanged",
          request_id: "req-exact",
        }),
      },
    ]);
    expect(kit.nextRejection).toBeNull();
  });

  it("covers all 15 Kit-to-viewer catalog events with the exact active trace", () => {
    const observed = new Set<string>();
    for (const [requestEventType, requestPayload] of REQUEST_FIXTURES) {
      const response = computeFakeKitResponse({
        event_type: requestEventType,
        payload: exactPayload({ ...requestPayload }),
      }, createKit());
      if (response.result) {
        expect(response.result.trace_id, requestEventType).toBe(HARNESS_TRACE_ID);
        const promiseEvent = PROMISE_EVENT_BY_REQUEST[requestEventType];
        if (promiseEvent) observed.add(promiseEvent);
      }
      for (const event of response.asyncEvents) {
        expect((event.payload as Record<string, unknown>).trace_id, event.event_type).toBe(HARNESS_TRACE_ID);
        observed.add(event.event_type);
      }
    }

    const rejectedKit = createKit();
    queueFakeKitRejection(rejectedKit, {
      rejected_event_type: "openStageRequest",
      reason: "lease_invalid",
      retryable: false,
      runtime_state: "unchanged",
    });
    const rejected = computeFakeKitResponse({
      event_type: "openStageRequest",
      payload: exactPayload({ request_id: "req-catalog-rejection", url: "harness://stage/rejected.usdc" }),
    }, rejectedKit);
    for (const event of rejected.asyncEvents) {
      expect((event.payload as Record<string, unknown>).trace_id).toBe(HARNESS_TRACE_ID);
      observed.add(event.event_type);
    }

    expect([...observed].sort()).toEqual([...KIT_TO_VIEWER_EVENTS].sort());
    // bindingApplied is intentionally harness-only/legacy evidence, not a
    // claim that the repo-owned production Kit emits this event.
    expect(observed.has("bindingApplied")).toBe(true);
  });

  it("loadingStateQuery 回 idle + 目前 stage url", () => {
    const kit = createKit();
    const res = computeFakeKitResponse({ event_type: "loadingStateQuery", payload: exactPayload() }, kit);
    expect(res.result).toEqual(traced({ status: "success", loadingState: "idle", url: "" }));
    expect(res.asyncEvents).toHaveLength(0);
  });

  it("openStageRequest 記住 url、回 success.url、推 updateProgressActivity:None 觸發完成", () => {
    const kit = createKit();
    const url = "harness://stage/World/x.usd";
    const res = computeFakeKitResponse({ event_type: "openStageRequest", payload: exactPayload({ url }) }, kit);
    expect(res.result).toEqual(traced({ status: "success", url }));
    expect(kit.currentStageUrl).toBe(url);
    expect(res.asyncEvents).toEqual([
      { event_type: "updateProgressAmount", payload: traced({ progress: 1 }) },
      { event_type: "updateProgressActivity", payload: traced({ text: "None" }) },
    ]);
    // 開 stage 後，loadingStateQuery 應回報該 url（讓 _completeStageLoad 能比對）。
    const follow = computeFakeKitResponse({ event_type: "loadingStateQuery", payload: exactPayload() }, kit);
    expect((follow.result as Record<string, unknown>).url).toBe(url);
  });

  it("getChildrenRequest(/World) 回 Building 與 Site 兩個 root 子節點", () => {
    const kit = createKit();
    const res = computeFakeKitResponse({ event_type: "getChildrenRequest", payload: exactPayload({ prim_path: "/World" }) }, kit);
    const children = (res.result as { children: Array<{ path: string }> }).children;
    expect(children.map((child) => child.path)).toEqual(["/World/Building", "/World/Site"]);
  });

  it("getChildrenRequest(/World/Building/Level_1) 回 Wall_001 / Door_001", () => {
    const kit = createKit();
    const res = computeFakeKitResponse(
      { event_type: "getChildrenRequest", payload: exactPayload({ prim_path: "/World/Building/Level_1" }) },
      kit,
    );
    const children = (res.result as { children: Array<{ path: string }> }).children;
    expect(children.map((child) => child.path)).toEqual([
      "/World/Building/Level_1/Wall_001",
      "/World/Building/Level_1/Door_001",
    ]);
  });

  it("focusPrimRequest 非同步回 focusPrimResult(success) 並帶回 prim_path / request_id", () => {
    const kit = createKit();
    const res = computeFakeKitResponse(
      { event_type: "focusPrimRequest", payload: exactPayload({ prim_path: "/World/Building/Level_1/Wall_001", request_id: "req-1" }) },
      kit,
    );
    expect(res.result).toBeNull();
    expect(res.asyncEvents).toEqual([
      {
        event_type: "focusPrimResult",
        payload: traced({ result: "success", prim_path: "/World/Building/Level_1/Wall_001", request_id: "req-1" }),
      },
    ]);
  });

  it("highlightPrimsRequest 非同步回 highlightPrimsResult，selected=請求 prim_path，無 missing/fallback", () => {
    const kit = createKit();
    const res = computeFakeKitResponse(
      {
        event_type: "highlightPrimsRequest",
        payload: exactPayload({ request_id: "req-2", items: [{ prim_path: "/World/Building/Level_1/Door_001" }] }),
      },
      kit,
    );
    expect(res.result).toBeNull();
    expect(res.asyncEvents).toEqual([
      {
        event_type: "highlightPrimsResult",
        payload: traced({
          result: "success",
          selected_paths: ["/World/Building/Level_1/Door_001"],
          missing_paths: [],
          fallback_paths: [],
          request_id: "req-2",
        }),
      },
    ]);
  });

  it.each([
    ["clearHighlightRequest", "clearHighlightResult"],
    ["makePrimsPickable", "makePrimsPickableResponse"],
    ["resetStage", "resetStageResponse"],
  ])("%s 非同步回 correlated %s", (requestEventType, resultEventType) => {
    const kit = createKit();
    const res = computeFakeKitResponse(
      { event_type: requestEventType, payload: exactPayload({ request_id: "req-terminal-1" }) },
      kit,
    );
    expect(res.result).toBeNull();
    expect(res.asyncEvents).toEqual([
      expect.objectContaining({
        event_type: resultEventType,
        payload: expect.objectContaining({ result: "success", request_id: "req-terminal-1" }),
      }),
    ]);
  });

  it("selectPrimsRequest 回 correlated terminal，再以 stageSelectionChanged 驅動 viewport→樹 回灌", () => {
    const kit = createKit();
    const res = computeFakeKitResponse(
      {
        event_type: "selectPrimsRequest",
        payload: exactPayload({ request_id: "req-select-1", prim_paths: ["/World/Building/Level_2/Slab_002"] }),
      },
      kit,
    );
    expect(res.asyncEvents).toEqual([
      {
        event_type: "selectPrimsResult",
        payload: traced({
          result: "success",
          error: "",
          selected_paths: ["/World/Building/Level_2/Slab_002"],
          request_id: "req-select-1",
        }),
      },
      { event_type: "stageSelectionChanged", payload: traced({ prims: ["/World/Building/Level_2/Slab_002"] }) },
    ]);
  });

  it("composeStageRequest 記住 revision、回 success + bindingApplied ack", () => {
    const kit = createKit();
    const res = computeFakeKitResponse(
      { event_type: "composeStageRequest", payload: exactPayload({ binding_revision_id: "rev-42" }) },
      kit,
    );
    expect(res.result).toEqual(traced({ status: "success" }));
    expect(kit.bindingRevisionId).toBe("rev-42");
    expect(res.asyncEvents).toEqual([
      {
        event_type: "loadArtifactGroupResult",
        payload: traced({ result: "accepted", binding_revision_id: "rev-42" }),
      },
      { event_type: "bindingApplied", payload: traced({ binding_revision_id: "rev-42" }) },
    ]);
  });

  it("loadArtifactGroupRequest 先 accepted，再以 correlated openedStageResult terminal", () => {
    const kit = createKit();
    const res = computeFakeKitResponse({
      event_type: "loadArtifactGroupRequest",
      payload: exactPayload({
        request_id: "req-load-group-1",
        binding_revision_id: "rev-load-group-1",
        stage_composition: {
          primary: { usdc_url: "harness://stage/World/group-primary.usdc" },
          secondary_layers: [],
        },
      }),
    }, kit);

    expect(res.result).toBeNull();
    expect(kit.currentStageUrl).toBe("harness://stage/World/group-primary.usdc");
    expect(res.asyncEvents).toEqual([
      {
        event_type: "loadArtifactGroupResult",
        payload: traced({
          result: "accepted",
          request_id: "req-load-group-1",
          binding_revision_id: "rev-load-group-1",
        }),
      },
      {
        event_type: "openedStageResult",
        payload: traced({
          result: "success",
          url: "harness://stage/World/group-primary.usdc",
          error: "",
          request_id: "req-load-group-1",
          binding_revision_id: "rev-load-group-1",
        }),
      },
    ]);
  });

  it("one-shot commandRejected 保留 correlation 且只消費一次", () => {
    const kit = createKit();
    queueFakeKitRejection(kit, {
      rejected_event_type: "openStageRequest",
      reason: "lease_invalid",
      retryable: true,
      runtime_state: "unchanged",
      detail_code: "authority_unavailable",
    });

    const rejected = computeFakeKitResponse(
      {
        event_type: "openStageRequest",
        payload: exactPayload({ request_id: "cmd-reject-once", url: "harness://stage/rejected.usdc" }),
      },
      kit,
    );
    expect(rejected.result).toBeNull();
    expect(rejected.asyncEvents).toEqual([{
      event_type: "commandRejected",
      payload: traced({
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        retryable: true,
        runtime_state: "unchanged",
        detail_code: "authority_unavailable",
        request_id: "cmd-reject-once",
      }),
    }]);
    expect(kit.currentStageUrl).toBeNull();

    const replay = computeFakeKitResponse(
      {
        event_type: "openStageRequest",
        payload: exactPayload({ request_id: "cmd-replay", url: "harness://stage/replayed.usdc" }),
      },
      kit,
    );
    expect(replay.result).toMatchObject({
      status: "success",
      request_id: "cmd-replay",
      url: "harness://stage/replayed.usdc",
    });
    expect(kit.currentStageUrl).toBe("harness://stage/replayed.usdc");
  });

  it("requires both the explicit harness flag and the route query", () => {
    expect(resolveHarnessEnabled(false, false, true)).toBe(false);
    expect(resolveHarnessEnabled(false, true, true)).toBe(false);
    expect(resolveHarnessEnabled(true, false, false)).toBe(false);
    expect(resolveHarnessEnabled(true, true, false)).toBe(false);
    expect(resolveHarnessEnabled(true, false, true)).toBe(true);
    expect(resolveHarnessEnabled(true, true, true)).toBe(true);
  });

  it("authority-required query 只在已啟用的 dev harness 生效", () => {
    expect(resolveHarnessAuthorityRequired(true, true, true)).toBe(true);
    expect(resolveHarnessAuthorityRequired(false, true, true)).toBe(false);
    expect(resolveHarnessAuthorityRequired(true, false, true)).toBe(false);
    expect(resolveHarnessAuthorityRequired(true, true, false)).toBe(false);
  });
});
