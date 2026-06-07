// CH-H2：IfcSemanticView 純展示單元測（②IFC語意 + ⑥空間 + ⑤/分類碼誠實 roadmap）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IfcSemanticView } from "./IfcSemanticPanel";

const SAMPLE = {
  ifc_guid: "3$xKPHQlD10AG1nzmJabuU",
  ifc_type: "IfcColumn",
  ifc_name: "COL-450x600",
  predefined_type: "COLUMN",
  tag: "C-234",
  psets: {
    Pset_ColumnCommon: { Reference: "C-234", Status: "EXISTING", IsExternal: false },
    Qto_ColumnBaseQuantities: { Length: 3.0, CrossSectionArea: 0.27 },
  },
  spatial: [
    { ifc_type: "IfcBuildingStorey", name: "2F" },
    { ifc_type: "IfcBuilding", name: "Building A" },
    { ifc_type: "IfcSite", name: "Site A" },
  ],
  classification: null,
  geometry: null,
  roadmap: ["classification: MasterFormat/OmniClass/Uniformat", "geometry: bbox/volume/material"],
};

describe("IfcSemanticView（②IFC語意 + ⑥空間 + 誠實 roadmap）", () => {
  it("② 顯真實 Type/PredefinedType/Tag + Pset/Quantity 值", () => {
    const html = renderToString(<IfcSemanticView data={SAMPLE} />);
    expect(html).toContain("IfcColumn");
    expect(html).toContain("COLUMN");
    expect(html).toContain("Pset_ColumnCommon");
    expect(html).toContain("EXISTING"); // Pset 屬性值
    expect(html).toContain("Qto_ColumnBaseQuantities");
  });

  it("⑥ 顯空間容納鏈（Storey/Building/Site）", () => {
    const html = renderToString(<IfcSemanticView data={SAMPLE} />);
    expect(html).toContain("IfcBuildingStorey");
    expect(html).toContain("Building A");
    expect(html).toContain("IfcSite");
  });

  it("⑤幾何/分類碼誠實 roadmap（不捏造數值）", () => {
    const html = renderToString(<IfcSemanticView data={SAMPLE} />);
    expect(html).toContain('data-testid="sem-roadmap"');
    expect(html).toMatch(/roadmap|N\/A/);
    // classification null → 不出現假分類碼
    expect(html).not.toContain("MasterFormat:"); // 不顯示具體假分類值
  });

  it("缺欄位顯「—」不捏造（誠實降級）", () => {
    const html = renderToString(<IfcSemanticView data={{ ifc_type: "IfcWall" }} />);
    expect(html).toContain("IfcWall");
    expect(html).toContain("—"); // predefined/tag/name 缺 → DASH
  });
});
