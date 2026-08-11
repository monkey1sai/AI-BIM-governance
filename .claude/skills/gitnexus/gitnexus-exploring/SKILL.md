---
name: gitnexus-exploring
description: "Use when the user asks how code works, wants architecture context, or needs to trace execution flows in an unfamiliar codebase"
---

# Exploring Codebases with GitNexus CLI

## Workflow

```bash
gitnexus list
gitnexus status
gitnexus query "<concept>" -r AI-BIM-governance
gitnexus context "<symbol>" -r AI-BIM-governance
gitnexus trace "<from>" "<to>" -r AI-BIM-governance
```

If status is stale, use the unavailable gate unless the current turn authorizes:

```bash
npx gitnexus@1.6.9 analyze --index-only
gitnexus status
```

## Checklist

- [ ] Confirm the exact indexed repository and freshness.
- [ ] Query the concept to find execution flows.
- [ ] Inspect key symbols with `context`.
- [ ] Use `trace` when both endpoints are known.
- [ ] Read the source files and executable tests.
- [ ] Label graph gaps and ambiguity explicitly.

## Useful forms

```bash
gitnexus query "payment processing" -r AI-BIM-governance --limit 5
gitnexus context "processPayment" -r AI-BIM-governance --content
gitnexus trace "checkoutHandler" "chargeStripe" -r AI-BIM-governance
```

Use `--file` or `--uid` to disambiguate common symbol names. Use direct search for configs, literals, generated files, and dynamic references that may not appear in the graph.

## Output

Summarize:

1. Entry point and main flow.
2. Key symbols with paths.
3. Callers, callees, and participating processes.
4. Source/test confirmation.
5. Unknown or stale evidence.
