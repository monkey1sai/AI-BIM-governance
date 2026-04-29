import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(repoRoot, "_testoutput", "assets-api-test");
mkdirSync(outDir, { recursive: true });

execFileSync(
  "npx",
  [
    "tsc",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2020",
    "--skipLibCheck",
    "--strict",
    "--outDir",
    outDir,
    "src/assetsApi.ts",
  ],
  { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" }
);

const compiledModule = resolve(outDir, "assetsApi.js");
const {
  ASSETS_ENDPOINT,
  normalizeUSDAssetsResponse,
} = await import(pathToFileURL(compiledModule).href);

assert.equal(ASSETS_ENDPOINT, "/api/assets");

assert.deepEqual(
  normalizeUSDAssetsResponse([
    { name: "Model A", url: "C:/models/a.usdc" },
    { name: "Missing URL" },
    { url: "C:/models/missing-name.usdc" },
  ]),
  [{ name: "Model A", url: "C:/models/a.usdc" }]
);

assert.deepEqual(
  normalizeUSDAssetsResponse({
    assets: [{ name: "Model B", url: "omniverse://server/model.usd" }],
  }),
  [{ name: "Model B", url: "omniverse://server/model.usd" }]
);

assert.deepEqual(normalizeUSDAssetsResponse({ assets: "invalid" }), []);

const localAssetsPath = resolve(repoRoot, "public", "api", "assets");
assert.equal(existsSync(localAssetsPath), true, "public/api/assets should exist as local dev fallback");

const parsedLocalAssets = JSON.parse(readFileSync(localAssetsPath, "utf8"));
assert.ok(
  normalizeUSDAssetsResponse(parsedLocalAssets).length > 0,
  "public/api/assets should contain at least one valid asset"
);

console.log("assets API helper tests passed");
