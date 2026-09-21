import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindEnvironmentPanel, type WindSource } from "./WindEnvironmentPanel";
import type { CfdConsoleClient, CfdReply, CfdRunLedgerRecord, CfdRunResult, CfdRunStatusDocument } from "./cfdClient";
import type { StageBindingResultMessage, StageBindingSelection } from "../../viewerCommandChannel/viewerEmbedProtocol";
import { getLang, setLang } from "../i18n";

// S3（building-energy-cfd-p2-contract.md）：面板只打 coordinator；此處以注入 client 取代 fetch，
// 斷言請求形狀（凍結 cfd-run-request/v1）、輪詢終態、overlay 登記 → stage-binding → Kit 確認的誠實顯示。

let root: Root, box: HTMLDivElement;
const previousLang = getLang();
const SESSION = "review_session_wind_0001";
const RUN = "cfd_20260921T070000Z_ui0001";
const SOURCE: WindSource = { conversionJobId: "stream_conv_20260915094906_54813240", primaryArtifactId: "auto_usdc_stream_conv_20260915094906_54813240" };

function ok<T>(body: T, status = 200): CfdReply<T> { return { status, body, errorCode: null, detail: null }; }
function fail<T>(status: number, errorCode: string, detail = ""): CfdReply<T> { return { status, body: null, errorCode, detail }; }

function ledger(status: CfdRunLedgerRecord["status"], done: number): CfdRunLedgerRecord {
  return {
    schema: "cfd-run-ledger-record/v1", run_id: RUN, conversion_job_id: SOURCE.conversionJobId, status,
    directions_total: 2, directions_done: done, converged_count: done, sealing_suspect: status === "ready" ? false : null,
    failure_code: null, created_at: "2026-09-21T07:00:00Z", updated_at: "2026-09-21T07:05:00Z", requested_by_principal: "coordinator-browser",
  };
}
function statusDoc(status: CfdRunStatusDocument["status"], done: number): CfdRunStatusDocument {
  return {
    schema: "cfd-run-status/v1", run_id: RUN, status, failure_code: null, error: null,
    progress: { directions_total: 2, directions_done: done }, sealing_suspect: status === "ready" ? false : null, converged_count: done,
    cancel_requested: false, created_at: "2026-09-21T07:00:00Z", updated_at: "2026-09-21T07:05:00Z", started_at: "2026-09-21T07:00:01Z",
    finished_at: status === "ready" ? "2026-09-21T07:05:00Z" : null, source: { conversion_job_id: SOURCE.conversionJobId, model_usdc_sha256: "c".repeat(64) },
    requested_by: { principal: "coordinator-browser", trace_id: "trace_cfd_ui" }, result_filename: status === "ready" ? "result.json" : null,
    purpose: "design_comparison_only",
  } as CfdRunStatusDocument;
}
const RESULT: CfdRunResult = {
  schema: "cfd-run-result/v1", run_id: RUN, status: "ready", purpose: "design_comparison_only",
  source: { conversion_job_id: SOURCE.conversionJobId, model_usdc_sha256: "c".repeat(64) },
  preprocess: { profile: "exterior-wind/v1", closing_radius_voxels: 4, leak_fraction: 0.1198, leak_fraction_limit: 0.15, sealing_suspect: false, appendage_policy: "included" },
  directions: [
    { wind_from_degrees: 0, status: "ready", converged_by_residual_control: true, iterations: 285, mesh_cells: 626099,
      overlay_layer: { artifact_id: `cfd:${RUN}:w000`, filename: `${RUN}_w000.usdc`, sha256: "0".repeat(64), url: "http://public:49101/cfd-artifacts/x/y.usdc" },
      pedestrian_1p5m: { U_magnitude_max: 3.58, polygons: 29097 }, building_pressure: { p_min: -17.6, p_max: 11.8 } },
    { wind_from_degrees: 22.5, status: "failed", converged_by_residual_control: null, iterations: null, overlay_layer: null, pedestrian_1p5m: null, building_pressure: null },
  ],
  run_record: { schema: "cfd-run-record/v1", filename: "run_record.json", sha256: "1".repeat(64) },
  exclusions: { filename: "exclusions.json", sha256: "2".repeat(64), counts: { class_excluded: 454, outlier: 39 } },
  assumptions: ["true_north_default_direction"],
  limitations: ["Results are for design comparison only; not a regulatory or certification basis."],
};

function makeClient(overrides: Partial<CfdConsoleClient> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const wrap = <K extends keyof CfdConsoleClient>(name: K, impl: CfdConsoleClient[K]) =>
    ((...args: unknown[]) => { calls.push({ method: name, args }); return (impl as (...a: unknown[]) => unknown)(...args); }) as CfdConsoleClient[K];
  const client: CfdConsoleClient = {
    listRuns: wrap("listRuns", overrides.listRuns ?? (async () => ok({ items: [], count: 0, enabled: true, stale: false }))),
    createRun: wrap("createRun", overrides.createRun ?? (async () => ok(statusDoc("queued", 0), 202))),
    getRun: wrap("getRun", overrides.getRun ?? (async () => ok({ ledger: ledger("ready", 2), status: statusDoc("ready", 2) }))),
    getRunResult: wrap("getRunResult", overrides.getRunResult ?? (async () => ok(RESULT))),
    cancelRun: wrap("cancelRun", overrides.cancelRun ?? (async () => ok(statusDoc("cancelled", 0)))),
    registerOverlay: wrap("registerOverlay", overrides.registerOverlay ?? (async (sessionId: string, runId: string, deg: number) => ok({
      session_id: sessionId, binding_id: `binding_cfd_${runId}_w000`, artifact_id: `cfd:${runId}:w000`, artifact_role: "overlay", load_order: 1,
      url: "http://public:49101/cfd-artifacts/x/y.usdc", run_id: runId, wind_from_degrees: deg, idempotent_replay: false,
    }, 201))),
  };
  return { client, calls };
}

async function flush(ticks = 6) {
  for (let i = 0; i < ticks; i += 1) await act(async () => { await Promise.resolve(); });
}
const $ = <T extends HTMLElement>(selector: string) => box.querySelector<T>(selector);
const click = async (selector: string) => { await act(async () => { $<HTMLButtonElement>(selector)!.click(); }); };

beforeEach(() => { setLang("zh"); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; box = document.createElement("div"); document.body.append(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); setLang(previousLang); });

describe("WindEnvironmentPanel", () => {
  it("without a session it explains the prerequisite and never calls the coordinator", async () => {
    const { client, calls } = makeClient();
    act(() => root.render(<WindEnvironmentPanel sessionId="" ready={false} client={client} loadSource={async () => SOURCE} />));
    await flush();
    expect($('[data-testid="wind-no-session"]')).not.toBeNull();
    expect($('[data-testid="wind-purpose"]')!.textContent).toContain("設計比較用");
    expect(calls).toHaveLength(0);
    expect(box.querySelector("canvas,video,iframe")).toBeNull();
  });

  it("CFD disabled on the coordinator is shown honestly and submit stays disabled", async () => {
    const { client } = makeClient({ listRuns: async () => ok({ items: [], count: 0, enabled: false, stale: false }) });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} />));
    await flush();
    expect($('[data-testid="wind-disabled"]')).not.toBeNull();
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(true);
  });

  it("submits the frozen request shape with the selected directions, then polls to ready and renders per-direction rows", async () => {
    const getRun = vi.fn()
      .mockResolvedValueOnce(ok({ ledger: ledger("solving", 1), status: statusDoc("solving", 1) }))
      .mockResolvedValue(ok({ ledger: ledger("ready", 2), status: statusDoc("ready", 2) }));
    const listRuns = vi.fn()
      .mockResolvedValueOnce(ok({ items: [], count: 0, enabled: true, stale: false }))
      .mockResolvedValue(ok({ items: [ledger("queued", 0)], count: 1, enabled: true, stale: false }));
    const { client, calls } = makeClient({ getRun, listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush();
    expect($('[data-testid="wind-no-runs"]')).not.toBeNull();

    act(() => { $<HTMLInputElement>('[data-testid="wind-dir-22.5"]')!.click(); });
    await click('[data-testid="wind-submit"]');
    await flush();
    const created = calls.find((call) => call.method === "createRun")!.args[0] as Record<string, unknown>;
    expect(created.schema).toBe("cfd-run-request/v1");
    expect(created.source).toEqual({ conversion_job_id: SOURCE.conversionJobId });
    expect((created.wind as { wind_from_degrees: number[] }).wind_from_degrees).toEqual([0, 22.5]);
    expect((created.wind as { true_north_source: string }).true_north_source).toBe("geo_reference");
    expect(created).not.toHaveProperty("requested_by");
    expect(typeof created.idempotency_key).toBe("string");
    expect(created.idempotency_key as string).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);

    // solving → (poll) → ready → result fetched once → rows rendered
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();
    expect($('[data-testid="wind-run-status"]')!.getAttribute("data-status")).toBe("ready");
    expect($('[data-testid="wind-result"]')).not.toBeNull();
    expect($('[data-testid="wind-row-0"]')!.textContent).toContain("3.58 m/s");
    expect($('[data-testid="wind-row-22.5"]')!.textContent).toContain("失敗");
    expect($('[data-testid="wind-assumptions"]')!.textContent).toContain("project north");
    expect(calls.filter((call) => call.method === "getRunResult")).toHaveLength(1);
    // Terminal: no further polling after ready.
    const polls = calls.filter((call) => call.method === "getRun").length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.filter((call) => call.method === "getRun").length).toBe(polls);
    // Overlay buttons: only the ready direction is actionable.
    expect($<HTMLButtonElement>('[data-testid="wind-overlay-on-0"]')!.disabled).toBe(false);
    expect($<HTMLButtonElement>('[data-testid="wind-overlay-on-22.5"]')!.disabled).toBe(true);
  });

  it("show overlay = register binding on the session, then apply primary+secondary through the stage-binding path; applied only on Kit confirmation", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const { client, calls } = makeClient({ listRuns });
    const apply = vi.fn(async (artifacts: StageBindingSelection[]): Promise<StageBindingResultMessage> => ({
      protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "binding_rev_9",
      applied_secondary_layers: artifacts.filter((item) => item.role === "secondary").map((item) => item.artifact_id),
    }));
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={apply} pollIntervalMs={5} />));
    await flush(10);
    expect($('[data-testid="wind-result"]')).not.toBeNull();

    await click('[data-testid="wind-overlay-on-0"]');
    await flush(10);
    const registered = calls.find((call) => call.method === "registerOverlay")!;
    expect(registered.args).toEqual([SESSION, RUN, 0]);
    expect(apply).toHaveBeenCalledWith([
      { artifact_id: SOURCE.primaryArtifactId, role: "primary", load_order: 0 },
      { artifact_id: `cfd:${RUN}:w000`, role: "secondary", load_order: 1 },
    ]);
    const overlayStatus = $('[data-testid="wind-overlay-status"]')!;
    expect(overlayStatus.getAttribute("data-state")).toBe("applied");
    expect(overlayStatus.textContent).toContain("Kit 已確認載入疊圖");
    expect(overlayStatus.textContent).toContain("binding_rev_9");

    // Hide = primary only.
    await click('[data-testid="wind-overlay-off-0"]');
    await flush(6);
    expect(apply).toHaveBeenLastCalledWith([{ artifact_id: SOURCE.primaryArtifactId, role: "primary", load_order: 0 }]);
    expect($('[data-testid="wind-overlay-status"]')!.getAttribute("data-state")).toBe("off");
  });

  it("registration 409 and Kit failure are reported as not applied, and a stage without the layer in the applied list is not called loaded", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const registerOverlay = vi.fn()
      .mockResolvedValueOnce(fail(409, "direction_not_ready", "requested wind direction has no ready overlay layer"))
      .mockResolvedValue(ok({ session_id: SESSION, binding_id: "b", artifact_id: `cfd:${RUN}:w000`, artifact_role: "overlay", load_order: 1, url: "u", run_id: RUN, wind_from_degrees: 0, idempotent_replay: true }));
    const { client } = makeClient({ listRuns, registerOverlay });
    const apply = vi.fn<(artifacts: StageBindingSelection[]) => Promise<StageBindingResultMessage>>()
      .mockResolvedValueOnce({ protocol: "vg01", type: "stage_binding_result", status: "failed", revision_id: null, reason: "primary_lease_required" })
      .mockResolvedValueOnce({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "binding_rev_2", applied_secondary_layers: [] });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={apply} pollIntervalMs={5} />));
    await flush(10);

    await click('[data-testid="wind-overlay-on-0"]');
    await flush(6);
    expect($('[data-testid="wind-overlay-status"]')!.textContent).toContain("direction_not_ready");
    expect(apply).not.toHaveBeenCalled();

    await click('[data-testid="wind-overlay-on-0"]');
    await flush(8);
    expect($('[data-testid="wind-overlay-status"]')!.getAttribute("data-state")).toBe("failed");
    expect($('[data-testid="wind-overlay-status"]')!.textContent).toContain("primary_lease_required");

    await click('[data-testid="wind-overlay-on-0"]');
    await flush(8);
    expect($('[data-testid="wind-overlay-status"]')!.getAttribute("data-state")).toBe("failed");
    expect($('[data-testid="wind-overlay-status"]')!.textContent).toContain("不在已套用清單");
  });

  it("viewer not ready disables overlay actions but not run submission", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const { client } = makeClient({ listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready={false} blockedReason="first frame 未到" client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(10);
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(false);
    expect($<HTMLButtonElement>('[data-testid="wind-overlay-on-0"]')!.disabled).toBe(true);
    expect($('[data-testid="wind-overlay-status"]')!.textContent).toContain("first frame 未到");
  });
});
