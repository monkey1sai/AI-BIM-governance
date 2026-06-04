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
