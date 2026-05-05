export interface HighlightItem {
    prim_path: string;
    ifc_guid?: string | null;
    color?: number[];
    label?: string;
    source?: string;
    issue_id?: string;
    mapping_method?: string | null;
    mapping_confidence?: number | null;
}

export interface StreamMessage {
    event_type: string;
    payload: unknown;
}
