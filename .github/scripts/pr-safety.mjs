#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

const SECRET_RULES = [
  {
    id: "private-key",
    pattern:
      /-----BEGIN (?:(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/,
  },
  {
    id: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: "openai-api-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "anthropic-api-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
];

export function parseArguments(argv) {
  const usage = "usage: pr-safety.mjs --base <40-hex-sha> --head <40-hex-sha>";
  if (argv.length !== 4) {
    throw new Error(usage);
  }

  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    const key = name?.startsWith("--") ? name.slice(2) : "";
    if (!["base", "head"].includes(key) || value === undefined || values.has(key)) {
      throw new Error(usage);
    }
    values.set(key, value);
  }

  const base = values.get("base");
  const head = values.get("head");
  if (!SHA_PATTERN.test(base ?? "") || !SHA_PATTERN.test(head ?? "")) {
    throw new Error("base and head must be full 40-character commit SHAs");
  }

  return { base, head };
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    throw new Error(options.failureMessage ?? `git ${args[0]} failed`);
  }

  return result.stdout;
}

function assertCommit(cwd, sha, label) {
  runGit(["cat-file", "-e", `${sha}^{commit}`], {
    cwd,
    failureMessage: `${label} commit is unavailable in the checkout`,
  });
}

function listChangedFiles(cwd, base, head) {
  const output = runGit(
    [
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      "--no-renames",
      "-z",
      `${base}...${head}`,
      "--",
    ],
    { cwd, failureMessage: "unable to list changed files" },
  );

  return output.split("\0").filter(Boolean);
}

function runDiffCheck(cwd, base, head) {
  runGit(["diff", "--check", `${base}...${head}`, "--"], {
    cwd,
    failureMessage: "git diff --check found whitespace or conflict-marker errors",
  });
}

export function createAddedLineScanner() {
  let currentFile = null;
  let currentLine = null;
  const findings = [];

  return {
    consume(line) {
      if (line.startsWith("diff --git ")) {
        currentFile = null;
        currentLine = null;
        return;
      }

      if (line.startsWith("+++ ")) {
        const path = line.slice(4);
        currentFile = path === "/dev/null" ? null : path.replace(/^b\//, "");
        return;
      }

      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (hunk) {
        currentLine = Number.parseInt(hunk[1], 10);
        return;
      }

      if (currentLine === null) {
        return;
      }

      if (line.startsWith("+") && !line.startsWith("+++ ")) {
        const addedText = line.slice(1);
        for (const rule of SECRET_RULES) {
          if (rule.pattern.test(addedText)) {
            findings.push({
              file: currentFile ?? "unknown",
              line: currentLine,
              rule: rule.id,
            });
          }
        }
        currentLine += 1;
        return;
      }

      if (!line.startsWith("-") && !line.startsWith("\\ No newline")) {
        currentLine += 1;
      }
    },
    findings,
  };
}

export function scanAddedDiffLines(lines) {
  const scanner = createAddedLineScanner();
  for (const line of lines) {
    scanner.consume(line);
  }
  return scanner.findings;
}

async function scanAddedLines(cwd, base, head) {
  const child = spawn(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--no-renames",
      "--diff-filter=ACMR",
      "--unified=0",
      `${base}...${head}`,
      "--",
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4096);
  });

  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const scanner = createAddedLineScanner();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    scanner.consume(line);
  }

  const exitCode = await completed;
  if (exitCode !== 0) {
    throw new Error(`unable to scan added lines${stderr ? " (git diff failed)" : ""}`);
  }

  return scanner.findings;
}

export function validateJsonText(text) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  JSON.parse(normalized);
}

export function shouldValidateJsonPath(file) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  if (!normalized.endsWith(".json")) {
    return false;
  }

  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/^(?:tsconfig|jsconfig)(?:\.[a-z0-9_-]+)*\.json$/.test(basename)) {
    return false;
  }

  const isFixture = /(^|\/)(?:fixtures?|testdata)(\/|$)/.test(normalized);
  const isIntentionalInvalidFixture = /^(?:invalid[-_].+|malformed)\.json$/.test(basename);
  return !(isFixture && isIntentionalInvalidFixture);
}

function readBlob(cwd, head, file) {
  return runGit(["cat-file", "blob", `${head}:${file}`], {
    cwd,
    failureMessage: `unable to read changed file: ${file}`,
  });
}

function validateJsonFiles(cwd, head, files) {
  const failures = [];
  for (const file of files.filter(shouldValidateJsonPath)) {
    try {
      validateJsonText(readBlob(cwd, head, file));
    } catch {
      failures.push(file);
    }
  }
  return failures;
}

const POWERSHELL_PARSE_COMMAND = [
  "$source = [Console]::In.ReadToEnd()",
  "$tokens = $null",
  "$errors = $null",
  "[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null",
  "if ($errors.Count -gt 0) { exit 1 }",
].join("; ");

function validatePowerShellFiles(cwd, head, files) {
  const failures = [];
  const candidates = files.filter((path) => /\.(?:ps1|psd1|psm1)$/i.test(path));

  for (const file of candidates) {
    const source = readBlob(cwd, head, file);
    const result = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_PARSE_COMMAND],
      { cwd, encoding: "utf8", input: source, maxBuffer: 8 * 1024 * 1024 },
    );
    if (result.error || result.status !== 0) {
      failures.push(file);
    }
  }

  return failures;
}

export async function runChecks({ cwd = process.cwd(), base, head }) {
  assertCommit(cwd, base, "base");
  assertCommit(cwd, head, "head");
  runDiffCheck(cwd, base, head);

  const files = listChangedFiles(cwd, base, head);
  const secretFindings = await scanAddedLines(cwd, base, head);
  const invalidJson = validateJsonFiles(cwd, head, files);
  const invalidPowerShell = validatePowerShellFiles(cwd, head, files);
  const failures = [];

  if (secretFindings.length > 0) {
    failures.push(
      `potential secrets in added lines:\n${secretFindings
        .map((finding) => `- ${finding.file}:${finding.line} (${finding.rule})`)
        .join("\n")}`,
    );
  }
  if (invalidJson.length > 0) {
    failures.push(`invalid JSON:\n${invalidJson.map((file) => `- ${file}`).join("\n")}`);
  }
  if (invalidPowerShell.length > 0) {
    failures.push(
      `invalid PowerShell syntax:\n${invalidPowerShell.map((file) => `- ${file}`).join("\n")}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  return {
    changedFiles: files.length,
    jsonFiles: files.filter(shouldValidateJsonPath).length,
    powerShellFiles: files.filter((path) => /\.(?:ps1|psd1|psm1)$/i.test(path)).length,
  };
}

async function main() {
  const { base, head } = parseArguments(process.argv.slice(2));
  const result = await runChecks({ base, head });
  console.log(
    `pr-safety passed: ${result.changedFiles} changed file(s), ` +
      `${result.jsonFiles} JSON file(s), ${result.powerShellFiles} PowerShell file(s)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`pr-safety failed: ${error.message}`);
    process.exitCode = 1;
  });
}
