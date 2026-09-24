#!/usr/bin/env node

// Maps a pull request's changed paths onto the service suites that read those
// paths, and derives the aggregate verdict the required `pr-safety` job enforces.
//
// Two modes:
//   --changed-paths-file <path> [--github-output <path>]
//       classify changed paths into per-scope booleans
//   --needs-file <path>
//       validate a toJSON(needs) payload against the classified scopes
//
// Both modes fail closed: an unmapped path fans out to every scope, and an
// unexpected job result is rejected rather than treated as a pass.

import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Job ids in .github/workflows/pr-safety.yml are these exact strings, so the
// aggregate verdict never has to translate between a scope and a job name.
export const SCOPES = Object.freeze([
  "coordinator",
  "viewer",
  "governance",
  "streaming",
  "cfd_tools",
  "kit_manager_api",
  "kit_manager_web",
  "root_contracts",
  "vocabulary",
]);

const STREAMING_MESSAGING =
  "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/" +
  "ezplus/bim_review_stream/messaging/";

// `tools/cfd/bimcfd/__init__.py` points `__path__` at this package, so the
// offline CLI suite executes exactly these files.
const CFD_PIPELINE_PREFIX = `${STREAMING_MESSAGING}cfd_pipeline/`;

// web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs derives all three
// generated files from the one schema; --check compares them.
const VOCABULARY_PATHS = Object.freeze([
  "tests/contracts/kit-datachannel-v1.schema.json",
  "web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs",
  "web-viewer-sample/scripts/generate-kit-command-vocabulary.test.mjs",
  "web-viewer-sample/src/generated/kit-command-vocabulary.ts",
  "bim-review-coordinator/src/generated/kit-command-vocabulary.ts",
  `${STREAMING_MESSAGING}kit_command_vocabulary.py`,
]);

// The viewer reads these from docs/plans: EdgeConsole.tsx imports the token
// stylesheet into the production bundle and design-token-authority.test.ts reads
// it; design-system-rebaseline-authority.test.mjs reads the reference manifest.
const VIEWER_DESIGN_FILES = Object.freeze([
  "docs/plans/ai-bim-governance.css",
  "docs/plans/design-system-reference.manifest.json",
]);

// Changing the workflow or this classifier fans out to everything, so a pull
// request cannot narrow its own verification surface without running it all.
const FULL_FANOUT_PATHS = Object.freeze([
  ".github/workflows/pr-safety.yml",
  ".github/scripts/ci-scope.mjs",
  ".github/scripts/ci-scope.test.mjs",
]);

// Root files that no in-scope suite reads.
const NO_SCOPE_FILES = Object.freeze([
  ".coderabbit.yaml",
  ".dockerignore",
  ".gitattributes",
  ".gitignore",
  ".gitnexusignore",
  ".ignore",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "compose.host-kit.yml",
  "compose.runtime-manager.yml",
  "env.sample",
  "sources.allowlist.example.json",
]);

const prefix = (value) => (path) => path.startsWith(value);
const exact = (values) => (path) => values.includes(path);

// Every rule that matches contributes its scopes; the result is their union. A
// path that matches no rule at all is unknown and fans out to every scope.
export const RULES = Object.freeze([
  { id: "full-fanout", test: exact(FULL_FANOUT_PATHS), scopes: SCOPES },

  // tests/contracts/** holds the cross-service schemas. The coordinator, the
  // viewer and the streaming extension all read them from production code as
  // well as tests, and the root suite validates them directly.
  {
    id: "shared-contracts",
    test: prefix("tests/contracts/"),
    scopes: ["coordinator", "viewer", "streaming", "root_contracts"],
  },
  { id: "root-suite", test: prefix("tests/"), scopes: ["root_contracts"] },

  // The root parity suite reads one file from each service, so any service
  // source change can break it.
  {
    id: "coordinator",
    test: prefix("bim-review-coordinator/"),
    scopes: ["coordinator", "root_contracts"],
  },
  { id: "viewer", test: prefix("web-viewer-sample/"), scopes: ["viewer", "root_contracts"] },
  {
    id: "governance",
    test: prefix("governance-service/"),
    scopes: ["governance", "root_contracts"],
  },
  {
    id: "streaming",
    test: prefix("bim-streaming-server/"),
    scopes: ["streaming", "root_contracts"],
  },
  { id: "cfd-pipeline", test: prefix(CFD_PIPELINE_PREFIX), scopes: ["streaming", "cfd_tools"] },
  { id: "cfd-tools", test: prefix("tools/cfd/"), scopes: ["cfd_tools"] },
  {
    id: "kit-manager-api",
    test: prefix("services/kit-manager-api/"),
    scopes: ["kit_manager_api", "root_contracts"],
  },
  {
    id: "kit-manager-web",
    test: prefix("apps/kit-manager-web/"),
    scopes: ["kit_manager_web", "root_contracts"],
  },

  // governance-service/tests/test_search_model.py and the root lineage and
  // structured-log contract tests load these fixtures.
  { id: "fixtures", test: prefix("_fixtures/"), scopes: ["governance", "root_contracts"] },

  // tests/test_runtime_command_contracts.py parses
  // docs/contracts/streaming-datachannel-events.md as a contract source.
  { id: "docs-contracts", test: prefix("docs/contracts/"), scopes: ["root_contracts"] },

  { id: "vocabulary", test: exact(VOCABULARY_PATHS), scopes: ["vocabulary"] },

  // The viewer suite reads VIEWER_DESIGN_FILES, and its prebuild step
  // (web-viewer-sample/scripts/sync-design-assets.mjs) copies docs/plans/assets
  // and docs/plans/uploads into public/.
  {
    id: "viewer-design-inputs",
    test: (path) =>
      VIEWER_DESIGN_FILES.includes(path) ||
      path.startsWith("docs/plans/assets/") ||
      path.startsWith("docs/plans/uploads/"),
    scopes: ["viewer"],
  },

  // Apart from those viewer inputs, documentation, recorded evidence, runtime
  // data roots and agent configuration are not read by any suite this workflow
  // runs.
  { id: "docs", test: prefix("docs/"), scopes: [] },
  { id: "artifacts", test: prefix("artifacts/"), scopes: [] },
  { id: "storage", test: prefix("storage/"), scopes: [] },
  { id: "agent-config", test: (path) => path.startsWith(".claude/") || path.startsWith(".codex/"), scopes: [] },

  // PowerShell script suites and the compose config check are deliberately not
  // part of this workflow; see docs/agents/local-verification.md.
  { id: "scripts", test: prefix("scripts/"), scopes: [] },
  { id: "infra", test: prefix("infra/"), scopes: [] },

  // .github paths other than the two fanned out above (issue templates, the
  // pull request template, pr-safety.mjs itself, which the aggregate job always
  // runs anyway).
  { id: "github-meta", test: prefix(".github/"), scopes: [] },

  { id: "env-examples", test: (path) => /^\.env[^/]*\.example$/.test(path), scopes: [] },
  { id: "root-files", test: exact(NO_SCOPE_FILES), scopes: [] },
]);

export function classifyPath(path) {
  const matched = RULES.filter((rule) => rule.test(path));
  if (matched.length === 0) {
    return { rules: [], scopes: [...SCOPES], unknown: true };
  }
  const scopes = new Set();
  for (const rule of matched) {
    for (const scope of rule.scopes) {
      scopes.add(scope);
    }
  }
  return {
    rules: matched.map((rule) => rule.id),
    scopes: SCOPES.filter((scope) => scopes.has(scope)),
    unknown: false,
  };
}

export function classifyPaths(paths) {
  const scopes = Object.fromEntries(SCOPES.map((scope) => [scope, false]));
  const unknownPaths = [];

  for (const path of paths) {
    const result = classifyPath(path);
    if (result.unknown) {
      unknownPaths.push(path);
    }
    for (const scope of result.scopes) {
      scopes[scope] = true;
    }
  }

  return { scopes, unknownPaths, changedPaths: paths.length };
}

export function parseChangedPaths(text) {
  const paths = [];
  for (const raw of text.split("\n")) {
    const path = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (path === "") {
      continue;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(path)) {
      throw new Error("changed path contains a control character");
    }
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
      throw new Error(`changed path is not a repository-relative path: ${path}`);
    }
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

const JOB_RESULTS = Object.freeze(["success", "failure", "cancelled", "skipped"]);

// Jobs that run on every pull request regardless of scope, so anything other
// than success is a failure. `safety` carries the diff whitespace and
// conflict-marker, changed JSON, changed PowerShell and secret-pattern scan.
export const ALWAYS_REQUIRED_JOBS = Object.freeze(["safety"]);

// `needs` is the parsed toJSON(needs) payload from the aggregate job.
export function evaluateAggregate(needs) {
  const failures = [];

  if (!needs || typeof needs !== "object" || Array.isArray(needs)) {
    return { ok: false, failures: ["needs payload is not an object"] };
  }

  const changes = needs.changes;
  if (!changes || typeof changes !== "object") {
    return { ok: false, failures: ["needs.changes is missing"] };
  }
  if (changes.result !== "success") {
    failures.push(
      `scope classifier did not succeed (changes=${JSON.stringify(changes.result)}); ` +
        "refusing a skipped-success required check",
    );
  }

  for (const name of ALWAYS_REQUIRED_JOBS) {
    const job = needs[name];
    if (!job || typeof job !== "object") {
      failures.push(`job ${name} is missing from needs; it was never created`);
      continue;
    }
    if (!JOB_RESULTS.includes(job.result)) {
      failures.push(`job ${name} reported an unexpected result: ${JSON.stringify(job.result)}`);
      continue;
    }
    if (job.result !== "success") {
      failures.push(`job ${name} runs on every pull request but ended ${job.result}`);
    }
  }

  const outputs = changes.outputs ?? {};

  for (const scope of SCOPES) {
    const declared = outputs[scope];
    if (declared !== "true" && declared !== "false") {
      failures.push(`scope ${scope} has a non-canonical classifier output: ${JSON.stringify(declared)}`);
      continue;
    }
    const job = needs[scope];
    if (!job || typeof job !== "object") {
      failures.push(`job ${scope} is missing from needs; it was never created`);
      continue;
    }
    const result = job.result;
    if (!JOB_RESULTS.includes(result)) {
      failures.push(`job ${scope} reported an unexpected result: ${JSON.stringify(result)}`);
      continue;
    }
    if (declared === "true" && result !== "success") {
      failures.push(`job ${scope} is in scope for this diff but ended ${result}`);
      continue;
    }
    if (declared === "false" && result !== "skipped" && result !== "success") {
      failures.push(`job ${scope} is out of scope for this diff but ended ${result}`);
    }
  }

  const unexpected = Object.keys(needs).filter(
    (key) => key !== "changes" && !ALWAYS_REQUIRED_JOBS.includes(key) && !SCOPES.includes(key),
  );
  if (unexpected.length > 0) {
    failures.push(`needs contains jobs the verdict does not understand: ${unexpected.join(", ")}`);
  }

  return { ok: failures.length === 0, failures };
}

function parseArguments(argv) {
  const usage =
    "usage: ci-scope.mjs --changed-paths-file <path> [--github-output <path>]\n" +
    "       ci-scope.mjs --needs-file <path>";
  const values = new Map();
  if (argv.length === 0 || argv.length % 2 !== 0) {
    throw new Error(usage);
  }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    const key = name?.startsWith("--") ? name.slice(2) : "";
    if (!["changed-paths-file", "github-output", "needs-file"].includes(key) || values.has(key)) {
      throw new Error(usage);
    }
    values.set(key, value);
  }
  if (values.has("needs-file") === values.has("changed-paths-file")) {
    throw new Error(usage);
  }
  return {
    changedPathsFile: values.get("changed-paths-file"),
    githubOutput: values.get("github-output"),
    needsFile: values.get("needs-file"),
  };
}

function main(argv) {
  const options = parseArguments(argv);

  if (options.needsFile) {
    const needs = JSON.parse(readFileSync(options.needsFile, "utf8"));
    const verdict = evaluateAggregate(needs);
    if (!verdict.ok) {
      throw new Error(`aggregate verdict rejected:\n${verdict.failures.map((f) => `- ${f}`).join("\n")}`);
    }
    console.log("ci-scope: every in-scope job succeeded and every out-of-scope job was skipped");
    return;
  }

  const paths = parseChangedPaths(readFileSync(options.changedPathsFile, "utf8"));
  const { scopes, unknownPaths } = classifyPaths(paths);

  if (options.githubOutput) {
    const lines = SCOPES.map((scope) => `${scope}=${scopes[scope] ? "true" : "false"}`);
    appendFileSync(options.githubOutput, `${lines.join("\n")}\n`, "utf8");
  }

  if (unknownPaths.length > 0) {
    console.log(
      `ci-scope: ${unknownPaths.length} unmapped path(s) fanned out to every scope:\n` +
        unknownPaths.map((path) => `- ${path}`).join("\n"),
    );
  }
  const selected = SCOPES.filter((scope) => scopes[scope]);
  console.log(
    `ci-scope: ${paths.length} changed path(s) -> ` +
      (selected.length > 0 ? selected.join(", ") : "no service scope"),
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`ci-scope failed: ${error.message}`);
    process.exitCode = 1;
  }
}
