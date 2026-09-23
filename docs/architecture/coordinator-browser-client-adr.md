# ADR: One Coordinator Browser Client

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`.

Builds on the Coordinator Browser Contract (`bim-review-coordinator/src/contract`; generated `web-viewer-sample/src/generated/coordinator-api.ts`).

## Context

The browser has three general-purpose modules that call the coordinator. Two of them are: `web-viewer-sample/src/console/coordinatorClient.ts` (623 lines; an object literal with 47 members used by 46 production files) and `src/clients/coordinatorClient.ts` (391 lines; a class with 15 methods used only by `Window.tsx`). Eight more production files build their own coordinator URLs with `coordinatorUrl()` and `fetch`: `console/unified/cfdClient.ts`, `console/reports/validationReportClient.ts`, the three `console/remediation/*Client.ts`, `ReopenRemediation.tsx`, `KitConsolePage.tsx` and `RealIfcConsolePage.tsx`. `cfdClient.ts` deliberately returns non-2xx replies as values so the CFD panel can render `error_code`s (:3-4). A third general-purpose client, `console/governanceClient.ts`, serves the proxied governance routes with its own base (:8), fetch (:182-221), timeout rule (:126, :186), error types including the deliberately diagnostic-free `A4GovernanceError` (:172-179, thrown at :203) and export URL builders (:290, :455); 14 production files import it, `Window.tsx` among them. Four more places concatenate the coordinator base by hand: `console/viewer/IfcSemanticPanel.tsx:104-105`, `console/viewer/MockViewport.tsx:73,77`, the viewer's `/ui` link at `Window.tsx:5979` and the structured-log sink at `lib/structLogBootstrap.ts:74`. Seven endpoints are implemented in both with small differences (the class does not encode the stream-config session id; the close bodies differ). Each declares its own `CoordinatorHttpError` with a different constructor and message. Inside the console client, `jsonGet` and `jsonPostWithHeaders` throw the typed error while `jsonPost`, `jsonPut` and `jsonPutWithHeaders` throw a plain `Error`, so `isDevRoutesDisabled` and `isCoordinatorNotFound` work for 32 of 47 members. The viewer-lease transport is built twice (`clients/coordinatorClient.ts:246-252`, `console/ReviewSessionViewerPane.tsx:215-219`).

No test checks what the clients call against the contract; `bim-review-coordinator/tests/browser-contract-drift.test.ts` checks that the committed document matches a fresh emission and that the generated types carry its hash. Both run from one Vite entry; the viewer runs in an iframe document with its own base URL. Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| One module or two? | One, in `src/coordinatorClient/`, created by a factory (`createCoordinatorClient({ baseUrl, fetch, timeoutMs })`) with a default instance for the console; Window constructs its own with its base URL. The eight URL-building files become typed families of the client (CFD, remediation, validation reports, Kit console, real-IFC console) that call through its transport; `coordinatorUrl` and `isSecureOperatorTransport` stay exported. | 46 importers move; the families have their own reply style. | Two PRs: module plus re-export shim, then a mechanical import codemod, family migration and shim deletion. The value-style reply is kept as a second entry point (next row). |
| Style? | Keep the per-route method style (what 46 files use); fold in the class's eight viewer-only methods; keep `QueuedForInstanceError` as a subclass of the single `CoordinatorHttpError`. | — | — |
| Error mode? | Every non-2xx thrown by the throwing entry points is `CoordinatorHttpError { path, status, detail, errorCode }` with the console message format `coordinator <path> -> <status> <detail>` kept verbatim (shown through `String(e)` in about 15 places). A second transport entry point, `attempt(...)`, returns `{ status, body }` for surfaces that render error codes and resolves network or timeout failures to `{ status: 0, body: null }` as `cfdClient.ts` does today; the CFD panel keeps its value-style replies through it. One transport, one error type, two entry points. | Window tests assert the class's message; two entry points is one more than one. | Not a user-facing contract; tests update. The CFD panel's honest `error_code` rendering is a product behaviour, not an accident, so it gets a named entry point instead of its own `fetch`. |
| The governance proxy client? | Stays a separate module. The Coordinator Browser Contract excludes proxied governance payloads by design, and the A4 errors must stay diagnostic-free, so it keeps governance-owned error types. It must resolve its base and timeout defaults through the client's transport and build URLs with `coordinatorUrl`; its own `COORD_BASE` and `jsonFetch` go. | Round-2 review proposed folding it in as a sixth family. | Folding it in would either weaken the A4 safe-error rule or add a third error style to the client. "One transport" still holds; "one error type" is scoped to coordinator-answered routes. |
| The four hand-built base concatenations? | The semantic panel and the mock viewport call `coordinatorUrl`; the viewer's `/ui` link and the structured-log sink are URL uses, not calls, and are listed as the two named exceptions that also use `coordinatorUrl`. | — | — |
| Contract drift? | Every method is tagged with the contract `operationId` it serves, or `proxied` (Kit and governance routes the contract does not declare), or `non_contract` (`/health`, `/api/dev/*`). A test loads `tests/contracts/coordinator-browser-api-v1.openapi.json` and asserts every tagged operation exists with the same method and path template; several methods may serve one operation; contract operations with no browser caller (today `acceptIfcReady`) are reported, not failed. | Proxied and non-contract routes; unused operations. | The tags name them; anything untagged fails the test. |
| Retry and timeout? | No retry. Timeout policy: a per-call `signal` always wins; without one, the console instance applies today's 15 s default and the viewer instance applies none (today `clients/coordinatorClient.ts:62` has no timeout, and stage-binding preauthorization supplies its own 45 s `AbortController`). | Two instances, two defaults. | The defaults are what each side has today; the policy (signal wins, else instance default) is the single rule. |
| Lease transport? | One `viewerLeaseTransport()` on the client; the pane's copy goes. | — | — |
| Blob downloads (×4), direct `runtimeStatus` calls (×11)? | Out of scope (UI and data flow, not client depth); noted. | — | — |
| Tests? | Client tests with a fake transport for error mode, headers (`X-User-Token`, `X-Viewer-Lease-Token`, `Idempotency-Key`, the `X-Operator-Token` secure-transport guard), keepalive and `QueuedForInstance`; the drift test; existing `clients/*.test.ts` migrate. | — | — |

## Decision

### 1. Responsibility boundary

**Coordinator Browser Client** is the one browser-side module through which console surfaces and the viewer call the coordinator's own routes: one transport, one error type for every failure on those routes, one timeout policy, the viewer-lease transport, the URL builders (`coordinatorUrl`, `openInViewerUrl`, `minioEventsUrl`, report file URLs) and the operator-transport guard. Typed families (CFD, remediation, validation reports, Kit console, real-IFC console) call through its transport; the governance proxy client resolves its base and timeouts through the same transport and keeps governance-owned error types; the viewer's `/ui` link and the structured-log sink build their URLs with `coordinatorUrl`. No other module builds a coordinator URL by hand; the configuration sources that supply each instance's base (`config/env.ts`, `console/coordinatorBase.ts`) and the origin trust checks that parse it are not callers.

### 2. Public surface

```ts
export function createCoordinatorClient(options: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }): CoordinatorBrowserClient;
export const coordinatorClient: CoordinatorBrowserClient;        // console default (COORD_BASE, 15 s)
export class CoordinatorHttpError extends Error { path: string; status: number; detail: string; errorCode: string | null }
export class QueuedForInstanceError extends CoordinatorHttpError { response: QueuedForInstanceConflict }
export function isDevRoutesDisabled(error: unknown): boolean;
export function isCoordinatorNotFound(error: unknown): boolean;
export function coordinatorUrl(path: string): string;
export function isSecureOperatorTransport(): boolean;
// for families and the governance proxy client only (not exported from the package root):
export interface CoordinatorTransport {
  request<T>(tag: RouteTag, method: string, path: string, init?: RequestInit): Promise<T>;                         // throws CoordinatorHttpError
  attempt<T>(tag: RouteTag, method: string, path: string, init?: RequestInit): Promise<{ status: number; body: T | null }>; // status 0 on network/timeout failure
}
```

`RouteTag` is `{ operationId } | "proxied" | "non_contract"`. Every client method and every family method carries one; the transport refuses an untagged call at the type level.

`CoordinatorBrowserClient` has the 47 console members plus `getReviewSession`, `consumeA4Handoff`, `getA4ViewerLeaseStatus`, `recordSessionActivity`, `preauthorizeStageBinding`, `cancelStageBinding`, `getStageBindingRevisions` and `viewerLeaseTransport()`. Types come from `contract/coordinatorApi.ts`.

### 3. Drift check

Each method of the client and of every family carries a tag: `{ operationId }`, `proxied` or `non_contract`. `coordinatorClient.contract.test.ts` loads `tests/contracts/coordinator-browser-api-v1.openapi.json`, collects the tags from the client and the families, asserts that every `operationId` tag exists in the document with the same method and path template, and reports contract operations with no browser caller. Because `attempt` also takes a tag, the CFD family's nine contract operations stay inside the check.

### 4. Incremental cutover

1. New module and tests; `console/coordinatorClient.ts` and `clients/coordinatorClient.ts` become re-exports; Window and the pane switch.
2. Import codemod, migration of the eight URL-building families onto the client's transport (`cfdClient.ts` onto `attempt`), the governance proxy client onto the transport for base and timeouts, the two named URL exceptions onto `coordinatorUrl`, shim deletion, `clients/*.test.ts` migration.

## Considered Options

- Generate the client from the contract: rejected; only one runtime reads it and the method bodies are one-liners; the drift test gives the same guarantee.
- Keep two clients and share only the error class: rejected; the lease transport and seven endpoints would remain duplicated.
- One Coordinator Browser Client: accepted.

## Consequences

### Positive

- Error classification works for every route; one lease transport.
- The contract is enforced from both sides.

### Negative

- About a hundred import lines change.
- The viewer's error message text changes.
- The `proxied` and `non_contract` tags must be kept honest; the governance proxy client keeps a second error style by design.

## Verification

1. `cd web-viewer-sample && npx vitest run src/coordinatorClient src/clients src/console/ReviewSessionViewerPane.test.tsx`, `npx tsc --noEmit`, `npm run build` and `npm run build:ui`.
2. `bim-review-coordinator`: `npm run contract:check` and `tests/browser-contract-drift.test.ts` green (no contract change expected).
3. Functional browser E2E: the console A1 workflow and the viewer lease claim, heartbeat and release against the real coordinator.
4. `git diff --check`.

## Rollback

Source revert; the shim PR reverts independently of the codemod PR.
