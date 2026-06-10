---
name: cluster-109
description: "Skill for the Cluster_109 area of AI-BIM-governance. 14 symbols across 1 files."
---

# Cluster_109

14 symbols | 1 files | Cohesion: 88%

## When to Use

- Working with code in `bim-review-coordinator/`
- Understanding how buildRecord, buildLogicErrorRecord, attemptWrite work
- Modifying cluster_109-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-review-coordinator/src/lib/structLog.ts` | buildRecord, buildLogicErrorRecord, attemptWrite, debug, info (+9) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `buildRecord` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 540 |
| `buildLogicErrorRecord` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 595 |
| `attemptWrite` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 612 |
| `debug` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 645 |
| `info` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 648 |
| `warn` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 651 |
| `error` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 654 |
| `fatal` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 657 |
| `network` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 660 |
| `audit` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 666 |
| `lifecycle` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 672 |
| `anomaly` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 678 |
| `envSnapshot` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 684 |
| `writeRaw` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 688 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Fatal → ResolveAllowListPath` | cross_community | 6 |
| `Fatal → BuildFilePath` | cross_community | 5 |
| `Fatal → EnsureDir` | cross_community | 5 |
| `Fatal → IsSecretFieldName` | cross_community | 5 |
| `Network → BuildFilePath` | cross_community | 5 |
| `Network → EnsureDir` | cross_community | 5 |
| `Network → ResolveAllowListPath` | cross_community | 5 |
| `Audit → BuildFilePath` | cross_community | 5 |
| `Audit → EnsureDir` | cross_community | 5 |
| `Audit → ResolveAllowListPath` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_107 | 5 calls |
| Cluster_108 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "buildRecord"})` — see callers and callees
2. `gitnexus_query({query: "cluster_109"})` — find related execution flows
3. Read key files listed above for implementation details
