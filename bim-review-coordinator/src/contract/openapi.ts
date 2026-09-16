// Coordinator Browser Contract — OpenAPI 3.1 emission.
//
// The document is the published form of the contract (tests/contracts/
// coordinator-browser-api-v1.openapi.json). zod stays the authoring form; nothing
// is hand-edited downstream. OpenAPI 3.1 embeds JSON Schema draft 2020-12, which is
// exactly what zod v4's toJSONSchema produces, so components are emitted verbatim.
import { z } from "zod/v4";
import { browserContract } from "./browserContract.js";
import { contractRegistry } from "./primitives.js";
import type { RouteContract } from "./route.js";

export const BROWSER_CONTRACT_ID = "coordinator-browser-api-v1";
export const BROWSER_CONTRACT_VERSION = "1.0.0";
export const BROWSER_CONTRACT_RELATIVE_PATH = `tests/contracts/${BROWSER_CONTRACT_ID}.openapi.json`;

type JsonObject = Record<string, unknown>;

const STATUS_DESCRIPTIONS: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  400: "Request rejected",
  401: "Authentication required",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  422: "Unprocessable",
  500: "Coordinator failure",
  502: "Upstream authority failed",
  503: "Authority unavailable",
};

function pascal(operationId: string): string {
  return operationId.charAt(0).toUpperCase() + operationId.slice(1);
}

function ensureNamed(schema: z.ZodType, fallbackId: string): string {
  const existing = contractRegistry.get(schema);
  if (existing) return existing.id;
  contractRegistry.add(schema, { id: fallbackId });
  return fallbackId;
}

function stripSchemaEnvelope(schema: JsonObject): JsonObject {
  const { $schema: _schema, $id: _id, ...rest } = schema;
  return rest;
}

function inlineJsonSchema(schema: z.ZodType): JsonObject {
  return stripSchemaEnvelope(z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
    io: "input",
  }) as JsonObject);
}

function ref(id: string): JsonObject {
  return { $ref: `#/components/schemas/${id}` };
}

function operationFor(route: RouteContract): JsonObject {
  const parameters: JsonObject[] = [];
  if (route.params) {
    for (const [name, schema] of Object.entries(route.params.shape)) {
      parameters.push({ name, in: "path", required: true, schema: inlineJsonSchema(schema as z.ZodType) });
    }
  }
  if (route.query) {
    const json = inlineJsonSchema(route.query);
    const required = new Set((json.required as string[] | undefined) ?? []);
    for (const [name, schema] of Object.entries(route.query.shape)) {
      const item: JsonObject = { name, in: "query", required: required.has(name), schema: inlineJsonSchema(schema as z.ZodType) };
      const description = (schema as z.ZodType).description;
      if (description) item.description = description;
      parameters.push(item);
    }
  }
  const responses: JsonObject = {};
  for (const [statusText, schema] of Object.entries(route.responses)) {
    const status = Number(statusText);
    const id = ensureNamed(schema, `${pascal(route.operationId)}Response${status}`);
    responses[statusText] = {
      description: STATUS_DESCRIPTIONS[status] ?? `HTTP ${status}`,
      content: { "application/json": { schema: ref(id) } },
    };
  }
  const operation: JsonObject = {
    operationId: route.operationId,
    summary: route.summary,
    tags: [...route.tags],
  };
  if (route.auth && route.auth !== "none") operation["x-coordinator-auth"] = route.auth;
  if (parameters.length > 0) operation.parameters = parameters;
  if (route.body) {
    const id = ensureNamed(route.body, `${pascal(route.operationId)}Request`);
    operation.requestBody = { required: true, content: { "application/json": { schema: ref(id) } } };
  }
  operation.responses = responses;
  return operation;
}

function emitComponents(): Record<string, JsonObject> {
  const uri = (id: string) => `#/components/schemas/${id}`;
  const base = { target: "draft-2020-12" as const, unrepresentable: "any" as const, uri };
  // Requests are described from the caller's side (defaults optional); responses from the
  // producer's side (defaults materialised). Shared enums/objects are identical under both.
  const outputView = z.toJSONSchema(contractRegistry, { ...base, io: "output" }).schemas as Record<string, JsonObject>;
  const inputView = z.toJSONSchema(contractRegistry, { ...base, io: "input" }).schemas as Record<string, JsonObject>;
  const merged: Record<string, JsonObject> = {};
  for (const id of Object.keys(outputView).sort()) {
    const source = /Request$/.test(id) ? inputView[id] : outputView[id];
    merged[id] = stripSchemaEnvelope(source);
  }
  return merged;
}

export function buildBrowserOpenApiDocument(): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const route of browserContract) {
    const entry = (paths[route.path] ??= {});
    if (entry[route.method]) throw new Error(`duplicate ${route.method.toUpperCase()} ${route.path}`);
    entry[route.method] = operationFor(route);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "bim-review-coordinator browser API",
      version: BROWSER_CONTRACT_VERSION,
      description:
        "Coordinator Browser Contract. Generated from bim-review-coordinator/src/contract (zod); do not edit. "
        + "Covers coordinator-owned routes the browser calls; /api/governance/* and /api/kit/* proxies are owned upstream.",
    },
    "x-contract-id": BROWSER_CONTRACT_ID,
    "x-generated-from": "bim-review-coordinator/src/contract/browserContract.ts",
    paths,
    components: { schemas: emitComponents() },
  };
}

/** Canonical on-disk rendering: 2-space JSON, LF, trailing newline. Byte-compared by the drift test. */
export function renderBrowserOpenApiJson(): string {
  return `${JSON.stringify(buildBrowserOpenApiDocument(), null, 2)}\n`;
}
