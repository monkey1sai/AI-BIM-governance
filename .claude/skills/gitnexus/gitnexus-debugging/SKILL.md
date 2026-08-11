---
name: gitnexus-debugging
description: "Use when debugging a failure, tracing an error, or locating how one symbol reaches another"
---

# Debugging with GitNexus CLI

## Workflow

```bash
gitnexus status
gitnexus query "<error or symptom>" -r AI-BIM-governance
gitnexus context "<suspect>" -r AI-BIM-governance
gitnexus trace "<entry>" "<suspect>" -r AI-BIM-governance
```

If status is stale, use the unavailable gate unless the current turn authorizes the pinned refresh:

```bash
npx gitnexus@1.6.9 analyze --index-only
gitnexus status
```

## Checklist

- [ ] Capture the exact symptom and failing boundary.
- [ ] Query the error text or domain concept.
- [ ] Inspect the suspect's callers, callees, and processes.
- [ ] Trace between known endpoints.
- [ ] Read source and reproduce with the smallest executable test.
- [ ] Distinguish graph evidence from the verified root cause.

## Patterns

| Symptom | CLI approach |
| --- | --- |
| Error message | `query` the text, then `context` the throw site |
| Wrong return value | `context` the function and inspect callees |
| Intermittent failure | inspect async/external callees and reproduce timing |
| Performance issue | inspect high-fan-in symbols and hot processes |
| Recent regression | `detect-changes --scope compare --base-ref main` |
| How A reaches B | `trace "A" "B"` |

## Advanced query

When typed commands are insufficient:

```bash
gitnexus cypher 'MATCH path = (a)-[:CodeRelation {type: "CALLS"}*1..2]->(b:Function {name: "validatePayment"}) RETURN [n IN nodes(path) | n.name] AS chain' -r AI-BIM-governance
```

A missing path may indicate dynamic dispatch, reflection, an external boundary, stale indexing, or a real disconnect. Confirm with source and tests before naming the root cause.
