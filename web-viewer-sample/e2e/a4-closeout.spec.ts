import { expect, test, type Page, type Route } from "@playwright/test";

// Deterministic browser-contract coverage for the canonical A4 surface.  These
// tests intentionally intercept the coordinator at its public API boundary: they
// prove that the browser neither accepts host paths nor calls an internal service.
// They are not a substitute for the separately required authenticated live-lab
// session/lease/model evidence.
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

type StubResponse = {
  status?: number;
  body: Record<string, unknown>;
};

const activeSession = {
  session_id: "review-session-a4",
  status: "active",
  project_id: "project-a4",
  model_version_id: "model-a4",
  participant_count: 1,
  expected_stage_url: null,
  conversion_status: "ready",
  kit_instance_ids: [],
  created_at: "2026-07-16T00:00:00Z",
  updated_at: "2026-07-16T00:00:00Z",
};

const interpretedFilters = (rawQuery: string) => ({
  raw_query: rawQuery,
  ifc_classes: ["IfcDoor"],
  storey_tokens: [],
  property_filters: [],
  name_contains: [],
  unmatched_fragments: [],
  unresolved_terms: [],
  validation_errors: [],
  consumed_spans: [],
  interpretable: true,
  schema_valid: true,
  usable: true,
  complete: true,
  notes: [],
  interpret_source: "deterministic",
  confidence: 1,
  confidence_basis: "deterministic_grammar",
});

function searchResponse(queryId: string, scope: "session_table_only" | "ifc_ready_table_only" = "session_table_only"): Record<string, unknown> {
  const query = "IfcDoor";
  return {
    status: "ok",
    query_id: queryId,
    retry_of_query_id: null,
    model_version_id: "model-a4",
    interpret_mode: "deterministic",
    interpreted_filters: interpretedFilters(query),
    results: [{
      ifc_guid: "A4-DOOR-001",
      usd_prim_path: null,
      ifc_class: "IfcDoor",
      name: "4F 防火門",
      storey: "4F",
      properties: {},
      match_status: "matched_query",
      confidence: 1,
      confidence_basis: "deterministic_grammar",
      evidence_refs: ["class:IfcDoor"],
      mapping_observed: false,
      action_eligible: false,
      highlight_eligible: false,
    }],
    stats: { total: 1, scanned: 1, matched: 1, not_matched: 0, returned: 1, mapped: 0, unmapped: 1, truncated: false },
    evidence_refs: [{ kind: "interpreter", version: "deterministic_filter_v2" }],
    model_invocation: { attempted: false, served_model: null, finish_reason: null, latency_ms: null, error_code: null },
    session_binding: scope === "session_table_only" ? {
      review_session_id: activeSession.session_id,
      principal_ref: "a4p_test_opaque",
      model_version_id: "model-a4",
      primary_artifact_id: "artifact-a4",
      active_binding_revision: null,
      mapping_provenance: "unavailable",
      primary_lease_capability: "lab_unverified",
    } : null,
    search_scope: scope,
    completion_scope: "complete_table",
    proof_eligible: false,
    issue_eligible: false,
    highlight_eligible: false,
    next_step: null,
  };
}

function semanticErrorResponse(queryId: string): Record<string, unknown> {
  return {
    ...searchResponse(queryId),
    status: "semantic_error",
    results: [],
    stats: { total: 0, scanned: 0, matched: 0, not_matched: 0, returned: 0, mapped: 0, unmapped: 0, truncated: false },
    error_code: "llm_timeout",
    retryable: true,
  };
}

async function fulfillJson(route: Route, response: StubResponse): Promise<void> {
  await route.fulfill({
    status: response.status ?? 200,
    contentType: "application/json",
    body: JSON.stringify(response.body),
  });
}

async function installA4CoordinatorStubs(
  page: Page,
  options: {
    sessionResponses?: StubResponse[];
    ifcReadyResponses?: StubResponse[];
  } = {},
) {
  const sessionRequests: Record<string, unknown>[] = [];
  const ifcReadyRequests: Record<string, unknown>[] = [];
  const sessionResponses = options.sessionResponses ?? [{ body: searchResponse("a4q_e2e_complete") }];
  const ifcReadyResponses = options.ifcReadyResponses ?? [{ body: searchResponse("a4q_e2e_ifc_ready", "ifc_ready_table_only") }];
  let sessionIndex = 0;
  let ifcReadyIndex = 0;

  await page.route("**/api/runtime/status", async (route) => {
    await fulfillJson(route, {
      body: { sessions: { count: 1, active_count: 1, participant_count: 1, items: [activeSession] } },
    });
  });
  await page.route("**/api/external/ifc-ready**", async (route) => {
    await fulfillJson(route, {
      body: {
        count: 1,
        items: [{ ifc_ready_job_id: "ifc-ready-a4", status: "ready", conversion_status: "ready" }],
      },
    });
  });
  await page.route("**/api/governance/search/llm-status", async (route) => {
    await fulfillJson(route, {
      body: {
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
      },
    });
  });
  await page.route("**/api/governance/search/model/for-session/**", async (route) => {
    sessionRequests.push(JSON.parse(route.request().postData() || "{}") as Record<string, unknown>);
    const response = sessionResponses[Math.min(sessionIndex, sessionResponses.length - 1)];
    sessionIndex += 1;
    await fulfillJson(route, response);
  });
  await page.route("**/api/governance/search/model/for-ifc-ready/**", async (route) => {
    ifcReadyRequests.push(JSON.parse(route.request().postData() || "{}") as Record<string, unknown>);
    const response = ifcReadyResponses[Math.min(ifcReadyIndex, ifcReadyResponses.length - 1)];
    ifcReadyIndex += 1;
    await fulfillJson(route, response);
  });

  return { sessionRequests, ifcReadyRequests };
}

test.describe("A4 canonical browser contract", () => {
  test("legacy A4 routes scrub URL-carried data and render one session-first table-only surface", async ({ page }) => {
    await installA4CoordinatorStubs(page);

    for (const legacyRoute of [
      "/#a4?query=IfcDoor&usd_prim_path=%2FRoot",
      "/#semantic-search?evidence_proof=opaque-proof",
      "/#app/ai-search?ifc_guid=A4-DOOR-001",
      "/#workspace?dock=a4&a4_handoff=opaque",
    ]) {
      await page.goto(legacyRoute);
      await expect(page).toHaveURL(/#workspace\?dock=a4$/);
      await expect(page.getByTestId("a4-semantic-search-page")).toBeVisible();
    }

    await expect(page.getByTestId("a4-source-session")).toBeVisible();
    await expect(page.getByTestId("a4-source-ifc_ready")).toBeVisible();
    await expect(page.getByTestId("a4-source-ifc_ready")).toBeDisabled();
    await expect(page.getByTestId("a4-ifc-ready-unavailable")).toContainText("ifc-ready");
    await expect(page.getByTestId("a4-table-only")).toBeVisible();
    await expect(page.getByTestId("a4-results-table")).toContainText("無列");
    await expect(page.getByTestId("a4-source-path")).toHaveCount(0);
    await expect(page.getByTestId("a4-path-input")).toHaveCount(0);
    await expect(page.getByTestId("a4-select-all")).toHaveCount(0);
    await expect(page.getByTestId("a4-create-issues")).toHaveCount(0);
    await expect(page.locator('[data-testid*="handoff"], [data-testid*="highlight"]')).toHaveCount(0);
    await expect(page.getByText("符合 7", { exact: true })).toHaveCount(0);
    await expect(page.getByText("不符合 5", { exact: true })).toHaveCount(0);
  });

  test("session query sends only allowlisted controls to the coordinator and renders query-match rows", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
    });
    const probes = await installA4CoordinatorStubs(page);

    await page.goto("/#workspace?dock=a4");
    await expect(page.getByTestId("a4-run")).toBeEnabled();
    await page.getByTestId("a4-mode-deterministic").click();
    await page.getByTestId("a4-run").click();

    await expect(page.locator("body")).toContainText("a4q_e2e_complete");
    await expect(page.getByTestId("a4-results-table")).toContainText("符合查詢條件");
    expect(probes.sessionRequests).toHaveLength(1);
    expect(Object.keys(probes.sessionRequests[0]).sort()).toEqual(["interpret_mode", "query"]);
    expect(probes.sessionRequests[0].interpret_mode).toBe("deterministic");
    expect(JSON.stringify(probes.sessionRequests[0])).not.toMatch(/ifc_source_path|element_mapping_path|usd_prim_path|ifc_guid|lease|actor/i);

    const coordinatorOrigin = new URL(COORDINATOR).origin;
    expect(apiCalls.every((url) => new URL(url).origin === coordinatorOrigin)).toBe(true);
    expect(apiCalls.some((url) => url.includes("/api/governance/search/model/for-session/review-session-a4"))).toBe(true);
    expect(apiCalls.some((url) => /\/api\/governance\/search\/model(?:$|\?)/.test(new URL(url).pathname))).toBe(false);
  });

  test("retry keeps the explicit query/mode and correlates only a retryable semantic failure", async ({ page }) => {
    const probes = await installA4CoordinatorStubs(page, {
      sessionResponses: [
        { body: semanticErrorResponse("a4q_e2e_retry_parent") },
        { body: searchResponse("a4q_e2e_retry_child") },
      ],
    });

    await page.goto("/#workspace?dock=a4");
    await page.getByTestId("a4-mode-semantic").click();
    await page.getByTestId("a4-run").click();
    await expect(page.getByTestId("a4-run-err")).toContainText("llm_timeout");
    await expect(page.getByTestId("a4-retry")).toBeEnabled();
    await page.getByTestId("a4-retry").click();

    await expect(page.locator("body")).toContainText("a4q_e2e_retry_child");
    expect(probes.sessionRequests).toHaveLength(2);
    expect(probes.sessionRequests[0].interpret_mode).toBe("semantic");
    expect(probes.sessionRequests[1]).toMatchObject({
      query: probes.sessionRequests[0].query,
      interpret_mode: "semantic",
      retry_of_query_id: "a4q_e2e_retry_parent",
    });
  });

  test("unsupported ifc-ready compatibility remains disabled and an unavailable session returns only a safe error", async ({ page }) => {
    const probes = await installA4CoordinatorStubs(page, {
      sessionResponses: [{
        status: 401,
        body: { error_code: "a4_authentication_required", detail: "must never be rendered" },
      }],
    });

    await page.goto("/#workspace?dock=a4");
    await page.getByTestId("a4-run").click();
    await expect(page.getByTestId("a4-run-err")).toContainText("已登入");
    await expect(page.getByText("must never be rendered", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("a4-results-table")).toContainText("無列");

    await expect(page.getByTestId("a4-source-ifc_ready")).toBeDisabled();
    await expect(page.getByTestId("a4-ifc-ready-unavailable")).toContainText("ifc-ready");
    expect(probes.ifcReadyRequests).toHaveLength(0);
  });
});
