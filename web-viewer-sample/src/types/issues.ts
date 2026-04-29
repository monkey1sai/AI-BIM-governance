export interface ReviewIssue {
    issue_id: string;
    project_id?: string;
    model_version_id?: string;
    source?: string;
    severity: "info" | "warning" | "error" | string;
    status?: string;
    title: string;
    description?: string;
    ifc_guid?: string | null;
    usd_prim_path?: string | null;
}
