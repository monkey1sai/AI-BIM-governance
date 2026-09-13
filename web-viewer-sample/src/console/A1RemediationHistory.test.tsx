import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { initialA1State, type A1State } from "./a1Machine";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";
import { remediationHistoryClient } from "./remediation/remediationHistoryClient";
import { A1GovernanceWorkbenchPage } from "./A1GovernanceWorkbenchPage";
const context = vi.hoisted(() => ({ state: null as A1State | null, runId: "rr1" }));
vi.mock("./hooks/useRuleRun", () => ({ useRuleRun: () => ({ state: context.state, runId: context.runId, dispatch: vi.fn(), run: vi.fn() }) }));
vi.mock("./EmbeddedViewer", async () => ({ EmbeddedViewer: (await import("react")).forwardRef(() => null) }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  context.state = { ...initialA1State, step: "scored", modelVersionId: "v1" }; context.runId = "rr1";
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  window.location.hash = "#a1";
  vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("test runtime absent"));
  vi.spyOn(coordinatorClient, "getTestDataProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ bucket: "test", count: 0, objects: [] });
  vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
  vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "test", source_kind: "local_fs", projects: [] });
  vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 1, issue_ids: ["i1"] });
  vi.spyOn(governanceClient, "getIssue").mockResolvedValue({ id: "i1", kind: "issue", title: "牆面命名", status: "reopened", severity: "high",
    ifc_guid: "g1", usd_prim_path: null, source_type: "rule_result", model_version_id: "v1" });
  vi.spyOn(remediationHistoryClient, "read").mockResolvedValue({ issue: { id: "i1", status: "reopened", revision: 2,
    ifc_guid: "g1", source_ref: "a1", model_version_id: "v1" }, items: [], total: 0, limit: 20, offset: 0, next_offset: null });
  vi.spyOn(coordinatorClient, "claimViewerLease").mockRejectedValue(new Error("unexpected claim"));
  vi.spyOn(coordinatorClient, "releaseViewerLease").mockRejectedValue(new Error("unexpected release"));
  vi.spyOn(coordinatorClient, "viewerLeaseHeartbeat").mockRejectedValue(new Error("unexpected heartbeat"));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function setup() {
  await act(async () => root.render(<A1GovernanceWorkbenchPage/>));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="a1-step-issues"]')!.click());
}
async function openHistory() {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "查看整改紀錄");
  expect(button, "formal Issue exposes the read history action").toBeTruthy();
  await act(async () => button!.click());
}
it("opens the real history panel from a formal Issue without Viewer lease operations", async () => {
  await setup(); await openHistory();
  expect(container.querySelector('[aria-label="整改紀錄"]')?.textContent).toContain("已重新開啟");
  expect(remediationHistoryClient.read).toHaveBeenCalledWith("i1", 0, expect.any(AbortSignal));
  expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalled();
  expect(coordinatorClient.viewerLeaseHeartbeat).not.toHaveBeenCalled();
});
it("removes selected history when the run changes", async () => {
  await setup(); await openHistory(); context.runId = "rr2";
  await act(async () => root.render(<A1GovernanceWorkbenchPage/>));
  expect(container.querySelector('[aria-label="整改紀錄"]')).toBeNull();
});
it("removes selected history when the model version changes", async () => {
  await setup(); await openHistory(); context.state = { ...context.state!, modelVersionId: "v2" };
  await act(async () => root.render(<A1GovernanceWorkbenchPage/>));
  expect(container.querySelector('[aria-label="整改紀錄"]')).toBeNull();
});
it("does not offer formal remediation history for a manual Issue", async () => {
  vi.mocked(governanceClient.getIssue).mockResolvedValue({ id: "i1", kind: "issue", title: "手動問題", status: "open",
    severity: "low", ifc_guid: "g1", usd_prim_path: null, source_type: "manual" });
  await setup();
  expect(Array.from(container.querySelectorAll("button")).some(b => b.textContent === "查看整改紀錄")).toBe(false);
});
