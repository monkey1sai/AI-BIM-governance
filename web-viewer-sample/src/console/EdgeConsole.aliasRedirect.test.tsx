// web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx
// #conv 已恢復為獨立既有-job 歷史頁；只有舊 #intake 維持 query-preserving alias → #minio。
// 雙路由分治（IA v2）：UnifiedConsole 生產線頁改掛 #pipeline（UnifiedShell + PipelinePage），
// 與 legacy #conv（ConversionPage）並存、互不重導。
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "./EdgeConsole";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";

describe("EdgeConsole：#conv 獨立頁與 #intake alias", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  let prevUrl: string;
  let previousA4SessionContext: string | null;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    prevUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    previousA4SessionContext = window.sessionStorage.getItem("aibim:a4-session-context");
    window.sessionStorage.removeItem("aibim:a4-session-context");
    container = document.createElement("div");
    document.body.appendChild(container);
    // 重導成功後 usePageHash 會切到 #minio → ModelDataPage 掛載並抓四源資料（getMinioFolder /
    // getConversionRecords…）。stub 成空，讓測試聚焦「hash 是否被重寫」，不打真網路、不噴 loading 噪音。
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control",
      prefix: "",
      folders: [],
      objects: [],
      count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({
      service: { status: "ok" },
      sessions: { active_count: 0, items: [] },
    } as never);
    vi.spyOn(governanceClient, "searchLlmStatus").mockResolvedValue({
      service: "a4-search-llm",
      enabled: false,
      configured: false,
      state: "disabled",
      model: null,
      checked_at: null,
      check_source: "config",
      freshness: "unknown",
      ttl_s: 0,
      transport_class: "unconfigured",
      error_code: "llm_disabled",
    });
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
    window.history.replaceState(null, "", prevUrl);
    if (previousA4SessionContext) {
      window.sessionStorage.setItem("aibim:a4-session-context", previousA4SessionContext);
    } else {
      window.sessionStorage.removeItem("aibim:a4-session-context");
    }
  });

  // 輪詢 window.location.hash 直到等於預期（重導在 AliasRedirect useEffect 內同步 replace，通常
  // 首次 act flush 後即成立；迴圈為安全網並順帶 flush hashchange 觸發的 usePageHash re-render）。
  async function waitForHash(expected: string, timeout = 1000): Promise<void> {
    const start = Date.now();
    while (window.location.hash !== expected) {
      if (Date.now() - start > timeout) break;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(window.location.hash).toBe(expected);
  }

  async function waitForCondition(assertion: () => void, timeout = 1000): Promise<void> {
    const start = Date.now();
    while (true) {
      try {
        assertion();
        return;
      } catch (error) {
        if (Date.now() - start > timeout) throw error;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
    }
  }

  it("renderToString #conv?job_id=J：渲染獨立 CV 頁且不改寫 hash", () => {
    window.location.hash = "#conv?job_id=J";
    let html = "";
    expect(() => {
      html = renderToString(<EdgeConsole />);
    }).not.toThrow();
    expect(html).toContain("<h1>IFC→USD 轉檔歷史</h1>");
    expect(window.location.hash).toBe("#conv?job_id=J");
  });

  it("DOM 掛載 #conv?job_id=J → 保持獨立頁與 query", async () => {
    window.location.hash = "#conv?job_id=J";
    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    await waitForHash("#conv?job_id=J");
    expect(container.querySelector('[data-testid="conv-page"]')).not.toBeNull();
    await act(async () => {
      root.unmount();
    });
  });

  it("DOM 掛載 #intake（無 query）→ 重導 #minio", async () => {
    window.location.hash = "#intake";
    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    await waitForHash("#minio");
    await act(async () => {
      root.unmount();
    });
  });

  it("DOM 掛載 #pipeline → 渲染 UnifiedConsole PipelinePage（不重導、與 #conv 分治）", async () => {
    window.location.hash = "#pipeline";
    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    // flush 數個 tick：若存在任何重導邏輯，hash 會在此期間被改寫。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(window.location.hash).toBe("#pipeline");
    // PipelinePage 標題來自 fixtures.getL(zh).pipe_title（fixture-first，不打 /api）。
    expect(container.innerHTML).toContain("模型資料與轉檔生產線");
    await act(async () => {
      root.unmount();
    });
  });

  it("A4 aliases 只保留合法 session context，清除 query/proof/prim 並對正確 session 查詢", async () => {
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue({
      service: { status: "ok" },
      sessions: {
        active_count: 2,
        items: [
          { session_id: "review_session_a", status: "active" },
          { session_id: "review_session_a4", status: "active" },
        ],
      },
    } as never);
    const search = vi.spyOn(governanceClient, "searchModelForSession").mockResolvedValue({
      status: "ok",
      query_id: "a4q_alias_session",
      model_version_id: "model_a4",
      interpreted_filters: {
        raw_query: "IfcDoor",
        ifc_classes: ["IfcDoor"],
        storey_tokens: [],
        property_filters: [],
        name_contains: [],
        unmatched_fragments: [],
        interpretable: true,
        schema_valid: true,
        complete: true,
        usable: true,
        unresolved_terms: [],
        validation_errors: [],
      },
      results: [],
      stats: {
        total: 0,
        scanned: 0,
        matched: 0,
        not_matched: 0,
        returned: 0,
        mapped: 0,
        unmapped: 0,
        truncated: false,
      },
      issue_eligible: false,
    } as never);
    window.history.replaceState(
      {
        query: "must-be-scrubbed",
        evidence_proof: "must-be-scrubbed",
        usd_prim_path: "/must-be-scrubbed",
        a4_handoff: "must-be-scrubbed",
      },
      "",
      "/console?session=review_session_a4&evidence_proof=opaque#a4?query=IfcDoor&usd_prim_path=%2FRoot",
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    await waitForHash("#workspace?dock=a4");
    expect(window.location.pathname).toBe("/console");
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({ a4SessionId: "review_session_a4" });
    expect(container.querySelector('[data-testid="a4-semantic-search-page"]')).not.toBeNull();
    await waitForCondition(() => {
      expect((container.querySelector('[data-testid="a4-session-select"]') as HTMLSelectElement | null)?.value)
        .toBe("review_session_a4");
    });
    await act(async () => {
      (container.querySelector('[data-testid="a4-run"]') as HTMLButtonElement).click();
    });
    await waitForCondition(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith(
      "review_session_a4",
      expect.objectContaining({ interpret_mode: "auto" }),
    );

    await act(async () => {
      window.location.hash = "#semantic-search?evidence_proof=opaque-proof&ifc_guid=G1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitForHash("#workspace?dock=a4");
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({ a4SessionId: "review_session_a4" });
    expect(container.querySelector('[data-testid="a4-semantic-search-page"]')).not.toBeNull();

    await act(async () => {
      window.history.replaceState(
        { query: "must-be-scrubbed", evidence_proof: "must-be-scrubbed" },
        "",
        "/console?a4_handoff=opaque&query=IfcDoor#/workspace?dock=a4",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitForHash("#workspace?dock=a4");
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({ a4SessionId: "review_session_a4" });
    await act(async () => {
      root.unmount();
    });
  });

  it("malformed A4 hash with a second question mark is scrubbed to the canonical route", async () => {
    window.history.replaceState(
      {
        evidence_proof: "must-be-scrubbed",
        usd_prim_path: "/must-be-scrubbed",
      },
      "",
      "/console#/workspace?dock=a4?evidence_proof=opaque-proof&usd_prim_path=%2FRoot",
    );

    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });

    await waitForHash("#workspace?dock=a4");
    expect(window.location.search).toBe("");
    expect(window.history.state).toBeNull();
    expect(container.querySelector('[data-testid="a4-semantic-search-page"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("malformed higher-priority session values do not erase a valid stored session", async () => {
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue({
      sessions: {
        items: [
          { session_id: "review_session_a", status: "active" },
          { session_id: "review_session_b", status: "active" },
        ],
      },
    } as never);
    window.sessionStorage.setItem("aibim:a4-session-context", "review_session_b");
    window.history.replaceState(
      { a4SessionId: "not-a-session", evidence_proof: "must-be-scrubbed" },
      "",
      "/console?session=not-a-session#semantic-search?session=also-invalid&query=IfcDoor",
    );

    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    await waitForHash("#workspace?dock=a4");
    await waitForCondition(() => {
      expect((container.querySelector('[data-testid="a4-session-select"]') as HTMLSelectElement | null)?.value)
        .toBe("review_session_b");
    });
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({ a4SessionId: "review_session_b" });
    expect(window.sessionStorage.getItem("aibim:a4-session-context")).toBe("review_session_b");

    await act(async () => {
      root.unmount();
    });
  });

  it("canonical A4 route renders directly without a fixture redirect", () => {
    window.location.hash = "#/workspace?dock=a4";
    const html = renderToString(<EdgeConsole />);
    expect(html).toContain("a4-semantic-search-page");
    expect(html).not.toContain("不符合 5");
    expect(html).not.toContain("符合 7");
  });
});
