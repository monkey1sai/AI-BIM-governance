// Task 4B：#demo-control（RealIfcConsolePage）於 /api/dev/ifc-sources 404 時誠實顯示
// 「dev routes 已關閉」（PR #699 D3 後端 prefix gate：ENABLE_DEV_ROUTES=false 時 /api/dev/* 整組 404）。
// loadSources 走 raw fetch（W4 語意：非 2xx 是值不是錯誤，非 jsonGet/CoordinatorHttpError），
// 故本頁直接判 r.status===404，不透過 coordinatorClient。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealIfcConsolePage } from "./RealIfcConsolePage";

describe("RealIfcConsolePage（#demo-control）：dev routes 404 誠實狀態", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("GET /api/dev/ifc-sources 404 → 顯示 dev routes 已關閉 notice、runtime 狀態誠實反映、註冊鈕與 select disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "dev routes disabled" }), { status: 404, statusText: "Not Found" }),
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    // mount effect 的 loadSources() 是一個 microtask 鏈；flush 一輪即可讓 fetch().then/await 落地。
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const notice = container.querySelector('[data-testid="ifc-dev-routes-notice"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent ?? "").toContain("dev routes 已關閉");

    const runtimeEl = container.querySelector('[data-testid="ifc-runtime-state"]');
    expect(runtimeEl?.textContent ?? "").toContain("dev_routes_disabled");

    const select = container.querySelector<HTMLSelectElement>('[data-testid="ifc-fixture-select"]');
    expect(select?.disabled).toBe(true);
    expect(select?.options[0]?.textContent ?? "").toBe("（dev routes 已關閉）");

    const registerBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]');
    expect(registerBtn?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("dev routes disabled 時點擊註冊鈕不送出 POST（disabled 屬性＋register() 內部守門雙重保護）", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "dev routes disabled" }), { status: 404, statusText: "Not Found" }),
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsAfterLoad = fetchSpy.mock.calls.length;

    const registerBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')!;
    await act(async () => {
      registerBtn.click();
    });
    // disabled 鈕原生不會觸發 onClick；即使觸發，register() 內守門也不應再呼叫 fetch。
    expect(fetchSpy.mock.calls.length).toBe(callsAfterLoad);

    await act(async () => {
      root.unmount();
    });
  });

  it("disabled 後重新整理遇到 network failure：清除 stale disabled notice 並顯示當前載入失敗", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "dev routes disabled" }), { status: 404, statusText: "Not Found" }),
      )
      .mockRejectedValueOnce(new Error("coordinator unavailable"));
    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).not.toBeNull();
    const refreshBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-refresh-btn"]')!;
    await act(async () => {
      refreshBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).toBeNull();
    expect(container.querySelector('[data-testid="ifc-runtime-state"]')?.textContent ?? "").toContain(
      "runtime: load_sources_failed: coordinator unavailable",
    );
    expect(container.querySelector<HTMLSelectElement>('[data-testid="ifc-fixture-select"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("清單載入後 backend 關閉 dev routes：register exact 404 轉成 notice 並停用控制項", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          source_id: "source-1",
          filename: "fixture.ifc",
          relative_path: "fixture.ifc",
          size_bytes: 1024,
          modified_at: "2026-08-27T00:00:00Z",
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "dev routes disabled" }), {
        status: 404,
        statusText: "Not Found",
      }));

    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const registerBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')!;
    expect(registerBtn.disabled).toBe(false);
    await act(async () => {
      registerBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ifc-runtime-state"]')?.textContent ?? "").toContain(
      "runtime: dev_routes_disabled",
    );
    expect(container.querySelector<HTMLSelectElement>('[data-testid="ifc-fixture-select"]')?.disabled).toBe(true);
    expect(registerBtn.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("register 一般 404 保留 rejected 語意，不得誤標為 dev routes disabled", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          source_id: "source-1",
          filename: "fixture.ifc",
          relative_path: "fixture.ifc",
          size_bytes: 1024,
          modified_at: "2026-08-27T00:00:00Z",
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "unknown or stale source_id" }), {
        status: 404,
        statusText: "Not Found",
      }));

    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const registerBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')!;
    await act(async () => {
      registerBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).toBeNull();
    expect(container.querySelector('[data-testid="ifc-runtime-state"]')?.textContent ?? "").toContain(
      "runtime: register_rejected (404)",
    );
    expect(container.querySelector<HTMLSelectElement>('[data-testid="ifc-fixture-select"]')?.disabled).toBe(false);
    expect(registerBtn.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("既有 job 後 register exact disabled 404：清除所有 stale job-derived lineage", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          source_id: "source-1",
          filename: "fixture.ifc",
          relative_path: "fixture.ifc",
          size_bytes: 1024,
          modified_at: "2026-08-27T00:00:00Z",
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ifc_ready_job_id: "job-old",
        download_status: "failed",
        conversion_status: "failed",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "dev routes disabled" }), {
        status: 404,
        statusText: "Not Found",
      }));

    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const registerBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')!;
    await act(async () => {
      registerBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="lin-job-id"]')?.textContent).toBe("job-old");
    expect(container.querySelector('[data-testid="lin-download-status"]')?.textContent).toBe("failed");
    expect(container.querySelector('[data-testid="lin-conversion-status"]')?.textContent).toBe("failed");

    await act(async () => {
      registerBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).not.toBeNull();
    for (const testId of [
      "lin-job-id",
      "lin-conversion-job",
      "lin-conversion-status",
      "lin-download-status",
      "lin-artifact-id",
      "lin-usdc-url",
      "lin-mapping",
      "lin-session-id",
      "lin-viewer-url",
    ]) {
      expect(container.querySelector(`[data-testid="${testId}"]`)?.textContent).toBe("—");
    }

    await act(async () => {
      root.unmount();
    });
  });

  it.each(["resolve", "reject"] as const)(
    "active poll 晚到 %s 時 refresh exact disabled 404：清除 lineage 並禁止舊 poll 覆寫",
    async (lateOutcome) => {
    let resolvePoll!: (response: Response) => void;
    let rejectPoll!: (reason: Error) => void;
    const pendingPoll = new Promise<Response>((resolve, reject) => {
      resolvePoll = resolve;
      rejectPoll = reject;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          source_id: "source-1",
          filename: "fixture.ifc",
          relative_path: "fixture.ifc",
          size_bytes: 1024,
          modified_at: "2026-08-27T00:00:00Z",
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ifc_ready_job_id: "job-old",
        download_status: "downloaded",
        conversion_status: "queued",
      }), { status: 200 }))
      .mockReturnValueOnce(pendingPoll)
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "dev routes disabled" }), {
        status: 404,
        statusText: "Not Found",
      }));

    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const registerBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')!;
    await act(async () => {
      registerBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="lin-job-id"]')?.textContent).toBe("job-old");
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const refreshBtn = container.querySelector<HTMLButtonElement>('[data-testid="ifc-refresh-btn"]')!;
    await act(async () => {
      refreshBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      if (lateOutcome === "resolve") {
        resolvePoll(new Response(JSON.stringify({
          download_status: "downloaded",
          conversion_status: "ready",
          conversion_job_id: "conversion-old",
          web_view_session_id: "session-old",
          viewer_url: "/ui/open?session=session-old",
        }), { status: 200 }));
      } else {
        rejectPoll(new Error("old poll failed"));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ifc-runtime-state"]')?.textContent ?? "").toContain(
      "runtime: dev_routes_disabled",
    );
    for (const testId of [
      "lin-job-id",
      "lin-conversion-job",
      "lin-conversion-status",
      "lin-download-status",
      "lin-artifact-id",
      "lin-usdc-url",
      "lin-mapping",
      "lin-session-id",
      "lin-viewer-url",
    ]) {
      expect(container.querySelector(`[data-testid="${testId}"]`)?.textContent).toBe("—");
    }

    await act(async () => {
      root.unmount();
    });
    },
  );

  it.each([
    ["generic 404", 404, "route not found"],
    ["JSON 502", 502, "upstream unavailable"],
  ])("%s 不得誤標為 dev routes 已關閉，顯示一般載入失敗且控制項保持可用", async (_label, status, detail) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail }), {
        status,
        statusText: status === 404 ? "Not Found" : "Bad Gateway",
      }),
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(<RealIfcConsolePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="ifc-dev-routes-notice"]')).toBeNull();
    const runtimeEl = container.querySelector('[data-testid="ifc-runtime-state"]');
    expect(runtimeEl?.textContent ?? "").toContain(`runtime: load_sources_failed: HTTP ${status}`);
    expect(runtimeEl?.textContent ?? "").toContain(detail);
    expect(container.querySelector<HTMLSelectElement>('[data-testid="ifc-fixture-select"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="ifc-register-btn"]')?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
