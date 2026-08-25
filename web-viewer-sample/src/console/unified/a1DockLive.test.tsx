// UnifiedConsole A1Dock live 增強區塊（C3 slice 1）：/health probe 成功才掛
// A1DockLive（真 API、data-prov="asbuilt"）；離線完全不渲染新 DOM（fixture 殼
// 像素零變化鐵則）。測試模式比照 dockLiveLink.test.tsx：createRoot + act +
// 釘 hash（prevHash 還原）+ microtask flush。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { coordinatorClient, type CoordinatorHealth } from "../coordinatorClient";
import { governanceClient } from "../governanceClient";
import type { FilesTreeResponse, RuleRunHistoryItem, RuleRunStatus } from "../governanceClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

const HEALTH: CoordinatorHealth = { status: "ok", service: "bim-review-coordinator", kit_signaling_port: 49100 };

const historyItem = (id: string, status: RuleRunStatus["status"]): RuleRunHistoryItem => ({
  rule_run_id: id,
  status,
  score: 88,
  rule_set: "default",
  model_version_id: null,
  summary: null,
  started_at: "2026-07-20T10:00:00+08:00",
  finished_at: null,
});

const filesTree: FilesTreeResponse = {
  root: "C:/Repos/active/iot/AI-BIM-governance/storage",
  source_kind: "local_fs",
  projects: [{
    project_id: "270",
    models: [{
      model_id: "建築",
      versions: [{ name: "model.ifc", path: "[server-path]", size_bytes: 123, mtime: "2026-07-06T00:00:00+08:00" }],
    }],
  }],
};

const succeededRun: RuleRunStatus = {
  rule_run_id: "rr_live",
  status: "succeeded",
  score: 92,
  rule_set: "default",
  model_version_id: null,
  summary: { total: 8, passed: 7, failed: 1, errored: 0, target_summary: {}, warnings: [] },
};

describe("A1Dock live 增強區塊（health probe 後接真 API）", () => {
  let container: HTMLDivElement;
  let prevHash: string;

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
    coordinatorStatusStore.reset();
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.location.hash = prevHash;
  });

  async function mountAt(hash: string) {
    window.location.hash = hash;
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    return root;
  }

  it("(a) 離線（fetch 失敗 stub）：fixture dock 照常渲染，無 a1dock-live（像素零變化鐵則）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed (offline)")));
    const root = await mountAt("#a1");
    expect(container.querySelector('[data-uc="dock-cta"]')).not.toBeNull(); // fixture CTA 仍在
    expect(container.querySelector('[data-testid="a1dock-live"]')).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it("(b) health 成功：live 區塊出現（data-prov=asbuilt）、近期 rule-runs 真資料渲染", async () => {
    spyCoordinatorEndpointsOffline(); // 殼層共用 poller：十端點釘 503，不打真網路
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
    const listSpy = vi.spyOn(governanceClient, "listRuleRuns").mockResolvedValue({
      filters: {}, limit: 5, offset: 0, total: 2,
      items: [historyItem("rr_001", "succeeded"), historyItem("rr_002", "failed")],
    });
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(filesTree);

    const root = await mountAt("#a1");

    const live = container.querySelector('[data-testid="a1dock-live"]');
    expect(live).not.toBeNull();
    expect(live!.getAttribute("data-prov")).toBe("asbuilt"); // R3：live 資料誠實標 asbuilt
    expect(listSpy).toHaveBeenCalledWith({ limit: 5 });
    const history = container.querySelector('[data-testid="a1dock-live-history"]');
    expect(history).not.toBeNull();
    expect(history!.textContent).toContain("rr_001");
    expect(history!.textContent).toContain("rr_002");
    // unified-console-runtime-truth（5.2）：不再凍結 fixture 區塊（A1_Tower_v12.ifc／data-prov="fixture" 根）；
    // 「liveBackend 時 fixture 互動由真值與真頁導向取代」的正向斷言隨 slice 2（tasks §2.2／§3.1）落地。
    expect(container.querySelector('[data-uc="dock-cta"]')).not.toBeNull();
    await act(async () => { root.unmount(); });
  });

  it("(b2) health 成功但 governance 清單失敗：誠實顯錯，不偽造資料", async () => {
    spyCoordinatorEndpointsOffline();
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
    vi.spyOn(governanceClient, "listRuleRuns").mockRejectedValue(new Error("governance proxy /api/governance/rule-runs -> 502"));
    vi.spyOn(governanceClient, "filesTree").mockRejectedValue(new Error("governance proxy /api/governance/files/tree -> 502"));

    const root = await mountAt("#a1");
    const err = container.querySelector('[data-testid="a1dock-live-history-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("502");
    expect(container.querySelector('[data-testid="a1dock-live-tree-error"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="a1dock-live-history"]')).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it("(c) 選檔 → 執行 → useRuleRun for-library 真跑 → 結果摘要出現、近期清單 refresh", async () => {
    spyCoordinatorEndpointsOffline();
    vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
    const listSpy = vi.spyOn(governanceClient, "listRuleRuns").mockResolvedValue({
      filters: {}, limit: 5, offset: 0, total: 1, items: [historyItem("rr_001", "succeeded")],
    });
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(filesTree);
    const createSpy = vi.spyOn(governanceClient, "createRuleRunForLibrary").mockResolvedValue({ rule_run_id: "rr_live", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(succeededRun);
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "guid-9", usd_prim_path: null, rule_code: "fire-rating", severity: "error", status: "fail", message: "missing FireRating" },
    ]);

    const root = await mountAt("#a1");
    const listCallsBeforeRun = listSpy.mock.calls.length;

    // 選 library 檔案（value=邏輯三段鍵）→ PICK_FILE。
    const select = container.querySelector<HTMLSelectElement>('[data-testid="a1dock-live-select"]')!;
    expect(select).not.toBeNull();
    await act(async () => {
      select.value = "270/建築/model.ifc";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const runBtn = container.querySelector<HTMLElement>('[data-testid="a1dock-live-run"]')!;
    expect(runBtn.getAttribute("aria-disabled")).toBe("false");
    await act(async () => { runBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }

    // for-library 邏輯三段（coordinator server-side 解析真路徑；不送遮蔽字面）。
    expect(createSpy).toHaveBeenCalledWith({ project_id: "270", model_id: "建築", version_name: "model.ifc" });
    const summary = container.querySelector('[data-testid="a1dock-live-summary"]');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toContain("rr_live");
    expect(summary!.textContent).toContain("succeeded");
    expect(summary!.textContent).toContain("fire-rating");
    // 終態證據 → 近期清單 refresh（listRuleRuns 再打一次）。
    expect(listSpy.mock.calls.length).toBeGreaterThan(listCallsBeforeRun);
    await act(async () => { root.unmount(); });
  });
});
