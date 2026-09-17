import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coordinatorClient,
  type MinioObject,
  type SourceBundleLookupResponse,
} from "../coordinatorClient";
import { GovernedBundleLookup } from "./GovernedBundleLookup";

const object: MinioObject = { key: "project/main/v1/model.ifc", etag: "a".repeat(32), role: "source_ifc",
  project_id: "project", project_display_name: "Project", category: "main", version: "v1", idempotency_key: "mw_0123456789abcdef" };
const found: SourceBundleLookupResponse = {
  items: [
    { source_bundle_id: "bundle-0002", bundle_state: "READY", pipeline_job_id: "pj_0002" },
    { source_bundle_id: "bundle-0001", bundle_state: "READY", pipeline_job_id: null },
  ],
  unindexed_bundle_count: 0,
};

describe("GovernedBundleLookup", () => {
  let node: HTMLDivElement; let root: Root;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    node = document.createElement("div"); document.body.appendChild(node); root = createRoot(node);
  });
  afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); });
  const render = async (bucket: string | null = "bim-control") => {
    await act(async () => root.render(<GovernedBundleLookup object={object} bucket={bucket} />));
  };
  const byTestId = (id: string) => node.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it("以 bucket、object key 與 etag 反查，列出引用此 IFC 的 bundle", async () => {
    const lookup = vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue(found);
    await render();
    expect(lookup).toHaveBeenCalledWith("bim-control", object.key, object.etag);
    const bundles = node.querySelectorAll('[data-testid="lineage-summary-bundle"]');
    expect(bundles).toHaveLength(2);
    expect(bundles[0].textContent).toContain("bundle-0002");
    expect(bundles[0].textContent).toContain("pj_0002");
    expect(bundles[1].textContent).toContain("尚未建立");
    expect(byTestId("lineage-summary-ratios")?.textContent).toContain("授權");
  });

  it("查無 bundle 且沒有未建索引的紀錄時，說明此 IFC 沒有 governed bundle", async () => {
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 0 });
    await render();
    expect(byTestId("lineage-summary-none")).not.toBeNull();
    expect(byTestId("lineage-summary-indeterminate")).toBeNull();
    expect(byTestId("lineage-summary-ratios")).toBeNull();
  });

  it("有未建立索引的舊 bundle 時，不把查無說成確定沒有", async () => {
    vi.spyOn(coordinatorClient, "lookupLineageSourceBundles").mockResolvedValue({ items: [], unindexed_bundle_count: 2 });
    await render();
    expect(byTestId("lineage-summary-none")).toBeNull();
    expect(byTestId("lineage-summary-indeterminate")?.textContent).toContain("2");
  });

  it("查詢失敗時顯示錯誤，重試後顯示結果", async () => {
    const lookup = vi.spyOn(coordinatorClient, "lookupLineageSourceBundles")
      .mockRejectedValueOnce(new Error("coordinator /api/lineage/source-bundles -> 502 upstream_failed"))
      .mockResolvedValue(found);
    await render();
    expect(byTestId("lineage-summary-error")).not.toBeNull();
    await act(async () => byTestId("lineage-summary-retry")?.click());
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(byTestId("lineage-summary-error")).toBeNull();
    expect(node.querySelectorAll('[data-testid="lineage-summary-bundle"]')).toHaveLength(2);
  });

  it("不知道 bucket 時不做反查", async () => {
    const lookup = vi.spyOn(coordinatorClient, "lookupLineageSourceBundles");
    await render(null);
    expect(lookup).not.toHaveBeenCalled();
    expect(byTestId("lineage-summary-bucket-unknown")).not.toBeNull();
  });
});
