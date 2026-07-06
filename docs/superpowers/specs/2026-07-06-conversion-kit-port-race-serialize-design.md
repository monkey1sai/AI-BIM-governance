# Spec: serialize host-native Kit CAD conversion execution to remove port 8011 race

## Status

Approved and implemented.

- Implemented on branch `fix/conversion-kit-port-race-serialize`.
- Root cause reproduced against a live test-deploy failure (job
  `ifcready_1783310901113_82ba35bc`, `D:\Users\deploy\AI-bim-geo`,
  2026-07-06T04:08Z) before writing the fix.

## Context

Test-deploy `#/conv` panel showed one `ifc-ready` job out of a same-batch trio
(`ifcready_1783310901113_82ba35bc`, `..._911113_39af65ba`, `..._915125_9dadf7fe`,
all project 洲際好宅・建築-JJtest, ~14ms apart — one MinIO watcher batch) with
`conversion: failed`, `dispatch: [conversion] convert-ifc-to-usdc.ps1 exited 1`.
The other two jobs in the same batch succeeded.

## Verified facts

- `GET /api/external/ifc-ready/ifcready_1783310901113_82ba35bc` (coordinator
  `:8004`) and `GET /api/conversions/stream_conv_20260706040832_ecdca620/result`
  (host-native conversion `:49101`) both report
  `error.code = "converter_failed"`, `message` starting with
  `convert-ifc-to-usdc.ps1 exited 1`, pointing at a `kit-stdout.log` /
  `kit-stderr.log` pair under
  `bim-streaming-server/_cache/host-native-conversion/artifacts/<job>/`.
- `kit-stderr.log` for the failed job shows the real crash:
  ```
  ERROR: [Errno 10048] error while attempting to bind on address ('0.0.0.0', 8011)
  ...
  OSError: [Errno 10048] ...
  During handling of the above exception, another exception occurred:
  ...
  File ".../uvicorn/server.py", line 172, in startup
      sys.exit(1)
  SystemExit: 1
  ```
  i.e. Kit's own `omni.services.transport.server.http` extension (pulled in by
  `--enable omni.services.convert.cad` / `--enable omni.kit.converter.hoops_core`
  in `bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`) failed to bind its
  default port `0.0.0.0:8011`, uvicorn's `startup()` raised, and Kit called
  `sys.exit(1)`. This HTTP service is unused by this headless `--exec`
  conversion run.
- The always-on WebRTC `kit.exe` (host-native streaming/render process) was
  confirmed listening only on `49100`/`49110`-`49150` at the time of
  investigation — it does not hold `8011`. The collision is between the
  conversion jobs' own Kit subprocesses, not with the WebRTC service.
- `bim-review-coordinator/src/services/conversionDispatchQueue.ts`
  (`ConversionDispatchQueue`) is a real FIFO that serializes exactly one thing:
  the `dispatcher` closure wired at `bim-review-coordinator/src/app.ts:546`,
  which only `await`s `streamingConversionClient.createConversionJob(...)` — a
  single `POST /api/conversions/ifc-to-usdc` call.
- `bim-streaming-server` `.../conversion_authority.py` `create_conversion`
  (the handler for that POST) is `status_code=202`: it writes the job to the
  in-memory store and returns immediately via
  `background_tasks.add_task(store.complete_conversion_job, ...)`. The actual
  Kit-launching work (`complete_conversion_job` → `converter.convert(...)` →
  `ifc2usdc_powershell_adapter.py` → `subprocess.run(convert-ifc-to-usdc.ps1)`)
  runs in FastAPI's background-task thread pool, independently per request.
- Net effect: the coordinator's queue serializes *dispatch acceptance* (fast,
  resolves as soon as `202` comes back), not *conversion execution*. When two
  or more `ifc-ready` jobs are accepted within the same few-second window
  (exactly what a multi-file MinIO batch produces), their background
  conversion tasks run concurrently inside `bim-streaming-server`, so their Kit
  subprocesses can — and did — race for port `8011`.
- Confirmed via `grep`: `complete_conversion_job` has exactly one call site
  (`conversion_authority.py:112`, the `background_tasks.add_task` above); no
  other production caller exists. GitNexus's index for this repo predates this
  file's current shape (stale index warning during this session) and could not
  resolve `complete_conversion_job` / `Ifc2UsdcPowershellConverterAdapter` as
  symbols, so blast-radius was confirmed manually via `grep`/`Read` instead of
  `impact()`.

## Problem

Nothing in `bim-streaming-server` prevents two accepted conversion jobs from
running `complete_conversion_job` (and therefore launching Kit) at the same
time. The only existing serialization (`ConversionDispatchQueue`) lives one
layer too high — it only protects the dispatch HTTP call, not the resource
that actually collides (the Kit subprocess's default-port HTTP listener).

## Design

Add a `threading.Lock` (`StreamingConversionStore._conversion_lock`) inside
`bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py`.
`complete_conversion_job` acquires it before flipping the job to `running` and
calling `self.converter.convert(...)`, and releases it once that call returns
(success or failure). This makes actual conversion execution — not just
dispatch acceptance — serialize to one job at a time within the
`bim-streaming-server` process, regardless of how many `POST
/api/conversions/ifc-to-usdc` requests were accepted close together. Jobs
waiting on the lock stay in `queued` status and only flip to `running` once
they truly start, so status output stays honest.

The lock is scoped to the update-status/convert/build-result section only;
callback-payload construction and job persistence after a successful/failed
conversion run outside the lock, since they don't touch the contended
resource.

`convert-ifc-to-usdc.ps1` was deliberately left unchanged (its Kit subprocess
still enables `omni.services.transport.server.http` implicitly and still binds
`8011`) — with executions now serialized process-wide, only one Kit subprocess
is ever alive at a time, so the port can never be contended. Disabling that
unused HTTP listener via `--/exts/omni.services.transport.server.http/http/enabled=false`
remains a valid *complementary* hardening (defense-in-depth against any other
concurrency source, e.g. a second `bim-streaming-server` process or a future
worker-pool change) but is out of scope for this fix.

## Non-goals

- Do not change `bim-review-coordinator`'s `ConversionDispatchQueue` — it is
  correctly scoped to its documented purpose (serializing dispatch) and needs
  no change for this fix.
- Do not disable or otherwise touch Kit's `omni.services.transport.server.http`
  extension in `convert-ifc-to-usdc.ps1` in this change.
- Do not change conversion job data shape, API contracts, or callback
  semantics.
- Do not attempt to re-run the live failed test-deploy job as part of this
  change; that is an operational retry independent of the code fix.

## Acceptance criteria

1. `bim-streaming-server/tests/test_conversion_authority_api.py` includes a
   regression test that fires 3 concurrent `POST /api/conversions/ifc-to-usdc`
   requests against a converter fake that tracks concurrent-call depth, and
   asserts peak concurrency is `1`. The test fails (`max_active == 3`) against
   the pre-fix code and passes after the lock is added.
2. `python -m pytest tests/test_conversion_authority_api.py -q` and
   `python -m pytest tests/test_host_native_conversion_service.py -q` (run
   from `bim-streaming-server/`, via the repo's `.venv\Scripts\python.exe`)
   both pass with no regressions.
3. `python -m pytest tests/contracts/structured-log -q` (repo root) passes
   with no regressions.

## Adversarial checks

- If a future change makes `complete_conversion_job` async or moves it off a
  single-process host-native service (e.g. multiple `bim-streaming-server`
  instances behind a load balancer), this in-process lock stops being
  sufficient and the port-disable hardening (see Design) should be revisited.
- If `converter.convert(...)` starts throwing before reaching the Kit
  subprocess launch (e.g. validation errors), the lock is still held for that
  short duration — acceptable, since the failure path is fast and don't starve
  the queue.
