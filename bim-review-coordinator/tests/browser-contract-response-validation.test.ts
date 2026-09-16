// Coordinator Browser Contract — response seam.
// Exercises the installer through a minimal express app so the behaviour is pinned
// independently of the 35 real routes: error_code injection in every mode (including
// "off"), enforce rewriting to 500, observe reporting and passing through, undeclared
// statuses being flagged, and non-contract routes being left alone.
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { deriveErrorCode, knownErrorCodes, STATUS_ERROR_CODES } from "../src/contract/errorCodes.js";
import {
  contractValidationModeFromEnv,
  installContractResponseSeam,
  normalizeExpressPath,
  resolveContractRoute,
  type ContractViolation,
} from "../src/contract/responseValidation.js";

const VALID_POLICY = {
  enabled: true,
  timeout_ms: 60_000,
  source: "env",
  revision: 3,
  process_epoch: "0123456789abcdef0123456789abcdef",
  countdown_seconds: 30,
  apply_mode: "live_process",
  restart_behavior: "environment_value_restored",
  active_session_behavior: "ready_sessions_restart_idle_clock",
};

function buildApp(mode: "enforce" | "observe" | "off", sink: ContractViolation[]) {
  const app = express();
  installContractResponseSeam(app, { mode, onViolation: (violation) => sink.push(violation) });
  app.get("/api/runtime/session-idle-policy", (_request, response) => {
    response.json(VALID_POLICY);
  });
  app.get("/api/review-sessions/:anyName", (_request, response) => {
    // Wrong shape on purpose: missing every required ReviewSession field.
    response.json({ session_id: "review_session_x" });
  });
  app.get("/api/review-sessions/:sid/stream-config", (_request, response) => {
    response.status(418).json({ detail: "teapot" });
  });
  app.get("/api/review-sessions/:sid/idle-status", (_request, _response, next) => {
    next(new Error("boom"));
  });
  // Declared 404 on a contract route, with a detail the table maps.
  app.get("/api/external/ifc-ready/:jobId", (_request, response) => {
    response.status(404).json({ detail: "IFC-ready job not found." });
  });
  app.get("/not-in-contract", (_request, response) => {
    response.status(299).json({ anything: true });
  });
  app.get("/not-in-contract/fails", (_request, response) => {
    response.status(404).json({ detail: "dev routes disabled" });
  });
  app.get("/not-in-contract/already-coded", (_request, response) => {
    response.status(409).json({ error_code: "a4_handoff_not_eligible", detail: "kept as-is" });
  });
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ detail: "original failure" });
  });
  return app;
}

describe("Coordinator Browser Contract error_code derivation", () => {
  it("leaves a body that already carries a valid error_code alone", () => {
    expect(deriveErrorCode(400, { error_code: "invalid_ids_path", detail: "x" })).toBeNull();
  });

  it("harvests the snake_case `error` genre as the code", () => {
    expect(deriveErrorCode(502, { error: "governance_unreachable" })).toBe("governance_unreachable");
    expect(deriveErrorCode(409, { error: "issue_snapshot_source_mismatch" })).toBe("issue_snapshot_source_mismatch");
  });

  it("harvests a snake_case `detail` as the code", () => {
    expect(deriveErrorCode(503, { detail: "production_identity_unavailable" })).toBe("production_identity_unavailable");
    expect(deriveErrorCode(409, { detail: "stage_binding_transaction_not_abortable" }))
      .toBe("stage_binding_transaction_not_abortable");
  });

  it("maps prose detail through the table", () => {
    expect(deriveErrorCode(400, { detail: "Invalid review session id." })).toBe("invalid_session_id");
    expect(deriveErrorCode(404, { detail: "Review session not found." })).toBe("review_session_not_found");
    expect(deriveErrorCode(404, { detail: "dev routes disabled" })).toBe("dev_routes_disabled");
  });

  it("falls back to the generic status code, never inventing a cause", () => {
    expect(deriveErrorCode(404, { detail: "Some unmapped one-off message." })).toBe("not_found");
    expect(deriveErrorCode(409, { detail: "Another unmapped one." })).toBe("conflict");
    // zod flatten() puts an object in `detail`; there is no literal to map.
    expect(deriveErrorCode(400, { detail: { formErrors: [], fieldErrors: {} } })).toBe("bad_request");
  });

  it("never touches success responses or non-object bodies", () => {
    expect(deriveErrorCode(200, { ok: true })).toBeNull();
    expect(deriveErrorCode(201, { session_id: "s" })).toBeNull();
    expect(deriveErrorCode(404, "plain string")).toBeNull();
    expect(deriveErrorCode(404, null)).toBeNull();
    expect(deriveErrorCode(404, [{ detail: "x" }])).toBeNull();
  });

  it("every emitted code matches the contract's error_code pattern", () => {
    for (const code of knownErrorCodes()) expect(code).toMatch(/^[a-z0-9_]{1,64}$/);
    expect(knownErrorCodes().length).toBeGreaterThan(40);
  });

  it("covers every status the contract declares for errors", () => {
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 501, 502, 503]) {
      expect(STATUS_ERROR_CODES[status], `status ${status}`).toBeTruthy();
    }
  });
});

describe("Coordinator Browser Contract response seam", () => {
  it("normalizes express param names so :id and :sessionId match the same contract path", () => {
    expect(normalizeExpressPath("/api/conversion/jobs/:id/prioritize")).toBe("/api/conversion/jobs/:p/prioritize");
    expect(resolveContractRoute("POST", "/api/conversion/jobs/:id/prioritize")?.operationId).toBe("prioritizeConversionJob");
    expect(resolveContractRoute("GET", "/api/review-sessions/:closedSessionId")?.operationId).toBe("getReviewSession");
    expect(resolveContractRoute("GET", "/health")).toBeUndefined();
  });

  it("derives the mode from NODE_ENV with an explicit override", () => {
    expect(contractValidationModeFromEnv({ NODE_ENV: "test" })).toBe("enforce");
    expect(contractValidationModeFromEnv({ NODE_ENV: "production" })).toBe("off");
    expect(contractValidationModeFromEnv({ NODE_ENV: "development" })).toBe("observe");
    expect(contractValidationModeFromEnv({})).toBe("observe");
    expect(contractValidationModeFromEnv({ NODE_ENV: "test", CONTRACT_RESPONSE_VALIDATION: "off" })).toBe("off");
  });

  it("injects error_code on a declared error, additively", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/api/external/ifc-ready/job_1");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "IFC-ready job not found.", error_code: "ifc_ready_job_not_found" });
    expect(sink).toHaveLength(0);
  });

  it("injects on routes outside the contract too", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/not-in-contract/fails");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: "dev routes disabled", error_code: "dev_routes_disabled" });
    expect(sink).toHaveLength(0);
  });

  it("keeps an existing error_code untouched", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/not-in-contract/already-coded");
    expect(response.body).toEqual({ error_code: "a4_handoff_not_eligible", detail: "kept as-is" });
  });

  it("injects even when validation is off (production)", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("off", sink)).get("/not-in-contract/fails");
    expect(response.status).toBe(404);
    expect(response.body.error_code).toBe("dev_routes_disabled");
    expect(sink).toHaveLength(0);
  });

  it("never adds error_code to a success body", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/api/runtime/session-idle-policy");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(VALID_POLICY);
    expect(response.body).not.toHaveProperty("error_code");
    expect(sink).toHaveLength(0);
  });

  it("enforce: a body that does not match the declared schema becomes 500 contract_violation", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/api/review-sessions/review_session_x");
    expect(response.status).toBe(500);
    expect(response.body.error_code).toBe("contract_violation");
    expect(response.body.contract_violation.operationId).toBe("getReviewSession");
    expect(response.body.contract_violation.reason).toBe("body_mismatch");
    expect(sink).toHaveLength(1);
    expect(sink[0].issues.some((issue) => issue.path === "tenant_id")).toBe(true);
  });

  it("enforce: an undeclared status is a violation", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/api/review-sessions/s/stream-config");
    expect(response.status).toBe(500);
    expect(response.body.contract_violation.reason).toBe("undeclared_status");
    expect(response.body.contract_violation.status).toBe(418);
  });

  it("enforce: an uncaught handler error keeps its original 500 body, plus a code", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/api/review-sessions/s/idle-status");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: "original failure", error_code: "internal_error" });
    expect(sink).toHaveLength(0);
  });

  it("observe: reports the violation but sends the original body", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("observe", sink)).get("/api/review-sessions/review_session_x");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session_id: "review_session_x" });
    expect(sink).toHaveLength(1);
  });

  it("routes outside the contract are never validated", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/not-in-contract");
    expect(response.status).toBe(299);
    expect(response.body).toEqual({ anything: true });
    expect(sink).toHaveLength(0);
  });

  it("off: validation is skipped", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("off", sink)).get("/api/review-sessions/review_session_x");
    expect(response.status).toBe(200);
    expect(sink).toHaveLength(0);
  });
});
