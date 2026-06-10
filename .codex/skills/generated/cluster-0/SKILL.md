---
name: cluster-0
description: "Skill for the Cluster_0 area of AI-BIM-governance. 8 symbols across 3 files."
---

# Cluster_0

8 symbols | 3 files | Cohesion: 93%

## When to Use

- Working with code in `web-viewer-sample/`
- Understanding how getApplications, getApplicationVersions, getApplicationVersionProfiles work
- Modifying cluster_0-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `web-viewer-sample/src/Endpoints.tsx` | getApplications, getApplicationVersions, getApplicationVersionProfiles, getStreamingSessions |
| `web-viewer-sample/src/Forms.tsx` | ServerURLsForm, ApplicationsForm, VersionsForm |
| `web-viewer-sample/src/http.ts` | get |

## Entry Points

Start here when exploring this area:

- **`getApplications`** (Function) — `web-viewer-sample/src/Endpoints.tsx:77`
- **`getApplicationVersions`** (Function) — `web-viewer-sample/src/Endpoints.tsx:89`
- **`getApplicationVersionProfiles`** (Function) — `web-viewer-sample/src/Endpoints.tsx:102`
- **`getStreamingSessions`** (Function) — `web-viewer-sample/src/Endpoints.tsx:109`
- **`ServerURLsForm`** (Class) — `web-viewer-sample/src/Forms.tsx:149`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ServerURLsForm` | Class | `web-viewer-sample/src/Forms.tsx` | 149 |
| `ApplicationsForm` | Class | `web-viewer-sample/src/Forms.tsx` | 301 |
| `VersionsForm` | Class | `web-viewer-sample/src/Forms.tsx` | 386 |
| `getApplications` | Function | `web-viewer-sample/src/Endpoints.tsx` | 77 |
| `getApplicationVersions` | Function | `web-viewer-sample/src/Endpoints.tsx` | 89 |
| `getApplicationVersionProfiles` | Function | `web-viewer-sample/src/Endpoints.tsx` | 102 |
| `getStreamingSessions` | Function | `web-viewer-sample/src/Endpoints.tsx` | 109 |
| `get` | Method | `web-viewer-sample/src/http.ts` | 17 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Render → Get` | cross_community | 5 |

## How to Explore

1. `gitnexus_context({name: "getApplications"})` — see callers and callees
2. `gitnexus_query({query: "cluster_0"})` — find related execution flows
3. Read key files listed above for implementation details
