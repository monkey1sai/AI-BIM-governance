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

  it("初始渲染含穩定選取子：intake-refresh + intake-empty（table/radio/error 屬非同步狀態，由 browser E2E 覆蓋）", () => {
    // renderToString 無法觸發 coordinator 非同步抓取，初始為空佇列（非錯誤）→ 只斷言恆在的選取子。
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain('data-testid="intake-refresh"');
    expect(html).toContain('data-testid="intake-empty"');
  });

  // W6：選取後可「開啟審查 viewer」。初始（無選取、無 viewer_url）→ 按鈕渲染且 disabled（不做假導航）。
  it("含 intake-open 按鈕；初始未選取 → disabled（不假導航）", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain('data-testid="intake-open"');
    const openBtn = html.match(/<button[^>]*data-testid="intake-open"[^>]*>/);
    expect(openBtn?.[0]).toContain("disabled"); // 初始未選取 / 無 viewer_url → disabled
  });
});
