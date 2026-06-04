// web-viewer-sample/src/console/GovernanceOverlay.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GovernanceOverlay } from "./GovernanceOverlay";

const baseProps = {
  panelState: { canOperate: true, disabledReason: null as null },
  coverage: { coverageOk: true, degraded: false, ratio: 1.0 },
  failedElements: [],
  onHighlight: () => ({ ok: true as const, primPath: "/World/X", requestId: "r1" }),
  onClearHighlight: () => {},
};

describe("GovernanceOverlay A1–A10 overlay（MVP 接 A2/A3/A4/A8）", () => {
  it("含 A2/A3/A4/A8 已有引擎區塊，且標 provenance", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(html).toContain("A2"); // 轉檔 / 語意映射
    expect(html).toContain("A3"); // 規則庫 / IDS
    expect(html).toContain("A4"); // 完整性 / 治理分
    expect(html).toContain("A8"); // Issue / BCF
    expect(html).toContain("ec-prov"); // provenance 標記存在
  });

  it("A5/A6/A9/A10 標願景且 disabled（不假裝 ready）", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(html).toContain("A5");
    expect(html).toContain("A9");
    // 願景 phase 標記（PROV_LABEL.p3 / p4）。
    expect(html).toMatch(/願景 · Phase [34]（後端未建）/);
  });

  it("無願景假數字", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(html).not.toContain("99.1%");
    expect(html).not.toContain("92.4%");
    expect(html).not.toContain("127 rules");
  });
});
