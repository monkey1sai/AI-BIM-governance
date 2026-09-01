// Runtime E2E readiness predicates, extracted from verify-runtime-e2e-cdp.mjs so the
// readiness rules can be unit-tested without launching Chrome. Pure functions only —
// no I/O, no CDP, no module-level side effects.

import { createHash } from "node:crypto";

export function consoleText(events) {
  return events
    .flatMap((event) => event.args || [])
    .map((arg) => String(arg.value || arg.description || arg.type || ""))
    .join("\n");
}

function truthyRequireReal(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function truthySkipped(value) {
  return value === true
    || value === 1
    || value === "1"
    || value === "true"
    || (typeof value === "number" && value > 0);
}

const REAL_E2E_BYPASS_MODES = new Set(["skip", "skipped", "mock", "simulation", "bypass", "shadow"]);
const STACK_MANIFEST_SCHEMA = "isolated-branch-stack/v1";
const STACK_MANIFEST_KIND = "isolated_branch_stack";
const STACK_PROCESS_ROLES = Object.freeze(["coordinator", "governance"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_MANIFEST_BYTES = 1024 * 1024;

const comparablePath = (value, separator) => separator === "\\" ? value.toLowerCase() : value;
const samePath = (left, right, separator) => comparablePath(left, separator) === comparablePath(right, separator);
const isInside = (candidate, root, separator) => samePath(candidate, root, separator)
  || comparablePath(candidate, separator).startsWith(`${comparablePath(root, separator)}${separator}`);
const pathSeparatorForRoot = (root) => /^[A-Za-z]:[\\/]/u.test(root) || root.startsWith("\\\\") ? "\\" : root.startsWith("/") ? "/" : undefined;

/**
 * Verify the physical isolated-stack manifest through injected, read-only host ports.
 * This keeps the policy unit-testable while requiring the executable collector to bind
 * file identity, current worktree/HEAD, and live backend ownership before real E2E.
 */
export async function inspectRealE2EManifest(input = {}, ports = {}) {
  const manifestPath = typeof input.manifestPath === "string" ? input.manifestPath.trim() : "";
  const worktreeRoot = typeof input.worktreeRoot === "string" ? input.worktreeRoot.trim() : "";
  if (!manifestPath || !worktreeRoot) return { ready: false, reason: "REAL_E2E_MANIFEST_MISSING" };
  if (!["readManifest", "realpath", "readHead", "readStatus", "inspectStack"].every((name) => typeof ports[name] === "function")) {
    return { ready: false, reason: "REAL_E2E_MANIFEST_PORTS_INVALID" };
  }

  try {
    const [resolvedRoot, resolvedManifestPath] = await Promise.all([
      ports.realpath(worktreeRoot),
      ports.realpath(manifestPath),
    ]);
    if (typeof resolvedRoot !== "string" || typeof resolvedManifestPath !== "string") {
      return { ready: false, reason: "REAL_E2E_MANIFEST_IDENTITY_INVALID" };
    }
    const separator = pathSeparatorForRoot(resolvedRoot);
    if (!separator || (input.separator !== undefined && input.separator !== separator)) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_IDENTITY_INVALID" };
    }
    const evidenceRoot = `${resolvedRoot}${separator}artifacts${separator}e2e`;
    if (!isInside(resolvedManifestPath, evidenceRoot, separator)) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_PATH_MISMATCH" };
    }

    const manifestBytes = await ports.readManifest(resolvedManifestPath);
    if (!(manifestBytes instanceof Uint8Array) || manifestBytes.byteLength === 0 || manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_CONTENT_INVALID" };
    }
    const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
    } catch {
      return { ready: false, reason: "REAL_E2E_MANIFEST_CONTENT_INVALID" };
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || !SHA256_PATTERN.test(manifestDigest)
      || manifest.schema_version !== STACK_MANIFEST_SCHEMA || manifest.stack_kind !== STACK_MANIFEST_KIND
      || typeof manifest.change_id !== "string" || typeof manifest.run_id !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(manifest.change_id)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(manifest.run_id)) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_CONTENT_INVALID" };
    }

    const manifestRoot = await ports.realpath(manifest.worktree_root);
    if (!samePath(manifestRoot, resolvedRoot, separator)) return { ready: false, reason: "REAL_E2E_MANIFEST_WORKTREE_MISMATCH" };
    const head = String(await ports.readHead(resolvedRoot)).trim();
    if (!/^[0-9a-f]{40}$/u.test(head) || manifest.head_sha !== head) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_HEAD_MISMATCH" };
    }
    if (String(await ports.readStatus(resolvedRoot)) !== "") {
      return { ready: false, reason: "REAL_E2E_WORKTREE_DIRTY" };
    }

    const stackOffset = Number(manifest.ports?.coordinator) - 8005;
    if (!Number.isSafeInteger(stackOffset) || stackOffset < 0 || stackOffset > 4
      || manifest.ports?.governance !== 49103 + stackOffset
      || manifest.ports?.viewer !== 5180 + stackOffset
      || manifest.base_urls?.coordinator !== `http://127.0.0.1:${8005 + stackOffset}`
      || manifest.base_urls?.governance !== `http://127.0.0.1:${49103 + stackOffset}`
      || manifest.base_urls?.viewer !== `http://127.0.0.1:${5180 + stackOffset}`
      || manifest.lifecycle_owners?.coordinator !== "repo_launcher"
      || manifest.lifecycle_owners?.governance !== "repo_launcher"
      || manifest.lifecycle_owners?.viewer !== "playwright_webserver"
      || manifest.viewer?.expected_port !== 5180 + stackOffset
      || manifest.viewer?.owner !== "playwright_webserver"
      || manifest.viewer?.managed_by_launcher !== false) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_ENDPOINT_MISMATCH" };
    }

    if (!Array.isArray(manifest.processes) || manifest.processes.length !== STACK_PROCESS_ROLES.length) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_PROCESS_INVALID" };
    }
    const roles = [];
    const pids = new Set();
    for (const processRecord of manifest.processes) {
      if (!processRecord || typeof processRecord !== "object" || !STACK_PROCESS_ROLES.includes(processRecord.role)
        || !Number.isSafeInteger(processRecord.pid) || processRecord.pid <= 0 || pids.has(processRecord.pid)
        || !["entrypoint", "command_line", "creation_identity"].every((key) => typeof processRecord[key] === "string" && processRecord[key].length > 0)) {
        return { ready: false, reason: "REAL_E2E_MANIFEST_PROCESS_INVALID" };
      }
      roles.push(processRecord.role);
      pids.add(processRecord.pid);
    }
    if (roles.sort().join(":") !== [...STACK_PROCESS_ROLES].sort().join(":")) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_PROCESS_INVALID" };
    }

    const status = await ports.inspectStack({
      worktreeRoot: resolvedRoot,
      changeId: manifest.change_id,
      runId: manifest.run_id,
    });
    const statusManifestPath = status && typeof status.manifest_path === "string"
      ? await ports.realpath(status.manifest_path)
      : "";
    if (!status || status.status !== "active" || status.stack_kind !== STACK_MANIFEST_KIND
      || !samePath(statusManifestPath, resolvedManifestPath, separator) || !Array.isArray(status.backend)
      || status.backend.length !== STACK_PROCESS_ROLES.length
      || status.viewer?.expected_port !== manifest.viewer.expected_port
      || status.viewer?.owner !== "playwright_webserver"
      || status.viewer?.managed_by_launcher !== false
      || status.backend.some((entry) => !entry || entry.owned !== true || entry.ready !== true
        || !manifest.processes.some((expected) => expected.role === entry.role && expected.pid === entry.pid))) {
      return { ready: false, reason: "REAL_E2E_MANIFEST_LINEAGE_MISMATCH" };
    }
    return {
      ready: true,
      reason: "REAL_E2E_MANIFEST_VERIFIED",
      binding: {
        manifest_path: resolvedManifestPath,
        manifest_digest: manifestDigest,
        head_sha: head,
        worktree_root: resolvedRoot,
        viewer_base_url: manifest.base_urls.viewer,
        coordinator_base_url: manifest.base_urls.coordinator,
        governance_base_url: manifest.base_urls.governance,
        processes: manifest.processes
          .map(({ role, pid, creation_identity }) => ({ role, pid, creation_identity }))
          .sort((left, right) => left.role.localeCompare(right.role)),
      },
    };
  } catch {
    return { ready: false, reason: "REAL_E2E_MANIFEST_UNAVAILABLE" };
  }
}

/**
 * Apply the explicit real-browser E2E policy without reading process state.
 * Callers pass launcher-derived values so this predicate remains unit-testable.
 */
export function inspectRealE2E(input = {}) {
  const requireReal = truthyRequireReal(
    input.requireReal ?? input.e2eRequireReal ?? input.E2E_REQUIRE_REAL,
  );
  if (!requireReal) {
    return { ready: true, reason: "REAL_E2E_NOT_REQUIRED" };
  }

  const skipped = truthySkipped(input.skipped ?? input.e2eSkipped)
    || (typeof input.skippedCount === "number" && input.skippedCount > 0);
  if (skipped) {
    return { ready: false, reason: "REAL_E2E_SKIPPED" };
  }

  const mode = input.mode ?? input.e2eMode ?? input.verificationMode;
  if (typeof mode === "string" && REAL_E2E_BYPASS_MODES.has(mode.trim().toLowerCase())) {
    return { ready: false, reason: "REAL_E2E_MODE_BYPASS" };
  }

  const manifest = input.manifestPresent
    ?? input.e2eManifestPresent
    ?? (Boolean(input.manifest) || Boolean(input.manifestPath));
  if (manifest !== true) {
    return { ready: false, reason: "REAL_E2E_MANIFEST_MISSING" };
  }
  if (input.kitAuthorityPresent !== true) {
    return { ready: false, reason: "REAL_E2E_KIT_AUTHORITY_MISSING" };
  }

  return { ready: true, reason: "REAL_E2E_EVIDENCE_PRESENT" };
}

export function isRealE2EReady(input = {}) {
  return inspectRealE2E(input).ready;
}

const DATA_CHANNEL_EVIDENCE = [
  ["bodyHasDataChannelReply", (state) => Boolean(state.bodyHasDataChannelReply)],
  ["bodyHasMakePickableResponse", (state) => Boolean(state.bodyHasMakePickableResponse)],
  ["bodyHasLoadingStateResponse", (state) => Boolean(state.bodyHasLoadingStateResponse)],
  ["makePrimsPickableResponse", (state, log) => log.includes("makePrimsPickableResponse")],
  ["loadingStateResponse", (state, log) => log.includes("loadingStateResponse")],
];

function dataChannelMatch(state, log, requireDataChannel) {
  if (!requireDataChannel) {
    return "requireDataChannel:false";
  }
  for (const [key, test] of DATA_CHANNEL_EVIDENCE) {
    if (test(state, log)) return key;
  }
  return null;
}

export function inspectReadiness(state, consoleEvents, options = {}) {
  const requireDataChannel = options.requireDataChannel !== false;
  const requireStageSuccess = options.requireStageSuccess !== false;
  const realE2E = inspectRealE2E(options);
  const log = consoleText(consoleEvents);
  const hasOpenedStageSuccess =
    state.bodyHasModelLoaded
    || (
      state.bodyHasOpenedStageResult
      && !log.includes("Kit App communicates there was an error loading")
    )
    || (log.includes("openedStageResult") && log.includes('"result":"success"'));
  const hasStageQuerySuccess =
    log.includes("Kit App sent stage prims")
    || log.includes("getChildrenResponse");
  const hasStageSuccess =
    hasOpenedStageSuccess
    || hasStageQuerySuccess;
  // Every disjunct MUST be an inbound signal from Kit. `loadingStateQuery` used to be
  // accepted here, but that is the string the viewer emits when it *asks* — accepting it
  // let a session with zero Kit replies satisfy the DataChannel gate (#671 line, 2026-08-20).
  // `getChildrenResponse` is deliberately excluded: it is the stage axis' signal and is
  // already consumed by hasStageQuerySuccess; reusing it here would collapse the two axes.
  const matchedEvidence = dataChannelMatch(state, log, requireDataChannel);
  const ready = Boolean(
    state
    && state.readyState >= 2
    && state.videoWidth > 0
    && state.videoHeight > 0
    && state.srcObject
    && state.bodyHasUsdcPanel
    && state.bodyHasArtifactUrl
    && (!requireStageSuccess || hasStageSuccess || state.bodyHasSpectatorReady)
    && (!requireDataChannel || (matchedEvidence && matchedEvidence !== "requireDataChannel:false"))
    && realE2E.ready
    && !state.bodyHasWaitingText
    && state.pixelStats
    && state.pixelStats.nonBlack > 100
  );
  return { ready, matchedEvidence, realE2E };
}

export function isReady(state, consoleEvents, options = {}) {
  return inspectReadiness(state, consoleEvents, options).ready;
}
