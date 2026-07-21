// C3 slice 1：useRuleRun 共用 hook——設計正本 §03「A1–A4 邏輯住進共用 hooks」的第一個落地。
// 包住「來源選擇 → governanceClient.createRuleRun*（direct / for-session / for-ifc-ready / for-library）
// → pollGen 輪詢 getRuleRun 至終態 → failed results 載入」，重用 a1Machine reducer（證據型更新，
// state 只在伺服器確認後前進）。
//
// 輪詢刻意沿用 A1GovernanceWorkbenchPage 現行 pollGen 模式（另一條 stream 的 usePolledResource
// 尚未合併，不得依賴）：
// - pollGen 在 (a) 元件 unmount、(b) step 離開 running（PICK_FILE/RESET 重置）時遞增，
//   讓 in-flight 輪詢迴圈以「自己的 generation 已失效」中斷，避免 unmount 後仍每秒發
//   getRuleRun 的資源洩漏（最多 60 次）。reducer 守門已防髒資料寫入，此處再防無謂請求。
// - 開跑前捕捉 generation；不可在任何 await 之後重新捕捉，否則 await 視窗內 dispatch
//   PICK_FILE 遞增的新 gen 會被抓回來，守門永遠通過、舊輪詢繼續打（qr-t2-pollgen-race）。
// - in-progress 白名單：只有 queued/running 才續輪詢；任何 terminal status（含後端回的
//   型別 union 外 errored/cancelled）即時中斷，不空轉 60 次（qr-t2-terminal-status-whitelist）。
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Dispatch } from "react";
import { a1Reducer, initialA1State } from "../a1Machine";
import type { A1Event, A1State } from "../a1Machine";
import { governanceClient } from "../governanceClient";
import type { LibraryRuleRunRequest, RuleResultRow, RuleRunRequest, RuleRunStatus } from "../governanceClient";

/** rule-run 來源四形（對映 governanceClient 的四條 create 路由；邊界 B1：
    真 IFC path 一律由 coordinator server-side 解析，direct 形僅供手填/測試路徑）。 */
export type RuleRunSource =
  | { kind: "direct"; request: RuleRunRequest }
  | { kind: "for-session"; sessionId: string; body?: { ids_path?: string; rule_set?: string } }
  | { kind: "for-ifc-ready"; ifcReadyJobId: string; body?: { ids_path?: string; rule_set?: string } }
  | { kind: "for-library"; request: LibraryRuleRunRequest };

export interface RuleRunOptions {
  /** run 前置檢查（如 ifc-ready artifact 新鮮度重驗）。回錯誤字串 → RUN_FAIL 並中止；
      回 null → 繼續。丟例外走 catch → RUN_FAIL String(e)（與現行頁面行為一致）。 */
  preflight?: () => Promise<string | null>;
  /** RUN_DONE 前對 failed rows 的 enrichment（如 session mapping 補 usd_prim_path）。
      best-effort：丟例外時保留原 rows，不阻斷 RUN_DONE（與現行頁面行為一致）。 */
  enrichFailed?: (failed: RuleResultRow[]) => Promise<RuleResultRow[]>;
}

/** run() 的誠實結果：呼叫端據此做來源特定的後續（如 MinIO 歷史 refresh tick）。
    cancelled = generation 失效（unmount / PICK_FILE / RESET），不代表成功或失敗。 */
export type RuleRunOutcome =
  | { kind: "not_ready" }
  | { kind: "cancelled" }
  | { kind: "preflight_failed"; error: string }
  | { kind: "succeeded"; run: RuleRunStatus; failed: RuleResultRow[] }
  | { kind: "failed"; run: RuleRunStatus | null; error: string };

export interface UseRuleRun {
  state: A1State;
  dispatch: Dispatch<A1Event>;
  runId: string | null;
  run: (source: RuleRunSource, options?: RuleRunOptions) => Promise<RuleRunOutcome>;
}

const POLL_MAX_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1000;

function createRuleRunFor(source: RuleRunSource): Promise<{ rule_run_id: string; status: string }> {
  switch (source.kind) {
    case "for-session":
      return governanceClient.createRuleRunForSession(source.sessionId, source.body);
    case "for-ifc-ready":
      return governanceClient.createRuleRunForIfcReady(source.ifcReadyJobId, source.body);
    case "for-library":
      return governanceClient.createRuleRunForLibrary(source.request);
    default:
      return governanceClient.createRuleRun(source.request);
  }
}

export function useRuleRun(): UseRuleRun {
  const [state, dispatch] = useReducer(a1Reducer, initialA1State);
  // run() 需要當前 step/runError 決定 RUN vs RUN_RETRY；render 期同步鏡射避免 stale closure。
  const stateRef = useRef(state);
  stateRef.current = state;

  const pollGenRef = useRef(0);
  useEffect(() => () => { pollGenRef.current += 1; }, []);
  useEffect(() => { if (state.step !== "running") pollGenRef.current += 1; }, [state.step]);

  const run = useCallback(async (source: RuleRunSource, options?: RuleRunOptions): Promise<RuleRunOutcome> => {
    const cur = stateRef.current;
    // 呼叫端（頁面/dock）本就先 gate；此為 hook 自我保護——idle / 未選檔時 RUN 在 reducer
    // 是 no-op，若仍前進會發出無狀態機承接的請求（污染後端），誠實回 not_ready。
    if (cur.step === "idle" || !cur.ifcPath) return { kind: "not_ready" };
    // running-error 子態（RUN_FAIL 後 step 仍 running、runError=true）的重試走 RUN_RETRY；
    // 否則 plain RUN 在 running 是 no-op（防雙擊污染），「可重試」按鈕會點了沒反應（spec §5）。
    dispatch({ type: cur.step === "running" && cur.runError ? "RUN_RETRY" : "RUN" });
    const myGen = pollGenRef.current;
    const cancelled = () => pollGenRef.current !== myGen;
    try {
      if (options?.preflight) {
        const preflightError = await options.preflight();
        if (cancelled()) return { kind: "cancelled" };
        if (preflightError !== null) {
          dispatch({ type: "RUN_FAIL", error: preflightError });
          return { kind: "preflight_failed", error: preflightError };
        }
      }
      const { rule_run_id } = await createRuleRunFor(source);
      if (cancelled()) return { kind: "cancelled" }; // createRuleRun await 視窗內取消 → 不啟動輪詢
      let st: RuleRunStatus | null = null;
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        if (cancelled()) return { kind: "cancelled" }; // unmount / step 重置 → 中斷輪詢，不再發請求
        st = await governanceClient.getRuleRun(rule_run_id);
        if (cancelled()) return { kind: "cancelled" }; // await 期間失效 → 不再 dispatch
        dispatch({ type: "RUN_PROGRESS", run: st });
        if (st.status !== "queued" && st.status !== "running") break;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (cancelled()) return { kind: "cancelled" };
      if (st && st.status === "succeeded") {
        let failed = await governanceClient.getResults(rule_run_id, "failed");
        if (options?.enrichFailed) {
          try {
            failed = await options.enrichFailed(failed);
          } catch {
            // Enrichment is best-effort：失敗保留原 rows，誠實不阻斷 RUN_DONE。
          }
        }
        if (cancelled()) return { kind: "cancelled" };
        dispatch({ type: "RUN_DONE", run: st, failed });
        return { kind: "succeeded", run: st, failed };
      }
      const error = st ? `rule-run ${st.status}` : "no status";
      dispatch({ type: "RUN_FAIL", error });
      return { kind: "failed", run: st, error };
    } catch (e) {
      if (cancelled()) return { kind: "cancelled" }; // unmount / 重置後吞掉殘餘錯誤，不寫回已卸載 UI
      const error = String(e);
      dispatch({ type: "RUN_FAIL", error });
      return { kind: "failed", run: null, error };
    }
  }, []);

  return { state, dispatch, runId: state.run?.rule_run_id ?? null, run };
}
