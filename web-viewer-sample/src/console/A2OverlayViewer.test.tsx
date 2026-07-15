// A2 F2⑥ 三組批次 3D 疊加（VersionDiffPage inline viewer）回歸鎖：
//   1) diff succeeded 前無疊加區塊；succeeded 後出現，session 未選時「套用疊加」disabled + 理由。
//   2) 選 session → 掛 ReviewSessionViewerPane(mode="a2-overlay") → 手動啟動 lease → first frame /
//      DataChannel / stage match 齊備後 apply enable；套用把三組（added=藍/removed=紅/modified=橘 的
//      severity 標籤）裝進「一個」sendHighlightBatch（聯集），同 GUID 多列去重、unmapped 誠實計數。
//   3) fake mapping 一律拒用（不冒充真實對映、不送批次）。
// stub 模式跟隨 A1ViewerEmbed.test.tsx（EmbeddedViewer forwardRef stub；vi.hoisted 共享 box）。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewerBox = vi.hoisted(() => ({
  renderCount: 0,
  batches: [] as unknown[][],
}));
vi.mock("./EmbeddedViewer", async () => {
  const React = await import("react");
  return {
    EmbeddedViewer: React.forwardRef((props: Record<string, unknown>, ref) => {
      viewerBox.renderCount += 1;
      React.useImperativeHandle(ref, () => ({
        sendHighlight() {},
        sendHighlightBatch(items: unknown[]) {
          viewerBox.batches.push(items);
          const onHighlightResult = props.onHighlightResult as undefined | ((message: unknown) => void);
          // 批次 ack（Window.tsx highlight_batch case 的形狀）：單一 highlight_result 帶誠實計數。
          onHighlightResult?.({
            protocol: "vg01", type: "highlight_result", requestId: "batch_test",
            ok: true, sent_count: items.length, unmapped_count: 0,
          });
        },
        sendFocus() {},
        sendClear() {},
      }));
      React.useEffect(() => {
        const onFirstFrame = props.onFirstFrame as undefined | ((message: unknown) => void);
        onFirstFrame?.({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
      }, [props]);
      return null;
    }),
  };
});

import { VersionDiffPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient, type DiffItemRow, type FilesTreeResponse } from "./governanceClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

const SESSION_ID = "review_session_a2";

function fakeRuntimeStatus() {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
      conversion_authority: { base_url: "", authority: "" },
      kit: [],
    },
    sessions: {
      count: 1, active_count: 1, participant_count: 0,
      items: [{
        session_id: SESSION_ID, status: "active", project_id: "p1", model_version_id: "m1",
        participant_count: 0, expected_stage_url: "stage://x",
        expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
        conversion_status: null, kit_instance_ids: [], created_at: "", updated_at: "", first_frame_at: null,
      }],
    },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: {
      classification: "", note: "",
      web_plane: { coordinator_port: 8004, viewer_port: 5173 },
      host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] },
    },
  };
}

const fakeTree: FilesTreeResponse = { root: "C:/storage", source_kind: "local_fs", projects: [] };

// diff items：三組 + 同 GUID 兩列（去重）+ unmapped + 缺 GUID（各誠實計數）。
const DIFF_ITEMS: DiffItemRow[] = [
  { change_type: "added", ifc_guid: "G_ADD", ifc_type: "IfcWall", change_summary: "new wall" },
  { change_type: "removed", ifc_guid: "G_DEL", ifc_type: "IfcWall", change_summary: "wall removed" },
  { change_type: "property_changed", ifc_guid: "G_MOD", ifc_type: "IfcDoor", change_summary: "prop changed" },
  { change_type: "moved", ifc_guid: "G_MOD", ifc_type: "IfcDoor", change_summary: "also moved" }, // 同 GUID → 去重
  { change_type: "added", ifc_guid: "G_UNMAPPED", ifc_type: "IfcSlab", change_summary: "no prim" },
  { change_type: "removed", ifc_guid: null, change_summary: "row without guid" },
];

const REAL_MAPPING = {
  mock: false,
  model_version_id: "m1",
  summary: { mapped_count: 3, fake_mapping_count: 0 },
  items: [
    { ifc_guid: "G_ADD", usd_prim_path: "/World/Add" },
    { ifc_guid: "G_DEL", usd_prim_path: "/World/Del" },
    { ifc_guid: "G_MOD", usd_prim_path: "/World/Mod" },
  ],
};

describe("A2 inline viewer 三組批次疊加", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    viewerBox.renderCount = 0;
    viewerBox.batches = [];
    window.location.hash = "#version-diff";
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(fakeTree);
    vi.spyOn(governanceClient, "createDiff").mockResolvedValue({ diff_id: "d_ov", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d_ov", status: "succeeded",
      summary: { base_count: 5, target_count: 5, matched: 3, counts: { added: 2, removed: 2, property_changed: 1, moved: 1 }, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue(DIFF_ITEMS);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus() as never);
    vi.spyOn(coordinatorClient, "claimViewerLease").mockResolvedValue({
      lease_id: "lease_a2", lease_token: "lease_token_a2", session_id: SESSION_ID,
      viewer_id: "a2_viewer", user_id: "a2_operator", display_name: "A2 diff overlay primary viewer",
      role: "primary", status: "active", kit_instance_id: "kit_1",
      stream_config: { signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 49101 },
      client_nonce: "nonce", claimed_at: "", expires_at: "", last_heartbeat_at: null, released_at: null,
      first_frame_at: null, loaded_stage_url: null, datachannel_ready: false, stage_match: null,
      heartbeat_after_ms: 15000, idempotent_replay: false, primary: true,
    } as never);
    vi.spyOn(coordinatorClient, "viewerLeaseHeartbeat").mockResolvedValue({} as never);
    vi.spyOn(coordinatorClient, "releaseViewerLease").mockResolvedValue({} as never);
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockResolvedValue({ session_id: SESSION_ID, first_frame_at: "2026-07-15T00:00:00.000Z" } as never);
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    if (container.parentNode) document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = "";
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const q = <T extends HTMLElement = HTMLElement>(tid: string) => container.querySelector<T>(`[data-testid="${tid}"]`);
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };
  const renderPage = async () => {
    root = createRoot(container);
    await act(async () => { root!.render(<VersionDiffPage />); });
    await flush();
  };
  const runDiff = async () => {
    const runBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Run Diff"))!;
    await act(async () => { runBtn.click(); });
    await flush();
  };
  const selectOverlaySession = async (id = SESSION_ID) => {
    const select = q<HTMLSelectElement>("a2-overlay-session-select")!;
    await act(async () => {
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  };
  const startA2Session = async () => {
    const start = q<HTMLButtonElement>("a2-overlay-manual-start")!;
    expect(start.disabled).toBe(false);
    await act(async () => { start.click(); });
    await flush();
  };

  it("diff succeeded 前無疊加區塊；succeeded 後出現且未選 session 時「套用疊加」disabled + 理由", async () => {
    await renderPage();
    expect(q("a2-overlay-session-select")).toBeNull(); // succeeded 前不存在

    await runDiff();
    expect(q("a2-overlay-session-select")).not.toBeNull();
    const apply = q<HTMLButtonElement>("a2-overlay-apply")!;
    expect(apply.disabled).toBe(true);
    expect(apply.textContent).toContain("先選擇 active review session"); // Btn caption 誠實理由
    expect(q("a2-overlay-ack")?.textContent).toContain("not_sent");
    expect(viewerBox.renderCount).toBe(0); // 未選 session 不掛 viewer、不 claim
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  });

  it("選 session 但未手動啟動 → apply 仍 disabled（gate 理由）；不自動 claim lease", async () => {
    await renderPage();
    await runDiff();
    await selectOverlaySession();

    expect(q("a2-overlay-manual-start")).not.toBeNull(); // pane 掛載（a2-overlay testid 前綴）
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled(); // 不自動 claim（N3）
    const apply = q<HTMLButtonElement>("a2-overlay-apply")!;
    expect(apply.disabled).toBe(true);
    expect(apply.textContent).toContain("attach"); // gate 理由：需先手動啟動 / attach Kit session
  });

  it("啟動 lease + first frame + stage match 後套用 → 單一批次含三組 severity、同 GUID 去重、unmapped 誠實計數", async () => {
    vi.spyOn(governanceClient, "elementMappingForSession").mockResolvedValue(REAL_MAPPING);
    await renderPage();
    await runDiff();
    await selectOverlaySession();
    await startA2Session();

    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ requested_role: "primary" }));
    const apply = q<HTMLButtonElement>("a2-overlay-apply")!;
    expect(apply.disabled).toBe(false); // stage://x（loaded）== expected_stage_url → gate 全開

    await act(async () => { apply.click(); });
    await flush();

    expect(governanceClient.elementMappingForSession).toHaveBeenCalledWith(SESSION_ID);
    // 單一批次（聯集），非逐筆多批。
    expect(viewerBox.batches).toHaveLength(1);
    expect(viewerBox.batches[0]).toEqual([
      { ifc_guid: "G_ADD", severity: "added", label: "added:G_ADD" },          // added → 協定藍
      { ifc_guid: "G_DEL", severity: "error", label: "removed:G_DEL" },        // removed → 協定紅
      { ifc_guid: "G_MOD", severity: "warning", label: "property_changed:G_MOD" }, // modified → 協定橘（moved 同 GUID 已去重）
    ]);
    // ack（stub 回 ok + sent_count）與 unmapped 誠實顯示。
    expect(q("a2-overlay-ack")?.textContent).toContain("sent=3");
    const unmapped = q("a2-overlay-unmapped")!.textContent ?? "";
    expect(unmapped).toContain("：1"); // console 端 unmapped（G_UNMAPPED）
    expect(unmapped).toContain("缺 ifc_guid");
    expect(container.textContent).not.toContain("lease_token"); // 機密不落 DOM
  });

  it("fake mapping → 拒用不送批次（誠實標示，不冒充真實對映）", async () => {
    vi.spyOn(governanceClient, "elementMappingForSession").mockResolvedValue({
      mock: true,
      summary: { mapped_count: 3, fake_mapping_count: 3, mapping_method: "fake_for_smoke_test" },
      items: REAL_MAPPING.items,
    });
    await renderPage();
    await runDiff();
    await selectOverlaySession();
    await startA2Session();

    const apply = q<HTMLButtonElement>("a2-overlay-apply")!;
    await act(async () => { apply.click(); });
    await flush();

    expect(viewerBox.batches).toHaveLength(0); // 不送
    expect(q("a2-overlay-ack")?.textContent).toContain("fake");
  });
});
