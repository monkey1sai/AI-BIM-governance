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

## TDD / Build Evidence

### bim-streaming-server (focused)

`cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q`

- Result: **22 passed** (conversion-authority regression + host-native service /
  adapter tests).
- New coverage: `/health` conversion-only identity (no WebRTC/Kit/viewport
  claim); job create/idempotency/token/success/failed via injected fake
  converter; adapter `preflight()` honest `converter_unavailable`; adapter
  `convert()` PowerShell argv contract (`-NoProfile -ExecutionPolicy Bypass
  -File <ps1> -IfcPath -OutputDir -OutputName model.usdc -TimeoutSeconds
  -Force`, `cwd=repo_root`, `shell=False`); `adapter_from_env` keeps unset
  paths None; `load_config` defaults `127.0.0.1:49101`.

### bim-review-coordinator

`cd bim-review-coordinator && npm test`

- Result: **147 passed** (11 files), including
  `tests/config.test.ts`, `host-native-conversion-ingest`, `cloud-callback-outbox`,
  and `external-ifc-ready`.

`cd bim-review-coordinator && npm run build`

- Result: **passed** (`tsc -p tsconfig.json`).

### web-viewer-sample

`cd web-viewer-sample && npm run build`

- Result: **passed**.
- Note: Vite emitted the existing large chunk warning for the bundled viewer
  JavaScript; this is a bundle-size warning, not a build failure.

## Tiered Runtime Evidence (honest classification)

Per `demo-runtime-readiness-smoke` / `runtime-verification-evidence` specs and
`AGENTS.md` §0.1, tiers are classified independently and not promoted.

| Tier | Status | Evidence / reason |
|---|---|---|
| `host_native_conversion_authority` (service contract) | **passed** | 22 streaming tests + 147 coordinator tests; `/health` conversion-only identity; idempotency/token/no-placeholder gates intact via existing store |
| `host_native_conversion_authority` (real conversion runtime) | **passed** | Real IFC input `storage/許良宇圖書館建築_2026.ifc` produced `stream_conv_20260519115219_2a69727d` with `model.status="ready"`, `source_ifc_entity_count=10872`, `hard_quality_gates.usdc_openable=true`, `hard_quality_gates.has_renderable_prims=true`, `hard_quality_gates.placeholder_output=false` |
| viewer ready-gate | **verified** | `web-viewer-sample/src/Window.tsx` still gates stage loading on model readiness; visible Chrome E2E reached the stream after coordinator exposed the ready host-native result |
| `single_kit_render` / WebRTC `49100` / browser visual | **passed on this host** | Kit PID 40240 listened on TCP `49100` and the successful WebRTC session used media port `47998`; visible Chrome E2E reported `video.readyState=4`, `videoWidth=1920`, `videoHeight=1080`, `currentTime=4.020785`, no page errors, and conversion summary visible |
| cloud callback (OQ1) | **pending** | metadata-only outbox retains pending/dead-letter; real company-cloud endpoint/auth still external. |

Environment / shell note (design.md D6): the host-native service and the
`convert-ifc-to-usdc.ps1` converter MUST be launched from PowerShell. Launching
the `.bat` / Kit tooling from Git Bash fails before startup and is an
environment/shell blocker, not a code regression.

## Local E2E Viewing Evidence

Current local services observed on 2026-05-19:

```txt
49101 host-native conversion API  LISTENING PID 45312
8004  bim-review-coordinator      LISTENING PID 43284
49100 Kit/WebRTC signaling        LISTENING PID 40240
5173  web-viewer-sample           LISTENING PID 3412
```

`47998` is the media port used in the successful WebRTC session; it may not show
as a persistent UDP listener after the browser session is closed.

Important WebRTC endpoint finding:

- `publicIp=127.0.0.1` and viewer `mediaServer=127.0.0.1` caused StreamSDK to
  repeat `Address: ... is not valid` and `Add destination addresses failed since
  it is empty for port 47998`.
- Kit MCP and NVIDIA `omni.kit.livestream.app` docs identify
  `primaryStream.publicIp` as the fixed IP for streaming media transport.
- Passing the machine LAN IPv4 consistently fixed the browser media path on this
  host:

```txt
publicIp=192.168.10.105
signalingServer=192.168.10.105
mediaServer=192.168.10.105
signalingPort=49100
mediaPort=47998
```

Verified viewer URL:

```txt
http://127.0.0.1:5173/?sessionId=review_session_78d447fa092a&projectId=project_demo_001&modelVersionId=ext_mv_utf8_001&userId=dev_user_e2e&displayName=Dev+User&kitInstanceId=kit_local_001&signalingServer=192.168.10.105&signalingPort=49100&mediaServer=192.168.10.105&mediaPort=47998&streamTimeoutMs=90000
```

Playwright headed Chrome evidence:

```txt
output/playwright/viewer-e2e-review_session_78d447fa092a-headed-lanip-url-2026-05-19T12-55-37-118Z.json
output/playwright/viewer-e2e-review_session_78d447fa092a-headed-lanip-url-2026-05-19T12-55-37-118Z.png
```

Key browser facts from the JSON:

```json
{
  "video": {
    "readyState": 4,
    "currentTime": 4.020785,
    "videoWidth": 1920,
    "videoHeight": 1080,
    "paused": false,
    "visibility": "visible"
  },
  "hasReadySummary": true,
  "hasFallbackFailure": false,
  "pageErrors": []
}
```

## Commands

```txt
worktree: C:/Repos/active/iot/AI-BIM-governance/.worktrees/introduce-host-native-conversion-authority-service
shell:    PowerShell; branch codex/openspec/introduce-host-native-conversion-authority-service at 6569e5749896c17a2031c8c1f991dce6bb9f0433 (main == origin/main)
openspec: openspec validate introduce-host-native-conversion-authority-service --strict  -> valid
streaming: cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py tests/test_host_native_conversion_service.py -q  -> 22 passed
coordinator: cd bim-review-coordinator && npm test  -> 147 passed
coordinator build: cd bim-review-coordinator && npm run build  -> passed
viewer build: cd web-viewer-sample && npm run build  -> passed
```

## Known Risks / Follow-ups

- Mapping coverage remains `warn` for the real IFC: `mapped_count=0`,
  `coverage_ratio=0.0`, `source_ifc_entity_count=10872`. This is not promoted
  to a mapping-quality pass, but the model is real and renderable.
- OQ1 (company-cloud callback endpoint/auth) remains pending; callback delivery
  state is intentionally separate from conversion and viewer success.
- Headless Chrome did not receive WebRTC media frames in this environment.
  Browser visual evidence was gathered with headed Chrome.
