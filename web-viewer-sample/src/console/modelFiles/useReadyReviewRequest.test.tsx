// useReadyReviewRequest 的保證（自已刪除的 ReadyReviewSessions.test 移入，改在 hook 層釘住）：
// 只在 coordinator 確認後選取、先持久化再送、失敗保留請求、remount 不自動重送、停止追蹤需確認。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fx } from "../__testdata__/contractFixtures";
import { CoordinatorHttpError, coordinatorClient, type ReadyReviewSessionResponse, type RuntimeSessionSummary, type RuntimeStatus } from "../coordinatorClient";
import { PENDING_KEY, useReadyReviewRequest, type PendingCreate, type ReadyReviewRequest } from "./useReadyReviewRequest";

const MW = "mw_0123456789abcdef";
const SESSION_ID = "review_session_existing";
const session: RuntimeSessionSummary = fx.runtimeSessionSummary({ ready_model_id: MW, session_id: SESSION_ID, status: "created" });
const created: ReadyReviewSessionResponse = { ready_model_id: MW, review_session_id: SESSION_ID, session_status: "created", session_replay: false };

let hook: ReadyReviewRequest;
function Probe({ onSelected }: { onSelected: (session: RuntimeSessionSummary) => void }) {
  hook = useReadyReviewRequest(onSelected);
  return null;
}

describe("useReadyReviewRequest", () => {
  let container: HTMLDivElement; let root: Root;
  const selected = vi.fn();
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear(); selected.mockReset();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [session] } } as RuntimeStatus);
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const mount = async () => { await act(async () => { root.render(<Probe onSelected={selected} />); }); };
  const remount = async () => { await act(async () => { root.unmount(); }); root = createRoot(container); await mount(); };
  const run = async (action: () => unknown) => { await act(async () => { await action(); }); };
  const stored = () => JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingCreate | null;

  it("selects an existing review only after the coordinator confirms it", async () => {
    let answer!: (value: ReadyReviewSessionResponse) => void;
    const open = vi.spyOn(coordinatorClient, "readyReviewSession").mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await mount();
    let done!: Promise<void>;
    await act(async () => { done = hook.openExisting(MW, SESSION_ID); });
    expect(open).toHaveBeenCalledWith(MW, { mode: "open_existing", session_id: SESSION_ID });
    expect(hook.busy).toBe(true);
    expect(selected).not.toHaveBeenCalled();
    await act(async () => { answer(created); await done; });
    expect(selected).toHaveBeenCalledWith(session);
    expect(hook.result?.review_session_id).toBe(SESSION_ID);
    expect(hook.busy).toBe(false);
  });

  it("does not select when opening an existing review is refused, and shows the server reason", async () => {
    vi.spyOn(coordinatorClient, "readyReviewSession").mockRejectedValue(new CoordinatorHttpError(
      `/api/conversion/records/${MW}/review-session`, 409, "review_session_source_mismatch", "review_session_source_mismatch"));
    await mount();
    await run(() => hook.openExisting(MW, SESSION_ID));
    expect(selected).not.toHaveBeenCalled();
    expect(coordinatorClient.runtimeStatus).not.toHaveBeenCalled();
    expect(hook.error).toContain("409 review_session_source_mismatch");
    expect(hook.result).toBeNull();
  });

  it("keeps a rejected creation persisted, shows the error and does not select", async () => {
    vi.spyOn(coordinatorClient, "readyReviewSession").mockRejectedValue(new Error("response lost"));
    await mount();
    await run(() => hook.create(MW));
    expect(hook.error).toContain("response lost");
    expect(selected).not.toHaveBeenCalled();
    expect(hook.pending).toMatchObject({ readyModelId: MW, requestId: expect.stringMatching(/^review-/) });
    expect(stored()).toEqual(hook.pending);
    expect(hook.busy).toBe(false);
  });

  it("keeps a closed replay as the result without selecting it and clears the pending request", async () => {
    vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue({ ...created, session_status: "closed", session_replay: true });
    await mount();
    await run(() => hook.create(MW));
    expect(hook.result).toMatchObject({ review_session_id: SESSION_ID, session_status: "closed" });
    expect(selected).not.toHaveBeenCalled();
    expect(coordinatorClient.runtimeStatus).not.toHaveBeenCalled();
    expect(hook.pending).toBeNull();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it.each([
    ["missing from runtime status", [] as RuntimeSessionSummary[]],
    ["closed in runtime status", [{ ...session, status: "closed" as const }]],
  ])("reports a changed review state when the confirmed review is %s, without selecting or dropping the request", async (_case, items) => {
    vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(created);
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue({ sessions: { items } } as RuntimeStatus);
    await mount();
    await run(() => hook.create(MW));
    expect(hook.error).toContain("審查狀態已變更");
    expect(selected).not.toHaveBeenCalled();
    expect(hook.result).toBeNull();
    expect(hook.pending).not.toBeNull();
    expect(stored()).toEqual(hook.pending);
  });

  it("stops tracking only after confirmation, remembers the stopped request and allows a fresh creation", async () => {
    const original: PendingCreate = { readyModelId: MW, requestId: "review-abc" };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(original));
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(created);
    await mount();
    expect(hook.pending).toEqual(original);
    await run(() => hook.requestStop());
    expect(hook.confirmStop).toBe(true);
    await run(() => hook.cancelStop());
    expect(hook.confirmStop).toBe(false);
    expect(stored()).toEqual(original);
    await run(() => hook.requestStop());
    await run(() => hook.confirmStopTracking());
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(hook.pending).toBeNull();
    expect(hook.stoppedRequest).toEqual(original);
    expect(hook.confirmStop).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    await run(() => hook.create(MW));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1]).toMatchObject({ mode: "create_new" });
    expect(submit.mock.calls[0][1]).not.toMatchObject({ request_id: original.requestId });
  });

  it("does not send the request when browser storage cannot persist it", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession");
    await mount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
    await run(() => hook.create(MW));
    expect(submit).not.toHaveBeenCalled();
    expect(hook.error).toContain("無法保存");
    expect(hook.pending).toBeNull();
  });

  it.each([
    ["randomUUID", () => ({ randomUUID: vi.fn().mockReturnValueOnce("uuid-1").mockReturnValueOnce("uuid-2") }), /^review-uuid-[12]$/],
    ["the fallback when randomUUID is unavailable (HTTP LAN origin)", () => ({ randomUUID: undefined }), /^review-\d+-[0-9a-f]+$/],
  ])("gives each deliberate creation its own retryable request id using %s", async (_case, crypto, pattern) => {
    vi.stubGlobal("crypto", crypto());
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession").mockResolvedValue(created);
    await mount();
    await run(() => hook.create(MW));
    await run(() => hook.create(MW));
    expect(submit).toHaveBeenCalledTimes(2);
    const [first, second] = submit.mock.calls.map((call) => call[1]);
    for (const intent of [first, second]) {
      expect(intent).toMatchObject({ mode: "create_new", request_id: expect.stringMatching(pattern) });
      expect(intent).toMatchObject({ request_id: expect.stringMatching(/^[A-Za-z0-9._:-]{1,128}$/) }); // readPending 能讀回＝可重試
    }
    expect(second).not.toEqual(first);
  });

  it("keeps the pending request across a remount without resending it, and retries the same request id", async () => {
    const submit = vi.spyOn(coordinatorClient, "readyReviewSession")
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ...created, session_replay: true });
    await mount();
    await run(() => hook.create(MW));
    const first = submit.mock.calls[0];
    await remount();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(hook.pending).toEqual(stored());
    expect(first[1]).toEqual({ mode: "create_new", request_id: hook.pending!.requestId });
    await run(() => hook.create(MW)); // 仍有待確認請求時不得另建
    expect(submit).toHaveBeenCalledTimes(1);
    await run(() => hook.retry());
    expect(submit.mock.calls[1]).toEqual(first);
    expect(selected).toHaveBeenCalledWith(session);
    expect(hook.pending).toBeNull();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});
