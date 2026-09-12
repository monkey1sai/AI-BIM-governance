import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("./remediationHistoryClient", () => ({ remediationHistoryClient: { read }, HistoryClientError: class extends Error {} }));
const modules = import.meta.glob("./RemediationHistoryPanel.tsx");
let container: HTMLDivElement, root: Root;
const empty = { issue: { id: "i1", status: "reopened", revision: 2, model_version_id: "v1", ifc_guid: "g1", source_ref: "a1" },
  items: [], total: 0, limit: 20, offset: 0, next_offset: null };
beforeEach(() => { (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; read.mockReset(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(id = "i1") {
  expect(modules["./RemediationHistoryPanel.tsx"], "history panel is implemented").toBeTypeOf("function");
  const { RemediationHistoryPanel } = await modules["./RemediationHistoryPanel.tsx"]() as typeof import("./RemediationHistoryPanel");
  await act(async () => root.render(<RemediationHistoryPanel issueId={id}/>));
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes(text));
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
it("shows loading without previous evidence", async () => {
  read.mockReturnValue(new Promise(() => {})); await render();
  expect(container.textContent).toContain("載入整改紀錄");
});
it("shows empty history separately from reopened current state", async () => {
  read.mockResolvedValue(empty); await render();
  expect(container.textContent).toContain("尚無整改確認紀錄");
  expect(container.querySelector("[data-current-status]")?.textContent).toBe("已重新開啟");
});
it("renders original and revised evidence as text without treating history as current resolution", async () => {
  const original = { run_id: "r1", model_version_id: "v1", ifc_guid: "g1", rule_code: "NAME", rule_content_digest: "digest",
    anchor_id: "a1", members: [{ id: "a1", ifc_guid: "g1", rule_code: "NAME", status: "fail" }] };
  read.mockResolvedValue({ ...empty, total: 1, items: [{ schema_version: "a1-remediation/v1", id: "c1", issue_id: "i1",
    principal_ref: "test-supervisor", created_at: "2026-09-09T00:00:00Z", revision_before: 0, revision_after: 1,
    note: "<img src=x onerror=alert(1)>", original,
    revised: { ...original, model_version_id: "v2", run_id: "r2", members: [{ ...original.members[0], status: "pass" }] } }] });
  await render();
  expect(container.querySelector('[aria-label="原版"]')?.textContent).toContain("未通過 1");
  expect(container.querySelector('[aria-label="修正版"]')?.textContent).toContain("通過 1");
  expect(container.querySelector("[data-current-status]")?.textContent).toBe("已重新開啟");
  expect(container.textContent).toContain("test-supervisor");
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(container.querySelector("img")).toBeNull();
});
it.each([[403,"沒有權限"],[404,"找不到"],[503,"服務暫時無法使用"],[0,"讀取失敗"]])("explains error %s and supports retry", async (status, label) => {
  read.mockRejectedValueOnce({ status }).mockResolvedValueOnce(empty); await render();
  expect(container.querySelector("[role=alert]")?.textContent).toContain(label);
  await click("重新整理"); expect(container.textContent).toContain("尚無整改確認紀錄");
});
it("discards a late success after Issue changes", async () => {
  let resolve!: (value: unknown) => void;
  read.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce({ ...empty, issue: { ...empty.issue, id: "i2", status: "open" } });
  await render(); await render("i2");
  await act(async () => resolve(empty));
  expect(container.querySelector("[data-current-status]")?.textContent).toBe("待處理");
});
it("discards a late error and aborts old Issue read", async () => {
  let reject!: (value: unknown) => void;
  read.mockReturnValueOnce(new Promise((_, r) => { reject = r; })).mockResolvedValueOnce(empty);
  await render(); const signal = read.mock.calls[0][2] as AbortSignal; await render("i2");
  await act(async () => reject({ status: 403 }));
  expect(signal.aborted).toBe(true); expect(container.querySelector("[role=alert]")).toBeNull();
});
it("pages explicitly and refreshes from the first page", async () => {
  const group = { run_id: "r1", model_version_id: "v1", ifc_guid: "g1", rule_code: "NAME", rule_content_digest: "digest",
    anchor_id: "a1", members: [{ id: "a1", ifc_guid: "g1", rule_code: "NAME", status: "fail" }] };
  const records = Array.from({ length: 21 }, (_, index) => ({ schema_version: "a1-remediation/v1", id: `c${index}`, issue_id: "i1",
    principal_ref: "test-supervisor", created_at: "2026-09-09T00:00:00Z", revision_before: index * 2, revision_after: index * 2 + 1,
    note: `紀錄 ${index}`, original: group, revised: { ...group, model_version_id: "v2", run_id: "r2", members: [{ ...group.members[0], status: "pass" }] } }));
  const first = { ...empty, issue: { ...empty.issue, revision: 42 }, items: records.slice(0, 20), total: 21, next_offset: 20 };
  const second = { ...first, items: records.slice(20), offset: 20, next_offset: null };
  read.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(first).mockResolvedValueOnce(first);
  await render(); await click("下一頁");
  expect(read.mock.calls[1][1]).toBe(20);
  expect(container.textContent).toContain("紀錄 20");
  await click("上一頁"); expect(read.mock.calls[2][1]).toBe(0);
  expect(container.textContent).toContain("紀錄 0");
  await click("重新整理"); expect(read.mock.calls[3][1]).toBe(0);
  expect(container.textContent).toContain("分頁期間資料可能更新");
});
