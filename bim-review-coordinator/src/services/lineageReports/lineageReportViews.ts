import type { LineageAlignmentDifferenceSet } from "../lineage/lineageAlignmentReport.js";
import type { LineageReportRecord } from "./lineageReportStore.js";

/** `GET /api/lineage/conversion-reports` 回應。 */
export type LineageConversionReportList = {
  count: number;
  items: LineageReportRecord[];
};

/** `GET /api/lineage/conversion-reports/{id}/differences` 回應（單一差異集合的一頁）。 */
export type LineageConversionReportDifferences = {
  conversion_job_id: string;
  set: LineageAlignmentDifferenceSet;
  /** 報表實際列出的筆數（分頁依據）。 */
  total: number;
  /** 報表計數欄位的權威數量；可能大於 total。 */
  authoritative_count: number;
  offset: number;
  limit: number;
  items: Array<Record<string, unknown>>;
};
