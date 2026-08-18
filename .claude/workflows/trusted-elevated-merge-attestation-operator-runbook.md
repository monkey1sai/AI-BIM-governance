# Trusted elevated merge attestation operator runbook

## Purpose and boundary

This runbook records the owner-operated activation sequence for the repository's
`trusted-elevated-merge` workflow while
`agent-contracts/spec-to-done.contract.json` is in
`requires_live_attestation`.

It is an operational guide only. It neither enables the workflow nor authorizes
a pull-request merge. Do not use an attestation run to merge a self-referential
mechanism change, a ledger transition, or any path matched by
`required_check_trust_boundary.mechanism_path_patterns`.

## Immutable attestation subject

Use one disposable, elevated, non-mechanism pull request. Before the first
dispatch, record its repository, PR number, exact head OID, exact base OID, and
selected apex provider. Keep all five values unchanged through negative and
positive attestation. Any PR edit, base movement, provider change, re-run, or
new workflow run requires a fresh nonce, expiry, assertion, and attestation
tuple digest.

The owner must ensure that the disposable PR has a normal fixed-reviewer
approval and all applicable required checks. The protected environment approval
is a separate current-run gate; it never substitutes for the pull-request
review.

## Preflight

1. Fetch `origin/main`; the workflow must be read from that exact default-branch
   revision, never from the candidate branch.
2. Verify the protected environment is `trusted-elevated-merge`, has only the
   fixed reviewer, prevents self-review, disallows admin bypass, and permits
   only `main`.
3. Verify the GitHub App is installed only for this repository and its
   permissions match the machine contract. Do not expose a credential value in
   a terminal, pull request, issue, job summary, or artifact.
4. Confirm all owner-provisioned secret names and non-secret model variables
   exist. During attestation, the only mutable activation variables are
   `TRUSTED_MERGE_ACTIVATION_MODE` and
   `TRUSTED_MERGE_ATTESTATION_TUPLE_SHA256`.
5. Compute the tuple digest from the canonical fields
   `repo`, `prNumber`, `headOid`, `baseOid`, `action`, `activationMode`, and
   `provider`. It is mode-bound; a negative digest is invalid for positive mode.

## Negative attestation

1. Set the external mode to `attesting_negative` and set its exact tuple digest.
2. Dispatch `trusted-elevated-merge.yml` from `main` with the same mode, exact
   PR/head/base/provider, a fresh base64url nonce, and an expiry within fifteen
   minutes.
3. After the challenge job emits its assertion, the fixed protected-environment
   reviewer manually approves that exact assertion for this run.
4. Preserve evidence for the required negative cases: tuple and mode mismatch,
   wrong reviewer, nonce and expiry failure, re-run, head/base drift, GitHub App
   mismatch, protection drift, and review drift.
5. A valid negative run succeeds only when its terminal result is
   `status=held`, `merged=false`, `mergeCommit=null`, and
   `negative_attestation_merge_forbidden`. Any merge is a stop condition.

## Positive attestation

1. Re-read the disposable PR, its checks, reviewer identity, conversation
   state, branch protection, and exact base/head. Stop if any value drifted.
2. Keep the same PR identity and provider, then set the external mode to
   `attesting_positive` with a newly computed, mode-bound tuple digest.
3. Dispatch a new run with a new nonce and expiry. The protected-environment
   reviewer must approve the new assertion; the negative assertion is never
   reusable.
4. Accept only an authoritative terminal result of `status=merged`,
   `merged=true`, and the exact merge commit. Fetch `origin/main` and verify
   that commit is reachable before declaring positive attestation complete.

## Activation closure and rollback

After a clean positive result, use a separate reviewed closure PR to change the
repository machine state to `active`. Only after that PR is merged may the owner
set the external mode to `active` and clear the tuple-digest variable. This
closure is independently governed; if it changes a verification mechanism, it
must follow the repository's self-referential bootstrap rules.

At every point, stop rather than use `--admin`, force-push, bypass, auto-merge,
or a synthetic review. If an attestation input or live protection snapshot
drifts, return to preflight and start a fresh run.
