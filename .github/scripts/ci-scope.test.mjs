import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALWAYS_REQUIRED_JOBS,
  RULES,
  SCOPES,
  classifyPath,
  classifyPaths,
  evaluateAggregate,
  parseChangedPaths,
} from "./ci-scope.mjs";

const WORKFLOW_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "workflows",
  "pr-safety.yml",
);

const STREAMING_MESSAGING =
  "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/" +
  "ezplus/bim_review_stream/messaging/";

function scopesFor(...paths) {
  const { scopes } = classifyPaths(paths);
  return SCOPES.filter((scope) => scopes[scope]);
}

function needsPayload({ changes = "success", outputs = {}, results = {}, safety = "success" } = {}) {
  const payload = {
    changes: {
      result: changes,
      outputs: Object.fromEntries(
        SCOPES.map((scope) => [scope, String(outputs[scope] ?? false)]),
      ),
    },
  };
  if (safety !== null) {
    payload.safety = { result: safety };
  }
  for (const scope of SCOPES) {
    payload[scope] = { result: results[scope] ?? (outputs[scope] ? "success" : "skipped") };
  }
  return payload;
}

test("the workflow declares one job per scope and the aggregate job needs them all", () => {
  // Windows checkouts with core.autocrlf=true materialise this file with CRLF;
  // the job-block patterns below are written for LF.
  const workflow = readFileSync(WORKFLOW_PATH, "utf8").replace(/\r\n/g, "\n");

  // A required job that is never created stays pending forever, so every scope
  // must have an unconditional job definition the aggregate job depends on.
  const jobIds = [...workflow.matchAll(/^ {2}([A-Za-z0-9_-]+):$/gm)].map((match) => match[1]);
  for (const jobId of [...SCOPES, ...ALWAYS_REQUIRED_JOBS]) {
    assert.ok(jobIds.includes(jobId), `workflow is missing the job ${jobId}`);
  }
  assert.ok(jobIds.includes("pr-safety"), "the required job must keep the id pr-safety");

  const needsBlock = workflow.match(/^ {2}pr-safety:\n(?: {4}.*\n| *\n)*?(?= {2}\S|$)/m)?.[0] ?? "";
  for (const jobId of [...SCOPES, ...ALWAYS_REQUIRED_JOBS]) {
    assert.match(
      needsBlock,
      new RegExp(`^ {6}- ${jobId}$`, "m"),
      `pr-safety does not list ${jobId} in needs`,
    );
  }

  // `safety` must stay unconditional: an `if:` there would make GitHub report a
  // skip as a pass for the one job that scans every diff.
  const safetyBlock = workflow.match(/^ {2}safety:\n(?: {4}.*\n| *\n)*?(?= {2}\S|$)/m)?.[0] ?? "";
  assert.notEqual(safetyBlock, "", "workflow is missing the safety job");
  assert.equal(/^ {4}(if|needs):/m.test(safetyBlock), false, "safety must have no if: or needs:");
  assert.match(safetyBlock, /^ {10}fetch-depth: 0$/m, "safety needs full history for base..head");

  // A matrix leg reports as "job (leg)" and a reusable workflow as
  // "caller / callee"; either rename would leave pull requests waiting on a
  // context that never reports.
  assert.equal(/^ {4}strategy:$/m.test(workflow), false, "no needed job may use a matrix");
  assert.equal(/^ {4}uses:/m.test(workflow), false, "no needed job may be a reusable workflow");
});

test("every rule only emits declared scopes", () => {
  for (const rule of RULES) {
    for (const scope of rule.scopes) {
      assert.ok(SCOPES.includes(scope), `rule ${rule.id} emits unknown scope ${scope}`);
    }
  }
});

test("a service source change runs that service and the root parity suite", () => {
  assert.deepEqual(scopesFor("bim-review-coordinator/src/app.ts"), [
    "coordinator",
    "root_contracts",
  ]);
  assert.deepEqual(scopesFor("web-viewer-sample/src/Window.tsx"), ["viewer", "root_contracts"]);
  assert.deepEqual(scopesFor("governance-service/diff_engine/engine.py"), [
    "governance",
    "root_contracts",
  ]);
  assert.deepEqual(scopesFor(`${STREAMING_MESSAGING}mutation_gate.py`), [
    "streaming",
    "root_contracts",
  ]);
  assert.deepEqual(scopesFor("services/kit-manager-api/app/kit_service.py"), [
    "kit_manager_api",
    "root_contracts",
  ]);
  assert.deepEqual(scopesFor("apps/kit-manager-web/src/models.ts"), [
    "kit_manager_web",
    "root_contracts",
  ]);
});

test("shared contract schemas fan out to every suite that reads them", () => {
  assert.deepEqual(scopesFor("tests/contracts/coordinator-browser-api-v1.openapi.json"), [
    "coordinator",
    "viewer",
    "streaming",
    "root_contracts",
  ]);
});

test("the Kit DataChannel schema and its three generated outputs add the vocabulary check", () => {
  assert.ok(scopesFor("tests/contracts/kit-datachannel-v1.schema.json").includes("vocabulary"));
  assert.deepEqual(scopesFor("web-viewer-sample/src/generated/kit-command-vocabulary.ts"), [
    "viewer",
    "root_contracts",
    "vocabulary",
  ]);
  assert.deepEqual(scopesFor("bim-review-coordinator/src/generated/kit-command-vocabulary.ts"), [
    "coordinator",
    "root_contracts",
    "vocabulary",
  ]);
  assert.deepEqual(scopesFor(`${STREAMING_MESSAGING}kit_command_vocabulary.py`), [
    "streaming",
    "root_contracts",
    "vocabulary",
  ]);
});

test("cfd_pipeline is shared by the streaming service and the offline CLI suite", () => {
  // tools/cfd/bimcfd/__init__.py points __path__ at cfd_pipeline, so editing the
  // pipeline must run both suites.
  assert.deepEqual(scopesFor(`${STREAMING_MESSAGING}cfd_pipeline/preprocess.py`), [
    "streaming",
    "cfd_tools",
    "root_contracts",
  ]);
  assert.deepEqual(scopesFor("tools/cfd/tests/test_defaults.py"), ["cfd_tools"]);
  // A streaming file outside cfd_pipeline does not pull in the CLI suite.
  assert.deepEqual(scopesFor(`${STREAMING_MESSAGING}cfd_job_service.py`), [
    "streaming",
    "root_contracts",
  ]);
});

test("fixtures and contract docs reach the suites that load them", () => {
  assert.deepEqual(scopesFor("_fixtures/a4-semantic-search/element_mapping.json"), [
    "governance",
    "root_contracts",
  ]);
  assert.deepEqual(scopesFor("docs/contracts/streaming-datachannel-events.md"), [
    "root_contracts",
  ]);
});

test("the viewer's build and unit inputs under docs/plans run the viewer suite", () => {
  for (const path of [
    "docs/plans/ai-bim-governance.css",
    "docs/plans/design-system-reference.manifest.json",
    "docs/plans/assets/vp-tower.png",
    "docs/plans/uploads/ai-bim-geo-viewer-A5.png",
  ]) {
    assert.deepEqual(scopesFor(path), ["viewer"], path);
  }
});

test("docs, evidence, scripts and agent configuration select no service scope", () => {
  assert.deepEqual(
    scopesFor(
      "docs/architecture/mutation-gate-adr.md",
      "docs/evidence/cfd-case-run-cutover-2026-09-23/compare.json",
      "docs/plans/docs-plans-README.md",
      "artifacts/e2e/report.json",
      "storage/README.md",
      ".claude/settings.json",
      ".codex/config.toml",
      "scripts/tests/test-design-system-reference.ps1",
      "infra/docker/Dockerfile",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/scripts/pr-safety.mjs",
      ".env.web-plane.host-kit.example",
      "README.md",
      "AGENTS.md",
      "compose.host-kit.yml",
    ),
    [],
  );
});

test("changing the workflow or the classifier runs every scope", () => {
  assert.deepEqual(scopesFor(".github/workflows/pr-safety.yml"), [...SCOPES]);
  assert.deepEqual(scopesFor(".github/scripts/ci-scope.mjs"), [...SCOPES]);
  assert.deepEqual(scopesFor(".github/scripts/ci-scope.test.mjs"), [...SCOPES]);
});

test("an unmapped path fails closed onto every scope and is reported", () => {
  const result = classifyPath("tools/brand-new-thing/main.py");
  assert.equal(result.unknown, true);
  assert.deepEqual(result.scopes, [...SCOPES]);

  const { scopes, unknownPaths } = classifyPaths(["newtop/file.txt", "README.md"]);
  assert.deepEqual(unknownPaths, ["newtop/file.txt"]);
  assert.deepEqual(
    SCOPES.filter((scope) => scopes[scope]),
    [...SCOPES],
  );
});

test("parseChangedPaths trims, dedupes and rejects unusable paths", () => {
  assert.deepEqual(parseChangedPaths("a.txt\r\nb/c.txt\n\na.txt\n"), ["a.txt", "b/c.txt"]);
  assert.throws(() => parseChangedPaths("a\u0001b"), /control character/);
  assert.throws(() => parseChangedPaths("/etc/passwd"), /repository-relative/);
  assert.throws(() => parseChangedPaths("..\\evil"), /repository-relative/);
  assert.throws(() => parseChangedPaths("a/../../evil"), /repository-relative/);
});

test("the aggregate verdict passes when in-scope jobs succeed and the rest skip", () => {
  const verdict = evaluateAggregate(
    needsPayload({ outputs: { coordinator: true, root_contracts: true } }),
  );
  assert.deepEqual(verdict, { ok: true, failures: [] });
});

test("the aggregate verdict rejects a skipped in-scope job", () => {
  const verdict = evaluateAggregate(
    needsPayload({ outputs: { viewer: true }, results: { viewer: "skipped" } }),
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures.join("\n"), /job viewer is in scope for this diff but ended skipped/);
});

test("the aggregate verdict rejects a failed or cancelled out-of-scope job", () => {
  for (const result of ["failure", "cancelled"]) {
    const verdict = evaluateAggregate(needsPayload({ results: { streaming: result } }));
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), new RegExp(`job streaming .* ended ${result}`));
  }
});

test("the aggregate verdict requires the safety job to succeed on every pull request", () => {
  assert.deepEqual(evaluateAggregate(needsPayload({ safety: "success" })), {
    ok: true,
    failures: [],
  });

  // Including skipped: `safety` carries the diff, JSON, PowerShell and secret
  // scan, so a skip there must never read as a pass.
  for (const result of ["failure", "cancelled", "skipped"]) {
    const verdict = evaluateAggregate(needsPayload({ safety: result }));
    assert.equal(verdict.ok, false);
    assert.match(
      verdict.failures.join("\n"),
      new RegExp(`job safety runs on every pull request but ended ${result}`),
    );
  }

  const missing = evaluateAggregate(needsPayload({ safety: null }));
  assert.equal(missing.ok, false);
  assert.match(missing.failures.join("\n"), /job safety is missing from needs/);

  const strange = needsPayload();
  strange.safety.result = "neutral";
  assert.match(
    evaluateAggregate(strange).failures.join("\n"),
    /job safety reported an unexpected result/,
  );

  // It must not be mistaken for a job the verdict does not understand.
  assert.doesNotMatch(
    evaluateAggregate(needsPayload()).failures.join("\n"),
    /does not understand/,
  );
});

test("the aggregate verdict rejects a classifier that did not succeed", () => {
  for (const changes of ["failure", "skipped", "cancelled"]) {
    const verdict = evaluateAggregate(needsPayload({ changes }));
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /scope classifier did not succeed/);
  }
});

test("the aggregate verdict rejects a job that was never created", () => {
  const payload = needsPayload({ outputs: { governance: true } });
  delete payload.governance;
  const verdict = evaluateAggregate(payload);
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures.join("\n"), /job governance is missing from needs/);
});

test("the aggregate verdict rejects non-canonical or unexpected values", () => {
  const missingOutput = needsPayload();
  missingOutput.changes.outputs.coordinator = "";
  assert.match(
    evaluateAggregate(missingOutput).failures.join("\n"),
    /scope coordinator has a non-canonical classifier output/,
  );

  const strangeResult = needsPayload();
  strangeResult.viewer.result = "neutral";
  assert.match(
    evaluateAggregate(strangeResult).failures.join("\n"),
    /job viewer reported an unexpected result/,
  );

  const extraJob = needsPayload();
  extraJob["design-visual"] = { result: "success" };
  assert.match(
    evaluateAggregate(extraJob).failures.join("\n"),
    /needs contains jobs the verdict does not understand: design-visual/,
  );

  assert.equal(evaluateAggregate(null).ok, false);
  assert.equal(evaluateAggregate({}).ok, false);
});
