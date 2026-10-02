import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroundSurfacePanel } from "./GroundSurfacePanel";
import type { GroundCatalog, GroundPreview, GroundSurfaceClient, GroundVersion } from "./groundSurfaceClient";
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
    confirm: vi.fn(async () => saved), saved: vi.fn(async () => saved) };
  binding = vi.fn(async (): Promise<StageBindingResultMessage> => ({ protocol: "vg01", type: "stage_binding_result",
    status: "applied", revision_id: "binding_rev_test", applied_secondary_layers: [preview.artifact_id] }));
});
afterEach(() => { act(() => root.unmount()); box.remove(); });
const render = async (session = "review_session_test", selectedPaths = [catalog.component_path], sourceKey = "sourceA", ready = true) => {
  await act(async () => root.render(<GroundSurfacePanel sessionId={session} sourceKey={sourceKey} ready={ready} selectedPaths={selectedPaths} client={client} applyStageBinding={binding} />));
};
const button = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
const click = async (id: string) => { await act(async () => button(id).click()); };
const choose = async () => { await click("ground-catalog-load"); await act(async () => (box.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); };

describe("authored ground face selection semantics", () => {
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
