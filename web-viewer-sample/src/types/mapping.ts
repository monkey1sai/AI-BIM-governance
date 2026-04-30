export interface ElementMappingItem {
    mock?: boolean;
    ifc_guid?: string | null;
    ifc_class?: string | null;
    name?: string | null;
    revit_element_id?: string | number | null;
    usd_prim_path?: string | null;
    usd_prim_type?: string | null;
    mapping_confidence?: number | null;
    mapping_method?: string | null;
}

export interface ElementMappingSummary {
    mapped_count?: number;
    unmapped_ifc_count?: number;
    unmapped_usd_count?: number;
    fake_mapping_count?: number;
}

export interface ElementMappingDocument {
    mock?: boolean;
    project_id?: string;
    model_version_id?: string;
    source_artifact_id?: string;
    usdc_artifact_id?: string;
    mapping_version?: string;
    generated_at?: string;
    allow_fake_mapping?: boolean;
    items?: ElementMappingItem[];
    unmapped_ifc_guids?: string[];
    unmapped_usd_prims?: string[];
    summary?: ElementMappingSummary;
}

export function isFakeMappingItem(item: ElementMappingItem): boolean {
    return item.mock === true || item.mapping_method === "fake_for_smoke_test";
}

export function isFakeMappingDocument(document: ElementMappingDocument): boolean {
    return document.mock === true
        || document.allow_fake_mapping === true
        || (document.summary?.fake_mapping_count ?? 0) > 0
        || (document.items ?? []).some(isFakeMappingItem);
}

export function mappingVerificationBlockReason(document: ElementMappingDocument): string | null {
    if (!isFakeMappingDocument(document)) {
        return null;
    }
    return "偵測到 mock / fake_for_smoke_test mapping；此資料只可做 smoke test，不列入正式 mapping 驗證";
}
