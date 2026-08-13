import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planOriginRebaseline,
  runGuardedOriginRebaseline,
} from "./design-system-rebaseline-authority.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const manifestPath = path.join(
  repoRoot,
  "docs",
  "plans",
  "design-system-reference.manifest.json",
);
const baselineRoot = path.resolve(
  repoRoot,
  "docs",
  "plans",
  "design-system-baseline",
);
const args = new Set(process.argv.slice(2));
const rebaseline = args.has("--rebaseline");
const confirmed = args.has("--confirm-rebaseline");

if (rebaseline !== confirmed) {
  throw new Error(
    "Rebaseline requires both --rebaseline and --confirm-rebaseline; verification uses neither flag.",
  );
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const runtimePlatform = process.platform === "win32" ? "windows" : process.platform;
const sourceRoot = path.resolve(
  process.env.DESIGN_SYSTEM_REFERENCE_ROOT ||
    manifest.authority?.authoring_origin ||
    "C:\\Repos\\design\\desigin-system",
);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const toPosix = (value) => value.split(path.sep).join("/");

function resolveBaselinePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.startsWith("docs/plans/design-system-baseline/")
  ) {
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
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  const excludedDirectories = new Set([".git", ".cache", "node_modules"]);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in the approved design source: ${toPosix(path.relative(root, absolute))}`,
      );
    }
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) continue;
      files.push(...(await listFiles(root, absolute)));
    } else if (entry.isFile()) {
      files.push(toPosix(path.relative(root, absolute)));
    }
  }
  return files;
}

async function describeSourceFiles(root) {
  const relativePaths = await listFiles(root);
  const descriptions = [];
  for (const relativePath of relativePaths) {
    const absolute = path.join(root, ...relativePath.split("/"));
    const [buffer, metadata] = await Promise.all([readFile(absolute), stat(absolute)]);
    descriptions.push({
      path: relativePath,
      bytes: metadata.size,
      sha256: sha256(buffer),
    });
  }
  return descriptions;
}

function canonicalFileDigest(files) {
  const canonical = files
    .map((item) => `${item.path}\0${item.bytes}\0${item.sha256}`)
    .sort()
    .join("\n");
  return sha256(Buffer.from(canonical, "utf8"));
}

function compareSourceFiles(expected, actual) {
  const expectedMap = new Map(expected.map((item) => [item.path, item]));
  const actualMap = new Map(actual.map((item) => [item.path, item]));
  const drift = [];
  for (const [relativePath, expectedFile] of expectedMap) {
    const actualFile = actualMap.get(relativePath);
    if (!actualFile) {
      drift.push(`${relativePath}: missing`);
      continue;
    }
    if (
      actualFile.bytes !== expectedFile.bytes ||
      actualFile.sha256 !== expectedFile.sha256
    ) {
      drift.push(`${relativePath}: hash-or-size-mismatch`);
    }
  }
  for (const relativePath of actualMap.keys()) {
    if (!expectedMap.has(relativePath)) drift.push(`${relativePath}: unpinned-file`);
  }
  return drift;
}

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

async function startStaticServer(root) {
  const canonicalRoot = await realpath(root);
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const requestPath = decodeURIComponent(requestUrl.pathname);
      const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
      const absolute = path.resolve(root, ...relative.split("/"));
      const relativeCheck = path.relative(root, absolute);
      if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const canonical = await realpath(absolute);
      const canonicalRelative = path.relative(canonicalRoot, canonical);
      if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const metadata = await stat(canonical);
      if (!metadata.isFile()) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(path.extname(canonical).toLowerCase()) ||
          "application/octet-stream",
      });
      createReadStream(canonical).pipe(response);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind reference server.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function loadPlaywright() {
  try {
    return await import("@playwright/test");
  } catch (defaultError) {
    const moduleRoot = process.env.PLAYWRIGHT_MODULE_ROOT;
    if (!moduleRoot) throw defaultError;
    const requireFromProject = createRequire(
      path.join(path.resolve(moduleRoot), "..", "package.json"),
    );
    return requireFromProject("@playwright/test");
  }
}

async function captureBaselines({ captureScreens, preservedScreens }) {
  if (preservedScreens.length > 0) {
    console.log(
      `[design-reference] preserving canonical product-surface baselines: ${preservedScreens
        .map((screen) => screen.id)
        .join(", ")}`,
    );
  }

  const { chromium } = await loadPlaywright();
  const playwrightPackage = JSON.parse(
    await readFile(path.join(repoRoot, "web-viewer-sample", "node_modules", "@playwright", "test", "package.json"), "utf8"),
  );
  const browserCatalog = JSON.parse(
    await readFile(path.join(repoRoot, "web-viewer-sample", "node_modules", "playwright-core", "browsers.json"), "utf8"),
  );
  const chromiumCatalog = browserCatalog.browsers.find((entry) => entry.name === "chromium");
  if (
    playwrightPackage.version !== manifest.fidelity_contract.playwright_version ||
    chromiumCatalog?.revision !== manifest.fidelity_contract.chromium_revision ||
    chromiumCatalog?.browserVersion !== manifest.fidelity_contract.chromium_version
  ) {
    throw new Error("Installed Playwright/Chromium toolchain does not match the approved manifest pins.");
  }

  const server = await startStaticServer(sourceRoot);
  const browser = await chromium.launch({ headless: true });
  if (browser.version() !== manifest.fidelity_contract.chromium_version) {
    await browser.close();
    await server.close();
    throw new Error("Launched Chromium version does not match the approved manifest pin.");
  }
  try {
    for (const viewport of manifest.fidelity_contract.viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: manifest.fidelity_contract.device_scale_factor,
        locale: manifest.fidelity_contract.locale,
        timezoneId: manifest.fidelity_contract.timezone,
        colorScheme: manifest.fidelity_contract.color_scheme,
      });
      try {
        for (const screen of captureScreens) {
          const page = await context.newPage();
          await page.addInitScript(() => {
            const fixedNow = Date.parse("2026-07-14T00:00:00+08:00");
            const NativeDate = Date;
            class FixedDate extends NativeDate {
              constructor(...values) {
                super(...(values.length ? values : [fixedNow]));
              }
              static now() {
                return fixedNow;
              }
            }
            Object.defineProperty(window, "Date", { value: FixedDate });
          });
          await page.goto(server.baseUrl, { waitUntil: "networkidle" });
          await page.locator("#root > *").first().waitFor({ state: "visible" });

          if (screen.reference_action.type === "click_exact_text") {
            const target = page.getByText(screen.reference_action.value, { exact: true }).first();
            await target.waitFor({ state: "visible" });
            await target.click();
          } else if (screen.reference_action.type !== "initial") {
            throw new Error(
              `Unsupported reference action '${screen.reference_action.type}' for ${screen.id}.`,
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
          await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(
              Array.from(document.images).map((image) =>
                image.complete
                  ? Promise.resolve()
                  : new Promise((resolve) => {
                      image.addEventListener("load", resolve, { once: true });
                      image.addEventListener("error", resolve, { once: true });
                    }),
              ),
            );
          });
          const fontsReady = await page.evaluate(
            () =>
              document.fonts.check('12px "Noto Sans TC"') &&
              document.fonts.check('12px "JetBrains Mono"'),
          );
          if (!fontsReady) throw new Error(`Required fonts did not load for ${screen.id}.`);

          const baseline = screen.baselines[viewport.id];
          if (!baseline) throw new Error(`Missing ${viewport.id} baseline slot for ${screen.id}.`);
          const outputPath = resolveBaselinePath(baseline.path);
          await mkdir(path.dirname(outputPath), { recursive: true });
          await page.screenshot({ path: outputPath, fullPage: false, animations: "disabled" });
          baseline.sha256 = sha256(await readFile(outputPath));
          await page.close();
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return {
    capturedScreenCount: captureScreens.length,
    preservedScreenCount: preservedScreens.length,
  };
}

if (!(await pathExists(sourceRoot))) {
  throw new Error(`Design reference root does not exist: ${sourceRoot}`);
}

const actualSourceFiles = await describeSourceFiles(sourceRoot);
if (rebaseline) {
  if (runtimePlatform !== manifest.fidelity_contract.platform) {
    throw new Error(
      "Rebaseline platform " + runtimePlatform + " does not match approved platform " +
        manifest.fidelity_contract.platform + ".",
    );
  }
  const rebaselinePlan = planOriginRebaseline(manifest.screens);
  const captureResult = await runGuardedOriginRebaseline({
    preservedScreens: rebaselinePlan.preservedScreens,
    viewportIds: manifest.fidelity_contract.viewports.map(
      (viewport) => viewport.id,
    ),
    readDigest: async (relativePath) =>
      sha256(await readFile(resolveBaselinePath(relativePath))),
    captureBaselines: () => captureBaselines(rebaselinePlan),
    commitManifest: async () => {
      manifest.source.files = actualSourceFiles;
      manifest.source.snapshot_sha256 = canonicalFileDigest(actualSourceFiles);
      manifest.source.captured_at_utc = new Date().toISOString();
      const baselineDescriptors = [];
      for (const screen of manifest.screens) {
        for (const viewport of manifest.fidelity_contract.viewports) {
          const baseline = screen.baselines[viewport.id];
          baselineDescriptors.push({
            path: baseline.path,
            bytes: (await stat(resolveBaselinePath(baseline.path))).size,
            sha256: baseline.sha256,
          });
        }
      }
      manifest.baseline_snapshot_sha256 = canonicalFileDigest(
        baselineDescriptors,
      );
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
    },
  });
  console.log(
    `[design-reference] rebaseline complete: ${captureResult.capturedScreenCount} origin screens captured, ` +
      `${captureResult.preservedScreenCount} product screens preserved x ` +
      `${manifest.fidelity_contract.viewports.length} viewports`,
  );
} else {
  const drift = compareSourceFiles(manifest.source.files, actualSourceFiles);
  if (drift.length) {
    throw new Error(
      `Design reference drift detected. Rebaseline requires explicit approval.\n${drift.join("\n")}`,
    );
  }
  for (const screen of manifest.screens) {
    for (const viewport of manifest.fidelity_contract.viewports) {
      const baseline = screen.baselines[viewport.id];
      const baselinePath = resolveBaselinePath(baseline.path);
      if (!(await pathExists(baselinePath))) throw new Error(`Missing baseline: ${baseline.path}`);
      const digest = sha256(await readFile(baselinePath));
      if (digest !== baseline.sha256) throw new Error(`Baseline hash mismatch: ${baseline.path}`);
    }
  }
  console.log(`[design-reference] origin and ${manifest.screens.length * 2} baselines verified`);
}
