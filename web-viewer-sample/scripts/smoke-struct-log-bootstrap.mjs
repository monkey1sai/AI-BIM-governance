import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { inflateRawSync } from "node:zlib";
import { chromium } from "@playwright/test";

const TRACE_ID_PATTERN = /^(ifcready_|rev_|stream_conv_|script_)([A-Za-z0-9_-]+)$/;
const NESTED_PREFIX_PATTERN = /^(?:ifcready_|rev_|stream_conv_|script_|external_)/;
const SESSION_ID_PATTERN = /^(?:lwv_|review_session_)[A-Za-z0-9_]+$/;
const SAFE_ACTION_ID_PATTERN = /^evidence_action_[A-Za-z0-9_]{8,128}$/;
const SAFE_RUNTIME_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const NOT_OBSERVED = "未觀測";
const MAX_COLLECTED_EVENTS = 200;
const MAX_VIEWER_LOG_BODY_BYTES = 256 * 1024;
const MAX_VIEWER_LOG_RECORDS = 500;
const MAX_TRACE_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_TRACE_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_TRACE_ENTRIES = 256;
const MAX_TRACE_COMPRESSION_RATIO = 50;
const SAFE_TRACE_EVENT_TYPES = new Set(["context-options", "before", "after", "input"]);
const DROPPED_TRACE_EVENT_TYPES = new Set(["console", "event", "log"]);
const FORBIDDEN_TRACE_KEY = /(?:header|cookie|authorization|token|secret|password|credential|query|body|postdata)/i;
const SECRET_LIKE_TRACE_VALUE = /(?:bearer\s+|(?:access[_-]?token|api[_-]?key|password|secret|authorization|cookie)\s*[:=])/i;
const EXPECTED_STATES = Object.freeze([
  "ready",
  "flush_loading",
  "flush_failure",
  "retry_loading",
  "flush_success",
  "close_loading",
  "closed",
]);
const ARTIFACT_NAMES = Object.freeze({
  failure_screenshot: "structured-log-failure.png",
  final_screenshot: "structured-log-success-closed.png",
  playwright_trace: "structured-log-trace.zip",
  console_events: "structured-log-console.json",
  network_events: "structured-log-network.json",
  operability: "structured-log-operability.json",
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function readZipEntries(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_TRACE_ARCHIVE_BYTES) {
    throw new Error("Playwright trace archive size is unsafe");
  }
  const minimumOffset = Math.max(0, bytes.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Playwright trace archive has no canonical end record");
  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = bytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  const commentLength = bytes.readUInt16LE(eocdOffset + 20);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries < 3 || totalEntries > MAX_TRACE_ENTRIES
      || eocdOffset + 22 + commentLength !== bytes.length || centralOffset + centralSize !== eocdOffset) {
    throw new Error("Playwright trace archive layout is unsafe");
  }

  const entries = new Map();
  const caseNames = new Set();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > eocdOffset || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Playwright trace central directory is invalid");
    const versionMadeBy = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 8);
    const compression = bytes.readUInt16LE(offset + 10);
    const expectedCrc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const entryCommentLength = bytes.readUInt16LE(offset + 32);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (nextOffset > eocdOffset || diskStart !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
        || (flags & ~0x0808) !== 0 || (compression !== 0 && compression !== 8)) {
      throw new Error("Playwright trace entry metadata is unsafe");
    }
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const normalizedName = name.toLowerCase();
    if (!name || name.includes("\\") || name.startsWith("/") || name.includes(":")
        || name.split("/").some((segment) => !segment || segment === "." || segment === "..")
        || entries.has(name) || caseNames.has(normalizedName)) {
      throw new Error("Playwright trace entry path is unsafe");
    }
    caseNames.add(normalizedName);
    if ((versionMadeBy >>> 8) === 3 && (((externalAttributes >>> 16) & 0xf000) === 0xa000)) {
      throw new Error("Playwright trace archive contains a symbolic link");
    }
    if (uncompressedSize > MAX_TRACE_ENTRY_BYTES || (compressedSize === 0 && uncompressedSize !== 0)
        || uncompressedSize > Math.max(1, compressedSize) * MAX_TRACE_COMPRESSION_RATIO) {
      throw new Error("Playwright trace entry exceeds privacy bounds");
    }
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Playwright trace local entry is invalid");
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localCompression = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlags !== flags || localCompression !== compression || localName !== name || dataOffset + compressedSize > centralOffset) {
      throw new Error("Playwright trace local entry disagrees with its directory");
    }
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const content = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_TRACE_ENTRY_BYTES + 1 });
    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) throw new Error("Playwright trace entry integrity failed");
    totalUncompressed += content.length;
    if (totalUncompressed > MAX_TRACE_ARCHIVE_BYTES) throw new Error("Playwright trace expands beyond its privacy bound");
    entries.set(name, content);
    offset = nextOffset;
  }
  if (offset !== eocdOffset) throw new Error("Playwright trace central directory has trailing data");
  return entries;
}

function writeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const { name, content } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const payload = Buffer.from(content);
    const checksum = crc32(payload);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + payload.length;
  }
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralBytes, end]);
}

function assertSafeTraceUrl(value, { coordinatorOrigin, sessionId, traceId }) {
  if (typeof value !== "string") throw new Error("Playwright trace URL is not a string");
  const candidate = new URL(value);
  const queryNames = [...candidate.searchParams.keys()];
  if (candidate.origin !== coordinatorOrigin || candidate.pathname !== "/ui/open" || candidate.username || candidate.password || candidate.hash
      || queryNames.length !== 2 || !queryNames.includes("session") || !queryNames.includes("trace_id")
      || candidate.searchParams.getAll("session").length !== 1 || candidate.searchParams.get("session") !== sessionId
      || candidate.searchParams.getAll("trace_id").length !== 1 || candidate.searchParams.get("trace_id") !== traceId) {
    throw new Error("Playwright trace contains a noncanonical URL");
  }
}

function inspectTraceValue(value, expected, propertyName = "") {
  if (value == null || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.includes("\0") || SECRET_LIKE_TRACE_VALUE.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^file:/i.test(value)) {
      throw new Error("Playwright trace contains unsafe string data");
    }
    if (propertyName === "url") assertSafeTraceUrl(value, expected);
    else if (/https?:\/\//i.test(value)) throw new Error("Playwright trace contains a URL outside its allowlist");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectTraceValue(item, expected, propertyName);
    return;
  }
  if (typeof value !== "object") throw new Error("Playwright trace contains an unsupported value");
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_TRACE_KEY.test(key)) throw new Error(`Playwright trace contains a forbidden field: ${key}`);
    inspectTraceValue(child, expected, key);
  }
}

function sanitizeTraceValue(value, expected, propertyName = "") {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    inspectTraceValue(value, expected, propertyName);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeTraceValue(item, expected, propertyName));
  if (typeof value !== "object") throw new Error("Playwright trace contains an unsupported value");
  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_TRACE_KEY.test(key)) continue;
    sanitized[key] = sanitizeTraceValue(child, expected, key);
  }
  return sanitized;
}

function sanitizeTraceLines(traceBytes, expected, { dropForbidden = false } = {}) {
  const lines = traceBytes.toString("utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0 || lines.length > 5000) throw new Error("Playwright trace action count is unsafe");
  const kept = [];
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { throw new Error("Playwright trace action JSON is invalid"); }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
      throw new Error("Playwright trace action shape is invalid");
    }
    if (DROPPED_TRACE_EVENT_TYPES.has(event.type)) continue;
    if (!SAFE_TRACE_EVENT_TYPES.has(event.type)) throw new Error("Playwright trace contains an unexpected event type");
    const safeEvent = dropForbidden ? sanitizeTraceValue(event, expected) : event;
    inspectTraceValue(safeEvent, expected);
    kept.push(JSON.stringify(safeEvent));
  }
  if (!kept.some((line) => line.includes('"type":"before"')) || !kept.some((line) => line.includes('"type":"after"'))) {
    throw new Error("Playwright trace contains no action evidence");
  }
  if (!kept.some((line) => line.includes('"url":"'))) throw new Error("Playwright trace contains no validated handoff URL");
  return Buffer.from(`${kept.join("\n")}\n`, "utf8");
}

function sanitizeTraceStacks(stackBytes, expected) {
  let stacks;
  try { stacks = JSON.parse(stackBytes.toString("utf8")); } catch { throw new Error("Playwright trace stacks are invalid"); }
  if (!stacks || typeof stacks !== "object" || Array.isArray(stacks) || !Array.isArray(stacks.files) || !("stacks" in stacks)) {
    throw new Error("Playwright trace stacks have an unexpected shape");
  }
  stacks.files = stacks.files.map((_, index) => `playwright-helper-${index}.mjs`);
  inspectTraceValue(stacks, expected);
  return Buffer.from(`${JSON.stringify(stacks)}\n`, "utf8");
}

function assertTraceArchiveShape(entries) {
  const requiredMembers = new Set(["trace.trace", "trace.network", "trace.stacks"]);
  if (entries.size !== requiredMembers.size) throw new Error("Playwright trace contains an unexpected member");
  for (const required of requiredMembers) {
    if (!entries.has(required)) throw new Error("Playwright trace is missing a required member");
  }
  if (entries.get("trace.network").length !== 0) throw new Error("Playwright trace network member must be empty");
  for (const name of entries.keys()) {
    if (!requiredMembers.has(name)) throw new Error("Playwright trace contains an unexpected member");
  }
}

async function sanitizePlaywrightTrace(rawPath, finalPath, expected) {
  const rawEntries = readZipEntries(await readFile(rawPath));
  assertTraceArchiveShape(rawEntries);
  const safeEntries = [
    { name: "trace.trace", content: sanitizeTraceLines(rawEntries.get("trace.trace"), expected, { dropForbidden: true }) },
    { name: "trace.network", content: Buffer.alloc(0) },
    { name: "trace.stacks", content: sanitizeTraceStacks(rawEntries.get("trace.stacks"), expected) },
  ];
  const finalBytes = writeStoredZip(safeEntries);
  const finalEntries = readZipEntries(finalBytes);
  assertTraceArchiveShape(finalEntries);
  sanitizeTraceLines(finalEntries.get("trace.trace"), expected);
  sanitizeTraceStacks(finalEntries.get("trace.stacks"), expected);
  await writeFile(finalPath, finalBytes, { flag: "wx" });
}

function parseArgs(argv) {
  const allowed = new Set(["--url", "--trace-id", "--artifact-dir", "--coordinator-origin", "--viewer-origin"]);
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || parsed.has(key)) {
      throw new Error("Usage: node scripts/smoke-struct-log-bootstrap.mjs --url <coordinator /ui/open URL> --trace-id <id> --artifact-dir <absolute-dir> --coordinator-origin <origin> --viewer-origin <origin>");
    }
    parsed.set(key, value);
  }
  if (parsed.size !== allowed.size) throw new Error("Missing required bootstrap smoke argument");

  const url = new URL(parsed.get("--url"));
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("--url must identify a credential-free HTTP(S) coordinator page");
  }
  if (url.pathname !== "/ui/open" || url.hash) throw new Error("--url must use the exact coordinator /ui/open handoff");
  const coordinatorOrigin = parseTrustedOrigin(parsed.get("--coordinator-origin"), "--coordinator-origin");
  const viewerOrigin = parseTrustedOrigin(parsed.get("--viewer-origin"), "--viewer-origin");
  if (url.origin !== coordinatorOrigin) throw new Error("--url origin must case-exactly match --coordinator-origin");
  const queryNames = [...url.searchParams.keys()];
  if (queryNames.some((name) => name !== "session" && name !== "trace_id")) {
    throw new Error("--url contains an unexpected handoff query carrier");
  }

  const sessions = url.searchParams.getAll("session");
  const traceValues = url.searchParams.getAll("trace_id");
  if (sessions.length !== 1 || !SESSION_ID_PATTERN.test(sessions[0])) {
    throw new Error("--url must contain exactly one safe review session carrier");
  }
  if (traceValues.length !== 1) throw new Error("--url must contain exactly one root trace carrier");

  const traceId = parsed.get("--trace-id");
  const match = traceId.length <= 200 ? TRACE_ID_PATTERN.exec(traceId) : null;
  if (!match || NESTED_PREFIX_PATTERN.test(match[2])) throw new Error("--trace-id is not a safe documented trace id");
  if (traceValues[0] !== traceId) throw new Error("--url root trace is not case-exactly equal to --trace-id");

  const rawArtifactDir = parsed.get("--artifact-dir");
  if (!path.isAbsolute(rawArtifactDir) || rawArtifactDir.split(/[\\/]/).some((segment) => segment === "." || segment === "..")) {
    throw new Error("--artifact-dir must be an absolute canonical path without dot segments");
  }
  const artifactDir = path.resolve(rawArtifactDir);
  if (!samePath(artifactDir, rawArtifactDir.replace(/[\\/]+$/, ""))) {
    throw new Error("--artifact-dir must use canonical spelling");
  }

  return {
    url: url.href,
    coordinatorOrigin,
    viewerOrigin,
    sessionId: sessions[0],
    traceId,
    artifactDir,
  };
}

function parseTrustedOrigin(value, label) {
  let candidate;
  try {
    candidate = new URL(value);
  } catch {
    throw new Error(`${label} must be a standalone credential-free HTTP(S) origin`);
  }
  if ((candidate.protocol !== "http:" && candidate.protocol !== "https:")
      || candidate.username || candidate.password || candidate.pathname !== "/"
      || candidate.search || candidate.hash) {
    throw new Error(`${label} must be a standalone credential-free HTTP(S) origin`);
  }
  return candidate.origin;
}

function samePath(left, right) {
  const comparisonLeft = process.platform === "win32" ? left.toLowerCase() : left;
  const comparisonRight = process.platform === "win32" ? right.toLowerCase() : right;
  return comparisonLeft === comparisonRight;
}

function isContainedPath(root, candidate) {
  const rootFull = path.resolve(root);
  const candidateFull = path.resolve(candidate);
  if (samePath(rootFull, candidateFull)) return false;
  const rootPrefix = `${rootFull}${path.sep}`;
  const comparisonRoot = process.platform === "win32" ? rootPrefix.toLowerCase() : rootPrefix;
  const comparisonCandidate = process.platform === "win32" ? candidateFull.toLowerCase() : candidateFull;
  return comparisonCandidate.startsWith(comparisonRoot);
}

async function assertTrustedArtifactRoot(artifactDir) {
  await mkdir(artifactDir, { recursive: true });
  const [rootStat, canonicalRoot] = await Promise.all([lstat(artifactDir), realpath(artifactDir)]);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(canonicalRoot, artifactDir)) {
    throw new Error("Artifact root must be a canonical non-reparse directory");
  }
  for (const filename of Object.values(ARTIFACT_NAMES)) {
    const candidate = path.join(artifactDir, filename);
    if (!isContainedPath(artifactDir, candidate)) throw new Error(`Unsafe artifact target: ${filename}`);
    try {
      await lstat(candidate);
      throw new Error(`Artifact target already exists: ${filename}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Artifact target already exists:")) throw error;
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
  }
}

async function createPrivateTraceTemp(artifactDir) {
  const traceTempDir = await mkdtemp(path.join(tmpdir(), "bim-struct-log-trace-"));
  try {
    await chmod(traceTempDir, 0o700);
    const [details, canonicalDir] = await Promise.all([lstat(traceTempDir), realpath(traceTempDir)]);
    if (!details.isDirectory() || details.isSymbolicLink() || !samePath(canonicalDir, traceTempDir)) {
      throw new Error("Playwright trace temporary directory is not canonical");
    }
    if (samePath(traceTempDir, artifactDir)
        || isContainedPath(artifactDir, traceTempDir)
        || isContainedPath(traceTempDir, artifactDir)) {
      throw new Error("Playwright trace temporary directory must be outside the retained artifact directory");
    }
    const traceTempPath = path.join(traceTempDir, "raw-trace.partial.zip");
    if (!isContainedPath(traceTempDir, traceTempPath)) {
      throw new Error("Playwright trace temporary path escaped its private directory");
    }
    return { traceTempDir, traceTempPath };
  } catch (error) {
    await rmdir(traceTempDir).catch(() => undefined);
    throw error;
  }
}

function safeRuntimeId(value, label) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || candidate === NOT_OBSERVED || !SAFE_RUNTIME_ID_PATTERN.test(candidate)) {
    throw new Error(`Rendered ${label} is missing or unsafe`);
  }
  return candidate;
}

function safeConsoleType(value) {
  return new Set(["log", "debug", "info", "error", "warning", "warn"]).has(value) ? value : "other";
}

function safeErrorName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : "Error";
}

function relevantPath(url, coordinatorOrigin, closePath) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== coordinatorOrigin || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname === "/api/internal/viewer-log" || parsed.pathname === closePath) return parsed.pathname;
  } catch {
    return null;
  }
  return null;
}

function parseViewerLogBody(request) {
  const raw = request.postData();
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_VIEWER_LOG_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length <= MAX_VIEWER_LOG_RECORDS ? parsed : null;
  } catch {
    return null;
  }
}

function actionIdsForTrace(records, traceId) {
  const values = [];
  for (const record of records ?? []) {
    if (!record || typeof record !== "object" || record.trace_id !== traceId) continue;
    const actionId = record.data?.evidence_action_id;
    if (typeof actionId === "string" && SAFE_ACTION_ID_PATTERN.test(actionId)) values.push(actionId);
  }
  return values;
}

async function waitForState(page, testId, expected, timeout = 30_000) {
  await page.waitForFunction(
    ({ selector, state }) => document.querySelector(selector)?.getAttribute("data-state") === state,
    { selector: `[data-testid="${testId}"]`, state: expected },
    { timeout },
  );
}

function observeStateTransition(page, testId, expected, timeout = 5_000) {
  return page.evaluate(
    ({ selector, state, timeoutMs }) => new Promise((resolve, reject) => {
      const target = document.querySelector(selector);
      if (!target) {
        reject(new Error(`Missing state target: ${selector}`));
        return;
      }
      if (target.getAttribute("data-state") === state) {
        resolve(true);
        return;
      }
      const timer = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error(`State ${state} was not observed for ${selector}`));
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        if (target.getAttribute("data-state") !== state) return;
        window.clearTimeout(timer);
        observer.disconnect();
        resolve(true);
      });
      observer.observe(target, { attributes: true, attributeFilter: ["data-state"] });
    }),
    { selector: `[data-testid="${testId}"]`, state: expected, timeoutMs: timeout },
  );
}

async function renderedValue(page, testId) {
  const value = await page.locator(`[data-testid="${testId}"] dd`).textContent();
  return value?.trim() ?? "";
}

async function writeJsonArtifact(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function describeArtifact(artifactDir, filename) {
  const candidate = path.join(artifactDir, filename);
  if (!isContainedPath(artifactDir, candidate)) throw new Error(`Artifact escaped root: ${filename}`);
  const [details, canonicalPath] = await Promise.all([lstat(candidate), realpath(candidate)]);
  if (!details.isFile() || details.isSymbolicLink() || details.size <= 0 || !isContainedPath(artifactDir, canonicalPath)) {
    throw new Error(`Expected canonical nonempty artifact: ${filename}`);
  }
  const bytes = await readFile(candidate);
  return {
    path: filename,
    size_bytes: details.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function main() {
  const { url, coordinatorOrigin, viewerOrigin, sessionId, traceId, artifactDir } = parseArgs(process.argv.slice(2));
  await assertTrustedArtifactRoot(artifactDir);
  const artifactPaths = Object.fromEntries(
    Object.entries(ARTIFACT_NAMES).map(([role, filename]) => [role, path.join(artifactDir, filename)]),
  );
  const closePath = `/api/review-sessions/${encodeURIComponent(sessionId)}/close`;
  const { traceTempDir, traceTempPath } = await createPrivateTraceTemp(artifactDir);

  let browser;
  let context;
  let tracingStarted = false;
  let tracingStopped = false;
  let successResult;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    const page = await context.newPage();
    await page.route(
      (candidate) => candidate.origin !== coordinatorOrigin && candidate.origin !== viewerOrigin,
      (route) => route.abort("blockedbyclient"),
    );
    const consoleEvents = [];
    const networkEvents = [];
    const stateTransitions = [];
    let phase = "navigation";
    let eventSeq = 0;
    const forcedRequests = new WeakSet();
    const pushConsole = (event) => {
      if (consoleEvents.length < MAX_COLLECTED_EVENTS) consoleEvents.push({ seq: ++eventSeq, ...event });
    };
    const pushNetwork = (event) => {
      if (networkEvents.length < MAX_COLLECTED_EVENTS) networkEvents.push({ seq: ++eventSeq, ...event });
    };
    const pushState = (state) => {
      if (stateTransitions.at(-1) !== state) stateTransitions.push(state);
    };

    // Install every collector before navigation. Persist only allowlisted metadata:
    // no headers, bodies, full URLs, query strings, or console message text.
    page.on("console", (message) => pushConsole({ type: safeConsoleType(message.type()) }));
    page.on("pageerror", (error) => pushConsole({ type: "pageerror", name: safeErrorName(error?.name) }));
    page.on("request", (request) => {
      const requestPath = relevantPath(request.url(), coordinatorOrigin, closePath);
      if (requestPath && request.method() === "POST") {
        pushNetwork({ kind: "request", method: "POST", path: requestPath, phase, provenance: forcedRequests.has(request) ? "playwright_intercepted" : "coordinator" });
      }
    });
    page.on("response", (response) => {
      const request = response.request();
      const responsePath = relevantPath(response.url(), coordinatorOrigin, closePath);
      if (responsePath && request.method() === "POST") {
        pushNetwork({ kind: "response", method: "POST", path: responsePath, status: response.status(), phase, provenance: forcedRequests.has(request) ? "playwright_intercepted" : "coordinator" });
      }
    });

    await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
    tracingStarted = true;
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error(`Production page navigation failed: ${response?.status() ?? "no_response"}`);

    const finalUrl = new URL(page.url());
    const finalQueryNames = [...finalUrl.searchParams.keys()];
    if ((finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:") || finalUrl.username || finalUrl.password || finalUrl.hash
        || finalUrl.origin !== viewerOrigin || finalUrl.pathname !== "/" || finalQueryNames.length !== 4
        || !["session", "trace_id", "coordinatorApiBase", "coordinatorSocketUrl"].every((name) => finalQueryNames.includes(name))) {
      throw new Error("Final viewer URL is not the canonical credential-free route");
    }
    if (finalUrl.searchParams.getAll("session").length !== 1 || finalUrl.searchParams.get("session") !== sessionId) {
      throw new Error("Final viewer URL did not preserve the case-exact review session");
    }
    if (finalUrl.searchParams.getAll("trace_id").length !== 1 || finalUrl.searchParams.get("trace_id") !== traceId) {
      throw new Error("Final viewer URL did not preserve the case-exact root trace");
    }
    if (finalUrl.searchParams.getAll("coordinatorApiBase").length !== 1 || finalUrl.searchParams.get("coordinatorApiBase") !== coordinatorOrigin) {
      throw new Error("Final viewer URL did not preserve the coordinator authority");
    }
    if (finalUrl.searchParams.getAll("coordinatorSocketUrl").length !== 1 || finalUrl.searchParams.get("coordinatorSocketUrl") !== coordinatorOrigin) {
      throw new Error("Final viewer URL did not preserve the coordinator socket authority");
    }

    await page.locator('[data-testid="structured-log-diagnostics"]').waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForFunction(
      ({ expectedTrace, expectedSession }) => {
        const value = (testId) => document.querySelector(`[data-testid="${testId}"] dd`)?.textContent?.trim();
        return value("structured-log-trace-id") === expectedTrace
          && value("structured-log-session-id") === expectedSession
          && value("structured-log-run-id") !== "未觀測"
          && value("structured-log-conversion-id") !== "未觀測"
          && value("structured-log-kit-id") !== "未觀測";
      },
      { expectedTrace: traceId, expectedSession: sessionId },
      { timeout: 60_000 },
    );
    const renderedTraceId = await renderedValue(page, "structured-log-trace-id");
    const renderedSessionId = await renderedValue(page, "structured-log-session-id");
    if (renderedTraceId !== traceId || renderedSessionId !== sessionId) throw new Error("Rendered diagnostics identity mismatch");
    const runId = safeRuntimeId(await renderedValue(page, "structured-log-run-id"), "browser run id");
    const conversionJobId = safeRuntimeId(await renderedValue(page, "structured-log-conversion-id"), "conversion job id");
    const kitInstanceId = safeRuntimeId(await renderedValue(page, "structured-log-kit-id"), "Kit instance id");
    if (!(await page.locator('[data-testid="structured-log-flush"]').isEnabled())) throw new Error("Structured log diagnostics never became actionable");
    pushState("ready");

    let forcedAttemptCount = 0;
    let actionId = null;
    const forcedStatuses = [];
    const viewerLogMatcher = (candidate) => relevantPath(candidate, coordinatorOrigin, closePath) === "/api/internal/viewer-log";
    await page.route(viewerLogMatcher, async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.continue();
      const actionIds = actionIdsForTrace(parseViewerLogBody(request), traceId);
      if (actionIds.length === 0) return route.continue();
      if (actionIds.length !== 1 || (actionId && actionIds[0] !== actionId)) {
        throw new Error("User-triggered viewer-log batch did not preserve one diagnostics action");
      }
      actionId = actionIds[0];
      forcedAttemptCount += 1;
      forcedStatuses.push(503);
      forcedRequests.add(request);
      await route.fulfill({ status: 503 });
    });

    phase = "forced_failure";
    const forcedLoadingObserved = observeStateTransition(page, "structured-log-flush-status", "loading");
    await page.locator('[data-testid="structured-log-flush"]').click();
    await forcedLoadingObserved;
    pushState("flush_loading");
    await waitForState(page, "structured-log-flush-status", "failure", 30_000);
    pushState("flush_failure");
    if (forcedAttemptCount !== 3 || forcedStatuses.some((status) => status !== 503) || !actionId) {
      throw new Error(`Expected exactly three forced diagnostics failures, observed ${forcedAttemptCount}`);
    }
    await page.locator('[data-testid="structured-log-retry"]').waitFor({ state: "visible" });
    await writeFile(artifactPaths.failure_screenshot, await page.screenshot({ fullPage: true }), { flag: "wx" });

    await page.unroute(viewerLogMatcher);
    phase = "retry_success";
    const retryResponsePromise = page.waitForResponse((candidate) => {
      const request = candidate.request();
      if (request.method() !== "POST" || relevantPath(candidate.url(), coordinatorOrigin, closePath) !== "/api/internal/viewer-log") return false;
      const ids = actionIdsForTrace(parseViewerLogBody(request), traceId);
      return ids.length === 1 && ids[0] === actionId;
    }, { timeout: 30_000 });
    const retryLoadingObserved = observeStateTransition(page, "structured-log-flush-status", "loading");
    await page.locator('[data-testid="structured-log-retry"]').click();
    await retryLoadingObserved;
    pushState("retry_loading");
    const retryResponse = await retryResponsePromise;
    if (retryResponse.status() < 200 || retryResponse.status() >= 300) {
      throw new Error(`Diagnostics retry did not reach a real coordinator 2xx: ${retryResponse.status()}`);
    }
    await waitForState(page, "structured-log-flush-status", "success", 30_000);
    pushState("flush_success");

    phase = "browser_close";
    const closeResponsePromise = page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === "POST"
        && relevantPath(candidate.url(), coordinatorOrigin, closePath) === closePath
        && request.postData() === "{}";
    }, { timeout: 30_000 });
    const closeLoadingObserved = observeStateTransition(page, "review-session-close-status", "closing");
    await page.locator('[data-testid="review-session-close"]').click();
    await closeLoadingObserved;
    pushState("close_loading");
    const closeResponse = await closeResponsePromise;
    if (closeResponse.status() < 200 || closeResponse.status() >= 300) {
      throw new Error(`Browser cooperative close did not return 2xx: ${closeResponse.status()}`);
    }
    await waitForState(page, "review-session-close-status", "closed", 30_000);
    pushState("closed");
    if (stateTransitions.join(",") !== EXPECTED_STATES.join(",")) {
      throw new Error(`Unexpected diagnostics state transitions: ${stateTransitions.join(",")}`);
    }
    await writeFile(artifactPaths.final_screenshot, await page.screenshot({ fullPage: true }), { flag: "wx" });

    const operability = {
      schema_version: "1",
      root_trace_id: traceId,
      review_session_id: sessionId,
      conversion_job_id: conversionJobId,
      kit_instance_id: kitInstanceId,
      browser_run_id: runId,
      handoff_path: "/ui/open",
      viewer_path: finalUrl.pathname,
      state_transitions: stateTransitions,
      failure_provenance: "playwright_intercepted_503",
      forced_viewer_log_statuses: forcedStatuses,
      retry_viewer_log_status: retryResponse.status(),
      close_origin: "browser",
      close_status: "closed",
      close_http_status: closeResponse.status(),
    };
    await writeJsonArtifact(artifactPaths.console_events, { schema_version: "1", events: consoleEvents });
    await writeJsonArtifact(artifactPaths.network_events, { schema_version: "1", events: networkEvents });
    await context.tracing.stop({ path: traceTempPath });
    tracingStopped = true;
    const [traceTempStat, traceTempCanonical] = await Promise.all([lstat(traceTempPath), realpath(traceTempPath)]);
    if (!traceTempStat.isFile() || traceTempStat.isSymbolicLink() || traceTempStat.nlink !== 1
        || !isContainedPath(traceTempDir, traceTempCanonical) || isContainedPath(artifactDir, traceTempCanonical)) {
      throw new Error("Playwright trace temporary file is not canonical");
    }
    await sanitizePlaywrightTrace(traceTempPath, artifactPaths.playwright_trace, { coordinatorOrigin, sessionId, traceId });
    await unlink(traceTempPath);

    const artifacts = {};
    for (const [role, filename] of Object.entries(ARTIFACT_NAMES)) {
      if (role === "operability") continue;
      artifacts[role] = await describeArtifact(artifactDir, filename);
    }
    operability.artifacts = artifacts;
    await writeJsonArtifact(artifactPaths.operability, operability);
    artifacts.operability = await describeArtifact(artifactDir, ARTIFACT_NAMES.operability);
    successResult = {
      ok: true,
      handoffOrigin: coordinatorOrigin,
      handoffPath: "/ui/open",
      viewerOrigin: finalUrl.origin,
      viewerPath: finalUrl.pathname,
      traceId,
      sessionId,
      runId,
      conversionJobId,
      kitInstanceId,
      stateTransitions,
      failureProvenance: "playwright_intercepted_503",
      forcedViewerLogStatuses: forcedStatuses,
      retryViewerLogStatus: retryResponse.status(),
      actionId,
      closeOrigin: "browser",
      closeStatus: "closed",
      closeSessionId: sessionId,
      closeHttpStatus: closeResponse.status(),
      artifacts,
    };
  } finally {
    try {
      if (context && tracingStarted && !tracingStopped) await context.tracing.stop().catch(() => undefined);
      await unlink(traceTempPath).catch((error) => {
        if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
      });
      await rmdir(traceTempDir);
    } finally {
      if (browser) await browser.close();
    }
  }
  if (!successResult) throw new Error("Browser smoke did not produce a result");
  process.stdout.write(`${JSON.stringify(successResult)}\n`);
}

main().catch(() => {
  process.stderr.write("STRUCT_LOG_BROWSER_HELPER_FAILED\n");
  process.exitCode = 1;
});
