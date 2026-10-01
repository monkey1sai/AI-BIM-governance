import { describe, expect, it } from "vitest";
import { CfdSectionSession, type CfdSection, type SectionStep } from "./cfdSections";
import { requestedSectionDrafts } from "./CfdSectionSampling";
import type { CfdRunDirectionResult } from "./cfdClient";
import type { CameraState } from "../../viewerCommandChannel/camera";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";

const section: CfdSection = { id: "z25", axis: "z", position_m: 5, label: "Z 0.25H", source: "standard", polygons: 2 };
const before: CameraState = { projection: "perspective", position: [30, -40, 25], direction: [0, 1, 0], up: [0, 0, 1],
  targetDistance: 40, centerOfInterest: [0, 0, -40], fovDeg: 60, orthoHeight: null };

function harness(count = 1, rejectClip = false, rejectSecondVisibilityBatch = false) {
  const sections = Array.from({ length: count }, (_, i) => i ? { ...section, id: `custom_${i}` } : section);
  const prims = [{ name: "PedestrianWind_1p5m", role: "plane", default_visible: true, quantity: "U" },
    { name: "StreamlineGrowth", role: "streamline_growth", default_visible: false, quantity: "U" },
    { name: "PedestrianVectors", role: "vectors", default_visible: true, quantity: "U" },
    { name: "Streamlines", role: "streamlines", default_visible: false, quantity: "U" },
    { name: "Particles", role: "particles", default_visible: false, quantity: "U" },
    { name: "BuildingSurfacePressure", role: "surface_pressure", default_visible: false, quantity: "p" },
    { name: "NearWallSpeed", role: "near_wall_speed", default_visible: false, quantity: "U" },
    ...sections.flatMap(s => [{ name: `Section_${s.id}`, role: "section", default_visible: false, quantity: "U" },
      { name: `Section_${s.id}_Vectors`, role: "section_vectors", default_visible: false, quantity: "U" }])];
  const direction = { presentation: { version: 2, prims, sections } } as unknown as CfdRunDirectionResult;
  const seen = new Map(prims.map(p => [`/World/Overlays/Cfd/run_w000/${p.name}`, p.default_visible]));
  const original = new Map(seen), events: Array<{ name: string; input: unknown }> = [], steps: SectionStep[] = [];
  let camera = before;
  let visibilityWriteBatch = 0;
  const commands = fakeViewerCommandPort({
    camera_state: async () => { events.push({ name: "camera_state", input: null }); return { status: "applied", camera }; },
    camera_view: async input => { events.push({ name: "camera_view", input });
      camera = input.action === "restore" ? input.camera : input.action === "projection"
        ? { ...camera, projection: input.projection, fovDeg: null, orthoHeight: 25 } : camera;
      return { status: "applied", camera }; },
    section_plane: async input => { events.push({ name: "section_plane", input });
      if ("action" in input) return { status: "applied", readback: { enabled: false, owned: false, planes: [] } };
      return rejectClip && input.enabled ? { status: "error", reason: "rejected" }
        : input.enabled ? { status: "applied", effective: input } : { status: "off" }; },
    overlay_visibility: async input => { events.push({ name: "overlay_visibility", input });
      if (input.items.some(item => item.visible !== undefined) && ++visibilityWriteBatch === 2 && rejectSecondVisibilityBatch)
        return { status: "error", reason: "rejected" };
      return { status: "applied", items: input.items.map(item => {
        if (item.visible !== undefined) seen.set(item.primPath, item.visible);
        return { primPath: item.primPath, present: true, visible: seen.get(item.primPath) ?? false };
      }) }; },
  });
  return { commands, direction, seen, original, events, steps,
    session: new CfdSectionSession(commands, "cfd:run:w000", direction, step => steps.push(step)), camera: () => camera };
}

describe("CFD section ACK sequence and restoration", () => {
  it("uses actual initial state, applies four declared steps and restores the original camera/visibility", async () => {
    const h = harness(); await h.session.enter(section);
    expect(h.session.active).toBe(true);
    expect(h.events.map(e => e.name)).toEqual(["camera_state", "section_plane", "overlay_visibility", "overlay_visibility", "section_plane", "camera_view", "camera_view"]);
    expect(h.events[4].input).toEqual({ enabled: true, axis: "z", position: 5.05, direction: 1 });
    expect(h.events[5].input).toEqual({ action: "preset", view: "top", scope: "building" });
    expect(h.steps.filter(s => s.status === "applied").map(s => s.name)).toEqual(["讀取原視角、裁切與圖層", "1 圖層", "2 裁切", "3 正視角", "4 正交投影"]);
    expect(h.seen.get("/World/Overlays/Cfd/run_w000/PedestrianWind_1p5m")).toBe(false);
    expect(h.seen.get("/World/Overlays/Cfd/run_w000/Section_z25")).toBe(true);
    await h.session.leave();
    expect(h.camera()).toEqual(before); expect(h.seen).toEqual(h.original); expect(h.session.active).toBe(false);
  });
  it("stops on a partial failure and keeps an exit that restores changes already made", async () => {
    const h = harness(1, true);
    await expect(h.session.enter(section)).rejects.toThrow("裁切");
    expect(h.events.filter(e => e.name === "camera_view")).toHaveLength(0);
    expect(h.session.active).toBe(true);
    await h.session.leave(); expect(h.seen).toEqual(h.original);
  });
  it("batches a maximum-size presentation without exceeding the existing 32-item wire limit", async () => {
    const h = harness(13); await h.session.enter(section); await h.session.leave();
    const batches = h.events.filter(e => e.name === "overlay_visibility").map(e => (e.input as { items: unknown[] }).items.length);
    expect(batches).toEqual([32, 1, 32, 1, 32, 1]);
    expect(h.seen).toEqual(h.original);
  });
  it("restores the first visibility batch when the second batch is rejected", async () => {
    const h = harness(13, false, true);
    await expect(h.session.enter(section)).rejects.toThrow("圖層");
    expect(h.session.active).toBe(true);
    expect(h.seen).not.toEqual(h.original);
    expect(h.events.filter(e => e.name === "camera_view")).toHaveLength(0);
    await h.session.leave();
    expect(h.seen).toEqual(h.original); expect(h.session.active).toBe(false);
  });
  it("does not send a late continuation or restore into a new binding after invalidation", async () => {
    const h = harness();
    let release!: (value: { status: "unconfirmed" }) => void;
    const commands = fakeViewerCommandPort({ camera_state: () => new Promise(resolve => { release = resolve; }) });
    const session = new CfdSectionSession(commands, "cfd:run:w000", h.direction, step => h.steps.push(step));
    const pending = session.enter(section); session.invalidate(); release({ status: "unconfirmed" });
    await expect(pending).rejects.toThrow("變更"); expect(session.active).toBe(false);
    const stepCount = h.steps.length; await session.leave(); expect(h.steps).toHaveLength(stepCount);
  });
  it("refuses an active foreign clip before any mutation and never assumes layer defaults", async () => {
    const h = harness();
    const commands = fakeViewerCommandPort({
      camera_state: async () => ({ status: "applied", camera: before }),
      section_plane: async () => ({ status: "applied", readback: { enabled: true, owned: false, planes: [[1, 0, 0, -5]] } }),
      overlay_visibility: async input => { h.events.push({ name: "unexpected", input }); return { status: "error", reason: "unavailable" }; },
    });
    const session = new CfdSectionSession(commands, "cfd:run:w000", h.direction, () => {});
    await expect(session.enter(section)).rejects.toThrow("其他操作持有"); expect(h.events).toEqual([]); expect(session.active).toBe(false);
  });
  it("validates user model positions instead of silently treating an empty input as zero", () => {
    expect(requestedSectionDrafts([{ axis: "z", position: "" }])).toBeNull();
    expect(requestedSectionDrafts([{ axis: "x", position: "-7.25" }, { axis: "z", position: "3" }]))
      .toEqual([{ axis: "x", position_m: -7.25 }, { axis: "z", position_m: 3 }]);
  });
});
