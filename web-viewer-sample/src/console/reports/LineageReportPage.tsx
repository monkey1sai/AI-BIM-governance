import { useCallback, useEffect, useRef, useState } from "react";
import {
  coordinatorClient,
  isCoordinatorNotFound,
  type LineageConversionReport,
  type LineageConversionReportDifferences,
  type LineageDifferenceSet,
  type LineageReportFileName,
} from "../coordinatorClient";
import { t } from "../i18n";
import "./lineage-report.css";

/**
 * 轉檔對齊報表頁（`#lineage?conversion_job_id=<轉檔編號>`）：schedule.csv（Revit 元件）↔ IFC ↔ USDC。
 * 資料全部來自 coordinator 保存的報表紀錄；頁面只呈現，不自行推導比率或差異。
 */
type Metrics = NonNullable<LineageConversionReport["metrics"]>;
type MetricKey = keyof Metrics;
type Counts = NonNullable<LineageConversionReport["counts"]>;
type Tab = "overview" | "alignment" | "artifacts" | "attempts" | "audit";
type Load<T> = { state: "loading" } | { state: "error" } | { state: "not_found" } | { state: "loaded"; value: T };

const PAGE_SIZE = 100;
const FILES: LineageReportFileName[] = ["alignment_report.json", "alignment_report.csv"];

const TABS: Array<[Tab, string]> = [
  ["overview", t("總覽", "Overview")],
  ["alignment", t("對齊差異", "Alignment")],
  ["artifacts", t("產物", "Artifacts")],
  ["attempts", t("轉檔歷史", "Attempts")],
  ["audit", t("稽核", "Audit")],
];

const METRICS: Array<[MetricKey, string, string]> = [
  ["rvt_ifc_usdc_lineage_ratio", t("RVT → IFC → USDC 完整追溯", "RVT → IFC → USDC lineage"),
    t("schedule 有效列中，三者都對得上的比例", "Valid schedule rows traceable through IFC to a USDC prim")],
  ["rvt_ifc_alignment_ratio", t("RVT → IFC 對齊", "RVT → IFC alignment"),
    t("schedule 有效列中，IfcGUID 在 IFC 找得到產品的比例", "Valid schedule rows whose IfcGUID exists in the IFC")],
  ["ifc_usdc_coverage_ratio", t("IFC → USDC 覆蓋", "IFC → USDC coverage"),
    t("可轉出的 IFC 產品中，在 USDC 找得到穩定 prim 的比例", "Eligible IFC products with a stable USDC prim")],
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

const SETS: Array<[LineageDifferenceSet, string, keyof Counts, string[]]> = [
  ["csv_only", t("只在 schedule", "Only in schedule"), "csv_only_count",
    ["rvt_element_id", "ifc_uuid36_raw", "ifc_global_id22", "reason_code"]],
  ["ifc_only", t("只在 IFC", "Only in IFC"), "ifc_only_count",
    ["ifc_global_id22", "ifc_class", "ifc_uuid36", "usd_prim_path"]],
  ["ifc_usdc_unmapped", t("IFC 未對應到 USDC", "IFC not mapped to USDC"), "ifc_usdc_unmapped_count",
    ["ifc_global_id22", "ifc_class", "reason_code", "observed_prim_path"]],
  ["invalid_rows", t("schedule 無效列", "Invalid schedule rows"), "invalid_row_count",
    ["row_number", "rvt_element_id", "ifc_uuid36_raw", "reason_code"]],
  ["duplicate_rvt_ids", t("重複的 Revit ID", "Duplicate Revit IDs"), "duplicate_rvt_id_count",
    ["rvt_element_id", "occurrence_count"]],
  ["duplicate_ifc_guids", t("重複的 IfcGUID", "Duplicate IfcGUIDs"), "duplicate_ifc_guid_count",
    ["ifc_uuid36", "occurrence_count"]],
  ["full_lineage_matched", t("完整追溯", "Full lineage"), "full_lineage_matched_count",
    ["rvt_element_id", "ifc_global_id22", "usd_prim_path"]],
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

const STATUS: Record<LineageConversionReport["status"], string> = {
  generated: t("已產出", "Generated"),
  failed: t("轉檔服務產生報表失敗", "The conversion service failed to build the report"),
  not_produced: t("未產出報表", "No report produced"),
  invalid: t("報表未通過驗證", "Report failed verification"),
};

const UPLOAD: Record<LineageConversionReport["minio_upload"]["status"], string> = {
  uploaded: t("已上傳到 MinIO，與 IFC 同一個資料夾", "Uploaded to MinIO next to the IFC"),
  exists: t("MinIO 上已有同名報表，未覆寫", "A report already exists in MinIO; it was not overwritten"),
  denied: t("MinIO 帳號沒有寫入權限，報表只保存在 coordinator", "The MinIO account cannot write; the report is kept on the coordinator only"),
  failed: t("上傳 MinIO 失敗，coordinator 重啟時會再試", "Upload to MinIO failed; the coordinator retries on restart"),
  skipped: t("未上傳到 MinIO", "Not uploaded to MinIO"),
};

function hashParams(): URLSearchParams {
  const raw = window.location.hash;
  const index = raw.indexOf("?");
  return new URLSearchParams(index === -1 ? "" : raw.slice(index + 1));
}

function useConversionJobId(): string | null {
  const [id, setId] = useState(() => hashParams().get("conversion_job_id"));
  useEffect(() => {
    const sync = () => setId(hashParams().get("conversion_job_id"));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return id || null;
}

function useLoad<T>(fetcher: () => Promise<T>): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const generation = useRef(0);
  const run = useCallback(() => {
    const current = ++generation.current;
    setLoad({ state: "loading" });
    fetcher().then(
      (value) => { if (current === generation.current) setLoad({ state: "loaded", value }); },
      (error: unknown) => {
        if (current === generation.current) setLoad({ state: isCoordinatorNotFound(error) ? "not_found" : "error" });
      },
    );
  }, [fetcher]);
  useEffect(() => {
    run();
    return () => { generation.current += 1; };
  }, [run]);
  return [load, run];
}

const reportHref = (id: string) => `#lineage?conversion_job_id=${encodeURIComponent(id)}`;

/** 比率以百分比顯示，截斷到小數第二位（與報表截斷而非四捨五入的規則一致）。 */
function percent(ratio: number | null): string {
  return ratio === null ? "—" : `${(Math.floor(ratio * 10_000) / 100).toFixed(2)}%`;
}

function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

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

function Retry({ onRetry, testId, message }: { onRetry: () => void; testId: string; message: string }) {
  return (
    <div className="lineage-report-callout" role="alert" data-testid={testId}>
      <p>{message}</p>
      <button type="button" data-testid={`${testId.replace(/-error$/, "")}-retry`} onClick={onRetry}>{t("重試", "Retry")}</button>
    </div>
  );
}

export function LineageReportPage(): JSX.Element {
  const id = useConversionJobId();
  return (
    <div className="lineage-report" data-testid="lineage-report-page">
      {id ? <ReportView key={id} conversionJobId={id} /> : <ReportIndex />}
    </div>
  );
}

function ReportIndex(): JSX.Element {
  const fetcher = useCallback(() => coordinatorClient.listLineageConversionReports({ limit: 50 }), []);
  const [load, retry] = useLoad(fetcher);
  return (
    <>
      <header className="lineage-report-head">
        <div>
          <p className="lineage-report-kicker">LINEAGE</p>
          <h1>{t("RVT → IFC → USDC 對齊報表", "RVT → IFC → USDC alignment reports")}</h1>
          <p>{t("每次轉檔都會比對 schedule.csv、IFC 與 USDC。可從模型庫的模型詳情開啟單一模型的報表。",
            "Every conversion compares schedule.csv, the IFC and the USDC. Open a model's report from its detail in the model library.")}</p>
        </div>
        <a href="#minio">{t("回模型庫", "Back to models")}</a>
      </header>
      {load.state === "loading" && <p role="status">{t("讀取報表清單中…", "Loading reports…")}</p>}
      {(load.state === "error" || load.state === "not_found") && (
        <Retry onRetry={retry} testId="lineage-index-error" message={t("無法取得報表清單。", "Reports are unavailable.")} />
      )}
      {load.state === "loaded" && (load.value.items.length === 0 ? (
        <p data-testid="lineage-index-empty">{t("目前還沒有任何轉檔報表。", "No conversion reports yet.")}</p>
      ) : (
        <ul className="lineage-report-list">
          {load.value.items.map((item) => (
            <li key={item.conversion_job_id} data-testid="lineage-index-item">
              <a href={reportHref(item.conversion_job_id)}>{item.source_ifc.key ?? item.conversion_job_id}</a>
              <span>{when(item.conversion_created_at)}</span>
              <span data-status={item.status}>{STATUS[item.status]}</span>
              <span>{item.metrics ? percent(item.metrics.rvt_ifc_usdc_lineage_ratio.ratio) : "—"}</span>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}

function ReportView({ conversionJobId }: { conversionJobId: string }): JSX.Element {
  const fetcher = useCallback(() => coordinatorClient.getLineageConversionReport(conversionJobId), [conversionJobId]);
  const [load, retry] = useLoad(fetcher);
  const [tab, setTab] = useState<Tab>("overview");

  if (load.state === "loading") return <p role="status">{t("讀取報表中…", "Loading report…")}</p>;
  if (load.state === "not_found") {
    return (
      <div className="lineage-report-callout" data-testid="lineage-report-not-found">
        <p>{t(`找不到轉檔 ${conversionJobId} 的報表。轉檔可能尚未完成，或早於報表功能。`,
          `No report for conversion ${conversionJobId}. The conversion may still be running or predate reports.`)}</p>
        <a href="#lineage">{t("看所有報表", "All reports")}</a>
      </div>
    );
  }
  if (load.state === "error") {
    return <Retry onRetry={retry} testId="lineage-report-error" message={t("無法取得報表，請重試。", "The report is unavailable. Retry.")} />;
  }
  const report = load.value;
  return (
    <>
      <header className="lineage-report-head">
        <div>
          <p className="lineage-report-kicker">LINEAGE · {report.conversion_job_id}</p>
          <h1>{t("RVT → IFC → USDC 對齊報表", "RVT → IFC → USDC alignment report")}</h1>
          <p data-testid="lineage-report-source">
            <code>{report.source_ifc.key ?? t("來源 IFC 不明", "Unknown source IFC")}</code>
            {" · "}{t("轉檔時間", "Converted")} {when(report.conversion_created_at)}
            {" · "}{t("報表時間", "Report")} {when(report.report_generated_at)}
          </p>
        </div>
        <a href="#minio">{t("回模型庫", "Back to models")}</a>
      </header>
      <div role="tablist" className="lineage-report-tabs" aria-label={t("報表分頁", "Report sections")}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`lineage-tab-${key}`}
            data-tab={key}
            aria-selected={tab === key}
            aria-controls={`lineage-panel-${key}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`lineage-panel-${tab}`} aria-labelledby={`lineage-tab-${tab}`} className="lineage-report-panel">
        {tab === "overview" && <Overview report={report} />}
        {tab === "alignment" && <Alignment report={report} />}
        {tab === "artifacts" && <Artifacts report={report} />}
        {tab === "attempts" && <Attempts report={report} />}
        {tab === "audit" && <Audit />}
      </section>
    </>
  );
}

function StatusNote({ report }: { report: LineageConversionReport }): JSX.Element | null {
  if (report.status === "generated") return null;
  return (
    <div className="lineage-report-callout" data-testid="lineage-report-status" data-status={report.status}>
      <strong>{STATUS[report.status]}</strong>
      <p>
        {report.status === "not_produced"
          ? t("這次轉檔沒有附帶對齊報表，通常是轉檔早於報表功能。重新轉檔即可產生。",
            "This conversion carries no alignment report, usually because it predates the feature. Reconvert to produce one.")
          : report.status === "failed"
            ? t("轉檔本身已完成，但轉檔服務沒能產出對齊報表。", "The conversion finished but the service could not build the report.")
            : t("coordinator 取回的報表沒有通過 checksum 或格式驗證，因此不顯示內容。",
              "The report did not pass checksum or format verification, so it is not shown.")}
        {report.error_code && <> <code>{report.error_code}</code></>}
      </p>
    </div>
  );
}

function Overview({ report }: { report: LineageConversionReport }): JSX.Element {
  const upload = report.minio_upload;
  return (
    <>
      <StatusNote report={report} />
      {report.metrics && (
        <div className="lineage-report-kpis">
          {METRICS.map(([key, label, hint]) => {
            const metric = report.metrics![key];
            return (
              <article key={key} data-testid={`lineage-kpi-${key}`} data-status={metric.status}>
                <h3>{label}</h3>
                <strong>{percent(metric.ratio)}</strong>
                <p>{metric.numerator} / {metric.denominator}
                  {metric.status === "not_evaluable" && <> · {t("無法評估（分母為 0）", "Not evaluable (zero denominator)")}</>}
                </p>
                <p className="lineage-report-hint">{hint}</p>
              </article>
            );
          })}
        </div>
      )}
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
            ? <><code>{report.schedule.key}</code> · {bytes(report.schedule.size_bytes)}{" · "}
              {report.schedule.used ? t("已用於比對", "Used for alignment") : t("已下載但無法使用，請看警告", "Downloaded but unusable; see warnings")}</>
            : t("此 IFC 的 MinIO 資料夾沒有 schedule.csv，RVT 相關比率無法評估。",
              "The IFC's MinIO folder has no schedule.csv, so RVT ratios cannot be evaluated.")}
        </p>
      </div>
      <div data-testid="lineage-upload" className="lineage-report-block" data-upload={upload.status}>
        <h3>{t("MinIO 上傳", "MinIO upload")}</h3>
        <p>{UPLOAD[upload.status]}{upload.reason && upload.status !== "denied" && <> <code>{upload.reason}</code></>}</p>
      </div>
    </>
  );
}

function Alignment({ report }: { report: LineageConversionReport }): JSX.Element {
  const [set, setSet] = useState<LineageDifferenceSet>("csv_only");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const generated = report.status === "generated";
  const fetcher = useCallback(
    () => generated
      ? coordinatorClient.listLineageConversionReportDifferences(report.conversion_job_id, set, { offset, limit: PAGE_SIZE })
      : Promise.reject(new Error("report not generated")),
    [generated, report.conversion_job_id, set, offset],
  );
  if (!generated) {
    return (
      <p data-testid="lineage-diff-unavailable">
        {t("這次轉檔沒有可用的對齊報表，沒有差異可以列出。", "This conversion has no usable report, so there are no differences to list.")}
      </p>
    );
  }
  const columns = SETS.find(([key]) => key === set)![3];
  return (
    <>
      <div className="lineage-report-sets" role="group" aria-label={t("差異類別", "Difference sets")}>
        {SETS.map(([key, label, countKey]) => (
          <button
            key={key}
            type="button"
            data-set={key}
            aria-pressed={set === key}
            onClick={() => { setSet(key); setOffset(0); setSelected(null); }}
          >
            {label} <span>{report.counts?.[countKey] ?? 0}</span>
          </button>
        ))}
      </div>
      <DifferencePage
        fetcher={fetcher}
        columns={columns}
        offset={offset}
        selected={selected}
        onSelect={setSelected}
        onPage={(next) => { setOffset(next); setSelected(null); }}
      />
    </>
  );
}

function DifferencePage({
  fetcher,
  columns,
  offset,
  selected,
  onSelect,
  onPage,
}: {
  fetcher: () => Promise<LineageConversionReportDifferences>;
  columns: string[];
  offset: number;
  selected: number | null;
  onSelect: (index: number) => void;
  onPage: (offset: number) => void;
}): JSX.Element {
  const [load, retry] = useLoad(fetcher);
  if (load.state === "loading") return <p role="status">{t("讀取差異中…", "Loading differences…")}</p>;
  if (load.state !== "loaded") {
    return <Retry onRetry={retry} testId="lineage-diff-error" message={t("無法取得差異清單。", "Differences are unavailable.")} />;
  }
  const page = load.value;
  const end = Math.min(page.offset + page.items.length, page.total);
  const detail = selected === null ? undefined : page.items[selected];
  return (
    <>
      <p className="lineage-report-range" data-testid="lineage-diff-range">
        {page.total === 0 ? t("沒有資料。", "Nothing to list.") : `${page.offset + 1}–${end} / ${page.total}`}
        {page.authoritative_count > page.total && (
          <> · {t(`報表計數為 ${page.authoritative_count}，只列出前 ${page.total} 筆`,
            `The report counts ${page.authoritative_count}; ${page.total} are listed`)}</>
        )}
      </p>
      {page.items.length > 0 && (
        <div className="lineage-report-table-wrap">
          <table data-testid="lineage-diff-table">
            <thead><tr>{columns.map((column) => <th key={column} scope="col">{COLUMN_LABELS[column] ?? column}</th>)}</tr></thead>
            <tbody>
              {page.items.map((item, index) => (
                <tr
                  key={index}
                  data-testid="lineage-diff-row"
                  aria-selected={selected === index}
                  tabIndex={0}
                  onClick={() => onSelect(index)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(index); } }}
                >
                  {columns.map((column) => <td key={column}>{cell(item[column])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="lineage-report-pager">
        <button type="button" data-testid="lineage-diff-prev" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>
          {t("上一頁", "Previous")}
        </button>
        <button type="button" data-testid="lineage-diff-next" disabled={end >= page.total} onClick={() => onPage(offset + PAGE_SIZE)}>
          {t("下一頁", "Next")}
        </button>
      </div>
      {detail && (
        <dl className="lineage-report-detail" data-testid="lineage-diff-detail">
          {Object.entries(detail).map(([key, value]) => (
            <div key={key}><dt>{COLUMN_LABELS[key] ?? key}</dt><dd><code>{cell(value)}</code></dd></div>
          ))}
        </dl>
      )}
    </>
  );
}

function Artifacts({ report }: { report: LineageConversionReport }): JSX.Element {
  const upload = report.minio_upload;
  return (
    <div data-testid="lineage-artifacts">
      <h3>{t("對齊報表", "Alignment reports")}</h3>
      <table>
        <thead><tr><th scope="col">{t("檔案", "File")}</th><th scope="col">{t("大小", "Size")}</th><th scope="col">SHA-256</th><th scope="col">MinIO</th><th scope="col" /></tr></thead>
        <tbody>
          {FILES.map((name) => {
            const facts = report.files[name];
            return (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td>{facts ? bytes(facts.size_bytes) : "—"}</td>
                <td><code className="lineage-report-hash">{facts?.sha256 ?? "—"}</code></td>
                <td>{upload.keys[name] ? <code>{upload.keys[name]}</code> : "—"}</td>
                <td>
                  {facts ? (
                    <a
                      data-testid={`lineage-download-${name}`}
                      href={coordinatorClient.lineageConversionReportFileUrl(report.conversion_job_id, name)}
                      download={`${report.conversion_job_id}_${name}`}
                    >
                      {t("下載", "Download")}
                    </a>
                  ) : t("未產出", "Not produced")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="lineage-report-hint">{UPLOAD[upload.status]}</p>
      <h3>{t("來源", "Sources")}</h3>
      <dl className="lineage-report-detail">
        <div><dt>{t("IFC 物件", "IFC object")}</dt><dd><code>{report.source_ifc.bucket ?? "—"}/{report.source_ifc.key ?? "—"}</code></dd></div>
        <div><dt>IFC ETag</dt><dd><code>{report.source_ifc.etag ?? "—"}</code></dd></div>
        <div><dt>schedule.csv</dt><dd><code>{report.schedule.key ?? "—"}</code></dd></div>
        <div><dt>schedule ETag</dt><dd><code>{report.schedule.etag ?? "—"}</code></dd></div>
        <div><dt>schedule SHA-256</dt><dd><code className="lineage-report-hash">{report.schedule.sha256 ?? "—"}</code></dd></div>
        <div><dt>{t("模型編號", "Model id")}</dt><dd><code>{report.source_model_id}</code></dd></div>
        <div><dt>{t("收件編號", "Intake job")}</dt><dd><code>{report.ifc_ready_job_id}</code></dd></div>
      </dl>
      <p className="lineage-report-hint">
        {t("RVT 原始檔本身不在比對範圍內；Revit 元件以同資料夾的 schedule.csv 代表。",
          "The RVT file itself is not compared; Revit elements are represented by the schedule.csv in the same folder.")}
      </p>
    </div>
  );
}

function Attempts({ report }: { report: LineageConversionReport }): JSX.Element {
  const key = report.source_ifc.key;
  const fetcher = useCallback(
    () => key
      ? coordinatorClient.listLineageConversionReports({ sourceIfcKey: key, limit: 200 })
      : Promise.resolve({ count: 1, items: [report] }),
    [key, report],
  );
  const [load, retry] = useLoad(fetcher);
  if (load.state === "loading") return <p role="status">{t("讀取轉檔歷史中…", "Loading attempts…")}</p>;
  if (load.state !== "loaded") {
    return <Retry onRetry={retry} testId="lineage-attempts-error" message={t("無法取得轉檔歷史。", "Attempts are unavailable.")} />;
  }
  return (
    <>
      {!key && <p className="lineage-report-hint">{t("來源 IFC 不明，只能列出這一次轉檔。", "The source IFC is unknown; only this conversion is listed.")}</p>}
      <table>
        <thead>
          <tr>
            <th scope="col">{t("轉檔時間", "Converted")}</th>
            <th scope="col">{t("轉檔編號", "Conversion")}</th>
            <th scope="col">{t("報表", "Report")}</th>
            <th scope="col">{t("完整追溯", "Lineage")}</th>
            <th scope="col">MinIO</th>
          </tr>
        </thead>
        <tbody>
          {load.value.items.map((item) => (
            <tr key={item.conversion_job_id} data-testid="lineage-attempt" aria-current={item.conversion_job_id === report.conversion_job_id ? "true" : undefined}>
              <td>{when(item.conversion_created_at)}</td>
              <td><a href={reportHref(item.conversion_job_id)}><code>{item.conversion_job_id}</code></a></td>
              <td data-status={item.status}>{STATUS[item.status]}</td>
              <td>{item.metrics ? percent(item.metrics.rvt_ifc_usdc_lineage_ratio.ratio) : "—"}</td>
              <td>{item.minio_upload.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Audit(): JSX.Element {
  return (
    <div className="lineage-report-callout" data-testid="lineage-audit" data-state="NOT_BUILT">
      <strong>NOT_BUILT</strong>
      <p>{t("結果升版、回滾與 runtime 釋放的稽核屬於 governed 流程，需要外部授權，尚未建置。本頁不模擬這些紀錄。",
        "Audit of promotion, rollback and runtime release belongs to the governed flow, needs external authorization and is not built yet. This page does not simulate those records.")}</p>
    </div>
  );
}
