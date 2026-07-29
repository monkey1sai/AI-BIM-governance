import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { inspectPngBeforeDecode } from "./lib/png-preflight.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..", "..");
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  options.set(process.argv[index], process.argv[index + 1]);
}

const repoRoot = await realpath(path.resolve(options.get("--repo-root") || defaultRepoRoot));
const manifestPath = path.resolve(
  options.get("--manifest") ||
    path.join(repoRoot, "docs", "plans", "design-system-reference.manifest.json"),
);
const resultPath = path.resolve(
  options.get("--result") ||
    path.join(repoRoot, "artifacts", "e2e", "design-system-visual-result.json"),
);
const baselineRoot = await realpath(
  path.join(repoRoot, "docs", "plans", "design-system-baseline"),
);
const artifactRoot = await realpath(
  path.join(repoRoot, "artifacts", "e2e", "design-system-visual"),
);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error("[design-pixel-gate] " + message);
}

async function resolveExistingInside(root, relativePath, requiredPrefix) {
  assert(
    typeof relativePath === "string" && relativePath.startsWith(requiredPrefix),
    "artifact uses an invalid path: " + relativePath,
  );
  const absolute = path.resolve(repoRoot, ...relativePath.split("/"));
  const lexicalRelative = path.relative(root, absolute);
  assert(
    lexicalRelative && !lexicalRelative.startsWith("..") && !path.isAbsolute(lexicalRelative),
    "artifact escaped its approved root: " + relativePath,
  );
  const canonical = await realpath(absolute);
  const canonicalRelative = path.relative(root, canonical);
  assert(
    canonicalRelative && !canonicalRelative.startsWith("..") && !path.isAbsolute(canonicalRelative),
    "artifact resolved outside its approved root: " + relativePath,
  );
  return canonical;
}

function decodePng(buffer, label, viewport) {
  inspectPngBeforeDecode(buffer, viewport, label);
  try {
    return PNG.sync.read(buffer);
  } catch (error) {
    throw new Error("[design-pixel-gate] " + label + " cannot be decoded: " + error.message);
  }
}

const [manifestBuffer, resultBuffer] = await Promise.all([
  readFile(manifestPath),
  readFile(resultPath),
]);
assert(manifestBuffer.length <= 2 * 1024 * 1024, "manifest exceeds the JSON byte budget.");
assert(resultBuffer.length <= 2 * 1024 * 1024, "result exceeds the JSON byte budget.");
const manifest = JSON.parse(manifestBuffer.toString("utf8"));
const result = JSON.parse(resultBuffer.toString("utf8"));
const screenMap = new Map(manifest.screens.map((screen) => [screen.id, screen]));
const viewportMap = new Map(
  manifest.fidelity_contract.viewports.map((viewport) => [viewport.id, viewport]),
);
let comparisons = 0;

for (const screenResult of result.screens || []) {
  const approvedScreen = screenMap.get(screenResult.id);
  assert(approvedScreen, "result has an unknown screen: " + screenResult.id);
  for (const viewportResult of screenResult.viewports || []) {
    const viewport = viewportMap.get(viewportResult.id);
    assert(viewport, "result has an unknown viewport: " + viewportResult.id);
    const approvedBaseline = approvedScreen.baselines[viewport.id];
    assert(approvedBaseline, "approved baseline is missing for " + screenResult.id + "/" + viewport.id);

    const [baselinePath, actualPath, diffPath] = await Promise.all([
      resolveExistingInside(
        baselineRoot,
        approvedBaseline.path,
        "docs/plans/design-system-baseline/",
      ),
      resolveExistingInside(
        artifactRoot,
        viewportResult.actual_path,
        "artifacts/e2e/design-system-visual/",
      ),
      resolveExistingInside(
        artifactRoot,
        viewportResult.diff_path,
        "artifacts/e2e/design-system-visual/",
      ),
    ]);
    const [baselineBuffer, actualBuffer, suppliedDiffBuffer] = await Promise.all([
      readFile(baselinePath),
      readFile(actualPath),
      readFile(diffPath),
    ]);

    assert(sha256(baselineBuffer) === approvedBaseline.sha256, "baseline hash drifted.");
    assert(sha256(actualBuffer) === viewportResult.actual_sha256, "actual hash drifted.");
    assert(sha256(suppliedDiffBuffer) === viewportResult.diff_sha256, "diff hash drifted.");

    const baseline = decodePng(baselineBuffer, "baseline", viewport);
    const actual = decodePng(actualBuffer, "actual", viewport);
    const suppliedDiff = decodePng(suppliedDiffBuffer, "diff", viewport);
    for (const [label, image] of [
      ["baseline", baseline],
      ["actual", actual],
      ["diff", suppliedDiff],
    ]) {
      assert(
        image.width === viewport.width && image.height === viewport.height,
        label + " dimensions do not match " + viewport.id + ".",
      );
    }

    const recomputedDiff = new PNG({ width: viewport.width, height: viewport.height });
    const diffPixels = pixelmatch(
      baseline.data,
      actual.data,
      recomputedDiff.data,
      viewport.width,
      viewport.height,
      {
        threshold: manifest.fidelity_contract.pixelmatch_color_threshold,
        includeAA: manifest.fidelity_contract.include_antialiasing,
      },
    );
    const recomputedDiffBuffer = PNG.sync.write(recomputedDiff);
    const ratio = diffPixels / (viewport.width * viewport.height);
    const tolerance = 1 / (viewport.width * viewport.height * 10);
    assert(
      Math.abs(ratio - Number(viewportResult.diff_pixel_ratio)) <= tolerance,
      "declared pixel ratio does not match recomputed pixels for " +
        screenResult.id + "/" + viewport.id + ".",
    );
    assert(
      ratio <= manifest.fidelity_contract.max_diff_pixel_ratio,
      "recomputed pixel ratio exceeds the approved budget for " +
        screenResult.id + "/" + viewport.id + ".",
    );
    assert(
      sha256(recomputedDiffBuffer) === viewportResult.diff_sha256,
      "supplied diff PNG is not the recomputed pixelmatch output for " +
        screenResult.id + "/" + viewport.id + ".",
    );
    comparisons += 1;
  }
}

console.log(
  "[design-pixel-gate] passed — " + comparisons + " baseline/actual/diff comparisons recomputed",
);
