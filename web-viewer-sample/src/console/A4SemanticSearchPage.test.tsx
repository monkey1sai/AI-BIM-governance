import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A4SemanticSearchPage } from "./A4SemanticSearchPage";
import { coordinatorClient } from "./coordinatorClient";
import { governanceClient } from "./governanceClient";
import { __resetLocalDevUserCarrierForTests, getLocalDevUserCarrier } from "./localDevPrincipal";

describe("A4SemanticSearchPage", () => {
  it("renders live workbench shell (not vision placeholder)", () => {
    const html = renderToString(<A4SemanticSearchPage />);
    expect(html).toContain("a4-semantic-search-page");
    expect(html).toContain("a4-query-input");
    expect(html).toContain("a4-run");
    expect(html).toContain("a4-source-loading");
    expect(html).toContain("FireRating");
    expect(html).not.toContain("a4-source-path");
    expect(html).not.toContain("a4-path-input");
    expect(html).not.toContain("a4-select-all");
    expect(html).toContain("a4-actions-unavailable");
    expect(html).not.toContain("base_url");
    expect(html).toContain("transport_class");
    expect(html).not.toContain("後端未建");
  });

  describe("scoped compatibility flow", () => {
    let container: HTMLDivElement;
    let root: Root | null;
    const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
    let previousActEnv: unknown;

    beforeEach(() => {
      previousActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
      (globalThis as Record<string, unknown>)[actEnvKey] = true;
      __resetLocalDevUserCarrierForTests();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = null;
      vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [] } } as never);
      vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({
        count: 2,
        items: [{
          ifc_ready_job_id: "ifcready_pending",
          status: "queued_for_conversion",
          download_status: "pending",
          conversion_status: null,
        }, {
          ifc_ready_job_id: "ifcready_x",
          status: "ready",
          download_status: "downloaded",
          conversion_status: "ready",
        }],
      } as never);
      vi.spyOn(governanceClient, "searchLlmStatus").mockResolvedValue({
        state: "disabled",
        configured: false,
        enabled: false,
        model: null,
        check_source: "config",
        freshness: "unknown",
        transport_class: "unconfigured",
      } as never);
    });

    afterEach(async () => {
      if (root) await act(async () => { root!.unmount(); });
      vi.useRealTimers();
      container.remove();
      vi.restoreAllMocks();
      __resetLocalDevUserCarrierForTests();
      (globalThis as Record<string, unknown>)[actEnvKey] = previousActEnv;
    });

    const flush = async () => {
      for (let i = 0; i < 5; i += 1) {
        await act(async () => { await Promise.resolve(); });
      }
    };

    const fieldValue = (key: string) => Array.from(container.querySelectorAll<HTMLElement>(".ec-field"))
      .find((field) => field.querySelector(".ec-k")?.textContent === key)
      ?.querySelector<HTMLElement>(".ec-v")?.textContent ?? "";

    it("uses the shared lease principal for IFC-ready search and keeps legacy actions unavailable", async () => {
      const response = {
        status: "ok",
        query_id: "a4_query_x",
        search_scope: "ifc_ready_table_only",
        completion_scope: "complete_table",
        issue_eligible: false,
        highlight_eligible: false,
        interpreted_filters: {
          raw_query: "IfcDoor",
          ifc_classes: ["IfcDoor"],
          storey_tokens: [],
          property_filters: [],
          interpretable: true,
          notes: [],
          confidence: 1,
          confidence_basis: "deterministic_grammar",
        },
        results: [{
          ifc_guid: "guid-1",
          usd_prim_path: null,
          ifc_class: "IfcDoor",
          name: "Door 1",
          storey: "1F",
          properties: {},
          match_status: "matched_query",
          confidence: 1,
          evidence_refs: [],
          highlight_eligible: false,
        }],
        stats: { total: 1, matched: 1, unmapped: 1, scanned: 1 },
        evidence_refs: [],
      };
      const search = vi.spyOn(governanceClient, "searchModelForIfcReady").mockResolvedValue(response as never);
      const createIssue = vi.spyOn(governanceClient, "createIssue");
      const carrier = getLocalDevUserCarrier();

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();

      expect(coordinatorClient.listIfcReady).toHaveBeenCalledWith(100);
      // canonical session 來源已可選（不再是等待 S4-D 的停用按鈕）；但沒有
      // session context 進站時仍預設 ifc_ready，因此此處不渲染 session select。
      expect(container.querySelector<HTMLButtonElement>('[data-testid="a4-source-session"]')?.disabled).toBe(false);
      expect(container.querySelector('[data-testid="a4-session-select"]')).toBeNull();
      expect(container.querySelector<HTMLSelectElement>('[data-testid="a4-job-select"]')?.value).toBe("ifcready_x");
      expect(container.textContent).not.toContain("ifcready_pending");
      expect(coordinatorClient.runtimeStatus).toHaveBeenCalled();
      const run = container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')!;
      expect(run.disabled).toBe(false);
      vi.mocked(governanceClient.searchLlmStatus)
        .mockRejectedValueOnce(new Error("https://secret-upstream.invalid/token-sentinel"));
      await act(async () => { run.click(); });
      await flush();

      expect(search).toHaveBeenCalledWith(
        "ifcready_x",
        expect.objectContaining({ query: expect.any(String), interpret_mode: "auto" }),
        carrier,
      );
      expect(container.textContent).toContain("ifc_ready_table_only");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="a4-create-issues"]')?.disabled).toBe(true);
      expect(container.textContent).toContain("signed-proof");
      expect(createIssue).not.toHaveBeenCalled();
      expect(governanceClient.searchLlmStatus).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toContain("secret-upstream");
      expect(container.textContent).not.toContain("token-sentinel");
      expect(container.innerHTML).not.toContain(carrier);
    });

    it("uses the bounded maximum source window and exposes truncation", async () => {
      const items: Array<{
        ifc_ready_job_id: string;
        status: string;
        download_status: string;
        conversion_status: string | null;
      }> = Array.from({ length: 99 }, (_, index) => ({
        ifc_ready_job_id: `ifcready_pending_${index}`,
        status: "queued_for_conversion",
        download_status: "pending",
        conversion_status: null,
      }));
      items.push({
        ifc_ready_job_id: "ifcready_older_downloaded",
        status: "ready",
        download_status: "downloaded",
        conversion_status: "ready",
      });
      vi.mocked(coordinatorClient.listIfcReady).mockResolvedValueOnce({ count: 101, items } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();

      expect(coordinatorClient.listIfcReady).toHaveBeenCalledWith(100);
      expect(container.querySelector<HTMLSelectElement>('[data-testid="a4-job-select"]')?.value)
        .toBe("ifcready_older_downloaded");
      expect(container.querySelector('[data-testid="a4-source-truncated"]')?.textContent)
        .toContain("最新 100 筆");
      expect(container.querySelector('[data-testid="a4-source-truncated"]')?.textContent)
        .toContain("不是完整集合");
    });

    it("clears a vanished source instead of silently selecting another job", async () => {
      vi.mocked(coordinatorClient.listIfcReady)
        .mockResolvedValueOnce({
          count: 2,
          items: [{
            ifc_ready_job_id: "ifcready_selected",
            status: "ready",
            download_status: "downloaded",
            conversion_status: "ready",
          }, {
            ifc_ready_job_id: "ifcready_other",
            status: "ready",
            download_status: "downloaded",
            conversion_status: "ready",
          }],
        } as never)
        .mockResolvedValueOnce({
          count: 1,
          items: [{
            ifc_ready_job_id: "ifcready_other",
            status: "ready",
            download_status: "downloaded",
            conversion_status: "ready",
          }],
        } as never)
        .mockResolvedValueOnce({
          count: 1,
          items: [{
            ifc_ready_job_id: "ifcready_other",
            status: "ready",
            download_status: "downloaded",
            conversion_status: "ready",
          }],
        } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();
      expect(container.querySelector<HTMLSelectElement>('[data-testid="a4-job-select"]')?.value)
        .toBe("ifcready_selected");

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-refresh-sources"]')!.click();
      });
      await flush();

      expect(container.querySelector<HTMLSelectElement>('[data-testid="a4-job-select"]')?.value).toBe("");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')?.disabled).toBe(true);

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-refresh-sources"]')!.click();
      });
      await flush();

      expect(container.querySelector<HTMLSelectElement>('[data-testid="a4-job-select"]')?.value).toBe("");
      expect(coordinatorClient.listIfcReady).toHaveBeenCalledTimes(3);
    });

    it.each([
      ["configured but unobserved", { state: "unknown", freshness: "unknown", check_source: "config", checked_at: null, ttl_s: 0 }],
      ["freshly unavailable", { state: "unavailable", freshness: "fresh", check_source: "query_observation", checked_at: "2026-07-23T00:00:00Z", ttl_s: 30 }],
      ["stale observation", { state: "unknown", freshness: "stale", check_source: "query_observation", checked_at: "2026-07-23T00:00:00Z", ttl_s: 0 }],
      ["available with config-only evidence", { state: "available", freshness: "fresh", check_source: "config", checked_at: "2026-07-23T00:00:00Z", ttl_s: 30 }],
      ["available without checked_at", { state: "available", freshness: "fresh", check_source: "query_observation", checked_at: null, ttl_s: 30 }],
      ["available with an expired TTL", { state: "available", freshness: "fresh", check_source: "query_observation", checked_at: "2026-07-23T00:00:00Z", ttl_s: 0 }],
    ])("keeps the fail-closed warning for %s LLM status", async (_label, status) => {
      vi.mocked(governanceClient.searchLlmStatus).mockResolvedValueOnce({
        enabled: true,
        configured: true,
        model: "Ornith-1.0-35B",
        transport_class: "loopback_tunnel",
        error_code: null,
        ...status,
      } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();

      expect(container.querySelector('[data-testid="a4-llm-missing"]')).not.toBeNull();
      expect(container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')?.disabled).toBe(false);
    });

    it.each(["query_observation", "bounded_probe", "last_query"])(
      "accepts fresh live readiness from %s",
      async (checkSource) => {
        vi.mocked(governanceClient.searchLlmStatus).mockResolvedValueOnce({
          enabled: true,
          configured: true,
          state: "available",
          model: "Ornith-1.0-35B",
          checked_at: "2026-07-23T00:00:00Z",
          check_source: checkSource,
          freshness: "fresh",
          ttl_s: 30,
          transport_class: "loopback_tunnel",
          error_code: null,
        } as never);

        root = createRoot(container);
        await act(async () => { root!.render(<A4SemanticSearchPage />); });
        await flush();

        expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();
      },
    );

    it("expires fresh live readiness from its receipt time without polling", async () => {
      vi.useFakeTimers();
      let monotonicMs = 0;
      vi.spyOn(performance, "now").mockImplementation(() => monotonicMs);
      vi.mocked(governanceClient.searchLlmStatus).mockResolvedValueOnce({
        enabled: true,
        configured: true,
        state: "available",
        model: "Ornith-1.0-35B",
        checked_at: "2026-07-23T00:00:00Z",
        check_source: "query_observation",
        freshness: "fresh",
        ttl_s: 1,
        transport_class: "loopback_tunnel",
        error_code: null,
      } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();

      await act(async () => {
        monotonicMs = 999;
        vi.advanceTimersByTime(999);
      });
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();

      await act(async () => {
        monotonicMs = 1_000;
        vi.advanceTimersByTime(1);
      });

      expect(container.querySelector('[data-testid="a4-llm-missing"]')).not.toBeNull();
      expect(fieldValue("state")).toContain("unknown");
      expect(fieldValue("readiness_evidence")).toContain("unknown");
      expect(fieldValue("readiness_evidence")).not.toContain("fresh");
      expect(governanceClient.searchLlmStatus).toHaveBeenCalledTimes(1);
    });

    it("updates readiness after a query and ignores an older post-run response", async () => {
      let resolveOlderStatus!: (value: unknown) => void;
      const olderStatus = new Promise((resolve) => { resolveOlderStatus = resolve; });
      const disabledStatus = {
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
      };
      const availableStatus = {
        enabled: true,
        configured: true,
        state: "available",
        model: "Ornith-1.0-35B",
        checked_at: "2026-07-23T00:00:00Z",
        check_source: "query_observation",
        freshness: "fresh",
        ttl_s: 30,
        transport_class: "loopback_tunnel",
        error_code: null,
      };
      vi.mocked(governanceClient.searchLlmStatus)
        .mockResolvedValueOnce(disabledStatus as never)
        .mockReturnValueOnce(olderStatus as never)
        .mockResolvedValueOnce(availableStatus as never);
      vi.spyOn(governanceClient, "searchModelForIfcReady").mockResolvedValue({
        status: "ok",
        results: [],
        stats: { matched: 0, scanned: 1, unmapped: 0 },
      } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).not.toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')!.click();
      });
      await flush();
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-refresh-sources"]')!.click();
      });
      await flush();
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();

      await act(async () => {
        resolveOlderStatus({
          ...availableStatus,
          state: "unavailable",
          error_code: "llm_network_error",
        });
        await Promise.resolve();
      });
      await flush();

      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();
      expect(container.textContent).not.toContain("llm_network_error");
      expect(governanceClient.searchLlmStatus).toHaveBeenCalledTimes(3);
    });

    it("accepts a fresh post-run observation after an auto query", async () => {
      const availableStatus = {
        enabled: true,
        configured: true,
        state: "available",
        model: "Ornith-1.0-35B",
        checked_at: "2026-07-23T00:00:00Z",
        check_source: "query_observation",
        freshness: "fresh",
        ttl_s: 30,
        transport_class: "loopback_tunnel",
        error_code: null,
      };
      vi.mocked(governanceClient.searchLlmStatus)
        .mockResolvedValueOnce({
          ...availableStatus,
          configured: true,
          state: "unknown",
          checked_at: null,
          check_source: "config",
          freshness: "unknown",
          ttl_s: 0,
        } as never)
        .mockResolvedValueOnce(availableStatus as never);
      vi.spyOn(governanceClient, "searchModelForIfcReady").mockResolvedValue({
        status: "ok",
        results: [],
        stats: { matched: 0, scanned: 1, unmapped: 0 },
      } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).not.toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')!.click();
      });
      await flush();

      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();
      expect(governanceClient.searchLlmStatus).toHaveBeenCalledTimes(2);
    });

    it("replaces the previous readiness expiry timer after a fresh post-run observation", async () => {
      vi.useFakeTimers();
      let monotonicMs = 0;
      vi.spyOn(performance, "now").mockImplementation(() => monotonicMs);
      const availableStatus = {
        enabled: true,
        configured: true,
        state: "available",
        model: "Ornith-1.0-35B",
        checked_at: "2026-07-23T00:00:00Z",
        check_source: "query_observation",
        freshness: "fresh",
        ttl_s: 1,
        transport_class: "loopback_tunnel",
        error_code: null,
      };
      vi.mocked(governanceClient.searchLlmStatus)
        .mockResolvedValueOnce(availableStatus as never)
        .mockResolvedValueOnce({ ...availableStatus, ttl_s: 30 } as never);
      vi.spyOn(governanceClient, "searchModelForIfcReady").mockResolvedValue({
        status: "ok",
        results: [],
        stats: { matched: 0, scanned: 1, unmapped: 0 },
      } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')!.click();
      });
      await flush();

      await act(async () => {
        monotonicMs = 1_000;
        vi.advanceTimersByTime(1_000);
      });
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();
      expect(governanceClient.searchLlmStatus).toHaveBeenCalledTimes(2);
    });

    it("keeps a successful result but withdraws stale readiness when the post-run refresh fails", async () => {
      const availableStatus = {
        enabled: true,
        configured: true,
        state: "available",
        model: "Ornith-1.0-35B",
        checked_at: "2026-07-23T00:00:00Z",
        check_source: "query_observation",
        freshness: "fresh",
        ttl_s: 30,
        transport_class: "loopback_tunnel",
        error_code: null,
      };
      vi.mocked(governanceClient.searchLlmStatus)
        .mockResolvedValueOnce(availableStatus as never)
        .mockRejectedValueOnce(new Error("https://secret-upstream.invalid/status-token"));
      vi.spyOn(governanceClient, "searchModelForIfcReady").mockResolvedValue({
        status: "ok",
        results: [],
        stats: { matched: 0, scanned: 1, unmapped: 0 },
      } as never);

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')!.click();
      });
      await flush();

      expect(container.textContent).toContain("status");
      expect(container.querySelector('[data-testid="a4-llm-missing"]')).not.toBeNull();
      expect(fieldValue("state")).toContain("unknown");
      expect(fieldValue("readiness_evidence")).toContain("unknown");
      expect(fieldValue("readiness_evidence")).not.toContain("fresh");
      expect(container.textContent).not.toContain("secret-upstream");
      expect(container.textContent).not.toContain("status-token");
    });

    it("shows bounded source failures and recovers through the visible retry", async () => {
      vi.mocked(coordinatorClient.listIfcReady)
        .mockRejectedValueOnce(new Error("C:\\sensitive\\fixture.ifc"));
      vi.mocked(governanceClient.searchLlmStatus)
        .mockRejectedValueOnce(new Error("secret-carrier-sentinel"));

      root = createRoot(container);
      await act(async () => { root!.render(<A4SemanticSearchPage />); });
      await flush();

      const error = container.querySelector<HTMLElement>('[data-testid="a4-load-err"]');
      expect(error?.textContent).toContain("IFC-ready 來源清單載入失敗");
      expect(error?.textContent).toContain("LLM readiness 狀態載入失敗");
      expect(error?.textContent).not.toContain("sensitive");
      expect(error?.textContent).not.toContain("secret-carrier-sentinel");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')?.disabled).toBe(true);

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="a4-refresh-sources"]')!.click();
      });
      await flush();

      expect(container.querySelector('[data-testid="a4-load-err"]')).toBeNull();
      expect(container.querySelector<HTMLSelectElement>('[data-testid="a4-job-select"]')?.value).toBe("ifcready_x");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')?.disabled).toBe(false);
    });
  });
});
