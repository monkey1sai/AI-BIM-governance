# Result 02-docs-plans-requirements: Docs Plans Requirements

## Summary

All eight `docs/plans/` files were treated as requirements input, including `ai-bim-geo-viewer-prototype.html`. The folder is the product requirement source for "what to build", while the HTML files are UX/behavior references, not production proof.

## Evidence

- `docs/plans/docs-plans-README.md` defines precedence: interaction spec, v3 plan/DoD, v2 design spec, then both HTML prototypes.
- The plans require evidence-first delivery: route operation, true APIs/data where claimed, provenance-backed honesty labels, screenshots/logs/traces, official standards, and no prototype-as-product claims.
- Governance implications include: PRs must cite requirements, user-facing work must include route/button/fixture/evidence, and automation must prevent fake buttons, optimistic UI, hardcoded truth, direct browser `:49102`, and canvas pretending to be WebRTC.

## Files changed

None by this packet. Parent implemented governance controls after integration.

## Decisions

Use `docs/plans` as the maturity scoring requirement corpus. Require PR evidence to map back to `docs/plans`, v3 DoD, interaction cards, route contracts, official standard boundaries, or evidence artifacts.

## Risks

The checklist asks for coding governance maturity, but several `docs/plans` requirements are product/runtime requirements. Governance can force evidence; it cannot produce GPU/WebRTC/product proof by itself.

## Verification run

Read-only packet; no tests.

## Open questions

None.
