---
name: cluster-1
description: "Skill for the Cluster_1 area of AI-BIM-governance. 13 symbols across 4 files."
---

# Cluster_1

13 symbols | 4 files | Cohesion: 97%

## When to Use

- Working with code in `web-viewer-sample/`
- Understanding how shouldRetryPoll, getStreamingSessionInfo, createStreamingSession work
- Modifying cluster_1-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `web-viewer-sample/src/App.tsx` | _resetState, pollForSessionReady, _startStream, setupStream, _resetStream (+2) |
| `web-viewer-sample/src/Endpoints.tsx` | getStreamingSessionInfo, createStreamingSession, destroyStreamingSession |
| `web-viewer-sample/src/http.ts` | post, del |
| `web-viewer-sample/src/utils/pollHelpers.ts` | shouldRetryPoll |

## Entry Points

Start here when exploring this area:

- **`shouldRetryPoll`** (Function) — `web-viewer-sample/src/utils/pollHelpers.ts:9`
- **`getStreamingSessionInfo`** (Function) — `web-viewer-sample/src/Endpoints.tsx:116`
- **`createStreamingSession`** (Function) — `web-viewer-sample/src/Endpoints.tsx:123`
- **`destroyStreamingSession`** (Function) — `web-viewer-sample/src/Endpoints.tsx:136`
- **`post`** (Method) — `web-viewer-sample/src/http.ts:24`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `shouldRetryPoll` | Function | `web-viewer-sample/src/utils/pollHelpers.ts` | 9 |
| `getStreamingSessionInfo` | Function | `web-viewer-sample/src/Endpoints.tsx` | 116 |
| `createStreamingSession` | Function | `web-viewer-sample/src/Endpoints.tsx` | 123 |
| `destroyStreamingSession` | Function | `web-viewer-sample/src/Endpoints.tsx` | 136 |
| `post` | Method | `web-viewer-sample/src/http.ts` | 24 |
| `del` | Method | `web-viewer-sample/src/http.ts` | 38 |
| `_resetState` | Method | `web-viewer-sample/src/App.tsx` | 109 |
| `pollForSessionReady` | Method | `web-viewer-sample/src/App.tsx` | 138 |
| `_startStream` | Method | `web-viewer-sample/src/App.tsx` | 175 |
| `setupStream` | Method | `web-viewer-sample/src/App.tsx` | 201 |
| `_resetStream` | Method | `web-viewer-sample/src/App.tsx` | 232 |
| `_endStream` | Method | `web-viewer-sample/src/App.tsx` | 242 |
| `render` | Method | `web-viewer-sample/src/App.tsx` | 262 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Render → Get` | cross_community | 5 |
| `Render → Del` | intra_community | 5 |
| `Render → SetupStream` | intra_community | 4 |
| `Render → _resetState` | intra_community | 4 |
| `Render → Post` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_0 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "shouldRetryPoll"})` — see callers and callees
2. `gitnexus_query({query: "cluster_1"})` — find related execution flows
3. Read key files listed above for implementation details
