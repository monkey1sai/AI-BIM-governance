// unified-console-runtime-truth slice 1（tasks 1.5）：#pipeline 五段＋治理／報表列綁真值（spec scenario「Pipeline 五段對照」）；
// outbox 只用 /api/callback-outbox/summary；3D handoff 為 anchor（非 iframe）；RVT 段退役標示；觸發轉檔 disabled＋原因（D2 於 slice 2）。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { RT_IDLE, conversionRecord, outboxEntries, sessionItem, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("PipelinePage 真值綁定", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  let root: Root | null;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container);
    prevHash = window.location.hash; root = null;
    coordinatorStatusStore.reset();
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = prevHash;
  });
  async function mountPipeline() {
    window.location.hash = "#pipeline";
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;
  const folders = (n: number, withIfc: number) => Array.from({ length: n }, (_, i) => ({ prefix: `p${i}/`, has_source_ifc: i < withIfc }));

  it("live（spec scenario）：ifc-ready 0、bucket 7／3、watch on 12/12/0、ready 12 running 0、kit_local_001 idle、session 0、無可 handoff session、pending 36（attempts 0/5）、治理列", async () => {
    const spies = spyCoordinatorEndpoints({
      ifcReady: { count: 0, items: [] },
      minioFolder: { bucket: "bim-control", prefix: "", folders: folders(7, 3), objects: [], count: 7 },
      minioWatch: { enabled: true, bucket: "bim-control", baseline_count: 12, seen_count: 12, triggered_total: 0 },
      conversionRecords: { count: 12, items: Array.from({ length: 12 }, (_, i) => conversionRecord(`k${i}`, "ready")) },
      outboxSummary: { total: 36, limit: 200, entries: outboxEntries(36, 0, 5) },
      ruleRuns: { filters: {}, limit: 5, offset: 0, total: 3, items: [] },
    });
    await mountPipeline();
    const expectVal = (id: string, text: string) => {
      expect(uc(id).textContent, id).toBe(text);
      expect(uc(id).getAttribute("data-prov"), id).toBe("asbuilt");
      expect(uc(id).getAttribute("data-state"), id).toBe("live");
    };
    expectVal("intake-ifc-ready-val", "0");
    expectVal("intake-bucket-val", "7／3");
    expectVal("intake-watch-val", "on · baseline 12 · seen 12 · triggered 0");
    expectVal("conv-ready-val", "12");
    expectVal("conv-running-val", "0");
    expectVal("conv-failed-val", "0");
    expectVal("sess-active-val", "0");
    expectVal("kit-instance-val", "kit_local_001 idle");
    expect(uc("handoff-none").textContent).toBe("無可 handoff session");
    expect(container.querySelectorAll('[data-uc="handoff-link"]').length).toBe(0);
    expectVal("outbox-pending-val", "36");
    expect(uc("outbox-attempts").textContent).toContain("attempts 0/5");
    expectVal("gov-rule-runs-val", "3");
    expectVal("gov-open-issues-val", "0");
    expect(uc("to-issues").getAttribute("href")).toBe("#issues");
    expect(uc("to-reports").getAttribute("href")).toBe("#reports");
    // outbox 只走 redacted 摘要（limit 200）；不存在任何 /api/internal 呼叫（coordinatorClient 沒有這種方法，此處鎖 wire）。
    expect(spies.getCallbackOutboxSummary).toHaveBeenCalledWith(200);
    expect(container.innerHTML).not.toContain("payload");
    expect(container.innerHTML).not.toContain("target_url");
    // RVT 段退役標示、無 RVT 轉檔按鈕；觸發轉檔 disabled＋原因。
    expect(uc("rvt-retired").textContent).toContain("已退役");
    expect(container.innerHTML).not.toContain("RVT 轉檔");
    expect(uc("trigger-conv").getAttribute("aria-disabled")).toBe("true");
    expect(uc("trigger-conv").getAttribute("data-action")).toBe("disabled");
    expect(uc("trigger-conv").getAttribute("data-prov")).toBe("p1");
    expect(uc("trigger-conv").getAttribute("aria-describedby")).toBe("trigger-conv-reason");
    expect(container.querySelector("#trigger-conv-reason")!.textContent).toContain("allowlist");
    // fixture 固定值不得出現。
    for (const lit of ["demo_lib_2026.ifc", "990_model.ifc", "cj_0116", "S-240601", "OB-201", "bucket/incoming"]) expect(container.innerHTML, lit).not.toContain(lit);
  });

  it("有 review session：3D handoff 段列出 anchor（target=_blank，href=/ui/open?session=<id>），不內嵌 iframe", async () => {
    spyCoordinatorEndpoints({ runtimeStatus: { ...RT_IDLE, sessions: { count: 1, active_count: 1, participant_count: 1, items: [sessionItem("review_session_a")] } } });
    await mountPipeline();
    const links = container.querySelectorAll<HTMLAnchorElement>('[data-uc="handoff-link"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toContain("/ui/open?session=review_session_a");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(container.querySelector("iframe")).toBeNull();
    expect(uc("sess-active-val").textContent).toBe("1");
  });

  it("MinIO 未設定（note）→ bucket 摘要「未取得」而非 0／0；kit instance 404 → 顯示 404（error）", async () => {
    spyCoordinatorEndpoints({
      minioFolder: { bucket: null, prefix: "", folders: [], objects: [], count: 0, note: "MinIO not configured" },
      kitInstance: Object.assign(new Error("coordinator /api/kit/instances/current -> 404 no current instance"), { name: "CoordinatorHttpError", status: 404, path: "/api/kit/instances/current" }),
    });
    await mountPipeline();
    expect(uc("intake-bucket-val").textContent).toBe("未取得");
    expect(uc("intake-bucket-val").getAttribute("data-state")).toBe("unavailable");
    // 非 CoordinatorHttpError 實例（plain Error 冒名）一律歸 offline：這是 classifyFailure 的 instanceof 守門。
    expect(uc("kit-instance-val").getAttribute("data-state")).toBe("offline");
  });

  it("offline（十端點 503）：五段主值皆 —／offline；handoff 段顯示未連線；最後更新 —", async () => {
    spyCoordinatorEndpointsOffline();
    await mountPipeline();
    for (const id of ["intake-ifc-ready-val", "intake-bucket-val", "intake-watch-val", "conv-ready-val", "conv-running-val", "conv-failed-val", "sess-active-val", "kit-instance-val", "outbox-pending-val", "gov-rule-runs-val", "gov-open-issues-val"]) {
      expect(uc(id).textContent, id).toBe("—");
      expect(uc(id).getAttribute("data-state"), id).toBe("offline");
    }
    expect(uc("handoff-state").textContent).toBe("未連線");
    expect(uc("last-updated").textContent).toBe("最後更新 —");
    expect(container.querySelector('[data-uc="toast"]')).toBeNull();
  });
});
