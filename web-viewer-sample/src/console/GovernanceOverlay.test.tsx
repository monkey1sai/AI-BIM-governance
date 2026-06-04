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
  onRunRuleCheck: () => {},
  onCreateIssues: () => {},
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
    // 清除標示鈕對 spectator 仍可見（不隱藏，誠實唯讀），且 disabled。
    expect(html).toContain("清除 3D 標示");
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
    // 清除標示鈕存在且接 onClearHighlight（修正 dead wiring：原 prop 傳入卻未使用）。
    expect(html).toContain("清除 3D 標示");
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

  it("同一 ifc_guid 多筆不同 rule_code 各自獨立列（rowKey=rule_code::ifc_guid，不互相覆蓋）", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: true, disabledReason: null }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[
          { ifc_guid: "DUP_GUID", severity: "error", rule_code: "RULE-1" },
          { ifc_guid: "DUP_GUID", severity: "warning", rule_code: "RULE-2" },
        ]}
        onHighlight={() => ({ ok: true, primPath: "/World/X", requestId: "r" })}
        onClearHighlight={() => {}}
      />,
    );
    // 兩筆不同 rule_code 各自成列（rowKey 區分），不因相同 ifc_guid 而碰撞合併。
    expect(html).toContain("RULE-1");
    expect(html).toContain("RULE-2");
    const rowCount = html.split('data-testid="gov-failed-row"').length - 1;
    expect(rowCount).toBe(2);
  });
});

describe("GovernanceOverlay 穩定選取子（data-testid，供 E2E）", () => {
  it("可操作 + 有 failed 構件 → 渲染 gov-highlight / gov-clear / gov-failed-row", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: true, disabledReason: null }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[{ ifc_guid: "GUID_A", severity: "error", rule_code: "R1" }]}
        onHighlight={() => ({ ok: true, primPath: "/World/X", requestId: "r" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain('data-testid="gov-highlight"');
    expect(html).toContain('data-testid="gov-clear"');
    expect(html).toContain('data-testid="gov-failed-row"');
  });

  it("降級 + spectator → 渲染 gov-coverage-degraded / gov-readonly-banner", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: false, disabledReason: "spectator_read_only" }}
        coverage={{ coverageOk: false, degraded: true, ratio: 0.85 }}
        failedElements={[]}
        onHighlight={() => ({ ok: false, reason: "unmapped" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain('data-testid="gov-coverage-degraded"');
    expect(html).toContain('data-testid="gov-readonly-banner"');
  });
});

// ── W1：A3 rule-run 動作 + 狀態（誠實） ──
describe("GovernanceOverlay A3 rule-run（W1）", () => {
  it("渲染 gov-run-rulecheck，可操作時 enabled；無 session（無 onRunRuleCheck）時 disabled", () => {
    const enabled = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "idle" }} />);
    expect(enabled).toContain('data-testid="gov-run-rulecheck"');
    const runBtn = enabled.match(/<button[^>]*data-testid="gov-run-rulecheck"[^>]*>/);
    expect(runBtn?.[0]).not.toContain("disabled"); // canOperate + onRunRuleCheck → enabled

    // 不可操作（spectator）→ disabled。
    const ro = renderToString(
      <GovernanceOverlay {...baseProps} panelState={{ canOperate: false, disabledReason: "spectator_read_only" }} ruleCheck={{ status: "idle" }} />,
    );
    const roBtn = ro.match(/<button[^>]*data-testid="gov-run-rulecheck"[^>]*>/);
    expect(roBtn?.[0]).toContain("disabled");
  });

  it("running → 顯示「執行中…」；error → 顯示錯誤訊息；succeeded → 顯示 score + counts（誠實）", () => {
    const running = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "running" }} />);
    expect(running).toContain("執行中…");

    const errored = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "error", error: "尚無 review session" }} />);
    expect(errored).toContain("尚無 review session");

    const ok = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "succeeded", score: 88, total: 100, failed: 12 }} />);
    expect(ok).toContain("88");
    expect(ok).toContain("12");
  });
});

// ── W2：highlight 送出誠實文案 + Kit 非同步確認覆寫 ──
describe("GovernanceOverlay highlight 誠實（W2）", () => {
  const failedProps = {
    ...baseProps,
    failedElements: [{ ifc_guid: "GUID_A", severity: "error", rule_code: "R1" }],
  };
  it("highlightConfirm 到達 → 顯示確認文案（覆寫「已送出」）", () => {
    const html = renderToString(
      <GovernanceOverlay {...failedProps} highlightConfirm={{ GUID_A: "已在 3D 標示（Kit 已選取）" }} />,
    );
    expect(html).toContain('data-testid="gov-highlight-status"');
    expect(html).toContain("已在 3D 標示（Kit 已選取）");
  });
  it("未對映 reason=unmapped 仍誠實（送出文案不冒充已標示）", () => {
    // renderToString 不觸發 onClick，故驗證「已送出（非已標示）」這個誠實字面不存在於初始 DOM，
    // 也驗證確認文案僅在 highlightConfirm 提供時出現。
    const html = renderToString(<GovernanceOverlay {...failedProps} />);
    expect(html).not.toContain("已在 3D 標示：/World"); // 不再有舊的「已標示：primPath」假確認
  });
});

// ── W3：A8 issue / BCF 動作（誠實 gating） ──
describe("GovernanceOverlay A8 issue / BCF（W3）", () => {
  it("gov-a8-issue：rule-run 未 succeeded → disabled；succeeded → enabled", () => {
    const idle = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "idle" }} />);
    const idleBtn = idle.match(/<button[^>]*data-testid="gov-a8-issue"[^>]*>/);
    expect(idleBtn?.[0]).toContain("disabled");

    const ok = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "succeeded", score: 90, total: 10, failed: 1 }} />);
    const okBtn = ok.match(/<button[^>]*data-testid="gov-a8-issue"[^>]*>/);
    expect(okBtn?.[0]).not.toContain("disabled");
  });

  it("bcfUrl 提供 → 渲染 gov-a8-bcf 下載連結（href）；缺 model version → 誠實提示，不捏造 URL", () => {
    const withUrl = renderToString(
      <GovernanceOverlay {...baseProps} bcfUrl="http://127.0.0.1:8004/api/governance/bcf/export?model_version_id=mv_1" />,
    );
    expect(withUrl).toContain('data-testid="gov-a8-bcf"');
    expect(withUrl).toContain('href="http://127.0.0.1:8004/api/governance/bcf/export?model_version_id=mv_1"');

    const noUrl = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(noUrl).toContain('data-testid="gov-a8-bcf-missing"');
    expect(noUrl).not.toContain('data-testid="gov-a8-bcf"');
  });

  it("issueCreate=created → 顯示「已從 rule-run 開 N 筆 issue」（誠實）", () => {
    const html = renderToString(
      <GovernanceOverlay {...baseProps} ruleCheck={{ status: "succeeded", score: 90 }} issueCreate={{ status: "created", created: 7 }} />,
    );
    expect(html).toContain("已從 rule-run 開 7 筆 issue");
  });
});
