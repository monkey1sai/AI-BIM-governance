## 1. Re-Verify Runtime Evidence State

- [ ] 1.1 Re-read `openspec/changes/complete-spec-runtime-verification/tasks.md` and identify any checked task that still reads like successful GPU render or multi-Kit runtime validation.
- [ ] 1.2 Re-read `docs/verification/2026-05-08-spec-end-to-end-verification.md` section 6 and confirm the report states single Kit GPU render and dedicated multi-Kit routing as `blocked / not passed`.
- [ ] 1.3 Check current listeners for `49100` and `47998` and record whether Kit signaling / stream endpoints are actually available during review recheck.
- [ ] 1.4 Inspect `_worker` conversion output path and confirm whether `model.usdc` is still placeholder output or a renderable geometry artifact.
- [ ] 1.5 Inspect root `scripts/` and `bim-streaming-server/scripts/start-streaming-server.ps1` to confirm whether multi-Kit orchestration with distinct signaling ports exists.

## 2. Resolve Review Findings

- [ ] 2.1 Rewrite the GPU render tasks so checked items describe attempted verification / blocked evidence capture unless viewport screenshot or non-zero video evidence exists.
- [ ] 2.2 Rewrite the multi-Kit tasks so checked items describe topology availability check / blocker classification unless distinct Kit endpoints and concurrent browser readiness evidence exist.
- [ ] 2.3 Update the task status notes to explicitly say which tasks are complete only as blocker classification and which runtime tiers remain not passed.
- [ ] 2.4 If the verification report lacks the re-verification evidence from task group 1, update the report with the exact blocker facts without claiming runtime success.

## 3. Validation And Review

- [ ] 3.1 Run `openspec validate fix-runtime-verification-task-status`.
- [ ] 3.2 Run `openspec validate complete-spec-runtime-verification`.
- [ ] 3.3 Run `openspec instructions apply --change complete-spec-runtime-verification --json` and confirm the output no longer misleads without the clarified task wording.
- [ ] 3.4 Run `git diff --check`.
- [ ] 3.5 Run GitNexus detect changes or document why this docs-only OpenSpec update has no code symbol impact.
