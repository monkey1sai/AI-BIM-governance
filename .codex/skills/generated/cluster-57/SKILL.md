---
name: cluster-57
description: "Skill for the Cluster_57 area of AI-BIM-governance. 13 symbols across 1 files."
---

# Cluster_57

13 symbols | 1 files | Cohesion: 90%

## When to Use

- Working with code in `bim-review-coordinator/`
- Understanding how chooseReadyUsdc, artifactReadyStatus, buildArtifactBindings work
- Modifying cluster_57-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-review-coordinator/src/app.ts` | chooseReadyUsdc, artifactReadyStatus, buildArtifactBindings, chooseReadyBinding, orderedLoadableDerivedBindings (+8) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `chooseReadyUsdc` | Function | `bim-review-coordinator/src/app.ts` | 1676 |
| `artifactReadyStatus` | Function | `bim-review-coordinator/src/app.ts` | 1680 |
| `buildArtifactBindings` | Function | `bim-review-coordinator/src/app.ts` | 1691 |
| `chooseReadyBinding` | Function | `bim-review-coordinator/src/app.ts` | 1743 |
| `orderedLoadableDerivedBindings` | Function | `bim-review-coordinator/src/app.ts` | 1747 |
| `chooseStreamingStatusBinding` | Function | `bim-review-coordinator/src/app.ts` | 1754 |
| `modelStatusFromBinding` | Function | `bim-review-coordinator/src/app.ts` | 1763 |
| `isLoopbackHost` | Function | `bim-review-coordinator/src/app.ts` | 1772 |
| `streamConfigWithRuntimeOverride` | Function | `bim-review-coordinator/src/app.ts` | 1777 |
| `sameStreamEndpoint` | Function | `bim-review-coordinator/src/app.ts` | 1798 |
| `runtimeKitInstanceBindings` | Function | `bim-review-coordinator/src/app.ts` | 1808 |
| `persisted` | Function | `bim-review-coordinator/src/app.ts` | 1809 |
| `buildStreamConfig` | Function | `bim-review-coordinator/src/app.ts` | 1856 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `BuildStreamConfig → ArtifactReadyStatus` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "chooseReadyUsdc"})` — see callers and callees
2. `gitnexus_query({query: "cluster_57"})` — find related execution flows
3. Read key files listed above for implementation details
