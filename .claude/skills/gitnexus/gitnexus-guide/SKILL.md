---
name: gitnexus-guide
description: "Use when the user asks which GitNexus shell commands are available or how to query the local knowledge graph"
---

# GitNexus CLI Guide

This repository uses the shell CLI only. The reviewed version is **1.6.9**.

## Start here

```bash
gitnexus --version
gitnexus status
gitnexus --help
```

If the version is not `1.6.9`, do not silently install a moving release. Follow `gitnexus-cli` and the repository authorization boundary.

## Command reference

| Goal | Command |
| --- | --- |
| List indexed repositories | `gitnexus list` |
| Check freshness | `gitnexus status` |
| Find flows for a concept | `gitnexus query "concept" -r AI-BIM-governance` |
| Inspect a symbol | `gitnexus context "SymbolName" -r AI-BIM-governance` |
| Map dependants | `gitnexus impact "SymbolName" -d upstream -r AI-BIM-governance` |
| Trace between symbols | `gitnexus trace "From" "To" -r AI-BIM-governance` |
| Map a diff | `gitnexus detect-changes --scope compare --base-ref main -r AI-BIM-governance` |
| Query the graph directly | `gitnexus cypher "MATCH ..." -r AI-BIM-governance` |
| Run structural checks | `gitnexus check` |
| Refresh without context injection | `npx gitnexus@1.6.9 analyze --index-only` |

Run `gitnexus <command> --help` for the exact flags.

## Task routing

| Task | Skill |
| --- | --- |
| Architecture and flows | `gitnexus-exploring` |
| Blast radius | `gitnexus-impact-analysis` |
| Bug tracing | `gitnexus-debugging` |
| Rename, extract, split, move | `gitnexus-refactoring` |
| Index lifecycle | `gitnexus-cli` |

## Important limits

- The CLI has no automated rename command; use impact/context, then a language-aware rename or explicit edits.
- `query` and `context` expose processes without a separate resource read.
- `cypher` is an advanced escape hatch. Prefer typed commands and verify property names against observed output.
- A graph result is navigation and risk evidence, not runtime truth; source and executable tests arbitrate conflicts.
- A stale, ambiguous, or unavailable index is UNKNOWN, never pass.
