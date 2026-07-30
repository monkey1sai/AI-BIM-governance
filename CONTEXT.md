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
