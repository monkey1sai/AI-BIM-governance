import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GroundAssessmentPanel, type GroundAssessmentPanelProps } from "./GroundAssessmentPanel";
import type { GroundAssessmentReport, GroundVersion } from "./groundSurfaceClient";

const preview = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../tests/contracts/fixtures/ground-selection-preview-v1.json"), "utf8"));
const saved: GroundVersion = { ...preview, schema: "ground-selection-version/v1", selection_confirmed_by_user: true,
  confirmation: { principal: "reviewer", session_id: "review_session_test", binding_revision_id: "confirmed" } };
const report = (): GroundAssessmentReport => ({ schema: "cfd-ground-service-assessment/v1", status: "HELD", authority: "source_bound_metadata_only",
  selection_id: saved.selection_id, selection_sha256: saved.selection_sha256, model_usdc_sha256: saved.model_usdc_sha256,
  conversion_job_id: saved.conversion_job_id, source_run_id: "cfd_test000001", wind_from_degrees: 0, direction_tag: "w000",
  checks: { fresh_source_verified: true, fresh_faces_verified: true, selection_ledger_verified: true,
    run_record_link: "verified", case_metadata_link: "verified", exclusions_link: "verified" },
  metadata_sha256: { run_status: "1".repeat(64), result: "2".repeat(64), run_record: "3".repeat(64), case_metadata: "4".repeat(64), exclusions: "5".repeat(64) },
  selected_source_faces: saved.faces.map(face => ({ face_id: face.face_id, geometry_sha256: face.geometry_sha256 })),
  selected_surface_z_range_m: [.63, .63], relative_target_z_range_m: [2.13, 2.13], old_plane_minus_relative_target_range_m: [-.63, -.63],
  case_declared: { ground_z_m: 0, sampling_plane_z_m: 1.5, pedestrian_height_m: 1.5, domain_zmin_m: 0, uref_m_s: 5, zref_m: 10, z0_m: .5,
    model_to_solver: { kind: "rotation_about_z", alpha_rad: Math.PI / 2, wind_vector_model_xy: [0, -1] } },
  excluded_selected_guids: [], reasons: ["actual_ground_not_verified", "fluid_region_not_verified"],
  actual_ground_verified: false, inlet_boundary_files_checked: false, fluid_region_verified: false, velocity_sampled: false, solver_started: false });
let root: Root, box: HTMLDivElement, props: GroundAssessmentPanelProps, assessment: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
  assessment = vi.fn(async () => report());
  props = { sessionId: "review_session_test", sourceKey: "modelA", ready: true, saved,
    client: { catalog: vi.fn(), preview: vi.fn(), confirm: vi.fn(), saved: vi.fn(), samplePositions: vi.fn(), assessment } };
});
afterEach(() => { act(() => root.unmount()); box.remove(); });
const render = async () => act(async () => root.render(<GroundAssessmentPanel {...props} />));
const button = () => box.querySelector('[data-testid="ground-assessment-submit"]') as HTMLButtonElement;
const click = async () => act(async () => button().click());
const input = async (name: string, value: string) => act(async () => {
  const field = box.querySelector(`[data-testid="ground-assessment-${name}"]`) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const text = () => box.querySelector('[data-testid="ground-assessment-report"]')?.textContent ?? "";

describe("ground engineering preparation UI", () => {
  it("requires saved version and valid existing run/direction; reports HELD with fixed layout", async () => {
    await render(); expect(button().disabled).toBe(true);
    await input("run", "cfd_test000001"); await click();
    expect(assessment).toHaveBeenCalledWith("review_session_test", saved.selection_id, { source_run_id: "cfd_test000001", wind_from_degrees: 0 });
    expect(text()).toContain("工程驗證待完成（HELD）"); expect(text()).toContain("2.130000");
    expect(text()).toContain("未讀取風速"); expect(text()).not.toContain("工程通過");
    expect((box.querySelector('[data-testid="ground-assessment-report"]') as HTMLElement).style.height).toBe("260px");
    expect((box.querySelector('[data-testid="ground-assessment-status"]') as HTMLElement).style.height).toBe("64px");
    await input("wind", "360"); expect(button().disabled).toBe(true); expect(text()).not.toContain("2.130000");
    await input("wind", ""); expect(button().disabled).toBe(true);
    props.saved = null; await render(); expect(button().disabled).toBe(true);
  });
  it("clears old report on a new request, rejects service errors, and permits manual retry", async () => {
    await render(); await input("run", "cfd_test000001"); await click();
    assessment.mockRejectedValueOnce(new Error("ground_upstream_rejected")); await click();
    expect(text()).not.toContain("2.130000"); expect(box.textContent).toContain("來源核對未完成");
    expect(box.textContent).not.toContain("ground_upstream_rejected"); expect(button().disabled).toBe(false);
    await click(); expect(text()).toContain("2.130000");
  });
  it("renders missing legacy links as unknown without inventing elevations", async () => {
    const result = report(); result.checks.case_metadata_link = "unknown"; result.checks.run_record_link = "unknown";
    result.metadata_sha256.case_metadata = null; result.metadata_sha256.run_record = null;
    result.case_declared.sampling_plane_z_m = null; result.old_plane_minus_relative_target_range_m = null;
    assessment.mockResolvedValue(result); await render(); await input("run", "cfd_test000001"); await click();
    expect(text()).toContain("未知（歷史連結不足）"); expect(text()).toContain("舊取樣平面 Z：未知");
    expect(text()).toContain("工程驗證待完成");
  });
  it.each(["source", "session", "version", "ready", "unmount", "input"])("never revives a pending report after %s changes", async mode => {
    let resolve!: (value: GroundAssessmentReport) => void;
    assessment.mockImplementation(() => new Promise<GroundAssessmentReport>(done => { resolve = done; }));
    await render(); await input("run", "cfd_test000001"); await click(); await click(); expect(assessment).toHaveBeenCalledTimes(1);
    if (mode === "source") { props.sourceKey = "modelB"; await render(); }
    if (mode === "session") { props.sessionId = "review_session_other"; await render(); }
    if (mode === "version") { props.saved = { ...saved, selection_id: "ground_" + "b".repeat(64) }; await render(); }
    if (mode === "ready") { props.ready = false; await render(); props.ready = true; await render(); }
    if (mode === "unmount") await act(async () => root.render(null));
    if (mode === "input") await input("wind", "90");
    await act(async () => resolve(report())); expect(text()).not.toContain("2.130000");
  });
  it.each(["model", "run", "wind", "version", "physical", "ledger", "pair"])("rejects an inconsistent %s reply", async mode => {
    const result = report();
    if (mode === "model") result.model_usdc_sha256 = "b".repeat(64);
    if (mode === "run") result.source_run_id += "_other";
    if (mode === "wind") result.wind_from_degrees = 90;
    if (mode === "version") result.selection_sha256 = "c".repeat(64);
    if (mode === "physical") (result as unknown as Record<string, unknown>).actual_ground_verified = true;
    if (mode === "ledger") (result.checks as unknown as Record<string, unknown>).selection_ledger_verified = false;
    if (mode === "pair") result.selected_surface_z_range_m = [] as unknown as [number, number];
    assessment.mockResolvedValue(result); await render(); await input("run", "cfd_test000001"); await click();
    expect(text()).not.toContain("2.130000"); expect(box.textContent).toContain("未採用此報告");
  });
});
