import type { HighlightItem } from "../types/streamMessages";

export const demoPrimPath = "/World";
export const demoIssueId = "ISSUE-DEMO-001";
export const demoIfcGuid = "2VJ3sK9L000fake001";

export function buildDemoHighlightItem(source: string): HighlightItem {
    return {
        prim_path: demoPrimPath,
        ifc_guid: demoIfcGuid,
        color: [1, 0, 0, 1],
        label: "Demo highlight from Web Viewer Demo Panel",
        source,
        issue_id: demoIssueId,
    };
}
