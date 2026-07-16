import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

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

// VG-01 postMessage 協定（版本化）。viewer→console 與 console→viewer 皆帶 protocol:"vg01"。
export interface FirstFrameMessage { protocol: "vg01"; type: "first_frame"; stageUrl: string | null }
export interface StageLoadedMessage { protocol: "vg01"; type: "stage_loaded"; stageUrl: string | null }
export interface HighlightResultMessage {
  protocol: "vg01"; type: "highlight_result"; requestId: string;
  ok: boolean; reason?: "unmapped" | "datachannel_not_ready";
  // 批次（highlight_batch）ack 專屬（加性欄位；單筆 highlight ack 不帶）：viewer 端誠實計數——
  // 實際裝進單一 highlightPrimsRequest 的筆數與 viewer mapping 解不出 prim 的 GUID 清單。
  sent_count?: number;
  unmapped_count?: number;
  unmapped_guids?: string[];
}
export interface SelectedGuidMessage { protocol: "vg01"; type: "selected_guid"; ifcGuid: string | null }

export interface HighlightItem { ifc_guid: string; severity?: string; label?: string; rule_code?: string | null }

export interface EmbeddedViewerHandle {
  sendHighlight(items: HighlightItem[]): void;
  // 批次疊加（A2 diff overlay）：viewer 端把全部 items 裝進「一個」highlightPrimsRequest（聯集選取）
  // 並回「一個」帶 sent_count/unmapped_count 的 highlight_result。sendHighlight 維持逐筆語意
  //（每 item 一個 replace request + 一個 ack），兩者不可混用。
  sendHighlightBatch(items: HighlightItem[]): void;
  sendFocus(ifcGuid: string): void;
  sendClear(): void;
}

export interface EmbeddedViewerProps {
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
  viewerLeaseToken?: string | null;
  onViewerReady?: () => void;
  onFirstFrame?: (m: FirstFrameMessage) => void;
  onStageLoaded?: (stageUrl: string | null) => void;
  onHighlightResult?: (m: HighlightResultMessage) => void;
  onSelectedGuid?: (ifcGuid: string | null) => void;
}

export const EmbeddedViewer = forwardRef<EmbeddedViewerHandle, EmbeddedViewerProps>(function EmbeddedViewer(props, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // stable ref：每 render 同步最新 props，listener 才不必每 render 重掛。
  // 原 dep=[props]（每 render 新 object reference）會在每個 render cycle removeEventListener + addEventListener，
  // 在高頻輪詢（A1 定時 poll rule-runs）的 detach/attach 微小時窗內，viewer 送出的 first_frame / highlight_result 會被靜默丟棄。
  const propsRef = useRef(props);
  propsRef.current = props;

  // viewer lease token 是 bearer secret：不得放 iframe URL query（history/referrer/log 皆會看見）。
  // 只在受限 targetOrigin 的 postMessage 通道交給 iframe viewer；viewer 端仍以 parent origin 白名單驗證。
  const post = (msg: Record<string, unknown>) =>
    iframeRef.current?.contentWindow?.postMessage({ protocol: "vg01", ...msg }, normalizeOrigin(propsRef.current.viewerOrigin)); // targetOrigin 非 "*"（normalize 同 listener）

  const sendViewerLeaseToken = () => {
    const p = propsRef.current;
    if (!p.viewerLeaseToken) return;
    post({ type: "viewer_lease_token", token: p.viewerLeaseToken });
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const p = propsRef.current;
      if (e.origin !== normalizeOrigin(p.viewerOrigin)) return;    // 安全：origin 比對（非 "*"；normalize 去尾斜線/路徑前綴）
      if (e.source !== iframeRef.current?.contentWindow) return;   // 安全：來源 frame
      const m = e.data as { protocol?: string; type?: string } | null;
      if (!m || m.protocol !== "vg01") return;                     // 協定版本 / 前向相容（未知忽略）
      switch (m.type) {
        case "viewer_ready":     sendViewerLeaseToken(); p.onViewerReady?.(); break; // 父元件以 onViewerReady callback 追蹤 ready（IX-A1-06）；元件不存內部死 state（避免無謂 re-render）
        case "first_frame":      p.onFirstFrame?.(m as unknown as FirstFrameMessage); break;
        case "stage_loaded":     p.onStageLoaded?.((m as unknown as StageLoadedMessage).stageUrl); break;
        case "highlight_result": p.onHighlightResult?.(m as unknown as HighlightResultMessage); break;
        case "selected_guid":    p.onSelectedGuid?.((m as unknown as SelectedGuidMessage).ifcGuid ?? null); break;
        default: break; // 未知 type 忽略
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []); // listener 只掛一次；最新 callback / origin 經 propsRef 讀取

  useEffect(() => {
    sendViewerLeaseToken();
  }, [props.viewerLeaseToken, props.viewerOrigin]);

  // 送出側比照接收側：經 propsRef.current 讀最新 viewerOrigin，與 listener 同模式（避免兩側不對稱）。
  // handle 內 closure 不直接 close over render-scope props → useImperativeHandle dep 可為 []（zero re-create）。
  useImperativeHandle(ref, () => ({
    sendHighlight: (items) => post({ type: "highlight", items }),
    sendHighlightBatch: (items) => post({ type: "highlight_batch", items }),
    sendFocus: (ifcGuid) => post({ type: "focus", ifc_guid: ifcGuid }),
    sendClear: () => post({ type: "clear" }),
  }), []);

  // iframe src 用完整 viewerOrigin base（保留路徑前綴），附 session 與 coordinator handoff（對齊 /ui/open 的 query 鍵）。
  const buildSrc = (): string => {
    const params = new URLSearchParams({ session: props.sessionId });
    if (props.coordinatorApiBase) params.set("coordinatorApiBase", props.coordinatorApiBase);
    if (props.coordinatorSocketUrl) params.set("coordinatorSocketUrl", props.coordinatorSocketUrl);
    if (props.streamRole) params.set("streamRole", props.streamRole);
    if (props.kitInstanceId) params.set("kitInstanceId", props.kitInstanceId);
    if (props.userId) params.set("userId", props.userId);
    if (props.displayName) params.set("displayName", props.displayName);
    if (props.sourceClientId) params.set("sourceClientId", props.sourceClientId);
    const base = props.viewerOrigin.replace(/\/+$/, "");
    return `${base}/?${params.toString()}`;
  };
  const src = buildSrc();
  // S1：跨 origin iframe 須 allow-scripts allow-same-origin（WebRTC + sessionStorage）+ allow=autoplay
  //     （跨 origin <video> 自動播放，否則白頁）。viewer receive-only（AppStream mic:false）→ 不需 camera/microphone。
  return (
    <iframe ref={iframeRef} src={src} title="live-3d-viewer"
      onLoad={sendViewerLeaseToken}
      sandbox="allow-scripts allow-same-origin" allow="autoplay"
      style={{ width: "100%", height: "100%", minHeight: 480, border: "1px solid #2a2f3a", background: "#000" }} />
  );
});
