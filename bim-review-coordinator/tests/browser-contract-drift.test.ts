// Coordinator Browser Contract — drift guard.
//
// Replaces the regex source-scan in tests/test_cross_service_enum_parity.py (test 1)
// for everything the contract covers. Two facts are pinned:
//   1. The committed OpenAPI document is exactly what src/contract emits today.
//   2. The committed browser types were generated from that exact document.
// Neither needs the network or Python; both run under `npm test`.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BROWSER_CONTRACT_RELATIVE_PATH,
  browserContract,
  buildBrowserOpenApiDocument,
  renderBrowserOpenApiJson,
} from "../src/contract/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const committedPath = path.join(repoRoot, BROWSER_CONTRACT_RELATIVE_PATH);
const generatedTypesPath = path.join(repoRoot, "web-viewer-sample", "src", "generated", "coordinator-api.ts");

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("Coordinator Browser Contract drift", () => {
  it("declares every route once with a unique operationId", () => {
    const ids = browserContract.map((route) => route.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = browserContract.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("emits a valid OpenAPI 3.1 skeleton with every response referenced by $ref", () => {
    const doc = buildBrowserOpenApiDocument() as {
      openapi: string;
      paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: { $ref: string } }> }> }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    for (const operations of Object.values(doc.paths)) {
      for (const operation of Object.values(operations)) {
        for (const response of Object.values(operation.responses)) {
          const target = response.content["application/json"].schema.$ref.replace("#/components/schemas/", "");
          expect(doc.components.schemas, `missing component ${target}`).toHaveProperty(target);
        }
      }
    }
  });

  it(`${BROWSER_CONTRACT_RELATIVE_PATH} equals a fresh emission (run: npm run contract:emit)`, () => {
    expect(existsSync(committedPath), `${committedPath} is missing`).toBe(true);
    expect(lf(readFileSync(committedPath, "utf-8"))).toBe(renderBrowserOpenApiJson());
  });

  it("web-viewer-sample/src/generated/coordinator-api.ts was generated from the committed document", () => {
    expect(
      existsSync(generatedTypesPath),
      "generated browser types missing; run: cd web-viewer-sample && npm run generate:api-types -- --only=bim-review-coordinator",
    ).toBe(true);
    const header = lf(readFileSync(generatedTypesPath, "utf-8")).split("\n").slice(0, 8).join("\n");
    const match = /\/\/ source-sha256: ([0-9a-f]{64})/.exec(header);
    expect(match, "generated header lacks a source-sha256 line").not.toBeNull();
    expect(match?.[1]).toBe(sha256(lf(readFileSync(committedPath, "utf-8"))));
  });
});
