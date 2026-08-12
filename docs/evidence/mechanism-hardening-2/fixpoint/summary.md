# mechanism-hardening-2 — fixpoint summary

> 文件性質：**working note**（fixpoint 完成證據）。本檔記錄已執行之驗證與其結果，不是
> contract、不是 runtime 行為權威；ledger entry 閉合後受閘門的證據不可變規則保護。15 條契約
> 命令全數以正規機制於 merge 後的 main（`daf551e`，#513 squash）重跑通過：13 條本地命令依契約
> 序單趟完成，`canonical-linux-rebuild`／`canonical-linux-deployment-verify` 兩條由 coordinator
> 以 pinned 正規形實跑（見下節）。

Closes the `mechanism-hardening-2` ledger entry per
`docs/agents/self-referential-bootstrap.md` §2 obligation 3; the two canonical commands
below are complete.

- `mechanism_commit` = `daf551e0a794c5b895333478ea518518d76390bd` — PR #513's
  squash on main's first-parent line (single-parent commit,
  parent `7d85190a7f57e8abde8725b2d07484443aa58d04`); subject binds `#513`
  (`fix(deploy,verify,launcher): mechanism-hardening-2 bundle (#490 #491
  #489-B) (#513)`); its first-parent diff touches every one of the entry's
  declared `verification_mechanism_paths`: `.github/workflows/ci.yml`,
  `scripts/deploy.ps1`, `scripts/lib/host-native-launcher.ps1`,
  `scripts/lib/platform/platform-adapter.ps1`,
  `scripts/self-referential-bootstrap-ledger.json`,
  `scripts/verification-manifest.json`, `scripts/verify-all.ps1`.
- At the time this worktree ran `git fetch origin && git rebase origin/main`,
  the worktree branch (`worktree-agent-abc04056eeef31774`) was already at
  `daf551e` — identical to `origin/main`'s tip — so the rebase was a no-op
  (`Current branch worktree-agent-abc04056eeef31774 is up to date.`). No
  commits landed on `origin/main` after the `#513` squash as of this run.
- `verification_contract` digest preserved unchanged:
  `881fac8337efca52cb16e753cc016ee3219297180bfeec092406cad5ff7b2bc6`.
- Local 13-command reverification completed **2026-08-12T11:13:04Z** (last
  local command's log timestamp); the canonical two completed at
  **11:38:36Z** and **~11:40Z**. The ledger entry's `reverified_at` is
  stamped **2026-08-12T11:40:00Z**.

## Attested run: local half of the verification contract, commands 1-13, strict contract order, single pass

All 13 commands this worktree owns were executed **in the exact
`verification_contract.command_ids` order** (positions 1-13 of the 15-item
list), in one uninterrupted pass, no reruns, each resolved through the
immutable command map `$commandSpecById` in
`scripts/tests/test-self-referential-bootstrap.ps1` at the recorded head
(`pwsh -NoProfile -NonInteractive -File scripts/tests/<id>.ps1` form). Host:
Windows, `pwsh 7.5.4`. Worktree:
`C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\agent-abc04056eeef31774`,
clean (no uncommitted changes prior to this run), HEAD `daf551e` throughout.

Per-command process-level exit code (all `0`) and completion timestamp (UTC,
2026-08-12, from each command's captured log file mtime - monotonically
increasing, confirming strict order with no rerun):

| # | command_id | exit | duration | completed (UTC) | tail evidence |
|---|---|---|---|---|---|
| 1 | `test-deploy-governance-static` | 0 | 6.4s | 11:02:43Z | `PASS deploy governance static checks` |
| 2 | `test-verify-all` | 0 | 32.7s | 11:03:16Z | `[PASS] verify-all profiles` |
| 3 | `test-host-native-launcher` | 0 | 33.7s | 11:03:50Z | `=== test-host-native-launcher.ps1: ALL PASSED ===` |
| 4 | `test-host-native-child-launch` | 0 | 1.3s | 11:03:51Z | `=== test-host-native-child-launch.ps1: ALL PASSED ===` |
| 5 | `test-platform-adapter` | 0 | 7.7s | 11:03:59Z | `[test-platform-adapter] all assertions passed on windows` |
| 6 | `test-preflight-ports` | 0 | 3.4s | 11:04:02Z | `=== test-preflight-ports.ps1: ALL PASSED ===` |
| 7 | `test-kit-log-probe` | 0 | 3.5s | 11:04:06Z | `=== test-kit-log-probe.ps1: ALL PASSED ===` |
| 8 | `test-deploy-target-registry` | 0 | 2.6s | 11:04:08Z | `[test-deploy-target-registry] all assertions passed` |
| 9 | `test-remote-deploy-transport` | 0 | 2.0s | 11:04:10Z | `[test-remote-deploy-transport] all assertions passed` |
| 10 | `test-rebuild-test-deploy` | 0 | 317.7s | 11:09:28Z | `[PASS] rebuild-test-deploy` |
| 11 | `test-self-referential-bootstrap` | 0 | 29.8s | 11:09:58Z | `[test-self-referential-bootstrap] all assertions passed` |
| 12 | `test-agent-governance-check` | 0 | 180.9s | 11:12:59Z | `[test-agent-governance-check] all assertions passed` (TAP: `# fail 0`) |
| 13 | `invoke-powershell-static` | 0 | 5.2s | 11:13:04Z | `[invoke-powershell-static] passed` |

All 13 raw logs scanned for `FAIL|Exception|Unhandled|Terminating error`; the
only hits were benign substrings inside passing assertion names (e.g. `fails
closed instead of comparing a subset`, TAP `# fail 0` counters) - no actual
failure or exception in any log.

Notes on individual commands:

- `test-rebuild-test-deploy` (command 10) is the **local mock-transaction**
  suite for `scripts/dev/rebuild-test-deploy.ps1`'s staging/cutover/recovery
  logic (junctions, reparse points, lock contention) run against a temp
  directory - it is distinct from `canonical-linux-rebuild` (command 14),
  which is the real remote rebuild against the canonical Linux
  target.
- `test-verify-all` (command 2) exercises `scripts/verify-all.ps1`'s
  assertion matrices (HTTP JSON identity/redaction rejection, Kit control
  locality accept/reject, runtime signature rejection, profile selection) -
  distinct from `canonical-linux-deployment-verify` (command 15),
  which runs `verify-all.ps1 -Profile Deployment` against the live canonical
  deployment.

## Canonical half (commands 14-15): PASS

| # | command_id | status |
|---|---|---|
| 14 | `canonical-linux-rebuild` | `PASS` |
| 15 | `canonical-linux-deployment-verify` | `PASS` |

Both executed by the coordinator on 2026-08-12 in pinned canonical form
against `origin/main` @ `daf551e` (the #513 squash), through the
owner-inventory SSH path, deploy key resolved via the default ssh identity
(no `-IdentityFile`, no `-TargetId`):

- **`canonical-linux-rebuild` (command 14)** — from a fresh `origin/main`
  isolated worktree, pinned form
  `pwsh -NoProfile -NonInteractive -File scripts/dev/rebuild-test-deploy.ps1 -Build -InventoryPath '<owner-private-inventory>'`:
  remote deploy **exit=0**, completed 2026-08-12T11:38:36Z; deployment tag
  `deploy-20260812-639221315101291265-002 -> daf551e0a794c5b895333478ea518518d76390bd`
  created and pushed (verified visible after `git fetch --tags`); effective-env
  snapshot at
  `artifacts/deploy-reports/canonical-linux/20260812T113830Z-effective-env.json`.
  Canonical env staged from the owner-private copy (gitignored), removed after
  use.
- **`canonical-linux-deployment-verify` (command 15)** — on the remote
  deploy_root, pinned form
  `pwsh -NoProfile -NonInteractive -File scripts/verify-all.ps1 -Profile Deployment -InventoryPath '<owner-private-inventory>'`
  (`<owner-private-inventory>` = remote `<runtime_data_root>/target.local.json`):
  six checks **Passed** (deployment required artifacts, coordinator health,
  governance health, conversion health, kit manager health, viewer endpoint),
  Failed list empty, **exit=0**, completed ~2026-08-12T11:40Z.

All 15 contract commands passed in contract order; `fixpoint.reverified_at`
is stamped `2026-08-12T11:40:00Z` and `fixpoint.mechanism_commit =
daf551e0a794c5b895333478ea518518d76390bd` on the ledger entry, closing it.

## Known limits

- Full-system browser, Kit/WebRTC first-frame, USD stage, DataChannel E2E are
  not claimed by this local half (consistent with the entry's opening
  bootstrap evidence boundary).
- The local half and the canonical half ran on different hosts by design:
  commands 1-13 on the Windows operator workstation, commands 14-15 through
  the owner-inventory SSH path against the canonical Linux target. Both
  halves bind to the same `mechanism_commit`.
