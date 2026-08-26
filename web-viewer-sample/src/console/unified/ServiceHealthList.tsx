// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 服務健康六列的呈現（unified-console-runtime-truth design §3.3 svc-dot）
// 列資料一律由 ./serviceRows 的 deriveServiceRows 投影；本檔只負責渲染，不含判斷邏輯。
// ═══════════════════════════════════════════════════════════════════════
import { MONO } from "./fixtures";
import type { CoordinatorStatusSnapshot } from "./coordinatorStatusStore";
import { HEALTH_DOT } from "./runtimeTruth";
import { deriveServiceRows } from "./serviceRows";

export function ServiceHealthList({ snap, zh }: { snap: CoordinatorStatusSnapshot; zh: boolean }) {
  return (
    <>
      {deriveServiceRows(snap, zh).map((sv) => (
        <div key={sv.id} data-uc="svc-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span data-uc="svc-dot" data-health={sv.health} style={{ width: 7, height: 7, borderRadius: "50%", background: HEALTH_DOT[sv.health], flex: "none" }} />
          <span style={{ fontSize: "11.5px", color: "var(--ab-text-2)", flex: 1 }}>{sv.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dim)" }}>{sv.detail}</span>
        </div>
      ))}
    </>
  );
}
