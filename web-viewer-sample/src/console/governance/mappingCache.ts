// web-viewer-sample/src/console/governance/mappingCache.ts
// MappingCache：client 端快取 element_mapping 的 ifc_guid ↔ usd_prim_path 雙向 index。
// 鎖單一 model version（Q2：不做跨版本智能失效）。只讀 + 不寫回；mapping 權威在 conversion artifact。
// W5：coverage 不由本快取計算 —— 真實 element_mapping summary 只有 {mapped_count, fake_mapping_count}，
//     無分母（source_ifc_entity_count），自算會誤判。coverage 改由 streamConfig.quality_metrics_summary
//     .coverage_ratio 原樣提供（型別文件規定 viewer MUST NOT compute）。本快取只保留 isFake + 雙向 index。
import { isFakeMappingDocument, type ElementMappingDocument, type ElementMappingItem } from "../../types/mapping";

export class MappingCache {
  readonly modelVersionId: string | null;
  readonly isFake: boolean;
  private readonly guidToPrim: Map<string, string>;
  private readonly primToGuid: Map<string, string>;

  private constructor(
    modelVersionId: string | null,
    items: ElementMappingItem[],
    isFake: boolean,
  ) {
    this.modelVersionId = modelVersionId;
    this.isFake = isFake;
    this.guidToPrim = new Map();
    this.primToGuid = new Map();
    if (!isFake) {
      // fake mapping 不建真實對映（誠實：不冒充真實覆蓋率 / 不提供假 prim）。
      for (const item of items) {
        if (item.ifc_guid && item.usd_prim_path) {
          this.guidToPrim.set(item.ifc_guid, item.usd_prim_path);
          this.primToGuid.set(item.usd_prim_path, item.ifc_guid);
        }
      }
    }
  }

  static fromDocument(doc: ElementMappingDocument, modelVersionId: string | null): MappingCache {
    const items = Array.isArray(doc.items) ? doc.items : [];
    const isFake = isFakeMappingDocument(doc);
    return new MappingCache(modelVersionId ?? doc.model_version_id ?? null, items, isFake);
  }

  primPathForGuid(ifcGuid: string): string | null {
    return this.guidToPrim.get(ifcGuid) ?? null;
  }

  guidForPrimPath(primPath: string): string | null {
    return this.primToGuid.get(primPath) ?? null;
  }

  get mappedCount(): number {
    return this.guidToPrim.size;
  }

  belongsTo(modelVersionId: string | null): boolean {
    return this.modelVersionId !== null && this.modelVersionId === modelVersionId;
  }
}
