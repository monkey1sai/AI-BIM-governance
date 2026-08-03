#!/bin/bash
# Decides whether the PR BASE revision carries the COMPLETE bootstrap gate, so
# the workflow can adjudicate a PR with base-pinned scripts instead of the PR's
# own (possibly weakened) copy.
#
# Extracted from .github/workflows/pr-review-agent.yml so the decision is
# executable in tests rather than replicated in them (Codex review TG-2). This
# adds no trust surface: the workflow that calls it is already PR-editable,
# which is the documented boundary in docs/agents/self-referential-bootstrap.md
# §4.1.
#
# Usage:  detect-base-gate-capability.sh <base_sha> [repo_root]
# Prints: "complete" or "incomplete: <reason>"; exit 0 either way. Non-zero exit
#         means the detection itself failed and the caller MUST fail closed.
#
# Completeness is the WHOLE capability, not one file. Checking only that
# check-pr-body-evidence.ps1 exists at base was the defect that let PR #459 be
# evaluated by the old base checker while the gate it introduced never ran: that
# file is MODIFIED by such a PR, not created, so the check passed vacuously.

set -euo pipefail

base_sha="${1:?usage: detect-base-gate-capability.sh <base_sha> [repo_root]}"
repo_root="${2:-.}"

git_at_base() { git -C "$repo_root" cat-file -e "$base_sha:$1" 2>/dev/null; }

if ! git_at_base 'scripts/tests/check-pr-body-evidence.ps1'; then
  echo "incomplete: base has no scripts/tests/check-pr-body-evidence.ps1"
  exit 0
fi
if ! git_at_base 'scripts/lib/self-referential-bootstrap.ps1'; then
  echo "incomplete: base has no scripts/lib/self-referential-bootstrap.ps1"
  exit 0
fi

base_checker="$(git -C "$repo_root" show "$base_sha:scripts/tests/check-pr-body-evidence.ps1")"
if ! printf '%s' "$base_checker" | grep -q 'self-referential-bootstrap\.ps1'; then
  echo "incomplete: base checker does not dot-source the bootstrap library"
  exit 0
fi
if ! printf '%s' "$base_checker" | grep -q 'Assert-SelfReferentialBootstrapBody'; then
  echo "incomplete: base checker does not invoke the bootstrap assertion"
  exit 0
fi

echo "complete"
