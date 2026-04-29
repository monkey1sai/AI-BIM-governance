# Graphify Cross-Document Knowledge Graph

This folder is the tracked Graphify snapshot for cross-document architecture knowledge that GitNexus does not infer from code alone.

## Inputs

The curated corpus is stored in:

```txt
docs/graphify-corpus/
```

It currently includes:

- `docs/contracts/`
- `docs/plans/`
- `docs/git/`

Generated GitNexus wiki files are intentionally excluded from the corpus to avoid circular analysis.

## Outputs

- `GRAPH_REPORT.md` - plain-language graph audit report
- `graph.json` - GraphRAG-ready graph data
- `graph.html` - standalone interactive graph viewer
- `wiki/index.md` - agent-readable wiki entry point

## Scope Notes

This graph focuses on service boundaries, data ownership, API/event contracts, local runtime commands, conversion-to-review flow, and the monorepo consolidation record.

The graph contains both `EXTRACTED` edges from source documents and `INFERRED` cross-document edges. Use `GRAPH_REPORT.md` first when reviewing the inferred relationships.
