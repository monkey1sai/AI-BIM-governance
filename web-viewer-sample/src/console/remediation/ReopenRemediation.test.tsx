import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ReopenRemediation } from "./ReopenRemediation";
const issue = { id: "i1", status: "resolved", revision: 1, model_version_id: "v1", ifc_guid: "g1", source_ref: "r1" };
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function submit(onChanged = vi.fn()) {
  await act(async () => root.render(<ReopenRemediation issue={issue} onChanged={onChanged}/>));
  expect(container.querySelector("button")!.disabled).toBe(true);
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => container.querySelector("button")!.click());
  return onChanged;
}
it("requires explicit confirmation and refreshes only a correlated reopened response", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ issue: { ...issue, status: "reopened", revision: 2 } })));
  vi.stubGlobal("fetch", fetcher); const changed = await submit();
  expect(fetcher).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ expected_revision: 1, note: "" });
  expect(fetcher.mock.calls[0][1].headers["X-A1-Intent"]).toBe("reopen");
});
it.each([403, 409, 503, 502])("does not claim success or retry after HTTP %s", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status })); vi.stubGlobal("fetch", fetcher);
  const changed = await submit(); expect(changed).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it("keeps a dropped or wrong-resource response uncertain", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ issue: { ...issue, id: "other", status: "reopened", revision: 2 } })));
  vi.stubGlobal("fetch", fetcher); const changed = await submit();
  expect(changed).not.toHaveBeenCalled(); expect(container.textContent).toContain("結果尚未確認");
});
it("does not offer reopen for an already open Issue", async () => {
  await act(async () => root.render(<ReopenRemediation issue={{ ...issue, status: "reopened" }} onChanged={vi.fn()}/>));
  expect(container.querySelector("button")).toBeNull();
});
