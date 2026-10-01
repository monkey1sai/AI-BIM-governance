import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CompassSource } from "./CompassHud";
import { drawCfdHud, type CfdHudModel } from "./cfdHud";

export function CfdHudCanvas({ hud, source }: { hud: CfdHudModel; source: CompassSource }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const paint = () => {
      const bounds = element.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
      element.width = Math.round(bounds.width * ratio); element.height = Math.round(bounds.height * ratio);
      const ctx = element.getContext("2d");
      if (!ctx || !bounds.width || !bounds.height) return;
      ctx.scale(ratio, ratio);
      drawCfdHud(ctx, bounds.width, bounds.height, hud, snapshot.heading, new Date().toISOString());
    };
    paint();
    const observer = new ResizeObserver(paint); observer.observe(element);
    const timer = window.setInterval(paint, 1000);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, [hud, snapshot.heading]);
  return <canvas ref={canvas} data-testid="cfd-viewer-hud" data-run-id={hud.runId} data-revision={hud.revisionId}
    data-pressure-visible={String(Boolean(hud.pressure))} role="img"
    aria-label={`設計比較用 · ${hud.validationLevel} · 風的來向 ${hud.windFrom}° · ${hud.northLabel} · 示意動畫，基於穩態解；非瞬態模擬`}
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }} />;
}
