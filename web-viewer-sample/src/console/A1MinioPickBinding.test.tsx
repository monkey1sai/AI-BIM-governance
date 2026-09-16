// 回歸來源（181 實站復現）：A1 的 MinIO 選檔在「選了 3D session」之後永遠停在
// 「等待 watcher/轉檔排程」，即使選的正是那個 session 自己的來源模型。
//
// 兩個獨立成因，各鎖一條：
//  1) minioJobForSelection 的精確綁定分支拿 job.source_object_key 當必要條件，但該欄來自
//     ledger 的 nullable 欄位、落地全為 null → 比對恆假。
//  2) 反覆關閉／開啟 session 後，關掉的 session 仍留在候選清單且仍被選著，
//     它的 ready_model_id 繼續把解析釘在別的模型上。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A1GovernanceWorkbenchPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";

const OBJECT_KEY = "東勢區許良宇紀念圖書館/root/建築/24e598ab-be3d-4dbb-a1aa-60b0ba610618/model.ifc";
const OBJECT_ETAG = "06363b2cb9b9206118a8547f93ce6825-11";
const READY_MODEL_ID = "mw_010792d2cce6bf9b";
const SESSION_ID = "review_session_fd48be0a3fff";

const OTHER_SESSION_ID = "review_session_632a29f847b4";

function session(id: string, status: string, readyModelId: string) {
  return {
    session_id: id, status, ready_model_id: readyModelId,
    project_id: "mv_6c51d572", model_version_id: "24e598ab-be3d-4dbb-a1aa-60b0ba610618",
    participant_count: 0, expected_stage_url: "http://kit/model.usdc",
    expected_mapping_url: "http://kit/element_mapping.json", conversion_status: "ready",
    kit_instance_ids: [], created_at: "", updated_at: "", first_frame_at: null,
  };
}

// 第二個 session 一直保持 active：sessions 清空時 A1 會改渲染「關閉的 session 復原」面板
// （既有正確行為），本測試要斷言的是候選清單內的汰除，不是面板切換。
function runtimeStatusWith(sessionStatus: string) {
  const items = [
    session(SESSION_ID, sessionStatus, READY_MODEL_ID),
    session(OTHER_SESSION_ID, "active", "mw_62a38b64a3256b88"),
  ];
  return {
    sessions: { count: items.length, active_count: items.length, participant_count: 0, items },
    configured_endpoints: { viewer: { browser_url_base: "" } }, // 不掛 EmbeddedViewer，斷言面不變
  } as never;
}

describe("A1 MinIO 選檔與 session 綁定", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    root = null;
    document.body.appendChild(container);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(runtimeStatusWith("active"));
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue({
      root: "/srv/storage", source_kind: "local_fs", projects: [],
    });
    vi.spyOn(coordinatorClient, "getTestDataProjects").mockResolvedValue({ projects: [] });
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control", count: 1,
      objects: [{
        key: OBJECT_KEY, etag: OBJECT_ETAG, role: "source_ifc", idempotency_key: READY_MODEL_ID,
        project_id: "mv_6c51d572", project_display_name: "東勢區許良宇紀念圖書館",
        category: "建築", version: "24e598ab-be3d-4dbb-a1aa-60b0ba610618",
      }],
    });
    // 逐字對齊 181 實站的投影：source_object_key 為 null（ledger.object_key 落地全 null）。
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({
      count: 1,
      items: [{
        ifc_ready_job_id: "ifcready_1788856952485_dc468775", status: "dispatched",
        project_id: "mv_6c51d572", external_model_version_id: "24e598ab-be3d-4dbb-a1aa-60b0ba610618",
        download_status: "downloaded", source_ifc_etag: OBJECT_ETAG, source_object_key: null,
        conversion_status: "ready", conversion_authority: "bim-streaming-server",
        queue_position: null, conversion_job_id: "stream_conv_20260908084233_4bbe0d28",
        dispatch_error: null, review_session_id: SESSION_ID, viewer_url: null,
        expected_stage_url: "http://kit/model.usdc", expected_mapping_url: "http://kit/element_mapping.json",
        artifact_health: { source_ifc_exists: true } as never,
        created_at: "2026-09-08T08:42:32.485Z", idempotency_key: READY_MODEL_ID,
      }],
    } as never);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root?.unmount(); });
      root = null;
    }
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const mount = async () => {
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  };
  const setSelect = async (tid: string, value: string) => {
    const sel = container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    await act(async () => { sel.value = value; sel.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  const pickButton = () => container.querySelector<HTMLButtonElement>('[data-testid="a1-step-pick"]')!;
  const selectMinioObject = async () => {
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="a1-source-minio"]')!.click(); });
    await setSelect("a1-minio-select", OBJECT_KEY);
  };

  it("source_object_key 未回報（null）時仍能對到 job：null 是「未回報」不是「不相符」", async () => {
    await mount();
    await selectMinioObject();
    expect(pickButton().disabled).toBe(false);

    // 選上這個模型自己的 review session → 走精確綁定分支，仍必須可選。
    await setSelect("a1-session-select", SESSION_ID);
    expect(pickButton().disabled).toBe(false);
    expect(container.querySelector('[data-testid="a1-minio-resolution-note"]')!.textContent)
      .not.toContain("尚未找到 watcher 下載紀錄");
  });

  it("source_object_key 有回報且不相符時仍然擋下（精確綁定不被放寬）", async () => {
    (coordinatorClient.listIfcReady as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
      items: [{
        ifc_ready_job_id: "ifcready_other", status: "dispatched", project_id: "mv_6c51d572",
        external_model_version_id: "v", download_status: "downloaded", source_ifc_etag: OBJECT_ETAG,
        source_object_key: "另一個專案/model.ifc", conversion_status: "ready",
        conversion_authority: "bim-streaming-server", queue_position: null,
        conversion_job_id: "c", dispatch_error: null, review_session_id: SESSION_ID,
        viewer_url: null, expected_stage_url: "http://kit/model.usdc",
        expected_mapping_url: "http://kit/element_mapping.json",
        artifact_health: { source_ifc_exists: true } as never,
        created_at: "2026-09-08T08:42:32.485Z", idempotency_key: READY_MODEL_ID,
      }],
    } as never);
    await mount();
    await selectMinioObject();
    await setSelect("a1-session-select", SESSION_ID);
    expect(pickButton().disabled).toBe(true);
  });

  it("被別的審查紀錄釘住時據實說明，不再叫操作員去觸發不需要的轉檔", async () => {
    await mount();
    await selectMinioObject();
    // 選一個綁在別的轉檔結果上的審查紀錄 → 精確綁定分支排除本物件的 job。
    await setSelect("a1-session-select", OTHER_SESSION_ID);
    const note = container.querySelector('[data-testid="a1-minio-resolution-note"]')!.textContent ?? "";
    expect(pickButton().disabled).toBe(true); // 綁定守衛不被放寬
    expect(note).not.toContain("尚未找到 watcher 下載紀錄");
    expect(note).not.toContain("/api/conversion/trigger");
    expect(note).toContain("ifcready_1788856952485_dc468775"); // job 確實存在，據實點名
    expect(note).toContain("mw_62a38b64a3256b88"); // 擋下它的是這個綁定
  });

  it("session 關閉後輪詢重讀 runtime：移出候選清單並清掉選取，不再釘住解析", async () => {
    await mount();
    await selectMinioObject();
    await setSelect("a1-session-select", SESSION_ID);
    const sessionSelect = () => container.querySelector<HTMLSelectElement>('[data-testid="a1-session-select"]')!;
    expect(sessionSelect().value).toBe(SESSION_ID);

    // 使用者關掉 3D session → 下一輪輪詢看到它已非 active/created。
    (coordinatorClient.runtimeStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValue(runtimeStatusWith("closed"));
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });

    expect(sessionSelect().value).toBe("");
    const options = Array.from(sessionSelect().options).map((o) => o.value);
    expect(options).not.toContain(SESSION_ID);
    expect(options).toContain(OTHER_SESSION_ID); // 仍 active 的 session 不受影響
    // 清掉殘留綁定後，選檔回到可用（fallback 以 idempotency_key 對得到 job）。
    expect(pickButton().disabled).toBe(false);
  });
});
