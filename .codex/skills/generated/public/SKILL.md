---
name: public
description: "Skill for the Public area of AI-BIM-governance. 18 symbols across 1 files."
---

# Public

18 symbols | 1 files | Cohesion: 86%

## When to Use

- Working with code in `bim-review-coordinator/`
- Understanding how appendSocket, connectSocket, emit work
- Modifying public-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-review-coordinator/src/public/dev-console.js` | appendSocket, connectSocket, emit, baseSocketPayload, emitJoin (+13) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `appendSocket` | Function | `bim-review-coordinator/src/public/dev-console.js` | 92 |
| `connectSocket` | Function | `bim-review-coordinator/src/public/dev-console.js` | 97 |
| `emit` | Function | `bim-review-coordinator/src/public/dev-console.js` | 115 |
| `baseSocketPayload` | Function | `bim-review-coordinator/src/public/dev-console.js` | 124 |
| `emitJoin` | Function | `bim-review-coordinator/src/public/dev-console.js` | 129 |
| `emitLeave` | Function | `bim-review-coordinator/src/public/dev-console.js` | 133 |
| `emitHeartbeat` | Function | `bim-review-coordinator/src/public/dev-console.js` | 137 |
| `participantBody` | Function | `bim-review-coordinator/src/public/dev-console.js` | 18 |
| `httpCall` | Function | `bim-review-coordinator/src/public/dev-console.js` | 22 |
| `createSession` | Function | `bim-review-coordinator/src/public/dev-console.js` | 44 |
| `joinSessionHttp` | Function | `bim-review-coordinator/src/public/dev-console.js` | 68 |
| `leaveSessionHttp` | Function | `bim-review-coordinator/src/public/dev-console.js` | 72 |
| `openViewerWithSession` | Function | `bim-review-coordinator/src/public/dev-console.js` | 141 |
| `sessionPath` | Function | `bim-review-coordinator/src/public/dev-console.js` | 13 |
| `getSession` | Function | `bim-review-coordinator/src/public/dev-console.js` | 64 |
| `getStreamConfig` | Function | `bim-review-coordinator/src/public/dev-console.js` | 76 |
| `getEvents` | Function | `bim-review-coordinator/src/public/dev-console.js` | 80 |
| `postEvent` | Function | `bim-review-coordinator/src/public/dev-console.js` | 84 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `EmitJoin → AppendSocket` | intra_community | 3 |
| `EmitLeave → AppendSocket` | intra_community | 3 |
| `EmitHeartbeat → AppendSocket` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "appendSocket"})` — see callers and callees
2. `gitnexus_query({query: "public"})` — find related execution flows
3. Read key files listed above for implementation details
