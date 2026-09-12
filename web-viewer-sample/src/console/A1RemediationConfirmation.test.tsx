import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { initialA1State, type A1State } from "./a1Machine";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";
import { remediationCandidatesClient } from "./remediation/remediationCandidatesClient";
import { A1GovernanceWorkbenchPage } from "./A1GovernanceWorkbenchPage";
const context = vi.hoisted(() => ({ state: null as A1State | null, runId: "rr1" }));
vi.mock("./hooks/useRuleRun", () => ({ useRuleRun: () => ({ state: context.state, runId: context.runId, dispatch: vi.fn(), run: vi.fn() }) }));
vi.mock("./EmbeddedViewer", async () => ({ EmbeddedViewer: (await import("react")).forwardRef(() => null) }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  context.state = { ...initialA1State, step: "scored", modelVersionId: "v1" }; context.runId = "rr1";
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); window.location.hash = "#a1";
  vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("test runtime absent"));
  vi.spyOn(coordinatorClient, "getTestDataProjects").mockResolvedValue({ projects: [] });
  vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ bucket: "test", count: 0, objects: [] });
  vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
  vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "test", source_kind: "local_fs", projects: [] });
  vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 1, issue_ids: ["i1"] });
  vi.spyOn(governanceClient, "getIssue").mockResolvedValue({ id: "i1", kind: "issue", title: "牆面命名", status: "in_progress",
    severity: "high", ifc_guid: "g1", usd_prim_path: null, source_type: "rule_result", model_version_id: "v1" });
  vi.spyOn(remediationCandidatesClient, "loadOriginal").mockRejectedValue({ code: "evidence_unavailable" });
  vi.spyOn(coordinatorClient, "claimViewerLease").mockRejectedValue(new Error("unexpected claim"));
  vi.spyOn(coordinatorClient, "releaseViewerLease").mockRejectedValue(new Error("unexpected release"));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function setup() {
  await act(async () => root.render(<A1GovernanceWorkbenchPage/>));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="a1-step-issues"]')!.click());
}
async function open() {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "核對整改");
  expect(button, "formal Issue exposes confirmation").toBeTruthy(); await act(async () => button!.click());
}
it("opens confirmation with original run context and does not touch Viewer", async () => {
  await setup(); await open();
  expect(remediationCandidatesClient.loadOriginal).toHaveBeenCalledWith("i1", undefined, expect.any(AbortSignal));
  expect(container.querySelector('[aria-label="整改確認"]')?.textContent).toContain("無可用證據");
  expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled(); expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalled();
});
it.each(["run", "model"])("removes confirmation when %s changes", async kind => {
  await setup(); await open();
  if (kind === "run") context.runId = "rr2"; else context.state = { ...context.state!, modelVersionId: "v2" };
  await act(async () => root.render(<A1GovernanceWorkbenchPage/>));
  expect(container.querySelector('[aria-label="整改確認"]')).toBeNull();
});
it("keeps manual Issue out of the formal remediation form", async () => {
  vi.mocked(governanceClient.getIssue).mockResolvedValue({ id: "i1", kind: "issue", title: "手動問題", status: "open",
    severity: "low", ifc_guid: "g1", usd_prim_path: null, source_type: "manual" });
  await setup(); expect(Array.from(container.querySelectorAll("button")).some(b => b.textContent === "核對整改")).toBe(false);
});

it("reloads existing rule Issues after a fresh page without changing the viewed source", async () => {
  context.runId = ""; context.state = { ...initialA1State };
  vi.spyOn(governanceClient, "listIssues").mockResolvedValue([await governanceClient.getIssue("i1")]);
  await act(async () => root.render(<A1GovernanceWorkbenchPage/>));
  const load = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "載入既有規則問題")!;
  await act(async () => load.click()); await open();
  expect(governanceClient.listIssues).toHaveBeenCalledWith(undefined, { kind: "issue" });
  expect(remediationCandidatesClient.loadOriginal).toHaveBeenCalledWith("i1", undefined, expect.any(AbortSignal));
  expect(context.state).toEqual(initialA1State);
  expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
});
