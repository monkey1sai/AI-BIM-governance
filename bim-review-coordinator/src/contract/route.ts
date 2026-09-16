// Coordinator Browser Contract — route declaration.
//
// A RouteContract is the whole interface of one browser-facing route: path,
// method, path/query parameters, request body and every response status with
// its payload. openapi.ts turns the list into an OpenAPI 3.1 document; PR2 will
// mount express handlers from the same declarations so the two can never drift.
import { z } from "zod/v4";

export type HttpMethod = "get" | "post" | "put" | "delete";

export type ResponseMap = Readonly<Record<number, z.ZodType>>;

export interface RouteContract<
  Params extends z.ZodObject | undefined = z.ZodObject | undefined,
  Query extends z.ZodObject | undefined = z.ZodObject | undefined,
  Body extends z.ZodType | undefined = z.ZodType | undefined,
  Responses extends ResponseMap = ResponseMap,
> {
  /** Stable OpenAPI operationId; also the generated client method name. */
  readonly operationId: string;
  readonly method: HttpMethod;
  /** OpenAPI path template, e.g. `/api/review-sessions/{sessionId}`. */
  readonly path: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly params?: Params;
  readonly query?: Query;
  readonly body?: Body;
  readonly responses: Responses;
  /** Routes that require operator/session authentication headers. Documentation only in PR1. */
  readonly auth?: "none" | "user" | "operator" | "external";
}

export function defineRoute<
  Params extends z.ZodObject | undefined,
  Query extends z.ZodObject | undefined,
  Body extends z.ZodType | undefined,
  Responses extends ResponseMap,
>(route: RouteContract<Params, Query, Body, Responses>): RouteContract<Params, Query, Body, Responses> {
  if (!/^\/api\//.test(route.path)) throw new Error(`contract path must start with /api/: ${route.path}`);
  if (/:[A-Za-z]/.test(route.path)) throw new Error(`contract path must use {param}, not :param: ${route.path}`);
  const declared = new Set(pathParamNames(route.path));
  const provided = new Set(route.params ? Object.keys(route.params.shape) : []);
  for (const name of declared) {
    if (!provided.has(name)) throw new Error(`${route.operationId}: path param {${name}} has no schema`);
  }
  for (const name of provided) {
    if (!declared.has(name)) throw new Error(`${route.operationId}: params schema declares ${name} which is not in the path`);
  }
  return route;
}

export function pathParamNames(path: string): string[] {
  return Array.from(path.matchAll(/\{([A-Za-z0-9_]+)\}/g), (m) => m[1]);
}

/** `/api/x/{id}` → `/api/x/:id` for express mounting (PR2). */
export function toExpressPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1");
}

// ── Type-level accessors for generated/typed clients ──────────────────────────
export type RouteBody<R extends RouteContract> = R["body"] extends z.ZodType ? z.output<R["body"]> : never;
export type RouteResponse<R extends RouteContract, S extends keyof R["responses"]> =
  R["responses"][S] extends z.ZodType ? z.output<R["responses"][S]> : never;
