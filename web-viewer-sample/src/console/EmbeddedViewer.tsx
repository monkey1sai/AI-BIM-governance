import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

// VG-01 postMessage 協定（版本化）。viewer→console 與 console→viewer 皆帶 protocol:"vg01"。
export interface FirstFrameMessage { protocol: "vg01"; type: "first_frame"; stageUrl: string | null }
export interface StageLoadedMessage { protocol: "vg01"; type: "stage_loaded"; stageUrl: string | null }
export interface HighlightResultMessage {
  protocol: "vg01"; type: "highlight_result"; requestId: string;
  ok: boolean; reason?: "unmapped" | "datachannel_not_ready";
}
export interface SelectedGuidMessage { protocol: "vg01"; type: "selected_guid"; ifcGuid: string | null }

export interface HighlightItem { ifc_guid: string; severity?: string; label?: string; rule_code?: string | null }

export interface EmbeddedViewerHandle {
  sendHighlight(items: HighlightItem[]): void;
  sendFocus(ifcGuid: string): void;
  sendClear(): void;
}

export interface EmbeddedViewerProps {
  sessionId: string;
  viewerOrigin: string; // 必須是「viewer 入口 origin」（:5173 baked viewer），非 coordinator :8004。
                        // 真源 = coordinatorClient.runtimeStatus().configured_endpoints.viewer.browser_url_base（Task 3 提供）。
                        // ⚠️ 傳成 coordinator base 會讓 iframe 載 coordinator HTML、postMessage 橋永遠收不到 viewer 訊息。
                        // 接收端白名單仍複用 VITE_ALLOWED_COORDINATOR_ORIGINS（viewer 端驗 parent=console origin）。
  onViewerReady?: () => void;
  onFirstFrame?: (m: FirstFrameMessage) => void;
  onStageLoaded?: (stageUrl: string | null) => void;
  onHighlightResult?: (m: HighlightResultMessage) => void;
  onSelectedGuid?: (ifcGuid: string | null) => void;
}

export const EmbeddedViewer = forwardRef<EmbeddedViewerHandle, EmbeddedViewerProps>(function EmbeddedViewer(props, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [, setViewerReady] = useState(false);

  // stable ref：每 render 同步最新 props，listener 才不必每 render 重掛。
  // 原 dep=[props]（每 render 新 object reference）會在每個 render cycle removeEventListener + addEventListener，
  // 在高頻輪詢（A1 定時 poll rule-runs）的 detach/attach 微小時窗內，viewer 送出的 first_frame / highlight_result 會被靜默丟棄。
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const p = propsRef.current;
      if (e.origin !== p.viewerOrigin) return;                     // 安全：origin 比對（非 "*"）
      if (e.source !== iframeRef.current?.contentWindow) return;   // 安全：來源 frame
      const m = e.data as { protocol?: string; type?: string } | null;
      if (!m || m.protocol !== "vg01") return;                     // 協定版本 / 前向相容（未知忽略）
      switch (m.type) {
        case "viewer_ready":     setViewerReady(true); p.onViewerReady?.(); break;
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

  // 送出側比照接收側：經 propsRef.current 讀最新 viewerOrigin，與 listener 同模式（避免兩側不對稱）。
  // handle 內 closure 不直接 close over render-scope props → useImperativeHandle dep 可為 []（zero re-create）。
  const post = (msg: Record<string, unknown>) =>
    iframeRef.current?.contentWindow?.postMessage({ protocol: "vg01", ...msg }, propsRef.current.viewerOrigin); // targetOrigin 非 "*"

  useImperativeHandle(ref, () => ({
    sendHighlight: (items) => post({ type: "highlight", items }),
    sendFocus: (ifcGuid) => post({ type: "focus", ifc_guid: ifcGuid }),
    sendClear: () => post({ type: "clear" }),
  }), []);

  const src = `${props.viewerOrigin}/?session=${encodeURIComponent(props.sessionId)}`;
  // S1：跨 origin iframe 須 allow-scripts allow-same-origin（WebRTC + sessionStorage）+ allow=autoplay
  //     （跨 origin <video> 自動播放，否則白頁）。viewer receive-only（AppStream mic:false）→ 不需 camera/microphone。
  return (
    <iframe ref={iframeRef} src={src} title="live-3d-viewer"
      sandbox="allow-scripts allow-same-origin" allow="autoplay"
      style={{ width: "100%", height: "100%", minHeight: 480, border: "1px solid #2a2f3a", background: "#000" }} />
  );
});
