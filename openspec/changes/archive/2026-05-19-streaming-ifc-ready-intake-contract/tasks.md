## 1. Impact And Spec

- [x] 1.1 Read AGENTS.md and Phase B planning draft; confirm this slice is limited to `bim-streaming-server`.
- [x] 1.2 Run GitNexus impact analysis for `/api/conversions/ifc-to-usdc`, `create_conversion`, and `create_conversion_job`.
- [x] 1.3 Write the minimal OpenSpec delta for `streaming-ifc-usdc-conversion-authority`.

## 2. Streaming Contract Tests

- [x] 2.1 Add failing contract tests for configured auth: missing token -> 401, invalid token -> 403, no job is created.
- [x] 2.2 Add failing contract tests for `idempotency_key`: compatible duplicate returns existing job; conflicting duplicate returns 409.
- [x] 2.3 Add failing contract tests for invalid body 400 cases and no job creation.

## 3. Minimal Implementation

- [x] 3.1 Add optional `internal_conversion_token` setting and route-level token validation.
- [x] 3.2 Persist `idempotency_key` and request fingerprint on streaming conversion jobs.
- [x] 3.3 Return existing jobs for compatible duplicate requests and reject conflicting retries with 409.

## 4. Verification

- [x] 4.1 Add/update verification doc with impact analysis, test commands, and known risks.
- [x] 4.2 Run targeted `bim-streaming-server` pytest.
- [x] 4.3 Run `openspec validate --strict`.
- [x] 4.4 Attempt GitNexus `detect_changes` before handoff; current worktree is not indexed and analyzer refresh was rejected, so the blocker is documented in the verification note.
