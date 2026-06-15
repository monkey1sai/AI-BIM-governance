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
  error: string | null;
  runError: boolean;
}

export const initialA1State: A1State = {
  step: "idle", ifcPath: "", run: null, failed: [],
  issueCount: null, exported: false, error: null, runError: false,
};

export type A1Event =
  | { type: "PICK_FILE"; ifcPath: string }
  | { type: "RUN" }
  | { type: "RUN_PROGRESS"; run: RuleRunStatus }
  | { type: "RUN_DONE"; run: RuleRunStatus; failed: RuleResultRow[] }
  | { type: "RUN_FAIL"; error: string }
  | { type: "CREATE_ISSUES_OK"; issueCount: number }
  | { type: "EXPORT_OK" }
  | { type: "RESET" };

const STEP_ORDER: A1Step[] = ["idle", "picked", "running", "scored", "issued", "delivered"];

export function a1Reducer(state: A1State, event: A1Event): A1State {
  switch (event.type) {
    case "PICK_FILE":
      return { ...initialA1State, step: event.ifcPath ? "picked" : "idle", ifcPath: event.ifcPath };
    case "RUN":
      if (!state.ifcPath) return state;
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
      return { ...state, step: state.step === "scored" ? "issued" : state.step, issueCount: event.issueCount };
    case "EXPORT_OK":
      if (!["scored", "issued", "delivered"].includes(state.step)) return state;
      return { ...state, step: "delivered", exported: true };
    case "RESET":
      return initialA1State;
    default:
      return state;
  }
}

export type StepDot = "done" | "current" | "future";

export function uiSteps(state: A1State): StepDot[] {
  const order = STEP_ORDER.indexOf(state.step);
  const currentUi = order === 0 ? -1 : order - 1;
  return [0, 1, 2, 3, 4].map((i) => (i < currentUi ? "done" : i === currentUi ? "current" : "future"));
}
