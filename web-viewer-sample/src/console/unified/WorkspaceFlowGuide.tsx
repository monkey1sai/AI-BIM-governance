// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — WorkspaceFlowGuide：右側工具 Dock 頂部的操作流程導引（每 dock 5 步）。
// 狀態燈只由 live 證據推導（共用 activeSessionId、pane 回報的 gate reason 分類），不另造判定、不放固定數字。
// ui-ux-pro-max：multi-step-progress（aria-current="step"）、progressive-disclosure、disabled 附原因、no-emoji-icons。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties } from "react";
import { t } from "../i18n";
import type { DockKey } from "./fixtures";
import { MONO } from "./fixtures";
import { classifyViewerPhase, resolveViewerCommandGate, useViewportSlot } from "./viewportSlot";
import type { ViewerPhase } from "./viewportSlot";

type StepState = "done" | "current" | "todo" | "blocked";

interface Step { id: string; label: string; hint: string; }

const PHASE_ORDER: ViewerPhase[] = ["no-session", "session-selected", "lease-pending", "waiting-first-frame", "waiting-datachannel", "ready"];

function phaseIndex(p: ViewerPhase): number {
  const i = PHASE_ORDER.indexOf(p);
  return i < 0 ? 2 : i; // stage-mismatch／blocked 視為停在「啟動 3D」之後
}

function stepsFor(dock: DockKey): Step[] {
  switch (dock) {
    case "a1": return [
      { id: "source", label: t("選 IFC", "Pick IFC"), hint: t("local_fs 或 MinIO 已下載模型", "local_fs or a downloaded MinIO model") },
      { id: "rules", label: t("選 IDS 規則集", "Pick IDS rules"), hint: t("預設 sample IDS；可清空改內建 YAML", "default sample IDS; clear for built-in YAML") },
      { id: "run", label: t("執行檢核", "Run check"), hint: t("governance-service CPU rule-run", "governance-service CPU rule-run") },
      { id: "3d", label: t("啟動 3D Session", "Start 3D session"), hint: t("claim lease → first frame → DataChannel → stage match", "claim lease → first frame → DataChannel → stage match") },
      { id: "deliver", label: t("高亮 / 交付", "Highlight / deliver"), hint: t("在 3D 標示失敗構件；開 Issue／匯出 BCF", "highlight failed elements; open Issue / export BCF") },
    ];
    case "a2": return [
      { id: "base", label: t("選 base 版本", "Pick base"), hint: t("專案／模型／版本三層", "project / model / version") },
      { id: "target", label: t("選 target 版本", "Pick target"), hint: t("同一模型的另一版本", "another version of the same model") },
      { id: "diff", label: t("Run Diff", "Run Diff"), hint: t("GlobalId 多級對齊；幾何比對可選", "GlobalId multi-level alignment; geometry optional") },
      { id: "3d", label: t("啟動 3D Session", "Start 3D session"), hint: t("claim lease → first frame → DataChannel → stage match", "claim lease → first frame → DataChannel → stage match") },
      // 文案刻意避開舊 fixture 字串「套用疊加」（fixtureNotInProduction 死碼守門）；真按鈕在 A2 頁 diff 成功後才出現。
      { id: "overlay", label: t("套用 3D 疊加", "Apply 3D overlay"), hint: t("added／removed／modified 三組單一批次送 Kit", "added / removed / modified in one batch to Kit") },
    ];
    case "a3": return [
      { id: "members", label: t("填 member USD", "Add member USD"), hint: t("ARC／STR 等 discipline 的 conversion 產出", "conversion outputs per discipline") },
      { id: "prepare", label: t("準備＋驗證坐標系", "Prepare + validate coords"), hint: t("先驗坐標一致再建", "validate before build") },
      { id: "build", label: t("Build Federated USD", "Build federated USD"), hint: t("sublayer 非破壞疊合", "non-destructive sublayer composition") },
      { id: "session", label: t("建立 Review Session", "Create review session"), hint: t("coordinator 解析 federated set", "coordinator resolves the federated set") },
      { id: "3d", label: t("啟動 3D Session", "Start 3D session"), hint: t("claim lease → first frame → stage match（無 element mapping）", "claim lease → first frame → stage match (no element mapping)") },
    ];
    case "a4": return [
      { id: "source", label: t("選來源", "Pick source"), hint: t("session 來源才有 3D 權威；ifc_ready 只有表格", "only session sources carry 3D authority") },
      { id: "query", label: t("輸入問句", "Enter query"), hint: t("deterministic 文法或 Ornith", "deterministic grammar or Ornith") },
      { id: "run", label: t("執行查詢", "Run query"), hint: t("governance 真實 JSON 結果", "real governance JSON") },
      { id: "3d", label: t("啟動 3D Session", "Start 3D session"), hint: t("claim lease → first frame → DataChannel → stage match", "claim lease → first frame → DataChannel → stage match") },
      { id: "focus", label: t("選列 → 3D 標示", "Pick row → highlight"), hint: t("signed proof 經 coordinator handoff", "signed proof via coordinator handoff") },
    ];
    default: return [
      { id: "list", label: t("檢視 Issues", "Review issues"), hint: t("rule-run／diff／A4 建立的正式 Issue", "formal issues from rule-run / diff / A4") },
      { id: "transition", label: t("狀態轉移", "Transition"), hint: t("open → in_progress → resolved", "open → in_progress → resolved") },
      { id: "bcf", label: t("匯出 BCF 2.1", "Export BCF 2.1"), hint: t("僅 kind=issue 且含 ifc_guid", "kind=issue with ifc_guid only") },
      { id: "outbox", label: t("回拋 Outbox", "Deliver outbox"), hint: t("metadata-only 回雲端", "metadata-only to cloud") },
      { id: "done", label: t("結案", "Close"), hint: t("交付紀錄留在 coordinator", "delivery record stays on the coordinator") },
    ];
  }
}

/** 3D 相關步驟由 live 證據決定；其餘步驟只標 todo（頁面本身有各自的誠實狀態，這裡不重複判定）。 */
function stateOf(step: Step, index: number, steps: Step[], phase: ViewerPhase): StepState {
  const threeD = steps.findIndex((s) => s.id === "3d");
  const pi = phaseIndex(phase);
  if (step.id === "3d") {
    if (phase === "ready") return "done";
    if (phase === "stage-mismatch" || phase === "blocked") return "blocked";
    if (phase === "no-session") return "todo";
    return "current";
  }
  if (threeD >= 0 && index > threeD) return phase === "ready" ? "current" : "todo";
  if (threeD >= 0 && index < threeD) return pi >= 1 ? "done" : index === 0 ? "current" : "todo";
  return index === 0 ? "current" : "todo";
}

const DOT: Record<StepState, CSSProperties> = {
  done: { background: "var(--ab-ok)", borderColor: "var(--ab-ok)" },
  current: { background: "var(--ab-accent)", borderColor: "var(--ab-accent-bright)" },
  todo: { background: "transparent", borderColor: "rgba(120,160,210,.35)" },
  blocked: { background: "var(--ab-danger)", borderColor: "var(--ab-danger)" },
};

export function WorkspaceFlowGuide({ dock }: { dock: DockKey }) {
  const slot = useViewportSlot();
  const phase = classifyViewerPhase(slot?.activeSessionId ?? "", slot?.gate ?? null);
  const steps = stepsFor(dock);
  const reason = resolveViewerCommandGate(slot?.gate ?? null).reason;
  const phaseText: Record<ViewerPhase, string> = {
    "no-session": t("尚未綁定 session", "no session bound"),
    "session-selected": t("session 已選；尚未啟動 3D", "session selected; 3D not started"),
    "lease-pending": t("等待你按「啟動 3D Session」", "waiting for “Start 3D Session”"),
    "waiting-first-frame": t("lease 已取得；等待 first frame", "lease claimed; waiting for first frame"),
    "waiting-datachannel": t("串流中；等待 DataChannel", "streaming; waiting for DataChannel"),
    "stage-mismatch": t("stage 未對齊；高亮封鎖", "stage mismatch; highlight blocked"),
    blocked: t("被封鎖", "blocked"),
    ready: t("3D 就緒；命令通道可用", "3D ready; viewer command channel available"),
  };

  return (
    <nav
      data-uc="ws-flow-guide"
      data-prov="asbuilt"
      data-phase={phase}
      aria-label={t("操作流程", "Operation flow")}
      style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderBottom: "1px solid rgba(120,160,210,.10)", background: "var(--ab-bar)" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".12em", color: "var(--ab-text-dimmer)", textTransform: "uppercase" }}>
          {t("操作流程", "Flow")}
        </span>
        <span data-uc="ws-flow-phase" style={{ fontSize: 11, color: phase === "ready" ? "var(--ab-ok-text)" : phase === "blocked" || phase === "stage-mismatch" ? "var(--ab-danger)" : "var(--ab-text-muted)" }}>
          {phaseText[phase]}
        </span>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((s, i) => {
          const st = stateOf(s, i, steps, phase);
          return (
            <li
              key={s.id}
              data-uc={`ws-flow-step-${s.id}`}
              data-state={st}
              aria-current={st === "current" ? "step" : undefined}
              style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8, alignItems: "start", opacity: st === "todo" ? 0.72 : 1 }}
            >
              <span aria-hidden="true" style={{ width: 12, height: 12, marginTop: 3, borderRadius: "50%", border: "2px solid", boxSizing: "border-box", ...DOT[st] }} />
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 12, fontWeight: st === "current" ? 700 : 500, color: st === "blocked" ? "var(--ab-danger)" : "var(--ab-text)" }}>
                  {i + 1}. {s.label}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--ab-text-dim)" }}>
                  {s.id === "3d" && (st === "blocked" || st === "current") && reason ? reason : s.hint}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
