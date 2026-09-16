// Emit (or check) the Coordinator Browser Contract OpenAPI document.
//
//   npx tsx scripts/emit-browser-contract.ts          # write tests/contracts/coordinator-browser-api-v1.openapi.json
//   npx tsx scripts/emit-browser-contract.ts --check  # exit 1 if the committed file differs
//
// The browser TypeScript types are produced from the committed document by
// web-viewer-sample/scripts/generate-api-types.mjs --only=bim-review-coordinator.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_CONTRACT_RELATIVE_PATH, renderBrowserOpenApiJson } from "../src/contract/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = path.join(repoRoot, BROWSER_CONTRACT_RELATIVE_PATH);
const rendered = renderBrowserOpenApiJson();
const check = process.argv.includes("--check");

if (check) {
  const committed = existsSync(target) ? readFileSync(target, "utf-8").replace(/\r\n/g, "\n") : null;
  if (committed !== rendered) {
    console.error(`[browser-contract] ${BROWSER_CONTRACT_RELATIVE_PATH} is stale; run: npm run contract:emit`);
    process.exit(1);
  }
  console.log(`[browser-contract] ${BROWSER_CONTRACT_RELATIVE_PATH} is current.`);
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, rendered, "utf-8");
  console.log(`[browser-contract] wrote ${BROWSER_CONTRACT_RELATIVE_PATH} (${rendered.length} bytes)`);
}
