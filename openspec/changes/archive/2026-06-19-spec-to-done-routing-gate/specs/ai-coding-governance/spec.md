## ADDED Requirements

### Requirement: spec-to-done agent routing SHALL have a single source of truth with a deterministic drift gate

The spec-to-done harness SHALL define every workflow `agent()` call-site's model+effort tier in a single canonical `routing.json`, generate those tiers into each `std-*.js` via a codegen tool (`scripts/gen_routing.py`) rather than runtime import, and enforce non-divergence with a deterministic test gate. Effort downgrades SHALL be opt-in via a flag that defaults off (zero behavior change), the judgment layer (`judge` tier) SHALL remain at the highest effort and be immutable to codegen, and intentionally pinned call-sites SHALL be excluded from codegen and protected by literal assertions.

#### Scenario: Routing drift is rejected by the deterministic gate

- **GIVEN** `routing.json` and the codegen-generated `ROUTING` blocks inside `std-plan.js` / `std-implement.js` / `std-evidence.js`
- **WHEN** any generated `ROUTING` block diverges from `routing.json`, or a wired call-site references the wrong tier
- **THEN** `scripts/gen_routing.py --check` SHALL exit non-zero and `tests/test_routing_consistency.py` SHALL fail.

#### Scenario: Effort downgrade flag defaults off (zero behavior change)

- **GIVEN** `flags.plan_author_xhigh` is `false` in `routing.json`
- **WHEN** the spec-to-done plan-author agent call-site is resolved
- **THEN** it SHALL resolve to the same model and effort as before the routing refactor (`opus` / `max`), and no spec-to-done agent's effective model+effort SHALL change.

#### Scenario: Judge tier and do-not-codegen sites are protected

- **GIVEN** the `judge` tier is marked immutable and the std-implement primary/retry/escalation implementer call-sites are intentionally pinned
- **WHEN** the consistency gate runs
- **THEN** the gate SHALL assert the generated `judge` block stays `opus`/`max` and that `model: implModel` plus the two `opus`/`max` escalation literals survive verbatim rather than being codegen-replaced.

#### Scenario: Invalid model/effort combination is rejected before generation

- **GIVEN** `routing.json` declares `allowed_efforts` per model
- **WHEN** a tier declares a model+effort combination outside `allowed_efforts` (for example `sonnet` with `xhigh`)
- **THEN** `scripts/gen_routing.py` SHALL raise and refuse to generate, so an illegal combination cannot reach a workflow script.
