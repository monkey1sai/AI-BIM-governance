# A4 Semantic Search Model QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task.

## Goal

Deliver the active OpenSpec change `a4-semantic-search-model-qa` as a session-first,
evidence-bound A4 search capability. A browser may submit only an explicit query and
mode; governance validates and scans a coordinator-resolved IFC, issues signed
per-row proofs, and persists an A4 Issue only after a separate user confirmation.
`#/workspace?dock=a4` is the one live A4 surface. Any 3D action is an opaque,
single-use handoff to the existing viewer; it must remain disabled unless the shared
C-M4 runtime capability proves an authentic primary lease and terminal result.

## P0 decisions and non-negotiable boundaries

- This is Lane S / `spec-to-done`, on branch
  `codex/openspec/a4-semantic-search-model-qa` in
  `.worktrees/a4-semantic-search-model-qa`.
- The user explicitly authorized a **narrow exception** to the docs/plans frozen
  surface: modify `bim-review-coordinator/src/routes/governanceProxy.ts` only as
  needed for A4, and add only opaque `a4_handoff` to the existing `/ui/open?session=`
  contract. `app.ts` changes are limited to that additive allowlist entry and the
  minimum proven wiring; do not refactor its redirect/routing/DI surfaces.
  Preserve legacy session handoff status, validation, parameter ordering, and
  non-A4 query behavior byte-for-byte.
- The change may modify only the active capability deltas
  `a4-semantic-search`, `edge-console-operator-frontend`, and
  `governance-issue-tracking`. Do not revive `unified-governance-console` or add a
  shared Kit/DataChannel producer/schema.
- Browser code must never supply an IFC host path, mapping path, signing key,
  proof payload, primary lease capability, or authoritative actor identity.
- C-M4 #307 and its shared hardening remain external dependencies. Until they are
  independently evidenced, A4 table/Issue work may complete but **Full completion
  claimed = no** and A4 3D controls must fail closed.
- Never read or print a secret value. A live Ornith smoke is optional evidence and
  is not a substitute for deterministic CI tests.

## Architecture

```text
canonical A4 dock
  -> coordinator session route (authenticate + resolve artifact/mapping/binding)
  -> governance search (validator -> deterministic/semantic interpreter -> IFC scan)
  -> signed per-row proof + sanitized trace
  -> coordinator A4 Issue route (reauthorize current principal + binding)
  -> governance A4 Issue transaction (proof id + three digests)

mapped selected row
  -> coordinator opaque A4 handoff create
  -> /ui/open?session=<id>&a4_handoff=<opaque>
  -> existing session viewer consumes/revalidates intent
  -> existing focus/highlight message and ack path
```

## Pre-change evidence and blast-radius result

- GitNexus index was refreshed at `5fa6ca5`; `node .gitnexus/run.cjs status`
  reported `up-to-date`.
- `registerGovernanceProxy`: MEDIUM (`createCoordinatorApp` fan-in).
- `IssueStore.create_issue`: MEDIUM (existing Issue and diff callers).
- `search_model`: LOW.
- `A4SemanticSearchPage`: **HIGH**: it feeds `EdgeConsole`, `renderBody`, and the
  legacy console path. Preserve aliases as redirects to the canonical A4 route and
  add explicit route/component regressions before changing the UI.
- GitNexus FTS/BM25 is unavailable locally. Use its exact symbol/route/impact data
  for formal risk decisions and use direct source/test inspection for discovery;
  do not mistake degraded keyword search for a no-impact result.

## Test strategy

1. Begin each slice by adding a focused failing test, then make it pass without
   weakening an existing assertion.
2. Re-run the affected command immediately after the slice. Only then proceed to
   the next service.
3. Keep mock Ornith tests deterministic. A live model smoke and host-native Kit
   run are completion evidence, not unit-test dependencies.
4. Preserve user-facing evidence separately: source route, main action, fixture,
   coordinator API, query/request/runtime IDs, visible state, screenshot/trace,
   design result, and remaining gates.

## Task 0 — Bootstrap the isolated worktree without conflating environment failure with a regression

**Files:** no product-code change. Record only non-sensitive tool/version evidence
in the Spec-to-Done state artifact.

**Implementation:**

1. Confirm the linked worktree has the required lockfiles and no inherited ignored
   dependency directories. Install Node dependencies separately in the coordinator
   and viewer using their committed lockfiles; never copy `node_modules` from the
   primary checkout.
2. Probe the prescribed host Python and pytest without changing the Python
   environment. Verify that OpenSpec is already available at a known version;
   never let `npx` implicitly download a tool during a governed validation.
3. If any bootstrap command fails, record the exact cwd/tool/version and mark the
   environment sub-gate HELD. Do not call missing dependencies a failing A4 test.

**Run:**

```powershell
Set-Location bim-review-coordinator
npm ci
Set-Location ..\web-viewer-sample
npm ci
Set-Location ..\governance-service
& "C:\Program Files\Python312\python.exe" -m pytest --version
Set-Location ..
npx --no-install openspec --version
```

**Expected:** each command is attributable to its service cwd; no network fallback
or secret value is emitted.

## Task 1 — Establish the A4 regression baseline and controlled fixtures

**Files:**
- Modify: `governance-service/tests/test_search_model.py`,
  `governance-service/tests/test_search_llm.py`,
  `governance-service/tests/test_issues.py`
- Modify: `bim-review-coordinator/tests/governance-search-for-session.test.ts`
- Modify: `web-viewer-sample/src/console/A4SemanticSearchPage.test.tsx`,
  `web-viewer-sample/src/console/routing.test.ts`
- Add only if required: small text IFC/mapping fixtures beneath an existing
  test-fixture directory; never commit real/local `storage/` artifacts.

**Implementation:**

1. Record the exact worktree cwd, `HEAD`, clean status, and existing test results
   in the Spec-to-Done evidence/state artifact.
2. Before any live smoke, perform the credential-safety gate with the credential
   owner: confirmed exposed A4/Ornith credentials are rotated/revoked, tracked
   samples retain placeholders only, and evidence records only filename, key name,
   owner-confirmed status, and timestamp. Do not modify an existing real `.env` or
   print a value. If this evidence is unavailable, deterministic tests may proceed
   but live semantic/full completion is blocked.
3. Extend the existing inline/tiny IFC fixture with mapped, unmapped, matched,
   non-matched, and truncation cases. Keep it non-sensitive and small enough for
   a normal unit test.
4. Add red tests for the contracts used by Tasks 2–8: zero scan for invalid or
   unusable candidates; session-only client controls; canonical A4 route; and
   no generic manual Issue creation from an A4 result.
5. Preserve unrelated pre-existing failures as a baseline, not as an A4 pass.

**Run:**

```powershell
Set-Location governance-service
& "C:\Program Files\Python312\python.exe" -m pytest tests/test_search_model.py tests/test_search_llm.py tests/test_issues.py -v
Set-Location ..\bim-review-coordinator
npm test -- tests/governance-search-for-session.test.ts
Set-Location ..\web-viewer-sample
npm test -- src/console/A4SemanticSearchPage.test.tsx src/console/routing.test.ts
```

**Expected:** focused red tests identify the missing contract; no real IFC, URL,
or credential value appears in output.

## Task 1B — Establish the minimal trusted A4 authorization and artifact context

**Files:**
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`
- Modify: `bim-review-coordinator/src/app.ts` **only** to inject the existing
  `UserAuthProvider` and narrowly-scoped A4 context resolvers into the proxy;
  do not refactor session creation, `/ui/open`, or unrelated routing here.
- Modify if required by the resolver boundary:
  `bim-review-coordinator/src/services/authProvider.ts`,
  `bim-review-coordinator/src/runtimeStatus.ts`
- Modify/add: `bim-review-coordinator/tests/auth-provider.test.ts`,
  `bim-review-coordinator/tests/governance-search-for-session.test.ts`, and a
  focused A4 authorization-context test.

**Implementation:**

1. Define `resolveA4AuthorizationContext(request, sessionId)` at the coordinator
   boundary. It calls the injected `UserAuthProvider` once and returns only
   server-derived values:

   ```ts
   {
     principalRef, authScope, sessionStatus,
     primaryLeaseCapability, primaryArtifactId, modelVersionId,
     mappingProvenance, activeBindingRevision
   }
   ```

   `principalRef` comes from authenticated provider output, never body/header
   actor, `ReviewSession.created_by`, URL query, or an old lease-token shape.
   `primaryLeaseCapability` may be marked verified only by the shared C-M4 owner
   contract; `role=primary`, a browser lease token, or existing shape validation
   alone must resolve as unavailable.
2. Resolve mapping only from the active coordinator artifact/binding. The resolver
   must allowlist its source, enforce timeout/size/content-type checks, and produce
   immutable mapping digest/provenance. It returns a coordinator-controlled handle
   or validated bytes to governance—not a browser URL, a browser path, or a raw
   remote URL governance could fetch. Bind mapping digest, primary artifact, model,
   and active binding revision together.
3. Treat absent authentic lease capability as a fact, not an error to work around.
   In local trusted-fake tests, exercise the downstream persistence contract; in a
   production profile, `local-dev`, `pending_oq5`, or unavailable authentic lease
   disables A4 Issue/handoff/3D mutation before forwarding. The UI receives only
   a safe eligibility reason and `Full completion claimed` remains no.
4. Define the coordinator-to-governance trusted-context DTO now. Browser requests
   may carry only query/mode/limit/retry and opaque proof tokens; they must be
   rejected if they contain actor, source type, snapshot/hash, model/artifact/
   revision, IFC/mapping path, decoded proof claim, or mapping URL authority.

**Tests:** authenticated principal versus forged body/header actor; `created_by`
cannot grant authority; stolen/expired/shape-only primary lease; production
local-dev/pending-SSO rejection; malicious URL/path traversal/stale mapping/
artifact mismatch/mapping unavailable; and trusted context has no browser-derived
authority fields.

**Run:**

```powershell
Set-Location bim-review-coordinator
npm test -- tests/auth-provider.test.ts tests/governance-search-for-session.test.ts
npm run build
```

**Expected:** later A4 proof/Issue/handoff slices have one concrete authenticated
context seam. No production route can substitute legacy `created_by` or a client
lease token for it.

## Task 2 — Make search validation server-computed and fail closed

**Files:**
- Modify: `governance-service/search/interpreter.py`
- Modify: `governance-service/search/engine.py`
- Modify: `governance-service/search/api.py`
- Modify tests from Task 1.

**Implementation:**

1. Extend `InterpretedFilters` (or a new adjacent immutable validation value) to
   represent normalized filters, `schema_valid`, `complete`, `usable`, and
   `unresolved_terms`. Compute these from the original query, consumed spans, and
   normalized filter schema; never trust LLM-declared execution flags.
2. Change `filters_from_structured_dict()` so discarded/malformed fields are
   reportable validation failures rather than silently becoming a complete
   candidate. Preserve strict schema validation for all supported filters,
   including proximity constraints.
3. Rewrite `_resolve_filters()` as an explicit `deterministic` / `semantic` /
   `auto` table: deterministic never calls Ornith; semantic calls Ornith once and
   never silently falls back to deterministic; auto direct-scans only a complete,
   usable deterministic candidate and otherwise calls Ornith exactly once before
   it can offer deterministic partial confirmation. Every first incomplete,
   schema-invalid, or unusable response is zero-row and zero-scan. The currently
   unreachable `auto` hybrid branch must become intentional or be removed.
4. For a safe-but-incomplete deterministic result, return zero rows and an
   opaque, short-lived `partial_fallback_confirmation_required` response bound to
   session/principal/model/artifact/binding. Add a separate confirmation input;
   it may scan only the exact bound normalized candidate and responds
   `partial_table_only`, `degraded_to_deterministic=true`, and
   `partial_execution_confirmed=true`. It must never issue a proof or enable
   Issue/3D eligibility.
5. Correct `scanned`, `matched`, `not_matched`, `returned`, `mapped`, `unmapped`,
   and `truncated` so that full candidates count the complete evaluated set,
   while mapping counts describe returned rows only. Never label rejected/fake
   mappings highlight eligible.
6. Add deterministic resource budgets for candidate count, scan wall time, and any
   applicable file-size policy. A budget-exhausted scan returns truthful
   lower-bound/incomplete metadata (not fake complete counts) and is ineligible
   for proof, Issue, or 3D action. Only a fully evaluated result can be signed.

**Tests:** add scanner and model-call spies to prove all invalid/unusable/
unconfirmed paths perform zero scans; prove the mode call-count matrix; verify a
confirmed partial request executes the same bound candidate and no other query;
and verify `partial_fallback_id` expiry plus session/principal/model/artifact/
binding mismatch rejection; add an oversized/timeout fixture proving budget
exhaustion emits no proof or action eligibility.

**Run:**

```powershell
Set-Location governance-service
& "C:\Program Files\Python312\python.exe" -m pytest tests/test_search_model.py tests/test_search_llm.py -v
```

**Expected:** all truth-table paths are explicit, scanner guards are regression
tested, and response metadata remains non-sensitive.

## Task 3 — Harden Ornith configuration, response sanitation, and proof signing

**Files:**
- Modify: `governance-service/search/llm_client.py`
- Modify: `governance-service/search/engine.py`, `governance-service/search/api.py`
- Add: a small `governance-service/search/proofs.py` only if it keeps signing and
  verification isolated from LLM transport.
- Modify: `governance-service/tests/test_search_llm.py`

**Implementation:**

1. Make `A4_LLM_ENABLED` default to false. Normalize `A4_*` and `ORNITH_*` aliases
   and return sanitized `llm_config_invalid` with zero outbound call on conflict
   or incomplete configuration.
2. Implement the allowed transport matrix: CA/hostname verified HTTPS;
   `127.0.0.1`/`::1` loopback tunnel only; and explicitly allowlisted,
   local-dev/lab-only `trusted_lab_http`. Reject production non-loopback HTTP and
   never add a skip-verify path.
3. Make LLM transport return only structured, sanitized completion metadata:
   served model, bounded latency, finish reason, and error class. Do not forward
   endpoint, authorization header, upstream body, or raw completion to API
   response/evidence. Use one sanitized error taxonomy through transport, API,
   structured logging, trace, and test artifacts; API handlers must not serialize
   `str(exc)` from an upstream exception.
4. Add a server-only proof keyring with one active `kid`, optional previous
   verify-only key, no default key, and fail-closed invalid/missing configuration.
   Issue short-lived signed proof envelopes only for complete, eligible rows.
5. Add opaque `query_id`, optional `retry_of_query_id`, trusted session binding,
   normalized filters, and secret-safe evidence trace. Do not add a query-history
   store. Restrict `GET /api/search/llm-status` exactly to safe status fields
   (`checked_at`, probe/query/config source key names, transport class, model,
   freshness/TTL, error code). Its public state machine must distinguish
   `disabled`, `configured`, fresh `available`, fresh `unavailable`, and stale or
   config-only `unknown`; a configured model is not an observed served model.

**Tests:** mocked timeout/HTTP/empty/invalid/truncated/non-terminal responses;
alias conflicts; verified HTTPS/loopback/trusted-lab matrix (the latter requires
explicit lab profile, allow-insecure flag, and allowlisted host); no outbound call;
key rotation; governance status-state TTL transitions (`disabled`, `configured`,
fresh `available`/`unavailable`, stale `unknown`); endpoint/token/raw-probe
redaction; and no proof for partial/unusable output. Capture API error payloads,
logs, traces, and evidence artifacts in the redaction tests so a raw upstream HTTP
error body cannot escape through an exceptional path.

**Run:**

```powershell
Set-Location governance-service
& "C:\Program Files\Python312\python.exe" -m pytest tests/test_search_llm.py tests/test_search_model.py -v
```

## Task 4 — Persist A4 Issue provenance atomically without changing legacy Issue semantics

**Files:**
- Modify: `governance-service/issues/store.py`, `governance-service/issues/api.py`
- Modify: `governance-service/tests/test_issues.py`
- Add: `governance-service/tests/test_a4_issue_provenance.py`

**Implementation:**

1. Add an additive, schema-versioned A4 evidence table/field. Existing manual,
   rule-result, and diff Issues must remain readable and require no fabricated
   backfill.
2. Add a dedicated internal A4 Issue handler. It accepts a coordinator-trusted
   context and a signed proof; do not extend generic browser `POST /api/issues`
   to accept self-authored provenance. The browser DTO may contain only an opaque
   `evidence_proof` token plus editable draft fields. Reject decoded proof claims,
   snapshot/hash, query/session/actor/source type, model/artifact/revision, and
   IFC/mapping-path authority fields supplied by a client.
3. Canonically serialize and SHA-256 three distinct values: immutable
   `snapshot_hash`, exact proof-envelope `proof_digest`, and normalized
   `creation_request_hash` (including initial editable fields, GUID, accepted
   prim, model/artifact/revision, and the other two digests).
4. In one transaction, verify signature/`kid`/expiry/current binding, create the
   Issue with `source_type=a4_search` and `source_ref=query_id`, plus immutable
   snapshot, an immutable `created` audit event, unique proof ID, and all digests.
   Proof ID—not `(source_type, source_ref)`—is the A4 idempotency key so separate
   rows from one query can each create an Issue. Add a durable A4 proof-consumption
   record with `proof_id UNIQUE`; atomically claim/insert it before Issue creation,
   and roll back every consume/snapshot/Issue row together on failure.
5. For a consumed proof, reauthorize current session/principal first. Return the
   original Issue only for a constant-time exact three-digest replay, even after
   ordinary expiry/key retirement; return 409 for mismatch without a proof
   existence oracle. For an unconsumed expired proof, return the specified
   retryable draft-preservation error without writing a partial record.
6. Rebuild the snapshot only from the verified proof and a strict server allowlist:
   query text, normalized filters, interpretation/degradation/unresolved terms,
   row actual values and predicate trace, mapping status/accepted prim, model,
   artifact, binding revision, and mapping digest. Never persist browser-provided
   provenance as authoritative evidence.

**Tests:** exact replay before/after expiry, retired previous key, altered draft,
different proof bytes, concurrent identical requests, same-query distinct rows,
unauthorized replay, canonical Unicode/JSON normalization, A4 identity/audit
immutability/no-backfill, source/snapshot/request-hash immutability across normal
lifecycle transitions, response fields, and legacy sources. Add forged decoded
proof/snapshot authority tests; concurrent first-consume versus exact replay;
unique-conflict ordering (reauthorize before lookup); and no orphan rows after a
transaction rollback.

**Run:**

```powershell
Set-Location governance-service
& "C:\Program Files\Python312\python.exe" -m pytest tests/test_issues.py tests/test_a4_issue_provenance.py -v
```

## Task 5 — Make coordinator A4 search session-first and principal-bound

**Files:**
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`
- Modify or add: focused tests beside
  `bim-review-coordinator/tests/governance-search-for-session.test.ts`.

**Implementation:**

1. Consume the `resolveA4AuthorizationContext` contract from Task 1B rather than
   expanding the A1 rule-run resolver. The forwarded request uses its immutable
   principal, artifact, model, mapping digest/provenance, and binding revision;
   it never reconstructs these values from a browser request.
2. Harden `POST /api/governance/search/model/for-session/:sessionId`: resolve all
   paths/identity server-side, preserve only documented query/mode/limit controls,
   reject `ifc_source_path` and `element_mapping_path` overrides, and forward only
   trusted context to governance.
3. In a production profile, do not register generic
   `POST /api/governance/search/model` at all. Permit it only through an injected,
   test-only dependency in `NODE_ENV=test`, reject before parsing/forwarding body,
   and never use client IP, forwarded headers, query flags, or loopback origin as
   authorization.
4. Keep `for-ifc-ready/:jobId` compatibility explicitly `table_only`; strip client
   mapping override and attach scope metadata that disables proof/Issue/3D/full
   completion. Return actionable status codes without paths or secrets.
5. Preserve `GET /api/governance/search/llm-status` as a coordinator proxy of only
   the sanitized governance DTO. Add coordinator route tests here; Console-visible
   status state tests remain Task 7.

**Tests:** active/missing/closed/incomplete session; principal mismatch; forged
headers; stolen/expired lease; override rejection; server-resolved request body;
production route absent versus injected test seam; table-only scope; sanitized
LLM-status proxy; malicious mapping URL/path traversal/stale revision/mismatch/
unavailable mapping; and no leaked path/secret.

**Run:**

```powershell
Set-Location bim-review-coordinator
npm test -- tests/governance-search-for-session.test.ts tests/governance-rule-run-for-session.test.ts
npm run build
```

## Task 6 — Add the coordinator-to-governance A4 Issue authority route

**Files:**
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`
- Modify/add: `bim-review-coordinator/tests/governance-a4-issue*.test.ts`
- Coordinate request/response DTOs with Task 4; do not add shared runtime DTOs.

**Implementation:**

1. Add a session-scoped A4 Issue proxy route that authenticates the principal,
   rechecks active session, primary artifact/binding/revision, and the available
   authentic lease capability before forwarding trusted identity/context to the
   governance A4 Issue endpoint.
2. Reject inactive, cross-session, cross-principal, stale-binding, or client actor
   attempts before persistence. Apply the same production local-dev/pending-SSO
   fail-closed profile gate to mutation and handoff entrypoints. Keep the generic
   Issue proxy backward compatible.
3. If C-M4 authentic lease capability is absent, keep A4 mutation/3D routes
   fail-closed in production and expose an honest actionable eligibility reason;
   never simulate that capability in production code. Deterministic unit tests may
   use a named trusted fake context to validate governance persistence, but that
   proves only implementation behavior—not production Issue operability. If a
   future capability is claimed sufficient for production Issue while 3D remains
   unavailable, name its verified source and evidence explicitly; otherwise both
   Issue and 3D stay disabled and Full completion remains no.

**Tests:** current-principal success with a deterministic fake context; all
cross-boundary rejection paths; trusted forwarded body contains no browser-provided
authority fields; generic legacy Issue proxy remains unchanged.

**Run:**

```powershell
Set-Location bim-review-coordinator
npm test -- tests/governance-a4-issue*.test.ts tests/governance-search-for-session.test.ts
npm run verify
```

## Task 7 — Replace the A4 UI with one canonical, proof-confirmed surface

**Files:**
- Modify: `web-viewer-sample/src/console/A4SemanticSearchPage.tsx`
- Modify: `web-viewer-sample/src/console/governanceClient.ts`
- Modify: `web-viewer-sample/src/console/routing.ts`,
  `web-viewer-sample/src/console/EdgeConsole.tsx`
- Modify: `web-viewer-sample/src/console/unified/WorkspacePage.tsx`,
  `web-viewer-sample/src/console/unified/docks.tsx`, and routing helpers
- Modify/add: `web-viewer-sample/src/console/A4SemanticSearchPage.test.tsx`,
  routing/client tests, `src/console/unified/dockLiveLink.test.tsx`, and
  `src/console/unified/unified.test.tsx`.

**Implementation:**

1. Make `#/workspace?dock=a4` the live session-scoped page. Converge `#a4`,
   `#/a4`, and legacy semantic-search entries to it without retaining a second
   independently operable A4 page.
   Replace the current `WorkspacePage` / `A4Dock` fixture claims (fixed counts,
   compliance wording, and simulated highlight acknowledgement) with the real
   A4 component or a non-operable redirect. A fixture must not remain able to
   masquerade as a second A4 result surface.
2. Remove production path mode and browser mapping inputs. Show the active
   session binding; render `for-ifc-ready` compatibility as `table_only` and
   disable Issue/3D controls with the server reason.
3. Model all visible states: idle, loading, success, empty, uninterpreted,
   semantic error, partial-confirmation-required, confirmed partial, retrying,
   retry-failed, unavailable source/session, proof-expired draft-preserved, and
   handoff creating/expired/rejected.
4. Replace compliance/fixed-count/fabricated-citation copy with neutral query-match
   language, real filters, sanitized LLM state, evidence trace, and truthful
   counts. Fetch LLM readiness only through
   `GET /api/governance/search/llm-status`, rendering `disabled`, `configured`,
   fresh `available`/`unavailable`, and stale/config-only `unknown` distinctly;
   never label a configured model as observed served model. Retry must retain
   explicit query/mode and `retry_of_query_id`.
5. Require row selection, editable draft, and explicit per-row confirmation. Call
   the A4 Issue route with that row's proof; never auto-submit and never use the
   generic `source_type=manual` workflow. For N selected rows issue N independent
   atomic requests: retain successful Issue IDs, preserve failed drafts with their
   recovery/error state, and never present a fabricated all-or-nothing batch result.

**Tests:** route convergence; no host-path UI/control; neutral text/no fixture
counts; all visible states; partial confirmation; retry and draft preservation;
select/edit/confirm behavior including mixed multi-row outcomes; no automatic
Issue; zero Console DataChannel send; and coordinator-route LLM readiness TTL/
redaction/observed-model state rendering.

**Run:**

```powershell
Set-Location web-viewer-sample
npm test -- src/console/A4SemanticSearchPage.test.tsx src/console/routing.test.ts src/console/governanceClient.test.ts
npm run typecheck
npm run build
```

## Task 8 — Add opaque, primary-only A4 viewer handoff without new shared protocol

**Files:**
- Modify: `bim-review-coordinator/src/routes/governanceProxy.ts`,
  `bim-review-coordinator/src/app.ts`
- Modify: `web-viewer-sample/src/config/env.ts`, and the smallest existing viewer
  consumer seam around `web-viewer-sample/src/Window.tsx`
- Modify/add: coordinator handoff tests and viewer handoff tests.

**Implementation:**

1. Create session-scoped handoff create/consume routes. The coordinator
   reauthorizes principal/session/primary lease/artifact/revision; governance
   validates proof/snapshot/model/mapping/accepted prim. Store only opaque,
   single-use transient intent with
   `expires_at = min(configured_handoff_ttl, every_included_proof_expiry)`. A
   mixed valid/invalid selected set must reject atomically.
2. Add `a4_handoff` to the existing `VIEWER_REDIRECT_QUERY_PARAMS` allowlist and
   only then route to `/ui/open?session=<id>&a4_handoff=<opaque>`. The value is an
   opaque ID—not query/evidence/prim/proof—and legacy `session` behavior stays
   byte-compatible. Add an exact regression for legacy status, validation,
   parameter ordering, and excluded non-A4 query values.
3. Let mapped row click create a one-row `focus` handoff and explicit Highlight
   create a selected-set `highlight` handoff. Keep unmapped/truncated/spectator
   cases disabled with a truthful reason.
4. The session viewer consumes trusted intent, rechecks binding and current
   readiness, and uses the existing `buildFocusPrimRequest` /
   `buildHighlightPrimsRequest` path only after DataChannel readiness. Correlate
   one request ID to ack/timeout/retry. Console must never send directly.
5. Do not add `commandRejected`, fake Kit producer changes, dual emissions, or
   invented lease semantics. If the shared terminal-result/authentic-lease
   capability is unavailable, show a failed-closed eligibility state and keep
   Full completion no. If it is available, consume only its genuine existing
   focus/highlight terminal result or rejection and render pending/succeeded/
   rejected/timed-out states; never synthesize a rejection event.

**Tests:** create/consume/expiry/replay/cross-session/cross-principal/wrong-binding;
atomic selection rejection; focus vs highlight; stale lease/stage/principal
zero-send; retry linkage; opaque URL constraint; viewer ack/timeout state; no
Console send; spectator rejection. Extend `bim-review-coordinator/tests/dev-console.test.ts`
to prove `a4_handoff` is the only new redirect parameter and all secret/path/prim
like query values remain excluded. Assert earliest-proof expiry for mixed-expiry
sets, single-use consume/replay behavior, expired proof before consume, and
stale-binding zero-send.

**Run:**

```powershell
Set-Location bim-review-coordinator
npm test -- tests/*a4*handoff*.test.ts tests/viewer-leases.test.ts
npm run build
Set-Location ..\web-viewer-sample
npm test -- src/console/*handoff*.test.ts src/console/incomingHandoff.test.tsx
npm run typecheck
```

## Task 9 — Documentation, deterministic browser evidence, and visual gate

**Files:**
- Modify relevant active OpenSpec/docs only when implementation changes a public
  contract; do not change frozen/retired spec claims.
- Modify/add `web-viewer-sample/e2e/a4-closeout.spec.ts` (or its active replacement)
  and design baseline inputs only after the final UI is stable.

**Implementation:**

1. Replace conditional-skip/path/manual-Issue legacy A4 E2E coverage with a
   deterministic canonical session fixture. Capture route, main actions,
   coordinator API calls, visible/recovery states, screenshot, trace, console,
   and network evidence.
2. After the final token/style migration and named baseline-owner coordination,
   capture only `workspace.a4.default` using the prescribed capture script; never
   hand-edit a golden.
3. Run Windows Chromium DPR1 semantic/visual gates at 1440x900 and 1920x1080.
   Treat reference-missing/mixed states honestly and do not claim a full visual
   completion without the result artifacts.
4. At closeout, update the active edge capability Purpose/route documentation to
   state A4's evidence-backed status, preserve A5–A10 as roadmap, and verify that
   Applications/legacy routes reach the canonical workspace surface. Do not use
   broad documentation wording as a substitute for the route test.

**Run:**

```powershell
pwsh -NoProfile -File .\scripts\tests\verify-design-system-reference.ps1 -VerifyOrigin
Set-Location web-viewer-sample
npm run test:visual:design-system
Set-Location ..
pwsh -NoProfile -File .\scripts\tests\verify-design-system-visual-result.ps1 -TargetCommit HEAD -AllowUntrackedArtifacts
```

**Expected:** pixel diff <= 1%, semantic gate 100%, or a recorded, scoped non-pass
with no inflated completion claim.

## Task 10 — Optional host-native model and Kit evidence

**Files:** no product-code change unless a failing test exposes a defect inside the
approved A4 scope.

**Implementation and evidence:**

1. With credential-owner authorization and non-sensitive fixture/query, run one
   coordinator session-route Ornith smoke. Record only timestamp, sanitized query
   ID, observed `Ornith-1.0-35B` model, interpretation source, latency, finish
   reason, structured filters/status, config-source key names, and secret-scan
   result, and transport class. A missing/conflicting configuration must fail
   closed. `trusted_lab_http` may be recorded only as lab semantic-integration
   evidence; it can never satisfy the production transport or Full completion
   gate. Only verified HTTPS or an allowed loopback tunnel can satisfy that gate.
2. On Windows host-native Kit, evidence first frame, stage, DataChannel, handoff
   ID, trusted mapped prim, current authentic lease/capability, focus/highlight
   terminal result, and forged spectator rejection.
3. Do not run or simulate these as proof if the environment/authorization/C-M4
   dependency is unavailable. Record the exact missing gate and retain
   `Full completion claimed = no`.

## Task 11 — Final validation, review, and handoff

**Files:**
- Update: `artifacts/spec-to-done/a4-semantic-search-model-qa-state.md`
- Add/update concise evidence artifacts only; do not add caches, coverage, runtime
  bundles, real IFC, or secrets to the change.

**Run:**

```powershell
Set-Location governance-service
& "C:\Program Files\Python312\python.exe" -m pytest tests/ -v
Set-Location ..\bim-review-coordinator
npm test
npm run verify
Set-Location ..\web-viewer-sample
npm run typecheck
npm run build
Set-Location ..
npx openspec validate a4-semantic-search-model-qa --strict
npx openspec validate --strict
git diff --check
node .gitnexus/run.cjs analyze
```

Then run `detect_changes` against `main` with the linked-worktree path, review any
HIGH/CRITICAL affected flow, perform an in-scope secret scan that reports only
filenames/key names, and obtain independent correctness, security-boundary,
user-facing design/operability, and hygiene reviews.

**Handoff fields:** frontend route; tested buttons; fixture; backend API; observed
query/request/runtime IDs; visible states; E2E command; screenshot/trace; design
screen/manifest/result/comparison/artifacts; model/transport/auth gates; reference
gaps; known risks; and `Full completion claimed`.

## Completion matrix

| Evidence | Required for partial A4 delivery | Required for Full completion |
| --- | --- | --- |
| Deterministic search, proof, Issue, proxy, UI tests | Yes | Yes |
| Browser canonical-route/operability evidence | Yes for user-facing claim | Yes |
| Design semantic + visual gate | Yes for design-complete claim | Yes |
| Live Ornith smoke | No; disclose absent | Yes for semantic model claim |
| Production transport evidence | No; trusted lab HTTP is lab-only | Yes: verified HTTPS or allowed loopback tunnel |
| C-M4 authentic lease + terminal runtime evidence | No; 3D disabled | Yes |
| Host-native Kit focus/highlight evidence | No; 3D disabled | Yes |
