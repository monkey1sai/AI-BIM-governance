import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "../coordinatorClient";
import { ConversionHistoryPanel } from "./ConversionHistoryPanel";

describe("ConversionHistoryPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("保留 wire status，誠實標示缺少的 source key/time，並展開 result artifacts", async () => {
    vi.spyOn(coordinatorClient, "getConversionResult").mockResolvedValue({
      status: "succeeded",
      ready: true,
      artifacts: {
        model_usdc: { url: "/artifacts/j/model.usdc" },
        element_mapping: { url: "/artifacts/j/element_mapping.json" },
      },
    });
    await act(async () => {
      root.render(<ConversionHistoryPanel history={[{
        conversion_job_id: "stream_conv_1",
        status: "succeeded",
        source_ifc_filename: "library.ifc",
      }]} historyErr={false} />);
    });

    expect(container.textContent).toContain("succeeded");
    expect(container.textContent).toContain("filename，source key 未提供");
    expect(container.textContent).toContain("時間未提供");

    const button = container.querySelector('[data-testid="conv-history-result-stream_conv_1"]') as HTMLButtonElement;
    await act(async () => { button.click(); });

    expect(coordinatorClient.getConversionResult).toHaveBeenCalledWith("stream_conv_1");
    expect(container.textContent).toContain("/artifacts/j/model.usdc");
    expect(container.textContent).toContain("/artifacts/j/element_mapping.json");
  });

  it("result 失敗不清空 history，並提供同列重試", async () => {
    const getResult = vi.spyOn(coordinatorClient, "getConversionResult")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ status: "failed", artifacts: {} });
    await act(async () => {
      root.render(<ConversionHistoryPanel history={[{
        conversion_job_id: "stream_conv_2",
        status: "failed",
        source_ifc_filename: "failed.ifc",
      }]} historyErr={false} />);
    });

    const button = container.querySelector('[data-testid="conv-history-result-stream_conv_2"]') as HTMLButtonElement;
    await act(async () => { button.click(); });
    expect(container.textContent).toContain("failed.ifc");
    expect(container.textContent).toContain("結果未取得");

    const retry = container.querySelector('[data-testid="conv-history-result-stream_conv_2"]') as HTMLButtonElement;
    await act(async () => { retry.click(); });
    expect(getResult).toHaveBeenCalledTimes(2);
  });

  it("逐字保留六種 conversion history wire status", async () => {
    const statuses = ["queued", "running", "succeeded", "succeeded_with_warnings", "failed", "cancelled"];
    await act(async () => {
      root.render(<ConversionHistoryPanel history={statuses.map((status, index) => ({
        conversion_job_id: `stream_conv_status_${index}`,
        status,
      }))} historyErr={false} />);
    });

    for (const status of statuses) expect(container.textContent).toContain(status);
  });

  it("history 更新失敗時保留上一份成功 snapshot", async () => {
    await act(async () => {
      root.render(<ConversionHistoryPanel history={[{
        conversion_job_id: "stream_conv_snapshot",
        status: "succeeded",
      }]} historyErr={true} />);
    });

    expect(container.querySelector('[data-testid="conv-history-error"]')?.textContent).toContain("保留上一份結果");
    expect(container.querySelector('[data-testid="conv-history-row-stream_conv_snapshot"]')).not.toBeNull();
    expect(container.textContent).toContain("succeeded");
  });
});
