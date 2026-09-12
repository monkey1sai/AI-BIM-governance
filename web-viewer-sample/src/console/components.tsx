// 人類操作元件：資料真實性與操作原因可見，工程 provenance 保留於 machine metadata。
import React from "react";
import { t } from "./i18n";
import { Prov, PROV_LABEL, PROV_CLASS } from "./data";

export function ProvTag({ prov }: { prov: Prov }) {
  // A development classification is not runtime or validation evidence.
  // Explicit display:none also wins over the legacy .ec-prov display rule.
  if (prov === "asbuilt" || prov === "artifact") return <span data-prov={prov} hidden aria-hidden="true" style={{ display: "none" }} />;
  const label = prov === "demo" ? t(PROV_LABEL.demo, "DEMO DATA")
    : prov === "p1" || prov === "p15" ? t("尚未提供", "Not available yet")
    : t("規劃中", "Planned");
  return <span className={`ec-prov ${PROV_CLASS[prov]}`} data-prov={prov}>{label}</span>;
}

export function ProvLegend() {
  return (
    <p className="ec-note" aria-label={t("資料來源說明", "Data source guidance")}>
      {t("資料來源：", "Data sources: ")}<ProvTag prov="demo" />{" "}
      {t("僅供參考；實際結果請查看對應來源與審查紀錄。", "is for reference only; consult the corresponding source and review records for actual results.")}
    </p>
  );
}

export function Panel({
  title,
  sub,
  prov,
  actions,
  children,
}: {
  title: string;
  sub?: string;
  prov?: Prov;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="ec-panel">
      <div className="ec-panel-h">
        <span className="ec-t">{title}</span>
        {sub && <span className="ec-s">{sub}</span>}
        <span style={{ flex: 1 }} />
        {prov && <ProvTag prov={prov} />}
        {actions}
      </div>
      <div className="ec-panel-b">{children}</div>
    </section>
  );
}

export function Field({ k, v, prov }: { k: string; v: React.ReactNode; prov?: Prov }) {
  return (
    <div className="ec-field">
      <span className="ec-k">{k}</span>
      <span className="ec-v">
        {v} {prov && <ProvTag prov={prov} />}
      </span>
    </div>
  );
}

export function Metric({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "warn" | "bad" }) {
  return (
    <div>
      <div className={`ec-metric ${tone ?? ""}`}>{value}</div>
      <div className="ec-s">{label}</div>
    </div>
  );
}

// 按鈕強制 caption（說明來源 / 行為），呼應原型誠實契約。
// data-testid 為選用、僅在提供時轉發到 <button>（供 E2E 穩定選取），對既有呼叫者零行為變更。
// title 為選用 tooltip（如 disabled 鈕說明為何不可操作），未提供時 title={undefined} 不渲染屬性，對既有呼叫者零行為變更。
export function Btn({
  children,
  caption,
  prov,
  primary,
  disabled,
  onClick,
  title,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  caption?: string;
  prov?: Prov;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  "data-testid"?: string;
}) {
  return (
    <button className={`ec-btn ${primary ? "primary" : ""}`} disabled={disabled} onClick={onClick} title={title} data-testid={testId}>
      {children}
      {prov && <ProvTag prov={prov} />}
      {caption && <span className="ec-cap">{caption}</span>}
    </button>
  );
}

export function HealthChip({ name, state, prov }: { name: string; state: string; prov: Prov }) {
  return (
    <span className={`ec-prov ${PROV_CLASS[prov]}`} data-prov={prov} title={`${name}: ${state}`}>
      {name}:{state}
      {prov === "demo" && <> · {t(PROV_LABEL.demo, "DEMO DATA")}</>}
    </span>
  );
}
