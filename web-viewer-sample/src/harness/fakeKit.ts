// 可決定性「假 Kit 大腦」：把前端送出的 StreamMessage 轉成符合既有協定形狀的回應。
// 兩條回應通道對齊 Window.tsx：
//   1) sendMessage 的 Promise 結果 → appStreamResultToAppEvent 只認 openStageRequest /
//      loadingStateQuery / getChildrenRequest 三型（其餘回 null）。
//   2) 非同步 Kit 通知（各 mutator correlated terminal、stageSelectionChanged /
//      updateProgressActivity 等）走 onCustomEvent。
// 本檔為純函式，不碰 DOM / transport，便於單元測試鎖定保真度。
import type { StreamMessage } from "../types/streamMessages";
import { harnessChildrenFor, HARNESS_STAGE_URL } from "./fixtures/usdStageTree";
import type { HarnessReviewAuthority } from "./fixtures/reviewAuthority";

export interface FakeKitState {
  readonly authority: HarnessReviewAuthority;
  currentStageUrl: string | null;
  bindingRevisionId: string | null;
  nextRejection: FakeKitRejection | null;
}

export function createFakeKitState(authority: HarnessReviewAuthority): FakeKitState {
  return {
    authority: Object.freeze({ ...authority }),
    currentStageUrl: null,
    bindingRevisionId: null,
    nextRejection: null,
  };
}

export interface FakeKitRejection {
  rejected_event_type: string;
  reason:
    | "spectator_readonly"
    | "lease_invalid"
    | "session_lifecycle_blocked"
    | "unauthorized_source_client"
    | "unsupported_command"
    | "invalid_payload";
  retryable: boolean;
  runtime_state: "unchanged" | "changed_unconfirmed";
  detail_code?: string;
}

export function queueFakeKitRejection(kit: FakeKitState, rejection: FakeKitRejection): void {
  kit.nextRejection = { ...rejection };
}

export interface FakeKitResponse {
  // AppStreamer.sendMessage 的 Promise resolve 值（null = 該訊息無同步結果）。
  result: Record<string, unknown> | null;
  // 透過 onCustomEvent 推回前端的非同步事件。
  asyncEvents: StreamMessage[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

const runtimeMutators = new Set([
  "openStageRequest",
  "loadArtifactGroupRequest",
  "composeStageRequest",
  "highlightPrimsRequest",
  "focusPrimRequest",
  "clearHighlightRequest",
  "selectPrimsRequest",
  "makePrimsPickable",
  "resetStage",
]);

function tracedPayload(
  kit: FakeKitState,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return { trace_id: kit.authority.traceId, ...payload };
}

function tracedEvent(
  kit: FakeKitState,
  eventType: string,
  payload: Record<string, unknown>,
): StreamMessage {
  return { event_type: eventType, payload: tracedPayload(kit, payload) };
}

export function computeFakeKitResponse(message: StreamMessage, kit: FakeKitState): FakeKitResponse {
  const payload = asRecord(message.payload);
  if (
    payload.session_id !== kit.authority.sessionId
    || payload.trace_id !== kit.authority.traceId
  ) {
    return { result: null, asyncEvents: [] };
  }
  const queuedRejection = kit.nextRejection;
  if (
    queuedRejection
    && runtimeMutators.has(message.event_type)
    && queuedRejection.rejected_event_type === message.event_type
  ) {
    kit.nextRejection = null;
    const requestId = str(payload, "request_id");
    return {
      result: null,
      asyncEvents: [tracedEvent(kit, "commandRejected", {
          ...queuedRejection,
          ...(requestId ? { request_id: requestId } : { rejection_id: "fake_rejection_001" }),
      })],
    };
  }

  switch (message.event_type) {
    // proof-of-life / 載入狀態輪詢。harness 永遠回 idle + 目前 stage url。
    case "loadingStateQuery":
      return {
        result: tracedPayload(kit, {
          status: "success",
          loadingState: "idle",
          url: kit.currentStageUrl ?? "",
        }),
        asyncEvents: [],
      };

    // 開 stage：記住 url，回 openedStageResult(success)（經 Promise），並推 updateProgressActivity:None
    // 觸發 _completeStageLoad（不依賴前端 USD asset 清單比對，較穩）。
    case "openStageRequest": {
      const url = str(payload, "url") || str(payload, "requested_stage_url") || HARNESS_STAGE_URL;
      const requestId = str(payload, "request_id");
      const bindingRevisionId = str(payload, "binding_revision_id");
      kit.currentStageUrl = url;
      return {
        result: tracedPayload(kit, {
          status: "success",
          url,
          ...(requestId ? { request_id: requestId } : {}),
          ...(bindingRevisionId ? { binding_revision_id: bindingRevisionId } : {}),
        }),
        asyncEvents: [
          tracedEvent(kit, "updateProgressAmount", { progress: 1 }),
          tracedEvent(kit, "updateProgressActivity", { text: "None" }),
        ],
      };
    }

    // USD 樹 lazy 展開：回該 path 的直接子節點。
    case "getChildrenRequest": {
      const primPath = str(payload, "prim_path") || "/World";
      return {
        result: tracedPayload(kit, {
          status: "success",
          primPath,
          children: harnessChildrenFor(primPath),
        }),
        asyncEvents: [],
      };
    }

    // 相機聚焦：非同步回 focusPrimResult(success, prim_path, request_id)。
    case "focusPrimRequest": {
      const primPath = str(payload, "prim_path");
      const requestId = str(payload, "request_id");
      return {
        result: null,
        asyncEvents: [
          tracedEvent(kit, "focusPrimResult", {
            result: "success",
            prim_path: primPath,
            request_id: requestId,
          }),
        ],
      };
    }

    // 標示：非同步回 highlightPrimsResult，selected_paths = 請求的 prim_path，無 missing/fallback（誠實成功）。
    case "highlightPrimsRequest": {
      const requestId = str(payload, "request_id");
      const items = Array.isArray(payload.items) ? (payload.items as Array<Record<string, unknown>>) : [];
      const selected = items.map((item) => str(asRecord(item), "prim_path")).filter(Boolean);
      return {
        result: null,
        asyncEvents: [
          tracedEvent(kit, "highlightPrimsResult", {
              result: "success",
              selected_paths: selected,
              missing_paths: [],
              fallback_paths: [],
              request_id: requestId,
          }),
        ],
      };
    }

    // 程式化選取：模擬 Kit 回 stageSelectionChanged，讓「viewport 選取 → 回灌樹」路徑可被 E2E 觸發。
    case "selectPrimsRequest": {
      const raw = Array.isArray(payload.prim_paths)
        ? payload.prim_paths
        : Array.isArray(payload.paths)
          ? payload.paths
          : [];
      const prims = (raw as unknown[]).filter((value): value is string => typeof value === "string");
      const requestId = str(payload, "request_id");
      return {
        result: null,
        asyncEvents: [
          tracedEvent(kit, "selectPrimsResult", {
              result: "success",
              error: "",
              selected_paths: prims,
              ...(requestId ? { request_id: requestId } : {}),
          }),
          tracedEvent(kit, "stageSelectionChanged", { prims }),
        ],
      };
    }

    // CH-F 會用到：compose stage 交易。harness 回 success + bindingApplied ack（含 revision）。
    case "composeStageRequest": {
      const revision = str(payload, "binding_revision_id");
      const requestId = str(payload, "request_id");
      if (revision) kit.bindingRevisionId = revision;
      return {
        result: tracedPayload(kit, {
          status: "success",
          ...(requestId ? { request_id: requestId } : {}),
        }),
        asyncEvents: [
          tracedEvent(kit, "loadArtifactGroupResult", {
              result: "accepted",
              binding_revision_id: kit.bindingRevisionId ?? "",
              ...(requestId ? { request_id: requestId } : {}),
          }),
          // Harness-only legacy acknowledgement; production Kit proves the
          // same transaction through openedStageResult + coordinator audit.
          tracedEvent(kit, "bindingApplied", {
              binding_revision_id: kit.bindingRevisionId ?? "",
              ...(requestId ? { request_id: requestId } : {}),
          }),
        ],
      };
    }

    case "clearHighlightRequest": {
      const requestId = str(payload, "request_id");
      return {
        result: null,
        asyncEvents: [tracedEvent(kit, "clearHighlightResult", {
            result: "success",
            applied_mode: "selection",
            ...(requestId ? { request_id: requestId } : {}),
        })],
      };
    }

    case "makePrimsPickable": {
      const requestId = str(payload, "request_id");
      return {
        result: null,
        asyncEvents: [tracedEvent(kit, "makePrimsPickableResponse", {
          result: "success",
          error: "",
          ...(requestId ? { request_id: requestId } : {}),
        })],
      };
    }

    case "resetStage": {
      const requestId = str(payload, "request_id");
      return {
        result: null,
        asyncEvents: [tracedEvent(kit, "resetStageResponse", {
          result: "success",
          error: "",
          ...(requestId ? { request_id: requestId } : {}),
        })],
      };
    }

    case "loadArtifactGroupRequest": {
      const requestId = str(payload, "request_id");
      const bindingRevisionId = str(payload, "binding_revision_id");
      const composition = asRecord(payload.stage_composition);
      const primary = asRecord(composition.primary);
      const url = str(primary, "usdc_url") || str(payload, "url") || HARNESS_STAGE_URL;
      kit.currentStageUrl = url;
      if (bindingRevisionId) kit.bindingRevisionId = bindingRevisionId;
      return {
        result: null,
        asyncEvents: [
          tracedEvent(kit, "loadArtifactGroupResult", {
              result: "accepted",
              ...(requestId ? { request_id: requestId } : {}),
              ...(bindingRevisionId ? { binding_revision_id: bindingRevisionId } : {}),
          }),
          tracedEvent(kit, "openedStageResult", {
              result: "success",
              url,
              error: "",
              ...(requestId ? { request_id: requestId } : {}),
              ...(bindingRevisionId ? { binding_revision_id: bindingRevisionId } : {}),
          }),
        ],
      };
    }

    default:
      return { result: null, asyncEvents: [] };
  }
}
