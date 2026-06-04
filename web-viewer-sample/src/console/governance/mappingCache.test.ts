// web-viewer-sample/src/console/governance/mappingCache.test.ts
import { describe, expect, it } from "vitest";
import { MappingCache } from "./mappingCache";
import type { ElementMappingDocument } from "../../types/mapping";

const REAL: ElementMappingDocument = {
  mock: false,
  model_version_id: "mv_001",
  summary: { mapped_count: 2, unmapped_ifc_count: 1, fake_mapping_count: 0 },
  items: [
    { ifc_guid: "GUID_A", usd_prim_path: "/World/IfcWall/_A", ifc_class: "IfcWall", name: "Wall-A" },
    { ifc_guid: "GUID_B", usd_prim_path: "/World/IfcDoor/_B", ifc_class: "IfcDoor", name: "Door-B" },
  ],
};

describe("MappingCache 雙向查詢（鎖單一 model version）", () => {
  it("ifc_guid → usd_prim_path", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.primPathForGuid("GUID_A")).toBe("/World/IfcWall/_A");
    expect(cache.primPathForGuid("GUID_B")).toBe("/World/IfcDoor/_B");
  });

  it("usd_prim_path → ifc_guid（點 3D 反查）", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.guidForPrimPath("/World/IfcDoor/_B")).toBe("GUID_B");
  });

  it("未對映 guid 回 null（不捏造）", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.primPathForGuid("GUID_MISSING")).toBeNull();
    expect(cache.guidForPrimPath("/World/Nope")).toBeNull();
  });

  it("鎖定的 model version 可讀回", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.modelVersionId).toBe("mv_001");
  });
});

// 追加至 mappingCache.test.ts 末端
import { isFakeMappingDocument } from "../../types/mapping";

describe("MappingCache fake 隔離 + coverage（誠實，不灌水）", () => {
  it("fake mapping document 被拒（fromDocument 標 fake，雙向 index 為空）", () => {
    const fakeDoc = { mock: true, items: [{ ifc_guid: "g", usd_prim_path: "/World/X" }] };
    expect(isFakeMappingDocument(fakeDoc)).toBe(true); // 重用既有工具
    const cache = MappingCache.fromDocument(fakeDoc, "mv_fake");
    expect(cache.isFake).toBe(true);
    expect(cache.primPathForGuid("g")).toBeNull(); // fake → 不提供真實對映
  });

  it("coverage% = mapped_count / source_ifc_entity_count（denominator 為來源 IFC 實體數）", () => {
    const doc = {
      mock: false,
      model_version_id: "mv_cov",
      summary: { mapped_count: 90, source_ifc_entity_count: 100, fake_mapping_count: 0 },
      items: [{ ifc_guid: "g", usd_prim_path: "/World/X" }],
    } as ElementMappingDocument & { summary: { source_ifc_entity_count: number } };
    const cache = MappingCache.fromDocument(doc, "mv_cov");
    expect(cache.coverageRatio()).toBeCloseTo(0.9, 5);
  });

  it("無 source_ifc_entity_count 時 coverage 回 null（誠實，不假裝 1.0）", () => {
    const doc = { mock: false, summary: { mapped_count: 5, fake_mapping_count: 0 }, items: [] };
    const cache = MappingCache.fromDocument(doc, "mv_x");
    expect(cache.coverageRatio()).toBeNull();
  });
});
