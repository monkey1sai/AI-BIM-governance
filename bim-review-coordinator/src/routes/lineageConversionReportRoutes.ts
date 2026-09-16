import { createHash } from "node:crypto";
import type express from "express";
import {
  LINEAGE_ALIGNMENT_DIFFERENCE_SETS,
  parseLineageAlignmentReport,
  type LineageAlignmentDifferenceSet,
  type LineageAlignmentReportBody,
} from "../services/lineage/lineageAlignmentReport.js";
import {
  LINEAGE_REPORT_FILES,
  LineageReportStoreUnavailableError,
  isConversionJobId,
  type LineageReportFileName,
  type LineageReportStore,
} from "../services/lineageReports/lineageReportStore.js";
import type {
  LineageConversionReportDifferences,
  LineageConversionReportList,
} from "../services/lineageReports/lineageReportViews.js";

/**
 * 轉檔對齊報表的唯讀 API（legacy MinIO watch 流程）。
 *
 * 依 owner 決定比照其他 console 讀取頁，不另外驗證授權；回應只含中繼資料與報表內容，
 * 不含本機路徑、簽章 URL 或憑證。governed 流程的 `/api/lineage/pipeline-jobs/*` 不受影響。
 */
export type LineageConversionReportRouteDeps = { store: LineageReportStore };

const MAX_KEY_LENGTH = 1024;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1000;
const CONTENT_TYPES: Record<LineageReportFileName, string> = {
  "alignment_report.json": "application/json; charset=utf-8",
  "alignment_report.csv": "text/csv; charset=utf-8",
};
const COUNT_FIELDS: Record<LineageAlignmentDifferenceSet, keyof LineageAlignmentReportBody["counts"]> = {
  csv_only: "csv_only_count",
  ifc_only: "ifc_only_count",
  ifc_usdc_unmapped: "ifc_usdc_unmapped_count",
  duplicate_rvt_ids: "duplicate_rvt_id_count",
  duplicate_ifc_guids: "duplicate_ifc_guid_count",
  invalid_rows: "invalid_row_count",
  full_lineage_matched: "full_lineage_matched_count",
};

type Query = Record<string, unknown>;

/** 單值字串參數：缺值回 undefined；陣列、物件或非字串回 null（不合法）。 */
function single(query: Query, name: string): string | undefined | null {
  const value = query[name];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function integer(raw: string | undefined | null, fallback: number, min: number, max: number): number | null {
  if (raw === null) return null;
  if (raw === undefined) return fallback;
  if (!/^\d{1,7}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function reject(response: express.Response, status: number, error: string): void {
  response.status(status).json({ error });
}

/** 報表 JSON 解析結果的單筆快取（同一份報表常被連續翻頁）。 */
function createBodyCache() {
  let cached: { key: string; body: LineageAlignmentReportBody } | null = null;
  return (key: string, bytes: Buffer): LineageAlignmentReportBody | null => {
    if (cached?.key === key) return cached.body;
    const body = parseLineageAlignmentReport(bytes);
    cached = body ? { key, body } : null;
    return body;
  };
}

export function registerLineageConversionReportRoutes(
  app: express.Express,
  deps: LineageConversionReportRouteDeps,
): void {
  const parseBody = createBodyCache();

  const guard =
    (handler: (request: express.Request, response: express.Response) => void) =>
    (request: express.Request, response: express.Response, next: express.NextFunction): void => {
      try {
        handler(request, response);
      } catch (err) {
        if (err instanceof LineageReportStoreUnavailableError) {
          reject(response, 503, "lineage_report_store_unavailable");
          return;
        }
        next(err);
      }
    };

  app.get(
    "/api/lineage/conversion-reports",
    guard((request, response) => {
      const query = request.query as Query;
      const key = single(query, "source_ifc_key");
      const limit = integer(single(query, "limit"), DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
      if (key === null || key === "" || (key !== undefined && key.length > MAX_KEY_LENGTH) || limit === null) {
        reject(response, 400, "invalid_lineage_report_query");
        return;
      }
      const items = deps.store
        .list()
        .filter((record) => key === undefined || record.source_ifc.key === key);
      const body: LineageConversionReportList = { count: items.length, items: items.slice(0, limit) };
      response.json(body);
    }),
  );

  app.get(
    "/api/lineage/conversion-reports/:conversionJobId",
    guard((request, response) => {
      const id = request.params.conversionJobId;
      if (!isConversionJobId(id)) {
        reject(response, 400, "invalid_conversion_job_id");
        return;
      }
      const record = deps.store.get(id);
      if (!record) {
        reject(response, 404, "lineage_report_not_found");
        return;
      }
      response.json(record);
    }),
  );

  app.get(
    "/api/lineage/conversion-reports/:conversionJobId/differences",
    guard((request, response) => {
      const id = request.params.conversionJobId;
      const query = request.query as Query;
      const set = single(query, "set");
      const offset = integer(single(query, "offset"), 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = integer(single(query, "limit"), DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
      if (!isConversionJobId(id)) {
        reject(response, 400, "invalid_conversion_job_id");
        return;
      }
      if (
        typeof set !== "string" ||
        !(LINEAGE_ALIGNMENT_DIFFERENCE_SETS as readonly string[]).includes(set) ||
        offset === null ||
        limit === null
      ) {
        reject(response, 400, "invalid_lineage_report_query");
        return;
      }
      const record = deps.store.get(id);
      if (!record) {
        reject(response, 404, "lineage_report_not_found");
        return;
      }
      const facts = record.files["alignment_report.json"];
      const bytes = record.status === "generated" ? deps.store.readFile(id, "alignment_report.json") : null;
      const body = bytes && facts ? parseBody(`${id}:${facts.sha256}`, bytes) : null;
      if (!body) {
        reject(response, 404, "lineage_report_not_generated");
        return;
      }
      const name = set as LineageAlignmentDifferenceSet;
      const rows = body.difference_sets[name] as Array<Record<string, unknown>>;
      const page: LineageConversionReportDifferences = {
        conversion_job_id: id,
        set: name,
        total: rows.length,
        authoritative_count: body.counts[COUNT_FIELDS[name]],
        offset,
        limit,
        items: rows.slice(offset, offset + limit),
      };
      response.json(page);
    }),
  );

  // 檔案下載不是 JSON，不列在 Browser Contract（比照 conversion validation 報表）。
  app.get(
    "/api/lineage/conversion-reports/:conversionJobId/files/:fileName",
    guard((request, response) => {
      const id = request.params.conversionJobId;
      const name = request.params.fileName as LineageReportFileName;
      if (!isConversionJobId(id) || !LINEAGE_REPORT_FILES.includes(name)) {
        reject(response, 404, "lineage_report_file_not_found");
        return;
      }
      const facts = deps.store.get(id)?.files[name];
      const bytes = facts ? deps.store.readFile(id, name) : null;
      if (!facts || !bytes) {
        reject(response, 404, "lineage_report_file_not_found");
        return;
      }
      if (bytes.length !== facts.size_bytes || createHash("sha256").update(bytes).digest("hex") !== facts.sha256) {
        reject(response, 409, "lineage_report_file_mismatch");
        return;
      }
      response
        .status(200)
        .set({
          "Content-Type": CONTENT_TYPES[name],
          "Content-Disposition": `attachment; filename="${id}_${name}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        .send(bytes);
    }),
  );
}
