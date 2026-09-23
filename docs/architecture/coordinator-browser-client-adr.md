# ADR: One Coordinator Browser Client

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`.

Builds on the Coordinator Browser Contract (`bim-review-coordinator/src/contract`; generated `web-viewer-sample/src/generated/coordinator-api.ts`).

## Context

The browser has two modules that call the coordinator: `web-viewer-sample/src/console/coordinatorClient.ts` (623 lines; an object literal with 47 members used by 46 production files) and `src/clients/coordinatorClient.ts` (391 lines; a class with 15 methods used only by `Window.tsx`). Seven endpoints are implemented in both with small differences (the class does not encode the stream-config session id; the close bodies differ). Each declares its own `CoordinatorHttpError` with a different constructor and message. Inside the console client, `jsonGet` and `jsonPostWithHeaders` throw the typed error while `jsonPost`, `jsonPut` and `jsonPutWithHeaders` throw a plain `Error`, so `isDevRoutesDisabled` and `isCoordinatorNotFound` work for 32 of 47 members. The viewer-lease transport is built twice (`clients/coordinatorClient.ts:246-252`, `console/ReviewSessionViewerPane.tsx:215-219`).

No test checks either client's paths against the contract; `bim-review-coordinator/tests/browser-contract-drift.test.ts` checks only the generated header hash. Both run from one Vite entry; the viewer runs in an iframe document with its own base URL. Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| One module or two? | One, in `src/coordinatorClient/`, created by a factory (`createCoordinatorClient({ baseUrl, fetch })`) with a default instance for the console; Window constructs its own with its base URL. | 46 importers move. | Two PRs: module plus re-export shim, then a mechanical import codemod and shim deletion. |
| Style? | Keep the per-route method style (what 46 files use); fold in the class's eight viewer-only methods; keep `QueuedForInstanceError` as a subclass of the single `CoordinatorHttpError`. | — | — |
| Error mode? | Every non-2xx throws `CoordinatorHttpError { path, status, detail, errorCode }` with the console message format `coordinator <path> -> <status> <detail>` kept verbatim (shown through `String(e)` in 15 places). | Window tests assert the class's message. | Not a user-facing contract; tests update. |
| Contract drift? | The client is a table keyed by contract `operationId` → method and path; a test asserts the table equals `operations` in the generated contract, with an explicit allowlist for proxied Kit and governance routes that the contract does not declare. | Proxied routes. | The allowlist names them; everything else must be in the contract. |
| Retry and timeout? | Unchanged: 15 s timeout, no retry. | — | — |
| Lease transport? | One `viewerLeaseTransport()` on the client; the pane's copy goes. | — | — |
| Blob downloads (×4), direct `runtimeStatus` calls (×11)? | Out of scope (UI and data flow, not client depth); noted. | — | — |
| Tests? | Client tests with a fake transport for error mode, headers (`X-User-Token`, `X-Viewer-Lease-Token`, `Idempotency-Key`, the `X-Operator-Token` secure-transport guard), keepalive and `QueuedForInstance`; the drift test; existing `clients/*.test.ts` migrate. | — | — |

## Decision

### 1. Responsibility boundary

**Coordinator Browser Client** is the one browser-side module through which console surfaces and the viewer call the coordinator: one method per route of the Coordinator Browser Contract, one error type for every failure, one timeout, the viewer-lease transport, and the URL builders (`openInViewerUrl`, `minioEventsUrl`, report file URLs). Nothing else in the browser builds a coordinator URL.

### 2. Public surface

```ts
export function createCoordinatorClient(options: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }): CoordinatorBrowserClient;
export const coordinatorClient: CoordinatorBrowserClient;        // console default (COORD_BASE)
export class CoordinatorHttpError extends Error { path: string; status: number; detail: string; errorCode: string | null }
export class QueuedForInstanceError extends CoordinatorHttpError { response: QueuedForInstanceConflict }
export function isDevRoutesDisabled(error: unknown): boolean;
export function isCoordinatorNotFound(error: unknown): boolean;
```

`CoordinatorBrowserClient` has the 47 console members plus `getReviewSession`, `consumeA4Handoff`, `getA4ViewerLeaseStatus`, `recordSessionActivity`, `preauthorizeStageBinding`, `cancelStageBinding`, `getStageBindingRevisions` and `viewerLeaseTransport()`. Types come from `contract/coordinatorApi.ts`.

### 3. Drift check

`ROUTES: Record<OperationId, { method; path }>` drives the methods. `coordinatorClient.contract.test.ts` asserts that `Object.keys(ROUTES) ∪ PROXIED` equals the contract's `operations` and that every method uses the declared path template.

### 4. Incremental cutover

1. New module and tests; `console/coordinatorClient.ts` and `clients/coordinatorClient.ts` become re-exports; Window and the pane switch.
2. Import codemod, shim deletion, `clients/*.test.ts` migration.

## Considered Options

- Generate the client from the contract: rejected; only one runtime reads it and the method bodies are one-liners; the drift test gives the same guarantee.
- Keep two clients and share only the error class: rejected; the lease transport and seven endpoints would remain duplicated.
- One Coordinator Browser Client: accepted.

## Consequences

### Positive

- Error classification works for every route; one lease transport.
- The contract is enforced from both sides.

### Negative

- About 106 import lines change.
- The viewer's error message text changes.
- A `PROXIED` allowlist must be maintained.

## Verification

1. `cd web-viewer-sample && npx vitest run src/coordinatorClient src/clients src/console/ReviewSessionViewerPane.test.tsx`, `npx tsc --noEmit`, `npm run build` and `npm run build:ui`.
2. `bim-review-coordinator`: `tests/browser-contract-drift.test.ts` green after `npm run contract:emit` (no contract change expected).
3. Functional browser E2E: the console A1 workflow and the viewer lease claim, heartbeat and release against the real coordinator.
4. `git diff --check`.

## Rollback

Source revert; the shim PR reverts independently of the codemod PR.
