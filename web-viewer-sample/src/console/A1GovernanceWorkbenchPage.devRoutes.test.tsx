// unified-console-runtime-truth slice 2（D3）：A1 workbench 測試資料清單於 dev routes 已關閉（/api/dev/test-data-projects 404）
// 時顯示誠實 note。自 console.test.tsx 的「A1GovernanceWorkbenchPage client-render」describe 抽出為獨立檔（setup 逐字複製），
// 讓本 slice 的 PR 不必修改 153k 字元的既有巨型測試檔（P5 對抗複驗供給上限）。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A1GovernanceWorkbenchPage } from "./pages";
import { coordinatorClient, CoordinatorHttpError } from "./coordinatorClient";
import { governanceClient, type FilesTreeResponse } from "./governanceClient";

describe("A1GovernanceWorkbenchPage client-render（doRun 輪詢守門 + 動作失敗 UI 回饋）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  const A1_LOCAL_IFC_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/建築/model.ifc";
  // local_fs select 的 option value = 唯一邏輯鍵（library:// 流）：version.path 對瀏覽器被
  // proxy 遮蔽成 "[server-path]"（全部選項同值），不能再當 select 鍵；run 走 createRuleRunForLibrary。
  const A1_LOCAL_IFC_KEY = "270/建築/model.ifc";
  const a1FilesTree: FilesTreeResponse = {
    root: "C:/Repos/active/iot/AI-BIM-governance/storage",
    source_kind: "local_fs",
    projects: [{
      project_id: "270",
      models: [{
        model_id: "建築",
        versions: [{ name: "model.ifc", path: A1_LOCAL_IFC_PATH, size_bytes: 12345, mtime: "2026-07-06T00:00:00+08:00" }],
      }],
    }],
  };
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    // A1 v2：治理檢核直接對已選 IFC 跑 createRuleRun；review session 只保留給 3D/Review Room handoff。
    // A1 3D 解耦後仍不 auto-select 第一個 active session，避免 handoff 指向錯模型。
    // 同步 mock elementMappingForSession：避免有 usd_prim_path:null 列的測試在 fake-timer 邊界內觸發真 mapping fetch 而 hang。
    // viewerOrigin 留空（browser_url_base:""）→ 不掛 EmbeddedViewer，斷言面不變；afterEach 的 vi.restoreAllMocks() 會還原。
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({
      sessions: { count: 1, active_count: 1, participant_count: 0, items: [
        { session_id: "review_session_x", status: "active", project_id: "p1", model_version_id: "m1",
          participant_count: 0, expected_stage_url: "", expected_mapping_url: "", conversion_status: null,
          kit_instance_ids: [], created_at: "", updated_at: "", first_frame_at: null },
      ] },
      configured_endpoints: { viewer: { browser_url_base: "" } }, // viewerOrigin 留空 → 不掛 EmbeddedViewer，斷言面不變
    } as never);
    vi.spyOn(governanceClient, "elementMappingForSession").mockResolvedValue({ mock: false, summary: { fake_mapping_count: 0 }, items: [] });
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a1FilesTree);
    // A1 step① 改 MinIO 下拉後，mount 會打 getMinioObjects()；回單一 source_ifc 物件讓 pickModel 能選到該 option。
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control", count: 1,
      objects: [{ key: "松風庵/root/main/u1/model.ifc", etag: "e", role: "source_ifc", idempotency_key: "mw_0000000000000013", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" }],
    });
    // R8：A1 mount 會打 getTestDataProjects()；預設 stub 空清單（不標），個別測試可覆寫。
    vi.spyOn(coordinatorClient, "getTestDataProjects").mockResolvedValue({ projects: [] });
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const clickByTestId = async (tid: string) => {
    const el = container.querySelector<HTMLButtonElement>(`[data-testid="${tid}"]`)!;
    await act(async () => { el.click(); });
  };

  // A1 v2 executable source is local_fs: pickModel selects the server-local path returned by filesTree(),
  // then locks it before running CPU rule-run. This is the regression guard against sending MinIO keys
  // as ifc_source_path.
  const pickModel = async (key = A1_LOCAL_IFC_KEY) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const sel = container.querySelector<HTMLSelectElement>('[data-testid="a1-localfs-select"]')!;
    await act(async () => { sel.value = key; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await clickByTestId("a1-step-pick");
  };

  it("[D3 dev routes] getTestDataProjects 404（dev routes 已關閉）→ 顯示誠實 note，不擋 A1 local_fs 流程", async () => {
    (coordinatorClient.getTestDataProjects as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CoordinatorHttpError("/api/dev/test-data-projects", 404, "dev routes disabled"),
    );
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const note = container.querySelector('[data-testid="a1-testdata-devroutes-note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent ?? "").toContain("dev routes 已關閉");

    // 誠實鐵律：測試資料清單取不到只是不加〔測試資料〕徽章，不得阻擋 A1 local_fs 選檔／執行流程。
    const sel = container.querySelector<HTMLSelectElement>('[data-testid="a1-localfs-select"]')!;
    const optionTexts = Array.from(sel.options).map((o) => o.textContent ?? "");
    expect(optionTexts.some((s) => s.includes("270"))).toBe(true);
    expect(optionTexts.some((s) => s.includes("〔測試資料〕"))).toBe(false);
    await pickModel();
    expect(container.querySelector('[data-testid="a1-localfs-selected"]')).not.toBeNull();
  });
});
