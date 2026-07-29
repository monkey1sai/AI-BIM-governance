# Quality and security gates

`scripts/verification-manifest.json` is the repository-local source of truth for gate commands, working directories, capability coverage, enforcement, coverage policy, security scans, and artifact scope.

## Gate states

- `configured: true` requires a closed `command`, `cwd`, and `enforcement` (`required` or `advisory`).
- `configured: false` requires `command: null` and a closed `not_configured_reason`. It is emitted as `not_configured`; it is never executed or reported as passed.
- `required` failures return a non-zero runner exit. `advisory` failures remain visible in the outcome without becoming merge authority.
- Each coordinator, viewer, kit-manager API, and kit-manager web target declares `types`, `lint`, and at least one `unit` or `contract` capability. A missing tool remains an explicit policy gap.

The viewer's existing ESLint debt is isolated by `scripts/eslint-baseline.json`. `npm run lint:baseline` compares a multiset of path/rule/severity/message hashes and rejects only new findings. PR CI reads the baseline from the trusted base commit and only permits the candidate baseline to shrink. The first v2 activation is explicitly bootstrap-candidate-owned and cannot grant merge authority because the existing self-change guard requires two-phase activation. It does not print source snippets or messages. Removing findings shrinks debt; broad ignores are not the policy.

## Outcomes

Pass a full lowercase commit and a new repository-contained output path:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/verify-all.ps1 `
  -ChangedPath web-viewer-sample/src/console/pages.tsx `
  -Subject <40-hex-commit> `
  -OutcomeOut artifacts/verification-outcomes/local.json
```

`verification-outcome/v1` records the exact manifest and plan hashes plus every required target gate's command, cwd, subject SHA, duration, exit code, result, and reason. Output is restricted to `artifacts/verification-outcomes/**/*.json`, and the writer verifies the exact trusted plan gate set. It never records stdout, stderr, source, prompt, finding value, or secret value. `incomplete` means no gate ran or at least one policy is explicitly `not_configured`, `not_run`, or skipped; it is not equivalent to `passed`.

## Coverage and security

- Coverage policy is changed-lines plus named critical-contract gates. There is no whole-repository percentage. Changed-lines instrumentation is currently `not_configured`, so no coverage-pass claim is allowed.
- Secret pattern scanning and canonical exception validation are required and only report paths/counts. Dependency review and SAST are advisory policies currently `not_configured` until GitHub entitlement/feed and hosted behavior are verified; merge evidence reports their shared security target as `incomplete`, never `passed`.
- Security exceptions live only in `scripts/security-exceptions.json`. Entries require an exact scope, owner, reason, finding fingerprint, creation date, and expiry of at most 90 days. Wildcards, unknown gates, duplicates, expired entries, and extra secret-bearing fields fail closed.
- Attestation scope is deployable binaries and containers only. There is no repository-local release/registry pipeline yet, so attestation remains `not_configured`. Screenshots, traces, and test artifacts are excluded and retain their existing SHA-256 plus subject-commit binding.

Hosted dependency/SAST results, branch protection, registry/OIDC attestation, and artifact access/retention remain operational checks; local fixtures cannot prove them.
