// Coordinator Browser Contract — response validation seam.
// Exercises the installer through a minimal express app so the behaviour is pinned
// independently of the 35 real routes: enforce rewrites to 500, observe reports and
// passes through, undeclared statuses are flagged, non-contract routes are untouched.
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  contractValidationModeFromEnv,
  installContractResponseValidation,
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
  installContractResponseValidation(app, { mode, onViolation: (violation) => sink.push(violation) });
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
  app.get("/not-in-contract", (_request, response) => {
    response.status(299).json({ anything: true });
  });
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ detail: "original failure" });
  });
  return app;
}

describe("Coordinator Browser Contract response validation", () => {
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

  it("enforce: a conforming body passes through untouched", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/api/runtime/session-idle-policy");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(VALID_POLICY);
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

  it("enforce: an uncaught handler error keeps its original 500 body", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/api/review-sessions/s/idle-status");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: "original failure" });
    expect(sink).toHaveLength(0);
  });

  it("observe: reports the violation but sends the original body", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("observe", sink)).get("/api/review-sessions/review_session_x");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session_id: "review_session_x" });
    expect(sink).toHaveLength(1);
  });

  it("routes outside the contract are never touched", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("enforce", sink)).get("/not-in-contract");
    expect(response.status).toBe(299);
    expect(response.body).toEqual({ anything: true });
    expect(sink).toHaveLength(0);
  });

  it("off: installs nothing", async () => {
    const sink: ContractViolation[] = [];
    const response = await request(buildApp("off", sink)).get("/api/review-sessions/review_session_x");
    expect(response.status).toBe(200);
    expect(sink).toHaveLength(0);
  });
});
