import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { remediationCandidatesClient } from "./remediationCandidatesClient";
import { remediationClient, RemediationClientError } from "./remediationClient";
import { remediationHistoryClient } from "./remediationHistoryClient";
const modules = import.meta.glob("./RemediationConfirmationPanel.tsx");
let container: HTMLDivElement, root: Root, serial = 0, issueId: string;
const original = { run_id: "r1", model_version_id: "v1", ifc_guid: "g1", rule_code: "NAME", rule_content_digest: "digest",
  anchor_id: "a1", members: [{ id: "a1", ifc_guid: "g1", rule_code: "NAME", status: "fail" as const }] };
const revised = { ...original, run_id: "r2", model_version_id: "v2", anchor_id: "a2",
  members: [{ id: "a2", ifc_guid: "g1", rule_code: "NAME", status: "pass" as const }] };
function receipt(status = "resolved") { return { issue: { id: issueId, status, revision: 4 },
  confirmation: { schema_version: "a1-remediation/v1" as const, id: "c1", issue_id: issueId,
    revised: { run_id: "r2", model_version_id: "v2", anchor_id: "a2" } }, replayed: false }; }
beforeEach(() => {
  issueId = "form-" + (++serial); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  vi.spyOn(remediationCandidatesClient, "loadOriginal").mockImplementation(async id => ({ issue: {
    id, status: "in_progress", revision: 3, model_version_id: "v1", ifc_guid: "g1", source_ref: "a1" }, projectId: "p1", original }));
  vi.spyOn(remediationCandidatesClient, "list").mockResolvedValue({ items: [{ id: "r2", version: "v2", finishedAt: null }], offset: 0, nextOffset: null });
  vi.spyOn(remediationCandidatesClient, "select").mockResolvedValue(revised);
  vi.spyOn(remediationClient, "confirm").mockResolvedValue(receipt());
  vi.spyOn(remediationHistoryClient, "read").mockResolvedValue({ issue: { id: issueId, status: "reopened", revision: 5,
    model_version_id: "v1", ifc_guid: "g1", source_ref: "a1" }, items: [], total: 0, limit: 20, offset: 0, next_offset: null });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(id = issueId) {
  expect(modules["./RemediationConfirmationPanel.tsx"], "confirmation form is implemented").toBeTypeOf("function");
  const { RemediationConfirmationPanel } = await modules["./RemediationConfirmationPanel.tsx"]() as typeof import("./RemediationConfirmationPanel");
  await act(async () => root.render(<RemediationConfirmationPanel issueId={id} originalRunId="r1"/>));
}
function button(text: string) { const b = Array.from(container.querySelectorAll("button")).find(b => b.textContent === text); expect(b).toBeTruthy(); return b!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function choose(label: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="' + label + '"]')!;
  expect(select).toBeTruthy(); await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function ready() { await render(); await choose("修正版檢核", "r2"); await choose("依據結果", "a2"); }
async function check() { await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
it("requires real selections and the operator checkbox before POST", async () => {
  await ready(); expect(button("確認整改").disabled).toBe(true); await click("確認整改");
  expect(remediationClient.confirm).not.toHaveBeenCalled(); await check(); await click("確認整改");
  expect(remediationClient.confirm).toHaveBeenCalledWith(issueId, expect.objectContaining({
    expected_revision: 3, revised_model_version_id: "v2", revised_run_id: "r2", revised_result_id: "a2", note: "",
  }));
  const sent = vi.mocked(remediationClient.confirm).mock.calls[0][1];
  expect(Object.keys(sent).sort()).toEqual(["expected_revision","idempotency_key","note","revised_model_version_id","revised_result_id","revised_run_id"]);
});
it("refreshes history after confirmation and never calls reopened resolved", async () => {
  vi.mocked(remediationClient.confirm).mockResolvedValue(receipt("reopened"));
  await ready(); await check(); await click("確認整改");
  const responseState = Array.from(container.querySelectorAll('[role="status"]')).find(e => e.textContent?.startsWith("確認回應狀態"));
  expect(responseState?.textContent).toBe("確認回應狀態：已重新開啟");
  expect(container.querySelector("[data-current-status]")?.textContent).toBe("已重新開啟");
  expect(remediationHistoryClient.read).toHaveBeenCalledWith(issueId, 0, expect.any(AbortSignal));
});
it("clears verification when the selected run changes", async () => {
  await ready(); await check(); await choose("修正版檢核", "");
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(button("確認整改").disabled).toBe(true);
});
it("prevents double click and retains the exact command on uncertain retry", async () => {
  let reject!: (e: Error) => void;
  vi.mocked(remediationClient.confirm).mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
  await ready(); await check(); await act(async () => { button("確認整改").click(); button("確認整改").click(); });
  expect(remediationClient.confirm).toHaveBeenCalledTimes(1);
  const first = structuredClone(vi.mocked(remediationClient.confirm).mock.calls[0][1]);
  await act(async () => reject(new RemediationClientError("request_failed", 503)));
  expect(container.textContent).toContain("結果尚未確認");
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="修正版檢核"]')!.matches(":disabled")).toBe(true);
  await click("重試原確認"); expect(vi.mocked(remediationClient.confirm).mock.calls[1][1]).toEqual(first);
});
it.each([
  ["remediation_authorization_denied",403,"沒有權限"],
  ["remediation_conflict",409,"資料已更新"],
  ["remediation_evidence_invalid",422,"證據不符合"],
  ["remediation_authorization_unavailable",503,"服務暫時"],
] as const)("explains explicit denial %s without unknown-result retry", async (code, status, text) => {
  vi.mocked(remediationClient.confirm).mockRejectedValue(new RemediationClientError(code, status));
  await ready(); await check(); await click("確認整改");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(text);
  expect(container.textContent).not.toContain("重試原確認"); expect(button("重新載入並核對").disabled).toBe(false);
});
it("preserves uncertain command through in-page unmount and Issue switches", async () => {
  vi.mocked(remediationClient.confirm).mockRejectedValueOnce(new RemediationClientError("invalid_response", 200));
  await ready(); await check(); await click("確認整改");
  const command = structuredClone(vi.mocked(remediationClient.confirm).mock.calls[0][1]);
  await render("another-" + issueId); expect(container.textContent).not.toContain("重試原確認");
  await render(); await click("重試原確認");
  expect(vi.mocked(remediationClient.confirm).mock.calls[1]).toEqual([issueId, command]);
});
it("does not let a late original read populate another Issue", async () => {
  let resolve!: (v: Awaited<ReturnType<typeof remediationCandidatesClient.loadOriginal>>) => void;
  vi.mocked(remediationCandidatesClient.loadOriginal).mockReturnValueOnce(new Promise(r => { resolve = r; }) as ReturnType<typeof remediationCandidatesClient.loadOriginal>);
  await render(); await render("next-" + issueId);
  await act(async () => resolve({ issue: { id: issueId, status: "in_progress", revision: 3,
    model_version_id: "v1", ifc_guid: "g1", source_ref: "a1" }, projectId: "wrong", original: { ...original, rule_code: "WRONG" } }));
  expect(container.textContent).not.toContain("WRONG");
});
it("shows loading and empty-page pagination honestly", async () => {
  vi.mocked(remediationCandidatesClient.list).mockResolvedValue({ items: [], offset: 0, nextOffset: 20 });
  await render(); expect(container.textContent).toContain("本頁沒有");
  await click("下一頁"); expect(vi.mocked(remediationCandidatesClient.list).mock.calls[1][1]).toBe(20);
});
it.each(["future_status", "__proto__", "constructor"])("does not treat unknown receipt status %s as a known success", async status => {
  vi.mocked(remediationClient.confirm).mockResolvedValue(receipt(status));
  await ready(); await check(); await click("確認整改");
  const responseState = Array.from(container.querySelectorAll('[role="status"]')).find(e => e.textContent?.startsWith("確認回應狀態"));
  expect(responseState?.textContent).toContain("狀態尚未確認");
});
it("renders evidence markup as text", async () => {
  vi.mocked(remediationCandidatesClient.select).mockResolvedValue({ ...revised, rule_code: "<img src=x onerror=alert(1)>" });
  await ready(); expect(container.textContent).toContain("<img src=x onerror=alert(1)>"); expect(container.querySelector("img")).toBeNull();
});
it("rejects a note longer than 4000", async () => {
  await ready(); await check();
  const textarea = container.querySelector("textarea")!;
  expect(textarea.maxLength).toBe(4000);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "x".repeat(4001));
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button("確認整改").disabled).toBe(true);
});
