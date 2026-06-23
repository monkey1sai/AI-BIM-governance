// VG-01 Task 3：A1 工作台嵌入 EmbeddedViewer + 3D 高亮接線（IX-A1-06 四條件）測試。
// 用 createRoot + act + vi.spyOn 慣例（與 console.test.tsx / EmbeddedViewer.test.tsx 一致；
// 本 repo 未安裝 @testing-library/react，不為單一 task 引入新測試依賴）。
// EmbeddedViewer 以 vi.mock 換成捕捉 props 的 stub，模擬 viewer 回報 first_frame / highlight_result。
import { act, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// stub EmbeddedViewer：把 props 存到共享 box，讓測試可手動觸發 viewer→console callback。
// 用 vi.hoisted 建立 box：vi.mock factory 被 hoist 到 import 之上，直接 close over 普通 let 會與
// 測試體讀到的 binding desync（factory closure 抓到 hoisted TDZ 副本）；vi.hoisted 確保 factory
// 與測試體共用同一個 box.current。
// stub 必須是 forwardRef：A1 page 以 ref={viewerRef} 掛載 EmbeddedViewer，純 function 元件收 ref
// 會觸發「Function components cannot be given refs」警告且 props 捕捉不到 → 用 forwardRef 對齊真元件簽名。
const box = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./EmbeddedViewer", () => ({
  EmbeddedViewer: forwardRef((props: Record<string, unknown>) => {
    box.current = props;
    return null; // 不渲染真 iframe；只記錄 props 供測試驅動 callback
  }),
}));

import { A1GovernanceWorkbenchPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";

const VIEWER_ORIGIN = "http://127.0.0.1:5173";
const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

// runtime/status 最小回應：configured_endpoints.viewer.browser_url_base + 一個 active session。
function fakeRuntimeStatus(viewerBase: string | null) {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: viewerBase ?? "", handoff_path: "/" },
      conversion_authority: { base_url: "", authority: "" },
      kit: [],
    },
    sessions: {
      count: 1,
      active_count: 1,
      participant_count: 0,
      items: [
        {
          session_id: "review_session_x",
          status: "active",
          project_id: "p1",
          model_version_id: "m1",
          participant_count: 0,
          expected_stage_url: "stage://x",
          expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
          conversion_status: null,
          kit_instance_ids: [],
          created_at: "",
          updated_at: "",
          first_frame_at: null,
        },
      ],
    },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: {
      classification: "",
      note: "",
      web_plane: { coordinator_port: 8004, viewer_port: 5173 },
      host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] },
    },
  };
}

describe("A1 頁嵌入 viewer + 3D 高亮接線（VG-01 Task 3 / IX-A1-06）", () => {
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  let root: Root | null;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    box.current = null;
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    if (container.parentNode) document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const q = (tid: string) => container.querySelector<HTMLElement>(`[data-testid="${tid}"]`);
  // runtimeStatus().then 鏈在 real timers 下需多個 microtask tick 才完成（effect commit → fetch
  // resolve → setState → re-render → EmbeddedViewer 子樹再 render 並更新 box.current）。連續數 tick 沖乾淨。
  const flush = async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => { await Promise.resolve(); });
    }
  };

  it("有 active session → 顯示 session 下拉；viewerOrigin 取自 runtime/status", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush(); // flush runtimeStatus then-chain（多 tick：effect commit → .then → setState）

    expect(q("a1-session-select")).not.toBeNull();
    expect(q("a1-no-session")).toBeNull();
    // EmbeddedViewer 收到的 viewerOrigin 必須是 viewer :5173（非 coordinator :8004）
    expect(box.current?.viewerOrigin).toBe(VIEWER_ORIGIN);
    expect(box.current?.sessionId).toBe("review_session_x");
  });

  it("first frame 未到 → 『在 3D 高亮』鈕 disabled + 誠實原因", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    const btn = q("a1-highlight-3d") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
    // first frame 證據在收到前須誠實顯 not_observed（不樂觀）
    expect(q("a1-first-frame-evidence")!.textContent).toContain("not_observed");
    // stage 在 first_frame/stage_loaded 任一抵達前 loadedStageUrl 為 null → stage matched 須誠實顯「尚未載入」，
    // 不可樂觀預設 matched（Important #2 point 2：守 stageMatchedText 的 not_observed 分支）。
    expect(q("a1-stage-matched")!.textContent).toContain("not_observed（尚未載入）");
  });

  it("EmbeddedViewer onFirstFrame → 呼叫 reportFirstFrame + first frame 證據轉綠", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    const reportSpy = vi
      .spyOn(coordinatorClient, "reportFirstFrame")
      .mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-06-22T00:00:00.000Z" });
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    await act(async () => {
      (box.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    // 生產端呼叫 reportFirstFrame(selectedSession)（endpointId 省略）→ 只帶 1 個參數。
    expect(reportSpy).toHaveBeenCalledWith("review_session_x");
    expect(q("a1-first-frame-evidence")!.textContent).toContain("已收到真畫面");
  });

  it("onFirstFrame 帶 stageUrl（== expected）→ stage matched 轉 matched（first_frame 即閉合 stage-match，不靠獨立 stage_loaded）", async () => {
    // Important #1 迴歸守護：viewer 在 _completeStageLoad 先送 first_frame(含 stageUrl) 再送 stage_loaded；
    // 若 console 丟棄 first_frame.stageUrl，loadedStageUrl 永為 null、stageMatched 永 false。此處只觸發
    // onFirstFrame（不觸發 onStageLoaded），驗 stage matched 仍能從 first_frame 閉合成 matched。
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-06-22T00:00:00.000Z" });
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    // 觸發前 stage 未載 → not_observed。
    expect(q("a1-stage-matched")!.textContent).toContain("not_observed（尚未載入）");
    await act(async () => {
      (box.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    // expected_stage_url=stage://x（fakeRuntimeStatus）== onFirstFrame.stageUrl → matched。
    // 斷言 stageMatchedText 的 matched 分支「值」（含全形括號），非 Field 的 "stage matched" 標籤
    // （標籤恆含 "matched" 會造成偽通過）；matched（expected == loaded）只在閉合成功時出現。
    expect(q("a1-stage-matched")!.textContent).toContain("matched（expected == loaded）");
  });

  it("onFirstFrame 已閉合 stage-match 後，晚到的 stage_loaded(null) 不得清空 loaded stage", async () => {
    // Important #2 補強：viewer 事件順序可能 first_frame(stageUrl) → stage_loaded(null)。
    // first_frame 是較強證據；null stage_loaded 只能代表未補充新證據，不可覆蓋已觀察到的 loaded stage。
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-06-22T00:00:00.000Z" });
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    await act(async () => {
      (box.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();
    expect(q("a1-stage-matched")!.textContent).toContain("matched（expected == loaded）");

    await act(async () => {
      (box.current!.onStageLoaded as (stageUrl: string | null) => void)(null);
    });
    await flush();

    expect(q("a1-stage-matched")!.textContent).toContain("matched（expected == loaded）");
  });

  it("四條件全滿（first_frame∧session∧stageMatched∧構件有 usd_prim_path）→『在 3D 高亮』鈕 enable", async () => {
    // IX-A1-06 四條件閉合的端到端守護：透過真 doRun 流程（createRuleRun→getRuleRun(succeeded)→getResults）
    // 餵入一筆 ifc_guid+usd_prim_path 皆非 null 的 failed 構件，再以 onFirstFrame(stageUrl==expected) 閉合
    // first_frame 與 stage-match 兩條件，驗按鈕由 disabled 翻 enable（搭配 Important #1 修正才會通過）。
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-06-22T00:00:00.000Z" });
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_x", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue({
      rule_run_id: "rr_x", status: "succeeded", score: 80, rule_set: "default", model_version_id: "m1",
      summary: { total: 1, passed: 0, failed: 1, errored: 0, target_summary: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "0G1", usd_prim_path: "/World/W1", rule_code: "R1", severity: "error", status: "fail", message: "牆缺防火等級" },
    ]);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    // 跑檢核：先 PICK_FILE（離開 idle 才能按 RUN），再按 a1-step-run；doRun 首輪 getRuleRun 即 succeeded → 立即 RUN_DONE。
    await act(async () => { (q("a1-step-pick") as HTMLButtonElement).click(); });
    await act(async () => { (q("a1-step-run") as HTMLButtonElement).click(); });
    await flush();

    const btn = () => q("a1-highlight-3d") as HTMLButtonElement;
    // 此刻 first_frame 未到 → 仍 disabled（三條件滿、缺 first_frame ∧ stage matched）。
    expect(btn().disabled).toBe(true);

    await act(async () => {
      (box.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    // first_frame 到 + stageUrl 閉合 stage-match + 構件有 usd_prim_path + 有選 session → 四條件全滿 → enable。
    expect(btn().disabled).toBe(false);
  });

  it("rule-run failed row 缺 usd_prim_path 時，使用 selected session 的真 mapping artifact 補齊後 enable", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-06-22T00:00:00.000Z" });
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_x", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue({
      rule_run_id: "rr_x", status: "succeeded", score: 0, rule_set: "vg01", model_version_id: "m1",
      summary: { total: 1, passed: 0, failed: 1, errored: 0, target_summary: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "0G1", usd_prim_path: null, rule_code: "IDS#0", severity: "required", status: "fail", message: "IDS 要求未滿足" },
    ]);
    const mappingSpy = vi.spyOn(governanceClient, "elementMappingForSession").mockResolvedValue({
      mock: false,
      summary: { fake_mapping_count: 0 },
      items: [{ ifc_guid: "0G1", usd_prim_path: "/World/Column/0G1", mapping_method: "guid_exact" }],
    });
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    await act(async () => { (q("a1-step-pick") as HTMLButtonElement).click(); });
    await act(async () => { (q("a1-step-run") as HTMLButtonElement).click(); });
    await flush();

    expect(mappingSpy).toHaveBeenCalledWith("review_session_x", "http://127.0.0.1:49101/artifacts/demo/element_mapping.json");
    await act(async () => {
      (box.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    expect((q("a1-highlight-3d") as HTMLButtonElement).disabled).toBe(false);
  });

  it("highlight_result unmapped → 誠實文案『未對映 / 無法高亮』", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    await act(async () => {
      (box.current!.onHighlightResult as (m: unknown) => void)({
        protocol: "vg01", type: "highlight_result", requestId: "", ok: false, reason: "unmapped",
      });
    });
    expect(q("a1-highlight-status")!.textContent).toMatch(/未對映|無法高亮/);
  });

  it("runtime/status 無 viewer.browser_url_base → 誠實顯 viewer 入口未取得（不掛空 iframe）", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(null) as never);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    // session 下拉仍出（有 active session），但 viewer 入口缺 → 誠實提示、不 mount viewer。
    expect(q("a1-session-select")).not.toBeNull();
    expect(q("a1-viewer-origin-missing")).not.toBeNull();
    expect(box.current).toBeNull(); // EmbeddedViewer 未 render
  });

  it("無 active session → 顯示『需先派發 review session』，不出下拉", async () => {
    const empty = fakeRuntimeStatus(VIEWER_ORIGIN);
    empty.sessions = { count: 0, active_count: 0, participant_count: 0, items: [] };
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(empty as never);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    expect(q("a1-no-session")).not.toBeNull();
    expect(q("a1-session-select")).toBeNull();
  });

  // A1-W1 BCF gating UI 層驗證：
  // step=idle 時 BCF 鈕 disabled（反向斷言）；
  // step=issued 後 BCF 鈕 enable（正向斷言）。
  it("A1-W1 BCF：初始 step=idle → BCF 鈕 disabled + caption 含「需先建 Issue」", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    const bcfBtn = q("a1-step-bcf") as HTMLButtonElement | null;
    expect(bcfBtn).not.toBeNull();
    expect(bcfBtn!.disabled).toBe(true);
    // caption 含「需先建 Issue」誠實說明 gating 條件
    expect(bcfBtn!.textContent).toContain("需先建 Issue");
  });

  it("A1-W1 BCF：step=issued 後 BCF 鈕 enable", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_x", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue({
      rule_run_id: "rr_x", status: "succeeded", score: 80, rule_set: "default", model_version_id: "m1",
      summary: { total: 1, passed: 0, failed: 1, errored: 0, target_summary: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "0G1", usd_prim_path: "/World/W1", rule_code: "R1", severity: "error", status: "fail", message: "失敗" },
    ]);
    vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 1, issue_ids: ["iss_1"] });
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();

    // 鎖定模型 → 跑檢核 → RUN_DONE(step=scored)
    await act(async () => { (q("a1-step-pick") as HTMLButtonElement).click(); });
    await act(async () => { (q("a1-step-run") as HTMLButtonElement).click(); });
    await flush();

    // BCF 在 scored 時仍 disabled（需先建 Issue）
    const bcfBtn = () => q("a1-step-bcf") as HTMLButtonElement;
    expect(bcfBtn().disabled).toBe(true);

    // 建 Issue → step=issued → BCF enable
    await act(async () => { (q("a1-step-issues") as HTMLButtonElement).click(); });
    await flush();

    expect(bcfBtn().disabled).toBe(false);
  });
});
