// web-viewer-sample/src/console/modelData/useConversionActions.ts
// MD 三頁合一 Task 4：轉檔控制動作共用 hook。抽自 pages.tsx ConversionSchedulingPage 的動作狀態機
//（pendingAction / actionBusy / actionErr + runAction；pendingTriggerKey / triggerBusy / triggerErr +
// confirmTrigger），原文搬移——GlobalConversionPane（Task 4）與 ObjectDetailPane（Task 5）共用同一份
// 動作邏輯，避免兩 pane 各寫一份漂移。load / loadRecords 由呼叫端（useConversionData）注入，故本 hook
// 不自持資料層；證據型刷新（runAction 後 load()、confirmTrigger 後 loadRecords()）打在注入的函式上。
// 誠實鐵律語意全保留：actionBusyRef/triggerBusyRef 同步防重入、actionErr 顯示在 dialog 內不關 dialog、
// watch-toggle 的 mwOk 分支誠實錯誤、jobsOk 重抓失敗誠實錯誤、confirmTrigger 失敗顯 inline error 不關 dialog。
import { useCallback, useRef, useState } from "react";
import { t } from "../i18n";
import { coordinatorClient } from "../coordinatorClient";
import type { ConversionData } from "./useConversionData";

export interface ConversionActions {
  // conv-prioritize-retry：列控制（插隊／重試）與 watch-toggle 的 intent→confirm 狀態。
  pendingAction:
    | { jobId: string; kind: "prioritize" | "retry" }
    | { kind: "watch-toggle"; enabled: boolean }
    | null;
  setPendingAction(a: ConversionActions["pendingAction"]): void;
  actionBusy: boolean;
  actionErr: string | null;
  setActionErr(e: string | null): void;
  runAction(reason: string): Promise<void>; // 原 CV runAction 原文（actionBusyRef 防重入、證據型刷新、watch-toggle mwOk 分支）
  // Task 8（AC6(b)）：ledger 列「未轉/failed」一鍵觸發鈕的 intent→confirm 狀態（走 POST /api/conversion/trigger）。
  pendingTriggerKey: string | null;
  setPendingTriggerKey(k: string | null): void;
  triggerBusy: boolean;
  triggerErr: string | null;
  setTriggerErr(e: string | null): void;
  confirmTrigger(reason: string): Promise<void>; // 原 CV confirmTrigger 原文（triggerBusyRef 防重入、forceRetrigger、成功 loadRecords）
}

export function useConversionActions(
  load: ConversionData["load"],
  loadRecords: ConversionData["loadRecords"],
): ConversionActions {
  const [pendingAction, setPendingAction] = useState<ConversionActions["pendingAction"]>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // finding #1：同步 busy guard。setActionBusy(true) 是非同步 state，confirm 鈕的 disabled={busy}
  // 要等下一次 render 才生效；同一事件循環連點兩次會送出兩個 POST。ref 在 React state 更新前同步攔截第二次。
  const actionBusyRef = useRef(false);
  // finding #2：action 錯誤獨立 state，顯示在 dialog 內、與 dialog 綁定，不與 load 錯誤（err）共用。
  // load() 開頭的 setErr(null) 因此不會把「控制動作失敗」清掉。
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [pendingTriggerKey, setPendingTriggerKey] = useState<string | null>(null);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerErr, setTriggerErr] = useState<string | null>(null);
  // quality finding Important #1：與 runAction 的 actionBusyRef 同步防重入 pattern 對齊。
  const triggerBusyRef = useRef(false);

  const runAction = useCallback(async (reason: string) => {
    if (!pendingAction) return;
    if (actionBusyRef.current) return; // finding #1：同步攔截重入（React state 尚未更新前）
    actionBusyRef.current = true;
    setActionBusy(true);
    setActionErr(null);             // 開新一輪動作：清掉上一次的誠實錯誤
    try {
      if (pendingAction.kind === "prioritize") await coordinatorClient.conversionPrioritize(pendingAction.jobId, reason);
      else if (pendingAction.kind === "retry") await coordinatorClient.conversionRetry(pendingAction.jobId, reason);
      else if (pendingAction.kind === "watch-toggle") await coordinatorClient.conversionWatchToggle(pendingAction.enabled, reason);
      // 證據型更新：重抓真佇列狀態（非樂觀）。load() 自吞錯不 throw，故以回傳值辨識
      // 「POST 成功但重抓佇列失敗」——此時不可靜默關 dialog，改保持 dialog 開啟並在 dialog 內顯誠實錯誤。
      const { jobsOk, mwOk } = await load();
      if (!jobsOk) {
        setActionErr(t("動作已送出，但重新抓取佇列失敗；佇列可能仍顯示舊狀態，請關閉後按「Refresh queue」確認最新狀態（後端動作為冪等，重按確認不會重複生效）。", "The action was submitted, but re-fetching the queue failed; the queue may still show the old state. Please close this and click \"Refresh queue\" to confirm the latest state (the backend action is idempotent, so confirming again has no duplicate effect)."));
        return;                     // 不關 dialog、不視為完成
      }
      // important #1：watch-toggle 成功但 watcher 狀態重抓失敗時，jobsOk 仍 true，但 mw 未更新，
      // 琥珀條與 Panel 停在舊值。不可靜默關 dialog（操作者會誤以為開關已生效），改顯誠實錯誤要求重按 Refresh。
      if (pendingAction.kind === "watch-toggle" && !mwOk) {
        setActionErr(t("動作已送出，但重新抓取 watcher 狀態失敗；自動偵測狀態與頁頂提示可能仍顯示舊值，請關閉後按「Refresh queue」確認最新狀態（後端動作為冪等，重按確認不會重複生效）。", "The action was submitted, but re-fetching the watcher status failed; the auto-detection status and the top-of-page banner may still show old values. Please close this and click \"Refresh queue\" to confirm the latest state (the backend action is idempotent, so confirming again has no duplicate effect)."));
        return;                     // 不關 dialog、不視為完成
      }
      setPendingAction(null);       // 動作成功且狀態已刷新才關 dialog
    } catch (e) {
      setActionErr(`${t("控制動作失敗：", "Control action failed: ")}${String(e)}`); // finding #2：寫獨立 actionErr（顯示在 dialog 內），不關 dialog、不改狀態
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }, [pendingAction, load]);

  // Task 8（AC6(b)）：ledger 列「觸發轉檔」鈕的 confirm handler。走 main 已合併的 triggerConversion
  //（POST /api/conversion/trigger，force_retrigger=true）；成功後 loadRecords() 由 ledger 真值對齊 chip
  //（ledger 為狀態真相來源，誠實鐵律，非樂觀 patch）。失敗顯 inline error、不關 dialog、ledger 不變。
  const confirmTrigger = useCallback(async (_reason: string) => {
    if (!pendingTriggerKey) return;
    if (triggerBusyRef.current) return; // finding #1：同步攔截重入（React state 尚未更新前）
    triggerBusyRef.current = true;
    setTriggerErr(null);
    setTriggerBusy(true);
    try {
      await coordinatorClient.triggerConversion(pendingTriggerKey, { forceRetrigger: true });
      void loadRecords();           // ledger 真值對齊：重抓 ledger（main trigger 已 server-side 落帳）
      setPendingTriggerKey(null);   // 成功才關 dialog
    } catch (e) {
      setTriggerErr(`${t("觸發轉檔失敗：", "Trigger conversion failed: ")}${String(e)}`); // 失敗顯 inline error、ledger 不變、不關 dialog
    } finally {
      triggerBusyRef.current = false;
      setTriggerBusy(false);
    }
  }, [pendingTriggerKey, loadRecords]);

  return {
    pendingAction, setPendingAction, actionBusy, actionErr, setActionErr, runAction,
    pendingTriggerKey, setPendingTriggerKey, triggerBusy, triggerErr, setTriggerErr, confirmTrigger,
  };
}
