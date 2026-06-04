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

  // R8：live 點選常落在 child mesh prim → guidForPrimPathOrAncestor 往父走命中 mapped ancestor。
  it("guidForPrimPathOrAncestor：child mesh prim 解析到父層 mapped guid", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    // exact key 仍命中。
    expect(cache.guidForPrimPathOrAncestor("/World/IfcWall/_A")).toBe("GUID_A");
    // child path（mapping 無此 key）→ 往父層走，命中 /World/IfcWall/_A。
    expect(cache.guidForPrimPathOrAncestor("/World/IfcWall/_A/Mesh")).toBe("GUID_A");
    // 多層 child 一樣解析（如 …/G_<guid>/mesh_0 形態）。
    expect(cache.guidForPrimPathOrAncestor("/World/IfcDoor/_B/mesh_0/sub")).toBe("GUID_B");
    // 完全無對映祖先 → null（誠實，不捏造）。
    expect(cache.guidForPrimPathOrAncestor("/World/Unknown/Mesh")).toBeNull();
    // guidForPrimPath（exact）對 child path 仍回 null（不破壞 exact 語意）。
    expect(cache.guidForPrimPath("/World/IfcWall/_A/Mesh")).toBeNull();
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

// W5：coverage 不再由 MappingCache 計算（真實 summary 無分母 source_ifc_entity_count，自算會誤判）；
// coverage 改由 streamConfig.quality_metrics_summary.coverage_ratio 原樣提供。故此處只留 fake 隔離測試，
// coverage-ratio 測試已移除（對應 MappingCache.coverageRatio() 一併刪除）。
describe("MappingCache fake 隔離（誠實，不灌水）", () => {
  it("fake mapping document 被拒（fromDocument 標 fake，雙向 index 為空）", () => {
    const fakeDoc = { mock: true, items: [{ ifc_guid: "g", usd_prim_path: "/World/X" }] };
    expect(isFakeMappingDocument(fakeDoc)).toBe(true); // 重用既有工具
    const cache = MappingCache.fromDocument(fakeDoc, "mv_fake");
    expect(cache.isFake).toBe(true);
    expect(cache.primPathForGuid("g")).toBeNull(); // fake → 不提供真實對映
    expect(cache.guidForPrimPath("/World/X")).toBeNull();
  });
});

describe("MappingCache 鎖單一 model version（Q2：不跨版本失效）", () => {
  it("belongsTo 判定當前鎖定版本（不同版本回 false，提示需重建）", () => {
    const doc: ElementMappingDocument = { mock: false, model_version_id: "mv_1", summary: { mapped_count: 1, fake_mapping_count: 0 }, items: [{ ifc_guid: "g", usd_prim_path: "/W/x" }] };
    const cache = MappingCache.fromDocument(doc, "mv_1");
    expect(cache.belongsTo("mv_1")).toBe(true);
    expect(cache.belongsTo("mv_2")).toBe(false); // 換版本 → 不複用舊 cache（誠實，不跨版本智能失效）
  });
});
