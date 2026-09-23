// Issue Center 列表篩選（building-energy-cfd-p2-contract.md §6 R-A1 同輪的 Issues/BCF 修正）。
// CFD 風環境 finding 以 governance annotation 開立（不綁 ifc_guid），usd_prim_path 指向 CFD 疊圖的行人面 prim；
// 以既有的 CFD 疊圖根路徑辨識，不另訂規則。
import { CFD_OVERLAY_ROOT } from "../viewerCommandChannel/overlayStyle";
import type { IssueRow } from "./governanceClient";

export type IssueFilter = "all" | "issue" | "annotation" | "cfd";

export const ISSUE_FILTERS: readonly IssueFilter[] = ["all", "issue", "annotation", "cfd"];

/** Issue Center 每次最多列出的筆數（沿用既有上限）；篩選在截斷之前套用。 */
export const ISSUE_LIST_LIMIT = 30;

export function isCfdIssue(row: Pick<IssueRow, "usd_prim_path">): boolean {
  return typeof row.usd_prim_path === "string" && row.usd_prim_path.startsWith(`${CFD_OVERLAY_ROOT}/`);
}

export function filterIssues<T extends Pick<IssueRow, "kind" | "usd_prim_path">>(rows: readonly T[], filter: IssueFilter): T[] {
  switch (filter) {
    case "issue": return rows.filter((row) => row.kind === "issue");
    case "annotation": return rows.filter((row) => row.kind === "annotation");
    case "cfd": return rows.filter(isCfdIssue);
    default: return [...rows];
  }
}
