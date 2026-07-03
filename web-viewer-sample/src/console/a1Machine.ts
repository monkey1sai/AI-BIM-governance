// A1 五步治理閉環狀態機(純函式,無 React/IO)。對齊 docs/plans 互動規格 IX-A1(B.1)。
// 證據型更新(PATTERN-EVIDENCE-UPDATE):state 只在伺服器確認後前進;重跑清下游記分但保留已落地 artifact。
import type { RuleRunStatus, RuleResultRow } from "./governanceClient";

export type A1Step = "idle" | "picked" | "running" | "scored" | "issued" | "delivered";

export interface A1State {
  step: A1Step;
  ifcPath: string;
  run: RuleRunStatus | null;
  failed: RuleResultRow[];
  issueCount: number | null;
  exported: boolean;
  /** 獨立旗標：是否曾透過 CREATE_ISSUES_OK 真正建過 Issue（BCF gating 用；step 進 delivered 不清零）。 */
  issuesCreated: boolean;
  /** 獨立旗標：是否曾透過 BCF_EXPORT_OK 完成 BCF 匯出（可見成功 artifact）。 */
  bcfExported: boolean;
  error: string | null;
  runError: boolean;
}

export const initialA1State: A1State = {
  step: "idle", ifcPath: "", run: null, failed: [],
  issueCount: null, exported: false, issuesCreated: false, bcfExported: false,
  error: null, runError: false,
};

export type A1Event =
  | { type: "PICK_FILE"; ifcPath: string }
  | { type: "RUN" }
  | { type: "RUN_RETRY" }
  | { type: "RUN_PROGRESS"; run: RuleRunStatus }
  | { type: "RUN_DONE"; run: RuleRunStatus; failed: RuleResultRow[] }
  | { type: "RUN_FAIL"; error: string }
  | { type: "CREATE_ISSUES_OK"; issueCount: number }
  | { type: "EXPORT_OK" }
  | { type: "BCF_EXPORT_OK" }
  | { type: "RESET" };

export function a1Reducer(state: A1State, event: A1Event): A1State {
  switch (event.type) {
    case "PICK_FILE":
      return { ...initialA1State, step: event.ifcPath ? "picked" : "idle", ifcPath: event.ifcPath };
    case "RUN":
      if (state.step === "idle" || !state.ifcPath) return state;
      // 已在 running 時忽略再次 RUN(雙擊/誤觸):否則 run 被清成 null 但 step 仍 running,
      // 讓上一輪尚未結束的 poll callback 之 RUN_DONE/RUN_FAIL 通過守門寫入髒結果污染新 run。
      // 重跑語意(spec §2.1/§5)只允許從已完成步(picked/scored/issued/delivered)重觸發。
      if (state.step === "running") return state;
      return { ...state, step: "running", run: null, failed: [], error: null, runError: false };
    case "RUN_RETRY":
      // RUN_FAIL 後的 running-error 子態(step 仍 running 但 runError=true)專用重試入口。
      // plain RUN 在 running 是 no-op(防雙擊/in-flight poll 污染),所以「可重試」UI 必須走此事件
      // 才能真的重開一輪;守門 runError=true 確保只在錯誤子態前進,健康 running / 非 running 態皆 no-op。
      if (state.step !== "running" || !state.runError) return state;
      return { ...state, step: "running", run: null, failed: [], error: null, runError: false };
    case "RUN_PROGRESS":
      return state.step === "running" ? { ...state, run: event.run } : state;
    case "RUN_DONE":
      if (state.step !== "running") return state;
      return { ...state, step: "scored", run: event.run, failed: event.failed, runError: false, error: null };
    case "RUN_FAIL":
      if (state.step !== "running") return state;
      return { ...state, step: "running", runError: true, error: event.error };
    case "CREATE_ISSUES_OK":
      if (!["scored", "issued", "delivered"].includes(state.step)) return state;
      return { ...state, step: state.step === "scored" ? "issued" : state.step, issueCount: event.issueCount, issuesCreated: true };
    case "EXPORT_OK":
      if (!["scored", "issued", "delivered"].includes(state.step)) return state;
      return { ...state, step: "delivered", exported: true };
    case "BCF_EXPORT_OK":
      // BCF 匯出成功：記錄可見成功旗標（不改 step 語意，step 應已在 issued/delivered）。
      return { ...state, bcfExported: true };
    case "RESET":
      return initialA1State;
    default:
      return state;
  }
}

export type StepDot = "done" | "current" | "future";

export function uiSteps(state: A1State): StepDot[] {
  // 五個 UI 圓點:[選檔, 自動檢核, 結果記分板, 開 Issue, 匯出]。
  // currentUi = 當前「綠圈」的點 index;其左側皆 done(綠勾)、右側皆 future(灰)。
  // 對齊 spec §2.1「已完成=綠勾、當前=綠圈」與 Scenario「上傳完成自動亮步驟2」:
  //   picked  → 模型已選定(第1點 done)、自動檢核為當前(第2點 current)        → currentUi=1
  //   running → 自動檢核進行中(第2點 current)                                  → currentUi=1
  //   scored  → 記分板已產出(第3點 current)                                    → currentUi=2
  //   issued  → 已開 Issue(第4點 current)                                       → currentUi=3
  //   delivered → 匯出完成,五點全綠勾(終態末點 done 而非 current)             → 全 done
  // (舊式 order-1 會讓 picked 的第1點誤標 current 而非 done,違反上述 Scenario。)
  const CURRENT_UI: Record<A1Step, number> = {
    idle: -1, picked: 1, running: 1, scored: 2, issued: 3, delivered: 5,
  };
  const currentUi = CURRENT_UI[state.step];
  return [0, 1, 2, 3, 4].map((i) => (i < currentUi ? "done" : i === currentUi ? "current" : "future"));
}
