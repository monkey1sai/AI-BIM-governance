// web-viewer-sample/src/console/governance/mappingCache.ts
// MappingCache：client 端快取 element_mapping 的 ifc_guid ↔ usd_prim_path 雙向 index。
// 鎖單一 model version（Q2：不做跨版本智能失效）。只讀 + 不寫回；mapping 權威在 conversion artifact。
import type { ElementMappingDocument, ElementMappingItem } from "../../types/mapping";

export class MappingCache {
  readonly modelVersionId: string | null;
  private readonly guidToPrim: Map<string, string>;
  private readonly primToGuid: Map<string, string>;

  private constructor(modelVersionId: string | null, items: ElementMappingItem[]) {
    this.modelVersionId = modelVersionId;
    this.guidToPrim = new Map();
    this.primToGuid = new Map();
    for (const item of items) {
      if (item.ifc_guid && item.usd_prim_path) {
        this.guidToPrim.set(item.ifc_guid, item.usd_prim_path);
        this.primToGuid.set(item.usd_prim_path, item.ifc_guid);
      }
    }
  }

  static fromDocument(doc: ElementMappingDocument, modelVersionId: string | null): MappingCache {
    const items = Array.isArray(doc.items) ? doc.items : [];
    return new MappingCache(modelVersionId ?? doc.model_version_id ?? null, items);
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
}
