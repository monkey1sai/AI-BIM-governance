import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A4SemanticSearchPage, normalizedLlmReadiness } from "./A4SemanticSearchPage";
import { coordinatorClient } from "./coordinatorClient";
import { A4GovernanceError, governanceClient } from "./governanceClient";

const ACTIVE_SESSIONS = {
  sessions: {
    items: [
      { session_id: "review_session_a", status: "active" },
      { session_id: "review_session_b", status: "active" },
    ],
  },
} as never;

function searchResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    query_id: "a4q_component_test",
    model_version_id: "model_a4",
    interpret_mode: "auto",
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
      interpret_source: "deterministic",
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
    ...overrides,
  } as never;
}

describe("A4SemanticSearchPage", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let root: Root | null;
  let previousActEnvironment: unknown;
  let previousUrl: string;
  let previousHistoryState: unknown;
  let previousA4SessionContext: string | null;

  beforeEach(() => {
    previousActEnvironment = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    previousHistoryState = window.history.state;
    previousA4SessionContext = window.sessionStorage.getItem("aibim:a4-session-context");
    window.sessionStorage.setItem("aibim:a4-session-context", "review_session_b");
    window.history.replaceState({ a4SessionId: "review_session_b" }, "", "/console#/workspace?dock=a4");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(ACTIVE_SESSIONS);
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
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

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = previousActEnvironment;
    window.history.replaceState(previousHistoryState, "", previousUrl);
    if (previousA4SessionContext) {
      window.sessionStorage.setItem("aibim:a4-session-context", previousA4SessionContext);
    } else {
      window.sessionStorage.removeItem("aibim:a4-session-context");
    }
  });

  async function mount(): Promise<void> {
    root = createRoot(container);
    await act(async () => root?.render(<A4SemanticSearchPage />));
  }

  async function waitFor(assertion: () => void, timeout = 1000): Promise<void> {
    const started = Date.now();
    while (true) {
      try {
        assertion();
        return;
      } catch (error) {
        if (Date.now() - started > timeout) throw error;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
    }
  }

  function fieldValue(key: string): string | undefined {
    const field = [...container.querySelectorAll(".ec-field")]
      .find((candidate) => candidate.querySelector(".ec-k")?.textContent === key);
    return field?.querySelector(".ec-v")?.textContent?.trim();
  }

  it("renders live workbench shell (not vision placeholder)", () => {
    const html = renderToString(<A4SemanticSearchPage />);
    expect(html).toContain("a4-semantic-search-page");
    expect(html).toContain("a4-query-input");
    expect(html).toContain("a4-run");
    expect(html).toContain("FireRating");
    expect(html).not.toContain("後端未建");
    expect(html).toContain("transport_class");
    expect(html).not.toContain("base_url");
    expect(html).not.toContain('k="auth"');
    expect(html).toContain("a4-source-session");
    expect(html).toContain("a4-source-ifc_ready");
    expect(html).not.toContain("a4-path-input");
    expect(html).not.toContain("a4-source-path");
    expect(html).not.toContain("a4-create-issues");
    expect(html).toContain("a4-table-only");
    expect(html).toContain("a4-retry");
    expect(html).toContain("a4-confirm-partial");
    expect(html).toContain("a4-session-unavailable");
  });

  it("keeps the unsupported ifc-ready compatibility source visibly unavailable", async () => {
    await mount();

    const ifcReadyButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="a4-source-ifc_ready"]',
    );
    expect(ifcReadyButton?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="a4-ifc-ready-unavailable"]')?.textContent)
      .toContain("ifc-ready");
  });

  it("creates one independent Issue request per selected row and renders mixed outcomes without losing the draft", async () => {
    const rows = [
      {
        ifc_guid: "GUID-A",
        usd_prim_path: "/World/A",
        ifc_class: "IfcDoor",
        name: "Door A",
        storey: "4F",
        properties: {},
        match_status: "matched_query",
        confidence: 1,
        evidence_refs: ["ifc:GUID-A"],
        evidence_proof: "a4p.test.proof-a.deadbeef",
        proof_expires_at: "2026-07-17T04:00:00Z",
        issue_eligible: true,
        highlight_eligible: false,
      },
      {
        ifc_guid: "GUID-B",
        usd_prim_path: "/World/B",
        ifc_class: "IfcDoor",
        name: "Door B",
        storey: "4F",
        properties: {},
        match_status: "matched_query",
        confidence: 1,
        evidence_refs: ["ifc:GUID-B"],
        evidence_proof: "a4p.test.proof-b.deadbeef",
        proof_expires_at: "2026-07-17T04:00:00Z",
        issue_eligible: true,
        highlight_eligible: false,
      },
    ];
    const search = vi.spyOn(governanceClient, "searchModelForSession").mockResolvedValue(searchResponse({
      results: rows,
      stats: {
        total: 2,
        scanned: 2,
        matched: 2,
        not_matched: 0,
        returned: 2,
        mapped: 2,
        unmapped: 0,
        truncated: false,
      },
      issue_eligible: true,
      session_binding: {
        review_session_id: "review_session_b",
        principal_ref: "principal_test",
        primary_lease_capability: "verified",
      },
    }));
    let resolveFirstIssue!: (value: unknown) => void;
    const firstIssue = new Promise((resolve) => {
      resolveFirstIssue = resolve;
    });
    const createIssue = vi.spyOn(governanceClient, "createA4IssueForSession")
      .mockImplementationOnce(() => firstIssue as never)
      .mockRejectedValueOnce(new A4GovernanceError(409, "a4_proof_expired"));

    await mount();
    await waitFor(() => {
      expect((container.querySelector('[data-testid="a4-session-select"]') as HTMLSelectElement).value)
        .toBe("review_session_b");
    });
    await act(async () => {
      (container.querySelector('[data-testid="a4-run"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(search).toHaveBeenCalledWith(
      "review_session_b",
      expect.objectContaining({ interpret_mode: "auto" }),
    ));
    await waitFor(() => expect(container.querySelector('[data-testid="a4-select-row-GUID-A"]')).not.toBeNull());
    await act(async () => {
      (container.querySelector('[data-testid="a4-select-row-GUID-A"]') as HTMLInputElement).click();
      (container.querySelector('[data-testid="a4-select-row-GUID-B"]') as HTMLInputElement).click();
    });
    const title = container.querySelector('[data-testid="a4-issue-title"]') as HTMLInputElement;
    await waitFor(() => expect(title.value).toContain("Door A"));
    const preservedDraft = title.value;
    await act(async () => {
      (container.querySelector('[data-testid="a4-confirm-issue"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(1));
    expect((container.querySelector('[data-testid="a4-query-input"]') as HTMLTextAreaElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="a4-session-select"]') as HTMLSelectElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="a4-mode-semantic"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="a4-refresh-sources"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-testid="a4-select-row-GUID-A"]') as HTMLInputElement).disabled).toBe(true);
    await act(async () => {
      resolveFirstIssue({ issue: { id: "ISSUE-A4-1" }, replayed: false });
      await firstIssue;
    });
    await waitFor(() => expect(createIssue).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('[data-testid="a4-issue-outcomes"]')).not.toBeNull());

    expect(createIssue.mock.calls.map((call) => call[0])).toEqual(["review_session_b", "review_session_b"]);
    expect(createIssue.mock.calls.map((call) => call[1].evidence_proof)).toEqual([
      "a4p.test.proof-a.deadbeef",
      "a4p.test.proof-b.deadbeef",
    ]);
    expect(container.textContent).toContain("ISSUE-A4-1");
    expect(container.textContent).toContain("proof");
    expect(container.textContent).toContain("1 列成功、1 列失敗");
    expect(title.value).toBe(preservedDraft);
    expect((container.querySelector('[data-testid="a4-session-select"]') as HTMLSelectElement).disabled).toBe(false);
  });

  it("invalidates proof rows, partial actions, and drafts when the session context changes", async () => {
    const search = vi.spyOn(governanceClient, "searchModelForSession").mockResolvedValue(searchResponse({
      results: [{
        ifc_guid: "GUID-A",
        usd_prim_path: "/World/A",
        ifc_class: "IfcDoor",
        name: "Door A",
        storey: "4F",
        properties: {},
        match_status: "matched_query",
        confidence: 1,
        evidence_refs: ["ifc:GUID-A"],
        evidence_proof: "a4p.test.proof-a.deadbeef",
        proof_expires_at: "2026-07-17T04:00:00Z",
        issue_eligible: true,
        highlight_eligible: false,
      }],
      stats: {
        total: 1,
        scanned: 1,
        matched: 1,
        not_matched: 0,
        returned: 1,
        mapped: 1,
        unmapped: 0,
        truncated: false,
      },
      issue_eligible: true,
      session_binding: {
        review_session_id: "review_session_b",
        principal_ref: "principal_test",
        primary_lease_capability: "verified",
      },
    }));
    const createIssue = vi.spyOn(governanceClient, "createA4IssueForSession");

    await mount();
    await act(async () => {
      (container.querySelector('[data-testid="a4-run"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('[data-testid="a4-select-row-GUID-A"]')).not.toBeNull());
    await act(async () => {
      (container.querySelector('[data-testid="a4-select-row-GUID-A"]') as HTMLInputElement).click();
    });
    const title = container.querySelector('[data-testid="a4-issue-title"]') as HTMLInputElement;
    await waitFor(() => expect(title.value).toContain("Door A"));

    const sessionSelect = container.querySelector('[data-testid="a4-session-select"]') as HTMLSelectElement;
    await act(async () => {
      sessionSelect.value = "review_session_a";
      sessionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => expect(container.querySelector('[data-testid="a4-select-row-GUID-A"]')).toBeNull());
    expect(container.querySelector('[data-testid="a4-issue-draft"]')).toBeNull();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("keeps session results across unrelated job refreshes and disables Issue creation when the session becomes inactive", async () => {
    vi.mocked(coordinatorClient.runtimeStatus)
      .mockResolvedValueOnce(ACTIVE_SESSIONS)
      .mockResolvedValueOnce(ACTIVE_SESSIONS)
      .mockResolvedValueOnce({
        sessions: { items: [{ session_id: "review_session_a", status: "active" }] },
      } as never);
    vi.mocked(coordinatorClient.listIfcReady)
      .mockResolvedValueOnce({ count: 0, items: [] })
      .mockResolvedValue({
        count: 1,
        items: [{ ifc_ready_job_id: "ifc_job_new", conversion_status: "ready" }],
      } as never);
    vi.spyOn(governanceClient, "searchModelForSession").mockResolvedValue(searchResponse({
      results: [{
        ifc_guid: "GUID-A",
        usd_prim_path: "/World/A",
        ifc_class: "IfcDoor",
        name: "Door A",
        storey: "4F",
        properties: {},
        match_status: "matched_query",
        confidence: 1,
        evidence_refs: ["ifc:GUID-A"],
        evidence_proof: "a4p.test.proof-a.deadbeef",
        proof_expires_at: "2026-07-17T04:00:00Z",
        issue_eligible: true,
        highlight_eligible: false,
      }],
      stats: {
        total: 1,
        scanned: 1,
        matched: 1,
        not_matched: 0,
        returned: 1,
        mapped: 1,
        unmapped: 0,
        truncated: false,
      },
      issue_eligible: true,
      session_binding: {
        review_session_id: "review_session_b",
        principal_ref: "principal_test",
        primary_lease_capability: "verified",
      },
    }));
    const createIssue = vi.spyOn(governanceClient, "createA4IssueForSession");

    await mount();
    await act(async () => {
      (container.querySelector('[data-testid="a4-run"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(container.querySelector('[data-testid="a4-select-row-GUID-A"]')).not.toBeNull());
    await act(async () => {
      (container.querySelector('[data-testid="a4-select-row-GUID-A"]') as HTMLInputElement).click();
    });
    const title = container.querySelector('[data-testid="a4-issue-title"]') as HTMLInputElement;
    const confirm = container.querySelector('[data-testid="a4-confirm-issue"]') as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));

    await act(async () => {
      (container.querySelector('[data-testid="a4-refresh-sources"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(coordinatorClient.listIfcReady).toHaveBeenCalledTimes(2));
    expect(container.querySelector('[data-testid="a4-select-row-GUID-A"]')).not.toBeNull();
    expect(title.value).toContain("Door A");
    expect(confirm.disabled).toBe(false);

    await act(async () => {
      (container.querySelector('[data-testid="a4-refresh-sources"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(container.querySelector('[data-testid="a4-session-unavailable"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="a4-select-row-GUID-A"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="a4-select-row-GUID-A"]') as HTMLInputElement).disabled).toBe(true);
    expect(title.value).toContain("Door A");
    expect(confirm.disabled).toBe(true);
    await act(async () => confirm.click());
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("keeps query and mode while giving actionable recovery for an expired partial confirmation", async () => {
    vi.spyOn(governanceClient, "searchModelForSession").mockResolvedValue(searchResponse({
      status: "partial_fallback_confirmation_required",
      partial_fallback_id: "a4pf_component_test",
      partial_confirmation_available: true,
      issue_eligible: false,
    }));
    const confirm = vi.spyOn(governanceClient, "confirmModelSearchPartialForSession")
      .mockRejectedValue(new A4GovernanceError(409, "partial_fallback_unavailable"));

    await mount();
    const originalQuery = (container.querySelector('[data-testid="a4-query-input"]') as HTMLTextAreaElement).value;
    await act(async () => {
      (container.querySelector('[data-testid="a4-run"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(
      (container.querySelector('[data-testid="a4-confirm-partial"]') as HTMLButtonElement).disabled,
    ).toBe(false));
    await act(async () => {
      (container.querySelector('[data-testid="a4-confirm-partial"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("review_session_b", "a4pf_component_test"));

    expect(container.textContent).toContain("請重新執行原查詢");
    expect((container.querySelector('[data-testid="a4-query-input"]') as HTMLTextAreaElement).value).toBe(originalQuery);
    expect(container.querySelector('[data-testid="a4-mode-auto"]')?.className).toContain("primary");
    expect(container.querySelectorAll('[data-testid^="a4-select-row-"]')).toHaveLength(0);
    expect((container.querySelector('[data-testid="a4-confirm-partial"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      (container.querySelector('[data-testid="a4-confirm-partial"]') as HTMLButtonElement).click();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("shows retry-later instead of zero-results when partial confirmation capacity is unavailable", async () => {
    const search = vi.spyOn(governanceClient, "searchModelForSession")
      .mockResolvedValue(searchResponse({
        status: "partial_fallback_unavailable",
        query_id: "a4q_capacity",
        retryable: true,
        error_code: "partial_confirmation_capacity_unavailable",
        partial_confirmation_available: false,
        partial_fallback_id: null,
      }));

    await mount();
    const originalQuery = (container.querySelector('[data-testid="a4-query-input"]') as HTMLTextAreaElement).value;
    await act(async () => {
      (container.querySelector('[data-testid="a4-run"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.textContent).toContain("容量暫時不可用"));
    expect(container.textContent).not.toContain("0 筆結果");
    expect((container.querySelector('[data-testid="a4-retry"]') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      (container.querySelector('[data-testid="a4-retry"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search).toHaveBeenLastCalledWith(
      "review_session_b",
      expect.objectContaining({
        query: originalQuery,
        interpret_mode: "auto",
        retry_of_query_id: "a4q_capacity",
      }),
    );
  });

  it("normalizes stale available model status to unknown", async () => {
    vi.mocked(governanceClient.searchLlmStatus).mockResolvedValue({
      service: "a4-search-llm",
      enabled: true,
      configured: true,
      state: "available",
      model: "Ornith-1.0-35B",
      checked_at: "2026-07-17T03:00:00Z",
      check_source: "query_observation",
      freshness: "stale",
      ttl_s: 0,
      transport_class: "loopback_tunnel",
      error_code: null,
    });
    await mount();
    await waitFor(() => expect(fieldValue("state")).toContain("unknown"));
    expect(fieldValue("state")).not.toContain("available");
  });

  it("keeps the newest LLM observation when an older status request resolves last", async () => {
    let resolveOlder!: (value: unknown) => void;
    const olderRequest = new Promise((resolve) => {
      resolveOlder = resolve;
    });
    const statusRequest = vi.mocked(governanceClient.searchLlmStatus)
      .mockImplementationOnce(() => olderRequest as never)
      .mockResolvedValueOnce({
        service: "a4-search-llm",
        enabled: true,
        configured: true,
        state: "unavailable",
        model: "Ornith-1.0-35B",
        checked_at: "2026-07-17T03:01:00Z",
        check_source: "query_observation",
        freshness: "fresh",
        ttl_s: 30,
        transport_class: "loopback_tunnel",
        error_code: "llm_transport_failed",
      });

    await mount();
    await waitFor(() => expect(statusRequest).toHaveBeenCalledTimes(1));
    await act(async () => {
      (container.querySelector('[data-testid="a4-refresh-sources"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(statusRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fieldValue("state")).toMatch(/^unavailable\b/));

    await act(async () => {
      resolveOlder({
        service: "a4-search-llm",
        enabled: true,
        configured: true,
        state: "available",
        model: "Ornith-1.0-35B",
        checked_at: "2026-07-17T03:00:00Z",
        check_source: "query_observation",
        freshness: "fresh",
        ttl_s: 30,
        transport_class: "loopback_tunnel",
        error_code: null,
      });
      await olderRequest;
    });

    expect(fieldValue("state")).toMatch(/^unavailable\b/);
  });

  it("keeps the newest source snapshot when an older refresh resolves last", async () => {
    let resolveOlder!: (value: unknown) => void;
    const olderRequest = new Promise((resolve) => {
      resolveOlder = resolve;
    });
    const runtimeStatus = vi.mocked(coordinatorClient.runtimeStatus)
      .mockImplementationOnce(() => olderRequest as never)
      .mockResolvedValueOnce({
        sessions: { items: [{ session_id: "review_session_a", status: "active" }] },
      } as never);

    await mount();
    await waitFor(() => expect(runtimeStatus).toHaveBeenCalledTimes(1));
    await act(async () => {
      (container.querySelector('[data-testid="a4-refresh-sources"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(runtimeStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector('[data-testid="a4-session-unavailable"]')).not.toBeNull());

    await act(async () => {
      resolveOlder(ACTIVE_SESSIONS);
      await olderRequest;
    });

    expect(container.querySelector('[data-testid="a4-session-unavailable"]')).not.toBeNull();
    expect((container.querySelector('[data-testid="a4-session-select"]') as HTMLSelectElement).value)
      .toBe("review_session_b");
  });

  it("treats ttl_s as remaining lifetime from response receipt and expires state plus freshness together", async () => {
    const checkedAtMs = Date.parse("2026-07-17T03:00:00Z");
    const receivedAtMs = checkedAtMs + 30_000;
    const status = {
      service: "a4-search-llm",
      enabled: true,
      configured: true,
      state: "available",
      model: "Ornith-1.0-35B",
      checked_at: "2026-07-17T03:00:00Z",
      check_source: "query_observation",
      freshness: "fresh",
      ttl_s: 30,
      transport_class: "loopback_tunnel",
      error_code: null,
    } as const;

    expect(normalizedLlmReadiness(status, receivedAtMs + 29_999, receivedAtMs)).toBe("available");
    expect(normalizedLlmReadiness(status, receivedAtMs + 30_001, receivedAtMs)).toBe("unknown");

    vi.mocked(governanceClient.searchLlmStatus).mockResolvedValue({
      ...status,
      ttl_s: 1,
    });
    await mount();
    await waitFor(() => expect(fieldValue("state")).toContain("available"));
    await waitFor(() => {
      expect(fieldValue("state")).toContain("unknown");
      expect(fieldValue("freshness")).toContain("stale");
    }, 2_000);
  });
});
