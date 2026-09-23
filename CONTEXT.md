# AI-BIM Governance Domain Context

Canonical project language for BIM review sessions, runtime mutation policy, IFC-ready conversion coordination, and the boundary between coordinator decisions and Kit execution. This edge BIM review workspace owns local intake, conversion coordination, Kit runtime, and governance loopback; the cloud control-plane remains external.

## Conversion closed loop

**IfcReadyConversionPipeline**:
The deep module that owns one IFC-ready job from accept through conversion terminal: create/replay identity, download to shared volume, serial dispatch to conversion authority, poll/ingest, ConversionLedger writes, and metadata-only callback outbox enqueue.
_Avoid_: ConversionService, ConversionOrchestrator (vague), EdgeConversionControlPlane (implies session ownership)

**IntakeCommand**:
Already-authenticated, normalized domain input for accept (event fields, idempotency/correlation keys, resolved callback target). Not a raw HTTP request.
_Avoid_: Request, payload, webhook body (HTTP-layer words)

**Conversion terminal**:
The conversion job has reached a final conversion status ready or failed (ingest path). Distinct from download_failed and dispatch_failed, which are pre-conversion failures on the same ifc-ready job.
_Avoid_: done, complete, finished (ambiguous which stage)

**onConversionTerminal**:
Synchronous observer invoked after the pipeline has finished job terminal write, outbox enqueue, and ledger best-effort update. Its return value stays attached to that ingest call; adapters must not pass observer state through a cross-request mutable slot. Failures in the observer must not change ingest success or outbox state. Used by the app for auto Review Session and similar side effects — not for conversion authority.
_Avoid_: callback (confused with cloud callback outbox), event bus

**MinIO Watch Surface**:
The coordinator-owned deep module over the governed MinIO bucket: watcher loop lifecycle and runtime toggle, object-key → IntakeCommand derivation, idempotency watermark against ConversionLedger, loopback auto-intake dispatch, folder browse/cache, and dirty-event fan-out for operator surfaces. Its deterministic test driver is `pollNow()`; status counters are a read-only projection. It does not own intake acceptance (that is IfcReadyConversionPipeline) or conversion authority. S3 access sits behind the ObjectStorePort seam (real S3 adapter in production, in-memory fake in tests).
_Avoid_: MinioService, bucket poller, S3 watcher (implementation words), MinioClient (retired shallow module)

## Nearby concepts (owned elsewhere)

**Review Session**:
Coordinator-owned collaboration/session control-plane record (lease, stage-binding policy shadow, stream config). Not created inside IfcReadyConversionPipeline; may be attached after conversion ready via onConversionTerminal.
_Avoid_: putting session create inside the pipeline module

**Callback outbox**:
Metadata-only delivery queue to external cloud control-plane. Owned as a required step inside the pipeline at conversion terminal; retry/dead-letter remain outbox implementation details.

**ConversionLedger**:
Coordinator-local persistent shadow of conversion records for operator surfaces. Pipeline writes queued at accept path and terminal at ingest; failures are best-effort and must not block intake or ingest.

**Conversion authority**:
bim-streaming-server host-native conversion process (IFC→USDC). Pipeline talks to it only through a client adapter; does not own GPU/Kit runtime.

## Building energy CFD

**CFD Run**:
One request to compute pedestrian wind for one converted model across up to sixteen wind directions, owned by the streaming host's CFD job service from queue to terminal status.
_Avoid_: CFD job (the queue record), simulation, wind study

**CFD Case Run**:
The streaming-host module that carries one wind-direction case from the sealed shell through the containerised solve, sampling, USD overlay export and run record to one closed outcome, and runs the direction loop with cancellation and progress.
_Avoid_: runner (the Docker adapter), pipeline stage, batch, orchestrator

**CFD Run Workflow**:
The coordinator-owned bridge for CFD Runs: it binds a run to the exact converted model, keeps the CFD Run Ledger, turns pedestrian-wind exceedances into governance issues exactly once, and registers finished overlay layers on a Review Session. Execution and results stay with the streaming host.
_Avoid_: CFD service, CFD client (the adapter), CFD routes

**CFD Run Ledger**:
Coordinator-local projection of run status, queue position and findings for operator surfaces; never the authority for a run.
_Avoid_: run store, cache

## Review Session lifecycle

**Review Session Opening**:
The coordinator-owned workflow that answers a request to enter a Review Session for a ready model with a new session, an idempotent replay, or one refusal reason, across explicit ready-model intents, closed-session recreation and the automatic open at conversion terminal. It is the only writer of session-creation lineage events.
_Avoid_: session factory, session service, admission (viewer entry is Viewer Credentials)

**Recreation Receipt**:
The persisted record binding a closed session and one Idempotency-Key digest to the session created for it, so a repeated recreation replays instead of creating.
_Avoid_: idempotency cache, replay token

## Governance library workflow

**Governance Library Version Reference**:
Browser-safe logical identity `{project_id, model_id, version_name}` for one governance library IFC version. The coordinator resolves it to a governance-host path only inside the Governance Library Workflow; the browser never receives or submits that host path.
_Avoid_: IFC path, file path, server path

**Governance Library Workflow**:
The coordinator-owned bridge that validates one library command, resolves logical version references from one governance tree snapshot, shapes trusted rule-run or diff input, and returns a path-redacted opaque governance response. Governance results remain owned by governance-service.
_Avoid_: Governance service, Governance gateway, Governance authority

## Runtime mutation policy

**Runtime Mutation Authority**:
The coordinator-owned, session-scoped policy state machine covering stage-binding preauthorization, Kit command authorization, rollback, and confirmation. It does not execute Kit mutations or own the viewer lease lifecycle.
_Avoid_: Runtime command service, Kit mutation service

**Stage Binding Transaction**:
The coordinator-owned lifecycle record created by browser preauthorization for one resolved stage composition. It may remain pending, become executing, active, or failed, or be superseded without a Kit execution attempt.
_Avoid_: Stage request, Binding job

**Stage Binding Attempt**:
The immutable identity of one proposed Kit stage-load execution tied to a Stage Binding Transaction. Its base tuple is authorization and revision IDs, session, lease, source client, and full stage composition; once claimed, request ID and event type also become part of equality.
_Avoid_: Stage request, Runtime attempt

**Stage Binding Execution**:
The viewer-owned module that carries one Stage Binding Attempt on the viewer side: preauthorization, dispatch through the send pipeline, matching Kit's observed results, the Stage Proof, and exactly one terminal result to the embedding console. It does not stamp leases, block mutators or own the stream.
_Avoid_: attempt machine, stage loader, binding apply (a state)

**Stage Proof**:
The viewer's evidence that the loaded stage equals the confirmed binding revision; revoked on any unconfirmed change and restored only by an authenticated revision resync.
_Avoid_: stage status flag, loaded flag

**Mutation Gate**:
The Kit-owned module through which every stage-changing DataChannel command is admitted before its payload is acted on: local denials, DataChannel trace verification, the Runtime Mutation Authority decision and stage confirmation. It owns the authority transport; managers never call the coordinator directly.
_Avoid_: authority client (the transport adapter), gate check, permission check

## Viewer identity

**Viewer Credentials**:
The user carrier and primary viewer lease that one viewer presents to the coordinator for one Review Session. A viewer either holds them itself (it claims, keeps alive and releases the lease) or borrows them from the parent frame that embeds it (it never claims). They are replaced as a whole: any change means the principal or the lease has been handed over, and a viewer that loses its lease waits for an explicit request before claiming again.
_Avoid_: authority (reserved for coordinator decisions), lease client, viewer token

## Console viewer surface

**Viewport Slot**:
The console-owned contract between workspace pages and the single mounted viewer: the Review Session being viewed, the Viewer Gate and phase, the viewer command port with per-command state, the stage tree, and where the viewer rectangle and its controls dock. Pages never address the iframe directly.
_Avoid_: viewer context, viewport host (the mounting component), slot API (implementation)

**Viewer Gate**:
The single-source verdict, computed by the viewer pane, on whether viewer commands may be sent now, carrying one structured reason when they may not. Every console surface displays or classifies it; none re-derives it.
_Avoid_: gate chain, readiness flags, canSend

## Browser wire contract

**Coordinator Browser Contract**:
The coordinator-owned declaration of every REST route it serves to the browser — path, method, status codes, request and response payloads, and error codes — kept as one source from which the published contract document and the browser-side types are derived, never hand-written on the browser side. It covers only routes the coordinator itself answers; payloads of proxied governance and Kit routes belong to their upstream owners, and the Socket.IO and DataChannel vocabularies are separate contracts.
_Avoid_: API spec, swagger, types.ts, shared types, "the schema" (ambiguous with per-payload contract files)

**Kit Command Vocabulary**:
The single declaration of every command a viewer can send to Kit over the DataChannel — its name, the results Kit answers with, and whether it changes the stage — which every runtime reads instead of restating. Any command in it, read-only ones included, may be refused by Kit.
_Avoid_: runtime event catalog, command list, "the DataChannel schema", mutator catalog (that names only the mutating subset Runtime Mutation Authority owns)

**Viewer Embed Protocol**:
The `vg01` postMessage messages between a console that embeds the viewer and the viewer iframe — commands, replies, state pushes and lifecycle notices. It is declared once, as a TypeScript discriminated union in the Viewer Command Channel; both ends live in one bundle, so there is no JSON schema copy.
_Avoid_: parent message, bridge message, iframe protocol, vg01 schema

**Viewer Command Channel**:
The viewer module where each viewer command is registered once. In the iframe it turns Viewer Embed Protocol commands into Kit Command Vocabulary commands and routes Kit results, refusals and transport failures back to the matching reply; on the console side it provides the single request/reply correlation. It sends through the viewer's send pipeline and does not own mutator blocking, lease stamping or stage load, which are the viewer's execution of Runtime Mutation Authority.
_Avoid_: bridge, exchange (its internal parts), command bus, mutator catalog

**Coordinator Browser Client**:
The one browser-side module through which console surfaces and the viewer call the coordinator: one method per contract route, one error type for every failure, one timeout and the viewer-lease transport, checked against the Coordinator Browser Contract.
_Avoid_: API client, fetch wrapper, coordinatorClient (the object)
