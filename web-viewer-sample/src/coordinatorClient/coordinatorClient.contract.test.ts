// Contract drift check (docs/architecture/coordinator-browser-client-adr.md §3): every route the client calls is tagged, and
// every `operationId` tag names an operation of the Coordinator Browser Contract with the same method and path template.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCoordinatorClient } from "./client";
import { COORDINATOR_ROUTES, type RouteSpec } from "./routes";

interface ContractOperation {
  method: string;
  path: string;
}

function contractOperations(): Map<string, ContractOperation> {
  const document = JSON.parse(readFileSync("../tests/contracts/coordinator-browser-api-v1.openapi.json", "utf8")) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  const operations = new Map<string, ContractOperation>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (operation?.operationId) operations.set(operation.operationId, { method: method.toUpperCase(), path });
    }
  }
  return operations;
}

// Members that build a URL or return a transport instead of calling a route.
const NOT_A_CALL = new Set(["base", "openInViewerUrl", "minioEventsUrl", "lineageConversionReportFileUrl", "viewerLeaseTransport"]);

describe("Coordinator Browser Client contract drift", () => {
  const routes = Object.entries(COORDINATOR_ROUTES) as Array<[string, RouteSpec]>;
  const operations = contractOperations();

  it("tags every contract route with an operation that exists with the same method and path template", () => {
    const drift = routes.flatMap(([name, route]) => {
      if (typeof route.tag !== "object") return [];
      const operation = operations.get(route.tag.operationId);
      if (!operation) return [`${name}: unknown operation ${route.tag.operationId}`];
      if (operation.method !== route.method || operation.path !== route.path) {
        return [`${name}: ${route.method} ${route.path} != ${route.tag.operationId} ${operation.method} ${operation.path}`];
      }
      return [];
    });
    expect(drift).toEqual([]);
  });

  it("keeps a route, and so a tag, for every member that calls the coordinator", () => {
    const client = createCoordinatorClient({ baseUrl: "http://coordinator.test" });
    const callers = Object.keys(client).filter((member) => !NOT_A_CALL.has(member)).sort();
    expect(callers).toEqual(routes.map(([name]) => name).sort());
  });

  it("tags only proxied Kit and governance routes, and non-contract /health and /api/dev routes, outside the contract", () => {
    const declared = new Set([...operations.values()].map((operation) => `${operation.method} ${operation.path}`));
    const outside = routes.filter(([, route]) => typeof route.tag !== "object");
    for (const [name, route] of outside) {
      expect(declared.has(`${route.method} ${route.path}`), `${name} is a contract operation`).toBe(false);
      if (route.tag === "proxied") expect(route.path, name).toMatch(/^\/api\/(kit|governance)\//);
      else expect(route.path, name).toMatch(/^\/(health$|api\/dev\/)/);
    }
  });

  it("reports the contract operations no browser method calls yet", () => {
    const called = new Set(routes.flatMap(([, route]) => (typeof route.tag === "object" ? [route.tag.operationId] : [])));
    const uncalled = [...operations.keys()].filter((operationId) => !called.has(operationId)).sort();
    // Reported, not failed (ADR §3): the CFD operations join with the CFD family in bullet 2; acceptIfcReady has no browser caller.
    console.info(`[contract drift] operations without a browser caller: ${uncalled.join(", ")}`);
    expect(uncalled).toContain("acceptIfcReady");
  });
});
