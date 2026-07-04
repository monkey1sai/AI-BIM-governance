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
import { coordinatorClient, type ConversionRecord, type MinioFolderListing, type RuntimeStatus, type RuntimeSessionSummary } from "./coordinatorClient";
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
  it("latches verified: once a handoff verifies, later re-renders of the SAME handoff stay verified even if verify() turns false (spec §4.2 re-verify is an arrival gate, not a per-render re-check)", () => {
    const root = createRoot(container);
    const hash = "#minio?source=a1&minio_key=270/x.ifc";
    act(() => { root.render(<Probe hash={hash} ok={true} />); });
    expect(container.querySelector('[data-testid="probe-banner"]')?.getAttribute("data-handoff-status")).toBe("verified");
    // same handoff, verify now false (e.g. the M-page user browsed the folder tree away from the source) → must NOT downgrade
    act(() => { root.render(<Probe hash={hash} ok={false} />); });
    expect(container.querySelector('[data-testid="probe-banner"]')?.getAttribute("data-handoff-status")).toBe("verified");
    // a DIFFERENT handoff must not inherit the latch → honest not_found (latch is per-handoff, not global)
    act(() => { root.render(<Probe hash="#minio?source=a1&minio_key=other.ifc" ok={false} />); });
    expect(container.querySelector('[data-testid="probe-banner"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });
  it("renders an honest indeterminate banner (neutral, not the alarming not_found) when verify() is inconclusive", () => {
    function IndetProbe() {
      const inc = useIncomingHandoff("minio", () => "indeterminate", "#minio?source=a1&minio_key=270/x.ifc");
      return <IncomingHandoffBanner testId="probe-banner" handoff={inc.handoff} status={inc.status} />;
    }
    const root = createRoot(container);
    act(() => { root.render(<IndetProbe />); });
    const b = container.querySelector('[data-testid="probe-banner"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("indeterminate");
    expect(b?.className ?? "").not.toContain("ec-warn-note"); // indeterminate is neutral, not a warning
    expect(b?.textContent ?? "").toContain("重新整理"); // honest actionable hint, distinct from not_found's 手動重選
  });
  // honesty regression（p5-critic）：verify() 回 "not_applicable" 代表「此 handoff 未帶本軸會重驗的欄位」
  // （非查無）——必須是中性態，絕不誤成警示紅字的假查無，且語意與 indeterminate（資料截斷/載入中）分開。
  it("renders a neutral not_applicable banner (NOT the alarming not_found) when the handoff carries no field this axis re-verifies", () => {
    function NaProbe() {
      const inc = useIncomingHandoff("a1", () => "not_applicable", "#a1?source=sessions&session=review_session_a");
      return <IncomingHandoffBanner testId="probe-banner" handoff={inc.handoff} status={inc.status} />;
    }
    const root = createRoot(container);
    act(() => { root.render(<NaProbe />); });
    const b = container.querySelector('[data-testid="probe-banner"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_applicable");
    expect(b?.className ?? "").not.toContain("ec-warn-note"); // neutral, not a warning
    expect(b?.textContent ?? "").not.toContain("查無"); // must NOT claim the id was absent from authoritative data
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

const mkRecord = (over: Partial<ConversionRecord>): ConversionRecord => ({ idempotency_key: "mw_r", project_id: "270", project_display_name: "270", category: "建築", external_model_version_id: "v1", conversion_job_id: "cj_x", status: "queued", usdc_key: null, coverage_report: null, object_key: "270/x.ifc", detected_at: "", updated_at: "", ...over });

describe("receiving pages re-verify the incoming handoff id", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = ""; });

  it("M navigates to a real incoming minio_key's folder and verifies it there (root list never holds the deep key)", async () => {
    // 真實 S3 帶 Delimiter='/'：3 層深的 CN_KEY 在根層只會以 CommonPrefix(270專案/) 落在 folders，
    // 絕不出現在根層 objects。接收端必須先導覽到 CN_KEY 所在資料夾(270專案/建築/v07/)、向該層 folder 重驗，
    // 才能誠實 verified；停在根層 = 對真實巢狀 key 恆誤報 not_found(§4.2 誠實 verified)。fixture 依 prefix 分流
    // (root vs 來源層)以尊重 delimiter 語意——舊 fixture 把深層 key 直接塞進根層 objects 會掩蓋此 gap。
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    const b = container.querySelector('[data-testid="minio-incoming-handoff"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("verified");
    expect(b?.getAttribute("data-handoff-source")).toBe("a1");
    expect(coordinatorClient.getMinioFolder).toHaveBeenCalledWith(SRC_PREFIX); // 真的導覽到 key 所在層，非停在根
  });

  it("M flags an incoming minio_key absent from its navigated folder as not_found (no silent fallback)", async () => {
    // 導覽到 key 所在資料夾後，該層 objects 真的沒有這支 key(已刪/改名)→ 誠實 not_found，非靜默 fallback。
    const GONE_KEY = "270專案/建築/v07/已刪除.ifc"; // 同資料夾(SRC_PREFIX)，但 srcFolder.objects 只有 CN_KEY
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(GONE_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    const b = container.querySelector('[data-testid="minio-incoming-handoff"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_found");
    expect(coordinatorClient.getMinioFolder).toHaveBeenCalledWith(SRC_PREFIX); // 導覽到該層後才判定 not_found
  });

  it("M keeps the navigated folder verified even when a slow root refetch lands late (generation guard, no clobber)", async () => {
    // 掛載時併發兩個 getMinioFolder：根層(prefix="")＋導覽目標層。真實 S3 根層需逐一 probe 子資料夾
    // has_source_ifc(序列)，通常比葉層慢；無世代守門則根層晚到的回應會蓋掉已導覽的葉層 folder，
    // folder.prefix 退回 ""→verify 對 minio_key 失敗→假 not_found(§4.2 想避免的假訊息)。此處刻意讓
    // 根層 pending、葉層先落地，再放行根層，斷言不得被覆蓋。
    let resolveRoot: (v: MinioFolderListing) => void = () => {};
    const rootPending = new Promise<MinioFolderListing>((r) => { resolveRoot = r; });
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation((p?: string) => (p === SRC_PREFIX ? Promise.resolve(srcFolder) : rootPending));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); // 葉層(正確)先落地→verified
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
    await act(async () => { resolveRoot(rootFolder); for (let i = 0; i < 6; i++) await Promise.resolve(); }); // 根層姍姍來遲
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified"); // 不得被根層覆蓋成 not_found
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

  // ---- p5-e2：CV 頁 minio_key 接收端重驗（M→CV chip 帶 object_key；pages.tsx verify records.some(r.object_key===minio_key)）。
  // 對照 A1 頁同款 minio_key predicate 已有專屬單元測試，此前 CV 這條完全無單元/瀏覽器覆蓋——補齊 verified/not_found/
  // indeterminate 三態（含中文 key），把目前沒有測試網住的回歸風險鎖住。----
  it("CV verifies an incoming minio_key against the fetched ledger records (verified, Chinese key)", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [mkRecord({ object_key: CN_KEY })] }); // 中文 object_key
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = `#conv?source=minio&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });

  it("CV flags an incoming minio_key absent from the (untruncated) ledger records as not_found (no silent fallback)", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 1, items: [mkRecord({ object_key: "270/other.ifc" })] }); // count===items.length → 未截斷
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = `#conv?source=minio&minio_key=${encodeURIComponent("270專案/建築/v07/查無.ifc")}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });

  it("CV marks an incoming minio_key absent from a TRUNCATED records window as indeterminate, not a false not_found", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 88, items: [mkRecord({ object_key: "270/other.ifc" })] }); // count 88 ≫ 1 → 截斷
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = `#conv?source=minio&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
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

  it("KG does not treat an incoming session that only matches an Object.prototype key (constructor) as verified — object-injection guard, spec §4.2 持有 ID ≠ 已授權", () => {
    // shared.sessionsById is a plain {} literal (SharedStatusProvider), so a bracket lookup of an inherited
    // prototype name (constructor/toString/__proto__/hasOwnProperty…) resolves to a truthy Object.prototype
    // member and would fake a verified banner for a session that never existed. Guard with an own-property check.
    const snap: SharedStatusSnapshot = { activeSessions: 1, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "", stale: false };
    window.location.hash = "#instances?source=sessions&session=constructor";
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    expect(container.querySelector('[data-testid="kg-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("not_found");
  });

  it("M keeps a verified incoming minio_key verified after the user manually navigates away (go-up) — arrival re-verify is not undone by later browsing (spec §4.2)", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
    // user clicks 「⬑ 上一層」 → a folder that does NOT contain CN_KEY; banner must not retroactively become not_found
    const up = container.querySelector('[data-testid="minio-go-up"]') as HTMLButtonElement;
    await act(async () => { up.click(); for (let i = 0; i < 6; i++) await Promise.resolve(); });
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
  });

  it("CV marks an incoming job_id absent from a TRUNCATED ifc-ready window as indeterminate, not a false not_found (§5.4, mirrors ledgerChipStatus recordsIncomplete)", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 99, items: [
      { ifc_ready_job_id: "job_other", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_other", dispatch_error: null, review_session_id: null, viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "" },
    ] } as never); // count 99 ≫ 1 returned item → window truncated; job_ZZZ may live beyond the window
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = "#conv?source=intake&job_id=job_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
  });

  it("CV marks an incoming conversion_id absent from a TRUNCATED records window as indeterminate, not a false not_found", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 88, items: [mkRecord({ conversion_job_id: "cj_other", object_key: "270/other.ifc" })] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = "#conv?source=intake&conversion_id=cj_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="conv-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
  });

  // ---- Task 14 Important #1（載入中 vs 查無）：接收端重驗必須把「權威資料尚未載入」（loading）與「已載入
  // 但真的查無」（not_found）分開。永不 resolve 的 fetch mock 讓頁面停在「mount effect 已觸發、第一個 fetch
  // 尚未落地」的那一格——正是會閃假 not_found 的視窗；此時應誠實回中性 indeterminate（未明），非警示 not_found。
  // CV 已有 truncated→indeterminate 覆蓋，且缺乾淨的 loading 訊號，故此組不含 CV（維持原狀）。----
  it("A1 shows indeterminate (not a false not_found) for an incoming minio_key while the object list is still loading (minioObjects===null)", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockReturnValue(new Promise(() => {}) as never); // 永不 resolve → minioObjects 停在 null（載入中）
    vi.spyOn(coordinatorClient, "runtimeStatus").mockReturnValue(new Promise(() => {}) as never);
    window.location.hash = `#a1?source=minio&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    expect(container.querySelector('[data-testid="a1-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
  });

  it("SS shows indeterminate (not a false not_found) for an incoming session while runtime status is still loading (rt===null)", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockReturnValue(new Promise(() => {}) as never); // 永不 resolve → rt 停在 null（載入中）
    window.location.hash = "#sessions?source=conv&session=review_session_a";
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    expect(container.querySelector('[data-testid="sessions-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
  });

  it("M shows indeterminate (not a false not_found) for an incoming minio_key while the folder is still loading (folder===null)", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockReturnValue(new Promise(() => {}) as never); // 永不 resolve → folder 停在 null（載入中）
    vi.spyOn(coordinatorClient, "getConversionRecords").mockReturnValue(new Promise(() => {}) as never);
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    expect(container.querySelector('[data-testid="minio-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
  });

  it("KG shows indeterminate (not a false not_found) for an incoming session while shared status is still stale (never polled)", () => {
    // KG 無 fetch；載入中訊號＝useSharedStatus().stale===true（provider 尚未輪詢過，等同 EMPTY_SHARED_STATUS）。
    const staleSnap: SharedStatusSnapshot = { activeSessions: 0, sessionsById: {}, gpuNodesTotal: null, gpuNodesBusy: null, health: "unknown", conversionQueue: null, updatedAt: "", stale: true };
    window.location.hash = "#instances?source=sessions&session=review_session_a";
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={staleSnap}><KitGpuFleetPage /></SharedStatusProvider>); });
    expect(container.querySelector('[data-testid="kg-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
  });

  // ---- honesty regression（p5-critic-honesty-regression-missing-field-falsepositive）：接收頁的 verify 只查
  // 「本軸在意的欄位」；當 handoff 存在但缺該欄位（sender 本來就不帶）時，舊行為 fall through 回 false→假 not_found
  // （警示紅字「查無」）。以下三條為已重現的真實路徑，修正後必須是 not_applicable（中性），不得誤成 not_found。----
  it("A1 does NOT false-not_found a session-only handoff from SS (real ACTIVE session, no minio_key) — not_applicable (most severe path)", async () => {
    // SS→A1 chip（session-link-a1-*, pages.tsx:1507）一定帶真實 active session id，但 A1 receiver 只重驗 minio_key。
    // 對一個 runtime/status 裡真實 active 的 session 點此 chip，舊碼 100% 假報 not_found（宣稱使用中的 session 查無）。
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ objects: [
      { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
    ] } as never);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mkSession({ session_id: "review_session_a" })]));
    window.location.hash = "#a1?source=sessions&session=review_session_a";
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const b = container.querySelector('[data-testid="a1-incoming-handoff"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_applicable"); // 非查無
    expect(b?.className ?? "").not.toContain("ec-warn-note"); // 中性，不掛警示紅字
  });

  it("CV does NOT false-not_found an A1 default-state handoff that carries no job/conversion/minio id (#conv?source=a1) — not_applicable", async () => {
    // a1-conv-link 在 A1 無 session 預設狀態送 #conv?source=a1（convJobId 為 null，不帶 job_id；pages.tsx:620）。
    // CV verify 三欄位皆缺 → 舊碼 fall through 回 false→雙空格假 not_found（「來自 a1 的  在權威資料中查無」）。
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 });
    window.location.hash = "#conv?source=a1";
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const b = container.querySelector('[data-testid="conv-incoming-handoff"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_applicable");
    expect(b?.className ?? "").not.toContain("ec-warn-note");
  });

  it("SS does NOT false-not_found a session-less handoff from the KG demo row (#sessions?source=instances) — not_applicable", async () => {
    // KG demo-row chip（kg-demo-link-sessions, pages.tsx:1585）刻意不帶 session（標示 demo 對照）。
    // SS verify 無 session 可查 → 舊碼回 false→假 not_found；修正後應中性 not_applicable。
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([mkSession({ session_id: "review_session_a" })]));
    window.location.hash = "#sessions?source=instances";
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });
    const b = container.querySelector('[data-testid="sessions-incoming-handoff"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("not_applicable");
    expect(b?.className ?? "").not.toContain("ec-warn-note");
  });
});
