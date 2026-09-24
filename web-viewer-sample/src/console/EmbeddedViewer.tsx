import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { MeasurementState } from "../viewerCommandChannel/measurement";
import {
  createViewerCommandParentSide, type ViewerCommandParentSide, type ViewerCommandPort,
} from "../viewerCommandChannel/parentSide";
import {
  parseViewerEvent, type FirstFrameMessage, type HighlightItem, type HighlightResultMessage, type IssueViewResultMessage,
  type StageBindingResultMessage, type StageBindingSelection,
  type StageLoadedMessage, type StageTreeMessage, type StreamStateMessage, type ToolbarAction,
} from "../viewerCommandChannel/viewerEmbedProtocol";

// viewerOrigin 可能被設定成帶尾斜線或路徑前綴的「viewer 入口 base URL」（如 https://host/bim-viewer/），
// 但 MessageEvent.origin 永遠是純 origin（https://host，無路徑/尾斜線）。origin 比對與 postMessage targetOrigin
// 必須用純 origin，否則 path-prefixed 部署下所有 viewer 訊息都會被 e.origin !== p.viewerOrigin 拒收、A1 證據永遠不閉合。
// iframe src 仍用完整 base URL（保留路徑前綴）。
function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

// Viewer Embed Protocol（vg01）型別的唯一來源在 viewerCommandChannel/viewerEmbedProtocol.ts；這裡只轉出給既有 import。
export type {
  FirstFrameMessage, HighlightItem, HighlightResultMessage, IssueViewResultMessage, SelectedGuidMessage,
  StageLoadedMessage, StageTreeMessage, StreamStateMessage, USDPrimNode,
} from "../viewerCommandChannel/viewerEmbedProtocol";

/**
 * Viewport Slot 的 host actions（docs/architecture/viewport-slot-adr.md）：只在這裡宣告一次。
 * EmbeddedViewer 提供，ReviewSessionViewerPane 加上 viewer 證據閘門後轉出，WorkspaceViewportHost 註冊到 slot。
 */
export interface ViewerHostActions {
  /** 相機、飛行、剖切與量測指令（Viewer Command Channel）。 */
  commands: ViewerCommandPort;
  requestStageTree(primPath?: string): void;
  selectPrim(primPath: string, multiSelect?: boolean): void;
  sendToolbarAction(action: ToolbarAction, cameraView?: string): void;
  /** S3：以既有 stage-binding 交易套用 primary＋secondary（CFD overlay）；以 viewer 回報的 stage_binding_result 結算。 */
  applyStageBinding(artifacts: StageBindingSelection[]): Promise<StageBindingResultMessage>;
}

export interface EmbeddedViewerHandle extends ViewerHostActions {
  sendHighlight(items: HighlightItem[], clientRequestId: string): void;
  // 批次疊加（A2 diff overlay）：viewer 端把全部 items 裝進「一個」highlightPrimsRequest（聯集選取）
  // 並回「一個」帶 sent_count/unmapped_count 的 highlight_result。sendHighlight 維持逐筆語意
  //（每 item 一個 replace request + 一個 ack），兩者不可混用。
  sendHighlightBatch(items: HighlightItem[], clientRequestId: string): void;
  sendFocus(ifcGuid: string, clientRequestId?: string): void;
  sendClear(clientRequestId?: string): void;
  clearSelection(clientRequestId: string): void;
}

export interface EmbeddedViewerProps {
  workspacePresentation?: boolean;
  onSectionInvalidated?: () => void;
  sessionId: string;
  viewerOrigin: string; // 必須是「viewer 入口 origin」（:5173 baked viewer），非 coordinator :8004。
                        // 真源 = coordinatorClient.runtimeStatus().configured_endpoints.viewer.browser_url_base（Task 3 提供）。
                        // ⚠️ 傳成 coordinator base 會讓 iframe 載 coordinator HTML、postMessage 橋永遠收不到 viewer 訊息。
                        // 接收端白名單仍複用 VITE_ALLOWED_COORDINATOR_ORIGINS（viewer 端驗 parent=console origin）。
                        // ⚠️ viewerOrigin / sessionId 不支援 mount 後動態修改：src 隨 render 重算，prop 一變會
                        //    重設 iframe.src → reload → 中斷既有 WebRTC 連線與 DataChannel，且 first_frame_at 不再
                        //    對應真串流。父元件契約：(1) gated render —— viewerOrigin 從 runtime/status 拿到值才 mount
                        //    本元件（null 時顯 missing，不先空 render）；(2) 切換 session 用 key={sessionId} 強制乾淨
                        //    remount，而非原地改 prop。
  // coordinator handoff：與 coordinator /ui/open 對齊（app.ts 送 coordinatorApiBase / coordinatorSocketUrl），
  // 讓 baked viewer image 在「未 bake 同一 coordinator base」的部署/E2E 下仍打到正確 coordinator 取 session/stream-config，
  // 否則 iframe 會 fallback 到 build-time / localhost 預設、抓錯 session → 無 first frame、高亮橋建不起來。
  // 真源 = coordinatorClient.runtimeStatus().configured_endpoints.coordinator.public_base_url。空值則省略該 query（沿用 viewer 既有 fallback）。
  coordinatorApiBase?: string | null;
  coordinatorSocketUrl?: string | null;
  streamRole?: "primary" | "spectator";
  kitInstanceId?: string | null;
  userId?: string | null;
  displayName?: string | null;
  sourceClientId?: string | null;
  // structured-log trace carrier。viewer `main.tsx` 的 bootstrapStructLog 是 fail-closed：
  // query 缺 trace_id（或不合 canonical 前綴）就 throw，React 根本不會 mount，iframe 只會是白畫面、
  // 完全不發起 WebRTC。真源＝coordinator `GET /api/review-sessions/:id/stream-config` 的 `trace_id`
  // （與 /ui/open 302 補的是同一個 sessionTraceResolver 權威），前端不得自行合成。
  traceId?: string | null;
  viewerLeaseToken?: string | null;
  userToken?: string | null;
  onViewerReady?: () => void;
  onMeasurementState?: (state: MeasurementState) => void;
  onFirstFrame?: (m: FirstFrameMessage) => void;
  onStreamState?: (m: StreamStateMessage) => void;
  onStageLoaded?: (message: StageLoadedMessage) => void;
  onHighlightResult?: (m: HighlightResultMessage) => void;
  onIssueViewResult?: (m: IssueViewResultMessage) => void;
  onSelectedGuid?: (ifcGuid: string | null) => void;
  onStageTree?: (message: StageTreeMessage) => void;
}

// crypto.randomUUID only exists in secure contexts; LAN http pages fall back to getRandomValues.
function newClientRequestId(): string {
  const cryptoApi = globalThis.crypto as (Omit<Crypto, "randomUUID"> & { randomUUID?: () => string }) | undefined;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi!.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export const EmbeddedViewer = forwardRef<EmbeddedViewerHandle, EmbeddedViewerProps>(function EmbeddedViewer(props, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewerReadyRef = useRef(false);

  // stable ref：每 render 同步最新 props，listener 才不必每 render 重掛。
  // 原 dep=[props]（每 render 新 object reference）會在每個 render cycle removeEventListener + addEventListener，
  // 在高頻輪詢（A1 定時 poll rule-runs）的 detach/attach 微小時窗內，viewer 送出的 first_frame / highlight_result 會被靜默丟棄。
  const propsRef = useRef(props);
  propsRef.current = props;

  // viewer lease token 是 bearer secret：不得放 iframe URL query（history/referrer/log 皆會看見）。
  // 只在受限 targetOrigin 的 postMessage 通道交給 iframe viewer；viewer 端仍以 parent origin 白名單驗證。
  const post = (msg: Record<string, unknown>) =>
    iframeRef.current?.contentWindow?.postMessage({ protocol: "vg01", ...msg }, normalizeOrigin(propsRef.current.viewerOrigin)); // targetOrigin 非 "*"（normalize 同 listener）

  // 只建立一次；effect 與 handle 經 channelRef 讀取，與 propsRef 同模式。
  const channelRef = useRef<ViewerCommandParentSide | null>(null);
  channelRef.current ??= createViewerCommandParentSide({
    ready: () => viewerReadyRef.current && Boolean(iframeRef.current?.contentWindow),
    post: message => post(message),
    newId: newClientRequestId,
    // 任一指令的已確認結果失效時，所有 viewer 指令狀態一起失效（剖切、量測、相機、飛行）。
    onInvalidated: () => propsRef.current.onSectionInvalidated?.(),
    onMeasurementState: state => propsRef.current.onMeasurementState?.(state),
  });

  // S3：apply_stage_binding 的 pending 對照（同一時間只允許一筆；viewer 端 _applyBinding 也是單一世代）。
  const stageBindingRef = useRef<{
    clientRequestId: string; resolve: (message: StageBindingResultMessage) => void; timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const sendViewerLeaseToken = () => {
    const p = propsRef.current;
    if (!viewerReadyRef.current || !p.viewerLeaseToken) return;
    post({
      type: "viewer_lease_token",
      token: p.viewerLeaseToken,
      ...(p.userToken ? { user_token: p.userToken } : {}),
    });
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const p = propsRef.current;
      if (e.origin !== normalizeOrigin(p.viewerOrigin)) return;    // 安全：origin 比對（非 "*"；normalize 去尾斜線/路徑前綴）
      if (e.source !== iframeRef.current?.contentWindow) return;   // 安全：來源 frame
      const raw = e.data as { protocol?: string } | null;
      if (!raw || raw.protocol !== "vg01") return;                 // 協定版本 / 前向相容（未知忽略）
      if (channelRef.current!.acceptViewerMessage(raw as Record<string, unknown>)) return; // 相機、飛行、剖切、量測的回覆
      const m = parseViewerEvent(raw);                              // 其餘事件 fail-closed：格式不符或夾帶憑證一律丟棄
      if (!m) return;
      switch (m.type) {
        case "viewer_ready":
          if (!viewerReadyRef.current) {
            viewerReadyRef.current = true;
            sendViewerLeaseToken();
            p.onViewerReady?.();
          }
          break; // 每次 iframe document load 都必須重新 ready，且同一 document 的重複 ready 不重送 bearer
        case "first_frame":       p.onFirstFrame?.(m); break;
        case "stream_state":      p.onStreamState?.(m); break;
        case "stage_loaded":      p.onStageLoaded?.(m); break;  // 缺 status 已由 parseViewerEvent 正規化為 unproven
        case "highlight_result":  p.onHighlightResult?.(m); break;
        case "issue_view_result": p.onIssueViewResult?.(m); break;
        case "selected_guid":     p.onSelectedGuid?.(m.ifcGuid); break;
        case "stage_tree":        p.onStageTree?.(m); break;
        case "stage_binding_result": {
          const pending = stageBindingRef.current;
          if (!pending || !m.clientRequestId || m.clientRequestId !== pending.clientRequestId) break;
          clearTimeout(pending.timer);
          stageBindingRef.current = null;
          pending.resolve(m);
          break;
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("message", onMsg);
      channelRef.current!.cancel();
      // 換 session、lease 或重新連線都會重掛本元件；尚未結算的 stage-binding 套用以 superseded 結束。
      const pending = stageBindingRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      stageBindingRef.current = null;
      pending.resolve({ protocol: "vg01", type: "stage_binding_result", status: "failed", clientRequestId: pending.clientRequestId, revision_id: null, reason: "superseded" });
    };
  }, []); // listener 只掛一次；最新 callback / origin 經 propsRef 讀取

  useEffect(() => {
    sendViewerLeaseToken();
  }, [props.viewerLeaseToken, props.userToken, props.viewerOrigin]);

  // 送出側比照接收側：經 propsRef.current 讀最新 viewerOrigin，與 listener 同模式（避免兩側不對稱）。
  // handle 內 closure 不直接 close over render-scope props → useImperativeHandle dep 可為 []（zero re-create）。
  useImperativeHandle(ref, () => ({
    commands: channelRef.current!.port,
    sendHighlight: (items, clientRequestId) => post({ type: "highlight", items, clientRequestId }),
    sendHighlightBatch: (items, clientRequestId) => post({ type: "highlight_batch", items, clientRequestId }),
    sendFocus: (ifcGuid, clientRequestId) => post({ type: "focus", ifc_guid: ifcGuid, clientRequestId }),
    sendClear: (clientRequestId) => post({ type: "clear", clientRequestId }),
    clearSelection: (clientRequestId) => post({ type: "clear_selection", clientRequestId }),
    requestStageTree: (primPath = "/World") => post({ type: "request_stage_tree", prim_path: primPath }),
    selectPrim: (primPath: string, multiSelect = false) =>
      post({ type: "select_prim", prim_path: primPath, multi_select: multiSelect }),
    sendToolbarAction: (action, cameraView) =>
      post({ type: "toolbar_action", action, ...(cameraView ? { camera_view: cameraView } : {}) }),
    applyStageBinding: (artifacts) => {
      const clientRequestId = newClientRequestId();
      const fail = (reason: string): StageBindingResultMessage => ({ protocol: "vg01", type: "stage_binding_result",
        status: "failed", clientRequestId, revision_id: null, reason });
      if (stageBindingRef.current) return Promise.resolve(fail("command_pending"));
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          stageBindingRef.current = null;
          resolve(fail("timed_out"));
        }, 90_000);
        stageBindingRef.current = { clientRequestId, resolve, timer };
        post({ type: "apply_stage_binding", artifacts, clientRequestId });
      });
    },
  }), []);

  // iframe src 用完整 viewerOrigin base（保留路徑前綴），附 session 與 coordinator handoff（對齊 /ui/open 的 query 鍵）。
  const buildSrc = (): string => {
    const params = new URLSearchParams({ session: props.sessionId });
    if (props.workspacePresentation) params.set("presentation", "workspace");
    if (props.coordinatorApiBase) params.set("coordinatorApiBase", props.coordinatorApiBase);
    if (props.coordinatorSocketUrl) params.set("coordinatorSocketUrl", props.coordinatorSocketUrl);
    if (props.streamRole) params.set("streamRole", props.streamRole);
    if (props.kitInstanceId) params.set("kitInstanceId", props.kitInstanceId);
    if (props.userId) params.set("userId", props.userId);
    if (props.displayName) params.set("displayName", props.displayName);
    if (props.sourceClientId) params.set("sourceClientId", props.sourceClientId);
    if (props.traceId) params.set("trace_id", props.traceId);
    const base = props.viewerOrigin.replace(/\/+$/, "");
    return `${base}/?${params.toString()}`;
  };
  const src = buildSrc();
  // S1：跨 origin iframe 須 allow-scripts allow-same-origin（WebRTC + sessionStorage）+ allow=autoplay
  //     （跨 origin <video> 自動播放，否則白頁）。viewer receive-only（AppStream mic:false）→ 不需 camera/microphone。
  return (
    <iframe ref={iframeRef} src={src} title="live-3d-viewer"
      onLoad={() => { viewerReadyRef.current = false; channelRef.current!.cancel(); propsRef.current.onSectionInvalidated?.(); propsRef.current.onMeasurementState?.({ status: "unconfirmed" }); }}
      sandbox="allow-scripts allow-same-origin" allow="autoplay"
      style={{ width: "100%", height: "100%", minHeight: 480, border: "1px solid var(--ab-border)", background: "var(--ab-black)" }} />
  );
});
