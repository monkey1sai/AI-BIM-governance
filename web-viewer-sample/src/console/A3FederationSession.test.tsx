// A3-G1 federation→session 一鍵鏈（FederationPage）回歸鎖：
//   1) review-room descriptor ready → 「建立 Review Session」可按；POST /api/review-sessions 帶
//      必填 project_id / model_version_id 與 artifact_bindings（derived+ready+url=federated primary；
//      stage_composition 不是 request 欄位——coordinator 由 binding 推導）。
//   2) 成功 → 顯示 session_id + /ui/open 連結 + spectator 連結（&streamRole=spectator）+ SS chip
//      （buildHandoff source="a3"）。
//   3) 失敗（409 無 Kit 容量）→ 誠實顯示後端 detail。
//   4) descriptor 未 ready → 建立鈕 disabled + 理由（不藏區塊、不留死按鈕）。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FederationPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient, type ReviewRoomDescriptor } from "./governanceClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

const SET_ID = "fs_demo1";
const STAGE_URL = "C:/artifacts/federation/fs_demo1/federated_review.usda";

const READY_ROOM: ReviewRoomDescriptor = {
  set_id: SET_ID,
  ready: true,
  stage_url: STAGE_URL,
  stage_composition: { primary: { url: STAGE_URL, name: "federated_review", discipline: "FED" }, secondary_layers: [] },
  note: "把此 stage_composition 交給 host-native Kit review session 載入 federated_review.usda",
};

const NOT_READY_ROOM: ReviewRoomDescriptor = {
  set_id: SET_ID,
  ready: false,
  stage_url: null,
  stage_composition: null,
  note: "尚未 build；請先 POST …/build 產出 federated_review.usda 再開 Review Room。",
};

describe("A3 federation→session 一鍵鏈", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    window.location.hash = "#federation";
    vi.spyOn(governanceClient, "createFederatedSet").mockResolvedValue({ set_id: SET_ID, status: "created" });
    vi.spyOn(governanceClient, "addFederatedMember").mockResolvedValue({ member_id: "m_1" });
    vi.spyOn(governanceClient, "validateCoords").mockResolvedValue({ consistent: true, members: {}, issues: [] });
    vi.spyOn(governanceClient, "buildFederatedSet").mockResolvedValue({
      usda_path: STAGE_URL, sublayer_order: ["arc", "str"], member_count: 2, hidden: [],
    });
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    if (container.parentNode) document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = "";
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const q = <T extends HTMLElement = HTMLElement>(tid: string) => container.querySelector<T>(`[data-testid="${tid}"]`);
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };
  const clickByText = async (text: string) => {
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text))!;
    expect(btn).toBeTruthy();
    await act(async () => { btn.click(); });
    await flush();
  };
  const renderAndOpenRoom = async (room: ReviewRoomDescriptor) => {
    vi.spyOn(governanceClient, "reviewRoom").mockResolvedValue(room);
    root = createRoot(container);
    await act(async () => { root!.render(<FederationPage />); });
    await flush();
    await clickByText("準備 + 驗證坐標系");
    await clickByText("Build Federated USD");
    await clickByText("Open in Review Room");
  };

  it("成功 201/200 全鏈：POST body 帶必填欄位與 federated primary binding；顯示 session_id / viewer / spectator / SS chip", async () => {
    const createSpy = vi.spyOn(coordinatorClient, "createReviewSession").mockResolvedValue({
      session_id: "review_session_fed", status: "active", project_id: "federation-demo", model_version_id: `federated_${SET_ID}`,
    });
    await renderAndOpenRoom(READY_ROOM);

    const create = q<HTMLButtonElement>("a3-create-session")!;
    expect(create.disabled).toBe(false);
    await act(async () => { create.click(); });
    await flush();

    // POST body：必填 project_id / model_version_id（預設 federated_<set_id>）＋ federated_set_id——
    // 瀏覽器不再自組 binding（proxy 遮蔽使 primary.url 在前端是 "[server-path]" 字面），
    // 真 stage 路徑由 coordinator server-side 向 governance 解析（createSessionSchema.federated_set_id）。
    expect(createSpy).toHaveBeenCalledTimes(1);
    const body = createSpy.mock.calls[0][0];
    expect(body.project_id).toBe("federation-demo");
    expect(body.model_version_id).toBe(`federated_${SET_ID}`);
    expect(body.review_request_id).toBe(`federated_${SET_ID}`);
    expect(body.federated_set_id).toBe(SET_ID);
    expect(body).not.toHaveProperty("artifact_bindings");
    expect(body).not.toHaveProperty("stage_composition");

    // 結果面：session_id、viewer 連結、spectator 連結（&streamRole=spectator）、SS chip handoff。
    expect(q("a3-session-result")?.textContent).toContain("review_session_fed");
    const openViewer = q<HTMLAnchorElement>("a3-open-viewer")!;
    expect(openViewer.getAttribute("href")).toContain("/ui/open?session=review_session_fed");
    const spectator = q<HTMLButtonElement>("a3-invite-spectator")!;
    expect(spectator.textContent).toContain("streamRole=spectator"); // Btn caption 顯示完整 URL
    expect(q("a3-session-result")?.textContent).toContain("streamRole=spectator"); // clipboard 失敗仍有 inline URL
    expect(q("a3-inline-manual-start")).not.toBeNull();
    expect(q("a3-element-selection-unsupported")?.textContent).toContain("Unsupported");
    expect(q("a3-inline-highlight")).toBeNull();

    const ssChip = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("SS →"))!;
    await act(async () => { ssChip.click(); });
    expect(window.location.hash.startsWith("#sessions?")).toBe(true);
    const hp = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1));
    expect(hp.get("source")).toBe("a3");
    expect(hp.get("session")).toBe("review_session_fed");
  });

  it("失敗（409 No Kit capacity）→ a3-session-result 誠實顯示後端 detail，不顯示假 session", async () => {
    vi.spyOn(coordinatorClient, "createReviewSession").mockRejectedValue(
      new Error("coordinator /api/review-sessions -> 409 No Kit capacity available."),
    );
    await renderAndOpenRoom(READY_ROOM);

    const create = q<HTMLButtonElement>("a3-create-session")!;
    await act(async () => { create.click(); });
    await flush();

    expect(q("a3-session-result")?.textContent).toContain("No Kit capacity available");
    expect(q("a3-open-viewer")).toBeNull(); // 失敗不留假連結
    expect(q("a3-invite-spectator")).toBeNull();
  });

  it("descriptor 未 ready → 建立鈕 disabled + 理由；不呼 createReviewSession", async () => {
    const createSpy = vi.spyOn(coordinatorClient, "createReviewSession").mockRejectedValue(new Error("must not be called"));
    await renderAndOpenRoom(NOT_READY_ROOM);

    const create = q<HTMLButtonElement>("a3-create-session")!;
    expect(create.disabled).toBe(true);
    expect(create.textContent).toContain("未 ready"); // caption 理由：descriptor 未 ready
    await act(async () => { create.click(); });
    await flush();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("project_id 清空 → 建立鈕 disabled + 必填理由（createSessionSchema 必填）", async () => {
    const createSpy = vi.spyOn(coordinatorClient, "createReviewSession").mockRejectedValue(new Error("must not be called"));
    await renderAndOpenRoom(READY_ROOM);

    const projInput = Array.from(container.querySelectorAll("input")).find((el) => el.value === "federation-demo")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(projInput, "");
      projInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    const create = q<HTMLButtonElement>("a3-create-session")!;
    expect(create.disabled).toBe(true);
    expect(create.textContent).toContain("project_id");
    await act(async () => { create.click(); });
    expect(createSpy).not.toHaveBeenCalled();
  });
});
