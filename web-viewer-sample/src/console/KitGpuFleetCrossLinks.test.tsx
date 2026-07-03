// web-viewer-sample/src/console/KitGpuFleetCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitGpuFleetPage } from "./pages";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { type SharedStatusSnapshot } from "./useSharedStatus";

const snap: SharedStatusSnapshot = { activeSessions: 2, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" }, review_session_b: { session_id: "review_session_b", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "2026-07-03", stale: false };

describe("KG real aggregate + demo separation", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); window.location.hash = ""; });
  afterEach(() => { document.body.removeChild(container); window.location.hash = ""; });

  it("shows a real session aggregate (asbuilt) and keeps the demo table as demo", () => {
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    const agg = container.querySelector('[data-testid="kg-live-aggregate"]');
    expect(agg?.textContent).toContain("2");
    // demo table still present and still labeled demo (Node snapshot panel), not faked as real
    expect(container.textContent).toContain("edge-gpu-01");
    expect(container.querySelector('[data-testid="kg-demo-link-sessions"]')).not.toBeNull();
  });

  it("navigates demo row chip to #sessions?source=instances (no session id on the static demo row)", () => {
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    const chip = container.querySelector('[data-testid="kg-demo-link-sessions"]') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    act(() => { chip.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#sessions?source=instances");
  });

  it("renders per-session live links that navigate to #sessions carrying the real session id", () => {
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    const live = container.querySelector('[data-testid="kg-session-link-review_session_a"]') as HTMLButtonElement;
    expect(live).not.toBeNull();
    act(() => { live.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#sessions?source=instances");
    expect(window.location.hash).toContain("session=review_session_a");
  });

  it("shows an honest empty state when there are no active sessions (no fake aggregate)", () => {
    const empty: SharedStatusSnapshot = { ...snap, activeSessions: 0, sessionsById: {} };
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={empty}><KitGpuFleetPage /></SharedStatusProvider>); });
    const agg = container.querySelector('[data-testid="kg-live-aggregate"]');
    expect(agg?.textContent).toContain("0");
    expect(container.querySelector('[data-testid^="kg-session-link-"]')).toBeNull();
  });

  // 誠實鐵律 / N5：sessionsById 依 spec §5.2 是全量表（由 runtime/status items 映射，不分狀態），且
  // coordinator 從不刪除 session（只 active→closing→closed，永遠保留）。故任何跑過並關閉過 session 的
  // 環境，sessionsById 都含 closed。此表標題「即時 session 聚合（真實）」、prov="asbuilt"、且緊鄰只算
  // active 的「使用中 session 數」；若把 closed session 當即時可點連結呈現＝把過期 session 假裝成真實可操作。
  it("does not surface a lingering closed session as a live link (aggregate says 0)", () => {
    const withClosed: SharedStatusSnapshot = { ...snap, activeSessions: 0, sessionsById: { review_session_old: { session_id: "review_session_old", status: "closed" } } };
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={withClosed}><KitGpuFleetPage /></SharedStatusProvider>); });
    const agg = container.querySelector('[data-testid="kg-live-aggregate"]');
    expect(agg?.textContent).toContain("0");
    // closed session 不得渲染成即時連結，且整個「真實」聚合不得出現任何 kg-session-link 假活躍鈕
    expect(container.querySelector('[data-testid="kg-session-link-review_session_old"]')).toBeNull();
    expect(container.querySelector('[data-testid^="kg-session-link-"]')).toBeNull();
    // 應顯誠實空狀態，而非假的即時連結
    expect(container.textContent).toContain("目前無使用中 session");
  });

  // active + closed 混雜：只有 active 應成為即時連結，closed 不得混入「真實」聚合。
  it("renders live links only for active sessions when active and closed coexist", () => {
    const mixed: SharedStatusSnapshot = { ...snap, activeSessions: 1, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" }, review_session_old: { session_id: "review_session_old", status: "closed" } } };
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={mixed}><KitGpuFleetPage /></SharedStatusProvider>); });
    expect(container.querySelector('[data-testid="kg-session-link-review_session_a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kg-session-link-review_session_old"]')).toBeNull();
  });
});
