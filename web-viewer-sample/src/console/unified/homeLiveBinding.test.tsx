// unified-console-runtime-truth slice 1（tasks 1.4）：#home 四 KPI＋六 svc-dot 綁真值；live／offline／unavailable／error 四態；
// KPI 卡為 data-action="nav"；fixture 固定值不得出現。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorHttpError } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { RT_IDLE, conversionRecord, outboxEntries, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("HomePage 真值綁定", () => {
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
  async function mountHome() {
    window.location.hash = "#home";
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;
  const FIXTURE_LITERALS = ["990_model.ifc", "62%", "S-240601", "rule-run #88", "2026-07-14", "OB-201", "editor lease 1"];

  it("live（spec scenario「Home KPI 與 API 對照」）：0／0／0／36，皆 asbuilt＋live；attempts 0/5；svc-dot ×6；無 fixture 固定值", async () => {
    spyCoordinatorEndpoints({
      runtimeStatus: { ...RT_IDLE, sessions: { count: 0, active_count: 0, participant_count: 0, items: [] } },
      conversionRecords: { count: 12, items: Array.from({ length: 12 }, (_, i) => conversionRecord(`k${i}`, "ready")) },
      issues: { issues: [] },
      outboxSummary: { total: 36, limit: 200, entries: outboxEntries(36, 0, 5) },
      minioWatch: { enabled: true, bucket: "bim-control", baseline_count: 12, seen_count: 12, triggered_total: 0 },
    });
    await mountHome();
    for (const [id, text] of [["kpi-conv-val", "0"], ["kpi-sess-val", "0"], ["kpi-issue-val", "0"], ["kpi-outbox-val", "36"]] as const) {
      expect(uc(id).textContent, id).toBe(text);
      expect(uc(id).getAttribute("data-prov"), id).toBe("asbuilt");
      expect(uc(id).getAttribute("data-state"), id).toBe("live");
    }
    expect(uc("kpi-conv-sub").textContent).toBe("ready 12 · failed 0");
    expect(uc("kpi-outbox-sub").textContent).toBe("attempts 0/5");
    expect(container.querySelectorAll('[data-uc="svc-dot"]').length).toBe(6);
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="ok"]').length).toBe(4); // coordinator／governance／kit-manager／MinIO watch
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="unknown"]').length).toBe(2); // conversion authority／Kit signaling：無探測端點
    expect(uc("last-updated").textContent).toMatch(/最後更新 \d{2}:\d{2}:\d{2}/);
    for (const lit of FIXTURE_LITERALS) expect(container.innerHTML, lit).not.toContain(lit);
  });

  it("offline（十端點 503；spec scenario「後端不可達時誠實未連線」）：KPI 皆 —／offline／未連線；最後更新 —；svc-dot 全 unknown", async () => {
    spyCoordinatorEndpointsOffline();
    await mountHome();
    for (const id of ["kpi-conv", "kpi-sess", "kpi-issue", "kpi-outbox"]) {
      expect(uc(id + "-val").textContent, id).toBe("—");
      expect(uc(id + "-val").getAttribute("data-state"), id).toBe("offline");
      expect(uc(id + "-sub").textContent, id).toBe("未連線");
    }
    expect(uc("last-updated").textContent).toBe("最後更新 —");
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="unknown"]').length).toBe(6);
    expect(container.innerHTML).not.toContain('data-state="live"');
  });

  it("unavailable：conversion records 回傳窗截斷（count > items.length）→「未取得」，不對子集算數", async () => {
    spyCoordinatorEndpoints({ conversionRecords: { count: 101, items: Array.from({ length: 100 }, (_, i) => conversionRecord(`k${i}`, "ready")) } });
    await mountHome();
    expect(uc("kpi-conv-val").textContent).toBe("未取得");
    expect(uc("kpi-conv-val").getAttribute("data-state")).toBe("unavailable");
  });

  it("error：governance issues 500 → KPI 顯示狀態碼 500＋後端訊息，不顯示 0", async () => {
    spyCoordinatorEndpoints({ issues: new CoordinatorHttpError("/api/governance/issues", 500, "governance_unreachable") });
    await mountHome();
    expect(uc("kpi-issue-val").textContent).toBe("500");
    expect(uc("kpi-issue-val").getAttribute("data-state")).toBe("error");
    expect(uc("kpi-issue-sub").textContent).toContain("governance_unreachable");
  });

  it("KPI 卡為 data-action=nav：點「活躍 Sessions」導向 #sessions", async () => {
    spyCoordinatorEndpoints();
    await mountHome();
    expect(uc("kpi-sess").getAttribute("data-action")).toBe("nav");
    await act(async () => { uc("kpi-sess").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toBe("#sessions");
  });

  // 更正：舊註解宣稱「design §4：#home 四 KPI 快捷一律導向 #conv／#sessions／#issues／#minio
  // （#minio 為 outbox 卡的指定真頁）」。逐字查證設計正本
  // `docs/plans/AI-BIM 前後端設計文件.dc.html` 後確認**不存在**任何 KPI 卡導向規則：§03 僅有
  // 元件樹一行 `KpiRow · PipelineSnapshot · AlertFeed · AppLauncher`，§04 是 API 契約段。
  // 正本真正逐字寫到 `#minio` 的地方是 §03 舊路由收斂表，指定其收斂去向為 `#/pipeline`。
  // 且 outbox 明細（GET /api/callback-outbox/summary）只在 unified `#pipeline` 的
  // ⑤ Callback Outbox 段，legacy `#minio`（ModelDataPage）沒有該面 → 舊落點屬接錯。
  it("KPI 卡為 data-action=nav：點「Outbox 待送」導向 unified #pipeline 的 ⑤ Callback Outbox 段", async () => {
    spyCoordinatorEndpoints();
    await mountHome();
    expect(uc("kpi-outbox").getAttribute("data-action")).toBe("nav");
    await act(async () => { uc("kpi-outbox").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toBe("#pipeline");
  });
});
