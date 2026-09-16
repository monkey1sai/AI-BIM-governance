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

  // 181 實站回歸：選 ifc-test（此物件無下載紀錄），而所選審查紀錄綁的是東勢區圖書館的結果。
  // 舊訊息把它說成「此物件的另一個版本（source key/etag 不符）」並叫人去重新轉檔——兩件事都錯：
  // 那是另一個模型，而且該物件早已轉檔完成、缺的是 intake 紀錄。
  it("釘住的結果屬於另一個模型時，不得說成「此物件的另一個版本」，也不得叫人重新轉檔", async () => {
    const OTHER_OBJECT_KEY = "東勢區許良宇紀念圖書館/root/建築/24e598ab/model.ifc";
    (coordinatorClient.getMinioObjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      bucket: "bim-control", count: 1,
      objects: [{
        key: "ifc-test/architecture/v1/model.ifc", etag: "etag_ifctest", role: "source_ifc",
        idempotency_key: "mw_62a38b64a3256b88", project_id: "ifc-test",
        project_display_name: "ifc-test", category: "architecture", version: "v1",
      }],
    });
    // 清單裡只有「另一個模型」的 job，且它是被釘住的那一個；ifc-test 自己沒有 job。
    (coordinatorClient.listIfcReady as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
      items: [{
        ifc_ready_job_id: "ifcready_1788856952485_dc468775", status: "dispatched",
        project_id: "mv_6c51d572", external_model_version_id: "24e598ab",
        download_status: "downloaded", source_ifc_etag: OBJECT_ETAG,
        source_object_key: OTHER_OBJECT_KEY, conversion_status: "ready",
        conversion_authority: "bim-streaming-server", queue_position: null,
        conversion_job_id: "c", dispatch_error: null, review_session_id: SESSION_ID,
        viewer_url: null, expected_stage_url: "http://kit/model.usdc",
        expected_mapping_url: "http://kit/element_mapping.json",
        artifact_health: { source_ifc_exists: true } as never,
        created_at: "2026-09-08T08:42:32.485Z", idempotency_key: READY_MODEL_ID,
      }],
    } as never);
    await mount();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="a1-source-minio"]')!.click(); });
    await setSelect("a1-minio-select", "ifc-test/architecture/v1/model.ifc");
    await setSelect("a1-session-select", SESSION_ID); // 綁在 READY_MODEL_ID＝另一個模型

    const note = container.querySelector('[data-testid="a1-minio-resolution-note"]')!.textContent ?? "";
    expect(pickButton().disabled).toBe(true);
    expect(note).not.toContain("此物件的另一個版本");
    expect(note).not.toContain("此物件的另一次轉檔");
    expect(note).not.toContain("重新轉檔");
    expect(note).toContain("另一個模型");
    expect(note).toContain(OTHER_OBJECT_KEY);          // 據實點名釘住它的是哪個模型
    expect(note).toContain("此物件目前沒有 watcher 下載紀錄"); // 據實陳述本物件狀態
  });

  it("釘住的結果確實是同一物件的另一次轉檔時，才說「此物件的另一次轉檔」", async () => {
    (coordinatorClient.listIfcReady as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
      items: [{
        ifc_ready_job_id: "ifcready_reconverted", status: "dispatched", project_id: "mv_6c51d572",
        external_model_version_id: "v", download_status: "downloaded",
        source_ifc_etag: "old-etag",                 // 同物件、不同版本
        source_object_key: OBJECT_KEY, conversion_status: "ready",
        conversion_authority: "bim-streaming-server", queue_position: null,
        conversion_job_id: "c", dispatch_error: null, review_session_id: SESSION_ID,
        viewer_url: null, expected_stage_url: "http://kit/model.usdc",
        expected_mapping_url: "http://kit/element_mapping.json",
        artifact_health: { source_ifc_exists: true } as never,
        created_at: "2026-09-08T08:42:32.485Z", idempotency_key: "mw_62a38b64a3256b88",
      }],
    } as never);
    await mount();
    await selectMinioObject();
    await setSelect("a1-session-select", OTHER_SESSION_ID); // 綁 mw_62a38b64a3256b88＝上面那筆
    const note = container.querySelector('[data-testid="a1-minio-resolution-note"]')!.textContent ?? "";
    expect(pickButton().disabled).toBe(true);
    expect(note).toContain("此物件的另一次轉檔結果");
    expect(note).not.toContain("另一個模型");
  });

  // 181 實站回歸：ifc-test 重新轉檔後，新 job 的 idempotency_key 是 mw_234922dc468b501e，
  // 與物件自身的 watcher 鍵 mw_62a38b64a3256b88 不同。未選審查時只比對 watcher 鍵，
  // 會對著清單裡明明存在的下載紀錄說「尚未找到」，並叫人再觸發一次不需要的轉檔。
  const reconvertedJob = (overrides: Record<string, unknown> = {}) => ({
    ifc_ready_job_id: "ifcready_1789535303931_d9197634", status: "dispatched",
    project_id: "mv_6c51d572", external_model_version_id: "v1",
    download_status: "downloaded",
    source_ifc_etag: OBJECT_ETAG,          // 與物件相同（同一份來源）
    source_object_key: OBJECT_KEY,
    conversion_status: "ready", conversion_authority: "bim-streaming-server",
    queue_position: null, conversion_job_id: "stream_conv_20260916050824_3b6583e0",
    dispatch_error: null, review_session_id: "review_session_8f39d8fb58a4", viewer_url: null,
    expected_stage_url: "http://kit/model.usdc", expected_mapping_url: "http://kit/element_mapping.json",
    artifact_health: { source_ifc_exists: true },
    created_at: "2026-09-16T05:08:23.931Z",
    idempotency_key: "mw_234922dc468b501e",   // 重新轉檔鑄造的獨立 ID
    ...overrides,
  });

  it("重新轉檔後未選審查也能對到：以來源 key+etag 認回同一份來源的唯一結果", async () => {
    (coordinatorClient.listIfcReady as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1, items: [reconvertedJob()],
    } as never);
    await mount();
    await selectMinioObject();                    // 不選任何審查紀錄
    expect(pickButton().disabled).toBe(false);
    const note = container.querySelector('[data-testid="a1-minio-resolution-note"]')!.textContent ?? "";
    expect(note).not.toContain("尚未找到 watcher 下載紀錄");
    expect(note).not.toContain("/api/conversion/trigger");
  });

  it("同一份來源有多次轉檔結果時不替操作員挑：據實說明有幾次並要求指定審查", async () => {
    (coordinatorClient.listIfcReady as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 2,
      items: [
        reconvertedJob(),
        reconvertedJob({ ifc_ready_job_id: "ifcready_second", idempotency_key: "mw_second_attempt" }),
      ],
    } as never);
    await mount();
    await selectMinioObject();
    const note = container.querySelector('[data-testid="a1-minio-resolution-note"]')!.textContent ?? "";
    expect(pickButton().disabled).toBe(true);     // 不猜
    expect(note).toContain("2");
    expect(note).toContain("次轉檔結果");
    expect(note).not.toContain("尚未找到 watcher 下載紀錄");
  });

  it("來源 key/etag 不相符的 job 不得被認回（不可把別的物件當成同一份來源）", async () => {
    (coordinatorClient.listIfcReady as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 2,
      items: [
        reconvertedJob({ source_object_key: "另一個專案/model.ifc" }),   // 別的物件
        reconvertedJob({ ifc_ready_job_id: "ifcready_stale_etag", idempotency_key: "mw_stale", source_ifc_etag: "old-etag" }), // 別的版本
      ],
    } as never);
    await mount();
    await selectMinioObject();
    expect(pickButton().disabled).toBe(true);
    expect(container.querySelector('[data-testid="a1-minio-resolution-note"]')!.textContent)
      .toContain("尚未找到 watcher 下載紀錄"); // 這次確實沒有此物件的紀錄，訊息正確
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
