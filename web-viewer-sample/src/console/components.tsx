// 誠實 UI 元件：每個資料 / 按鈕強制帶 provenance；不放假數字。
import React from "react";
import { Prov, PROV_LABEL, PROV_CLASS } from "./data";

export function ProvTag({ prov }: { prov: Prov }) {
  return <span className={`ec-prov ${PROV_CLASS[prov]}`}>{PROV_LABEL[prov]}</span>;
}

// 可信度圖例（信任機制）：把 4 階 provenance 分類學攤成首頁 key；標籤一律取自 PROV_LABEL（不寫死）。
const PROV_LEGEND_TIERS: { prov: Prov; meaning: string }[] = [
  { prov: "asbuilt", meaning: "已寫好、真的能用" },
  { prov: "artifact", meaning: "有實測產出（截圖／檔案）佐證" },
  { prov: "demo", meaning: "介面通了、資料是示範用" },
  { prov: "p4", meaning: "後端未建、先佔位（願景 / 待建）" },
];

export function ProvLegend() {
  return (
    <p className="ec-note" aria-label="可信度圖例（信任機制）">
      可信度圖例（每個區塊都會標）：
      {PROV_LEGEND_TIERS.map((t, i) => (
        <span key={t.prov} style={{ marginLeft: 8 }}>
          <ProvTag prov={t.prov} /> <span style={{ opacity: 0.75 }}>{t.meaning}</span>
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
    <span className={`ec-prov ${PROV_CLASS[prov]}`} title={PROV_LABEL[prov]}>
      {name}:{state}
    </span>
  );
}
