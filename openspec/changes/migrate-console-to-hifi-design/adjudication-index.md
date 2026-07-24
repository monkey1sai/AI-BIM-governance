# Hi-Fi convergence adjudication index

## Decisions reserved for the user

| ID | Decision | Evidence | Default until decided |
|---|---|---|---|
| HIFI-01 | Should the 93 legacy declarations be adopted, consolidated into current semantic tokens, or rejected? | `token-gap-ledger.md`; parallel CSS draft | No canon edit |
| HIFI-02 | Does the active spec require every literal geometry value to become a token, or may component-local geometry remain when no semantic reuse exists? | Existing delta is stricter than current adopted canon | Do not proliferate literal tokens |
| HIFI-03 | Sign off the CRITICAL `LifecycleStrip` and review the HIGH `A1GovernanceWorkbenchPage` / `ConversionPage` / `ReviewSessionViewerPane` consumer migration blast radius? | Fresh-worktree GitNexus impact | No product edit |
| HIFI-04 | After approval, should consumer migration be split per screen/route or grouped? | User-facing visual scope requires browser/semantic/pixel evidence | Split into reviewable visual slices |

## Required adoption sequence

1. User records decisions HIFI-01 through HIFI-04.
2. AI keeps the canon proposal in parallel draft form and does not modify the protected file in place.
3. Only the human owner performs any approved canon adoption and records version/date bump, backup path or tag, and restore dry-run evidence; approval alone does not grant AI protected-canon write authority.
4. Frontend consumer work reruns GitNexus impact against its then-current base.
5. Each affected route runs typecheck, unit tests, browser operability, semantic cases, and applicable 1440x900/1920x1080 DPR1 visual gates.
6. Rebaseline uses only `capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`; no manual manifest or PNG replacement.

## Explicit non-decisions

- OpenSpec strict validation does not approve token values or prove current factual accuracy.
- The legacy branch being clean does not make its mixed bundle mergeable.
- A CSS draft with zero current consumers does not authorize modification of the protected canon.
- This reconciliation does not claim full Hi-Fi migration, visual fidelity, or user-facing completion.
