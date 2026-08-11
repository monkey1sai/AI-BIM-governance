---
name: gitnexus-impact-analysis
description: "Use when the user asks what depends on a symbol, what may break, or needs safety analysis before editing code"
---

# Impact Analysis with GitNexus CLI

## Workflow

```bash
gitnexus --version
gitnexus status
gitnexus impact "SymbolName" -d upstream -r AI-BIM-governance
gitnexus context "SymbolName" -r AI-BIM-governance
gitnexus detect-changes --scope compare --base-ref main -r AI-BIM-governance
```

The reviewed version is `1.6.9`. If status is stale, use the unavailable gate unless the current turn authorizes:

```bash
npx gitnexus@1.6.9 analyze --index-only
gitnexus status
```

## Checklist

- [ ] Inspect depth-1 callers first.
- [ ] Note affected processes from `impact` and `context`.
- [ ] Include tests when relevant with `--include-tests`.
- [ ] Use `detect-changes` before commit.
- [ ] Confirm graph claims against source and executable tests.
- [ ] Report HIGH or CRITICAL before editing.

## Reading risk

| Result | Meaning |
| --- | --- |
| depth 1 | Direct callers or importers; highest break risk |
| depth 2 | Indirect dependants; likely affected |
| depth 3 | Transitive scope; target for regression testing |
| UNKNOWN | Missing, stale, ambiguous, or unavailable graph evidence |

Repository calibration:

- LOW: fewer than 5 affected symbols and few processes.
- MEDIUM: 5–15 symbols or 2–5 processes.
- HIGH: more than 15 symbols or many processes.
- CRITICAL: protected paths such as auth, conversion authority, or session core.

## Example

```bash
gitnexus impact "validateUser" -d upstream --depth 3 --include-tests -r AI-BIM-governance
gitnexus context "validateUser" -r AI-BIM-governance
```

Report direct callers, affected processes, risk, confidence gaps, and the tests that cover the path. Never downgrade an unavailable result to pass.
