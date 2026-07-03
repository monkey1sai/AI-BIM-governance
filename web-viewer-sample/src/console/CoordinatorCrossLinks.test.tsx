// web-viewer-sample/src/console/CoordinatorCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorPage } from "./pages";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

const rt: RuntimeStatus = { service: { status: "ok", name: "c", uptime_seconds: 1, generated_at: "" }, configured_endpoints: { coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" }, viewer: { browser_url_base: "", handoff_path: "/" }, conversion_authority: { base_url: "", authority: "" }, kit: [] }, sessions: { count: 1, active_count: 1, participant_count: 0, items: [ { session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 0, expected_stage_url: null, conversion_status: null, kit_instance_ids: [], created_at: "", updated_at: "" } ] }, kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] }, observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } } };

// coordinator 從不刪除 session（只 active→closing→closed，永遠保留），故 GET /api/runtime/status 的
// 全量 items 會隨時間殘留 closed。RT 是值班「即時」視圖，closed session 的即時操作型跨頁鈕不得假裝可用（N5）。
const baseItem = rt.sessions.items[0];
const rtClosedOnly: RuntimeStatus = { ...rt, sessions: { ...rt.sessions, count: 1, active_count: 0, items: [{ ...baseItem, session_id: "review_session_old", status: "closed" }] } };
const rtActiveAndClosed: RuntimeStatus = { ...rt, sessions: { ...rt.sessions, count: 2, active_count: 1, items: [baseItem, { ...baseItem, session_id: "review_session_old", status: "closed" }] } };

describe("RT cross-link session panel", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); window.location.hash = ""; });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = ""; });

  it("lists sessions with #sessions/#review/#instances chips carrying source=runtime", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt);
    const root = createRoot(container);
    await act(async () => { root.render(<CoordinatorPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="rt-crosslinks"]')).not.toBeNull();
    const inst = container.querySelector('[data-testid="rt-link-instances-review_session_a"]') as HTMLButtonElement;
    expect(inst).not.toBeNull();
    await act(async () => { inst.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#instances?source=runtime");

    // Each click overwrites window.location.hash, so assert each chip's destination right after its own click
    // (mirrors IntakeCrossLinks / SessionCrossLinks). Guards the SS + Review onClick handoffs so a wrong target
    // or param name (e.g. "review"→"sessions", or a mis-typed session key) can't silently regress — the
    // disabled-only checks below never exercise these two handoff strings.
    const ss = container.querySelector('[data-testid="rt-link-sessions-review_session_a"]') as HTMLButtonElement;
    expect(ss).not.toBeNull();
    await act(async () => { ss.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#sessions?source=runtime");
    expect(window.location.hash).toContain("session=review_session_a");

    const review = container.querySelector('[data-testid="rt-link-review-review_session_a"]') as HTMLButtonElement;
    expect(review).not.toBeNull();
    await act(async () => { review.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#review?source=runtime");
    expect(window.location.hash).toContain("session=review_session_a");
  });

  // N5 誠實鐵律：closed session 的「Review Room 開此 session」「Kit / GPU 機隊」為即時可操作語意，
  // 不得對過期 session 給滿血可點鈕（比照同分支 0860a54）。「Session 管理」是 lifecycle 全量治理視圖，保留 enabled。
  it("disables the Review Room / KG live links for a closed session but keeps Session Management enabled", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtClosedOnly);
    const root = createRoot(container);
    await act(async () => { root.render(<CoordinatorPage />); });
    await act(async () => { await Promise.resolve(); });

    const ss = container.querySelector('[data-testid="rt-link-sessions-review_session_old"]') as HTMLButtonElement;
    const review = container.querySelector('[data-testid="rt-link-review-review_session_old"]') as HTMLButtonElement;
    const inst = container.querySelector('[data-testid="rt-link-instances-review_session_old"]') as HTMLButtonElement;
    expect(ss).not.toBeNull(); expect(review).not.toBeNull(); expect(inst).not.toBeNull();
    expect(review.disabled).toBe(true);
    expect(inst.disabled).toBe(true);
    expect(ss.disabled).toBe(false);
  });

  it("keeps Review Room / KG operable only for the active row when active and closed coexist", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtActiveAndClosed);
    const root = createRoot(container);
    await act(async () => { root.render(<CoordinatorPage />); });
    await act(async () => { await Promise.resolve(); });

    expect((container.querySelector('[data-testid="rt-link-review-review_session_a"]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="rt-link-instances-review_session_a"]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="rt-link-review-review_session_old"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="rt-link-instances-review_session_old"]') as HTMLButtonElement).disabled).toBe(true);
  });

  // N5 誠實鐵律：初載失敗時 rt 停在 null，此 Panel 不得把「連不上 coordinator」渲染成「確實無 session」
  // （false-empty）。錯誤要在 Panel 內浮出，且不得出現 confirmed-empty 文案（否則等於把不確定講成事實）。
  it("surfaces the fetch error instead of a false 'no session' when runtime status load fails", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("boom"));
    const root = createRoot(container);
    await act(async () => { root.render(<CoordinatorPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const region = container.querySelector('[data-testid="rt-crosslinks"]') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.textContent ?? "").not.toContain("無 session");
    expect(region.querySelector(".ec-warn-note")).not.toBeNull();
    expect(region.textContent ?? "").toContain("未連線 coordinator");
  });
});
