import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroundSurfacePanel } from "./GroundSurfacePanel";
import type { GroundCatalog, GroundPreview, GroundSurfaceClient, GroundVersion, GroundSamplePlan } from "./groundSurfaceClient";
import type { StageBindingResultMessage } from "../../viewerCommandChannel/viewerEmbedProtocol";

const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../tests/contracts/fixtures/ground-selection-preview-v1.json"), "utf8"));
const preview = fixture as GroundPreview["preview"];
const catalog: GroundCatalog = { schema: "ground-face-catalog/v1", conversion_job_id: preview.conversion_job_id,
  model_usdc_sha256: preview.model_usdc_sha256, component_path: "/World/Elements/IfcSlab/G_0000000000000000000000",
  stage_meters_per_unit: 1, faces: preview.faces, rejected_faces: {}, rejected_meshes: [], inspected_faces: 1,
  complete: true, next_cursor: null, actual_ground_verified: false };
const registered: GroundPreview = { session_id: "review_session_test", primary_artifact_id: "artifact_model", preview };
const saved: GroundVersion = { ...preview, schema: "ground-selection-version/v1", selection_confirmed_by_user: true,
  confirmation: { principal: "reviewer", session_id: "review_session_test", binding_revision_id: "binding_rev_test" } };
let root: Root, box: HTMLDivElement, client: GroundSurfaceClient;
let binding: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
  client = { catalog: vi.fn(async () => catalog), preview: vi.fn(async () => registered),
    confirm: vi.fn(async () => saved), saved: vi.fn(async () => saved), samplePositions: vi.fn(async () => samplePlan), assessment: vi.fn() };
  binding = vi.fn(async (): Promise<StageBindingResultMessage> => ({ protocol: "vg01", type: "stage_binding_result",
    status: "applied", revision_id: "binding_rev_test", applied_secondary_layers: [preview.artifact_id] }));
});
afterEach(() => { act(() => root.unmount()); box.remove(); vi.useRealTimers(); });
const render = async (session = "review_session_test", selectedPaths = [catalog.component_path], sourceKey = "sourceA", ready = true, stageBindingPending = false) => {
  await act(async () => root.render(<GroundSurfacePanel sessionId={session} sourceKey={sourceKey} ready={ready} stageBindingPending={stageBindingPending} selectedPaths={selectedPaths} client={client} applyStageBinding={binding} />));
};
const button = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
const click = async (id: string) => { await act(async () => button(id).click()); };
const choose = async () => { await click("ground-catalog-load"); await act(async () => (box.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); };

const samplePlan: GroundSamplePlan = { schema: "cfd-ground-sample-points/v1", algorithm: "authored-triangle-vertical/v1", coordinate_frame: "model_world_Z_up_metres",
  model_usdc_sha256: preview.model_usdc_sha256, selection_id: preview.selection_id, selection_sha256: preview.selection_sha256, conversion_job_id: preview.conversion_job_id,
  bounds_m: [0, 0, 2, 2], spacing_m: 0.5, source_faces: [{ face_id: preview.faces[0].face_id, geometry_sha256: preview.faces[0].geometry_sha256 }],
  height_above_surface_m: 1.5, display_lift_m: 0, actual_ground_verified: false, fluid_region_verified: false, velocity_sampled: false,
  query_count: 25, generated_count: 3, rejected_by_reason: { uncovered: 10, precision_unsupported: 12 }, points: Array.from({ length: 25 }, (_, index) => {
    const x = index % 5 * 0.5, y = Math.floor(index / 5) * 0.5, base = { query_index: index, xy_m: [x, y] };
    if (x + y > 2) return { ...base, status: "uncovered" as const };
    if (x === 0 || y === 0 || x + y === 2) return { ...base, status: "precision_unsupported" as const };
    return { ...base, status: "point_generated" as const, face_id: preview.faces[0].face_id, ground_z_m: 0.63, target_m: [x, y, 2.13] };
  }) };

const inputValue = async (id: string, value: string) => act(async () => {
  const input = box.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("saved version relative position reports", () => {
  it("does not claim generated positions when every query is rejected", async () => {
    client.samplePositions = vi.fn(async () => ({ ...samplePlan, query_count: 1, generated_count: 0,
      rejected_by_reason: { uncovered: 1 }, points: [{ query_index: 0, xy_m: [10, 10], status: "uncovered" as const }] }));
    await render(); await inputValue("ground-version-id", saved.selection_id); await click("ground-version-load");
    for (let index = 0; index < 4; index++) await inputValue(`ground-sample-bound-${index}`, "10");
    await click("ground-sample-generate");
    expect(box.querySelector('[data-testid="ground-status"]')?.textContent).toContain("位置報告已完成");
    expect(box.querySelector('[data-testid="ground-status"]')?.textContent).not.toContain("已產生");
    expect(box.querySelector('[data-testid="ground-sample-report"]')?.textContent).toContain("請求 1；產生 0；拒絕 1");
    expect(binding).not.toHaveBeenCalled();
  });
  it("restores saved authority and clears results when grid or draft version changes", async () => {
    await render(); await inputValue("ground-version-id", saved.selection_id); await click("ground-version-load");
    expect(button("ground-sample-generate").disabled).toBe(false); await click("ground-sample-generate");
    expect(box.querySelector('[data-testid="ground-sample-report"]')?.textContent).toContain("2.130000");
    await inputValue("ground-sample-spacing", "1");
    expect(box.querySelector('[data-testid="ground-sample-report"]')?.textContent).not.toContain("2.130000");
    await click("ground-sample-generate"); await inputValue("ground-version-id", "ground_" + "0".repeat(64));
    expect(button("ground-sample-generate").disabled).toBe(true);
    expect(box.querySelector('[data-testid="ground-sample-report"]')?.textContent).not.toContain("2.130000");
  });
  it("requires saved readback, produces a bounded summary and does not load a Kit layer", async () => {
    await render(); await choose(); expect(button("ground-sample-generate").disabled).toBe(true);
    await click("ground-preview"); await click("ground-confirm"); expect(button("ground-sample-generate").disabled).toBe(false);
    const bindingCount = binding.mock.calls.length; await click("ground-sample-generate");
    expect(client.samplePositions).toHaveBeenCalledWith("review_session_test", saved.selection_id, { bounds_m: [0, 0, 2, 2], spacing_m: 0.5 });
    expect(box.querySelector('[data-testid="ground-sample-report"]')?.textContent).toContain("2.130000");
    expect(binding).toHaveBeenCalledTimes(bindingCount);
    expect((box.querySelector('[data-testid="ground-sample-report"]') as HTMLElement).style.height).toBe("180px");
  });
  it.each(["source", "readiness", "unmount"])("does not revive a sample reply after %s loss", async mode => {
    let resolve!: (value: GroundSamplePlan) => void;
    client.samplePositions = vi.fn(() => new Promise<GroundSamplePlan>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview"); await click("ground-confirm");
    await click("ground-sample-generate"); await click("ground-sample-generate"); expect(client.samplePositions).toHaveBeenCalledTimes(1);
    if (mode === "source") await render("review_session_test", [catalog.component_path], "other-source");
    if (mode === "readiness") { await render("review_session_test", [catalog.component_path], "sourceA", false); await render(); }
    if (mode === "unmount") await act(async () => root.render(null));
    await act(async () => resolve(samplePlan));
    expect(box.querySelector('[data-testid="ground-sample-report"]')?.textContent ?? "").not.toContain("2.130000");
  });
});

describe("authored ground face selection semantics", () => {
  it("waits for the command gate after exact ACK during its own stage reload", async () => {
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, true);
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "fresh", applied_secondary_layers: [preview.artifact_id] }));
    expect(button("ground-confirm").disabled).toBe(true);
    await render();
    expect(button("ground-confirm").disabled).toBe(false);
    await click("ground-confirm");
    expect(client.confirm).toHaveBeenCalledWith("review_session_test", preview.selection_id, "fresh");
    expect(client.preview).toHaveBeenCalledTimes(1); expect(binding).toHaveBeenCalledTimes(1);
  });
  it("accepts an exact ACK when the same-source gate already recovered", async () => {
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, true);
    await render();
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "fresh", applied_secondary_layers: [preview.artifact_id] }));
    expect(button("ground-confirm").disabled).toBe(false);
  });
  it("bounds the gate wait and never revives the ACK after timeout", async () => {
    vi.useFakeTimers();
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, true);
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "fresh", applied_secondary_layers: [preview.artifact_id] }));
    await act(async () => vi.advanceTimersByTime(5_001));
    await render();
    expect(button("ground-confirm").disabled).toBe(true);
    expect(box.textContent).toContain("模型載入核對未恢復");
    expect(client.preview).toHaveBeenCalledTimes(1); expect(binding).toHaveBeenCalledTimes(1);
    expect(client.confirm).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["sourceB", "sourceLeaseB"])("cancels gate waiting on primary or lease identity change: %s", async nextSource => {
    vi.useFakeTimers();
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, true);
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "fresh", applied_secondary_layers: [preview.artifact_id] }));
    await render("review_session_test", [catalog.component_path], nextSource);
    expect(button("ground-confirm").disabled).toBe(true);
    expect(box.textContent).toContain("已明選 0／100 面");
    expect(client.confirm).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not revive an ACK after a hard readiness loss while waiting", async () => {
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, true);
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "fresh", applied_secondary_layers: [preview.artifact_id] }));
    await render("review_session_test", [catalog.component_path], "sourceA", false, false);
    await render();
    expect(button("ground-confirm").disabled).toBe(true); expect(client.confirm).not.toHaveBeenCalled();
  });
  it("remembers a hard readiness loss even if ready recovers before ACK", async () => {
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, false);
    await render();
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "old", applied_secondary_layers: [preview.artifact_id] }));
    expect(button("ground-confirm").disabled).toBe(true); expect(client.confirm).not.toHaveBeenCalled();
  });
  it("cleans the bounded gate wait when the panel unmounts", async () => {
    vi.useFakeTimers();
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, true);
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "fresh", applied_secondary_layers: [preview.artifact_id] }));
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0); expect(client.confirm).not.toHaveBeenCalled();
  });
  it("rejects a partial layer ACK immediately instead of waiting for ready", async () => {
    vi.useFakeTimers();
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false, true);
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "partial", applied_secondary_layers: [] }));
    await render();
    expect(button("ground-confirm").disabled).toBe(true);
    expect(box.textContent).toContain("exact_layer_readback_missing"); expect(vi.getTimerCount()).toBe(0);
  });
  it("separates candidate, exact preview, saved version and actual ground verification", async () => {
    await render(); await choose();
    expect(button("ground-confirm").disabled).toBe(true);
    await click("ground-preview"); expect(button("ground-confirm").disabled).toBe(false);
    await click("ground-confirm");
    expect(client.confirm).toHaveBeenCalledWith("review_session_test", preview.selection_id, "binding_rev_test");
    expect(client.saved).toHaveBeenCalledWith("review_session_test", preview.selection_id);
    expect(box.querySelector('[data-testid="ground-saved-version"]')!.textContent).toContain("地面未核對");
    expect(box.querySelector('[data-testid="ground-status"]')!.getAttribute("style")).toContain("height: 96px");
  });
  it.each([undefined, [], ["unrelated"]])("does not allow saving with incomplete layer readback: %j", async layers => {
    binding.mockResolvedValue({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "binding_rev_test", applied_secondary_layers: layers });
    await render(); await choose(); await click("ground-preview");
    expect(button("ground-confirm").disabled).toBe(true); expect(client.confirm).not.toHaveBeenCalled();
  });
  it("ignores a late preview response after switching session", async () => {
    let resolve!: (value: GroundPreview) => void;
    client.preview = vi.fn(() => new Promise<GroundPreview>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview"); await render("review_session_other");
    await act(async () => resolve(registered));
    expect(binding).not.toHaveBeenCalled(); expect(button("ground-confirm").disabled).toBe(true);
  });
  it("blocks repeated requests and keeps a new session operation busy when the old request completes", async () => {
    const resolves: ((value: GroundCatalog) => void)[] = [];
    client.catalog = vi.fn(() => new Promise<GroundCatalog>(done => { resolves.push(done); }));
    await render();
    await act(async () => { button("ground-catalog-load").click(); button("ground-catalog-load").click(); });
    expect(client.catalog).toHaveBeenCalledTimes(1);
    await render("review_session_other"); await click("ground-catalog-load");
    expect(client.catalog).toHaveBeenCalledTimes(2);
    await act(async () => resolves[0](catalog));
    expect(button("ground-catalog-load").disabled).toBe(true);
    expect(box.querySelector('[data-testid="ground-candidates"]')!.textContent).not.toContain("原面 0");
    await act(async () => resolves[1](catalog));
    expect(button("ground-catalog-load").disabled).toBe(false);
  });
  it("keeps an explicitly selected face across a component scope change", async () => {
    await render(); await choose(); await render("review_session_test", ["/World/Elements/IfcSlab/G_other"]);
    expect(box.textContent).toContain("已明選 1／100 面");
    await click("ground-preview"); expect(client.preview).toHaveBeenCalledWith("review_session_test", "行人參考區域", preview.model_usdc_sha256, preview.faces);
  });
  it("clears old preview and saved state when the primary source changes within the same session", async () => {
    await render(); await choose(); await click("ground-preview"); await click("ground-confirm");
    expect(button("ground-preview-clear").disabled).toBe(false);
    binding.mockClear();
    await render("review_session_test", [catalog.component_path], "sourceB");
    await click("ground-preview-clear");
    expect(binding).not.toHaveBeenCalled();
    expect(button("ground-confirm").disabled).toBe(true);
    expect(box.textContent).toContain("已明選 0／100 面");
    expect(box.querySelector('[data-testid="ground-saved-version"]')!.textContent).toContain("尚未保存");
  });
  it("ignores late Kit ACK after a same-session source change or loss of ready state", async () => {
    let resolve!: (value: StageBindingResultMessage) => void;
    binding.mockImplementation(() => new Promise<StageBindingResultMessage>(done => { resolve = done; }));
    await render(); await choose(); await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceA", false);
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "old", applied_secondary_layers: [preview.artifact_id] }));
    await render();
    expect(button("ground-confirm").disabled).toBe(true);
    await click("ground-preview");
    await render("review_session_test", [catalog.component_path], "sourceB");
    await act(async () => resolve({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "old", applied_secondary_layers: [preview.artifact_id] }));
    expect(button("ground-confirm").disabled).toBe(true);
    expect(button("ground-preview-clear").disabled).toBe(true);
  });
  it("does not claim removal unless Kit reports no secondary layers", async () => {
    await render(); await choose(); await click("ground-preview"); await click("ground-preview-clear");
    expect(box.querySelector('[data-testid="ground-status"]')!.textContent).toContain("移除預覽未確認");
    binding.mockResolvedValue({ protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "binding_rev_clear", applied_secondary_layers: [] });
    await click("ground-preview-clear");
    expect(box.querySelector('[data-testid="ground-status"]')!.textContent).toContain("預覽已移除");
    expect(button("ground-confirm").disabled).toBe(true);
  });
});
