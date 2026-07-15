import { readFile, writeFile } from "node:fs/promises";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const [baselinePath, actualPath, outputPath, thresholdValue = "0.1"] = process.argv.slice(2);
if (!baselinePath || !actualPath || !outputPath) {
  throw new Error("usage: write-pixelmatch-diff.mjs <baseline.png> <actual.png> <diff.png> [threshold]");
}

const [baselineBuffer, actualBuffer] = await Promise.all([
  readFile(baselinePath),
  readFile(actualPath),
]);
const baseline = PNG.sync.read(baselineBuffer);
const actual = PNG.sync.read(actualBuffer);
if (baseline.width !== actual.width || baseline.height !== actual.height) {
  throw new Error("fixture images must have identical dimensions");
}
const diff = new PNG({ width: baseline.width, height: baseline.height });
const diffPixels = pixelmatch(
  baseline.data,
  actual.data,
  diff.data,
  baseline.width,
  baseline.height,
  { threshold: Number(thresholdValue), includeAA: false },
);
await writeFile(outputPath, PNG.sync.write(diff));
process.stdout.write(String(diffPixels / (baseline.width * baseline.height)));
