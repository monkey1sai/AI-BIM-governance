// CH-H2 ③：結構類別計數派生 + 純展示單元測。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { classCountsFromDoc, SpatialTreeView, StructureStatsView } from "./StructureStats";

describe("classCountsFromDoc（依 ifc_class 分組計數，降序）", () => {
  it("由真實 element_mapping items 派生類別計數並降序", () => {
    const doc = { items: [
      { ifc_guid: "a", ifc_class: "IfcWall" }, { ifc_guid: "b", ifc_class: "IfcWall" },
      { ifc_guid: "c", ifc_class: "IfcColumn" }, { ifc_guid: "d", ifc_class: "IfcWall" },
    ] };
    const counts = classCountsFromDoc(doc);
    expect(counts[0]).toEqual({ ifc_class: "IfcWall", count: 3 });
    expect(counts[1]).toEqual({ ifc_class: "IfcColumn", count: 1 });
  });
  it("空 doc → 空陣列（不捏造）", () => {
    expect(classCountsFromDoc(null)).toEqual([]);
    expect(classCountsFromDoc({ items: [] })).toEqual([]);
  });
});

describe("SpatialTreeView（空間巢狀樹）", () => {
  it("遞迴顯 Project>Site>Building>Storey + 類別計數（Ifc 前綴去除）", () => {
    const node = {
      ifc_type: "IfcProject", name: "P",
      children: [{
        ifc_type: "IfcSite", name: "Site A",
        children: [{ ifc_type: "IfcBuildingStorey", name: "2F", type_counts: { IfcWall: 256, IfcColumn: 48 }, children: [] }],
      }],
    };
    const html = renderToString(<SpatialTreeView node={node} />);
    expect(html).toContain("IfcProject");
    expect(html).toContain("IfcSite");
    expect(html).toContain("IfcBuildingStorey");
    expect(html).toContain("2F");
    expect(html).toContain("Wall 256");
    expect(html).toContain("Column 48");
  });
});

describe("StructureStatsView", () => {
  it("顯類別 + 計數 + 總數，且標 roadmap（空間巢狀未假造）", () => {
    const html = renderToString(<StructureStatsView counts={[{ ifc_class: "IfcWall", count: 256 }, { ifc_class: "IfcColumn", count: 48 }]} total={304} />);
    expect(html).toContain("IfcWall");
    expect(html).toContain("256");
    expect(html).toContain("IfcColumn");
    expect(html).toContain('data-testid="struct-total"');
    expect(html).toMatch(/類別計數|真實 session/); // fallback：完整空間巢狀需真實 session
  });
});
