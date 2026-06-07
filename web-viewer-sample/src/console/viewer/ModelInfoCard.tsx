// CH-H1 面板①「模型資訊」：真資料（stream-config quality_metrics_summary + mapping summary）。
// 誠實鐵律：缺欄位顯「未取得」不捏造；fake mapping 顯 fake badge；coverage% 由後端 coverage_ratio 原樣呈現（×100）。
import type { ReactNode } from "react";

export interface QualityMetricsSummary {
  fixture_name?: string | null;
  conversion_job_id?: string | null;
  source_ifc_entity_count?: number | null;
  coverage_ratio?: number | null;
  coverage_status?: string | null;
  conversion_duration_seconds?: number | null;
  semantic_mapping_fidelity?: string | null;
  mapping_has_ifc_type?: boolean | null;
  mapping_has_ifc_name?: boolean | null;
}

export interface ModelInfoModel {
  url?: string | null;
  mapping_url?: string | null;
  artifact_id?: string | null;
  status?: string | null;
}

export interface ModelInfoCardProps {
  model?: ModelInfoModel | null;
  metrics?: QualityMetricsSummary | null;
  projectId?: string | null;
  modelVersionId?: string | null;
  mappedCount?: number | null;
  isFake?: boolean;
}

const DASH = "未取得";

function basename(url?: string | null): string {
  if (!url) return DASH;
  const clean = url.split("?")[0].split("#")[0];
  const seg = clean.split("/").filter(Boolean).pop();
  return seg || clean;
}

function pct(ratio?: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return DASH;
  return (ratio * 100).toFixed(2) + "%";
}

export function ModelInfoCard({ model, metrics, projectId, modelVersionId, mappedCount, isFake }: ModelInfoCardProps) {
  const m = metrics ?? {};
  const rows: [string, ReactNode, string?][] = [
    ["IFC 檔案", m.fixture_name || DASH, "lin-fixture"],
    // 誠實鐵律（govEndpoints「不把非 guid_exact 當 guid_exact」/ pages.tsx 記載缺欄位 fallback null）：
    // semantic_mapping_fidelity 缺欄位即顯「未取得」，SHALL NOT 因 mapping_url 存在就捏造 guid_exact。
    ["轉換配置", m.semantic_mapping_fidelity || DASH, "lin-fidelity"],
    ["轉換時間", m.conversion_duration_seconds != null ? `${m.conversion_duration_seconds}s` : DASH, "lin-duration"],
    ["USD Stage", basename(model?.url), "lin-usd-stage"],
    ["artifact_id", model?.artifact_id || DASH, "lin-artifact"],
    ["總元件數", m.source_ifc_entity_count != null ? String(m.source_ifc_entity_count) : DASH, "lin-entity-count"],
    ["已對應數", mappedCount != null ? String(mappedCount) : DASH, "lin-mapped"],
    ["coverage", `${pct(m.coverage_ratio)}${m.coverage_status ? ` · ${m.coverage_status}` : ""}`, "lin-coverage"],
    ["project / version", `${projectId || DASH} / ${modelVersionId || DASH}`, "lin-proj-ver"],
  ];
  return (
    <section className="gv-card" data-testid="model-info-card">
      <header className="gv-card__title">
        <span>① 模型資訊</span>
        {isFake && <span className="gv-badge gv-badge--fake" data-testid="model-info-fake">fake mapping</span>}
      </header>
      <table className="gv-kv">
        <tbody>
          {rows.map(([k, v, tid]) => (
            <tr key={k}>
              <td className="gv-kv__k">{k}</td>
              <td className="gv-kv__v" data-testid={tid}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
