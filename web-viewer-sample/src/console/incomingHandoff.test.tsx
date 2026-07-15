// web-viewer-sample/src/console/incomingHandoff.test.tsx
// Task 14（七軸和諧 §4.2 接收端重驗鐵律）：接收端一律以 ID 向已抓取的權威資料重驗，查無 → 誠實
// not_found + 手動重選，不靜默 fallback。本檔涵蓋（1）共用 hook/banner 的分支邏輯，（2）接收頁各自
// 的真實 wiring。
// MD 三頁合一（Task 9）：原 M（MinioDataPage）/ CV（ConversionSchedulingPage）兩接收頁已合併為單一
// ModelDataPage（#minio；#conv/#intake 以 alias 重導保 query 到 #minio）。故原本各自 render 舊頁的
// M/CV wiring 測試改 render ModelDataPage，hash 統一 #minio，banner testid 統一 md-incoming-handoff。
// A1 / SS / KG 三頁未動，維持原樣。job_id/conversion_id → jobs/records 重驗（CV 語意）；minio_key/prefix
// → 導覽後向 folder 重驗（M 語意）；皆無欄位 → not_applicable。四分支現由 ModelDataPage predicate 承接。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncomingHandoffBanner, useIncomingHandoff } from "./incomingHandoff";
import { A1GovernanceWorkbenchPage, KitGpuFleetPage, SessionManagementPage } from "./pages";
import { ModelDataPage } from "./modelData/ModelDataPage";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { coordinatorClient, type ConversionRecord, type MinioFolderListing, type RuntimeStatus, type RuntimeSessionSummary } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";
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
  // IA v2 發射端遷移回歸鎖：md-detail-a1 / session-link-a1 現發 #a1-workbench（真 A1 工作台），
  // 接收端 selfAxis 仍是 "a1"（useIncomingHandoff 以 hash.startsWith("#a1") 判定）——兩形皆須命中，
  // 否則發射端遷移會把接收端重驗靜默斷鏈。
  it("selfAxis 'a1' still matches an #a1-workbench arrival hash (IA v2 emitter migration guard)", () => {
    function WbProbe() {
      const inc = useIncomingHandoff("a1", () => true, "#a1-workbench?source=minio&minio_key=270/x.ifc");
      return <IncomingHandoffBanner testId="probe-banner" handoff={inc.handoff} status={inc.status} />;
    }
    const root = createRoot(container);
    act(() => { root.render(<WbProbe />); });
    const b = container.querySelector('[data-testid="probe-banner"]');
    expect(b?.getAttribute("data-handoff-status")).toBe("verified");
    expect(b?.getAttribute("data-handoff-source")).toBe("minio");
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

// ModelDataPage 掛載時 useConversionData + useMinioFolder 會打五個端點；未針對性 mock 者一律 stub 成空，
// 讓每個測試只需覆寫它要驗的那條分支（其餘不打真 fetch、不噴 loading 噪音）。呼叫後再覆寫的 mock 生效。
function quietModelDataEndpoints() {
  vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
  vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false } as never);
  vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
  vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [], count: 0 } as never);
  vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
}

function mdBannerStatus(container: HTMLElement): string | null {
  return container.querySelector('[data-testid="md-incoming-handoff"]')?.getAttribute("data-handoff-status") ?? null;
}

// waitFor：以「輪詢直到斷言成立」取代固定 microtask tick 數，徹底消除接收頁獨立 async 載入鏈尚未 settle 就斷言的
// 競態。每輪包一次 act 以 flush 一個 microtask + 觸發重繪；斷言通過即返回，達上限仍不過才拋出最後一次 AssertionError
// （語意同 testing-library 的 waitFor，比固定 tick 數穩定）。
async function waitFor(assert: () => void, maxTicks = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

describe("receiving pages re-verify the incoming handoff id", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "", source_kind: "local_fs", projects: [] });
  });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = ""; });

  it("MD (M axis) navigates to a real incoming minio_key's folder and verifies it there (root list never holds the deep key)", async () => {
    // 真實 S3 帶 Delimiter='/'：3 層深的 CN_KEY 在根層只會以 CommonPrefix(270專案/) 落在 folders，
    // 絕不出現在根層 objects。接收端必須先導覽到 CN_KEY 所在資料夾(270專案/建築/v07/)、向該層 folder 重驗，
    // 才能誠實 verified；停在根層 = 對真實巢狀 key 恆誤報 not_found(§4.2 誠實 verified)。fixture 依 prefix 分流
    // (root vs 來源層)以尊重 delimiter 語意。ModelDataPage 的導覽 effect 承接原 M 頁自動導覽行為。
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("verified"); });
    expect(container.querySelector('[data-testid="md-incoming-handoff"]')?.getAttribute("data-handoff-source")).toBe("a1");
    expect(coordinatorClient.getMinioFolder).toHaveBeenCalledWith(SRC_PREFIX); // 真的導覽到 key 所在層，非停在根
  });

  it("MD (M axis) flags an incoming minio_key absent from its navigated folder as not_found (no silent fallback)", async () => {
    // 導覽到 key 所在資料夾後，該層 objects 真的沒有這支 key(已刪/改名)→ 誠實 not_found，非靜默 fallback。
    const GONE_KEY = "270專案/建築/v07/已刪除.ifc"; // 同資料夾(SRC_PREFIX)，但 srcFolder.objects 只有 CN_KEY
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(GONE_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("not_found"); });
    expect(coordinatorClient.getMinioFolder).toHaveBeenCalledWith(SRC_PREFIX); // 導覽到該層後才判定 not_found
  });

  it("MD (M axis) keeps the navigated folder verified even when a slow root refetch lands late (generation guard, no clobber)", async () => {
    // 掛載時併發兩個 getMinioFolder：根層(prefix="")＋導覽目標層。真實 S3 根層需逐一 probe 子資料夾
    // has_source_ifc(序列)，通常比葉層慢；無世代守門則根層晚到的回應會蓋掉已導覽的葉層 folder，
    // folder.prefix 退回 ""→verify 對 minio_key 失敗→假 not_found(§4.2 想避免的假訊息)。此處刻意讓
    // 根層 pending、葉層先落地，再放行根層，斷言不得被覆蓋。世代守門在 useMinioFolder（Task 3 搬移）。
    quietModelDataEndpoints();
    let resolveRoot: (v: MinioFolderListing) => void = () => {};
    const rootPending = new Promise<MinioFolderListing>((r) => { resolveRoot = r; });
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation((p?: string) => (p === SRC_PREFIX ? Promise.resolve(srcFolder) : rootPending));
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("verified"); }); // 葉層(正確)先落地→verified
    await act(async () => { resolveRoot(rootFolder); for (let i = 0; i < 6; i++) await Promise.resolve(); }); // 根層姍姍來遲
    expect(mdBannerStatus(container)).toBe("verified"); // 不得被根層覆蓋成 not_found
  });

  it("MD (M axis) navigates to an incoming prefix (回看選檔來源) and verifies it against the freshly loaded folder (verified)", async () => {
    // A1 → M prefix handoff（spec §4.3）：接收端必須真的導覽到來源資料夾、向該層 folder 重驗，
    // 不能只因『持有 prefix』就 verified。mock 依 prefix 回不同層：根層（無此檔）vs 來源層（含 CN_KEY）。
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    window.location.hash = `#minio?source=a1&prefix=${encodeURIComponent(SRC_PREFIX)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("verified"); });
    expect(container.querySelector('[data-testid="md-incoming-handoff"]')?.getAttribute("data-handoff-source")).toBe("a1");
    expect(coordinatorClient.getMinioFolder).toHaveBeenCalledWith(SRC_PREFIX); // 真的導覽到來源層，非停在根
  });

  it("MD (M axis) flags an incoming prefix that resolves to an empty/absent folder as not_found (no silent fallback)", async () => {
    // 導覽到來源層後該層無 folders/objects（查無 / 已刪 / 未設定）→ 誠實 not_found，不靜默 fallback。
    const gonePrefix = "999查無專案/";
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => ({ bucket: "bim-control", prefix: p ?? "", folders: [], count: 0, objects: [] }));
    window.location.hash = `#minio?source=a1&prefix=${encodeURIComponent(gonePrefix)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("not_found"); });
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

  // reviewer P2（Codex，已核實）：getMinioObjects() 失敗時 catch 分支把 minioObjects 落成 []（非 null），
  // 修前的 null 守門不再成立，未查即誤報 not_found（MinIO 斷線/憑證缺失時對真實 handoff 假警示紅字）。
  it("A1 marks an incoming minio_key as indeterminate (not a false not_found) when getMinioObjects fails", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockRejectedValue(new Error("minio unavailable"));
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([]));
    window.location.hash = `#a1?source=minio&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="a1-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("indeterminate");
  });

  // verified handoff seeds the MinIO selector, but MinIO object keys are not server-local ifc_source_path.
  // The direct CPU pick stays disabled to avoid POST /api/governance/rule-runs 400.
  it("A1 seeds the MinIO select dropdown from a verified incoming minio_key without enabling direct CPU rule-run", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ objects: [
      { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
    ] } as never);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(status([]));
    window.location.hash = `#a1?source=minio&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="a1-incoming-handoff"]')?.getAttribute("data-handoff-status")).toBe("verified");
    const select = container.querySelector('[data-testid="a1-minio-select"]') as HTMLSelectElement;
    expect(select.value).toBe(CN_KEY);
    const pick = container.querySelector('[data-testid="a1-step-pick"]') as HTMLButtonElement;
    expect(pick.disabled).toBe(true);
    expect(container.querySelector('[data-testid="a1-minio-source-note"]')?.textContent).toContain("server-local IFC path");
  });

  it("MD (CV axis) verifies an incoming job_id against the fetched ifc-ready jobs (verified)", async () => {
    // CV's authoritative lists = jobs (listIfcReady) + records (getConversionRecords), now surfaced by ModelDataPage.
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [
      { ifc_ready_job_id: "job_1", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_1", dispatch_error: null, review_session_id: "review_session_a", viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "" },
    ] } as never);
    window.location.hash = "#minio?source=intake&job_id=job_1";
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("verified"); });
  });

  it("MD (CV axis) flags an incoming job_id absent from jobs/records as not_found (no silent fallback)", async () => {
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] } as never);
    window.location.hash = "#minio?source=intake&job_id=job_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("not_found"); });
  });

  // reviewer P2（CodeRabbit + Codex 兩位獨立命中同一發現，已核實）：修前 jobs/records 初始值皆為 []、
  // jobsTruncated/recordsTruncated 初始皆為 false，與「已查過、確認不存在」在資料形狀上不可分——mount 後
  // 第一個 render（load()/loadRecords() 的 promise 尚未 resolve）就會以此空狀態誤報 not_found。用永不 settle
  // 的 promise 鎖定「掛載當下、尚未載入」這個瞬間，不 flush 任何 microtask，直接斷言為 indeterminate。
  it("MD (CV axis) shows indeterminate (not a false not_found) on the very first render before jobs/records have loaded", () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(coordinatorClient, "getMinioFolder").mockReturnValue(new Promise(() => {}) as never);
    window.location.hash = "#minio?source=intake&job_id=job_1";
    const root = createRoot(container);
    act(() => { root.render(<ModelDataPage />); });
    expect(mdBannerStatus(container)).toBe("indeterminate");
  });

  // ---- 退役（Task 9 MD 三頁合一）：原「CV 頁 minio_key 向 ledger records 重驗」三態測試（verified/not_found/
  // indeterminate，含中文 key）已隨舊 CV 頁移除。合併後 ModelDataPage 對 minio_key 一律走 M 語意——導覽到來源
  // 資料夾後向 folder.objects 重驗（見上方 MD (M axis) minio_key 測試），不再以 ledger records.object_key 比對。
  // minio_key 的截斷→indeterminate 誠實保證改由「folder===null → indeterminate」承接（見下方 loading 測試）。----

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

  it("MD (M axis) keeps a verified incoming minio_key verified after the user manually navigates away (go-up) — arrival re-verify is not undone by later browsing (spec §4.2)", async () => {
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(async (p?: string) => (p === SRC_PREFIX ? srcFolder : rootFolder));
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("verified"); });
    // user clicks 「⬑ 上一層」 → a folder that does NOT contain CN_KEY; banner must not retroactively become not_found
    const up = container.querySelector('[data-testid="minio-go-up"]') as HTMLButtonElement;
    await act(async () => { up.click(); for (let i = 0; i < 6; i++) await Promise.resolve(); });
    expect(mdBannerStatus(container)).toBe("verified"); // arrival latch not undone by later browsing
  });

  it("MD (CV axis) marks an incoming job_id absent from a TRUNCATED ifc-ready window as indeterminate, not a false not_found (§5.4, mirrors ledgerChipStatus recordsIncomplete)", async () => {
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 99, items: [
      { ifc_ready_job_id: "job_other", status: "ready", project_id: "270", external_model_version_id: "v1", download_status: "done", conversion_status: "ready", conversion_authority: "bim-streaming-server", queue_position: null, conversion_job_id: "cj_other", dispatch_error: null, review_session_id: null, viewer_url: null, expected_stage_url: null, expected_mapping_url: null, created_at: "", updated_at: "" },
    ] } as never); // count 99 ≫ 1 returned item → window truncated; job_ZZZ may live beyond the window
    window.location.hash = "#minio?source=intake&job_id=job_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("indeterminate"); });
  });

  it("MD (CV axis) marks an incoming conversion_id absent from a TRUNCATED records window as indeterminate, not a false not_found", async () => {
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 88, items: [mkRecord({ conversion_job_id: "cj_other", object_key: "270/other.ifc" })] });
    window.location.hash = "#minio?source=intake&conversion_id=cj_ZZZ";
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("indeterminate"); });
  });

  // ---- Task 14 Important #1（載入中 vs 查無）：接收端重驗必須把「權威資料尚未載入」（loading）與「已載入
  // 但真的查無」（not_found）分開。永不 resolve 的 fetch mock 讓頁面停在「mount effect 已觸發、第一個 fetch
  // 尚未落地」的那一格——正是會閃假 not_found 的視窗；此時應誠實回中性 indeterminate（未明），非警示 not_found。----
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

  it("MD (M axis) shows indeterminate (not a false not_found) for an incoming minio_key while the folder is still loading (folder===null)", async () => {
    quietModelDataEndpoints();
    vi.spyOn(coordinatorClient, "getMinioFolder").mockReturnValue(new Promise(() => {}) as never); // 永不 resolve → folder 停在 null（載入中）
    window.location.hash = `#minio?source=a1&minio_key=${encodeURIComponent(CN_KEY)}`;
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    expect(mdBannerStatus(container)).toBe("indeterminate");
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
    // SS→A1 chip（session-link-a1-*）一定帶真實 active session id，但 A1 receiver 只重驗 minio_key。
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

  it("MD (CV axis) does NOT false-not_found an A1 default-state handoff that carries no job/conversion/minio id (#minio?source=a1) — not_applicable", async () => {
    // a1-conv-link 在 A1 無 session 預設狀態送到 MD 頁（convJobId 為 null，不帶 job_id）。合併後 alias 把
    // #conv?source=a1 重導為 #minio?source=a1（保 query）。MD verify 四欄位皆缺 → 必須中性 not_applicable，
    // 不得 fall through 成假 not_found（誠實 regression）。
    quietModelDataEndpoints();
    window.location.hash = "#minio?source=a1";
    const root = createRoot(container);
    await act(async () => { root.render(<ModelDataPage />); });
    await waitFor(() => { expect(mdBannerStatus(container)).toBe("not_applicable"); });
    expect(container.querySelector('[data-testid="md-incoming-handoff"]')?.className ?? "").not.toContain("ec-warn-note");
  });

  it("SS does NOT false-not_found a session-less handoff from the KG demo row (#sessions?source=instances) — not_applicable", async () => {
    // KG demo-row chip（kg-demo-link-sessions）刻意不帶 session（標示 demo 對照）。
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
