import type { RuleResultRow } from "../governanceClient";
import type { HighlightItem } from "../EmbeddedViewer";

const severityRank: Record<string, number> = { critical: 5, high: 4, error: 3, required: 3, medium: 2, warning: 2, low: 1, info: 0 };
export function issueHighlightItems(rows: RuleResultRow[]): HighlightItem[] {
  const byGuid = new Map<string, RuleResultRow>();
  for (const row of [...rows].sort((a, b) => a.rule_code.localeCompare(b.rule_code))) {
    if (!row.ifc_guid || !row.usd_prim_path) continue;
    const previous = byGuid.get(row.ifc_guid);
    if (!previous || (severityRank[row.severity.toLowerCase()] ?? 0) > (severityRank[previous.severity.toLowerCase()] ?? 0)) byGuid.set(row.ifc_guid, row);
  }
  return [...byGuid.values()].map(row => ({ ifc_guid: row.ifc_guid!, severity: row.severity,
    rule_code: row.rule_code, label: row.message || row.rule_code }));
}
