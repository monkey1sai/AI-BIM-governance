# remote-linux-deploy-target — fixpoint summary

> 文件性質：**evidence**（fixpoint 完成證據）。本檔記錄已執行之驗證與其結果，不是 contract、不是 working note；ledger entry 閉合後受閘門的證據不可變規則保護。

Closes the `remote-linux-deploy-target` ledger entry per
`docs/agents/self-referential-bootstrap.md` §2 obligation 3 and the
owner-directed closure procedure (plan task B14; agents-board handoff
codex→claude, 2026-08-05).

- `mechanism_commit` = `591f930b04026a796e570fc943c95f80a54c3337` — PR #467's
  squash on main's first-parent line; subject binds `#467`; its first-parent
  diff touches the entry's declared mechanism paths.
- `verification_contract` digest preserved unchanged:
  `44dec1d887f2f815b359eefdeb56459226881c045c76ab3c3406bfccf48dbd0c`.

## What ran

1. **Owner-authorized remote inventory provisioning** (one-off, out-of-band per
   the transport contract): `<runtime_data_root>/target.local.json`, verified
   `exists=yes mode=600 json=yes schema=yes`. No topology, account, env, or key
   values were echoed at any step.
2. **Normal rebuild, no BootstrapRef**, dispatched from a clean worktree at
   exactly the mechanism commit via
   `scripts/dev/rebuild-test-deploy.ps1 -Build -InventoryPath … -IdentityFile …`.
   Remote deployment **exit=0**, independently verified on the target:
   - checkout at `591f930` (the mechanism commit)
   - coordinator `:8004` 200, viewer `:5173` 200, Kit `:49100` LISTEN,
     conversion `:49101` 200 on loopback and on the public host
   - governance `:49102` and kit-manager `:8010` 200 **on the private-inventory
     bind host** (the deploy's own Phase 5 verify shows the same)
   - effective env present with mode 600; snapshot semantics re-derived through
     the transport-pushed runtime copy at `<runtime_data_root>/transport-lib.ps1`
     (the operator dispatch ships `scripts/lib/remote-deploy-transport.ps1`
     there so both sides share one merge implementation): valid JSON, **34 entries**, matching the
     canonical env contract.
3. **The ordered 12-command `verification_contract`**, run exactly as recorded
   in the ledger — no reordering, no substitution — every command `EXIT=0`
   (see `attestation.json`).

## Known defect found by this fixpoint (not fixable before closure)

The first live run of the operator wrapper surfaced a deterministic defect in
`scripts/lib/remote-deploy-transport.ps1`: the redacted env snapshot is written
without a trailing newline and `cat` therefore fuses the JSON with the
`== effective env snapshot end ==` marker onto one line, so the wrapper's
`\r?\n`-anchored regex can never match and the wrapper throws
`emitted no effective env snapshot section` **after** the remote deployment has
already succeeded. The transport is a classified mechanism path and the debt
gate correctly refuses mechanism PRs while this entry is open, so the fix
cannot precede this closure.

**Owner ruling (2026-08-05, option A)**: the rebuild is adjudged PASSED on the
strength of the remote exit code and the independent verification above; this
defect is recorded here and its fix is the first mechanism PR after closure
(tracked on the `feat/private-target-inventory-and-deploy-tags` branch,
plan follow-up alongside B13).

## Chronology note

The prior closure attempt (#471) attested the contract suites only, without a
real rebuild through the private-inventory path; it was closed un-merged and is
superseded by this closure.
