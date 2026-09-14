import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseArguments,
  runChecks,
  scanAddedDiffLines,
  shouldValidateJsonPath,
  validateJsonText,
} from "./pr-safety.mjs";

function diffWithAddedLine(value, line = 1) {
  return [
    "diff --git a/config.txt b/config.txt",
    "--- a/config.txt",
    "+++ b/config.txt",
    `@@ -0,0 +${line} @@`,
    `+${value}`,
  ];
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("accepts full base and head commit SHAs", () => {
  const base = "a".repeat(40);
  const head = "B".repeat(40);
  assert.deepEqual(parseArguments(["--base", base, "--head", head]), { base, head });
});

test("rejects abbreviated or missing commit SHAs", () => {
  assert.throws(
    () => parseArguments(["--base", "abc123", "--head", "b".repeat(40)]),
    /40-character/,
  );
  assert.throws(() => parseArguments(["--base", "a".repeat(40)]), /usage/);
});

test("detects high-confidence secrets only on added lines without echoing them", () => {
  const token = ["ghp", "A".repeat(30)].join("_");
  const findings = scanAddedDiffLines([
    "diff --git a/config.txt b/config.txt",
    "--- a/config.txt",
    "+++ b/config.txt",
    "@@ -1 +1,2 @@",
    `-${token}`,
    "+TOKEN=${SAFE_TOKEN}",
    `+${token}`,
  ]);

  assert.deepEqual(findings, [{ file: "config.txt", line: 2, rule: "github-token" }]);
  assert.equal(JSON.stringify(findings).includes(token), false);
});

test("detects private-key markers and cloud access keys", () => {
  const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const encryptedPrivateKeyMarker = ["-----BEGIN", "ENCRYPTED PRIVATE KEY-----"].join(" ");
  const pgpPrivateKeyMarker = ["-----BEGIN", "PGP PRIVATE KEY BLOCK-----"].join(" ");
  const cloudKey = ["AKIA", "A".repeat(16)].join("");

  assert.equal(scanAddedDiffLines(diffWithAddedLine(privateKeyMarker)).at(0)?.rule, "private-key");
  assert.equal(
    scanAddedDiffLines(diffWithAddedLine(encryptedPrivateKeyMarker)).at(0)?.rule,
    "private-key",
  );
  assert.equal(
    scanAddedDiffLines(diffWithAddedLine(pgpPrivateKeyMarker)).at(0)?.rule,
    "private-key",
  );
  assert.equal(scanAddedDiffLines(diffWithAddedLine(cloudKey, 8)).at(0)?.rule, "aws-access-key");
});

test("allows placeholders and environment references", () => {
  const findings = scanAddedDiffLines([
    ...diffWithAddedLine("TOKEN=${GITHUB_TOKEN}"),
    "+API_KEY=replace-me",
    "+PASSWORD=example-only",
  ]);
  assert.deepEqual(findings, []);
});

test("validates JSON syntax including UTF-8 BOM", () => {
  assert.doesNotThrow(() => validateJsonText('{"enabled":true}'));
  assert.doesNotThrow(() => validateJsonText('\ufeff{"enabled":true}'));
  assert.throws(() => validateJsonText('{"enabled":}'), SyntaxError);
});

test("validates strict JSON while excluding JSONC and intentional invalid fixtures", () => {
  assert.equal(shouldValidateJsonPath("config/settings.json"), true);
  assert.equal(shouldValidateJsonPath("web-viewer-sample/tsconfig.json"), false);
  assert.equal(shouldValidateJsonPath("app/tsconfig.build.json"), false);
  assert.equal(shouldValidateJsonPath("scripts/tests/fixtures/example/malformed.json"), false);
  assert.equal(shouldValidateJsonPath("tests/fixtures/invalid-token.json"), false);
  assert.equal(shouldValidateJsonPath("tests/fixtures/valid.json"), true);
});

test("runs the complete check against a real Git commit range", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "pr-safety-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));

  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.name", "PR Safety Test"]);
  git(repository, ["config", "user.email", "pr-safety@example.invalid"]);
  git(repository, ["config", "commit.gpgsign", "false"]);

  const baselineToken = ["ghp", "Z".repeat(30)].join("_");
  writeFileSync(join(repository, "baseline.txt"), `${baselineToken}\n`);
  git(repository, ["add", "baseline.txt"]);
  git(repository, ["commit", "-q", "-m", "baseline"]);
  const base = git(repository, ["rev-parse", "HEAD"]);

  mkdirSync(join(repository, "config"));
  writeFileSync(join(repository, "config", "valid.json"), '{"enabled":true}\n');
  writeFileSync(join(repository, "config", "valid.ps1"), "$value = @{ Enabled = $true }\n");
  git(repository, ["add", "config"]);
  git(repository, ["commit", "-q", "-m", "valid changes"]);
  const head = git(repository, ["rev-parse", "HEAD"]);

  assert.deepEqual(await runChecks({ cwd: repository, base, head }), {
    changedFiles: 2,
    jsonFiles: 1,
    powerShellFiles: 1,
  });
});
