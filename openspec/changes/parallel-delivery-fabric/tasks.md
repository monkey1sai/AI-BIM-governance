## 1. Phase 0 canonical governance

- [x] 1.1 Create the single canonical Fabric OpenSpec change and record its inactive-until-attested boundary.
- [x] 1.2 Reconcile the approved design, root governance, and the active autonomous-delivery delta without enabling a live second writer or autonomous review.
- [x] 1.3 Add deterministic contract tests for the writer cap, terminal vocabulary, review phases, historical-ledger freeze, and migration ordering.

## 2. Deferred implementation

- [ ] 2.1 Implement the record issuer, queue/trust-root/policy fixtures, and external CheckRun verifier in separately reviewed, source-pinned changes.
- [ ] 2.2 Run a disposable `CANARY_ACTIVE` delivery and attach exact-SHA evidence before any `AUTONOMOUS_ACTIVE` transition.
