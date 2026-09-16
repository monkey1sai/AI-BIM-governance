// Coordinator Browser Contract — response validation at the express seam.
//
// One installation point instead of 35 handler edits: every JSON response sent
// from a route that the contract declares is checked against the declared
// schema for that status. "Declared A, sent B" — the class of defect that
// motivated the contract — becomes observable here.
//
//   mode "enforce"  (NODE_ENV=test)  → replace the response with 500 contract_violation
//   mode "observe"  (development)    → report via onViolation, send the original body
//   mode "off"      (production)     → nothing is installed; zero runtime cost
import type express from "express";
import type { z } from "zod/v4";
import { browserContract } from "./browserContract.js";
import { toExpressPath, type RouteContract } from "./route.js";

export type ContractValidationMode = "enforce" | "observe" | "off";

export interface ContractViolation {
  operationId: string;
  method: string;
  path: string;
  status: number;
  reason: "undeclared_status" | "body_mismatch";
  issues: Array<{ path: string; message: string }>;
}

export interface InstallContractResponseValidationOptions {
  mode: ContractValidationMode;
  onViolation?: (violation: ContractViolation) => void;
}

/** Express param names differ from OpenAPI names (`:id` vs `{ifcReadyJobId}`); match on shape only. */
export function normalizeExpressPath(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, ":p").replace(/\/+$/, "") || "/";
}

const routeIndex = new Map<string, RouteContract>();
for (const route of browserContract) {
  const key = `${route.method.toUpperCase()} ${normalizeExpressPath(toExpressPath(route.path))}`;
  if (routeIndex.has(key)) throw new Error(`Coordinator Browser Contract declares ${key} twice`);
  routeIndex.set(key, route);
}

export function resolveContractRoute(method: string, expressPath: string): RouteContract | undefined {
  return routeIndex.get(`${method.toUpperCase()} ${normalizeExpressPath(expressPath)}`);
}

export function contractValidationModeFromEnv(env: NodeJS.ProcessEnv = process.env): ContractValidationMode {
  const explicit = env.CONTRACT_RESPONSE_VALIDATION;
  if (explicit === "enforce" || explicit === "observe" || explicit === "off") return explicit;
  if (env.NODE_ENV === "test") return "enforce";
  if (env.NODE_ENV === "production") return "off";
  return "observe";
}

function issuesOf(error: z.ZodError): ContractViolation["issues"] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
}

export function installContractResponseValidation(
  app: express.Express,
  options: InstallContractResponseValidationOptions,
): void {
  if (options.mode === "off") return;
  const mode = options.mode;
  app.use((request, response, next) => {
    const originalJson = response.json.bind(response);
    const guardedJson: typeof response.json = (body?: unknown) => {
      const routePath = (request as express.Request & { route?: { path?: unknown } }).route?.path;
      if (typeof routePath !== "string") return originalJson(body);
      const route = resolveContractRoute(request.method, routePath);
      if (!route) return originalJson(body);
      const status = response.statusCode;
      const schema = route.responses[status];
      let violation: ContractViolation | null = null;
      if (!schema) {
        // Uncaught handler errors surface as 500 through the global handler; only flag
        // 500 when the contract explicitly declares it, so the original failure stays visible.
        if (status !== 500) {
          violation = {
            operationId: route.operationId, method: request.method, path: routePath, status,
            reason: "undeclared_status", issues: [{ path: "", message: `status ${status} is not declared for ${route.operationId}` }],
          };
        }
      } else {
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          violation = {
            operationId: route.operationId, method: request.method, path: routePath, status,
            reason: "body_mismatch", issues: issuesOf(parsed.error),
          };
        }
      }
      if (!violation) return originalJson(body);
      options.onViolation?.(violation);
      if (mode === "enforce") {
        response.status(500);
        return originalJson({
          error_code: "contract_violation",
          detail: `${route.operationId} ${status} response does not match the Coordinator Browser Contract`,
          contract_violation: violation,
        });
      }
      return originalJson(body);
    };
    response.json = guardedJson;
    next();
  });
}
