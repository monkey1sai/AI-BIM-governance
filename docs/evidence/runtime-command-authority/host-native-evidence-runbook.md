# Runtime command authority host-native evidence runbook

This runbook records the only supported procedure for the post-merge corrective Windows Kit/GPU evidence gate in OpenSpec change `implement-runtime-command-authority-and-rejection`.

## Scope and safety boundary

- This is test-deployment evidence, not production evidence and not retroactive proof for PR #379.
- Run only from `D:\Users\deploy\AI-bim-geo`, after it has been rebuilt from a fresh `origin/main`.
- `local-windows` is a `development_verification` role target (owner ruling 2026-08-18), not the `canonical_test_deploy` delivery surface. On this target the runner does **not** fail-closed on a dirty deployment, a checkout whose `HEAD` differs from `origin/main`, reparse-point paths, or broad `Everyone` / `Authenticated Users` / `BUILTIN\Users` write ACLs on the deployment and evidence roots — each such condition is instead recorded as an `integrity_notes` entry in the evidence bundle and the run proceeds. Only a `canonical_test_deploy` role target fails closed on these conditions. The runner still requires an allowed Kit launcher, `bim-streaming-server` command marker, deployment-root path boundary, and a live signaling-port listener that descends from the pidfile process before treating a Kit PID as deployment-owned.
- Because of the above, a run against `local-windows` always stamps `evidence_class: development_verification` in the output. It must never be quoted as delivery-grade proof, by omission or otherwise; only a `canonical_test_deploy` run can produce `evidence_class: delivery`.
- The only intentional outage action is stopping one already-verified coordinator **container ID** in a pinned local Windows Docker context. It requires exactly one Compose result, `com.docker.compose.project.working_dir=D:\Users\deploy\AI-bim-geo`, `com.docker.compose.service=coordinator`, and a running state before stop.
- Recovery is armed before stop. In `finally`, the runner starts that same container ID (never a service-name re-resolution), re-verifies it, and waits for `http://127.0.0.1:8004/health`. Missing ownership proof, an E2E failure, a missing marker, or failed recovery fails the gate.
- Control markers are create-new, UTF-8 without BOM, and bind a per-run high-entropy nonce. No credential values or raw Playwright stdout/stderr are persisted.

## Canonical procedure

From `C:\Repos\active\iot\AI-BIM-governance`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude\skills\spec-to-done\ensure-host-native-ports-free.ps1 -DetectOnly
```

If the helper reports an occupant, first establish deployment-path, command-line, or executable-path ownership. Stop for ambiguity; port or process-name evidence alone is insufficient.

When the port gate is clear, rebuild exactly with:

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build -TargetId local-windows
```

Then, from `D:\Users\deploy\AI-bim-geo`:

```powershell
pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\dev\run-runtime-command-authority-host-native-evidence.ps1
```

The runner runs lockfile-pinned `npm ci --ignore-scripts --no-audit --no-fund`, re-checks that the deployment checkout stayed clean, then invokes only the resulting local Playwright binary (never `npx`). It resolves the stage from the newest succeeded conversion whose `model_usdc` artifact is actually downloadable — #441 gave the conversion service per-artifact download authority, so a fabricated artifact URL 404s and the harness can no longer supply its own fixture — starts only `e2e/runtime-command-authority-host-native.spec.ts`, and cleans only its process-scoped environment variables after the run. If the deployment has no such conversion, the runner fails closed and asks an operator to convert a MinIO-sourced IFC first.

## Handshake and assertions

The Playwright case has no process-stop permission. It writes `outage-ready.json` with a generated run ID, request ID, and runner-issued control nonce; waits for the nonce-bound `outage-go.json`; sends its authority-outage command; then writes `outage-complete.json`. The runner writes `outage-go.json` only after coordinator ownership and health-down checks pass.

The case requires:

- Kit WebRTC first frame and observed initial stage;
- valid command success and P95 under 500 ms;
- forged, released, expired, wrong-source, wrong-session, and composition-tamper rejections, each with its own pre-command and post-command stage comparison; after the initial stage succeeds, every denial must also hold the initial baseline through a 750 ms sampled stability window followed by a final stage sample after the deadline;
- concurrent replay using two distinct request IDs, exactly one terminal per ID, and one accepted/successful mutation overall;
- authority outage rejection with unchanged stage;
- `post_merge_corrective=true`, current `origin/main` SHA, runtime identity, request IDs, session IDs, and no raw tokens.

## Evidence locations

Each run uses a unique ID. The run writes no stage input of its own: it loads an existing conversion artifact through the conversion service, so the stage lives where that job already put it, and `runner-evidence.json` names the job ID, file name, and SHA-256 under `stage.stage_source`.

The sanitized evidence bundle is below:

```text
D:\Users\deploy\AI-bim-geo-data\artifacts\runtime-command-authority-evidence\<run-id>\
├── runner-evidence.json
├── runtime-command-authority-host-native.json
├── runtime-command-authority-host-native.png
└── playwright-output\
```

Copy only sanitized result fields into tracked OpenSpec evidence. A failed or incomplete bundle is a failed Task 7.3 gate, never a partial pass. Task 1.5 remains externally held until the credential owner provides non-secret rotate/revoke confirmation.
