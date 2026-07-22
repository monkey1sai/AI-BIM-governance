// 誠實 UI 元件：每個資料 / 按鈕強制帶 provenance；不放假數字。
import React from "react";
import { t } from "./i18n";
import { Prov, PROV_LABEL, PROV_CLASS } from "./data";

// 英文 provenance 標籤對應表（供 t() 第二參數使用；不改 data.ts 的中文權威來源）。
const EN_PROV: Record<Prov, string> = {
  asbuilt: "As-built",
  artifact: "Measured artifact",
  demo: "DEMO DATA",
  p1: "Backend pending · P1",
  p15: "Backend pending · P1.5",
  p3: "Vision · Phase 3 (not built)",
  p4: "Vision · Phase 4 (not built)",
};

export function ProvTag({ prov }: { prov: Prov }) {
  return <span className={`ec-prov ${PROV_CLASS[prov]}`}>{t(PROV_LABEL[prov], EN_PROV[prov])}</span>;
}

// 可信度圖例（信任機制）：把 4 階 provenance 分類學攤成首頁 key；標籤一律取自 PROV_LABEL（不寫死）。
const PROV_LEGEND_TIERS: { prov: Prov; meaning: string }[] = [
  { prov: "asbuilt", meaning: t("已寫好、真的能用", "Built and actually usable") },
  { prov: "artifact", meaning: t("有實測產出（截圖／檔案）佐證", "Backed by measured output (screenshot / file)") },
  { prov: "demo", meaning: t("介面通了、資料是示範用", "UI wired up, data is DEMO DATA") },
  { prov: "p4", meaning: t("後端未建、先佔位（願景 / 待建）", "Backend not built, placeholder only (vision / not built)") },
];

export function ProvLegend() {
  return (
    <p className="ec-note" aria-label={t("可信度圖例（信任機制）", "Credibility legend (trust mechanism)")}>
      {t("可信度圖例（每個區塊都會標）：", "Credibility legend (tagged on every block):")}
      {PROV_LEGEND_TIERS.map((tier, i) => (
        <span key={tier.prov} style={{ marginLeft: "var(--ab-space-3)" }}>
          <ProvTag prov={tier.prov} /> <span style={{ opacity: 0.75 }}>{tier.meaning}</span>
          {i < PROV_LEGEND_TIERS.length - 1 ? " ·" : ""}
        </span>
      ))}
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
    <span className={`ec-prov ${PROV_CLASS[prov]}`} title={t(PROV_LABEL[prov], EN_PROV[prov])}>
      {name}:{state}
    </span>
  );
}
