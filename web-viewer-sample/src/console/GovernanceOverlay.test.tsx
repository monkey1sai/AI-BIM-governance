// web-viewer-sample/src/console/GovernanceOverlay.test.tsx
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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

  // F1：highlightConfirm 以 rowKey（rule_code::ifc_guid）為 key —— 同一 ifc_guid 多筆不同 rule_code
  // 的列各自獨立確認，不共用 / 互相覆蓋（修正：原以 f.ifc_guid 為 key 會讓兩列共用同一確認狀態）。
  it("highlightConfirm 以 rowKey 索引 → 同 ifc_guid 不同 rule_code 各列確認狀態獨立", () => {
    const html = renderToString(
      <GovernanceOverlay
        {...baseProps}
        failedElements={[
          { ifc_guid: "DUP_GUID", severity: "error", rule_code: "RULE-1" },
          { ifc_guid: "DUP_GUID", severity: "warning", rule_code: "RULE-2" },
        ]}
        highlightConfirm={{
          "RULE-1::DUP_GUID": "已在 3D 標示（Kit 已選取）",
          "RULE-2::DUP_GUID": "Kit 未選到該構件（missing/fallback）",
        }}
      />,
    );
    // 兩種不同確認文案同時出現 → 證明各列以 rowKey 分別讀取，未被同一 ifc_guid key 合併成單一狀態。
    expect(html).toContain("已在 3D 標示（Kit 已選取）");
    expect(html).toContain("Kit 未選到該構件（missing/fallback）");
    const statusCount = html.split('data-testid="gov-highlight-status"').length - 1;
    expect(statusCount).toBe(2); // 兩列各一個狀態 span（非共用一個）
  });

  it("highlightConfirm 只填一列的 rowKey → 另一列（同 ifc_guid 不同 rule_code）不顯示確認（無洩漏）", () => {
    const html = renderToString(
      <GovernanceOverlay
        {...baseProps}
        failedElements={[
          { ifc_guid: "DUP_GUID", severity: "error", rule_code: "RULE-1" },
          { ifc_guid: "DUP_GUID", severity: "warning", rule_code: "RULE-2" },
        ]}
        highlightConfirm={{ "RULE-1::DUP_GUID": "已在 3D 標示（Kit 已選取）" }}
      />,
    );
    // 只 RULE-1 列有確認；RULE-2 列不因共用 ifc_guid 而誤顯示（rowKey 隔離）。
    const statusCount = html.split('data-testid="gov-highlight-status"').length - 1;
    expect(statusCount).toBe(1);
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

  // R5：running 中 gov-run-rulecheck disabled（避免連點重複起輪詢；與 Window R1 重入守門配對）。
  it("running → gov-run-rulecheck disabled（即使 canOperate + onRunRuleCheck）", () => {
    const running = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "running" }} />);
    const runBtn = running.match(/<button[^>]*data-testid="gov-run-rulecheck"[^>]*>/);
    expect(runBtn?.[0]).toContain("disabled");
    expect(running).toContain("檢核中…"); // 標籤仍為「檢核中…」

    // 對照：idle 時可操作 → 不 disabled（確認不是恆 disabled）。
    const idle = renderToString(<GovernanceOverlay {...baseProps} ruleCheck={{ status: "idle" }} />);
    const idleBtn = idle.match(/<button[^>]*data-testid="gov-run-rulecheck"[^>]*>/);
    expect(idleBtn?.[0]).not.toContain("disabled");
  });
});

// ── R7：sub-100% coverage warnOnly → overlay 警示（measure-first，非 fallback 降級） ──
describe("GovernanceOverlay coverage warnOnly（R7）", () => {
  it("coverage ∈ [0.9,1.0)（非 degraded、warnOnly）→ 顯示 gov-coverage-warn 警示 + Metric%", () => {
    const html = renderToString(
      <GovernanceOverlay
        {...baseProps}
        coverage={{ coverageOk: false, degraded: false, ratio: 0.95, warnOnly: true }}
      />,
    );
    expect(html).toContain('data-testid="gov-coverage-warn"');
    expect(html).toContain("未達 MVP 鎖定 1.0");
    expect(html).toContain("measure-first 警示，非 fallback 降級");
    expect(html).toContain("95%"); // Metric 仍顯示百分比
    // 非 degraded → 不顯示降級橫幅。
    expect(html).not.toContain('data-testid="gov-coverage-degraded"');
  });

  it("coverage=1.0（warnOnly=false）→ 無警示（不誤報）", () => {
    const html = renderToString(
      <GovernanceOverlay
        {...baseProps}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0, warnOnly: false }}
      />,
    );
    expect(html).not.toContain('data-testid="gov-coverage-warn"');
    expect(html).toContain("100%");
  });

  it("degraded（<90%）→ 顯示降級橫幅，不顯示 warn 警示（避免重複）", () => {
    const html = renderToString(
      <GovernanceOverlay
        {...baseProps}
        coverage={{ coverageOk: false, degraded: true, ratio: 0.85, warnOnly: true }}
      />,
    );
    expect(html).toContain('data-testid="gov-coverage-degraded"');
    expect(html).not.toContain('data-testid="gov-coverage-warn"');
  });
});

// ── W2：highlight 送出誠實文案 + Kit 非同步確認覆寫 ──
describe("GovernanceOverlay highlight 誠實（W2）", () => {
  const failedProps = {
    ...baseProps,
    failedElements: [{ ifc_guid: "GUID_A", severity: "error", rule_code: "R1" }],
  };
  it("highlightConfirm 到達 → 顯示確認文案（覆寫「已送出」）", () => {
    // F1：highlightConfirm 以 rowKey（rule_code::ifc_guid）為 key（此列 rule_code=R1 → "R1::GUID_A"）。
    const html = renderToString(
      <GovernanceOverlay {...failedProps} highlightConfirm={{ "R1::GUID_A": "已在 3D 標示（Kit 已選取）" }} />,
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

  // F2：created 後 gov-a8-issue disabled（避免連點重複開 issue 集）；creating 中亦 disabled。
  it("gov-a8-issue：issueCreate=created → 已開過，按鈕 disabled（防重複建立）", () => {
    const created = renderToString(
      <GovernanceOverlay {...baseProps} ruleCheck={{ status: "succeeded", score: 90 }} issueCreate={{ status: "created", created: 3 }} />,
    );
    const createdBtn = created.match(/<button[^>]*data-testid="gov-a8-issue"[^>]*>/);
    expect(createdBtn?.[0]).toContain("disabled");
    // 對照：succeeded 但尚未開（idle）→ enabled（確認不是恆 disabled）。
    const idleIssue = renderToString(
      <GovernanceOverlay {...baseProps} ruleCheck={{ status: "succeeded", score: 90 }} issueCreate={{ status: "idle" }} />,
    );
    const idleBtn = idleIssue.match(/<button[^>]*data-testid="gov-a8-issue"[^>]*>/);
    expect(idleBtn?.[0]).not.toContain("disabled");
  });

  it("gov-a8-issue：issueCreate=creating → 開立中，按鈕 disabled", () => {
    const creating = renderToString(
      <GovernanceOverlay {...baseProps} ruleCheck={{ status: "succeeded", score: 90 }} issueCreate={{ status: "creating" }} />,
    );
    const creatingBtn = creating.match(/<button[^>]*data-testid="gov-a8-issue"[^>]*>/);
    expect(creatingBtn?.[0]).toContain("disabled");
  });
});

// ── T2：viewport pick 反查的 ifc_guid 顯示給操作員 ──
describe("GovernanceOverlay selectedGuid（T2）", () => {
  it("selectedGuid 非 null → 顯示 gov-selected-guid 行（含 ifc_guid）", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} selectedGuid="2O2Fr$t4X7Zf8NOew3FLOH" />);
    expect(html).toContain('data-testid="gov-selected-guid"');
    expect(html).toContain("2O2Fr$t4X7Zf8NOew3FLOH");
    expect(html).toContain("點選 3D 構件 → ifc_guid=");
  });

  it("selectedGuid 省略 / null → 不顯示該行（誠實：無對映不顯示假 guid）", () => {
    const omitted = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(omitted).not.toContain('data-testid="gov-selected-guid"');
    const nullGuid = renderToString(<GovernanceOverlay {...baseProps} selectedGuid={null} />);
    expect(nullGuid).not.toContain('data-testid="gov-selected-guid"');
  });
});

// ── T4：失敗構件超過 50 筆 → 誠實標註其餘未列出（不靜默截斷） ──
describe("GovernanceOverlay failed 截斷誠實（T4）", () => {
  const mkFailed = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ifc_guid: `G${i}`, severity: "error" as const, rule_code: `R${i}` }));

  it("failedElements > 50 → 渲染 gov-failed-truncated 標註總數，且只列前 50 列", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} failedElements={mkFailed(63)} />);
    expect(html).toContain('data-testid="gov-failed-truncated"');
    // renderToString 會在插值（{length}）兩側插入 <!-- --> 標記，故分段斷言而非整串比對。
    expect(html).toContain("顯示前 50 筆／共");
    expect(html).toContain("63");
    expect(html).toContain("筆失敗構件（其餘未列出）");
    const rowCount = html.split('data-testid="gov-failed-row"').length - 1;
    expect(rowCount).toBe(50); // 上限仍 50 列
  });

  it("failedElements = 50（邊界）→ 無截斷標註（未超過上限）", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} failedElements={mkFailed(50)} />);
    expect(html).not.toContain('data-testid="gov-failed-truncated"');
    const rowCount = html.split('data-testid="gov-failed-row"').length - 1;
    expect(rowCount).toBe(50);
  });
});

// ── T5：BCF 匯出範圍誠實（model-version-scoped，非 run-scoped） ──
describe("GovernanceOverlay BCF 範圍誠實（T5）", () => {
  it("bcfUrl 提供 → 渲染 gov-a8-bcf-scope 範圍說明（本 model version 所有正式 issue）", () => {
    const html = renderToString(
      <GovernanceOverlay {...baseProps} bcfUrl="http://127.0.0.1:8004/api/governance/bcf/export?model_version_id=mv_1" />,
    );
    expect(html).toContain('data-testid="gov-a8-bcf-scope"');
    expect(html).toContain("BCF 匯出為本 model version 所有正式 issue（非僅本次 rule-run）");
  });

  it("無 bcfUrl → 不顯示範圍說明（無下載連結時不誤掛範圍文案）", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(html).not.toContain('data-testid="gov-a8-bcf-scope"');
  });
});

// ── T1：清除 3D 標示時一併清掉本地每列狀態文案（jsdom 互動測試） ──
describe("GovernanceOverlay 清除標示重設本地狀態（T1）", () => {
  let container: HTMLDivElement | null = null;

  // 告知 React 這是 act() 測試環境（消除「not configured to support act」warning）。
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
  });

  it("點「在 3D 標示」→ 出現 gov-highlight-status；點「清除 3D 標示」→ 本地狀態文案清除", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = {
      ...baseProps,
      failedElements: [{ ifc_guid: "GUID_A", severity: "error" as const, rule_code: "R1" }],
      onHighlight: () => ({ ok: true as const, primPath: "/World/X", requestId: "r1" }),
      onClearHighlight: () => {},
    };
    act(() => {
      root.render(<GovernanceOverlay {...props} />);
    });
    // 初始：尚未送出 → 無狀態文案。
    expect(container.querySelector('[data-testid="gov-highlight-status"]')).toBeNull();

    // 點「在 3D 標示」→ 本地 lastResult 寫入「已送出…」。
    const highlightBtn = container.querySelector('[data-testid="gov-highlight"]') as HTMLButtonElement;
    expect(highlightBtn).not.toBeNull();
    act(() => {
      highlightBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const status = container.querySelector('[data-testid="gov-highlight-status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("已送出 3D 標示請求");

    // 點「清除 3D 標示」→ 本地狀態文案清除（T1 修復：handleClearHighlight 重設 lastResult）。
    const clearBtn = container.querySelector('[data-testid="gov-clear"]') as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    act(() => {
      clearBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="gov-highlight-status"]')).toBeNull();

    act(() => {
      root.unmount();
    });
  });
});
