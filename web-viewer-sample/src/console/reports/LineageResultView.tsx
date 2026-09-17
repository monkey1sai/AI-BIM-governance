import { Fragment, useCallback, useState } from "react";
import {
  coordinatorClient,
  type LineageConversionReport,
  type LineageConversionReportDifferences,
  type LineageDifferenceSet,
  type LineageReportFileName,
} from "../coordinatorClient";
import { t } from "../i18n";
import { formatRatioPercent } from "./lineageFormat";
import { formatWhen, REPORT_STATUS, useLoad } from "./lineageReportShared";
import "./lineage-report.css";

/**
 * 一次轉檔的對齊結果（schedule.csv ↔ IFC ↔ USDC），嵌在模型庫第③步。
 * 先給三個比率與一句解讀；點比率卡才載入對應清單；計數、警告與來源收在「技術細節」。
 * 資料全部來自 coordinator 保存的報表紀錄；元件只呈現，不自行推導比率或差異。
 */
type Metrics = NonNullable<LineageConversionReport["metrics"]>;
type MetricKey = keyof Metrics;
type Counts = NonNullable<LineageConversionReport["counts"]>;

const PAGE_SIZE = 100;
const FILES: LineageReportFileName[] = ["alignment_report.json", "alignment_report.csv"];

type MetricCard = {
  key: MetricKey;
  set: LineageDifferenceSet;
  /** 點卡片後清單上方的標題。 */
  listTitle: string;
  label: string;
  hint: string;
  action: string;
  explain: (metric: Metrics[MetricKey], counts: Counts | null) => string;
};

const METRIC_CARDS: MetricCard[] = [
  {
    key: "rvt_ifc_usdc_lineage_ratio",
    set: "full_lineage_matched",
    listTitle: t("可以一路追到 USDC 的 Revit 元件", "Revit elements traceable to USDC"),
    label: t("RVT → IFC → USDC 完整追溯", "RVT → IFC → USDC lineage"),
    hint: t("schedule 有效列中，三者都對得上的比例", "Valid schedule rows traceable through IFC to a USDC prim"),
    action: t("看可以追溯的元件", "Show traceable elements"),
    explain: (metric) => t(
      `${metric.denominator} 筆 Revit 元件中，${metric.numerator} 筆可一路追到 USDC`,
      `${metric.numerator} of ${metric.denominator} Revit elements trace through to USDC`,
    ),
  },
  {
    key: "rvt_ifc_alignment_ratio",
    set: "csv_only",
    listTitle: t("IFC 找不到的 Revit 元件", "Revit elements missing from the IFC"),
    label: t("RVT → IFC 對齊", "RVT → IFC alignment"),
    hint: t("schedule 有效列中，IfcGUID 在 IFC 找得到產品的比例", "Valid schedule rows whose IfcGUID exists in the IFC"),
    action: t("看 IFC 找不到的 Revit 元件", "Show Revit elements missing from the IFC"),
    explain: (metric, counts) => counts === null
      ? `${metric.numerator} / ${metric.denominator}`
      : counts.csv_only_count === 0
        ? t(`${metric.denominator} 筆 Revit 元件都在 IFC 找得到`, `All ${metric.denominator} Revit elements are in the IFC`)
        : t(
          `${metric.denominator} 筆 Revit 元件中，${counts.csv_only_count} 筆在 IFC 找不到`,
          `${counts.csv_only_count} of ${metric.denominator} Revit elements are missing from the IFC`,
        ),
  },
  {
    key: "ifc_usdc_coverage_ratio",
    set: "ifc_usdc_unmapped",
    listTitle: t("USDC 沒有對應的 IFC 元件", "IFC elements without a USDC prim"),
    label: t("IFC → USDC 覆蓋", "IFC → USDC coverage"),
    hint: t("可轉出的 IFC 產品中，在 USDC 找得到穩定 prim 的比例", "Eligible IFC products with a stable USDC prim"),
    action: t("看 USDC 沒有對應的 IFC 元件", "Show IFC elements without a USDC prim"),
    explain: (metric, counts) => counts === null
      ? `${metric.numerator} / ${metric.denominator}`
      : counts.ifc_usdc_unmapped_count === 0
        ? t(`${metric.denominator} 個 IFC 元件都在 USDC 找得到`, `All ${metric.denominator} IFC elements are in the USDC`)
        : t(
          `${metric.denominator} 個 IFC 元件中，${counts.ifc_usdc_unmapped_count} 個在 USDC 沒有對應`,
          `${counts.ifc_usdc_unmapped_count} of ${metric.denominator} IFC elements have no USDC prim`,
        ),
  },
];

const COUNTS: Array<[keyof Counts, string]> = [
  ["csv_total_count", t("schedule 總列數", "Schedule rows")],
  ["csv_valid_count", t("schedule 有效列", "Valid schedule rows")],
  ["invalid_row_count", t("schedule 無效列", "Invalid schedule rows")],
  ["duplicate_rvt_id_count", t("重複的 Revit ID", "Duplicate Revit IDs")],
  ["duplicate_ifc_guid_count", t("重複的 IfcGUID", "Duplicate IfcGUIDs")],
  ["eligible_ifc_product_count", t("可轉出的 IFC 產品", "Eligible IFC products")],
  ["csv_only_count", t("只在 schedule", "Only in schedule")],
  ["ifc_only_count", t("只在 IFC", "Only in IFC")],
  ["ifc_usdc_unmapped_count", t("IFC 未對應到 USDC", "IFC not mapped to USDC")],
  ["full_lineage_matched_count", t("完整追溯", "Full lineage")],
];

const SET_COLUMNS: Record<LineageDifferenceSet, string[]> = {
  csv_only: ["rvt_element_id", "ifc_uuid36_raw", "ifc_global_id22", "reason_code"],
  ifc_only: ["ifc_global_id22", "ifc_class", "ifc_uuid36", "usd_prim_path"],
  ifc_usdc_unmapped: ["ifc_global_id22", "ifc_class", "reason_code", "observed_prim_path"],
  invalid_rows: ["row_number", "rvt_element_id", "ifc_uuid36_raw", "reason_code"],
  duplicate_rvt_ids: ["rvt_element_id", "occurrence_count"],
  duplicate_ifc_guids: ["ifc_uuid36", "occurrence_count"],
  full_lineage_matched: ["rvt_element_id", "ifc_global_id22", "usd_prim_path"],
};

/** 比率卡沒涵蓋的清單；數量為 0 的不列出。 */
const OTHER_SETS: Array<[LineageDifferenceSet, string, keyof Counts]> = [
  ["ifc_only", t("只在 IFC（schedule 沒列到）", "Only in IFC (not in schedule)"), "ifc_only_count"],
  ["invalid_rows", t("schedule 無效列", "Invalid schedule rows"), "invalid_row_count"],
  ["duplicate_rvt_ids", t("重複的 Revit ID", "Duplicate Revit IDs"), "duplicate_rvt_id_count"],
  ["duplicate_ifc_guids", t("重複的 IfcGUID", "Duplicate IfcGUIDs"), "duplicate_ifc_guid_count"],
];

const COLUMN_LABELS: Record<string, string> = {
  rvt_element_id: t("Revit ID", "Revit ID"),
  ifc_uuid36_raw: t("schedule IfcGUID", "Schedule IfcGUID"),
  ifc_uuid36: "IFC UUID",
  ifc_global_id22: "IFC GlobalId",
  ifc_class: t("IFC 類別", "IFC class"),
  usd_prim_path: "USD prim",
  observed_prim_path: t("實際 prim", "Observed prim"),
  reason_code: t("原因", "Reason"),
  row_number: t("列號", "Row"),
  occurrence_count: t("出現次數", "Occurrences"),
};

const REASONS: Record<string, string> = {
  ifc_product_not_found: t("IFC 沒有這個 GUID 的產品", "No IFC product with this GUID"),
  guid_roundtrip_failed: t("GUID 無法換算成 GlobalId", "GUID cannot be converted to a GlobalId"),
  prim_not_found: t("USDC 沒有對應的 prim", "No matching USDC prim"),
  unstable_child_prim_target: t("只對應到子 prim，不是穩定 root", "Mapped to a child prim, not the stable root"),
  prim_token_mismatch: t("prim 名稱與 GlobalId 不一致", "Prim name does not match the GlobalId"),
  missing_id: t("缺 Revit ID", "Missing Revit ID"),
  missing_guid: t("缺 IfcGUID", "Missing IfcGUID"),
  invalid_guid_format: t("IfcGUID 格式不正確", "Malformed IfcGUID"),
  duplicate_id: t("Revit ID 重複", "Duplicate Revit ID"),
  duplicate_guid: t("IfcGUID 重複", "Duplicate IfcGUID"),
};

const UPLOAD: Record<LineageConversionReport["minio_upload"]["status"], string> = {
  uploaded: t("已上傳到 MinIO，與 IFC 同一個資料夾", "Uploaded to MinIO next to the IFC"),
  exists: t("MinIO 上已有同名報表，未覆寫", "A report already exists in MinIO; it was not overwritten"),
  denied: t("MinIO 帳號沒有寫入權限，報表只保存在 coordinator", "The MinIO account cannot write; the report is kept on the coordinator only"),
  failed: t("上傳 MinIO 失敗，coordinator 重啟時會再試", "Upload to MinIO failed; the coordinator retries on restart"),
  skipped: t("未上傳到 MinIO", "Not uploaded to MinIO"),
};

function bytes(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function cell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  return typeof value === "string" && REASONS[value] ? `${REASONS[value]}（${value}）` : String(value);
}

const PATH_FIELDS = new Set(["usd_prim_path", "observed_prim_path"]);

/**
 * 路徑只在 `/` 後提供斷行點：表格可以窄到路徑分段換行，
 * 但 GlobalId、Revit ID 這類識別碼不會被從中間拆開。
 */
function PathText({ value }: { value: string }): JSX.Element {
  const parts = value.split("/");
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && <>/<wbr /></>}
        </Fragment>
      ))}
    </>
  );
}

function fieldValue(field: string, value: unknown): JSX.Element | string {
  return PATH_FIELDS.has(field) && typeof value === "string" && value ? <PathText value={value} /> : cell(value);
}

export function Retry({ onRetry, testId, message }: { onRetry: () => void; testId: string; message: string }) {
  return (
    <div className="lineage-report-callout" role="alert" data-testid={testId}>
      <p>{message}</p>
      <button type="button" data-testid={`${testId.replace(/-error$/, "")}-retry`} onClick={onRetry}>{t("重試", "Retry")}</button>
    </div>
  );
}

export function LineageResultView({ report }: { report: LineageConversionReport }): JSX.Element {
  const [set, setSet] = useState<LineageDifferenceSet | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const choose = (next: LineageDifferenceSet) => {
    setSet((current) => (current === next ? null : next));
    setOffset(0);
    setSelected(null);
  };
  const generated = report.status === "generated";
  const others = OTHER_SETS.filter(([, , countKey]) => (report.counts?.[countKey] ?? 0) > 0);
  const listTitle = METRIC_CARDS.find((card) => card.set === set)?.listTitle
    ?? OTHER_SETS.find(([key]) => key === set)?.[1];
  // 比率卡與「其他差異」是揭露按鈕：aria-controls 指向下方清單。
  const idBase = `lineage-${report.conversion_job_id}`;
  const listId = `${idBase}-list`;
  return (
    <div className="lineage-result">
      <StatusNote report={report} />
      {generated && report.metrics && (
        <div className="lineage-report-kpis">
          {METRIC_CARDS.map((card) => {
            const metric = report.metrics![card.key];
            const open = set === card.set;
            const cardId = `${idBase}-${card.key}`;
            return (
              <button
                key={card.key}
                type="button"
                className="lineage-kpi"
                data-testid={`lineage-kpi-${card.key}`}
                data-status={metric.status}
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-labelledby={`${cardId}-label ${cardId}-value`}
                aria-describedby={`${cardId}-explain ${cardId}-hint`}
                onClick={() => choose(card.set)}
              >
                <span id={`${cardId}-label`} className="lineage-kpi-label">{card.label}</span>
                <strong id={`${cardId}-value`}>{formatRatioPercent(metric)}</strong>
                <span id={`${cardId}-explain`} className="lineage-kpi-explain">
                  {metric.status === "not_evaluable"
                    ? t("無法評估（分母為 0）", "Not evaluable (zero denominator)")
                    : card.explain(metric, report.counts)}
                </span>
                <span id={`${cardId}-hint`} className="lineage-report-hint">{card.hint}</span>
                <span className="lineage-kpi-action" aria-hidden="true">{card.action}</span>
              </button>
            );
          })}
        </div>
      )}
      {generated && others.length > 0 && (
        <div className="lineage-report-sets" role="group" aria-label={t("其他差異", "Other differences")}>
          <span className="lineage-report-sets-label">{t("其他差異：", "Other differences:")}</span>
          {others.map(([key, label, countKey]) => (
            <button key={key} type="button" data-set={key} aria-expanded={set === key}
              aria-controls={set === key ? listId : undefined} onClick={() => choose(key)}>
              {label} <span>{report.counts?.[countKey] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {generated && set === null && (
        <p className="lineage-report-hint" data-testid="lineage-diff-hint">
          {t("點上方任一張比率卡，就能看到對應的元件清單。", "Select a ratio card above to list the matching elements.")}
        </p>
      )}
      {generated && set !== null && (
        <div id={listId} className="lineage-diff">
          <h3 className="lineage-diff-title" data-testid="lineage-diff-title">{listTitle}</h3>
          <DifferencePage
            key={set}
            conversionJobId={report.conversion_job_id}
            set={set}
            offset={offset}
            selected={selected}
            onSelect={setSelected}
            onPage={(next) => { setOffset(next); setSelected(null); }}
          />
        </div>
      )}
      <Downloads report={report} />
      <TechnicalDetails report={report} />
    </div>
  );
}

function StatusNote({ report }: { report: LineageConversionReport }): JSX.Element | null {
  if (report.status === "generated") return null;
  return (
    <div className="lineage-report-callout" data-testid="lineage-report-status" data-status={report.status}>
      <strong>{REPORT_STATUS[report.status]}</strong>
      <p>
        {report.status === "not_produced"
          ? t("這次轉檔沒有附帶對齊報表，通常是轉檔早於報表功能。重新轉檔即可產生。",
            "This conversion carries no alignment report, usually because it predates the feature. Reconvert to produce one.")
          : report.status === "failed"
            ? t("轉檔本身已完成，但轉檔服務沒能產出對齊報表。可以重新轉檔再試一次。",
              "The conversion finished but the service could not build the report. Reconvert to try again.")
            : t("coordinator 取回的報表沒有通過 checksum 或格式驗證，因此不顯示內容。可以重新轉檔再試一次。",
              "The report did not pass checksum or format verification, so it is not shown. Reconvert to try again.")}
        {report.error_code && <> <code>{report.error_code}</code></>}
      </p>
    </div>
  );
}

function DifferencePage({
  conversionJobId,
  set,
  offset,
  selected,
  onSelect,
  onPage,
}: {
  conversionJobId: string;
  set: LineageDifferenceSet;
  offset: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onPage: (offset: number) => void;
}): JSX.Element {
  const fetcher = useCallback(
    () => coordinatorClient.listLineageConversionReportDifferences(conversionJobId, set, { offset, limit: PAGE_SIZE }),
    [conversionJobId, set, offset],
  );
  const [load, retry] = useLoad(fetcher);
  const columns = SET_COLUMNS[set];
  // 翻頁載入中仍保留分頁按鈕（停用），鍵盤焦點不會因按鈕卸載而掉回頁首。
  const pager = (loaded: LineageConversionReportDifferences | null) => {
    const end = loaded ? Math.min(loaded.offset + loaded.items.length, loaded.total) : 0;
    return (
      <div className="lineage-report-pager">
        <button type="button" data-testid="lineage-diff-prev" disabled={!loaded || offset === 0}
          onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>
          {t("上一頁", "Previous")}
        </button>
        <button type="button" data-testid="lineage-diff-next" disabled={!loaded || end >= loaded.total}
          onClick={() => onPage(offset + PAGE_SIZE)}>
          {t("下一頁", "Next")}
        </button>
      </div>
    );
  };
  if (load.state === "error" && load.status === 413) {
    return (
      <p className="lineage-report-callout" data-testid="lineage-diff-too-large">
        {t("這份報表太大，無法線上瀏覽；請用下方「下載 CSV」檢視。",
          "This report is too large to browse online; use Download CSV below.")}
      </p>
    );
  }
  if (load.state === "error" || load.state === "not_found") {
    return <Retry onRetry={retry} testId="lineage-diff-error" message={t("無法取得清單。", "The list is unavailable.")} />;
  }
  const page = load.state === "loaded" ? load.value : null;
  const end = page ? Math.min(page.offset + page.items.length, page.total) : 0;
  // 載入中與載入後維持相同的子節點位置（說明列、表格、分頁列），分頁按鈕不會被換掉，焦點留在原處。
  return (
    <>
      {page === null ? (
        <p role="status" className="lineage-report-range">{t("讀取清單中…", "Loading the list…")}</p>
      ) : (
        <p className="lineage-report-range" data-testid="lineage-diff-range">
          {page.total === 0 ? t("沒有資料。", "Nothing to list.") : `${page.offset + 1}–${end} / ${page.total}`}
          {page.authoritative_count > page.total && (
            <> · {t(`報表計數為 ${page.authoritative_count}，只列出前 ${page.total} 筆`,
              `The report counts ${page.authoritative_count}; ${page.total} are listed`)}</>
          )}
        </p>
      )}
      {page !== null && page.items.length > 0 ? (
        <div className="lineage-report-table-wrap">
          <table data-testid="lineage-diff-table">
            <thead>
              <tr>
                {columns.map((column) => <th key={column} scope="col">{COLUMN_LABELS[column] ?? column}</th>)}
                <th scope="col"><span className="lineage-report-sr">{t("明細", "Details")}</span></th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item, index) => {
                const open = selected === index;
                const detailId = `lineage-diff-detail-${page.offset + index}`;
                return (
                  <Fragment key={index}>
                    <tr data-testid="lineage-diff-row" data-selected={open}>
                      {columns.map((column) => <td key={column}>{fieldValue(column, item[column])}</td>)}
                      <td>
                        <button
                          type="button"
                          data-testid="lineage-diff-view"
                          aria-expanded={open}
                          aria-controls={open ? detailId : undefined}
                          aria-label={open
                            ? t(`收合第 ${page.offset + index + 1} 筆明細`, `Hide details of item ${page.offset + index + 1}`)
                            : t(`檢視第 ${page.offset + index + 1} 筆明細`, `Show details of item ${page.offset + index + 1}`)}
                          onClick={() => onSelect(open ? null : index)}
                        >
                          {open ? t("收合", "Hide") : t("明細", "Details")}
                        </button>
                      </td>
                    </tr>
                    {/* 明細緊接在所選列下方，不必捲到表格底部。 */}
                    {open && (
                      <tr id={detailId} className="lineage-report-detail-row">
                        <td colSpan={columns.length + 1}>
                          <dl className="lineage-report-detail" data-testid="lineage-diff-detail">
                            {Object.entries(item).map(([key, value]) => (
                              <div key={key}><dt>{COLUMN_LABELS[key] ?? key}</dt><dd><code>{fieldValue(key, value)}</code></dd></div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {pager(page)}
    </>
  );
}

function Downloads({ report }: { report: LineageConversionReport }): JSX.Element | null {
  const available = FILES.filter((name) => report.files[name]);
  if (available.length === 0) return null;
  return (
    <p className="lineage-report-downloads" data-testid="lineage-downloads">
      {t("下載完整報表：", "Download the full report: ")}
      {available.map((name, index) => (
        <Fragment key={name}>
          {index > 0 && " · "}
          <a
            data-testid={`lineage-download-${name}`}
            href={coordinatorClient.lineageConversionReportFileUrl(report.conversion_job_id, name)}
            download={`${report.conversion_job_id}_${name}`}
          >
            {name.endsWith(".csv") ? t("下載 CSV", "Download CSV") : t("下載 JSON", "Download JSON")}
          </a>
          <span className="lineage-report-hint"> {bytes(report.files[name]!.size_bytes)}</span>
        </Fragment>
      ))}
    </p>
  );
}

function TechnicalDetails({ report }: { report: LineageConversionReport }): JSX.Element {
  const upload = report.minio_upload;
  return (
    <details className="lineage-report-tech" data-testid="lineage-tech-details">
      <summary>{t("技術細節：計數、警告、來源與檔案雜湊", "Technical details: counts, warnings, sources and hashes")}</summary>
      {report.counts && (
        <dl className="lineage-report-counts" data-testid="lineage-counts">
          {COUNTS.map(([key, label]) => (
            <div key={key}><dt>{label}</dt><dd>{report.counts![key]}</dd></div>
          ))}
        </dl>
      )}
      {report.status === "generated" && (
        <div data-testid="lineage-warnings" className="lineage-report-block">
          <h3>{t("警告", "Warnings")}</h3>
          {report.warning_codes.length === 0
            ? <p>{t("沒有警告。", "No warnings.")}</p>
            : <ul className="lineage-report-codes">{report.warning_codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>}
        </div>
      )}
      <div data-testid="lineage-schedule" className="lineage-report-block">
        <h3>{t("Revit 元件資料（schedule.csv）", "Revit element data (schedule.csv)")}</h3>
        <p>
          {report.schedule.key
            ? <><code><PathText value={report.schedule.key} /></code> · {bytes(report.schedule.size_bytes)}{" · "}
              {report.schedule.used ? t("已用於比對", "Used for alignment") : t("已下載但無法使用，請看警告", "Downloaded but unusable; see warnings")}</>
            : t("此 IFC 的 MinIO 資料夾沒有 schedule.csv，RVT 相關比率無法評估。",
              "The IFC's MinIO folder has no schedule.csv, so RVT ratios cannot be evaluated.")}
        </p>
        <p className="lineage-report-hint">
          {t("RVT 原始檔本身不在比對範圍內；Revit 元件以同資料夾的 schedule.csv 代表。",
            "The RVT file itself is not compared; Revit elements are represented by the schedule.csv in the same folder.")}
        </p>
      </div>
      <div data-testid="lineage-upload" className="lineage-report-block" data-upload={upload.status}>
        <h3>{t("MinIO 上傳", "MinIO upload")}</h3>
        <p>{UPLOAD[upload.status]}{upload.reason && upload.status !== "denied" && <> <code>{upload.reason}</code></>}</p>
      </div>
      <dl className="lineage-report-detail" data-testid="lineage-sources">
        <div><dt>{t("轉檔編號", "Conversion")}</dt><dd><code>{report.conversion_job_id}</code></dd></div>
        <div><dt>{t("報表時間", "Report time")}</dt><dd>{formatWhen(report.report_generated_at)}</dd></div>
        <div><dt>{t("IFC 物件", "IFC object")}</dt><dd><code><PathText value={`${report.source_ifc.bucket ?? "—"}/${report.source_ifc.key ?? "—"}`} /></code></dd></div>
        <div><dt>IFC ETag</dt><dd><code>{report.source_ifc.etag ?? "—"}</code></dd></div>
        <div><dt>schedule ETag</dt><dd><code>{report.schedule.etag ?? "—"}</code></dd></div>
        <div><dt>schedule SHA-256</dt><dd><code className="lineage-report-hash">{report.schedule.sha256 ?? "—"}</code></dd></div>
        {FILES.map((name) => (
          <Fragment key={name}>
            <div><dt>{name} SHA-256</dt><dd><code className="lineage-report-hash">{report.files[name]?.sha256 ?? "—"}</code></dd></div>
            <div><dt>{name} MinIO</dt><dd><code>{upload.keys[name] ? <PathText value={upload.keys[name]!} /> : "—"}</code></dd></div>
          </Fragment>
        ))}
        <div><dt>{t("模型編號", "Model id")}</dt><dd><code>{report.source_model_id}</code></dd></div>
        <div><dt>{t("收件編號", "Intake job")}</dt><dd><code>{report.ifc_ready_job_id}</code></dd></div>
      </dl>
      <div className="lineage-report-callout" data-testid="lineage-audit" data-state="NOT_BUILT">
        <strong>{t("稽核：NOT_BUILT", "Audit: NOT_BUILT")}</strong>
        <p>{t("結果升版、回滾與 runtime 釋放的稽核屬於 governed 流程，需要外部授權，尚未建置。這裡不模擬這些紀錄。",
          "Audit of promotion, rollback and runtime release belongs to the governed flow, needs external authorization and is not built yet. Nothing is simulated here.")}</p>
      </div>
    </details>
  );
}
