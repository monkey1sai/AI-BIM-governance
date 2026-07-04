// web-viewer-sample/src/console/SessionCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManagementPage } from "./pages";
import { coordinatorClient, type RuntimeStatus, type RuntimeSessionSummary } from "./coordinatorClient";

// Task 8（SS axis）：per-row #instances / #review / #a1 cross-link chips。SS 頁維持自己 mount-once
// runtimeStatus 抓取（N6，不耦合 useSharedStatus）；chips 純讀既有列變數 s.session_id 組 buildHandoff。
const mk = (over: Partial<RuntimeSessionSummary>): RuntimeSessionSummary => ({
  session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1",
  participant_count: 1, expected_stage_url: null, conversion_status: null,
  kit_instance_ids: [], created_at: "", updated_at: "", ...over,
});
const status = (items: RuntimeSessionSummary[]): RuntimeStatus => ({
  service: { status: "ok", name: "c", uptime_seconds: 1, generated_at: "" },
  configured_endpoints: {
    coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
    viewer: { browser_url_base: "", handoff_path: "/" },
    conversion_authority: { base_url: "", authority: "" },
    kit: [],
  },
  sessions: { count: items.length, active_count: items.length, participant_count: 0, items },
  kit_instance_bindings: [],
  ifc_ready_jobs: { count: 0, recent: [] },
  observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } },
});

describe("SS per-row cross-link chips", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    window.location.hash = "";
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("renders instances/review/a1 chips per session and navigates with source=sessions", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mk({ session_id: "review_session_a" })]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="session-link-instances-review_session_a"]')).not.toBeNull();
    const review = container.querySelector('[data-testid="session-link-review-review_session_a"]') as HTMLButtonElement;
    expect(review).not.toBeNull();
    await act(async () => { review.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#review?source=sessions");
    expect(window.location.hash).toContain("session=review_session_a");
  });

  it("A1 chip navigates to #a1?source=sessions with the row's session id", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mk({ session_id: "review_session_b" })]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const a1 = container.querySelector('[data-testid="session-link-a1-review_session_b"]') as HTMLButtonElement;
    expect(a1).not.toBeNull();
    await act(async () => { a1.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#a1?source=sessions");
    expect(window.location.hash).toContain("session=review_session_b");
  });

  it("KG chip navigates to #instances?source=sessions with the row's session id", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mk({ session_id: "review_session_c" })]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const instances = container.querySelector('[data-testid="session-link-instances-review_session_c"]') as HTMLButtonElement;
    expect(instances).not.toBeNull();
    await act(async () => { instances.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#instances?source=sessions");
    expect(window.location.hash).toContain("session=review_session_c");
  });

  it("does not disturb the existing terminate button for an active session", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mk({ session_id: "review_session_d" })]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="session-terminate-review_session_d"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="session-link-review-review_session_d"]')).not.toBeNull();
  });

  // reviewer P2（CodeRabbit + Codex 兩位獨立命中同一發現，已核實）：KG/Review chips 過去對 closing/closed
  // session 一律可點，導向 Review Room/KG 機隊後那兩頁只把 active/created 當可 attach，形成「點了打不開」的
  // 死路（比照 CoordinatorPage 對等 rt-crosslinks Panel 已有的 gating）。以下兩個測試釘住修好的行為。
  it("disables KG/Review chips for a closed session (honest dead-end guard)", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mk({ session_id: "review_session_e", status: "closed" })]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const instances = container.querySelector('[data-testid="session-link-instances-review_session_e"]') as HTMLButtonElement;
    const review = container.querySelector('[data-testid="session-link-review-review_session_e"]') as HTMLButtonElement;
    expect(instances.disabled).toBe(true);
    expect(review.disabled).toBe(true);
  });

  it("keeps KG/Review chips enabled for a created session (not yet Kit-bound, still attachable)", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mk({ session_id: "review_session_f", status: "created" })]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const instances = container.querySelector('[data-testid="session-link-instances-review_session_f"]') as HTMLButtonElement;
    const review = container.querySelector('[data-testid="session-link-review-review_session_f"]') as HTMLButtonElement;
    expect(instances.disabled).toBe(false);
    expect(review.disabled).toBe(false);
  });
});
