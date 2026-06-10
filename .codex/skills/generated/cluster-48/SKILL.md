---
name: cluster-48
description: "Skill for the Cluster_48 area of AI-BIM-governance. 12 symbols across 1 files."
---

# Cluster_48

12 symbols | 1 files | Cohesion: 96%

## When to Use

- Working with code in `bim-review-coordinator/`
- Understanding how loadConfig work
- Modifying cluster_48-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-review-coordinator/src/config.ts` | numberFromEnv, parseBooleanEnv, nullableNumberFromEnv, csvFromEnv, uniqueStrings (+7) |

## Entry Points

Start here when exploring this area:

- **`loadConfig`** (Function) — `bim-review-coordinator/src/config.ts:298`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `loadConfig` | Function | `bim-review-coordinator/src/config.ts` | 298 |
| `numberFromEnv` | Function | `bim-review-coordinator/src/config.ts` | 76 |
| `parseBooleanEnv` | Function | `bim-review-coordinator/src/config.ts` | 83 |
| `nullableNumberFromEnv` | Function | `bim-review-coordinator/src/config.ts` | 93 |
| `csvFromEnv` | Function | `bim-review-coordinator/src/config.ts` | 100 |
| `uniqueStrings` | Function | `bim-review-coordinator/src/config.ts` | 109 |
| `normalizeBaseUrl` | Function | `bim-review-coordinator/src/config.ts` | 113 |
| `normalizePublicBaseUrl` | Function | `bim-review-coordinator/src/config.ts` | 120 |
| `publicBaseUrlFromHost` | Function | `bim-review-coordinator/src/config.ts` | 137 |
| `localIpv4ForStreaming` | Function | `bim-review-coordinator/src/config.ts` | 174 |
| `kitHostFromEnv` | Function | `bim-review-coordinator/src/config.ts` | 186 |
| `conversionApiBaseFromEnv` | Function | `bim-review-coordinator/src/config.ts` | 287 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `LoadConfig → NormalizeBaseUrl` | intra_community | 4 |
| `LoadConfig → LocalIpv4ForStreaming` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_49 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "loadConfig"})` — see callers and callees
2. `gitnexus_query({query: "cluster_48"})` — find related execution flows
3. Read key files listed above for implementation details
