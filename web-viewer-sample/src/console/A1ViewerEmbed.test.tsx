// A1 3D 回歸鎖：A1 可在本頁建立 / attach 3D session，但仍不得 mount 後自動 claim lease。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewerBox = vi.hoisted(() => ({
  renderCount: 0,
  highlightBatches: [] as unknown[][],
}));
vi.mock("./EmbeddedViewer", async () => {
  const React = await import("react");
  return {
    EmbeddedViewer: React.forwardRef((props: Record<string, unknown>, ref) => {
    viewerBox.renderCount += 1;
    React.useImperativeHandle(ref, () => ({
      sendHighlight(items: unknown[]) {
        viewerBox.highlightBatches.push(items);
        const onHighlightResult = props.onHighlightResult as undefined | ((message: unknown) => void);
        onHighlightResult?.({ protocol: "vg01", type: "highlight_result", requestId: "test", ok: true });
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

import { A1GovernanceWorkbenchPage } from "./pages";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";
import { governanceClient, type FilesTreeResponse, type IssueRow, type RuleRunStatus } from "./governanceClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

function fakeRuntimeStatus(items = [fakeSession("review_session_x")]) {
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

function fakeSession(sessionId: string) {
  return {
    session_id: sessionId,
    status: "active",
    project_id: "p1",
    model_version_id: "m1",
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

function fakeRunStatus(status: RuleRunStatus["status"], overrides: Partial<RuleRunStatus> = {}): RuleRunStatus {
  return {
    rule_run_id: "rr_a1",
    status,
    score: 99,
    rule_set: "default",
    model_version_id: null,
    summary: { total: 10, passed: 9, failed: 1, errored: 0, target_summary: {}, warnings: [] },
    ...overrides,
  };
}

const LOCAL_IFC_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/建築/model.ifc";
const LOCAL_IFC_PATH_B = "C:/Repos/active/iot/AI-BIM-governance/storage/270/建築/model-b.ifc";
// local_fs 選項 value / state.ifcPath 改用唯一邏輯鍵（library:// 流）：files/tree 的 version.path
// 對瀏覽器被 proxy 遮蔽成 "[server-path]"（全部選項同值），path 不能再當 select 鍵或回送後端。
const LOCAL_IFC_KEY = "270/建築/model.ifc";
const LOCAL_IFC_KEY_B = "270/建築/model-b.ifc";
const MINIO_KEY = "松風庵/root/main/u1/model.ifc";
const MINIO_KEY_B = "松風庵/root/main/u2/model-b.ifc";
const MINIO_IDEMPOTENCY_KEY = "mw_0000000000000001";
const REVIEW_SESSION_ID = "review_session_x";
const fakeFilesTree: FilesTreeResponse = {
  root: "C:/Repos/active/iot/AI-BIM-governance/storage",
  source_kind: "local_fs",
  projects: [{
    project_id: "270",
    models: [{
      model_id: "建築",
      versions: [
        { name: "model.ifc", path: LOCAL_IFC_PATH, size_bytes: 12345, mtime: "2026-07-06T00:00:00+08:00" },
        { name: "model-b.ifc", path: LOCAL_IFC_PATH_B, size_bytes: 67890, mtime: "2026-07-06T00:00:00+08:00" },
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
      checked_at: "2026-07-07T10:00:00.000Z",
      stale_reason: null,
      failure_details: null,
      source: "edge_health_probe",
    },
    created_at: "2026-07-06T00:00:00+08:00",
    updated_at: "2026-07-06T00:00:01+08:00",
    idempotency_key: MINIO_IDEMPOTENCY_KEY,
    project_display_name: "松風庵",
    category: "建築",
    ...overrides,
  };
}

describe("A1 3D review decoupling", () => {
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
    viewerBox.highlightBatches = [];
    window.location.hash = "#a1";
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus() as never);
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(fakeFilesTree);
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 1,
      objects: [{ key: MINIO_KEY, etag: "e", role: "source_ifc", idempotency_key: MINIO_IDEMPOTENCY_KEY, project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" }],
    });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(governanceClient, "listRuleRuns").mockResolvedValue({ filters: {}, limit: 5, offset: 0, total: 0, items: [] });
    vi.spyOn(coordinatorClient, "claimViewerLease").mockRejectedValue(new Error("A1 must not claim viewer lease"));
    vi.spyOn(coordinatorClient, "releaseViewerLease").mockRejectedValue(new Error("A1 must not release viewer lease"));
    vi.spyOn(coordinatorClient, "viewerLeaseHeartbeat").mockRejectedValue(new Error("A1 must not heartbeat viewer lease"));
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockRejectedValue(new Error("A1 must not report first frame"));
    vi.spyOn(coordinatorClient, "createReviewSessionForIfcReady").mockRejectedValue(new Error("unexpected A1 review-session creation"));
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
  const selectSession = async (sessionId = "review_session_x") => {
    const select = q<HTMLSelectElement>("a1-session-select")!;
    await act(async () => {
      select.value = sessionId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  };
  const pickModel = async (key = LOCAL_IFC_KEY) => {
    const model = q<HTMLSelectElement>("a1-localfs-select")!;
    await act(async () => {
      model.value = key; // option value = 唯一邏輯鍵 {project}/{model}/{version.name}
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
  };
  const selectMinioSource = async (key = MINIO_KEY) => {
    await act(async () => { q<HTMLButtonElement>("a1-source-minio")!.click(); });
    await flush();
    const model = q<HTMLSelectElement>("a1-minio-select")!;
    await act(async () => {
      model.value = key;
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  };

  it("active session mount does not render EmbeddedViewer, auto-select, or claim viewer lease", async () => {
    await renderA1();

    const select = q<HTMLSelectElement>("a1-session-select");
    expect(select).not.toBeNull();
    expect(select!.value).toBe("");
    expect(viewerBox.renderCount).toBe(0);
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
    expect(coordinatorClient.viewerLeaseHeartbeat).not.toHaveBeenCalled();
    expect(coordinatorClient.reportFirstFrame).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("3D 即時檢視（嵌入 live viewer）");
    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(true);
  });

  it("picked local_fs IFC enables governance run without review session and calls createRuleRunForLibrary", async () => {
    // 等價改寫（library:// 邏輯識別修復）：files/tree 的 path 被 proxy 遮蔽成 "[server-path]"，
    // 瀏覽器不可能回送真路徑當 ifc_source_path；local_fs run 改走 coordinator
    // /api/governance-library/rule-runs（送邏輯三段，server-side 解析真路徑）。
    // 原 createRuleRun(直送 path) 斷言改為「絕不被呼叫」守門。
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("local_fs must not send raw/masked path as ifc_source_path"));
    const forLibrarySpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("for-session must not be required"));
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await renderA1();
    await pickModel();
    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(run.disabled).toBe(false);

    await act(async () => { run.click(); });
    await flush();

    expect(forLibrarySpy).toHaveBeenCalledWith({
      project_id: "270",
      model_id: "建築",
      version_name: "model.ifc",
      model_version_id: "270/建築/model.ifc",
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    });
    expect(directRunSpy).not.toHaveBeenCalled();
    expect(forSessionSpy).not.toHaveBeenCalled();
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  });

  it("selected MinIO object key is not sent as ifc_source_path", async () => {
    const createSpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });

    await renderA1();
    await selectMinioSource();

    const pick = q<HTMLButtonElement>("a1-step-pick")!;
    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(pick.disabled).toBe(true);
    expect(run.disabled).toBe(true);
    expect(q("a1-minio-source-note")?.textContent).toContain("server-local IFC path");

    await act(async () => { run.click(); });
    await flush();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("downloaded MinIO object with review session runs through coordinator for-session proxy", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({ count: 1, items: [fakeIfcReadyJob()] });
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("MinIO session-backed run must not use direct rule-run"));
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await renderA1();
    await selectMinioSource();

    expect(q("a1-minio-resolution-note")?.textContent).toContain(REVIEW_SESSION_ID);
    const pick = q<HTMLButtonElement>("a1-step-pick")!;
    expect(pick.disabled).toBe(false);

    await act(async () => { pick.click(); });
    await flush();

    expect(q<HTMLSelectElement>("a1-session-select")?.value).toBe(REVIEW_SESSION_ID);
    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(run.disabled).toBe(false);

    await act(async () => { run.click(); });
    await flush();

    expect(forSessionSpy).toHaveBeenCalledWith(REVIEW_SESSION_ID, {
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    });
    expect(directRunSpy).not.toHaveBeenCalled();
  });

  it("downloaded MinIO object without conversion ready keeps CPU rule-run but disables 3D session actions", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({
        review_session_id: null,
        conversion_job_id: null,
        conversion_status: null,
        expected_stage_url: null,
        expected_mapping_url: null,
        artifact_health: {
          source_ifc_exists: true,
          model_usdc_reachable: null,
          mapping_reachable: null,
          metadata_reachable: null,
          all_required_ready: false,
          checked_at: "2026-07-07T10:00:00.000Z",
          stale_reason: null,
          failure_details: null,
          source: "edge_health_probe",
        },
      })],
    });
    const forIfcReadySpy = vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    const createReviewSessionSpy = vi.spyOn(coordinatorClient, "createReviewSessionForIfcReady").mockRejectedValue(new Error("conversion-not-ready must not create review session"));
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "guid_cpu_only", usd_prim_path: null, rule_code: "CPU-ONLY", severity: "error", status: "fail", message: "CPU rule fail" },
    ]);

    await renderA1();
    await selectMinioSource();
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();

    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(run.disabled).toBe(false);
    await act(async () => { run.click(); });
    await flush();

    expect(forIfcReadySpy).toHaveBeenCalledWith("ifcready_1", {
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    });
    expect(q<HTMLButtonElement>("a1-create-review-session")!.disabled).toBe(true);
    expect(q<HTMLButtonElement>("a1-retry-conversion")!.disabled).toBe(true);
    expect(q("a1-open-viewer")).toBeNull();
    expect(q("a1-open-review-room")).toBeNull();
    expect(q("a1-inline-manual-start")).toBeNull();
    expect(createReviewSessionSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#a1");
  });

  it("reports a post-retry job refresh failure separately from a successful conversion retry", async () => {
    vi.mocked(coordinatorClient.listIfcReady)
      .mockResolvedValueOnce({
        count: 1,
        items: [fakeIfcReadyJob({ status: "dispatch_failed", conversion_status: "failed", review_session_id: null })],
      })
      .mockRejectedValueOnce(new Error("ifc-ready refresh unavailable"));
    const retrySpy = vi.spyOn(coordinatorClient, "conversionRetry").mockResolvedValue({
      ifc_ready_job_id: "ifcready_1",
      status: "queued_for_conversion",
      queue_position: 1,
    });

    await renderA1();
    await selectMinioSource();
    const retry = q<HTMLButtonElement>("a1-retry-conversion")!;
    expect(retry.disabled).toBe(false);
    await act(async () => { retry.click(); });
    await flush();

    expect(retrySpy).toHaveBeenCalledWith("ifcready_1", "A1 inline 3D session recovery");
    expect(q("a1-conversion-retry-error")).toBeNull();
    expect(q("a1-review-open-error")?.textContent).toContain("ifc-ready refresh unavailable");
  });

  it("revalidates MinIO ifc-ready health before running and blocks newly stale source IFC", async () => {
    vi.mocked(coordinatorClient.listIfcReady)
      .mockResolvedValueOnce({ count: 1, items: [fakeIfcReadyJob()] })
      .mockResolvedValueOnce({
        count: 1,
        items: [fakeIfcReadyJob({
          artifact_health: {
            source_ifc_exists: false,
            model_usdc_reachable: true,
            mapping_reachable: true,
            metadata_reachable: null,
            all_required_ready: false,
            checked_at: "2026-07-07T10:00:01.000Z",
            stale_reason: "source_ifc_missing",
            failure_details: { source_ifc: "source_ifc_missing", model_usdc: null, mapping: null, metadata: null },
            source: "edge_health_probe",
          },
        })],
      });
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("stale MinIO session must not use direct rule-run"));
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("stale MinIO session must not call for-session rule-run"));

    await renderA1();
    await selectMinioSource();

    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(false);

    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    expect(coordinatorClient.listIfcReady).toHaveBeenCalledTimes(2);
    expect(forSessionSpy).not.toHaveBeenCalled();
    expect(directRunSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("source_ifc_missing");
  });

  it("downloaded MinIO object with stale source IFC stays blocked and does not call for-session rule-run", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({
        artifact_health: {
          source_ifc_exists: false,
          model_usdc_reachable: true,
          mapping_reachable: true,
          metadata_reachable: null,
          all_required_ready: false,
          checked_at: "2026-07-07T10:00:00.000Z",
          stale_reason: "source_ifc_missing",
          failure_details: { source_ifc: "source_ifc_missing", model_usdc: null, mapping: null, metadata: null },
          source: "edge_health_probe",
        },
      })],
    });
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("stale MinIO session must not use direct rule-run"));
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("stale MinIO session must not call for-session rule-run"));

    await renderA1();
    await selectMinioSource();

    expect(q("a1-minio-resolution-note")?.textContent).toContain("source_ifc_missing");
    expect(q<HTMLButtonElement>("a1-step-pick")!.disabled).toBe(true);
    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(true);

    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
    expect(forSessionSpy).not.toHaveBeenCalled();
    expect(directRunSpy).not.toHaveBeenCalled();
  });

  it("downloaded MinIO object with edge storage root missing explains stale artifact instead of waiting downloaded session", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({
        artifact_health: {
          source_ifc_exists: false,
          model_usdc_reachable: null,
          mapping_reachable: null,
          metadata_reachable: null,
          all_required_ready: false,
          checked_at: "2026-07-08T07:15:35.598Z",
          stale_reason: "edge_storage_root_missing",
          failure_details: { source_ifc: "edge_storage_root_missing", model_usdc: "url_not_allowed", mapping: "url_not_allowed", metadata: null },
          source: "edge_health_probe",
        },
      })],
    });
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("stale MinIO session must not call for-session rule-run"));

    await renderA1();
    await selectMinioSource();

    const pick = q<HTMLButtonElement>("a1-step-pick")!;
    expect(q("a1-minio-resolution-note")?.textContent).toContain("edge_storage_root_missing");
    expect(pick.disabled).toBe(true);
    expect(pick.textContent).toContain("source IFC artifact stale");
    expect(pick.textContent).not.toContain("等待 downloaded session");

    await act(async () => { pick.click(); });
    await flush();
    expect(forSessionSpy).not.toHaveBeenCalled();
  });

  it("downloaded MinIO object without review session runs through coordinator ifc-ready proxy", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({ review_session_id: null })],
    });
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("MinIO key must not be sent directly"));
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("review session should not be required"));
    const forIfcReadySpy = vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await renderA1();
    await selectMinioSource();

    expect(q("a1-minio-resolution-note")?.textContent).toContain("POST /api/governance/rule-runs/for-ifc-ready");
    expect(q("a1-minio-resolution-note")?.textContent).toContain("governance rule-run queue");
    const pick = q<HTMLButtonElement>("a1-step-pick")!;
    expect(pick.disabled).toBe(false);

    await act(async () => { pick.click(); });
    await flush();

    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(run.disabled).toBe(false);

    await act(async () => { run.click(); });
    await flush();
    expect(forIfcReadySpy).toHaveBeenCalledWith("ifcready_1", {
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    });
    expect(directRunSpy).not.toHaveBeenCalled();
    expect(forSessionSpy).not.toHaveBeenCalled();
  });

  it("shows persisted source lineage for a MinIO-backed rule-run result", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({ review_session_id: null })],
    });
    vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded", {
      model_version_id: "v1",
      source_metadata: {
        source_kind: "minio_ifc_ready",
        ifc_ready_job_id: "ifcready_1",
        idempotency_key: MINIO_IDEMPOTENCY_KEY,
        project_id: "p1",
        project_display_name: "松風庵",
        model_category: "建築",
        model_version_id: "v1",
        source_ifc_etag: "e",
        conversion_job_id: "conv_1",
        conversion_status: "ready",
      },
    }));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await renderA1();
    await selectMinioSource();
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    const lineage = q("a1-run-lineage")!;
    expect(lineage.textContent).toContain("松風庵");
    expect(lineage.textContent).toContain("建築");
    expect(lineage.textContent).toContain("v1");
    expect(lineage.textContent).toContain("ifcready_1");
    expect(lineage.textContent).toContain(MINIO_IDEMPOTENCY_KEY);
  });

  it("loads MinIO IFC validation history aligned by project, category, version, and job", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({ review_session_id: null })],
    });
    const historySpy = vi.mocked(governanceClient.listRuleRuns);
    historySpy.mockResolvedValue({
      filters: {},
      limit: 5,
      offset: 0,
      total: 1,
      items: [{
        rule_run_id: "rr_hist_001",
        status: "succeeded",
        score: 98,
        rule_set: "sample-fire-rating.ids",
        model_version_id: "v1",
        source_metadata: {
          source_kind: "minio_ifc_ready",
          ifc_ready_job_id: "ifcready_1",
          idempotency_key: MINIO_IDEMPOTENCY_KEY,
          project_id: "p1",
          project_display_name: "松風庵",
          model_category: "建築",
          model_version_id: "v1",
        },
        summary: null,
        started_at: "2026-07-09T01:00:00Z",
        finished_at: "2026-07-09T01:00:03Z",
      }],
    });

    await renderA1();
    await selectMinioSource();
    await flush();

    expect(historySpy).toHaveBeenLastCalledWith(expect.objectContaining({
      project_id: "p1",
      model_category: "建築",
      model_version_id: "v1",
      ifc_ready_job_id: "ifcready_1",
      idempotency_key: MINIO_IDEMPOTENCY_KEY,
      limit: 5,
    }));
    const scope = q("a1-minio-history-scope")!;
    expect(scope.textContent).toContain("松風庵");
    expect(scope.textContent).toContain("建築");
    expect(scope.textContent).toContain("v1");
    expect(scope.textContent).toContain("ifcready_1");
    expect(scope.textContent).toContain("not built");
    const history = q("a1-minio-run-history")!;
    expect(history.textContent).toContain("rr_hist_001");
    expect(history.textContent).toContain("succeeded");
    expect(history.textContent).toContain("98");
  });

  it("incoming MinIO handoff to a different key clears stale scored results", async () => {
    vi.mocked(coordinatorClient.getMinioObjects).mockResolvedValue({
      bucket: "bim-control",
      count: 2,
      objects: [
        { key: MINIO_KEY, etag: "e", role: "source_ifc", idempotency_key: MINIO_IDEMPOTENCY_KEY, project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" },
        { key: MINIO_KEY_B, etag: "e2", role: "source_ifc", idempotency_key: "mw_0000000000000002", project_id: "p1", project_display_name: "松風庵", category: "結構", version: "v2" },
      ],
    });
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({ review_session_id: null })],
    });
    vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded", {
      source_metadata: {
        source_kind: "minio_ifc_ready",
        ifc_ready_job_id: "ifcready_1",
        idempotency_key: MINIO_IDEMPOTENCY_KEY,
        project_id: "p1",
        project_display_name: "松風庵",
        model_category: "建築",
        model_version_id: "v1",
      },
    }));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await renderA1();
    await selectMinioSource(MINIO_KEY);
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
    expect(q("a1-run-lineage")).not.toBeNull();

    // 抵達 hash 改用真實發射端形（md-detail-a1 現發 #a1-workbench）；接收端 startsWith("#a1") 兩形皆命中。
    window.location.hash = `#a1-workbench?source=minio&minio_key=${encodeURIComponent(MINIO_KEY_B)}`;
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    expect(q<HTMLSelectElement>("a1-minio-select")!.value).toBe(MINIO_KEY_B);
    expect(q("a1-run-lineage")).toBeNull();
    expect(q("a1-rulerun-scoreboard")).toBeNull();
  });

  it("locked ifc-ready MinIO source is not rerouted through a manually selected review session", async () => {
    vi.mocked(coordinatorClient.listIfcReady).mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({ review_session_id: null })],
    });
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("MinIO key must not be sent directly"));
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("locked ifc-ready source must not be rerouted through session"));
    const forIfcReadySpy = vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await renderA1();
    await selectMinioSource();
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    await selectSession(REVIEW_SESSION_ID);

    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(run.textContent).toContain("POST /api/governance/rule-runs/for-ifc-ready/:jobId");
    await act(async () => { run.click(); });
    await flush();

    expect(forIfcReadySpy).toHaveBeenCalledWith("ifcready_1", {
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    });
    expect(directRunSpy).not.toHaveBeenCalled();
    expect(forSessionSpy).not.toHaveBeenCalled();
  });

  it("switching from picked local_fs to MinIO clears the stale runnable file", async () => {
    const createSpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });

    await renderA1();
    await pickModel();
    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(false);

    await selectMinioSource();
    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(run.disabled).toBe(true);

    await act(async () => { run.click(); });
    await flush();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("verified MinIO handoff after picking local_fs clears the stale runnable file", async () => {
    const createSpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });

    await renderA1();
    await pickModel();
    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(false);

    // 抵達 hash 改用真實發射端形（md-detail-a1 現發 #a1-workbench）；接收端 startsWith("#a1") 兩形皆命中。
    window.location.hash = `#a1-workbench?source=minio&minio_key=${encodeURIComponent("松風庵/root/main/u1/model.ifc")}`;
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    expect(q("a1-incoming-handoff")?.getAttribute("data-handoff-status")).toBe("verified");
    expect(q<HTMLSelectElement>("a1-minio-select")!.value).toBe("松風庵/root/main/u1/model.ifc");
    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(true);

    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("changing the local_fs dropdown after picking a model clears the stale locked path", async () => {
    const createSpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });

    await renderA1();
    await pickModel();
    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(false);

    const model = q<HTMLSelectElement>("a1-localfs-select")!;
    await act(async () => {
      model.value = LOCAL_IFC_KEY_B;
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(q<HTMLButtonElement>("a1-step-run")!.disabled).toBe(true);
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("switching from MinIO to local_fs clears stale MinIO handoff links", async () => {
    await renderA1();
    await selectMinioSource();
    const minioLink = q<HTMLButtonElement>("a1-link-minio")!;
    expect(minioLink.disabled).toBe(false);
    await act(async () => { minioLink.click(); });
    expect(window.location.hash).toContain("minio_key=");

    await act(async () => { q<HTMLButtonElement>("a1-source-local")!.click(); });
    await flush();

    expect(q<HTMLButtonElement>("a1-link-minio")!.disabled).toBe(true);
  });

  it("BCF review panel keeps existing topics on idempotent issue creation retry", async () => {
    vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "g1", usd_prim_path: null, rule_code: "naming", severity: "high", status: "fail", message: "naming rule failed" },
    ]);
    vi.spyOn(governanceClient, "issuesFromRuleRun")
      .mockResolvedValueOnce({ created: 2, issue_ids: ["i1", "i2"] })
      .mockResolvedValueOnce({ created: 0, issue_ids: [] });
    const rows: IssueRow[] = [
      { id: "i1", kind: "issue", title: "FIRE: Door", status: "open", severity: "high", ifc_guid: "g1", usd_prim_path: null, source_type: "rule_result" },
      { id: "i2", kind: "issue", title: "NAME: Wall", status: "open", severity: "medium", ifc_guid: "g2", usd_prim_path: null, source_type: "rule_result" },
    ];
    vi.spyOn(governanceClient, "getIssue").mockImplementation(async (id: string) => rows.find((row) => row.id === id)!);
    vi.spyOn(governanceClient, "listIssues").mockResolvedValue(rows);

    await renderA1();
    await pickModel();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    const issues = q<HTMLButtonElement>("a1-step-issues")!;
    await act(async () => { issues.click(); });
    await flush();
    expect(q("a1-bcf-review-panel")?.textContent).toContain("FIRE: Door");

    await act(async () => { issues.click(); });
    await flush();
    expect(q("a1-bcf-review-panel")?.textContent).toContain("FIRE: Door");
    expect(q("a1-bcf-review-panel")?.textContent).toContain("NAME: Wall");
  });

  it("idempotent issue creation reloads existing formal topics when issue_ids is empty", async () => {
    vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "g1", usd_prim_path: null, rule_code: "naming", severity: "high", status: "fail", message: "naming rule failed" },
    ]);
    vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 0, issue_ids: [] });
    vi.spyOn(governanceClient, "listIssues").mockResolvedValue([
      { id: "i1", kind: "issue", title: "EXISTING: Door", status: "open", severity: "high", ifc_guid: "g1", usd_prim_path: null, model_version_id: "270/建築/model.ifc", source_type: "rule_result" },
    ]);

    await renderA1();
    await pickModel();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    await act(async () => { q<HTMLButtonElement>("a1-step-issues")!.click(); });
    await flush();

    expect(governanceClient.listIssues).toHaveBeenCalledWith(undefined, { model_version_id: "270/建築/model.ifc", kind: "issue" });
    expect(q("a1-bcf-review-panel")?.textContent).toContain("EXISTING: Door");
  });

  it("does not advance the Issue workflow when idempotent lookup finds no formal Issues", async () => {
    vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "g1", usd_prim_path: null, rule_code: "naming", severity: "high", status: "fail", message: "naming rule failed" },
    ]);
    vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 0, issue_ids: [] });
    vi.spyOn(governanceClient, "listIssues").mockResolvedValue([]);

    await renderA1();
    await pickModel();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-issues")!.click(); });
    await flush();

    expect(q("a1-action-error")?.textContent).toContain("Issue");
    const stepField = Array.from(container.querySelectorAll(".ec-field")).find((field) =>
      field.querySelector(".ec-k")?.textContent === "step",
    );
    expect(stepField?.querySelector(".ec-v")?.textContent).toContain("scored");
    expect(q<HTMLButtonElement>("a1-step-bcf")!.disabled).toBe(true);
  });

  it("stale issue detail fetches cannot repopulate BCF topics after reset", async () => {
    vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "g1", usd_prim_path: null, rule_code: "naming", severity: "high", status: "fail", message: "naming rule failed" },
    ]);
    vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 1, issue_ids: ["late"] });
    let resolveIssue!: (row: IssueRow) => void;
    vi.spyOn(governanceClient, "getIssue").mockReturnValue(new Promise<IssueRow>((resolve) => { resolveIssue = resolve; }));

    await renderA1();
    await pickModel();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    await act(async () => { q<HTMLButtonElement>("a1-step-issues")!.click(); });
    await act(async () => { q<HTMLButtonElement>("a1-source-minio")!.click(); });
    await flush();
    await act(async () => {
      resolveIssue({ id: "late", kind: "issue", title: "LATE: Door", status: "open", severity: "high", ifc_guid: "g1", usd_prim_path: null, source_type: "rule_result" });
      await Promise.resolve();
    });
    await flush();

    expect(q("a1-bcf-review-panel")?.textContent).not.toContain("LATE: Door");
    expect(q("a1-bcf-review-panel")?.textContent).toContain("尚未建立可匯出的正式 Issue");
  });

  it("BCF topic panel excludes annotations without IFC GUIDs", async () => {
    vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: null, usd_prim_path: null, rule_code: "annotation", severity: "medium", status: "fail", message: "manual annotation" },
    ]);
    vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 1, issue_ids: ["a1"] });
    vi.spyOn(governanceClient, "getIssue").mockResolvedValue({
      id: "a1",
      kind: "annotation",
      title: "ANNOTATION: no guid",
      status: "open",
      severity: "medium",
      ifc_guid: null,
      usd_prim_path: null,
      source_type: "rule_result",
    });

    await renderA1();
    await pickModel();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    await act(async () => { q<HTMLButtonElement>("a1-step-issues")!.click(); });
    await flush();

    expect(q("a1-bcf-review-panel")?.textContent).not.toContain("ANNOTATION: no guid");
    expect(q("a1-bcf-review-panel")?.textContent).toContain("尚未建立可匯出的正式 Issue");
    expect(q<HTMLButtonElement>("a1-step-bcf")!.disabled).toBe(true);
  });

  it("rule-run result renders an A1 inline handoff with non-secret context", async () => {
    // 等價改寫（library:// 邏輯識別修復）：local_fs 檔案庫選檔後即使手動選了 review session，
    // 檢核仍對「使用者明確選定的檔案」跑（createRuleRunForLibrary 優先；session 只供 mapping
    // enrichment 與 inline 3D handoff）。本測試核心（inline handoff 非機密內容）不變；
    // 原 for-session 路由斷言改為 forLibrary，direct createRuleRun 仍不得被呼叫。
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("local_fs must not send raw/masked path as ifc_source_path"));
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("library pick must not be rerouted through session"));
    const forLibrarySpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "2O2Fr$t4X7Zf8NOew3FLOH", usd_prim_path: "/World/Door_001", rule_code: "FIRE-RATING", severity: "error", status: "fail", message: "Fire rating missing" },
    ]);

    await renderA1();
    await pickModel();
    await selectSession("review_session_x");
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    expect(forLibrarySpy).toHaveBeenCalledWith(expect.objectContaining({
      project_id: "270",
      model_id: "建築",
      version_name: "model.ifc",
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    }));
    expect(forSessionSpy).not.toHaveBeenCalled();
    expect(directRunSpy).not.toHaveBeenCalled();
    expect(q("a1-open-review-room")).toBeNull();
    expect(q("a1-inline-handoff-summary")?.textContent).toContain("2O2Fr$t4X7Zf8NOew3FLOH");
    expect(q("a1-inline-handoff-summary")?.textContent).toContain("/World/Door_001");
    expect(q<HTMLInputElement>("a1-inline-session-input")?.value).toBe("review_session_x");
    expect(window.location.hash).toBe("#a1");
    expect(container.textContent).not.toContain("lease_token");
    expect(viewerBox.renderCount).toBe(0);
  });

  it("local A1 results without a review session do not expose a stale Review Room handoff button", async () => {
    vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "guid_no_session_yet", usd_prim_path: "/World/Door_002", rule_code: "FIRE-RATING", severity: "error", status: "fail", message: "Fire rating missing" },
    ]);

    await renderA1();
    await pickModel();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    expect(q("a1-open-review-room")).toBeNull();
    expect(q("a1-inline-handoff-summary")).toBeNull();
    expect(window.location.hash).toBe("#a1");
    expect(container.textContent).not.toContain("lease_token");
    expect(viewerBox.renderCount).toBe(0);
  });

  it("MinIO ifc-ready result creates an A1 inline 3D session without opening /ui/open", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus([]) as never);
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({ review_session_id: null, viewer_url: null })],
    });
    const createReviewSessionSpy = vi.spyOn(coordinatorClient, "createReviewSessionForIfcReady").mockResolvedValue({
      ifc_ready_job_id: "ifcready_1",
      conversion_job_id: "conv_1",
      conversion_status: "ready",
      review_session_id: "review_session_new",
      session_status: "active",
      session_replay: false,
      open_url: "http://127.0.0.1:8004/ui/open?session=review_session_new",
      viewer_url: "http://127.0.0.1:8004/ui/open?session=review_session_new",
      expected_stage_url: "stage://x",
      expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
      artifact_health: null,
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "guid_minio_new_session", usd_prim_path: "/World/Door_003", rule_code: "FIRE-RATING", severity: "error", status: "fail", message: "Fire rating missing" },
    ]);

    await renderA1();
    await selectMinioSource();
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    await act(async () => { q<HTMLButtonElement>("a1-create-review-session")!.click(); });
    await flush();

    expect(createReviewSessionSpy).toHaveBeenCalledWith("ifcready_1");
    expect(window.location.hash).toBe("#a1");
    expect(q<HTMLInputElement>("a1-inline-session-input")?.value).toBe("review_session_new");
    expect(q("a1-inline-handoff-summary")?.textContent).toContain("guid_minio_new_session");
    expect(q("a1-inline-handoff-summary")?.textContent).toContain("/World/Door_003");
    expect(q("a1-review-open-url")?.textContent).toContain("review_session_new");
    expect(q("a1-open-viewer")).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
    expect(viewerBox.renderCount).toBe(0);
  });

  it("MinIO ifc-ready result can start a 3D highlight session inline on A1 without opening Review Room", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus([fakeSession("review_session_new")]) as never);
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({
      count: 1,
      items: [fakeIfcReadyJob({ review_session_id: null, viewer_url: null })],
    });
    const createReviewSessionSpy = vi.spyOn(coordinatorClient, "createReviewSessionForIfcReady").mockResolvedValue({
      ifc_ready_job_id: "ifcready_1",
      conversion_job_id: "conv_1",
      conversion_status: "ready",
      review_session_id: "review_session_new",
      session_status: "active",
      session_replay: false,
      open_url: "http://127.0.0.1:8004/ui/open?session=review_session_new",
      viewer_url: "http://127.0.0.1:8004/ui/open?session=review_session_new",
      expected_stage_url: "stage://x",
      expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
      artifact_health: null,
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.mocked(coordinatorClient.claimViewerLease).mockResolvedValue({
      lease_id: "lease_a1",
      lease_token: "lease_token_a1",
      session_id: "review_session_new",
      viewer_id: "a1_viewer",
      user_id: "a1_operator",
      display_name: "A1 inline primary viewer",
      role: "primary",
      status: "active",
      kit_instance_id: "kit_1",
      stream_config: { signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 49101 },
      client_nonce: "nonce",
      claimed_at: "",
      expires_at: "",
      last_heartbeat_at: null,
      released_at: null,
      first_frame_at: null,
      loaded_stage_url: null,
      datachannel_ready: false,
      stage_match: null,
      heartbeat_after_ms: 15000,
      idempotent_replay: false,
      primary: true,
    } as never);
    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockResolvedValue({} as never);
    vi.mocked(coordinatorClient.reportFirstFrame).mockResolvedValue({ session_id: "review_session_new", first_frame_at: "2026-07-09T00:00:00.000Z" } as never);
    vi.spyOn(governanceClient, "createRuleRunForIfcReady").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "guid_minio_inline", usd_prim_path: "/World/Door_Inline", rule_code: "FIRE-RATING", severity: "error", status: "fail", message: "Fire rating missing" },
    ]);

    await renderA1();
    await selectMinioSource();
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
    await flush();
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    await act(async () => { q<HTMLButtonElement>("a1-create-review-session")!.click(); });
    await flush();
    expect(createReviewSessionSpy).toHaveBeenCalledWith("ifcready_1");
    expect(window.location.hash).toBe("#a1");

    const start = q<HTMLButtonElement>("a1-inline-manual-start")!;
    expect(start).not.toBeNull();
    expect(start.disabled).toBe(false);
    await act(async () => { start.click(); });
    await flush();

    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledWith("review_session_new", expect.objectContaining({ requested_role: "primary" }));
    expect(q("a1-inline-viewer-host")).not.toBeNull();
    const highlight = q<HTMLButtonElement>("a1-inline-highlight")!;
    expect(highlight.disabled).toBe(false);
    await act(async () => { highlight.click(); });
    await flush();

    expect(viewerBox.highlightBatches).toHaveLength(1);
    expect(viewerBox.highlightBatches[0][0]).toMatchObject({ ifc_guid: "guid_minio_inline", rule_code: "FIRE-RATING" });
    expect(openSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#a1");
  });

  it("missing usd_prim_path shows an honest A1 inline mapping diagnostic", async () => {
    // 等價改寫（library:// 邏輯識別修復）：同上——local_fs 選檔 + 手動選 session 時，run 走
    // createRuleRunForLibrary（對選定檔案跑）；mapping enrichment 仍靠 selectedSession 取得
    //（elementMappingForSession），本測試核心（誠實 mapping 診斷）不變。
    const directRunSpy = vi.spyOn(governanceClient, "createRuleRun").mockRejectedValue(new Error("local_fs must not send raw/masked path as ifc_source_path"));
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("library pick must not be rerouted through session"));
    const forLibrarySpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "guid_without_mapping", usd_prim_path: null, rule_code: "MAPPING", severity: "error", status: "fail", message: "missing mapping" },
    ]);
    vi.spyOn(governanceClient, "elementMappingForSession").mockResolvedValue({
      mock: false,
      summary: {
        fake_mapping_count: 0,
        mapping_information_status: "incomplete",
        mapping_issue_code: "ifc_usdc_mapping_information_incomplete",
        mapping_issue_count: 1,
      },
      issues: [{ code: "ifc_usdc_mapping_information_incomplete" }],
      items: [],
    });

    await renderA1();
    await pickModel();
    await selectSession("review_session_x");
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    expect(forLibrarySpy).toHaveBeenCalledWith(expect.objectContaining({
      project_id: "270",
      model_id: "建築",
      version_name: "model.ifc",
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    }));
    expect(forSessionSpy).not.toHaveBeenCalled();
    expect(directRunSpy).not.toHaveBeenCalled();
    expect(q("a1-open-review-room")).toBeNull();
    expect(q("a1-inline-handoff-summary")?.textContent).toContain("guid_without_mapping");
    expect(q("a1-inline-handoff-summary")?.textContent).toContain("ifc_usdc_mapping_information_incomplete");
    expect(q("a1-inline-highlight-reason")?.textContent).toContain("usd_prim_path");
    expect(window.location.hash).toBe("#a1");
    expect(container.textContent).not.toContain("lease_token");
  });

  it("A1 cross-link chips navigate to #minio / #sessions carrying source=a1 and the selected id (not swapped)", async () => {
    // Regression guard for spec §4.3 A1→MinIO / A1→Sessions chips. The shallow SSR test (A1CrossLinks.test.tsx)
    // only proves the chips are disabled before selection; this drives the enabled click path and asserts the
    // exact axis target + param→value mapping. A typo like buildHandoff("session", …) (singular — EdgeConsole
    // has no such case, only "sessions") or swapping minio_key/session would silently fall through to the
    // HomePage default; parsing the hash here makes that regression fail loudly instead of green-lighting it.
    await renderA1();

    // Select a MinIO source object → a1-link-minio becomes enabled.
    await selectMinioSource();

    const minioLink = q<HTMLButtonElement>("a1-link-minio")!;
    expect(minioLink.disabled).toBe(false);
    await act(async () => { minioLink.click(); });

    expect(window.location.hash.startsWith("#minio?")).toBe(true);
    const mp = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1));
    expect(mp.get("source")).toBe("a1");
    expect(mp.get("minio_key")).toBe("松風庵/root/main/u1/model.ifc"); // decoded key, exact (round-trips Chinese + slashes)
    expect(mp.get("session")).toBeNull();                              // must not mislabel the minio key as a session id

    // Select a review session → a1-link-sessions becomes enabled.
    await selectSession("review_session_x");
    const sessionsLink = q<HTMLButtonElement>("a1-link-sessions")!;
    expect(sessionsLink.disabled).toBe(false);
    await act(async () => { sessionsLink.click(); });

    expect(window.location.hash.startsWith("#sessions?")).toBe(true);  // plural — matches the EdgeConsole "sessions" case
    const sp = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1));
    expect(sp.get("source")).toBe("a1");
    expect(sp.get("session")).toBe("review_session_x");
    expect(sp.get("minio_key")).toBeNull();                            // sessions chip must not leak the minio key
  });

  it("A1 does not trigger conversion from the governance page; missed watcher scheduling is a #minio handoff", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus")
      .mockResolvedValue(fakeRuntimeStatus([]) as never);
    const triggerSpy = vi.spyOn(coordinatorClient, "triggerConversion").mockRejectedValue(new Error("A1 must not trigger conversion"));

    await renderA1();
    await selectMinioSource();

    expect(q<HTMLButtonElement>("a1-trigger-convert")!.disabled).toBe(true);
    await act(async () => { q<HTMLButtonElement>("a1-trigger-convert")!.click(); });
    await flush();

    expect(triggerSpy).not.toHaveBeenCalled();
    const href = q<HTMLAnchorElement>("a1-conv-link")?.getAttribute("href") ?? "";
    expect(href).toContain("#minio?");
    expect(href).toContain("source=a1");
    expect(href).toContain("minio_key=");
    expect(q<HTMLElement>("a1-no-session")!.textContent).toContain("查看 MinIO 來源");
  });
});
