import type { ReviewIssue } from "../types/issues";

interface IssuePanelProps {
    issues: ReviewIssue[];
    width: number;
    onIssueClick: (issue: ReviewIssue) => void;
}

export default function IssuePanel({ issues, width, onIssueClick }: IssuePanelProps) {
    return (
        <div style={{ width, background: "#FEFEFE", color: "#656565", borderBottom: "1px solid #d8d8d8" }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 600 }}>審查問題</div>
            <div style={{ padding: 8, fontSize: 12, maxHeight: 180, overflow: "auto" }}>
                {issues.map((issue) => (
                    <button
                        key={issue.issue_id}
                        type="button"
                        className="nvidia-button"
                        onClick={() => onIssueClick(issue)}
                        style={{ width: "100%", marginBottom: 6, textAlign: "left", height: "auto", padding: "6px 8px" }}
                        disabled={!issue.usd_prim_path}
                    >
                        {issue.severity.toUpperCase()} {issue.title}
                    </button>
                ))}
                {issues.length === 0 && <div>目前沒有審查問題</div>}
            </div>
        </div>
    );
}
