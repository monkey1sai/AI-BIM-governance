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

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== props.viewerOrigin) return;                 // 安全：origin 比對（非 "*"）
      if (e.source !== iframeRef.current?.contentWindow) return;   // 安全：來源 frame
      const m = e.data as { protocol?: string; type?: string } | null;
      if (!m || m.protocol !== "vg01") return;                     // 協定版本 / 前向相容（未知忽略）
      switch (m.type) {
        case "viewer_ready":     setViewerReady(true); props.onViewerReady?.(); break;
        case "first_frame":      props.onFirstFrame?.(m as unknown as FirstFrameMessage); break;
        case "stage_loaded":     props.onStageLoaded?.((m as unknown as StageLoadedMessage).stageUrl); break;
        case "highlight_result": props.onHighlightResult?.(m as unknown as HighlightResultMessage); break;
        case "selected_guid":    props.onSelectedGuid?.((m as unknown as SelectedGuidMessage).ifcGuid ?? null); break;
        default: break; // 未知 type 忽略
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [props]);

  const post = (msg: Record<string, unknown>) =>
    iframeRef.current?.contentWindow?.postMessage({ protocol: "vg01", ...msg }, props.viewerOrigin); // targetOrigin 非 "*"

  useImperativeHandle(ref, () => ({
    sendHighlight: (items) => post({ type: "highlight", items }),
    sendFocus: (ifcGuid) => post({ type: "focus", ifc_guid: ifcGuid }),
    sendClear: () => post({ type: "clear" }),
  }), [props.viewerOrigin]);

  const src = `${props.viewerOrigin}/?session=${encodeURIComponent(props.sessionId)}`;
  // S1：跨 origin iframe 須 allow-scripts allow-same-origin（WebRTC + sessionStorage）+ allow=autoplay
  //     （跨 origin <video> 自動播放，否則白頁）。viewer receive-only（AppStream mic:false）→ 不需 camera/microphone。
  return (
    <iframe ref={iframeRef} src={src} title="live-3d-viewer"
      sandbox="allow-scripts allow-same-origin" allow="autoplay"
      style={{ width: "100%", height: "100%", minHeight: 480, border: "1px solid #2a2f3a", background: "#000" }} />
  );
});
