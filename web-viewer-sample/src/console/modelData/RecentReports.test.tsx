import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "../coordinatorClient";
import { LINEAGE_REPORT, LINEAGE_REPORT_NOT_PRODUCED } from "../__testdata__/lineageReports";
import { RecentReports } from "./RecentReports";

describe("RecentReports（未選模型時的捷徑）", () => {
  let node: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
    vi.restoreAllMocks();
  });

  const render = async (onOpen = vi.fn()) => {
    await act(async () => root.render(<RecentReports onOpen={onOpen} />));
    return onOpen;
  };
  const items = () => [...node.querySelectorAll<HTMLButtonElement>('[data-testid="md-recent-report"]')];

  it("同一個模型只列最新一次，沒有來源 IFC 的報表不列", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({
      count: 3,
      items: [
        LINEAGE_REPORT,
        LINEAGE_REPORT_NOT_PRODUCED,
        { ...LINEAGE_REPORT, conversion_job_id: "stream_conv_x", source_ifc: { bucket: null, key: null, etag: null } },
      ],
    });
    const onOpen = await render();
    expect(items()).toHaveLength(1);
    expect(items()[0]!.textContent).toContain("899/main/p1/model.ifc");
    expect(items()[0]!.textContent).toContain("98.54%");
    await act(async () => items()[0]!.click());
    expect(onOpen).toHaveBeenCalledWith("899/main/p1/model.ifc");
  });

  it("沒有任何報表時說明", async () => {
    vi.spyOn(coordinatorClient, "listLineageConversionReports").mockResolvedValue({ count: 0, items: [] });
    await render();
    expect(items()).toHaveLength(0);
    expect(node.textContent).toContain("目前還沒有任何轉檔結果");
  });

  it("讀取失敗時可重試", async () => {
    const list = vi.spyOn(coordinatorClient, "listLineageConversionReports")
      .mockRejectedValueOnce(new Error("coordinator -> 503"))
      .mockResolvedValue({ count: 1, items: [LINEAGE_REPORT] });
    await render();
    const error = node.querySelector('[data-testid="md-recent-reports-error"]');
    expect(error).not.toBeNull();
    await act(async () => error!.querySelector("button")!.click());
    expect(list).toHaveBeenCalledTimes(2);
    expect(items()).toHaveLength(1);
  });
});
