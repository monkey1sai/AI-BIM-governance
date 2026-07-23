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

      expect(container.querySelector<HTMLButtonElement>('[data-testid="a4-source-session"]')?.disabled).toBe(true);
      expect(container.querySelector('[data-testid="a4-session-select"]')).toBeNull();
      expect(container.querySelector<HTMLSelectElement>('[data-testid="a4-job-select"]')?.value).toBe("ifcready_x");
      expect(container.textContent).not.toContain("ifcready_pending");
      expect(coordinatorClient.runtimeStatus).not.toHaveBeenCalled();
      const run = container.querySelector<HTMLButtonElement>('[data-testid="a4-run"]')!;
      expect(run.disabled).toBe(false);
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
      expect(container.innerHTML).not.toContain(carrier);
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
