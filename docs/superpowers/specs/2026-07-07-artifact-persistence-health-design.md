# Spec: edge artifact health persistence

Nature: formal design evidence for PR #312. OpenSpec was retired for this repo in favor of Superpowers specs under `docs/superpowers/specs/`; this file documents the required exception evidence for behavior, workflow, code, and repo-boundary changes in `issue/artifact-persistence-health`.

## Problem

The deployed edge checkout `D:\Users\deploy\AI-bim-geo` is recreated from `origin/main` and can be git-cleaned during test deployment rebuilds. Runtime IFC, USDC, mapping, and health records must therefore not depend on ignored files inside that checkout. The observed failure mode was a coordinator/governance path mismatch: live mainline jobs placed IFC cache files under `D:\Users\deploy\AI-bim-geo-data\storage`, while the conversion/governance boundary still treated the checkout-local `storage` directory as the allowed root, causing errors such as `local IFC path is outside storage_root`.

The product architecture also separates cloud control-plane metadata from customer edge data-plane payloads. Cloud-facing responses may expose model IDs, site IDs, timestamps, booleans, and failure classes, but must not expose IFC/USD payload bytes, raw mapping payloads, or host absolute paths.

## Design

- Treat the local deployment test area as the first edge site:
  - Code checkout: `D:\Users\deploy\AI-bim-geo`
  - Durable edge runtime data root: `D:\Users\deploy\AI-bim-geo-data`
  - Edge storage root: `<edge runtime data root>\storage`
  - Edge artifact root: `<edge runtime data root>\artifacts`
  - Edge ledger root: `<edge runtime data root>\ledgers`
- Add coordinator config for `EDGE_SITE_ID`, `EDGE_RUNTIME_DATA_ROOT`, and an artifact-health ledger path derived from the final edge runtime root unless explicitly overridden.
- Persist artifact health snapshots keyed by edge site, tenant, model version, artifact kind, and artifact ID. The snapshot records:
  - `source_ifc_exists`
  - `model_usdc_reachable`
  - `mapping_reachable`
  - `stale_reason`
  - timestamps and failure classifications
- Keep cloud projections metadata-only by stripping host-local paths, URLs that imply edge internals, and raw payload data.
- Probe source IFC paths only after canonicalizing them under the configured edge storage root. Reject path traversal, alternate drives, UNC paths, reparse/symlink escapes, and path-style mismatches.
- Probe model USDC and mapping URLs only against explicit trusted conversion/runtime origins. Do not follow redirects, do not attach credentials, and do not turn the probe into a generic loopback/LAN reachability oracle.
- Project the latest artifact health into coordinator list/detail/runtime/stream-config responses so the UI can block unsafe actions before they fail deeper in governance-service or the viewer.
- Return a structured `409 stale_session_artifact` from the governance for-session proxy when the source IFC is missing or outside the allowed edge storage boundary.
- Preserve `D:\Users\deploy\AI-bim-geo-data` across `rebuild-test-deploy` cleanup and ensure deployment helpers create the edge `storage`, `artifacts`, and `ledgers` directories in non-dry-run deployment paths.

## Non-goals

- Do not move IFC/USD payloads to the cloud control plane.
- Do not change `governance-service` rule semantics in this slice.
- Do not use the deployment checkout as the durable source of ignored runtime data.
- Do not claim browser E2E completion before this branch is merged and deployed through the canonical `origin/main` rebuild path.

## Validation

- Coordinator unit/integration coverage verifies artifact health ledger persistence, source path containment, URL probe allowlisting, external DTO path stripping, runtime/status projection, stream-config projection, and stale for-session 409 behavior.
- Viewer tests verify Review Room and A1 controls render artifact health state and disable unsafe actions.
- Deployment helper tests verify the edge runtime data root survives rebuild cleanup and that storage/artifact/ledger directories are created.
- GitNexus `detect_changes(scope=compare, base_ref=main)` is expected to report a high blast radius because this design deliberately touches coordinator intake/session/runtime, governance proxy, deploy helper, A1, and Review Room flows.
- Full deployment/browser E2E must be rerun after merge because the canonical deploy helper rebuilds from freshly fetched `origin/main`, not from an unmerged PR worktree.
