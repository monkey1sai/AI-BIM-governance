// A2 以 MinIO 已下載模型做版本 diff。
//
// 為何需要這條來源：watcher 下載的 IFC 落在 storage/ifc-cache/<jobId>/source.ifc，而 ifc-cache
// 是 governance 檔案庫的保留目錄（明文排除），所以 MinIO 模型永遠不會出現在 A2 的專案/模型/
// 版本選單——181 實站的 files/tree 只有一個 manual-upload 版本，連 diff 都組不出來。
//
// 邊界鎖：瀏覽器只送 ifc_ready_job_id（不送 host path、不送 MinIO key），且切到 MinIO 來源時
// 不得改動檔案庫分支的既有行為。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VersionDiffPage } from "./VersionDiffPage";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";

function job(id: string, version: string, overrides: Record<string, unknown> = {}) {
  return {
    ifc_ready_job_id: id, status: "dispatched", project_id: "mv_1",
    external_model_version_id: version, download_status: "downloaded",
    source_ifc_etag: `etag_${id}`, source_object_key: `bucket/${version}/model.ifc`,
    conversion_status: "ready", conversion_authority: "bim-streaming-server",
    queue_position: null, conversion_job_id: `conv_${id}`, dispatch_error: null,
    review_session_id: null, viewer_url: null, expected_stage_url: null, expected_mapping_url: null,
    artifact_health: { source_ifc_exists: true },
    created_at: "2026-09-08T08:42:32.485Z", idempotency_key: `mw_${id}`,
    project_display_name: "東勢區許良宇紀念圖書館", category: "建築",
    ...overrides,
  };
}

describe("A2 MinIO 來源 diff", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    root = null;
    document.body.appendChild(container);
    // 181 實況：檔案庫只有一個版本 → 檔案庫分支根本組不出 base≠target。
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue({
      root: "/srv/storage", source_kind: "local_fs",
      projects: [{ project_id: "manual-upload", models: [{ model_id: "default", versions: [
        { name: "v1/許良宇圖書館建築_2026.ifc", path: "[server-path]", size_bytes: 1, mtime: "" },
      ] }] }],
    });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({
      count: 2, items: [job("ifcready_base", "v_base"), job("ifcready_target", "v_target")],
    } as never);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root?.unmount(); });
      root = null;
    }
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const mount = async () => {
    root = createRoot(container);
    await act(async () => { root!.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });
  };
  const q = <T extends Element>(tid: string) => container.querySelector<T>(`[data-testid="${tid}"]`);
  const click = async (tid: string) => { await act(async () => { q<HTMLButtonElement>(tid)!.click(); }); };
  const setSelect = async (tid: string, value: string) => {
    const sel = q<HTMLSelectElement>(tid)!;
    await act(async () => { sel.value = value; sel.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  it("預設維持檔案庫來源：不打 ifc-ready 清單，檔案庫選擇器照舊渲染", async () => {
    await mount();
    expect(q("a2-base-project")).not.toBeNull();
    expect(q("a2-base-ifcready")).toBeNull();
    expect(coordinatorClient.listIfcReady).not.toHaveBeenCalled();
  });

  it("切到 MinIO 來源 → 列出已下載模型，送出只帶兩側 job id（不含 host path / MinIO key）", async () => {
    const create = vi.spyOn(governanceClient, "createDiffForIfcReady")
      .mockResolvedValue({ diff_id: "diff_1", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({ diff_id: "diff_1", status: "succeeded", summary: { counts: {} } } as never);
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("optional"));
    const libraryDiff = vi.spyOn(governanceClient, "createDiffForLibrary");
    const plainDiff = vi.spyOn(governanceClient, "createDiff");

    await mount();
    await click("a2-source-minio");
    await act(async () => { await Promise.resolve(); });

    expect(q("a2-base-project")).toBeNull(); // 檔案庫選擇器讓位，兩條來源互斥
    await setSelect("a2-base-ifcready", "ifcready_base");
    await setSelect("a2-target-ifcready", "ifcready_target");
    // Run Diff 鈕無 testid，改以文字定位（維持既有版面，不為測試加標記）。
    const runBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Run Diff"))!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(create).toHaveBeenCalledWith({
      base_ifc_ready_job_id: "ifcready_base",
      target_ifc_ready_job_id: "ifcready_target",
      include_geometry: false,
    });
    expect(libraryDiff).not.toHaveBeenCalled();
    expect(plainDiff).not.toHaveBeenCalled();
  });

  it("兩側未選齊 → 據實擋下，不送請求", async () => {
    const create = vi.spyOn(governanceClient, "createDiffForIfcReady");
    await mount();
    await click("a2-source-minio");
    await act(async () => { await Promise.resolve(); });
    await setSelect("a2-base-ifcready", "ifcready_base");
    const runBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Run Diff"))!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(create).not.toHaveBeenCalled();
  });

  it("換來源時清掉上一輪結果與錯誤：舊 diff 不得被讀成新來源比出來的", async () => {
    vi.spyOn(governanceClient, "createDiffForIfcReady").mockResolvedValue({ diff_id: "diff_1", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "diff_1", status: "succeeded", summary: { matched: 7, counts: { added: 3 } },
    } as never);
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([
      { ifc_guid: "g1", change_type: "added" } as never,
    ]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("optional"));

    await mount();
    await click("a2-source-minio");
    await act(async () => { await Promise.resolve(); });
    await setSelect("a2-base-ifcready", "ifcready_base");
    await setSelect("a2-target-ifcready", "ifcready_target");
    const runBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Run Diff"))!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("matched");

    // 切回檔案庫：Builder 的輸入與送出端點都換了，舊結果不再對應畫面上的設定。
    await click("a2-source-library");
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).not.toContain("matched");
    expect(q("a2-base-project")).not.toBeNull(); // 檔案庫選擇器回來，行為與改動前一致
  });

  it("可比對模型不足兩個 → 據實說明不足，不假裝可以比對", async () => {
    (coordinatorClient.listIfcReady as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 2,
      items: [
        job("ifcready_base", "v_base"),
        // 已下載但 source IFC stale → 不可比對，必須排除而非列出來讓使用者撞 404。
        job("ifcready_stale", "v_stale", { artifact_health: { source_ifc_exists: false } }),
      ],
    } as never);
    await mount();
    await click("a2-source-minio");
    await act(async () => { await Promise.resolve(); });
    expect(q("a2-minio-insufficient")).not.toBeNull();
    expect(Array.from(q<HTMLSelectElement>("a2-base-ifcready")!.options).map((o) => o.value))
      .not.toContain("ifcready_stale");
  });
});
