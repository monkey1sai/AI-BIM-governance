# Host-native Conversion Authority Service Verification (2026-05-19)

## Scope

Change id: `introduce-host-native-conversion-authority-service`

Adds a host-native, conversion-only HTTP service in `bim-streaming-server`
(default `127.0.0.1:49101`) that loads the existing `create_conversion_api_app`
factory, plus an `Ifc2UsdcPowershellConverterAdapter` (design.md D7) and the
coordinator pull-ingestion route. Per `AGENTS.md` and Phase B, the official
external IFC-ready entry point remains `bim-review-coordinator`
`POST /api/external/ifc-ready`; this service is internal-only and conversion-only
(it does not claim WebRTC `49100`, Kit launcher, or viewport readiness).

## Impact Analysis

GitNexus index status on 2026-05-19:

- `mcp__gitnexus__list_repos` reported the indexed `AI-BIM-governance` repo was
  16 commits stale (last indexed `9d7db83`).
- `npx gitnexus analyze --embeddings --skills --skip-agents-md` was run locally
  to refresh the index to base `0bae19e` (4,128 nodes / 7,164 edges / 186
  flows). `--skip-agents-md` preserved the tracked AGENTS.md/CLAUDE.md sections.

Pre-change `gitnexus impact` (upstream) on the symbols this change wires into:

- `create_conversion_api_app` (bim-streaming-server conversion_authority.py): LOW
  — direct callers 0, processes 0
- `StreamingConversionStore` (conversion_authority.py): LOW — 0 / 0
- `streamingConversionClient` (bim-review-coordinator app.ts): LOW — 0 / 0
- `callbackOutbox` (bim-review-coordinator app.ts): LOW — 0 / 0

Overall pre-change risk: **LOW**. The change is additive via dependency
injection (new runner + adapter through existing `converter=` / `settings=`
parameters); store gate logic (`_required_output_paths` /
`_assert_publishable_outputs`) is not modified or bypassed. The coordinator
change extracts a behavior-preserving `ingestConversionReport` helper and adds a
pull route + client method.

## TDD Evidence

### bim-streaming-server (focused)

`cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q`

- Result: **19 passed** (10 pre-existing conversion-authority regression +
  9 new host-native service / adapter tests).
- New coverage: `/health` conversion-only identity (no WebRTC/Kit/viewport
  claim); job create/idempotency/token/success/failed via injected fake
  converter; adapter `preflight()` honest `converter_unavailable`; adapter
  `convert()` PowerShell argv contract (`-NoProfile -ExecutionPolicy Bypass
  -File <ps1> -IfcPath -OutputDir -OutputName model.usdc -TimeoutSeconds
  -Force`, `cwd=repo_root`, `shell=False`); `adapter_from_env` keeps unset
  paths None; `load_config` defaults `127.0.0.1:49101`.

### bim-review-coordinator (focused + verify)

`cd bim-review-coordinator && npm run verify` (= `tsc -p tsconfig.json && vitest run`)

- `tsc -p tsconfig.json`: exit 0 (clean).
- `vitest run`: **143 passed** (10 files), including new
  `tests/host-native-conversion-ingest.test.ts` (3) and full regression of
  `cloud-callback-outbox` (8) / `external-ifc-ready` (9) confirming the
  `ingestConversionReport` extraction is behavior-preserving.

## Tiered Runtime Evidence (honest classification)

Per `demo-runtime-readiness-smoke` / `runtime-verification-evidence` specs and
`AGENTS.md` §0.1, tiers are classified independently and not promoted.

| Tier | Status | Evidence / reason |
|---|---|---|
| `host_native_conversion_authority` (service contract) | **passed** | 19 streaming + 143 coordinator focused tests; `/health` conversion-only identity; idempotency/token/no-placeholder gates intact via existing store |
| `host_native_conversion_authority` (real conversion runtime) | **blocked** | No Kit/HOOPS converter prerequisites on this host; adapter `preflight()` raises `converter_unavailable` by design — honest blocker, not a fabricated pass. Rerun: `pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1` then `pwsh -File scripts/smoke-host-native-conversion.ps1` |
| viewer ready-gate | **verified (code intact)** | `web-viewer-sample/src/Window.tsx:534` still gates `openStageRequest` on `streamConfig.model.status === "ready" && !isBlockedLifecycle(...)`; `npm run build` passes. No viewer logic changed (D5). |
| `single_kit_render` / WebRTC `49100` / browser visual | **not_observed** | Requires GPU/Kit live evidence; out of scope for this slice (OQ4). Not asserted by this change. |
| cloud callback (OQ1) | **pending** | metadata-only outbox retains pending/dead-letter; real company-cloud endpoint/auth still external. |

Environment / shell note (design.md D6): the host-native service and the
`convert-ifc-to-usdc.ps1` converter MUST be launched from PowerShell. Launching
the `.bat` / Kit tooling from Git Bash fails before startup and is an
environment/shell blocker, not a code regression.

## Commands

```txt
worktree: C:/Repos/active/iot/AI-BIM-governance/.worktrees/introduce-host-native-conversion-authority-service
shell:    PowerShell (git ops via bash tool); base origin/main@0bae19e (includes PR #69)
openspec: openspec validate introduce-host-native-conversion-authority-service --strict  -> valid
streaming: cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q  -> 19 passed
coordinator: cd bim-review-coordinator && npm run verify  -> tsc 0 + 143 passed
```

## Known Risks / Follow-ups

- Real `host_native_conversion_authority` runtime evidence remains `blocked`
  until a host with the Kit/HOOPS converter prerequisites runs
  `scripts/smoke-host-native-conversion.ps1` (records `passed` only with a
  real ready result + quality metrics).
- OQ1 (company-cloud callback endpoint/auth) and OQ4 (GPU/WebRTC browser E2E)
  remain pending; this slice does not resolve them and does not fake them.
