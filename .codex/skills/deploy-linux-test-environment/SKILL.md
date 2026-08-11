---
name: deploy-linux-test-environment
description: Rebuild and verify the AI-BIM-governance canonical Linux test deployment from the owner-approved Windows workstation through the repository's owner-inventory SSH path. Use when the user asks to deploy or rebuild the Linux test area, requests "測試部署區重建", or needs a read-only preflight/status explanation for canonical-linux. Do not use from POSIX operator hosts, for local-windows, isolated branch stacks, unmerged revisions, or production deployment.
---

# Deploy Linux Test Environment

Treat this as a Lane G deployment workflow. Keep one coordinator, preserve owner boundaries, and stop before any unproven process stop, permission change, or private-input rewrite.

## Decide the action

- For questions about how, readiness, or status, inspect and explain only. Do not deploy.
- Execute a rebuild only after an explicit deploy/rebuild request. State that the remote deployment checkout will be reset/cleaned, services may restart, and a successful canonical deployment pushes a `deploy-*` tag.
- Refuse to substitute `local-windows`, an isolated branch stack, an unmerged commit, a sub-service start command, or `-DryRun` for the canonical Linux workflow.

## Load current truth

Read these files before acting; runtime code and executable tests outrank old evidence:

1. `AGENTS.md`
2. `docs/agents/product-operability-and-script-contract.md` section 6
3. `docs/agents/sub-repo-verify-commands.md` deployment section
4. `scripts/dev/rebuild-test-deploy.ps1`
5. `scripts/deploy-target-registry.json`
6. For failures only: `scripts/lib/deploy-target-registry.ps1` and `scripts/lib/remote-deploy-transport.ps1`

Before any remote reset, rebuild, restart, staging write, or other mutation, run the affected type-check, lint/static-analysis, unit, and integration gates named by the loaded verification sources. Any failure is `HELD`. List every skipped or unrun gate with its concrete reason; absence of a tool or fixture is not a pass.

## Preflight without exposing secrets

Run from the repository root with PowerShell 7 on the owner-approved Windows workstation. This workflow intentionally binds owner-private inputs to Windows SID, protected-DACL, and non-reparse-handle guarantees. A POSIX operator host is `HELD`; do not reinterpret POSIX uid/mode checks as equivalent authority or silently skip the Windows controls.

```powershell
if (-not $IsWindows) {
    throw 'canonical Linux deployment requires the owner-approved Windows operator workstation; deployment is HELD'
}
```

Record the exact cwd, branch, worktree status, and freshly fetched `origin/main` SHA. Then create a fresh sibling worktree and task branch from that captured SHA; never execute the deployment wrapper from the caller's current branch worktree:

```powershell
$callerCwd = (Get-Location).Path
$isolatedWorktreeCreated = $false
$sourceRepoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceRepoRoot)) {
    throw 'caller repository root cannot be proven; deployment is HELD'
}
$callerBranch = (& git -C $sourceRepoRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'caller branch cannot be recorded; deployment is HELD' }
if ([string]::IsNullOrWhiteSpace($callerBranch)) { $callerBranch = '<detached>' }
$callerStatus = @(& git -C $sourceRepoRoot status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'caller worktree status cannot be recorded; deployment is HELD' }
git -C $sourceRepoRoot fetch origin --prune
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed; deployment is HELD' }
$originMainSha = (& git -C $sourceRepoRoot rev-parse --verify origin/main).Trim()
if ($LASTEXITCODE -ne 0 -or $originMainSha -notmatch '^[0-9a-f]{40,64}$') {
    throw 'fresh origin/main revision cannot be proven; deployment is HELD'
}
$sessionId = Get-Date -Format 'yyyyMMddHHmmss'
$isolatedWorktree = Join-Path (Split-Path $sourceRepoRoot -Parent) "AI-BIM-governance.deploy-canonical-$sessionId"
$isolatedBranch = "chore/canonical-linux-deploy-$sessionId"
git -C $sourceRepoRoot worktree add -b $isolatedBranch $isolatedWorktree $originMainSha
if ($LASTEXITCODE -ne 0) { throw 'isolated origin/main worktree creation failed; deployment is HELD' }
$isolatedWorktreeCreated = $true
Set-Location $isolatedWorktree
$isolatedHead = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'isolated deployment revision cannot be read; deployment is HELD' }
$isolatedStatus = @(& git status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'isolated deployment status cannot be read; deployment is HELD' }
if ($isolatedHead -cne $originMainSha -or $isolatedStatus.Count -ne 0) {
    throw 'isolated deployment worktree does not match clean origin/main; deployment is HELD'
}
```

Run the pre-deploy verification gate from this isolated worktree. Do not open owner-private inputs until the gate passes.

Build the deployment-critical local code set from the isolated, freshly fetched `origin/main` worktree: `scripts/dev/rebuild-test-deploy.ps1`, `scripts/deploy-target-registry.json`, and every tracked file under `scripts/lib/`. Reject reparse paths and untracked files that shadow an exact import. Open the worktree path components and every critical file using non-inheritable handles that deny share-write and share-delete, verify each live Git blob and mode equals the captured `origin/main` SHA, and keep the handles open through helper completion. Any mismatch, missing blob, conflicting pre-existing handle, or identity drift is `HELD`; never run the caller branch's modified deployment transport against private inputs.

Resolve each private input independently. Use a path explicitly supplied and approved by the user in the current session first; for inventory only, use process-level `AI_BIM_DEPLOY_TARGET_INVENTORY` second; otherwise use the matching owner-profile candidate below. Never scan other profiles or directories. If a selected input is absent or the owner mapping is uncertain, stop and ask for its exact path.

```powershell
# Replace these nulls only with exact paths explicitly supplied by the user
# in this session. Do not persist them or discover alternatives by scanning.
$approvedInventoryPath = $null
$approvedCanonicalEnvSource = $null
$approvedIdentityFile = $null

$ownerPrivateRootCandidate = Join-Path $env:USERPROFILE '.bim-deploy'
$inventoryPath = if ($approvedInventoryPath) {
    $approvedInventoryPath
} elseif ($env:AI_BIM_DEPLOY_TARGET_INVENTORY) {
    $env:AI_BIM_DEPLOY_TARGET_INVENTORY
} else {
    Join-Path $ownerPrivateRootCandidate 'target-inventory.json'
}
$canonicalEnvSource = if ($approvedCanonicalEnvSource) {
    $approvedCanonicalEnvSource
} else {
    Join-Path $ownerPrivateRootCandidate '.env.web-plane.host-kit.canonical-linux'
}
$identityFile = if ($approvedIdentityFile) {
    if (-not (Test-Path -LiteralPath $approvedIdentityFile -PathType Leaf)) {
        throw 'owner-approved identity file is unavailable; deployment is HELD'
    }
    $approvedIdentityFile
} else {
    $identityCandidate = Join-Path $ownerPrivateRootCandidate 'id_ed25519_bimdeploy'
    if (Test-Path -LiteralPath $identityCandidate -PathType Leaf) { $identityCandidate } else { '' }
}
$canonicalEnvDestination = Join-Path $isolatedWorktree '.env.web-plane.host-kit.canonical-linux'
```

Fail closed unless all of the following hold:

- Every selected private file remains beneath an owner-approved protected root. For a custom path, obtain approval for that root as well. The root, selected file, and every existing path component are real and non-reparse. Require the owner-profile fallback root to exist only when at least one selected input uses that fallback.
- The selected inventory and canonical env exist. A private key file is optional only when the default SSH key/agent passes a batch-mode connection preflight.
- Resolve the fixed owner SID from the owner-approved profile account, independently of the process token. Require the process token SID to equal that owner SID before any ACL repair or staging write; a managed-sandbox/transient SID mismatch is `HELD`, never a reason to grant that SID access. Each selected file and its protected root must be owned by the approved owner SID and have protected ACLs containing only that SID, `SYSTEM`, and `Administrators`; do not repair ACLs without explicit approval.
- Before validation, open the selected private root as a non-inheritable directory handle using `CreateFileW(FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)`, deliberately omitting `FILE_SHARE_DELETE`. Keep it open through the final helper/SSH pathname read. Query owner/DACL, reparse tag, volume serial, file ID, and final path from the handle before and after; any failure or mismatch is `HELD`.
- Open inventory, canonical env, and any selected identity file with handles that allow `FILE_SHARE_READ` only, never share write or delete, and keep them open through their last consumer. Validate ACL, file ID, and SHA-256 from those handles. Failure to acquire a compatible handle proves a conflicting pre-existing handle and is `HELD`.
- After loading `scripts/lib/deploy-target-registry.ps1`, `Get-DeployTarget -Canonical -InventoryPath $inventoryPath` resolves exactly `canonical-linux`, `linux_host_native`, `canonical_test_deploy`, and `ssh`, with all required private fields present.
- The canonical env parses without duplicate keys. Compare key names with `.env.web-plane.host-kit.canonical-linux.example`; report names only for missing/extra diagnostics and never report values.
- `git fetch origin --prune` succeeds. Any requested change is already reachable from fresh `origin/main`.
- Every deployment-critical local script/registry handle still matches its freshly fetched `origin/main` blob and mode immediately before launch and after helper exit.
- `pwsh`, `git`, and `ssh` are available. SSH uses key-based `BatchMode=yes`; never fall back to passwords.
- Before every actual rebuild, construct a canonical summary from target id, kind, role, connection type, and the resolved host, user, `deploy_root`, and `runtime_data_root`. Show the non-sensitive fields plus separate SHA-256 fingerprints of the sensitive fields, never their raw values, and obtain explicit owner confirmation that this is the canonical Linux test target. An unchanged inventory, prior-session confirmation, or target name alone is not sufficient evidence.
- A read-only SSH preflight proves the resolved remote `deploy_root` and `runtime_data_root` are normalized non-root paths with no symlinked existing components, the remote inventory is a regular mode-`0600` file, and any existing deployment checkout has the expected Git origin. Treat any mismatch or unprovable target identity as `HELD`.

Do not print inventory fields, host/user values, env values, token values, key contents, or the private absolute path in reports.

## Stage the canonical env safely

The transport reads the canonical env from the repo-root filename declared by the target registry. Treat this as a temporary secret-bearing staging copy.

- Reject a destination that is a reparse point.
- If the destination is absent, obtain explicit approval to create and later remove the temporary copy. Create it atomically with `CREATE_NEW` and a protected ACL allowing only the fixed approved owner SID, `SYSTEM`, and `Administrators`; never expose inherited permissions between creation and ACL protection and never substitute the runtime process SID.
- If it exists, require the same protected ACL and compare SHA-256 with the owner-private source. Reuse it only when identical.
- If it differs, stop as `HELD`; never overwrite an existing real env file or merge values automatically.
- Confirm the destination remains ignored by Git. Never add it to a commit.
- After the atomic writer closes, immediately reopen the same verified file with a consumer-compatible handle that requests read only and shares read only, never write or delete. Require the same final path, reparse tag, protected ACL, volume serial, file ID, and SHA-256 before allowing the helper to read it, then keep that handle through helper completion.
- In `finally`, revalidate the consumer handle, close it, and immediately acquire an exclusive cleanup handle with read plus delete access. Require the same path, identity, ACL, reparse tag, and hash again before applying `FileDispositionInfo` or equivalent handle-based deletion; this handoff detects replacement before deletion while avoiding share-mode conflicts with the helper. Verify the pathname is absent. Never remove a pre-existing destination or use pathname-only cleanup.

Before reset/clean, use the validated batch-mode SSH connection to capture `git status --short` from the resolved remote `deploy_root`. Record the change count and relative paths in the final report. If the checkout is absent, record that fact. Do not expose the remote absolute path.

## Rebuild the canonical target

Run the canonical wrapper with only its approved parameters:

```powershell
Set-Location $isolatedWorktree
$rebuildParameters = @{
    Build = $true
    InventoryPath = $inventoryPath
}
if ($identityFile) { $rebuildParameters.IdentityFile = $identityFile }
& .\scripts\dev\rebuild-test-deploy.ps1 @rebuildParameters
$deployExit = $LASTEXITCODE
if ($deployExit -ne 0) {
    throw "canonical Linux test deployment failed with exit $deployExit"
}
```

Do not add `-TargetId local-windows`, `-Force`, `-DryRun`, or bootstrap parameters. Do not stop listeners or processes when ownership cannot be proven. A conflict, SSH failure, inventory failure, fetch failure, or missing deploy script is `HELD`, not permission to improvise.

## Verify independently

An exit code of zero is necessary but is not full-system E2E proof.

Through the same validated SSH connection, set `AI_BIM_DEPLOY_TARGET_INVENTORY` only in the verifier child process to the resolved remote `runtime_data_root/target.local.json`, then run `pwsh -NoProfile -NonInteractive -File scripts/verify-all.ps1 -Profile Deployment` inside the resolved remote `deploy_root`. Clear the temporary process environment immediately after the child exits. The deployment profile keeps coordinator, conversion, and viewer checks on loopback while resolving governance and Kit Manager through the target's private `host_native_bind_host`.

Then use the resolved target without printing its private host to verify and record only role/port/result:

- coordinator `:8004/health` returns HTTP 200
- coordinator UI `:8004/ui` and viewer `:5173` return HTTP 200
- conversion `:49101/health` returns HTTP 200 through the public route
- Kit signalling `:49100` is reachable
- remote deployment-profile governance `:49102` and Kit Manager `:8010` checks pass
- the helper produced a redacted effective-env snapshot under `artifacts/deploy-reports/canonical-linux/`
- the successful deployment created and pushed its required `deploy-*` tag

Do not claim full-system E2E unless separate current-session evidence proves governance semantic E2E, Kit/WebRTC first frame, USD stage, DataChannel acknowledgement, and applicable design fidelity gates.

## Close the isolated worktree

Wrap the whole workflow in the structure below. After the helper, independent verification, protected evidence writes, private handles, SSH consumers, and temporary env cleanup are all complete, remove the generated worktree and branch in the outer `finally`. Run this closeout after both success and `HELD`; capture cleanup failure separately so it cannot mask the primary failure. Write the redacted report before rethrowing either failure. Never use `-Force` to hide a dirty worktree or delete a branch whose identity changed.

```powershell
$primaryFailure = $null
$cleanupFailure = $null
$cleanupStatus = 'HELD: cleanup not completed'
try {
    # Run every preflight, private-input handle, staging, rebuild, and verification step above here.
}
catch {
    $primaryFailure = $_
}
finally {
    try {
        if (-not $isolatedWorktreeCreated) {
            $cleanupStatus = 'isolated worktree was not created'
        }
        else {
            Set-Location $callerCwd
            $cleanupHead = (& git -C $isolatedWorktree rev-parse HEAD).Trim()
            if ($LASTEXITCODE -ne 0) { throw 'isolated worktree revision cannot be proven during cleanup; retain it for owner inspection' }
            $cleanupWorktreeStatus = @(& git -C $isolatedWorktree status --porcelain)
            if ($LASTEXITCODE -ne 0) { throw 'isolated worktree status cannot be proven during cleanup; retain it for owner inspection' }
            if ($cleanupHead -cne $originMainSha -or $cleanupWorktreeStatus.Count -ne 0) {
                throw 'isolated worktree changed during deployment; retain it for owner inspection'
            }
            $cleanupBranchSha = (& git -C $sourceRepoRoot rev-parse --verify "refs/heads/$isolatedBranch").Trim()
            if ($LASTEXITCODE -ne 0 -or $cleanupBranchSha -cne $originMainSha) {
                throw 'isolated branch identity changed; retain it for owner inspection'
            }
            git -C $sourceRepoRoot worktree remove -- $isolatedWorktree
            if ($LASTEXITCODE -ne 0) { throw 'isolated worktree removal failed; retain the branch for owner inspection' }
            git -C $sourceRepoRoot worktree prune
            if ($LASTEXITCODE -ne 0) { throw 'worktree metadata pruning failed; deployment closeout is HELD' }
            git -C $sourceRepoRoot update-ref -d "refs/heads/$isolatedBranch" $originMainSha
            if ($LASTEXITCODE -ne 0) { throw 'atomic generated deployment branch cleanup failed; deployment closeout is HELD' }
            $cleanupStatus = 'isolated worktree and generated branch removed'
        }
    }
    catch {
        $cleanupFailure = $_
        $cleanupStatus = 'HELD: cleanup failed; generated resources retained for owner inspection'
    }
}

# Write the redacted final report here, including $cleanupStatus and both failure categories.
if ($null -ne $primaryFailure) { throw $primaryFailure }
if ($null -ne $cleanupFailure) { throw $cleanupFailure }
```

## Report and stop

Separate `Verified facts`, `Inferences`, `Unverified risks`, and `Next actions`. Include:

- caller cwd/branch/status, isolated branch, fresh `origin/main` SHA, cleanup status, target id/kind, and this redacted command template matching the actual invocation: `pwsh -NoProfile -NonInteractive -File scripts/dev/rebuild-test-deploy.ps1 -Build -InventoryPath '<owner-private-inventory>' [-IdentityFile '<owner-private-identity>']`; keep the expanded command only in protected local evidence
- private-input/schema/ACL results without private values or absolute paths
- canonical env staging result: `created and removed`, `reused`, or `HELD`
- remote checkout pre-reset change count and relative-path summary
- deploy exit code, health results, deploy tag, repository-relative snapshot/log paths, and whether ACL restoration was performed and verified
- changed files, skipped gates, known risks, and `Full-system E2E claimed: yes/no`

Do not automatically push code, open a PR, merge, alter ACLs, rotate keys, stop unrelated processes, or change production state.
