import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import {
  designHarnessRoute,
  semanticCaseDefinitions,
  type SemanticAssertionDefinition,
} from "./design-system-semantic-cases";

type ViewportContract = { id: string; width: number; height: number };
type BaselineContract = { path: string; sha256: string };
type ScreenContract = {
  id: string;
  production_routes: string[];
  baselines: Record<string, BaselineContract>;
};
type ReferenceManifest = {
  source: { snapshot_sha256: string };
  baseline_snapshot_sha256: string;
  fidelity_contract: {
    platform: string;
    ci_runner_label: string;
    playwright_version: string;
    chromium_revision: string;
    chromium_version: string;
    device_scale_factor: number;
    fonts_ready_required: boolean;
    animations_disabled: boolean;
    viewports: ViewportContract[];
    pixelmatch_color_threshold: number;
    include_antialiasing: boolean;
    max_diff_pixel_ratio: number;
    live_surface_policy: string;
    live_surface_selectors: string[];
  };
  required_semantic_states: string[];
  semantic_contract: {
    schema_version: number;
    status: string;
    external_result_input_allowed: boolean;
    required_case_ids: string[];
    implemented_case_ids: string[];
  };
  screens: ScreenContract[];
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
const manifestPath = path.join(
  repoRoot,
  "docs",
  "plans",
  "design-system-reference.manifest.json",
);
const outputRoot = path.join(repoRoot, "artifacts", "e2e", "design-system-visual");
const resultPath = path.join(repoRoot, "artifacts", "e2e", "design-system-visual-result.json");
const baselineRoot = path.join(repoRoot, "docs", "plans", "design-system-baseline");

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const relativeToRepo = (value: string) => path.relative(repoRoot, value).split(path.sep).join("/");
const resolveBaselinePath = (relativePath: string) => {
  if (!relativePath.startsWith("docs/plans/design-system-baseline/")) {
    throw new Error("Baseline escaped docs/plans/design-system-baseline: " + relativePath);
  }
  const absolute = path.resolve(repoRoot, ...relativePath.split("/"));
  const relativeToBaselineRoot = path.relative(baselineRoot, absolute);
  if (
    !relativeToBaselineRoot ||
    relativeToBaselineRoot.startsWith("..") ||
    path.isAbsolute(relativeToBaselineRoot)
  ) {
    throw new Error("Baseline escaped docs/plans/design-system-baseline: " + relativePath);
  }
  return absolute;
};

const observeSemanticAssertion = async (
  page: import("@playwright/test").Page,
  assertion: SemanticAssertionDefinition,
) => {
  const locator = page.locator(assertion.locator);
  let observed: string | number | boolean | null;
  try {
    switch (assertion.expectation) {
      case "visible":
        observed = await locator.isVisible();
        await expect(locator, assertion.id).toBeVisible();
        break;
      case "hidden":
        observed = !(await locator.isVisible());
        await expect(locator, assertion.id).toBeHidden();
        break;
      case "enabled":
        observed = await locator.isEnabled();
        await expect(locator, assertion.id).toBeEnabled();
        break;
      case "disabled":
        observed = await locator.isDisabled();
        await expect(locator, assertion.id).toBeDisabled();
        break;
      case "text_equals":
        observed = await locator.textContent();
        await expect(locator, assertion.id).toHaveText(String(assertion.expected ?? ""));
        break;
      case "text_contains":
        observed = await locator.textContent();
        await expect(locator, assertion.id).toContainText(String(assertion.expected ?? ""));
        break;
      case "attribute_equals": {
        const attribute = assertion.attribute ?? "";
        observed = await locator.getAttribute(attribute);
        await expect(locator, assertion.id).toHaveAttribute(
          attribute,
          String(assertion.expected ?? ""),
        );
        break;
      }
      case "count_equals":
        observed = await locator.count();
        await expect(locator, assertion.id).toHaveCount(Number(assertion.expected));
        break;
      default:
        throw new Error("Unsupported semantic expectation.");
    }
    return { observed, passed: true };
  } catch (error) {
    if (typeof observed === "undefined") observed = null;
    return {
      observed,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

test("approved screens match desigin-system golden and semantic contracts", async ({ page }) => {
  test.setTimeout(1_200_000);
  const manifestBuffer = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBuffer.toString("utf8")) as ReferenceManifest;
  const playwrightPackage = JSON.parse(
    await readFile(path.join(repoRoot, "web-viewer-sample", "node_modules", "@playwright", "test", "package.json"), "utf8"),
  ) as { version: string };
  const browserCatalog = JSON.parse(
    await readFile(path.join(repoRoot, "web-viewer-sample", "node_modules", "playwright-core", "browsers.json"), "utf8"),
  ) as { browsers: Array<{ name: string; revision: string; browserVersion: string }> };
  const chromiumCatalog = browserCatalog.browsers.find((entry) => entry.name === "chromium");
  const manifestHash = sha256(manifestBuffer);
  const requestedIds = (process.env.DESIGN_SYSTEM_SCREEN_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const subjectCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform;
  const runtimeBrowserVersion = page.context().browser()?.version() ?? "";

  const manifestScreens = new Map(manifest.screens.map((screen) => [screen.id, screen]));
  const selectedIds = requestedIds.length ? requestedIds : [...manifestScreens.keys()];
  expect(
    runtimePlatform,
    "Visual evidence must be produced on the same OS platform as the approved goldens.",
  ).toBe(manifest.fidelity_contract.platform);
  expect(playwrightPackage.version).toBe(manifest.fidelity_contract.playwright_version);
  expect(chromiumCatalog?.revision).toBe(manifest.fidelity_contract.chromium_revision);
  expect(chromiumCatalog?.browserVersion).toBe(manifest.fidelity_contract.chromium_version);
  expect(runtimeBrowserVersion).toBe(manifest.fidelity_contract.chromium_version);
  expect(manifest.semantic_contract.schema_version).toBe(2);
  expect(manifest.semantic_contract.external_result_input_allowed).toBe(false);
  expect(
    manifest.semantic_contract.status,
    "Semantic state variants are not executable yet; implement every manifest case in design-system-semantic-cases.ts.",
  ).toBe("executable");
  expect([...manifest.semantic_contract.implemented_case_ids].sort()).toEqual(
    [...manifest.semantic_contract.required_case_ids].sort(),
  );
  const workspaceStatus = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  expect(
    workspaceStatus,
    "Design evidence must be produced from a clean subject commit; commit or discard relevant changes first.",
  ).toBe("");
  const resultScreens: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  await mkdir(outputRoot, { recursive: true });
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "design_gate_deterministic_offline" }),
    });
  });
  await page.route("**/socket.io/**", async (route) => {
    await route.abort("blockedbyclient");
  });

  for (const screenId of selectedIds) {
    const screen = manifestScreens.get(screenId);
    expect(screen, `Unknown design screen '${screenId}'.`).toBeTruthy();
    if (!screen) continue;
    const productionRoute = screen.production_routes[0];

    const semanticStates: Record<string, boolean> = {};
    const semanticCaseIds: string[] = [];
    const semanticAssertions: Array<Record<string, unknown>> = [];
    for (const caseId of manifest.semantic_contract.required_case_ids) {
      const registryKey = screenId + ":" + caseId;
      const definition = semanticCaseDefinitions.get(registryKey);
      expect(definition, "Missing executable semantic case '" + registryKey + "'.").toBeTruthy();
      if (!definition) continue;
      expect(
        definition.assertions.length,
        "Semantic case '" + registryKey + "' declares no spec-executed DOM assertion.",
      ).toBeGreaterThan(0);
      const assertionIds = definition.assertions.map((assertion) => assertion.id);
      expect(new Set(assertionIds).size, "Duplicate semantic assertion ID in " + registryKey)
        .toBe(assertionIds.length);
      let casePassed = true;
      try {
        await definition.prepare({ page, screenId, productionRoute });
      } catch (error) {
        casePassed = false;
        failures.push(
          registryKey + ": prepare failed: " +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      for (const assertion of definition.assertions) {
        expect(assertion.id.trim(), registryKey + " has an empty assertion ID.").not.toBe("");
        expect(assertion.locator.trim(), registryKey + " has an empty locator.").not.toBe("");
        const outcome = await observeSemanticAssertion(page, assertion);
        if (!outcome.passed) {
          casePassed = false;
          failures.push(registryKey + "/" + assertion.id + ": DOM expectation failed");
        }
        semanticAssertions.push({
          case_id: caseId,
          assertion_id: assertion.id,
          locator: assertion.locator,
          expectation: assertion.expectation,
          expected: assertion.expected ?? null,
          attribute: assertion.attribute ?? null,
          observed: outcome.observed,
          passed: outcome.passed,
        });
      }
      semanticStates[caseId] = casePassed;
      semanticCaseIds.push(caseId);
    }

    const viewportResults: Array<Record<string, unknown>> = [];
    for (const viewport of manifest.fidelity_contract.viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        const fixedNow = Date.parse("2026-07-14T00:00:00+08:00");
        const NativeDate = Date;
        class FixedDate extends NativeDate {
          constructor(...values: ConstructorParameters<typeof Date>) {
            super(...(values.length ? values : [fixedNow]));
          }
          static now() {
            return fixedNow;
          }
        }
        Object.defineProperty(window, "Date", { value: FixedDate });
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.goto(designHarnessRoute(productionRoute), { waitUntil: "domcontentloaded" });
      await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 30_000 });
      const observedDpr = await page.evaluate(() => window.devicePixelRatio);
      if (observedDpr !== manifest.fidelity_contract.device_scale_factor) {
        failures.push(
          screenId + "/" + viewport.id + ": DPR " + observedDpr +
            " != " + manifest.fidelity_contract.device_scale_factor,
        );
      }
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-delay: 0s !important;
            animation-duration: 0s !important;
            caret-color: transparent !important;
            transition-delay: 0s !important;
            transition-duration: 0s !important;
          }
        `,
      });
      await page.evaluate(async () => document.fonts.ready);
      for (const selector of manifest.fidelity_contract.live_surface_selectors) {
        const count = await page.locator(selector).count();
        if (count > 0) {
          failures.push(
            screenId + "/" + viewport.id + ": live surface entered design capture: " + selector,
          );
        }
      }

      const screenDir = path.join(outputRoot, screenId);
      await mkdir(screenDir, { recursive: true });
      const actualPath = path.join(screenDir, `${viewport.id}-actual.png`);
      const diffPath = path.join(screenDir, `${viewport.id}-diff.png`);
      await page.screenshot({ path: actualPath, fullPage: false, animations: "disabled" });

      const baseline = screen.baselines[viewport.id];
      expect(baseline, `${screenId} lacks baseline ${viewport.id}.`).toBeTruthy();
      const baselinePath = resolveBaselinePath(baseline.path);
      const [baselineBuffer, actualBuffer] = await Promise.all([
        readFile(baselinePath),
        readFile(actualPath),
      ]);
      const baselinePng = PNG.sync.read(baselineBuffer);
      const actualPng = PNG.sync.read(actualBuffer);
      if (sha256(baselineBuffer) !== baseline.sha256) {
        failures.push(screenId + "/" + viewport.id + ": baseline hash does not match manifest");
      }
      if (baselinePng.width !== viewport.width || baselinePng.height !== viewport.height) {
        failures.push(
          screenId + "/" + viewport.id + ": baseline dimensions " +
            baselinePng.width + "x" + baselinePng.height +
            " != viewport " + viewport.width + "x" + viewport.height,
        );
      }
      if (actualPng.width !== viewport.width || actualPng.height !== viewport.height) {
        failures.push(
          screenId + "/" + viewport.id + ": actual dimensions " +
            actualPng.width + "x" + actualPng.height +
            " != viewport " + viewport.width + "x" + viewport.height,
        );
      }
      let diffPixels = baselinePng.width * baselinePng.height;
      let diffPng = new PNG({ width: baselinePng.width, height: baselinePng.height });
      if (baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height) {
        failures.push(
          `${screenId}/${viewport.id}: dimensions ${actualPng.width}x${actualPng.height} != ${baselinePng.width}x${baselinePng.height}`,
        );
      } else {
        diffPng = new PNG({ width: baselinePng.width, height: baselinePng.height });
        diffPixels = pixelmatch(
          baselinePng.data,
          actualPng.data,
          diffPng.data,
          baselinePng.width,
          baselinePng.height,
          {
            threshold: manifest.fidelity_contract.pixelmatch_color_threshold,
            includeAA: manifest.fidelity_contract.include_antialiasing,
          },
        );
      }
      const diffBuffer = PNG.sync.write(diffPng);
      await writeFile(diffPath, diffBuffer);
      const diffPixelRatio = diffPixels / (baselinePng.width * baselinePng.height);
      if (diffPixelRatio > manifest.fidelity_contract.max_diff_pixel_ratio) {
        failures.push(`${screenId}/${viewport.id}: diff ratio ${diffPixelRatio} > 0.01`);
      }
      viewportResults.push({
        id: viewport.id,
        diff_pixel_ratio: diffPixelRatio,
        baseline_path: baseline.path,
        baseline_sha256: baseline.sha256,
        actual_path: relativeToRepo(actualPath),
        actual_sha256: sha256(actualBuffer),
        diff_path: relativeToRepo(diffPath),
        diff_sha256: sha256(diffBuffer),
      });
    }

    resultScreens.push({
      id: screenId,
      production_route: productionRoute,
      semantic_parity: Object.values(semanticStates).every(Boolean) ? 1 : 0,
      semantic_states: semanticStates,
      semantic_case_ids: semanticCaseIds,
      semantic_assertions: semanticAssertions,
      semantic_producer: "playwright-inline-cases",
      viewports: viewportResults,
    });
  }

  const result = {
    schema_version: 2,
    kind: "ai-bim-design-system-visual-result",
    status: failures.length === 0 ? "passed" : "failed",
    generated_at_utc: new Date().toISOString(),
    subject_commit: subjectCommit,
    manifest_sha256: manifestHash,
    source_snapshot_sha256: manifest.source.snapshot_sha256,
    baseline_snapshot_sha256: manifest.baseline_snapshot_sha256,
    browser: "chromium",
    platform: runtimePlatform,
    ci_runner_label: process.env.ImageOS ? manifest.fidelity_contract.ci_runner_label : "local-windows",
    playwright_version: playwrightPackage.version,
    chromium_revision: chromiumCatalog?.revision ?? "",
    chromium_version: runtimeBrowserVersion,
    workspace_clean: true,
    device_scale_factor: manifest.fidelity_contract.device_scale_factor,
    semantic_contract_schema_version: manifest.semantic_contract.schema_version,
    screens: resultScreens,
    failures,
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  expect(failures, `Visual/semantic gate failed; inspect ${relativeToRepo(resultPath)}.`).toEqual([]);
});
