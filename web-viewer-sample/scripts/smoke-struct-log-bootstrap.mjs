import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const TRACE_ID_PATTERN = /^(ifcready_|rev_|stream_conv_|script_)([A-Za-z0-9_-]+)$/;
const NESTED_PREFIX_PATTERN = /^(?:ifcready_|rev_|stream_conv_|script_|external_)/;

function parseArgs(argv) {
  const allowed = new Set(["--url", "--trace-id", "--artifact-dir"]);
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || parsed.has(key)) {
      throw new Error(`Usage: node scripts/smoke-struct-log-bootstrap.mjs --url <http(s) URL> --trace-id <id> --artifact-dir <dir>`);
    }
    parsed.set(key, value);
  }
  if (parsed.size !== allowed.size) throw new Error("Missing required bootstrap smoke argument");

  const url = new URL(parsed.get("--url"));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("--url must identify a real HTTP(S) page");
  }
  const traceId = parsed.get("--trace-id");
  const match = traceId.length <= 200 ? TRACE_ID_PATTERN.exec(traceId) : null;
  if (!match || NESTED_PREFIX_PATTERN.test(match[2])) throw new Error("--trace-id is not a safe documented trace id");

  return { url: url.href, traceId, artifactDir: path.resolve(parsed.get("--artifact-dir")) };
}

async function assertNonempty(filePath) {
  const details = await stat(filePath);
  if (!details.isFile() || details.size === 0) throw new Error(`Expected nonempty artifact: ${filePath}`);
  return details.size;
}

async function main() {
  const { url, traceId, artifactDir } = parseArgs(process.argv.slice(2));
  await mkdir(artifactDir, { recursive: true });
  const screenshotPath = path.join(artifactDir, "struct-log-bootstrap.png");
  const tracePath = path.join(artifactDir, "struct-log-bootstrap-trace.zip");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let tracingStarted = false;
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    tracingStarted = true;
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error(`Production page navigation failed: ${response?.status() ?? "no_response"}`);

    await page.waitForFunction(
      (expectedTrace) => window.__structLog?.logger?.traceId === expectedTrace,
      traceId,
    );
    const flush = await page.evaluate(async () => {
      const logger = window.__structLog?.logger;
      if (!logger) throw new Error("window.__structLog is unavailable");
      const flushed = await logger.flush();
      return {
        traceId: logger.traceId,
        flushed,
        flushedTotal: logger.flushedTotal(),
        lastFlushStatus: logger.lastFlushStatus(),
      };
    });
    if (flush.traceId !== traceId) throw new Error(`Page trace mismatch: ${flush.traceId}`);
    if (flush.flushedTotal < 1 || flush.lastFlushStatus?.status !== "ok") {
      throw new Error(`Structured log async flush was not observed: ${JSON.stringify(flush)}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    await context.tracing.stop({ path: tracePath });
    tracingStarted = false;

    const [screenshotBytes, traceBytes] = await Promise.all([
      assertNonempty(screenshotPath),
      assertNonempty(tracePath),
    ]);
    process.stdout.write(`${JSON.stringify({ ok: true, url: page.url(), traceId, flush, screenshotPath, screenshotBytes, tracePath, traceBytes })}\n`);
  } finally {
    if (tracingStarted) await context.tracing.stop({ path: tracePath }).catch(() => undefined);
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
