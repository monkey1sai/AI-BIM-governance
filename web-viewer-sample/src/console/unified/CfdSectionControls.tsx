import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { controlField } from "./controlStyles";
import { CfdSectionSession, type CfdSection, type SectionStep } from "./cfdSections";
import type { CfdRunDirectionResult } from "./cfdClient";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";

export function CfdSectionControls({ artifactId, direction, ready, commands, onApplied, onActive }: {
  artifactId: string; direction: CfdRunDirectionResult; ready: boolean; commands: ViewerCommandPort;
  onApplied(section: CfdSection | null): void; onActive(active: boolean): void;
}) {
  const [steps, setSteps] = useState<SectionStep[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ onApplied, onActive }); callbacks.current = { onApplied, onActive };
  const session = useMemo(() => new CfdSectionSession(commands, artifactId, direction, step => {
    setSteps(previous => [...previous.filter(item => item.name !== step.name), step]);
  }), [commands, artifactId, direction, ready]);
  useEffect(() => {
    setBusy(false); setSteps([]); setError(null);
    return () => { session.invalidate(); callbacks.current.onApplied(null); callbacks.current.onActive(false); };
  }, [session]);
  const sections = direction.presentation?.sections ?? [];
  if (!sections.length) return null;
  const operate = async (section: CfdSection | null) => {
    setBusy(true); setError(null); setSteps([]); callbacks.current.onApplied(null); callbacks.current.onActive(true);
    try {
      if (section) await session.enter(section); else await session.leave();
      if (session.isValid) callbacks.current.onApplied(section);
    } catch (failure) { if (session.isValid) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (session.isValid) { setBusy(false); callbacks.current.onActive(session.active); } }
  };
  return <fieldset data-testid="wind-section-controls" style={{ display: "grid", gap: 6 }}>
    <legend>{t("剖面檢視", "Section view")}</legend>
    <small>{t("模型 X／Y／Z 軸向；建物內部為實體（外部風場，未模擬室內）。", "Model X/Y/Z axes; buildings are solid obstacles (external flow, no indoor simulation).")}</small>
    {sections.map(section => <button key={section.id} data-testid={`wind-section-view-${section.id}`} style={controlField}
      disabled={!ready || busy || section.polygons === 0} onClick={() => { void operate(section); }}>
      {section.label} · {section.position_m.toFixed(2)} m · {t(section.source === "requested" ? "自訂" : "標準", section.source === "requested" ? "Custom" : "Standard")}
      {section.polygons === 0 ? t("（無取樣面）", " (no sampled faces)") : ""}
    </button>)}
    <button data-testid="wind-section-leave" style={controlField} disabled={!ready || busy || !session.active}
      onClick={() => { void operate(null); }}>{t("離開剖面，還原原視角與圖層", "Leave section; restore original view and layers")}</button>
    <ol data-testid="wind-section-steps" aria-live="polite">{steps.map(step => <li key={step.name} data-state={step.status}>
      {step.name} · {t(step.status === "pending" ? "等待 Kit" : step.status === "applied" ? "Kit 已確認" : "未完成",
        step.status === "pending" ? "Waiting for Kit" : step.status === "applied" ? "Confirmed by Kit" : "Incomplete")}
    </li>)}</ol>
    {error ? <small role="alert">{error}{session.active ? t(" 可按離開還原已變更的狀態。", " Leave to restore the changes already made.") : ""}</small> : null}
  </fieldset>;
}
