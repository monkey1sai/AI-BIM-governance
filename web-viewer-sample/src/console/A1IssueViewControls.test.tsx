import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A1IssueViewControls } from "./A1IssueViewControls";
import { issueHighlightItems } from "./governance/issueHighlightItems";
import type { RuleResultRow } from "./governanceClient";
import type { ReviewSessionViewerPaneHandle } from "./ReviewSessionViewerPane";

const rows: RuleResultRow[] = [
  { ifc_guid: "A", usd_prim_path: "/A", rule_code: "LOW", severity: "warning", status: "fail", message: "warning A" },
  { ifc_guid: "A", usd_prim_path: "/A", rule_code: "HIGH", severity: "critical", status: "fail", message: "critical A" },
  { ifc_guid: "B", usd_prim_path: "/B", rule_code: "LOW", severity: "warning", status: "fail", message: "warning B" },
  { ifc_guid: "Missing", usd_prim_path: null, rule_code: "LOW", severity: "warning", status: "fail", message: "missing" },
];
const cleanup: (() => void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await act(fn); });
async function mount() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); cleanup.push(() => { root.unmount(); container.remove(); });
  const runIssueView = vi.fn().mockResolvedValue({ protocol: "vg01", type: "highlight_result", requestId: "r", ok: true,
    applied_mode: "material_overlay", applied_count: 2, renderer_mode: "RaytracedLighting" });
  const ref = { current: { runIssueView } as unknown as ReviewSessionViewerPaneHandle };
  const render = async (runId = "run", nextRows = rows) => act(async () => {
    root.render(<A1IssueViewControls rows={nextRows} runId={runId} sessionId="s" paneRef={ref}
      gate={{ canSend: true, reason: "", canSendViewerCommand: true }} />);
  });
  await render();
  const button = (label: string) => [...container.querySelectorAll("button")].find(node => node.textContent === label)!;
  const click = (label: string) => act(async () => { button(label).click(); });
  const filter = (value: string) => act(async () => {
    const select = container.querySelector<HTMLSelectElement>('[aria-label="問題規則"]')!;
    select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return { container, runIssueView, render, button, click, filter };
}

describe("A1 explicit model issue controls", () => {
  it("keeps failed IDS required rows in the error filter and above warnings without changing their severity", async () => {
    const required = { ...rows[0], rule_code: "IDS", severity: "required" };
    for (const input of [[rows[0], required], [required, rows[0]]]) {
      expect(issueHighlightItems(input)).toEqual([
        expect.objectContaining({ ifc_guid: "A", severity: "required", rule_code: "IDS" }),
      ]);
    }
    const f = await mount();
    await f.render("ids-run", [rows[0], required]);
    await act(async () => {
      const select = f.container.querySelector<HTMLSelectElement>('[aria-label="問題嚴重度"]')!;
      select.value = "error"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(f.container.textContent).toContain("1 筆問題・1 個構件・0 個無法定位");
    expect(f.container.textContent).toContain("IDS · required");
    expect(f.runIssueView).not.toHaveBeenCalled();
    await f.click("在模型中顯示問題");
    expect(f.runIssueView).toHaveBeenLastCalledWith("highlight", [
      expect.objectContaining({ ifc_guid: "A", severity: "required" }),
    ], undefined);
    expect(required.severity).toBe("required");
    expect(required.status).toBe("fail");
  });
  it("deduplicates components by highest severity without losing issue rows", () => {
    expect(issueHighlightItems(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ifc_guid: "A", severity: "critical" }),
      expect.objectContaining({ ifc_guid: "B", severity: "warning" }),
    ]));
    expect(issueHighlightItems(rows)).toHaveLength(2);
    expect(issueHighlightItems([...rows].reverse())).toEqual(issueHighlightItems(rows));
  });
  it("validation, opening details and disabled-mode filtering never send 3D commands", async () => {
    const f = await mount();
    expect(f.container.textContent).toContain("4 筆問題・3 個構件・1 個無法定位");
    expect(f.container.textContent).toContain("此構件目前無法在模型中定位");
    await act(async () => { f.container.querySelector("details")!.open = true; });
    await f.filter("LOW"); await f.render("new-run");
    expect(f.runIssueView).not.toHaveBeenCalled();
  });
  it("explicit display, enabled filtering, focus, selection-clear and material-clear stay separate", async () => {
    const f = await mount();
    await f.click("在模型中顯示問題");
    expect(f.runIssueView).toHaveBeenLastCalledWith("highlight", expect.arrayContaining([
      expect.objectContaining({ ifc_guid: "A", severity: "critical" }),
    ]), undefined);
    await f.filter("LOW");
    expect(f.runIssueView).toHaveBeenLastCalledWith("highlight", expect.arrayContaining([
      expect.objectContaining({ ifc_guid: "A", severity: "warning" }),
    ]), undefined);
    await f.click("定位此構件");
    expect(f.runIssueView).toHaveBeenLastCalledWith("focus", expect.any(Array), "A");
    await f.click("清除選取");
    expect(f.runIssueView).toHaveBeenLastCalledWith("clear_selection", expect.any(Array), undefined);
    await f.click("關閉問題高亮");
    expect(f.runIssueView).toHaveBeenLastCalledWith("clear", expect.any(Array), undefined);
    const count = f.runIssueView.mock.calls.length;
    await f.filter("all");
    expect(f.runIssueView).toHaveBeenCalledTimes(count);
  });
  it("shows pending and failure without claiming applied and permits explicit recovery", async () => {
    const f = await mount();
    let resolve!: (result: unknown) => void;
    f.runIssueView.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await f.click("在模型中顯示問題");
    expect(f.button("在模型中顯示問題").disabled).toBe(true);
    expect(f.container.textContent).not.toContain("問題高亮已套用");
    await act(async () => { resolve({ ok: false, reason: "timed_out" }); });
    expect(f.container.textContent).toContain("尚未確認模型效果");
    expect(f.button("關閉問題高亮").disabled).toBe(false);
  });
  it("reports partially mapped issues and never clears the model for all-unmapped results", async () => {
    const f = await mount();
    await f.click("在模型中顯示問題");
    expect(f.container.textContent).toContain("另有 1 個構件無法定位");
    await f.render("unmapped-run", [rows[3]]);
    f.runIssueView.mockClear();
    await f.click("在模型中顯示問題");
    expect(f.runIssueView).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain("都無法在模型中定位；既有模型外觀保持不變");
    expect(f.container.textContent).not.toContain("問題高亮已套用");
    await f.render("mixed-run", [rows[0], { ...rows[3], rule_code: "UNMAPPED" }]);
    await f.click("在模型中顯示問題");
    f.runIssueView.mockClear();
    await f.filter("UNMAPPED");
    expect(f.runIssueView).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain("都無法在模型中定位；既有模型外觀保持不變");
    expect(f.button("關閉問題高亮").disabled).toBe(false);
  });
});
