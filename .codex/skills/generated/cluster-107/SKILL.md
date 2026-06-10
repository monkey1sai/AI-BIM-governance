---
name: cluster-107
description: "Skill for the Cluster_107 area of AI-BIM-governance. 18 symbols across 1 files."
---

# Cluster_107

18 symbols | 1 files | Cohesion: 88%

## When to Use

- Working with code in `bim-review-coordinator/`
- Understanding how generateRunId, isoUtcMs, dateDirFromIso work
- Modifying cluster_107-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-review-coordinator/src/lib/structLog.ts` | envSnapshot, generateRunId, isoUtcMs, dateDirFromIso, safeStringify (+13) |

## Entry Points

Start here when exploring this area:

- **`generateRunId`** (Function) — `bim-review-coordinator/src/lib/structLog.ts:177`
- **`isoUtcMs`** (Function) — `bim-review-coordinator/src/lib/structLog.ts:188`
- **`dateDirFromIso`** (Function) — `bim-review-coordinator/src/lib/structLog.ts:192`
- **`safeStringify`** (Function) — `bim-review-coordinator/src/lib/structLog.ts:322`
- **`persistRecordsToServicePaths`** (Function) — `bim-review-coordinator/src/lib/structLog.ts:411`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `generateRunId` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 177 |
| `isoUtcMs` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 188 |
| `dateDirFromIso` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 192 |
| `safeStringify` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 322 |
| `persistRecordsToServicePaths` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 411 |
| `extractStackTail` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 437 |
| `createLogger` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 726 |
| `envSnapshot` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 124 |
| `defaultLogRoot` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 468 |
| `ensureDir` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 474 |
| `buildFilePath` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 483 |
| `rotateIfNeeded` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 487 |
| `recordSinkFailure` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 494 |
| `writeRecord` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 506 |
| `classifyError` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 576 |
| `makeLogger` | Function | `bim-review-coordinator/src/lib/structLog.ts` | 633 |
| `withTraceId` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 691 |
| `noteDropped` | Method | `bim-review-coordinator/src/lib/structLog.ts` | 698 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Fatal → BuildFilePath` | cross_community | 5 |
| `Fatal → EnsureDir` | cross_community | 5 |
| `Network → BuildFilePath` | cross_community | 5 |
| `Network → EnsureDir` | cross_community | 5 |
| `Audit → BuildFilePath` | cross_community | 5 |
| `Audit → EnsureDir` | cross_community | 5 |
| `Lifecycle → BuildFilePath` | cross_community | 5 |
| `Lifecycle → EnsureDir` | cross_community | 5 |
| `Anomaly → BuildFilePath` | cross_community | 5 |
| `Anomaly → EnsureDir` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_108 | 2 calls |

## How to Explore

1. `gitnexus_context({name: "generateRunId"})` — see callers and callees
2. `gitnexus_query({query: "cluster_107"})` — find related execution flows
3. Read key files listed above for implementation details
