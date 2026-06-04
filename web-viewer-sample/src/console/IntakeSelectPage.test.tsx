// web-viewer-sample/src/console/IntakeSelectPage.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntakeSelectPage } from "./IntakeSelectPage";

describe("IntakeSelectPage A1 進件（選現成模型，不手填路徑）", () => {
  it("呈現「選現成模型」UI 且不含手填模型路徑 input", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain("選取現成模型"); // 選取式 UI
    expect(html).toContain("/api/external/ifc-ready"); // 真實端點來源（誠實）
    // 不得出現「手填路徑」式的可編輯模型路徑欄位（誠實鐵律：不手填）。
    expect(html).not.toMatch(/placeholder="[^"]*模型[^"]*路徑/);
    expect(html).not.toMatch(/placeholder="[^"]*\.ifc/);
  });

  it("標 provenance 且只打 coordinator :8004（不直連內部埠）", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain("ec-prov");
    expect(html).not.toContain(":49102");
    expect(html).not.toContain(":49101");
    expect(html).not.toContain(":49100");
  });
});
