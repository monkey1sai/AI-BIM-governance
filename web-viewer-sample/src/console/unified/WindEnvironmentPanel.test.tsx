import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindEnvironmentPanel, type WindSource } from "./WindEnvironmentPanel";
import type { CfdConsoleClient, CfdEstimate, CfdFinding, CfdOptionsDocument, CfdReply, CfdRunLedgerRecord, CfdRunResult, CfdRunStatusDocument, WindModelOption } from "./cfdClient";
// S8: the options and estimate fixtures are the contract examples, generated from the real streaming code.
import optionsSchema from "../../../../tests/contracts/cfd-options-v1.schema.json";
import estimateSchema from "../../../../tests/contracts/cfd-estimate-v1.schema.json";
import type { StageBindingResultMessage, StageBindingSelection } from "../../viewerCommandChannel/viewerEmbedProtocol";
import type { OverlayStyleState } from "../../viewerCommandChannel/overlayStyle";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import { getLang, setLang } from "../i18n";

// S3（building-energy-cfd-p2-contract.md）：面板只打 coordinator；此處以注入 client 取代 fetch，
// 斷言請求形狀（凍結 cfd-run-request/v1）、輪詢終態、overlay 登記 → stage-binding → Kit 確認的誠實顯示。

let root: Root, box: HTMLDivElement;
const previousLang = getLang();
const SESSION = "review_session_wind_0001";
const RUN = "cfd_20260921T070000Z_ui0001";
const SOURCE: WindSource = { conversionJobId: "stream_conv_20260915094906_54813240", primaryArtifactId: "auto_usdc_stream_conv_20260915094906_54813240", modelVersionId: "version_cfd_test" };
// S7: two ready models the picker can offer without a session; the second one is not the session's model.
const OTHER_JOB = "stream_conv_20260917000000_0badc0de";
const MODELS: WindModelOption[] = [
  { conversionJobId: SOURCE.conversionJobId, label: "Demo A · architecture · 0a1b2c3d" },
  { conversionJobId: OTHER_JOB, label: "Demo B · structure · 0badc0de" },
];

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
    { wind_from_degrees: 0, status: "ready", converged_by_residual_control: true, iterations: 285, mesh_cells: 626099, end_time_extended_to: 1200,
      overlay_layer: { artifact_id: `cfd:${RUN}:w000`, filename: `${RUN}_w000.usdc`, sha256: "0".repeat(64), url: "http://public:49101/cfd-artifacts/x/y.usdc" },
      pedestrian_1p5m: { U_magnitude_max: 3.58, polygons: 29097 }, building_pressure: { p_min: -17.6, p_max: 11.8 } },
    { wind_from_degrees: 22.5, status: "failed", converged_by_residual_control: null, iterations: null, overlay_layer: null, pedestrian_1p5m: null, building_pressure: null },
  ],
  run_record: { schema: "cfd-run-record/v1", filename: "run_record.json", sha256: "1".repeat(64) },
  exclusions: { filename: "exclusions.json", sha256: "2".repeat(64), counts: { class_excluded: 454, outlier: 39 } },
  assumptions: ["true_north_default_direction"],
  limitations: ["Results are for design comparison only; not a regulatory or certification basis."],
};

const OPTIONS = optionsSchema.examples[0] as unknown as CfdOptionsDocument;
const ESTIMATE = estimateSchema.examples[0] as unknown as CfdEstimate;
const ESTIMATE_UNAVAILABLE = estimateSchema.examples[1] as unknown as CfdEstimate;

function makeClient(overrides: Partial<CfdConsoleClient> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const wrap = <K extends keyof CfdConsoleClient>(name: K, impl: CfdConsoleClient[K]) =>
    ((...args: unknown[]) => { calls.push({ method: name, args }); return (impl as (...a: unknown[]) => unknown)(...args); }) as CfdConsoleClient[K];
  const client: CfdConsoleClient = {
    listRuns: wrap("listRuns", overrides.listRuns ?? (async () => ok({ items: [], count: 0, enabled: true, stale: false }))),
    listModels: wrap("listModels", overrides.listModels ?? (async () => ok({ items: MODELS }))),
    createRun: wrap("createRun", overrides.createRun ?? (async () => ok(statusDoc("queued", 0), 202))),
    getRun: wrap("getRun", overrides.getRun ?? (async () => ok({ ledger: ledger("ready", 2), status: statusDoc("ready", 2) }))),
    getRunResult: wrap("getRunResult", overrides.getRunResult ?? (async () => ok(RESULT))),
    cancelRun: wrap("cancelRun", overrides.cancelRun ?? (async () => ok(statusDoc("cancelled", 0)))),
    createFindings: wrap("createFindings", overrides.createFindings ?? (async (runId: string, body: { threshold_u_m_s?: number }) => ok({
      run_id: runId, threshold_u_m_s: body.threshold_u_m_s ?? 5, validation_level: "screening", purpose: "design_comparison_only", created_count: 1,
      evaluated: [
        { wind_from_degrees: 0, u_max_m_s: 3.58, exceeds: true, idempotent_replay: false, skipped_reason: null,
          finding: { wind_from_degrees: 0, threshold_u_m_s: body.threshold_u_m_s ?? 5, u_max_m_s: 3.58, severity: "medium", issue_id: "iss_test_0001", issue_kind: "annotation", model_version_id: "version_cfd_test", validation_level: "screening", created_at: "2026-09-22T12:00:00Z" } },
        { wind_from_degrees: 22.5, u_max_m_s: null, exceeds: false, finding: null, idempotent_replay: false, skipped_reason: "direction_not_ready" },
      ],
    }, 201))),
    registerOverlay: wrap("registerOverlay", overrides.registerOverlay ?? (async (sessionId: string, runId: string, deg: number) => ok({
      session_id: sessionId, binding_id: `binding_cfd_${runId}_w000`, artifact_id: `cfd:${runId}:w000`, artifact_role: "overlay", load_order: 1,
      url: "http://public:49101/cfd-artifacts/x/y.usdc", run_id: runId, wind_from_degrees: deg, idempotent_replay: false,
    }, 201))),
    getOptions: wrap("getOptions", overrides.getOptions ?? (async () => ok(OPTIONS))),
    estimate: wrap("estimate", overrides.estimate ?? (async () => ok(ESTIMATE))),
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
  it("without a session it only lists models and the cross-model overview; nothing is submitted or bound", async () => {
    const { client, calls } = makeClient();
    act(() => root.render(<WindEnvironmentPanel sessionId="" ready={false} client={client} loadSource={async () => SOURCE} />));
    await flush();
    expect($('[data-testid="wind-no-session"]')!.textContent).toContain("需要先啟動 3D session");
    expect($('[data-testid="wind-purpose"]')!.textContent).toContain("設計比較用");
    expect(calls.map((call) => call.method).sort()).toEqual(["listModels", "listRuns"]);
    expect(calls.find((call) => call.method === "listRuns")!.args).toEqual([null, 20]);
    expect($('[data-testid="wind-submit"]')).toBeNull();
    expect(box.querySelector("canvas,video,iframe")).toBeNull();
  });

  it("S7: without a session a ready model can be picked and a run submitted with origin.session_id null; overlays stay gated", async () => {
    const listRuns = vi.fn(async (id?: string | null) => id === OTHER_JOB
      ? ok({ items: [{ ...ledger("ready", 2), conversion_job_id: OTHER_JOB, queue_position: null, origin: null }], count: 1, enabled: true, stale: false })
      : ok({ items: [], count: 0, enabled: true, stale: false }));
    const { client, calls } = makeClient({ listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId="" ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush();
    const select = $<HTMLSelectElement>('[data-testid="wind-model-select"]')!;
    expect(select.disabled).toBe(false);
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", SOURCE.conversionJobId, OTHER_JOB]);
    await act(async () => { select.value = OTHER_JOB; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush(10);
    expect(listRuns).toHaveBeenCalledWith(OTHER_JOB);
    // A ready run of the picked model is browsable, but "show overlay" needs a session even when the viewer is ready.
    const show = $<HTMLButtonElement>('[data-testid="wind-overlay-on-0"]')!;
    expect(show.disabled).toBe(true);
    expect(show.title).toContain("需要 review session");
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(false);
    await click('[data-testid="wind-submit"]');
    await flush();
    const created = calls.find((call) => call.method === "createRun")!.args[0] as Record<string, unknown>;
    expect(created.source).toEqual({ conversion_job_id: OTHER_JOB });
    expect(created.origin).toEqual({ session_id: null });
    expect(calls.some((call) => call.method === "registerOverlay")).toBe(false);
  });

  it("S7: with a session the picker is fixed to the session model, origin.session_id is sent, queue position and origin are shown", async () => {
    const queued = { ...ledger("queued", 0), queue_position: 2, origin: { session_id: SESSION, wind_from_degrees: [0, 22.5], uref_m_s: 5, end_time: null, n_procs: null, background_cell_m: null } };
    const listRuns = vi.fn(async (id?: string | null) => id
      ? ok({ items: [queued], count: 1, enabled: true, stale: false })
      : ok({ items: [queued, { ...ledger("ready", 2), run_id: "cfd_20260920T000000Z_other1", conversion_job_id: OTHER_JOB }], count: 2, enabled: true, stale: false }));
    const getRun = async () => ok({ ledger: queued, status: statusDoc("queued", 0) });
    const { client, calls } = makeClient({ listRuns, getRun });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(10);
    const select = $<HTMLSelectElement>('[data-testid="wind-model-select"]')!;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe(SOURCE.conversionJobId);
    expect($('[data-testid="wind-model-from-session"]')).not.toBeNull();
    expect($('[data-testid="wind-queue-position"]')!.textContent).toContain("排隊第 2 位");
    expect($('[data-testid="wind-run-origin"]')!.textContent).toContain(SESSION.slice(-12));
    // Cross-model overview lists both models' runs from the unfiltered ledger list.
    expect($(`[data-testid="wind-all-run-${RUN}"]`)).not.toBeNull();
    expect($('[data-testid="wind-all-run-cfd_20260920T000000Z_other1"]')!.textContent).toContain("Demo B");
    act(() => { $<HTMLInputElement>('[data-testid="wind-dir-45"]')!.click(); });
    await click('[data-testid="wind-submit"]');
    await flush();
    const created = calls.find((call) => call.method === "createRun")!.args[0] as Record<string, unknown>;
    expect(created.origin).toEqual({ session_id: SESSION });
  });

  it("S7: picking model B without a session, then opening a session on model S, shows only S runs (no cross-model leak)", async () => {
    const runB = { ...ledger("ready", 2), run_id: "cfd_20260920T000000Z_bbbbbb", conversion_job_id: OTHER_JOB };
    const runS = ledger("ready", 2);
    const listRuns = vi.fn(async (id?: string | null) => id === OTHER_JOB
      ? ok({ items: [runB], count: 1, enabled: true, stale: false })
      : id === SOURCE.conversionJobId ? ok({ items: [runS], count: 1, enabled: true, stale: false })
      : ok({ items: [runB, runS], count: 2, enabled: true, stale: false }));
    const getRun = vi.fn(async (runId: string) => ok({ ledger: runId === runB.run_id ? runB : runS, status: { ...statusDoc("ready", 2), run_id: runId } }));
    let resolveSource: (value: WindSource) => void = () => {};
    const loadSource = vi.fn(() => new Promise<WindSource>((resolve) => { resolveSource = resolve; }));
    const { client, calls } = makeClient({ listRuns, getRun });
    // The overlay click below needs a stage-binding port that answers (a bare vi.fn() resolves undefined → unhandled rejection).
    const apply = vi.fn(async (): Promise<StageBindingResultMessage> => ({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "binding_rev_s7", applied_secondary_layers: [] }));
    const render = (sessionId: string) => act(() => root.render(<WindEnvironmentPanel sessionId={sessionId} ready client={client} loadSource={loadSource} applyStageBinding={apply} pollIntervalMs={5} />));
    render("");
    await flush();
    const select = $<HTMLSelectElement>('[data-testid="wind-model-select"]')!;
    await act(async () => { select.value = OTHER_JOB; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush(10);
    expect($(`[data-testid="wind-run-select"] option[value="${runB.run_id}"]`)).not.toBeNull();

    // Session opens on model S; while its source resolves the picked model must not be reloaded.
    render(SESSION);
    await flush(4);
    expect(listRuns.mock.calls.filter((call) => call[0] === OTHER_JOB)).toHaveLength(1);
    await act(async () => { resolveSource(SOURCE); });
    await flush(12);
    expect($<HTMLSelectElement>('[data-testid="wind-model-select"]')!.value).toBe(SOURCE.conversionJobId);
    const options = Array.from(box.querySelectorAll<HTMLOptionElement>('[data-testid="wind-run-select"] option')).map((option) => option.value);
    expect(options).toEqual([runS.run_id]);
    expect($('[data-testid="wind-run-status"]')!.getAttribute("data-status")).toBe("ready");
    // The overlay request, if any, can only target S's run on this session.
    await click('[data-testid="wind-overlay-on-0"]');
    await flush();
    const registered = calls.filter((call) => call.method === "registerOverlay").map((call) => call.args[1]);
    expect(registered).toEqual([runS.run_id]);
  });

  it("S7: closing the session keeps the model's runs visible and unlocks the picker on the same model", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const { client } = makeClient({ listRuns });
    const render = (sessionId: string) => act(() => root.render(<WindEnvironmentPanel sessionId={sessionId} ready={Boolean(sessionId)} client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    render(SESSION);
    await flush(10);
    expect($<HTMLSelectElement>('[data-testid="wind-model-select"]')!.disabled).toBe(true);
    render("");
    await flush(10);
    const select = $<HTMLSelectElement>('[data-testid="wind-model-select"]')!;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe(SOURCE.conversionJobId);
    expect($(`[data-testid="wind-run-select"] option[value="${RUN}"]`)).not.toBeNull();
    expect($('[data-testid="wind-run-status"]')!.getAttribute("data-status")).toBe("ready");
    expect($<HTMLButtonElement>('[data-testid="wind-overlay-on-0"]')!.disabled).toBe(true);
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(false);
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
    let modelListCalls = 0;
    const listRuns = vi.fn(async (id?: string | null) => (id && modelListCalls++ > 0)
      ? ok({ items: [ledger("queued", 0)], count: 1, enabled: true, stale: false })
      : ok({ items: [], count: 0, enabled: true, stale: false }));
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
    // S5b: a direction that needed the automatic endTime extension says so; the failed one does not.
    expect($('[data-testid="wind-extended-0"]')!.textContent).toContain("1200");
    expect($('[data-testid="wind-extended-22.5"]')).toBeNull();
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

  it("opacity slider: disabled until Kit confirms the overlay, one Kit command per release aimed at the pedestrian plane, readback shown, reset on overlay change", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const { client } = makeClient({ listRuns });
    const apply = vi.fn(async (artifacts: StageBindingSelection[]): Promise<StageBindingResultMessage> => ({
      protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "binding_rev_9",
      applied_secondary_layers: artifacts.filter((item) => item.role === "secondary").map((item) => item.artifact_id),
    }));
    const sendOverlayStyle = vi.fn();
    const commands = fakeViewerCommandPort({ overlay_style: sendOverlayStyle });
    const invalidateOverlayStyle = vi.fn();
    // Stable callbacks: a new loadSource identity would re-run the source effect and clear the result between renders.
    const loadSource = async () => SOURCE;
    const render = (overlayStyleState: OverlayStyleState) => act(() => root.render(
      <WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={loadSource} applyStageBinding={apply} pollIntervalMs={5}
        commands={commands} overlayStyleState={overlayStyleState} invalidateOverlayStyle={invalidateOverlayStyle} />));
    render({ status: "idle" });
    await flush(10);
    const slider = () => $<HTMLInputElement>('[data-testid="wind-opacity-slider"]')!;
    const statusText = () => $('[data-testid="wind-opacity-status"]')!.textContent ?? "";
    expect(slider().disabled).toBe(true);
    expect(slider().value).toBe("0.6");
    expect(statusText()).toContain("先顯示一個方向的疊圖");

    await click('[data-testid="wind-overlay-on-0"]');
    await flush(10);
    expect(invalidateOverlayStyle).toHaveBeenCalledTimes(1);
    expect(slider().disabled).toBe(false);
    // Focus in/out without moving the slider sends nothing.
    await act(async () => { slider().dispatchEvent(new Event("blur", { bubbles: true })); slider().dispatchEvent(new Event("pointerup", { bubbles: true })); });
    expect(sendOverlayStyle).not.toHaveBeenCalled();
    // Dragging only moves the local value; the Kit command goes out on release.
    await act(async () => {
      const input = slider();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "0.25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect($('[data-testid="wind-opacity-value"]')!.textContent).toBe("0.25");
    expect(sendOverlayStyle).not.toHaveBeenCalled();
    await act(async () => { slider().dispatchEvent(new Event("pointerup", { bubbles: true })); });
    expect(sendOverlayStyle).toHaveBeenCalledTimes(1);
    expect(sendOverlayStyle).toHaveBeenCalledWith({ primPath: `/World/Overlays/Cfd/${RUN}_w000/PedestrianWind_1p5m`, displayOpacity: 0.25 });

    render({ status: "pending" });
    expect(slider().disabled).toBe(true);
    expect(statusText()).toContain("等待 Kit 套用透明度");
    render({ status: "applied", clientRequestId: "c1", requestId: "r1", primPath: `/World/Overlays/Cfd/${RUN}_w000/PedestrianWind_1p5m`, displayOpacity: 0.3 });
    expect(slider().disabled).toBe(false);
    expect(statusText()).toContain("Kit 已套用透明度 0.30");
    // Releasing again without a new drag sends nothing new; a real change does.
    await act(async () => { slider().dispatchEvent(new Event("pointerup", { bubbles: true })); });
    expect(sendOverlayStyle).toHaveBeenCalledTimes(1);
    await act(async () => {
      const input = slider();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0.5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(sendOverlayStyle).toHaveBeenCalledTimes(2);
    expect(sendOverlayStyle).toHaveBeenLastCalledWith({ primPath: `/World/Overlays/Cfd/${RUN}_w000/PedestrianWind_1p5m`, displayOpacity: 0.5 });
    render({ status: "error", reason: "rejected" });
    expect(statusText()).toContain("透明度未套用");

    // Hiding the overlay invalidates the confirmed style and disables the slider again.
    await click('[data-testid="wind-overlay-off-0"]');
    await flush(6);
    expect(invalidateOverlayStyle).toHaveBeenCalledTimes(2);
    expect(slider().disabled).toBe(true);
  });

  it("without a command port the slider is not rendered at all", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const { client } = makeClient({ listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(10);
    expect($('[data-testid="wind-result"]')).not.toBeNull();
    expect($('[data-testid="wind-opacity"]')).toBeNull();
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

const FINDING: CfdFinding = { wind_from_degrees: 0, threshold_u_m_s: 3.4, u_max_m_s: 3.58, severity: "medium", issue_id: "iss_test_0001", issue_kind: "annotation", model_version_id: "version_cfd_test", validation_level: "screening", created_at: "2026-09-22T12:00:00Z" };
const setInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("WindEnvironmentPanel A1 finding (S6)", () => {
  it("opens issues for exceeding directions through the coordinator with the session model_version_id, then lists the ledger findings", async () => {
    let findingsRecorded = false;
    const listRuns = vi.fn(async () => ok({ items: [findingsRecorded ? { ...ledger("ready", 2), findings: [FINDING] } : ledger("ready", 2)], count: 1, enabled: true, stale: false }));
    const { client, calls } = makeClient({ listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(10);
    const button = $<HTMLButtonElement>('[data-testid="wind-finding-create"]')!;
    expect(button.disabled).toBe(false);
    expect($('[data-testid="wind-finding-list"]')).toBeNull();
    await act(async () => { setInput($<HTMLInputElement>('[data-testid="wind-finding-threshold"]')!, "3.4"); });
    findingsRecorded = true;
    await click('[data-testid="wind-finding-create"]');
    await flush(10);
    const call = calls.find((item) => item.method === "createFindings")!;
    expect(call.args[0]).toBe(RUN);
    expect(call.args[1]).toEqual({ threshold_u_m_s: 3.4, model_version_id: "version_cfd_test" });
    expect($('[data-testid="wind-finding-result"]')!.textContent).toContain("新開 1 筆 issue");
    expect($('[data-testid="wind-finding-result"]')!.textContent).toContain("screening");
    expect($('[data-testid="wind-finding-iss_test_0001"]')!.textContent).toContain("3.58 m/s > 3.4 m/s");
    // Nothing is opened from the browser directly: no governance call, only the coordinator route.
    expect(calls.map((item) => item.method)).not.toContain("createIssue");
  });

  it("without a session the finding request carries model_version_id null, and an out-of-range threshold disables the button", async () => {
    const listRuns = vi.fn(async (id?: string | null) => id ? ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false }) : ok({ items: [], count: 0, enabled: true, stale: false }));
    const { client, calls } = makeClient({ listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId="" ready={false} client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush();
    const select = $<HTMLSelectElement>('[data-testid="wind-model-select"]')!;
    await act(async () => { select.value = SOURCE.conversionJobId; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush(10);
    await act(async () => { setInput($<HTMLInputElement>('[data-testid="wind-finding-threshold"]')!, "99"); });
    expect($<HTMLButtonElement>('[data-testid="wind-finding-create"]')!.disabled).toBe(true);
    await act(async () => { setInput($<HTMLInputElement>('[data-testid="wind-finding-threshold"]')!, "5"); });
    await click('[data-testid="wind-finding-create"]');
    await flush(10);
    const call = calls.find((item) => item.method === "createFindings")!;
    expect(call.args[1]).toEqual({ threshold_u_m_s: 5, model_version_id: null });
  });

  it("a coordinator failure is shown and nothing is claimed as opened", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const createFindings = async () => fail<never>(502, "governance_unavailable", "governance /api/issues HTTP 500");
    const { client } = makeClient({ listRuns, createFindings });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush(10);
    await click('[data-testid="wind-finding-create"]');
    await flush();
    expect($('[data-testid="wind-finding-error"]')!.textContent).toContain("governance_unavailable");
    expect($('[data-testid="wind-finding-result"]')).toBeNull();
  });
});

describe("WindEnvironmentPanel legend (S3.1)", () => {
  it("renders the fixed |U| 0–5 m/s scale and the building pressure range of the result", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const { client } = makeClient({ listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(10);
    const u = $('[data-testid="wind-legend-u"]')!;
    expect(u.textContent).toContain("0.0");
    expect(u.textContent).toContain("5.0");
    expect(u.textContent).toContain("m/s");
    const p = $('[data-testid="wind-legend-p"]')!;
    expect(p.textContent).toContain("-17.6");
    expect(p.textContent).toContain("11.8");
    expect(p.textContent).toContain("Pa");
    expect($('[data-testid="wind-legend"]')!.textContent).toContain("示意動畫");
  });
});

// ── S8 settings phase A2 ─────────────────────────────────────────────────────────────────────────────
const field = (key: string) => $<HTMLInputElement & HTMLSelectElement>(`[data-testid="wind-setting-${key}"]`);
const setSelect = async (element: HTMLSelectElement, value: string) => {
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
};
const tick = async (ms = 5) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); await flush(); };
function estimateWith(limits: Partial<CfdEstimate["limits"]>): CfdEstimate {
  return { ...ESTIMATE, limits: { ...ESTIMATE.limits, ...limits } };
}

describe("WindEnvironmentPanel run settings (S8)", () => {
  it("builds the form from cfd-options/v1 only: sections, defaults and bounds; U_ref above the contract maximum is refused", async () => {
    const { client, calls } = makeClient();
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush(10);
    expect(calls.filter((call) => call.method === "getOptions")).toHaveLength(1);
    expect($('[data-testid="wind-settings"]')).not.toBeNull();
    expect($<HTMLSelectElement>('[data-testid="wind-preset"]')!.value).toBe("standard");
    const uref = field("wind.uref_m_s")!;
    expect(uref.value).toBe("5");
    expect(uref.max).toBe(String(OPTIONS.fields.find((item) => item.key === "wind.uref_m_s")!.maximum));
    expect(field("wind.zref_m")!.value).toBe("10");
    expect(field("wind.z0_m")!.value).toBe("0.5");
    expect(field("wind.true_north_source")!.value).toBe("geo_reference");
    expect(field("wind.true_north_degrees_manual")).toBeNull();
    expect($('[data-testid="wind-settings-advanced"] [data-testid="wind-setting-solver.end_time"]')).not.toBeNull();
    expect(field("solver.end_time")!.value).toBe("600");
    expect($<HTMLInputElement>('[data-testid="wind-setting-mesh.background_cell_m-auto"]')!.checked).toBe(true);
    expect(field("mesh.background_cell_m")!.disabled).toBe(true);

    await act(async () => { setInput(uref, "41"); });
    expect($('[data-testid="wind-setting-wind.uref_m_s-error"]')!.textContent).toContain("不超過 40");
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(true);
    await act(async () => { setInput(uref, "40"); });
    expect($('[data-testid="wind-setting-wind.uref_m_s-error"]')).toBeNull();
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(false);
  });

  it("a changed field makes the preset custom with an honest note; the standard preset restores it; submit and estimate carry the settings", async () => {
    const { client, calls } = makeClient();
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush(10);
    await act(async () => { setInput(field("wind.zref_m")!, "12"); });
    expect($<HTMLSelectElement>('[data-testid="wind-preset"]')!.value).toBe("custom");
    expect($('[data-testid="wind-settings-custom"]')!.textContent).toContain("不屬於已驗證的預設組");
    await setSelect($<HTMLSelectElement>('[data-testid="wind-preset"]')!, "standard");
    expect(field("wind.zref_m")!.value).toBe("10");
    expect($('[data-testid="wind-settings-custom"]')).toBeNull();

    await setSelect(field("wind.true_north_source")!, "manual");
    const angle = field("wind.true_north_degrees_manual")!;
    // The angle is what the manual source needs: an enabled input without "automatic", required until entered.
    expect(angle.disabled).toBe(false);
    expect($('[data-testid="wind-setting-wind.true_north_degrees_manual-auto"]')).toBeNull();
    expect($('[data-testid="wind-setting-wind.true_north_degrees_manual-error"]')!.textContent).toBe("必填");
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(true);
    await act(async () => { setInput(angle, "-12.5"); });
    expect($('[data-testid="wind-setting-wind.true_north_degrees_manual-error"]')).toBeNull();
    await act(async () => { $<HTMLInputElement>('[data-testid="wind-setting-mesh.background_cell_m-auto"]')!.click(); });
    // No estimate yet (500 ms debounce): unticking starts from the coarsest allowed cell, never the finest.
    expect(field("mesh.background_cell_m")!.disabled).toBe(false);
    expect(field("mesh.background_cell_m")!.value).toBe(String(OPTIONS.fields.find((item) => item.key === "mesh.background_cell_m")!.maximum));
    await act(async () => { setInput(field("mesh.background_cell_m")!, "3"); });
    await act(async () => { setInput(field("solver.end_time")!, "900"); });
    await click('[data-testid="wind-submit"]');
    await flush(10);
    const created = calls.find((call) => call.method === "createRun")!.args[0] as Record<string, Record<string, unknown>>;
    expect(created.wind).toEqual({ wind_from_degrees: [0], uref_m_s: 5, zref_m: 10, z0_m: 0.5, true_north_source: "manual", true_north_degrees_manual: -12.5 });
    expect(created.mesh).toEqual({ background_cell_m: 3, surface_refinement_level: 2, region_refinement_level: 1 });
    expect(created.solver).toEqual({ end_time: 900 });
    expect(created.preprocess).toEqual({ profile: "exterior-wind/v1", voxel_pitch_m: 0.5, closing_radius_voxels: 4, leak_fraction_limit: 0.15 });
    const estimateCalls = calls.filter((call) => call.method === "estimate");
    const estimated = estimateCalls[estimateCalls.length - 1].args[0] as Record<string, unknown>;
    expect(estimated.schema).toBe("cfd-estimate-request/v1");
    expect(estimated.wind).toEqual(created.wind);
    expect(estimated.mesh).toEqual(created.mesh);
    expect($('[data-testid="wind-directions"] legend')!.textContent).toContain("真北");
  });

  it("shows the estimate as an estimate with its basis, and an unavailable estimate with its reason", async () => {
    const estimate = vi.fn(async () => ok(ESTIMATE));
    const { client } = makeClient({ estimate });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} estimateDebounceMs={0} />));
    await flush(10);
    await tick();
    const view = $('[data-testid="wind-estimate"]')!;
    expect(view.getAttribute("data-state")).toBe("available");
    expect(view.textContent).toContain("估算值，不是實測");
    expect($('[data-testid="wind-estimate-total"]')!.textContent).toContain("M 格");
    expect($('[data-testid="wind-estimate-basis"]')!.textContent).toContain("外殼");
    expect($('[data-testid="wind-estimate-cells"]')!.textContent).toContain(`背景格 ${ESTIMATE.background_cell_m} m（自動）`);
    expect($(`[data-testid="wind-estimate-dir-${ESTIMATE.directions[0].wind_from_degrees}"]`)).not.toBeNull();

    // Unticking "automatic" starts from the automatic cell this model's estimate reported.
    await act(async () => { $<HTMLInputElement>('[data-testid="wind-setting-mesh.background_cell_m-auto"]')!.click(); });
    expect(field("mesh.background_cell_m")!.value).toBe(String(ESTIMATE.background_cell_m));
    await act(async () => { $<HTMLInputElement>('[data-testid="wind-setting-mesh.background_cell_m-auto"]')!.click(); });
    await tick();

    estimate.mockResolvedValue(ok(ESTIMATE_UNAVAILABLE));
    act(() => { $<HTMLInputElement>('[data-testid="wind-dir-90"]')!.click(); });
    await tick();
    expect($('[data-testid="wind-estimate"]')!.getAttribute("data-state")).toBe("unavailable");
    expect($('[data-testid="wind-estimate"]')!.textContent).toContain("無法估算");
  });

  it("an estimate of other settings is not shown as current, and a confirmation raised for them lapses", async () => {
    const estimate = vi.fn(async () => ok(estimateWith({ confirm_required: true, confirm_reasons: ["total_hours"] })));
    const { client, calls } = makeClient({ estimate });
    // A debounce longer than the test: the only estimate is the one submitting asks for.
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} estimateDebounceMs={60_000} />));
    await flush(10);
    expect($('[data-testid="wind-estimate"]')).toBeNull();
    await click('[data-testid="wind-submit"]');
    await flush(6);
    expect($('[data-testid="wind-estimate"]')!.getAttribute("data-state")).toBe("available");
    expect($('[data-testid="wind-confirm"]')!.textContent).toContain("總耗時偏長");
    await act(async () => { setInput(field("wind.zref_m")!, "12"); });
    expect($('[data-testid="wind-estimate"]')!.getAttribute("data-state")).toBe("loading");
    expect($('[data-testid="wind-confirm"]')).toBeNull();
    expect(calls.some((call) => call.method === "createRun")).toBe(false);
  });

  it("above the confirmation threshold the first submit asks once; the hard cap blocks submitting", async () => {
    const estimate = vi.fn(async () => ok(estimateWith({ confirm_required: true, confirm_reasons: ["total_hours"] })));
    const { client, calls } = makeClient({ estimate });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} estimateDebounceMs={0} />));
    await flush(10);
    await tick();
    expect($('[data-testid="wind-estimate-confirm"]')!.textContent).toContain("總耗時偏長");
    await click('[data-testid="wind-submit"]');
    await flush(6);
    expect(calls.some((call) => call.method === "createRun")).toBe(false);
    expect($('[data-testid="wind-confirm"]')!.getAttribute("data-kind")).toBe("threshold");
    await click('[data-testid="wind-confirm-cancel"]');
    expect($('[data-testid="wind-confirm"]')).toBeNull();
    await click('[data-testid="wind-submit"]');
    await flush(6);
    await click('[data-testid="wind-confirm-submit"]');
    await flush(10);
    expect(calls.filter((call) => call.method === "createRun")).toHaveLength(1);

    estimate.mockResolvedValue(ok(estimateWith({ exceeds_hard_cap: true })));
    act(() => { $<HTMLInputElement>('[data-testid="wind-dir-90"]')!.click(); });
    await tick();
    expect($('[data-testid="wind-estimate-cap"]')!.textContent).toContain("算力上限");
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(true);
  });

  it("run details show the recorded settings; 'submit again with these settings' loads them and asks once", async () => {
    const origin = { session_id: SESSION, wind_from_degrees: [22.5, 0], uref_m_s: 7, end_time: 900, n_procs: null, background_cell_m: 4,
      zref_m: 12, z0_m: 0.3, true_north_source: "manual" as const, true_north_degrees_manual: -12.5, preset_match: null };
    const listRuns = async () => ok({ items: [{ ...ledger("ready", 2), origin }], count: 1, enabled: true, stale: false });
    // The detail poll returns the same ledger record, so the recorded origin survives the refresh.
    const getRun = async () => ok({ ledger: { ...ledger("ready", 2), origin }, status: statusDoc("ready", 2) });
    const { client, calls } = makeClient({ listRuns, getRun });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(12);
    const text = $('[data-testid="wind-run-settings-text"]')!.textContent ?? "";
    expect(text).toContain("真北 手動 -12.5°");
    expect(text).toContain("背景格 4 m");
    expect(text).toContain("未對應到預設組");
    await click('[data-testid="wind-resubmit"]');
    await flush(6);
    expect(field("wind.uref_m_s")!.value).toBe("7");
    expect(field("wind.zref_m")!.value).toBe("12");
    expect(field("wind.true_north_degrees_manual")!.value).toBe("-12.5");
    expect($<HTMLInputElement>('[data-testid="wind-dir-22.5"]')!.checked).toBe(true);
    expect($('[data-testid="wind-confirm"]')!.getAttribute("data-kind")).toBe("resubmit");
    expect(calls.some((call) => call.method === "createRun")).toBe(false);
    await click('[data-testid="wind-confirm-submit"]');
    await flush(10);
    const created = calls.find((call) => call.method === "createRun")!.args[0] as Record<string, Record<string, unknown>>;
    expect(created.wind).toEqual({ wind_from_degrees: [0, 22.5], uref_m_s: 7, zref_m: 12, z0_m: 0.3, true_north_source: "manual", true_north_degrees_manual: -12.5 });
    expect(created.mesh.background_cell_m).toBe(4);
    expect(created.solver).toEqual({ end_time: 900 });
  });

  it("accepting a resubmission does not accept the cost: above the threshold it still asks, with the reasons", async () => {
    const origin = { session_id: SESSION, wind_from_degrees: [0, 90], uref_m_s: 5, end_time: 600, n_procs: null, background_cell_m: null,
      zref_m: 10, z0_m: 0.5, true_north_source: "geo_reference" as const, true_north_degrees_manual: null, preset_match: "standard" };
    const listRuns = async () => ok({ items: [{ ...ledger("ready", 2), origin }], count: 1, enabled: true, stale: false });
    const getRun = async () => ok({ ledger: { ...ledger("ready", 2), origin }, status: statusDoc("ready", 2) });
    const estimate = vi.fn(async () => ok(estimateWith({ confirm_required: true, confirm_reasons: ["cells_per_direction"] })));
    const { client, calls } = makeClient({ listRuns, getRun, estimate });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(12);
    await click('[data-testid="wind-resubmit"]');
    await flush(6);
    expect($('[data-testid="wind-confirm"]')!.getAttribute("data-kind")).toBe("resubmit");
    await click('[data-testid="wind-confirm-submit"]');
    await flush(10);
    expect(calls.some((call) => call.method === "createRun")).toBe(false);
    expect($('[data-testid="wind-confirm"]')!.getAttribute("data-kind")).toBe("threshold");
    expect($('[data-testid="wind-confirm"]')!.textContent).toContain("單一風向格數偏多");
    await click('[data-testid="wind-confirm-submit"]');
    await flush(10);
    expect(calls.filter((call) => call.method === "createRun")).toHaveLength(1);
  });

  it("a run submitted before S8 says its terrain settings were not recorded and resubmits them as the standard values", async () => {
    const origin = { session_id: null, wind_from_degrees: [0], uref_m_s: 5, end_time: null, n_procs: null, background_cell_m: null };
    const listRuns = async () => ok({ items: [{ ...ledger("ready", 2), origin }], count: 1, enabled: true, stale: false });
    const getRun = async () => ok({ ledger: { ...ledger("ready", 2), origin }, status: statusDoc("ready", 2) });
    const { client } = makeClient({ listRuns, getRun });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} applyStageBinding={vi.fn()} pollIntervalMs={5} />));
    await flush(12);
    expect($('[data-testid="wind-run-settings-text"]')!.textContent).toContain("S8 以前送出");
    await act(async () => { setInput(field("wind.zref_m")!, "30"); });
    await click('[data-testid="wind-resubmit"]');
    await flush(6);
    expect(field("wind.zref_m")!.value).toBe("10");
    expect($<HTMLSelectElement>('[data-testid="wind-preset"]')!.value).toBe("standard");
  });

  it("the finding answer lists every direction with its reason", async () => {
    const listRuns = async () => ok({ items: [ledger("ready", 2)], count: 1, enabled: true, stale: false });
    const { client } = makeClient({ listRuns });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush(10);
    await click('[data-testid="wind-finding-create"]');
    await flush(10);
    expect($('[data-testid="wind-finding-eval-0"]')!.textContent).toContain("已開 iss_test_0001");
    expect($('[data-testid="wind-finding-eval-22.5"]')!.textContent).toContain("方向未完成");
  });

  it("without options the form is not invented: the failure is shown and submitting stays disabled", async () => {
    const { client } = makeClient({ getOptions: async () => fail<CfdOptionsDocument>(502, "cfd_upstream_unavailable", "streaming CFD job service unreachable") });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush(10);
    expect($('[data-testid="wind-options-error"]')!.textContent).toContain("cfd_upstream_unavailable");
    expect($('[data-testid="wind-settings"]')).toBeNull();
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(true);
  });

  it("after an options failure the user can retry without reloading the page", async () => {
    let attempts = 0;
    const getOptions = async () => (++attempts === 1 ? fail<CfdOptionsDocument>(502, "cfd_upstream_unavailable", "streaming CFD job service unreachable") : ok(OPTIONS));
    const { client } = makeClient({ getOptions });
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush(10);
    expect($('[data-testid="wind-options-error"]')).not.toBeNull();
    await click('[data-testid="wind-options-retry"]');
    await flush(10);
    expect(attempts).toBe(2);
    expect($('[data-testid="wind-options-error"]')).toBeNull();
    expect($('[data-testid="wind-settings"]')).not.toBeNull();
    expect($<HTMLButtonElement>('[data-testid="wind-submit"]')!.disabled).toBe(false);
  });

  it("fieldset legends opt out of the global reboot legend rule (float, ~24px), so they stay captions at panel size", async () => {
    const { client } = makeClient();
    act(() => root.render(<WindEnvironmentPanel sessionId={SESSION} ready client={client} loadSource={async () => SOURCE} pollIntervalMs={5} />));
    await flush(10);
    for (const selector of ['[data-testid="wind-directions"] > legend', '[data-testid="wind-settings-general"] > legend']) {
      const style = $(selector)!.getAttribute("style") ?? "";
      expect(style).toContain("float: none");
      expect(style).toContain("width: auto"); // the reboot's width: 100% would cut the bordered fieldset's top border
      expect(style).toContain("font-size: inherit");
    }
  });
});
