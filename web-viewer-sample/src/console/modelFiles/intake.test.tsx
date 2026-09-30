// 契約 §5.1 本機未轉檔 IFC：註冊→輪詢→終態；dev routes 關閉時整段隱藏且不再重試。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import { classifyIntakeJob } from "./intakeProgress";
import { useIfcIntakeRegistration } from "./useIfcIntakeRegistration";

describe("classifyIntakeJob", () => {
  it("follows RealIfcConsolePage's terminal rules", () => {
    expect(classifyIntakeJob({ viewer_url: "/ui/open?session=s", web_view_session_id: "s" }, 1)).toEqual({ kind: "ready", viewerUrl: "/ui/open?session=s", sessionId: "s" });
    expect(classifyIntakeJob({ download_status: "failed" }, 1)).toEqual({ kind: "download_failed" });
    expect(classifyIntakeJob({ conversion_status: "failed" }, 1)).toEqual({ kind: "conversion_failed" });
    expect(classifyIntakeJob({ conversion_status: "runtime_blocked" }, 1)).toEqual({ kind: "blocked" });
    expect(classifyIntakeJob({ conversion_status: "queued" }, 36)).toEqual({ kind: "timeout", status: "queued" });
    expect(classifyIntakeJob({ conversion_status: null }, 2)).toEqual({ kind: "converting", status: "queued" });
  });
});

describe("useIfcIntakeRegistration", () => {
  let container: HTMLDivElement; let root: Root;
  let latest: ReturnType<typeof useIfcIntakeRegistration> | null = null;
  function Probe({ onReady }: { onReady: (sessionId: string) => void }) { latest = useIfcIntakeRegistration(onReady); return null; }
  beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); latest = null; });
  const flush = async () => { await act(async () => { await Promise.resolve(); }); };

  it("dev routes disabled stops the local section", async () => {
    vi.spyOn(coordinatorClient, "listIfcSources").mockRejectedValue(new CoordinatorHttpError("/api/dev/ifc-sources", 404, "dev routes disabled", "dev_routes_disabled"));
    await act(async () => { root.render(<Probe onReady={() => {}} />); });
    await flush();
    expect(latest!.devRoutes).toBe("disabled");
    expect(latest!.sources).toEqual([]);
  });

  it("registers a source, polls until ready and reports the session id", async () => {
    vi.spyOn(coordinatorClient, "listIfcSources").mockResolvedValue({ items: [{ source_id: "src1", filename: "villa.ifc", relative_path: "villa.ifc", size_bytes: 10, modified_at: "2026-09-30T00:00:00.000Z" }] });
    vi.spyOn(coordinatorClient, "registerIfcSource").mockResolvedValue({ ifc_ready_job_id: "ifcready_1", download_status: "pending", conversion_status: null });
    const getJob = vi.spyOn(coordinatorClient, "getIfcReadyJob")
      .mockResolvedValueOnce({ conversion_status: "queued" } as never)
      .mockResolvedValueOnce({ conversion_status: "ready", viewer_url: "/ui/open?session=review_session_x", web_view_session_id: "review_session_x" } as never);
    const onReady = vi.fn();
    await act(async () => { root.render(<Probe onReady={onReady} />); });
    await flush();
    expect(latest!.devRoutes).toBe("enabled");
    await act(async () => { await latest!.register(latest!.sources[0]); });
    expect(latest!.progress.src1).toEqual({ kind: "converting", status: "queued" });
    // register 的回覆算第 1 次判定；之後每 5 s 輪詢一次，所以「queued → ready」要兩個 5 s。
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await flush();
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(latest!.progress.src1).toEqual({ kind: "converting", status: "queued" });
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve(); });
    await flush();
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(latest!.progress.src1).toEqual({ kind: "ready", viewerUrl: "/ui/open?session=review_session_x", sessionId: "review_session_x" });
    expect(onReady).toHaveBeenCalledWith("review_session_x");
  });
});
