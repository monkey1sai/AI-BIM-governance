---
name: clients
description: "Skill for the Clients area of AI-BIM-governance. 106 symbols across 8 files."
---

# Clients

106 symbols | 8 files | Cohesion: 71%

## When to Use

- Working with code in `web-viewer-sample/`
- Understanding how buildLoadingStateQuery, getFileNameFromPath, computeFileReady work
- Modifying clients-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `web-viewer-sample/src/Window.tsx` | getPayloadString, getPayloadStringArray, appStreamResultToAppEvent, _appendDemoOutgoing, _sendStreamMessage (+68) |
| `web-viewer-sample/src/clients/coordinatorClient.ts` | isQueuedForInstanceError, QueuedForInstanceError, createReviewSession, readJson, isQueuedForInstanceResponse (+4) |
| `web-viewer-sample/src/clients/streamMessages.ts` | buildLoadingStateQuery, buildGetChildrenRequest, buildClearHighlightRequest, buildOpenStageRequest, buildHighlightPrimsRequest (+1) |
| `web-viewer-sample/src/clients/bimControlClient.ts` | readItems, getArtifacts, getReviewSessionRequest, patchReviewSessionRequest, request (+1) |
| `web-viewer-sample/src/utils/triReady.ts` | computeFileReady, computeRuntimeReady, computeSemanticReady, triReadyLabel |
| `web-viewer-sample/src/clients/reviewSocket.ts` | disconnect, join, connectReviewSocket |
| `web-viewer-sample/src/utils/windowHelpers.ts` | sameStreamEndpoint, lifecycleStatusText, isBlockedLifecycle |
| `web-viewer-sample/src/AppStream.tsx` | sendMessage, stop |

## Entry Points

Start here when exploring this area:

- **`buildLoadingStateQuery`** (Function) — `web-viewer-sample/src/clients/streamMessages.ts:33`
- **`getFileNameFromPath`** (Function) — `web-viewer-sample/src/Window.tsx:1012`
- **`computeFileReady`** (Function) — `web-viewer-sample/src/utils/triReady.ts:21`
- **`computeRuntimeReady`** (Function) — `web-viewer-sample/src/utils/triReady.ts:27`
- **`computeSemanticReady`** (Function) — `web-viewer-sample/src/utils/triReady.ts:38`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `QueuedForInstanceError` | Class | `web-viewer-sample/src/clients/coordinatorClient.ts` | 23 |
| `CoordinatorClient` | Class | `web-viewer-sample/src/clients/coordinatorClient.ts` | 34 |
| `BimControlClient` | Class | `web-viewer-sample/src/clients/bimControlClient.ts` | 15 |
| `App` | Class | `web-viewer-sample/src/Window.tsx` | 235 |
| `buildLoadingStateQuery` | Function | `web-viewer-sample/src/clients/streamMessages.ts` | 33 |
| `getFileNameFromPath` | Function | `web-viewer-sample/src/Window.tsx` | 1012 |
| `computeFileReady` | Function | `web-viewer-sample/src/utils/triReady.ts` | 21 |
| `computeRuntimeReady` | Function | `web-viewer-sample/src/utils/triReady.ts` | 27 |
| `computeSemanticReady` | Function | `web-viewer-sample/src/utils/triReady.ts` | 38 |
| `triReadyLabel` | Function | `web-viewer-sample/src/utils/triReady.ts` | 51 |
| `buildGetChildrenRequest` | Function | `web-viewer-sample/src/clients/streamMessages.ts` | 40 |
| `buildClearHighlightRequest` | Function | `web-viewer-sample/src/clients/streamMessages.ts` | 72 |
| `sameStreamEndpoint` | Function | `web-viewer-sample/src/utils/windowHelpers.ts` | 20 |
| `lifecycleStatusText` | Function | `web-viewer-sample/src/utils/windowHelpers.ts` | 47 |
| `isQueuedForInstanceError` | Function | `web-viewer-sample/src/clients/coordinatorClient.ts` | 30 |
| `buildOpenStageRequest` | Function | `web-viewer-sample/src/clients/streamMessages.ts` | 8 |
| `isBlockedLifecycle` | Function | `web-viewer-sample/src/utils/windowHelpers.ts` | 35 |
| `connectReviewSocket` | Function | `web-viewer-sample/src/clients/reviewSocket.ts` | 13 |
| `onStatus` | Function | `web-viewer-sample/src/Window.tsx` | 619 |
| `onEvent` | Function | `web-viewer-sample/src/Window.tsx` | 620 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `_onSelectUSDAsset → _hasRemoteVideoFrame` | cross_community | 8 |
| `_onSelectUSDAsset → _clearLoadingStateRetry` | cross_community | 8 |
| `_onSelectUSDAsset → _clearStageLoadTimeout` | cross_community | 8 |
| `_onSelectUSDAsset → _isLoadedStageExpected` | cross_community | 7 |
| `_onStreamStarted → _isLoadedStageExpected` | cross_community | 7 |
| `_onStreamStarted → _clearLoadingStateRetry` | cross_community | 7 |
| `_scheduleStageLoadTimeout → _appendDemoIncoming` | cross_community | 7 |
| `Render → _appendReviewEvent` | cross_community | 6 |
| `_onSelectUSDAsset → _appendDemoIncoming` | cross_community | 6 |
| `_onStreamStarted → _appendDemoIncoming` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Types | 4 calls |
| Cluster_59 | 1 calls |
| Cluster_116 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "buildLoadingStateQuery"})` — see callers and callees
2. `gitnexus_query({query: "clients"})` — find related execution flows
3. Read key files listed above for implementation details
