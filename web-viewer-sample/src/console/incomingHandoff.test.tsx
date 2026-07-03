// web-viewer-sample/src/console/incomingHandoff.test.tsx
// Task 14（七軸和諧 §4.2 接收端重驗鐵律）：接收端一律以 ID 向已抓取的權威資料重驗，查無 → 誠實
// not_found + 手動重選，不靜默 fallback。本檔涵蓋（1）共用 hook/banner 的分支邏輯，（2）五個接收頁
// 各自的真實 wiring（每頁至少一個 verified + 至少一個 not_found 案例，合計覆蓋 M/A1/CV/SS/KG）。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncomingHandoffBanner, useIncomingHandoff } from "./incomingHandoff";
import { A1GovernanceWorkbenchPage, ConversionSchedulingPage, KitGpuFleetPage, MinioDataPage, SessionManagementPage } from "./pages";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { coordinatorClient, type MinioFolderListing, type RuntimeStatus, type RuntimeSessionSummary } from "./coordinatorClient";
import { type SharedStatusSnapshot } from "./useSharedStatus";

// ---- shared primitive: re-verify + honest render, no silent fallback (this fully covers the logic) ----
describe("useIncomingHandoff re-verifies the carried id (spec §4.2)", () => {
  function Probe({ hash, ok }: { hash: string; ok: boolean }) {
    const inc = useIncomingHandoff("minio", () => ok, hash);
    return <IncomingHandoffBanner testId="probe-banner" handoff={inc.handoff} status={inc.status} />;
  }
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  it("renders nothing when the hash carries no handoff for this axis", () => {
    const root = createRoot(container);
    act(() => { root.render(<Probe hash="#minio" ok={true} />); });
    expect(container.querySelector('[data-testid="probe-banner"]')).toBeNull();
  });
  it("marks verified when the id is found in authoritative data", () => {
    const root = createRoot(container);
    act(() => { root.render(<Probe hash="#minio?source=a1&minio_key=270/x.ifc" ok={true} />); });
    const b = container.querySelector('[data-testid="probe-banner"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("verified");
    expect(b?.getAttribute("data-handoff-source")).toBe("a1");
  });
  it("marks not_found (honest, no silent fallback) when the id is absent", () => {
    const root = createRoot(container);
    act(() => { root.render(<Probe hash="#minio?source=a1&minio_key=missing.ifc" ok={false} />); });
    const b = container.querySelector('[data-testid="probe-banner"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_found");
    expect(b?.textContent).toContain("未"); // honest 未找到 / 未靜默 fallback wording
  });
});

// ---- page wiring: each receiving page re-verifies against data it already fetched ----
const CN_KEY = "270專案/建築/v07/模型.ifc";
const folder: MinioFolderListing = { bucket: "bim-control", prefix: "", folders: [], count: 1, objects: [
  { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
] };
// Task 14 prefix 分支（A1 → M「回看選檔來源」，spec §4.3）：接收端須真的導覽到來源資料夾，並向該層
// 已載入的 folder 重驗；不得因『持有 prefix』就無條件 verified。SRC_PREFIX 即 CN_KEY 的來源資料夾。
const SRC_PREFIX = "270專案/建築/v07/";
const srcFolder: MinioFolderListing = { bucket: "bim-control", prefix: SRC_PREFIX, folders: [], count: 1, objects: folder.objects };
const rootFolder: MinioFolderListing = { bucket: "bim-control", prefix: "", folders: [{ prefix: "270專案/", has_source_ifc: true }], count: 0, objects: [] };
const mkSession = (over: Partial<RuntimeSessionSummary>): RuntimeSessionSummary => ({ session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 1, expected_stage_url: null, conversion_status: null, kit_instance_ids: [], created_at: "", updated_at: "", ...over });
const status = (items: RuntimeSessionSummary[]): RuntimeStatus => ({ service: { status: "ok", name: "c", uptime_seconds: 1, generated_at: "" }, configured_endpoints: { coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" }, viewer: { browser_url_base: "", handoff_path: "/" }, conversion_authority: { base_url: "", authority: "" }, kit: [] }, sessions: { count: items.length, active_count: items.length, participant_count: 0, items }, kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] }, observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } } });

describe("receiving pages re-verify the incoming handoff id", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = ""; });

  it("M verifies a real incoming minio_key (found in the loaded folder listing)", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folder);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });

  it("M flags an incoming minio_key that is not in the loaded folder listing as not_found (no silent fallback)", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folder);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = "#minio?source=a1&minio_key=missing.ifc";
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });

  it("M navigates to an incoming prefix (回看選檔來源) and verifies it against the freshly loaded folder (verified)", async () => {
    // A1 → M prefix handoff（spec §4.3）：接收端必須真的導覽到來源資料夾、向該層 folder 重驗，
    // 不能只因『持有 prefix』就 verified。mock 依 prefix 回不同層：根層（無此檔）vs 來源層（含 CN_KEY）。
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&prefix=${encodeURIComponent(SRC_PREFIX)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    const b = container.querySelector('[data-testid="minio-incoming-handoff"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("verified");
    expect(b?.getAttribute("data-handoff-source")).toBe("a1");
    expect(coordinatorClient.getMinioFolder).toHaveBeenCalledWith(SRC_PREFIX); // 真的導覽到來源層，非停在根
  });

  it("M flags an incoming prefix that resolves to an empty/absent folder as not_found (no silent fallback)", async () => {
    // 導覽到來源層後該層無 folders/objects（查無 / 已刪 / 未設定）→ 誠實 not_found，不靜默 fallback。
    const gonePrefix = "999查無專案/";
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => ({ bucket: "bim-control", prefix: p ?? "", folders: [], count: 0, objects: [] }));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&prefix=${encodeURIComponent(gonePrefix)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    const b = container.querySelector('[data-testid="minio-incoming-handoff"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_found");
    expect(coordinatorClient.getMinioFolder).toHaveBeenCalledWith(gonePrefix); // 導覽到該層後才判定 not_found
  });

  it("SS flags an incoming session that is not in runtime status as not_found (no silent fallback to act[0])", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mkSession({ session_id: "review_session_a" })]));
    window.location.hash = "#sessions?source=conv&session=review_session_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="sessions-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });

  it("SS verifies an incoming session that is present in runtime status", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mkSession({ session_id: "review_session_a" })]));
    window.location.hash = "#sessions?source=conv&session=review_session_a";
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="sessions-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });

  it("A1 verifies an incoming minio_key against the loaded a1-minio-select objects (verified)", async () => {
    // A1's authoritative list = minioObjects (getMinioObjects, pages.tsx). runtimeStatus is also
    // fetched on A1 mount → mock it empty so the effect resolves deterministically.
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ objects: [
      { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
    ] } as never);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([]));
    window.location.hash = `#a1?source=minio&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="a1-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });

  it("A1 flags an incoming minio_key absent from the loaded objects as not_found (no silent fallback)", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ objects: [
      { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
    ] } as never);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([]));
    window.location.hash = "#a1?source=minio&minio_key=missing.ifc";
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="a1-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });

  it("CV verifies an incoming job_id against the fetched ifc-ready jobs (verified)", async () => {
    // CV's authoritative lists = jobs (listIfcReady) + records (getConversionRecords).
    // Mirror Task 7's stub surface so ConversionSchedulingPage mounts without unhandled rejections.
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [
      { ifc_ready_job_id: "job_1", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_1", dispatch_error: null, review_session_id: "review_session_a", viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "" },
    ] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = "#conv?source=intake&job_id=job_1";
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });

  it("CV flags an incoming job_id absent from jobs/records as not_found (no silent fallback)", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = "#conv?source=intake&job_id=job_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });

  it("KG flags an incoming session absent from shared status as not_found (no silent fallback)", () => {
    // KG's authoritative list = useSharedStatus().sessionsById; inject it via SharedStatusProvider value (KG
    // has no fetch — Task 9). An unknown session must surface honest not_found, never silently resolve.
    const snap: SharedStatusSnapshot = { activeSessions: 1, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "", stale: false };
    window.location.hash = "#instances?source=sessions&session=review_session_ZZZ";
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    expect(container.querySelector('[data-testid="kg-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });

  it("KG verifies an incoming session present in shared status", () => {
    const snap: SharedStatusSnapshot = { activeSessions: 1, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "", stale: false };
    window.location.hash = "#instances?source=sessions&session=review_session_a";
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    expect(container.querySelector('[data-testid="kg-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });
});
