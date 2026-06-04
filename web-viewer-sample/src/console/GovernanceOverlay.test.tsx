// web-viewer-sample/src/console/GovernanceOverlay.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GovernanceOverlay } from "./GovernanceOverlay";
import { GOV_PANEL_REASON_TEXT } from "./governance/govPanelState";

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

describe("GovernanceOverlay spectator 唯讀 / 等待 viewer（誠實 disabled，非隱藏）", () => {
  it("spectator → 顯示唯讀橫幅且操作鈕 disabled，但面板仍可見（不隱藏）", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: false, disabledReason: "spectator_read_only" }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[{ ifc_guid: "G1", severity: "error" }]}
        onHighlight={() => ({ ok: true, primPath: "/World/X", requestId: "r" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain(GOV_PANEL_REASON_TEXT.spectator_read_only); // 誠實表態
    expect(html).toContain("gov-readonly"); // 容器標唯讀（CSS 禁用操作）
    // 面板內容仍渲染（不隱藏）：A2/A3/A4/A8 仍在。
    expect(html).toContain("A2");
  });

  it("DataChannel 未就緒 → 顯示等待 viewer 連線文案", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: false, disabledReason: "waiting_viewer" }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[]}
        onHighlight={() => ({ ok: false, reason: "datachannel_not_ready" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain(GOV_PANEL_REASON_TEXT.waiting_viewer);
  });
});

describe("GovernanceOverlay failed 構件 → 3D 標紅 / 未對映誠實", () => {
  it("列出 failed 構件（含 rule_code / ifc_guid）且提供「在 3D 標示」鈕", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: true, disabledReason: null }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[{ ifc_guid: "GUID_A", severity: "error", rule_code: "DOOR-FIRERATING-REQUIRED" }]}
        onHighlight={() => ({ ok: true, primPath: "/World/IfcWall/_A", requestId: "r" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain("GUID_A");
    expect(html).toContain("DOOR-FIRERATING-REQUIRED");
    expect(html).toContain("在 3D 標示");
  });

  it("coverage 降級（<90%）→ 顯示 coverage% 與「部分構件無法在 3D 標示」（誠實，不捏造）", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: true, disabledReason: null }}
        coverage={{ coverageOk: false, degraded: true, ratio: 0.85 }}
        failedElements={[{ ifc_guid: "GUID_X", severity: "error" }]}
        onHighlight={() => ({ ok: false, reason: "unmapped" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain("85"); // coverage% 顯示（0.85 → 85%）
    expect(html).toContain("無法在 3D 標示"); // 誠實降級文案
  });
});
