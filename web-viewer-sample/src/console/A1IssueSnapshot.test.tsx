// F2⑩ 回歸鎖：A1「回拋摘要至雲端」（POST /api/review-sessions/:sessionId/issue-snapshot）。
// 三案例：無 session 脈絡誠實 disabled / 成功 202 顯 outbox_id + #conv 連結 / 502 誠實錯誤（不做假成功）。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ReviewSessionViewerPane（session 流程會渲染）依賴 EmbeddedViewer；stub 用 forwardRef
// （純 function stub 會讓 ref 掛載永遠 undefined——見既有 A1ViewerEmbed.test.tsx 同款處理）。
vi.mock("./EmbeddedViewer", async () => {
  const React = await import("react");
  return {
    EmbeddedViewer: React.forwardRef(() => null),
  };
});

import { A1GovernanceWorkbenchPage } from "./A1GovernanceWorkbenchPage";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";
import { governanceClient, type FilesTreeResponse, type RuleRunStatus } from "./governanceClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

const LOCAL_IFC_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/建築/model.ifc";
// local_fs select 的 option value = 唯一邏輯鍵（library:// 流）：version.path 被 proxy 遮蔽，不可當鍵。
const LOCAL_IFC_KEY = "270/建築/model.ifc";
const MINIO_KEY = "松風庵/root/main/u1/model.ifc";
const MINIO_IDEMPOTENCY_KEY = "mw_0000000000000001";
const REVIEW_SESSION_ID = "review_session_x";

function fakeSession(sessionId: string) {
  return {
    session_id: sessionId,
    status: "active",
    project_id: "p1",
    model_version_id: "v1",
    participant_count: 0,
    expected_stage_url: "stage://x",
    expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
    conversion_status: null,
    kit_instance_ids: [],
    created_at: "",
    updated_at: "",
    first_frame_at: null,
  };
}

function fakeRuntimeStatus(items = [fakeSession(REVIEW_SESSION_ID)]) {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
      conversion_authority: { base_url: "", authority: "" },
      kit: [],
    },
    sessions: { count: items.length, active_count: items.length, participant_count: 0, items },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: {
      classification: "",
      note: "",
      web_plane: { coordinator_port: 8004, viewer_port: 5173 },
      host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] },
    },
  };
}

function fakeRunStatus(status: RuleRunStatus["status"], overrides: Partial<RuleRunStatus> = {}): RuleRunStatus {
  return {
    rule_run_id: "rr_a1",
    status,
    score: 99,
    rule_set: "default",
    model_version_id: "v1",
    summary: { total: 10, passed: 9, failed: 1, errored: 0, target_summary: {}, warnings: [] },
    ...overrides,
  };
}

const fakeFilesTree: FilesTreeResponse = {
  root: "C:/Repos/active/iot/AI-BIM-governance/storage",
  source_kind: "local_fs",
  projects: [{
    project_id: "270",
    models: [{
      model_id: "建築",
      versions: [
        { name: "model.ifc", path: LOCAL_IFC_PATH, size_bytes: 12345, mtime: "2026-07-06T00:00:00+08:00" },
      ],
    }],
  }],
};

function fakeIfcReadyJob(overrides: Partial<IfcReadyListItem> = {}): IfcReadyListItem {
  return {
    ifc_ready_job_id: "ifcready_1",
    status: "ready",
    project_id: "p1",
    external_model_version_id: "v1",
    download_status: "downloaded",
    conversion_status: "ready",
    conversion_authority: "conversion-service",
    queue_position: null,
    conversion_job_id: "conv_1",
    dispatch_error: null,
    review_session_id: REVIEW_SESSION_ID,
    viewer_url: null,
    expected_stage_url: "stage://x",
    expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
    artifact_health: {
      source_ifc_exists: true,
      model_usdc_reachable: true,
      mapping_reachable: true,
      metadata_reachable: null,
      all_required_ready: true,
      checked_at: "2026-07-15T10:00:00.000Z",
      stale_reason: null,
      failure_details: null,
      source: "edge_health_probe",
    },
    created_at: "2026-07-15T00:00:00+08:00",
    updated_at: "2026-07-15T00:00:01+08:00",
    idempotency_key: MINIO_IDEMPOTENCY_KEY,
    project_display_name: "松風庵",
    category: "建築",
    ...overrides,
  };
}

describe("A1 issue snapshot（F2⑩ 回拋摘要至雲端）", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    window.location.hash = "#a1";
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus() as never);
    vi.spyOn(coordinatorClient, "getTestDataProjects").mockResolvedValue({ projects: [] });
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(fakeFilesTree);
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 1,
      objects: [{ key: MINIO_KEY, etag: "e", role: "source_ifc", idempotency_key: MINIO_IDEMPOTENCY_KEY, project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" }],
    });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getCallbackOutboxSummary").mockResolvedValue({ total: 0, limit: 200, entries: [] });
    vi.spyOn(governanceClient, "listRuleRuns").mockResolvedValue({ filters: {}, limit: 5, offset: 0, total: 0, items: [] });
    // A1 不得自動 claim / heartbeat / release viewer lease（沿用 3D decoupling 回歸鎖的防呆 stub）。
    vi.spyOn(coordinatorClient, "claimViewerLease").mockRejectedValue(new Error("A1 must not claim viewer lease"));
    vi.spyOn(coordinatorClient, "releaseViewerLease").mockRejectedValue(new Error("A1 must not release viewer lease"));
    vi.spyOn(coordinatorClient, "viewerLeaseHeartbeat").mockRejectedValue(new Error("A1 must not heartbeat viewer lease"));
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockRejectedValue(new Error("A1 must not report first frame"));
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    if (container.parentNode) document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const q = <T extends HTMLElement = HTMLElement>(tid: string) => container.querySelector<T>(`[data-testid="${tid}"]`);
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };
  const renderA1 = async () => {
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();
  };
  const runLocalFsToScored = async () => {
    // local_fs run 走 library:// 邏輯識別 → createRuleRunForLibrary（path 被遮蔽不可回送）。
    vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);
    await renderA1();
    const model = q<HTMLSelectElement>("a1-localfs-select")!;
    await act(async () => {
      model.value = LOCAL_IFC_KEY;
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
  };
  const runMinioForSessionToScored = async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({ count: 1, items: [fakeIfcReadyJob()] });
    vi.spyOn(governanceClient, "createRuleRunForSession").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);
    await renderA1();
    await act(async () => { q<HTMLButtonElement>("a1-source-minio")!.click(); });
    await flush();
    const model = q<HTMLSelectElement>("a1-minio-select")!;
    await act(async () => {
      model.value = MINIO_KEY;
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
  };

  it("local_fs rule-run 成功但無 session 脈絡：按鈕 disabled + 誠實 reason「需 review session 脈絡（F2⑩ 綁 session）」，點擊不打 API", async () => {
    const snapshotSpy = vi.spyOn(coordinatorClient, "postIssueSnapshot").mockResolvedValue({ outbox_id: "outbox_never" });
    await runLocalFsToScored();

    const button = q<HTMLButtonElement>("a1-issue-snapshot")!;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("需 review session 脈絡（F2⑩ 綁 session）");
    expect(button.textContent).toContain("需 review session 脈絡（F2⑩ 綁 session）"); // caption 也誠實顯示
    await act(async () => { button.click(); });
    await flush();
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(q("a1-issue-snapshot-result")).toBeNull();
  });

  it("for-session rule-run 成功：按鈕 enabled，202 顯示 outbox_id（a1-issue-snapshot-result）與 #conv 連結提示", async () => {
    const snapshotSpy = vi.spyOn(coordinatorClient, "postIssueSnapshot").mockResolvedValue({ outbox_id: "outbox_snap_1" });
    await runMinioForSessionToScored();

    const button = q<HTMLButtonElement>("a1-issue-snapshot")!;
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); });
    await flush();

    expect(snapshotSpy).toHaveBeenCalledWith(REVIEW_SESSION_ID, { rule_run_id: "rr_a1", model_version_id: "v1" });
    const result = q("a1-issue-snapshot-result")!;
    expect(result).not.toBeNull();
    expect(result.textContent).toContain("outbox_snap_1");
    const link = result.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("#conv");
    expect(link.textContent).toContain("轉檔歷史");
    expect(q("a1-issue-snapshot-error")).toBeNull();
  });

  it("檔案庫檢核需明確選擇同版本 session 才能回拋", async () => {
    const post = vi.spyOn(coordinatorClient, "postIssueSnapshot").mockResolvedValue({ outbox_id: "local_library_snapshot" });
    await runLocalFsToScored();
    expect(q<HTMLButtonElement>("a1-issue-snapshot")!.disabled).toBe(true);
    const session = q<HTMLSelectElement>("a1-session-select")!;
    await act(async () => { session.value = REVIEW_SESSION_ID; session.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { q<HTMLButtonElement>("a1-issue-snapshot")!.click(); });
    expect(post).toHaveBeenCalledWith(REVIEW_SESSION_ID, { rule_run_id: "rr_a1", model_version_id: "v1" });
  });

  it("不同版本 session 不可回拋，也不把本機選項鍵當成 run 的版本", async () => {
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue(fakeRuntimeStatus([{ ...fakeSession(REVIEW_SESSION_ID), model_version_id: "wrong_version" }]) as never);
    const post = vi.spyOn(coordinatorClient, "postIssueSnapshot");
    await runLocalFsToScored();
    const session = q<HTMLSelectElement>("a1-session-select")!;
    await act(async () => { session.value = REVIEW_SESSION_ID; session.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(q<HTMLButtonElement>("a1-issue-snapshot")!.disabled).toBe(true);
    expect(q<HTMLButtonElement>("a1-issue-snapshot")!.title).toContain("模型版本必須相同");
    expect(post).not.toHaveBeenCalled();
  });

  it("502 governance_unreachable：誠實錯誤顯示（governance 不可達、未入列），不顯示假 outbox_id", async () => {
    vi.spyOn(coordinatorClient, "postIssueSnapshot").mockRejectedValue(
      new Error('coordinator /api/review-sessions/review_session_x/issue-snapshot -> 502 {"error":"governance_unreachable"}'),
    );
    await runMinioForSessionToScored();

    const button = q<HTMLButtonElement>("a1-issue-snapshot")!;
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); });
    await flush();

    const error = q("a1-issue-snapshot-error")!;
    expect(error).not.toBeNull();
    expect(error.textContent).toContain("governance 不可達，摘要未入列");
    expect(error.textContent).toContain("governance_unreachable");
    expect(q("a1-issue-snapshot-result")).toBeNull();
  });

  it.each(["success", "failure"])("舊 snapshot %s 在切換來源並開始新請求後不可回填或解除 busy", async outcome => {
    let finishOld!: (value: { outbox_id: string }) => void, failOld!: (error: Error) => void;
    let finishNew!: (value: { outbox_id: string }) => void;
    const old = new Promise<{ outbox_id: string }>((resolve, reject) => { finishOld = resolve; failOld = reject; });
    const next = new Promise<{ outbox_id: string }>(resolve => { finishNew = resolve; });
    const post = vi.spyOn(coordinatorClient, "postIssueSnapshot").mockReturnValueOnce(old).mockReturnValueOnce(next);
    await runMinioForSessionToScored();
    await act(async () => { q<HTMLButtonElement>("a1-issue-snapshot")!.click(); });
    await act(async () => { q<HTMLButtonElement>("a1-source-local")!.click(); });
    await act(async () => { q<HTMLButtonElement>("a1-source-minio")!.click(); });
    const model = q<HTMLSelectElement>("a1-minio-select")!;
    await act(async () => { model.value = MINIO_KEY; model.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-issue-snapshot")!.click(); q<HTMLButtonElement>("a1-issue-snapshot")!.click(); });
    expect(post).toHaveBeenCalledTimes(2);
    await act(async () => { if (outcome === "success") finishOld({ outbox_id: "stale_id" }); else failOld(new Error("old_snapshot_failure")); });
    expect(q("a1-issue-snapshot-result")).toBeNull();
    expect(q("a1-issue-snapshot-error")).toBeNull();
    expect(q<HTMLButtonElement>("a1-issue-snapshot")!.disabled).toBe(true);
    await act(async () => finishNew({ outbox_id: "current_id" }));
    expect(q("a1-issue-snapshot-result")!.textContent).toContain("current_id");
    expect(q<HTMLButtonElement>("a1-issue-snapshot")!.disabled).toBe(false);
  });
});
