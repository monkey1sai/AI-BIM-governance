---
name: services
description: "Skill for the Services area of AI-BIM-governance. 126 symbols across 13 files."
---

# Services

126 symbols | 13 files | Cohesion: 82%

## When to Use

- Working with code in `bim-review-coordinator/`
- Understanding how createCoordinatorApp, registerReviewNamespace, isSafeSessionId work
- Modifying services-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-review-coordinator/src/app.ts` | normalizeIntakePayload, createCoordinatorApp, buildRuntimeStatus, summarizeSessionForRuntime, summarizeIfcReadyJob (+17) |
| `bim-review-coordinator/src/services/externalIfcReadyStore.ts` | ExternalIfcReadyStore, findExisting, create, markDispatched, markQueuedForConversion (+12) |
| `bim-review-coordinator/src/services/authProvider.ts` | AuthError, requiredHeader, requiredIdentity, timingSafeEqual, authenticate (+11) |
| `bim-review-coordinator/src/services/streamingConversionClient.ts` | StreamingConversionClient, ensureTrailingSlash, toInternalIfcReadyEvent, authHeaders, createConversionJob (+9) |
| `bim-review-coordinator/src/services/sessionStore.ts` | SessionStore, get, list, save, join (+7) |
| `bim-review-coordinator/src/services/eventLog.ts` | EventLog, append, mirrorToStructuredLog, filePath, nextSequence (+6) |
| `bim-review-coordinator/src/services/callbackOutbox.ts` | CallbackOutbox, get, MetadataOnlyViolation, assertMetadataOnly, enqueue (+5) |
| `bim-review-coordinator/src/services/kitPool.ts` | allocateLocalKitInstance, allocateKitInstanceBindings, legacyKitInstanceFromBinding, defaultKitEndpoint, kitEndpointPool (+3) |
| `bim-review-coordinator/src/services/conversionDispatchQueue.ts` | ConversionDispatchQueue, setDispatcher, enqueue, getQueuePosition, runWorker (+1) |
| `bim-review-coordinator/src/services/ifcDownloader.ts` | joinPosixPath, joinHostPath, downloadIfcToSharedVolume, placeholderSuccess |

## Entry Points

Start here when exploring this area:

- **`createCoordinatorApp`** (Function) — `bim-review-coordinator/src/app.ts:280`
- **`registerReviewNamespace`** (Function) — `bim-review-coordinator/src/socket/reviewNamespace.ts:12`
- **`isSafeSessionId`** (Function) — `bim-review-coordinator/src/services/sessionStore.ts:128`
- **`ingestStreamingConversionResult`** (Function) — `bim-review-coordinator/src/app.ts:915`
- **`onTerminal`** (Function) — `bim-review-coordinator/src/app.ts:961`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `StreamingConversionClient` | Class | `bim-review-coordinator/src/services/streamingConversionClient.ts` | 135 |
| `SessionStore` | Class | `bim-review-coordinator/src/services/sessionStore.ts` | 31 |
| `ExternalIfcReadyStore` | Class | `bim-review-coordinator/src/services/externalIfcReadyStore.ts` | 13 |
| `EventLog` | Class | `bim-review-coordinator/src/services/eventLog.ts` | 52 |
| `ConversionDispatchQueue` | Class | `bim-review-coordinator/src/services/conversionDispatchQueue.ts` | 15 |
| `CallbackOutbox` | Class | `bim-review-coordinator/src/services/callbackOutbox.ts` | 109 |
| `AuthError` | Class | `bim-review-coordinator/src/services/authProvider.ts` | 36 |
| `MetadataOnlyViolation` | Class | `bim-review-coordinator/src/services/callbackOutbox.ts` | 42 |
| `IntranetDevAuthProvider` | Class | `bim-review-coordinator/src/services/authProvider.ts` | 113 |
| `LocalDevUserAuthProvider` | Class | `bim-review-coordinator/src/services/authProvider.ts` | 199 |
| `createCoordinatorApp` | Function | `bim-review-coordinator/src/app.ts` | 280 |
| `registerReviewNamespace` | Function | `bim-review-coordinator/src/socket/reviewNamespace.ts` | 12 |
| `isSafeSessionId` | Function | `bim-review-coordinator/src/services/sessionStore.ts` | 128 |
| `ingestStreamingConversionResult` | Function | `bim-review-coordinator/src/app.ts` | 915 |
| `onTerminal` | Function | `bim-review-coordinator/src/app.ts` | 961 |
| `toInternalIfcReadyEvent` | Function | `bim-review-coordinator/src/services/streamingConversionClient.ts` | 95 |
| `refOf` | Function | `bim-review-coordinator/src/services/streamingConversionClient.ts` | 283 |
| `allocateLocalKitInstance` | Function | `bim-review-coordinator/src/services/kitPool.ts` | 4 |
| `allocateKitInstanceBindings` | Function | `bim-review-coordinator/src/services/kitPool.ts` | 17 |
| `legacyKitInstanceFromBinding` | Function | `bim-review-coordinator/src/services/kitPool.ts` | 62 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RegisterReviewNamespace → IsSafeSessionId` | intra_community | 8 |
| `List → IsSafeSessionId` | intra_community | 7 |
| `OnTerminal → MetadataOnlyViolation` | cross_community | 6 |
| `AllocateKitInstanceBindings → DefaultKitEndpoint` | intra_community | 5 |
| `Authenticate → NormalizeIp` | cross_community | 5 |
| `AutoCreateOrActivateSession → IsSafeSessionId` | cross_community | 5 |
| `AutoCreateOrActivateSession → AssertSafeSessionId` | cross_community | 5 |
| `OnTerminal → Persist` | cross_community | 5 |
| `LegacyKitInstanceFromBinding → DefaultKitEndpoint` | intra_community | 5 |
| `AutoCreateOrActivateSession → WithSequences` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_57 | 3 calls |
| Cluster_56 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "createCoordinatorApp"})` — see callers and callees
2. `gitnexus_query({query: "services"})` — find related execution flows
3. Read key files listed above for implementation details
