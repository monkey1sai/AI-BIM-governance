// Viewer Gate（docs/architecture/viewport-slot-adr.md §2）：viewer 能不能接受指令的判定，以代碼表示。
// ReviewSessionViewerPane 由 viewer 證據一次算出兩個判定：command 決定工具列與 viewer 指令；batch 在 command 之上
// 再加 mapping 過期，決定 A2 批次高亮與 A1 問題檢視。顯示文字與導引階段都由代碼推導，不再比對文案。
import { t } from "./i18n";

export type ViewerGateReason =
  | "no_session"
  | "session_not_observed"
  | "lease_not_active"
  | "waiting_first_frame"
  | "waiting_datachannel"
  | "stage_mismatch"
  | "mapping_stale"
  | "coordinator_offline"
  | "model_mismatch";

/** A pass, or a refusal with its reason code (`detail`: the mapping's stale reason, or another verdict-specific note). */
export type GateVerdict<R extends string = ViewerGateReason> = { ok: true } | { ok: false; reason: R; detail?: string };

export interface ViewerGate {
  /** The toolbar and the viewer commands (camera, section plane, fly, overlay style, measurement, stage binding). */
  command: GateVerdict;
  /** A2 batch highlight and the A1 issue view: `command`, and additionally refused while the element mapping is stale. */
  batch: GateVerdict;
}

/** What the pane observes about the viewer, in the order the gate checks it. */
export interface ViewerGateEvidence {
  validSession: boolean;
  sessionObserved: boolean;
  activePrimaryLease: boolean;
  firstFrame: boolean;
  dataChannelReady: boolean;
  stageMatched: boolean;
  mappingStale: boolean;
  /** Why the mapping is stale, from artifact health. */
  mappingStaleReason?: string | null;
}

export function resolveViewerGate(evidence: ViewerGateEvidence): ViewerGate {
  const command: GateVerdict = !evidence.validSession ? { ok: false, reason: "no_session" }
    : !evidence.sessionObserved ? { ok: false, reason: "session_not_observed" }
      : !evidence.activePrimaryLease ? { ok: false, reason: "lease_not_active" }
        : !evidence.firstFrame ? { ok: false, reason: "waiting_first_frame" }
          : !evidence.dataChannelReady ? { ok: false, reason: "waiting_datachannel" }
            : !evidence.stageMatched ? { ok: false, reason: "stage_mismatch" }
              : { ok: true };
  const batch: GateVerdict = evidence.mappingStale
    ? { ok: false, reason: "mapping_stale", detail: evidence.mappingStaleReason ?? "derived_artifact_unreachable" }
    : command;
  return { command, batch };
}

/** Both verdicts refused for one reason: the host while the coordinator is offline, A1 while another session is shown. */
export function refusedViewerGate(reason: ViewerGateReason): ViewerGate {
  const verdict: GateVerdict = { ok: false, reason };
  return { command: verdict, batch: verdict };
}

function sameGateVerdict(left: GateVerdict, right: GateVerdict): boolean {
  if (left.ok || right.ok) return left.ok === right.ok;
  return left.reason === right.reason && left.detail === right.detail;
}

export function sameViewerGate(left: ViewerGate, right: ViewerGate): boolean {
  return sameGateVerdict(left.command, right.command) && sameGateVerdict(left.batch, right.batch);
}

/** The text shown for a verdict; "" when it passes (or when there is no verdict yet). */
export function viewerGateText(verdict: GateVerdict | null | undefined): string {
  if (!verdict || verdict.ok) return "";
  switch (verdict.reason) {
    case "no_session":
      return t("尚未輸入有效 review session", "enter a valid review session first");
    case "session_not_observed":
      return t("runtime/status 未列出此 session（可能 stale / 已關閉）", "runtime/status does not list this session (possibly stale / closed)");
    case "lease_not_active":
      return t("需先手動啟動 / attach Kit session", "manually start / attach the Kit session first");
    case "waiting_first_frame":
      return t("等待 3D 第一幀", "waiting for first frame");
    case "waiting_datachannel":
      return t("等待 viewer DataChannel", "waiting for viewer DataChannel");
    case "stage_mismatch":
      return t("stage 未對齊，禁止誤標", "stage mismatch; highlight is blocked");
    case "mapping_stale":
      return `mapping_reachable=false: ${verdict.detail ?? "derived_artifact_unreachable"}`;
    case "coordinator_offline":
      return t("coordinator runtime/status 已離線", "coordinator runtime/status is offline");
    case "model_mismatch":
      // A1 has only ever shown this one in Chinese.
      return "目前 3D Session 與這份檢核結果不同，請先選擇一致的 Session。";
    default: {
      const unhandled: never = verdict.reason;
      return unhandled;
    }
  }
}

/** Guide phase of the viewer, read from the command verdict (never from its text). */
export type ViewerPhase = "no-session" | "session-selected" | "lease-pending" | "waiting-first-frame" | "waiting-datachannel" | "stage-mismatch" | "blocked" | "ready";

export function classifyViewerPhase(activeSessionId: string, gate: ViewerGate | null): ViewerPhase {
  if (!activeSessionId) return "no-session";
  if (!gate) return "session-selected";
  const verdict = gate.command;
  if (verdict.ok) return "ready";
  switch (verdict.reason) {
    case "lease_not_active":
      return "lease-pending";
    case "waiting_first_frame":
      return "waiting-first-frame";
    case "waiting_datachannel":
      return "waiting-datachannel";
    case "stage_mismatch":
      return "stage-mismatch";
    default:
      return "blocked";
  }
}
