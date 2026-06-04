// web-viewer-sample/src/console/governance/mappingCache.ts
// MappingCache：client 端快取 element_mapping 的 ifc_guid ↔ usd_prim_path 雙向 index。
// 鎖單一 model version（Q2：不做跨版本智能失效）。只讀 + 不寫回；mapping 權威在 conversion artifact。
import { isFakeMappingDocument, type ElementMappingDocument, type ElementMappingItem } from "../../types/mapping";

export class MappingCache {
  readonly modelVersionId: string | null;
  readonly isFake: boolean;
  // coverage 分子用 summary.mapped_count（來源側統計的已對映實體數），分母用 source_ifc_entity_count；
  // 兩者皆來自 conversion summary，不用 client 端 index 大小冒充（index 只覆蓋有完整 guid+prim 的 item）。
  private readonly summaryMappedCount: number | null;
  private readonly sourceEntityCount: number | null;
  private readonly guidToPrim: Map<string, string>;
  private readonly primToGuid: Map<string, string>;

  private constructor(
    modelVersionId: string | null,
    items: ElementMappingItem[],
    isFake: boolean,
    summaryMappedCount: number | null,
    sourceEntityCount: number | null,
  ) {
    this.modelVersionId = modelVersionId;
    this.isFake = isFake;
    this.summaryMappedCount = summaryMappedCount;
    this.sourceEntityCount = sourceEntityCount;
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
    const summary = doc.summary as { source_ifc_entity_count?: number; mapped_count?: number } | undefined;
    const sourceEntityCount =
      typeof summary?.source_ifc_entity_count === "number" ? summary.source_ifc_entity_count : null;
    const summaryMappedCount = typeof summary?.mapped_count === "number" ? summary.mapped_count : null;
    return new MappingCache(
      modelVersionId ?? doc.model_version_id ?? null,
      items,
      isFake,
      summaryMappedCount,
      sourceEntityCount,
    );
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

  coverageRatio(): number | null {
    if (this.isFake) return null; // fake 不算覆蓋率
    if (this.sourceEntityCount === null || this.sourceEntityCount <= 0) return null;
    const numerator = this.summaryMappedCount ?? this.mappedCount;
    return numerator / this.sourceEntityCount;
  }
}
