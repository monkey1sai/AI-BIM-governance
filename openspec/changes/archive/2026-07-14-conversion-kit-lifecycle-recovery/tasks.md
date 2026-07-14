# Tasks — conversion-kit-lifecycle-recovery

- [x] 0. Spec scaffolding: add OpenSpec proposal/design/tasks/spec delta and docs/superpowers design note.
- [x] 1. Conversion truth: inspect streaming conversion list/detail/result and artifact serving path; add missing-artifact downgrade/diagnostic behavior.
- [x] 2. Conversion recovery: expose terminal converter failure as `retrigger_required` / `reingest_required` rather than dispatch retry; keep dispatch retry limited to dispatch failures.
- [x] 3. Kit lifecycle honesty: expose stage-open state separately from `kit_instance_bindings`; do not mark stage opened without kit-manager/streaming runtime command evidence.
- [x] 4. Tests: add focused regression tests for missing artifact ready downgrade, terminal failure recovery action, and metadata-binding-vs-stage-open separation.
- [x] 5. Validation: run `npx openspec validate conversion-kit-lifecycle-recovery --strict`, focused service tests, `git diff --check`, and GitNexus detect_changes.
- [x] 6. Adversarial review: perform independent cross-check against docs/plans GPU lifecycle and existing active OpenSpec changes.
