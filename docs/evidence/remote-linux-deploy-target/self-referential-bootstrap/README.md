# self_referential_bootstrap evidence — remote Linux test-deploy target

`stack_kind=self_referential_bootstrap`.

**This is NOT deploy-target evidence and NOT isolated_branch_stack evidence.**
The three kinds do not infer one another (see
`docs/agents/product-operability-and-script-contract.md` §8).

## Why the pre-change mechanism cannot produce this evidence

The deploy contract (§6) requires the test deployment to rebuild from a freshly
fetched `origin/main` and explicitly forbids verifying an unmerged branch. This
PR changes that deploy path itself, so no run against `origin/main` can exercise
the changed behaviour: the target would rebuild the OLD path. Verification of a
new deploy path is only possible from the branch that contains it.

## What is being verified

`Invoke-RemoteTestDeployRebuild` against the de-identified canonical target
`canonical-linux` with owner-controlled private inventory and `-BootstrapRef`, exercising: zero-credential HTTPS
clone, the verbatim contract refspec fetch, reset, `git clean` preserving env,
`restore-exec-bits` (F-2), single-implementation env merge, and the masked
effective-env snapshot.

## Fixpoint obligation

After merge, the same verification must be re-run through the normal mechanism
(`rebuild-test-deploy.ps1 -Build` with no bootstrap ref, resolving to
`origin/main`) and its result committed under `../fixpoint/`, closing the ledger
entry. Until then the debt is open and blocks the next mechanism PR.
