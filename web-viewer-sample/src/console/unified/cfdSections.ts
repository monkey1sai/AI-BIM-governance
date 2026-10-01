import type { CfdRunDirectionResult } from "./cfdClient";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import type { CameraState } from "../../viewerCommandChannel/camera";
import type { OverlayVisibilityReadback } from "../../viewerCommandChannel/overlayControls";
import type { SectionInput, SectionReadback } from "../../viewerCommandChannel/sectionPlane";
import { cfdOverlayPrimPathForArtifact } from "../../viewerCommandChannel/overlayStyle";
import { presentationPrims } from "./OverlayPresentationControls";

export type CfdSection = NonNullable<CfdRunDirectionResult["presentation"]>["sections"][number];
export interface SectionStep { name: string; status: "pending" | "applied" | "error"; detail?: string }
type Before = { camera: CameraState; clip: SectionReadback; visibility: OverlayVisibilityReadback["items"] };
const suppressed = new Set(["plane", "vectors", "streamlines", "streamline_growth", "particles", "surface_pressure", "near_wall_speed", "section", "section_vectors"]);

function restorableClip(clip: SectionReadback): SectionInput {
  if (!clip.enabled) return { enabled: false, axis: "z", position: 0, direction: 1 };
  if (!clip.owned || clip.planes.length !== 1) throw new Error("目前裁切由其他操作持有，請先關閉該裁切。");
  const plane = clip.planes[0], index = plane.slice(0, 3).findIndex(v => Math.abs(v) === 1);
  if (index < 0 || plane.slice(0, 3).some((v, i) => i !== index && v !== 0)) throw new Error("目前裁切不是可還原的軸向剖面。");
  return { enabled: true, axis: "xyz"[index] as SectionInput["axis"], direction: plane[index] as 1 | -1, position: -plane[3] / plane[index] };
}

/** A declared, ACK-gated sequence, scoped to one applied overlay binding. No commands survive invalidation. */
export class CfdSectionSession {
  private before: Before | null = null;
  private valid = true;
  private running = false;
  constructor(private readonly commands: ViewerCommandPort, private readonly artifactId: string,
    private readonly direction: CfdRunDirectionResult, private readonly notify: (step: SectionStep) => void) {}
  get active(): boolean { return this.before !== null; }
  get isValid(): boolean { return this.valid; }
  invalidate(): void { this.valid = false; this.before = null; }
  private assertValid(): void { if (!this.valid) throw new Error("疊圖或連線已變更；舊剖面操作已取消。"); }
  private async step<T>(name: string, work: () => Promise<T>): Promise<T> {
    this.assertValid(); this.notify({ name, status: "pending" });
    try {
      const value = await work(); this.assertValid(); this.notify({ name, status: "applied" }); return value;
    } catch (error) {
      if (this.valid) this.notify({ name, status: "error", detail: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  private async visibility(items: Array<{ primPath: string; visible?: boolean }>, writing = false): Promise<OverlayVisibilityReadback["items"]> {
    const seen: OverlayVisibilityReadback["items"] = [];
    for (let i = 0; i < items.length; i += 32) {
      this.assertValid();
      const batch = items.slice(i, i + 32), reply = await this.commands.send("overlay_visibility", { items: batch });
      this.assertValid();
      if (reply.status !== "applied" || !reply.items || reply.items.length !== batch.length
        || reply.items.some(actual => !batch.some(item => item.primPath === actual.primPath)
          || !actual.present || (writing && actual.visible !== batch.find(item => item.primPath === actual.primPath)?.visible))) {
        throw new Error("圖層缺漏或 Kit 讀回未符合操作。");
      }
      seen.push(...reply.items);
    }
    return seen;
  }
  async enter(section: CfdSection): Promise<void> {
    if (this.running) throw new Error("剖面操作仍在進行。");
    this.running = true;
    try {
      this.assertValid();
      const declared = this.direction.presentation?.sections.find(s => s.id === section.id);
      if (!declared || declared.axis !== section.axis || declared.position_m !== section.position_m || declared.polygons === 0) throw new Error("此結果沒有可顯示的剖面取樣。");
      const paths = presentationPrims(this.direction).filter(p => suppressed.has(p.role)).map(p => ({ ...p,
        path: cfdOverlayPrimPathForArtifact(this.artifactId, p.name) }));
      const selected = paths.find(p => p.name === `Section_${section.id}`), vectors = paths.find(p => p.name === `Section_${section.id}_Vectors`);
      if (!selected?.path || !vectors?.path || paths.some(p => !p.path)) throw new Error("剖面或向量圖層未宣告，不能套用。");
      if (!this.before) {
        const before = await this.step("讀取原視角、裁切與圖層", async () => {
          const camera = await this.commands.send("camera_state", null); this.assertValid();
          if (camera.status !== "applied" || !camera.camera) throw new Error("無法取得原相機狀態。");
          const clip = await this.commands.send("section_plane", { action: "read" }); this.assertValid();
          if (clip.status !== "applied" || !clip.readback) throw new Error("無法取得原裁切狀態。");
          restorableClip(clip.readback);
          const visibility = await this.visibility(paths.map(p => ({ primPath: p.path! })));
          return { camera: camera.camera, clip: clip.readback, visibility };
        });
        this.before = before;
      }
      await this.step("1 圖層", () => this.visibility(paths.map(p => ({ primPath: p.path!, visible: p.name === selected.name || p.name === vectors.name })), true));
      await this.step("2 裁切", async () => {
        // RTX retains n·p+d >= 0. These presets look from +axis; keep the sampled plane behind the cut.
        const input: SectionInput = { enabled: true, axis: section.axis, position: section.position_m + .05, direction: -1 };
        const reply = await this.commands.send("section_plane", input);
        if (reply.status !== "applied" || !reply.effective || reply.effective.axis !== input.axis || reply.effective.direction !== input.direction
          || Math.abs(reply.effective.position - input.position) > 1e-5) throw new Error("裁切未獲 Kit 確認。");
      });
      await this.step("3 正視角", async () => {
        const view = { x: "right", y: "back", z: "top" } as const;
        const reply = await this.commands.send("camera_view", { action: "preset", view: view[section.axis], scope: "building" });
        if (reply.status !== "applied") throw new Error("正視角未獲 Kit 確認。");
      });
      await this.step("4 正交投影", async () => {
        const reply = await this.commands.send("camera_view", { action: "projection", projection: "orthographic" });
        if (reply.status !== "applied" || reply.camera?.projection !== "orthographic") throw new Error("正交投影未獲 Kit 確認。");
      });
    } finally { this.running = false; }
  }
  async leave(): Promise<void> {
    if (this.running) throw new Error("剖面操作仍在進行。");
    const before = this.before;
    if (!before) return;
    this.running = true;
    const failures: string[] = [];
    try {
      for (const [name, work] of [
        ["還原裁切", async () => { const input = restorableClip(before.clip), reply = await this.commands.send("section_plane", input);
          if (input.enabled ? reply.status !== "applied" : reply.status !== "off") throw new Error("裁切還原未確認。"); }],
        ["還原相機", async () => { const reply = await this.commands.send("camera_view", { action: "restore", camera: before.camera });
          if (reply.status !== "applied") throw new Error("相機還原未確認。"); }],
        ["還原圖層", async () => { await this.visibility(before.visibility.map(i => ({ primPath: i.primPath, visible: i.visible })), true); }],
      ] as const) {
        try { await this.step(name, work); } catch (error) { this.assertValid(); failures.push(String(error)); }
      }
      if (failures.length) throw new Error(failures.join("；"));
      this.before = null;
    } finally { this.running = false; }
  }
}
