// ready-review 建立／開啟／重試／停止流程（自 ReadyReviewSessions 移入；sessionStorage key 不變，既有 pending 可續用）。
import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, type ReadyReviewSessionResponse, type RuntimeSessionSummary } from "../coordinatorClient";
import { t } from "../i18n";

export const PENDING_KEY = "ai-bim.ready-review-request.v1";
export type PendingCreate = { readyModelId: string; requestId: string };
export function readPending(): PendingCreate | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingCreate | null;
    return value && /^mw_[a-f0-9]{16}$/.test(value.readyModelId) && /^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId) ? value : null;
  } catch { return null; }
}

export interface ReadyReviewRequest {
  pending: PendingCreate | null; busy: boolean; error: string | null; result: ReadyReviewSessionResponse | null;
  confirmStop: boolean; stoppedRequest: PendingCreate | null;
  create(readyModelId: string): void;
  openExisting(readyModelId: string, sessionId: string): Promise<void>;
  retry(): void; requestStop(): void; cancelStop(): void; confirmStopTracking(): void; clearFeedback(): void;
}

export function useReadyReviewRequest(onSelected: (session: RuntimeSessionSummary) => void): ReadyReviewRequest {
  const [pending, setPending] = useState<PendingCreate | null>(readPending);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stoppedRequest, setStoppedRequest] = useState<PendingCreate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadyReviewSessionResponse | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const onSelectedRef = useRef(onSelected);
  onSelectedRef.current = onSelected;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const submit = useCallback(async (target: PendingCreate | { readyModelId: string; sessionId: string }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await coordinatorClient.readyReviewSession(target.readyModelId,
        "requestId" in target ? { mode: "create_new", request_id: target.requestId } : { mode: "open_existing", session_id: target.sessionId });
      if (response.session_status === "created" || response.session_status === "active") {
        const runtime = await coordinatorClient.runtimeStatus();
        const selected = runtime.sessions.items.find((session) => session.session_id === response.review_session_id);
        if (!selected || !["created", "active"].includes(selected.status)) {
          throw new Error(t("審查狀態已變更，請重試以重新確認。", "The review state changed. Retry to verify it."));
        }
        if (!alive.current) return;
        onSelectedRef.current(selected);
      }
      if (!alive.current) return;
      if ("requestId" in target) { sessionStorage.removeItem(PENDING_KEY); setPending(null); }
      setResult(response);
    } catch (failure) {
      if (alive.current) setError(String(failure));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const create = useCallback((readyModelId: string) => {
    if (pending || inFlight.current) return;
    try {
      const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const next = { readyModelId, requestId: "review-" + randomPart };
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(next)); // 先持久化再送：回應遺失或重載後可重試
      setPending(next);
      void submit(next);
    } catch {
      setError(t("無法保存建立請求；請允許此頁使用瀏覽器儲存空間後重試。", "The request could not be saved. Allow browser storage and retry."));
    }
  }, [pending, submit]);

  return {
    pending, busy, error, result, confirmStop, stoppedRequest,
    create,
    openExisting: (readyModelId, sessionId) => submit({ readyModelId, sessionId }),
    retry: () => { if (pending) void submit(pending); },
    requestStop: () => setConfirmStop(true),
    cancelStop: () => setConfirmStop(false),
    confirmStopTracking: () => {
      try { sessionStorage.removeItem(PENDING_KEY); setStoppedRequest(pending); setPending(null); setConfirmStop(false); setError(null); }
      catch { setError(t("無法移除待確認請求；請保留原請求重試。", "Cannot clear the pending request. Keep the original request and retry.")); }
    },
    clearFeedback: () => { setResult(null); setError(null); },
  };
}
