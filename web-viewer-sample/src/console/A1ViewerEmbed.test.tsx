// A1 3D 解耦回歸鎖：A1 不再嵌入 EmbeddedViewer、不自動選 session、不自動 claim viewer lease。
import { act, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewerBox = vi.hoisted(() => ({ renderCount: 0 }));
vi.mock("./EmbeddedViewer", () => ({
  EmbeddedViewer: forwardRef((_: Record<string, unknown>, _ref) => {
    viewerBox.renderCount += 1;
    return null;
  }),
}));

import { A1GovernanceWorkbenchPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient, type RuleRunStatus } from "./governanceClient";

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

function fakeRunStatus(status: RuleRunStatus["status"]): RuleRunStatus {
  return {
    rule_run_id: "rr_a1",
    status,
    score: 99,
    rule_set: "default",
    model_version_id: null,
    summary: { total: 10, passed: 9, failed: 1, errored: 0, target_summary: {}, warnings: [] },
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
    window.location.hash = "#a1";
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus() as never);
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 1,
      objects: [{ key: "松風庵/root/main/u1/model.ifc", etag: "e", role: "source_ifc", idempotency_key: "mw_0000000000000001", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" }],
    });
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
  const selectSession = async (sessionId = "review_session_x") => {
    const select = q<HTMLSelectElement>("a1-session-select")!;
    await act(async () => {
      select.value = sessionId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
  };
  const pickModel = async (key = "松風庵/root/main/u1/model.ifc") => {
    const model = q<HTMLSelectElement>("a1-minio-select")!;
    await act(async () => {
      model.value = key;
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { q<HTMLButtonElement>("a1-step-pick")!.click(); });
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

  it("picked IFC enables governance run without review session and calls createRuleRun", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    const forSessionSpy = vi.spyOn(governanceClient, "createRuleRunForSession").mockRejectedValue(new Error("for-session must not be required"));
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    await renderA1();
    await pickModel();
    const run = q<HTMLButtonElement>("a1-step-run")!;
    expect(run.disabled).toBe(false);

    await act(async () => { run.click(); });
    await flush();

    expect(governanceClient.createRuleRun).toHaveBeenCalledWith({
      ifc_source_path: "松風庵/root/main/u1/model.ifc",
      ids_path: expect.stringContaining("sample-fire-rating.ids"),
    });
    expect(forSessionSpy).not.toHaveBeenCalled();
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  });

  it("rule-run result opens Review Room handoff with non-secret context instead of sending in-place highlight", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "2O2Fr$t4X7Zf8NOew3FLOH", usd_prim_path: "/World/Door_001", rule_code: "FIRE-RATING", severity: "error", status: "fail", message: "Fire rating missing" },
    ]);

    await renderA1();
    await pickModel();
    await selectSession("review_session_x");
    await act(async () => { q<HTMLButtonElement>("a1-step-run")!.click(); });
    await flush();

    const open = q<HTMLButtonElement>("a1-open-review-room")!;
    expect(open.disabled).toBe(false);
    await act(async () => { open.click(); });

    expect(window.location.hash).toContain("#review?");
    expect(window.location.hash).toContain("source=a1");
    expect(window.location.hash).toContain("rule_run_id=rr_a1");
    expect(window.location.hash).toContain("session=review_session_x");
    expect(window.location.hash).toContain("ifc_guid=2O2Fr%24t4X7Zf8NOew3FLOH");
    expect(window.location.hash).toContain("usd_prim_path=%2FWorld%2FDoor_001");
    expect(window.location.hash).not.toContain("lease_token");
    expect(viewerBox.renderCount).toBe(0);
  });

  it("missing usd_prim_path opens Review Room with an honest mapping diagnostic", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
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

    const open = q<HTMLButtonElement>("a1-open-review-room")!;
    expect(open.disabled).toBe(false);
    await act(async () => { open.click(); });

    expect(window.location.hash).toContain("#review?");
    expect(window.location.hash).toContain("source=a1");
    expect(window.location.hash).toContain("session=review_session_x");
    expect(window.location.hash).toContain("ifc_guid=guid_without_mapping");
    expect(window.location.hash).toContain("mapping_information_status=incomplete");
    expect(window.location.hash).toContain("mapping_issue_code=ifc_usdc_mapping_information_incomplete");
    expect(window.location.hash).toContain("mapping_issue_count=1");
    expect(window.location.hash).not.toContain("usd_prim_path");
    expect(window.location.hash).not.toContain("lease_token");
  });

  it("A1 cross-link chips navigate to #minio / #sessions carrying source=a1 and the selected id (not swapped)", async () => {
    // Regression guard for spec §4.3 A1→MinIO / A1→Sessions chips. The shallow SSR test (A1CrossLinks.test.tsx)
    // only proves the chips are disabled before selection; this drives the enabled click path and asserts the
    // exact axis target + param→value mapping. A typo like buildHandoff("session", …) (singular — EdgeConsole
    // has no such case, only "sessions") or swapping minio_key/session would silently fall through to the
    // HomePage default; parsing the hash here makes that regression fail loudly instead of green-lighting it.
    await renderA1();

    // Select a MinIO source object → a1-link-minio becomes enabled.
    const model = q<HTMLSelectElement>("a1-minio-select")!;
    await act(async () => {
      model.value = "松風庵/root/main/u1/model.ifc";
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

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

  it("conversion ready does not fallback to the first active session when job.review_session_id is missing", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus")
      .mockResolvedValueOnce(fakeRuntimeStatus([]) as never)
      .mockResolvedValue(fakeRuntimeStatus([fakeSession("review_session_OTHER")]) as never);
    vi.spyOn(coordinatorClient, "triggerConversion").mockResolvedValue({ ifc_ready_job_id: "ifcready_mw_x", status: "queued_for_conversion" } as never);
    vi.spyOn(coordinatorClient, "getIfcReadyJob").mockResolvedValue({
      ifc_ready_job_id: "ifcready_mw_x",
      status: "x",
      conversion_lifecycle_status: "ready",
      download_status: "downloaded",
      conversion_status: null,
      review_session_id: null,
    } as never);

    await renderA1();
    const model = q<HTMLSelectElement>("a1-minio-select")!;
    await act(async () => {
      model.value = "松風庵/root/main/u1/model.ifc";
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { q<HTMLButtonElement>("a1-trigger-convert")!.click(); });
    await flush();

    expect(q<HTMLSelectElement>("a1-session-select")?.value ?? "").toBe("");
    expect(q("a1-convert-error")?.textContent).toContain("review_session_id");
  });
});
