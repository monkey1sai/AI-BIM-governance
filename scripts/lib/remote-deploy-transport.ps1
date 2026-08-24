# scripts/lib/remote-deploy-transport.ps1
# Remote rebuild transport for ssh-connected deploy targets (plan B5/B6).
#
# Contract preserved verbatim from §6: the rebuild freshly fetches origin with
# +refs/heads/main:refs/remotes/origin/main and stops on fetch failure; a rebuild
# order means the deployment checkout may be reset/cleaned.
#
# Env layering (decisions D-14/D-15):
#   base layer     operator-side canonical file (registry env_file), pushed on
#                  every rebuild, remote must not hand-edit it
#   override layer <runtime_data_root>/env.local, remote-maintained, never
#                  touched by the operator, wins per key
#   effective      merged base+override written to <deploy_root>/<effective name>
# The effective env is snapshotted at deploy time: every value is reduced to a
# sha256-8 fingerprint plus length. Key classification is informational only.

Set-StrictMode -Version Latest

$script:RemoteDeployRepoUrl = 'https://github.com/monkey1sai/AI-BIM-governance.git'
$script:RemoteEnvSecretKeyPattern = '(?i)(token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential)'
$script:RemoteEnvTopologyKeyPattern = '(?i)(host|server|url|uri|endpoint|root|path|site|cidr|address|network)'

function ConvertFrom-DeployEnvContent {
    # dotenv-subset parser: KEY=VALUE lines, '#' comments, blanks ignored.
    # Returns an ordered dictionary preserving first-seen key order.
    param([AllowEmptyString()][string] $Content)

    $map = [ordered]@{}
    foreach ($rawLine in ($Content -split "`r?`n")) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { continue }
        $key = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim()
        if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
        $map[$key] = $value
    }
    return $map
}

function Merge-DeployTargetEnvLayers {
    # Deterministic per-key merge: override wins only for keys declared by the
    # reviewed base layer. A remote-only key would otherwise bypass the tracked
    # env contract, so unknown override keys fail closed.
    param(
        [AllowEmptyString()][string] $BaseContent,
        [AllowEmptyString()][string] $OverrideContent
    )
    $base = ConvertFrom-DeployEnvContent -Content $BaseContent
    $override = ConvertFrom-DeployEnvContent -Content $OverrideContent
    $unknownOverrideKeys = @($override.Keys | Where-Object { -not $base.Contains($_) })
    if ($unknownOverrideKeys.Count -gt 0) {
        throw "remote_deploy_transport: override contains keys not declared by the base env: $($unknownOverrideKeys -join ', ')."
    }
    $merged = [ordered]@{}
    foreach ($key in $base.Keys) {
        $merged[$key] = if ($override.Contains($key)) { $override[$key] } else { $base[$key] }
    }
    $overriddenKeys = @($override.Keys | Where-Object { $base.Contains($_) })
    return [pscustomobject]@{
        Values         = $merged
        OverriddenKeys = $overriddenKeys
        OverrideOnlyKeys = @()
    }
}

function ConvertTo-DeployEnvContent {
    param([Parameter(Mandatory = $true)] $Values)
    $lines = foreach ($key in $Values.Keys) { "$key=$($Values[$key])" }
    return ($lines -join "`n") + "`n"
}

function New-DeployTargetEnvSnapshot {
    # Point-in-time attestation of the effective env (decision D-15): the record
    # proves what was in force when evidence was taken. Every value keeps only a
    # fingerprint and length; no env value enters stdout or local reports.
    param(
        [Parameter(Mandatory = $true)] $Values,
        [Parameter(Mandatory = $true)][string] $TargetId,
        [AllowEmptyCollection()][string[]] $OverriddenKeys = @()
    )
    $entries = foreach ($key in $Values.Keys) {
        $value = [string]$Values[$key]
        $isSecret = ($key -match $script:RemoteEnvSecretKeyPattern)
        $isTopology = ($key -match $script:RemoteEnvTopologyKeyPattern)
        $fingerprint = ''
        if ($value.Length -gt 0) {
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try {
                $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))
                $fingerprint = ([BitConverter]::ToString($hash) -replace '-', '').Substring(0, 8).ToLowerInvariant()
            } finally { $sha.Dispose() }
        }
        [pscustomobject]@{
            key = $key
            secret = $isSecret
            topology = $isTopology
            fingerprint = $fingerprint
            length = $value.Length
        }
    }
    return [pscustomobject]@{
        schema_version = 'deploy-target-env-snapshot/v1'
        target_id      = $TargetId
        entries        = @($entries)
        overridden_keys = @($OverriddenKeys)
    }
}

function Assert-BootstrapRefAllowed {
    # A bootstrap ref makes the target check out an UNMERGED revision, which the
    # deploy contract normally forbids ("不得驗證未 merge branch"). It is legal only
    # while producing stack_kind=self_referential_bootstrap evidence, so the caller
    # must name the open ledger entry authorising it, and that entry must exist,
    # be open, and declare the deploy path among its mechanism paths.
    # Evidence produced this way is NEVER deploy-target evidence.
    param(
        [Parameter(Mandatory = $true)][string] $BootstrapRef,
        [Parameter(Mandatory = $true)][string] $LedgerEntryId,
        [Parameter(Mandatory = $true)][string] $OperatorRepoRoot
    )
    if ($BootstrapRef -notmatch '^[A-Za-z0-9._\-/]{1,200}$') {
        throw "remote_deploy_transport: bootstrap ref '$BootstrapRef' contains unsafe characters."
    }
    $ledgerPath = Join-Path $OperatorRepoRoot 'scripts/self-referential-bootstrap-ledger.json'
    if (-not (Test-Path -LiteralPath $ledgerPath)) {
        throw 'remote_deploy_transport: a bootstrap run requires the bootstrap ledger.'
    }
    $ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
    $entry = @($ledger.entries | Where-Object { [string]$_.id -eq $LedgerEntryId })
    if ($entry.Count -ne 1) {
        throw "remote_deploy_transport: ledger entry '$LedgerEntryId' not found; a bootstrap deploy must be authorised by an open ledger entry."
    }
    if ([string]$entry[0].status -ne 'open') {
        throw "remote_deploy_transport: ledger entry '$LedgerEntryId' is not open; its debt is already closed."
    }
    if ('scripts/deploy.ps1' -notin @($entry[0].verification_mechanism_paths | ForEach-Object { [string]$_ })) {
        throw "remote_deploy_transport: ledger entry '$LedgerEntryId' does not declare scripts/deploy.ps1, so it cannot authorise a deploy-path bootstrap run."
    }
    return $entry[0]
}

function New-RemoteRebuildScript {
    # Emits the bash script that runs ON the remote target. LF line endings are
    # mandatory (bash chokes on CRLF). The env merge deliberately calls
    # Merge-DeployTargetEnvLayers from THIS lib inside the freshly-reset remote
    # checkout via pwsh - one merge implementation, no bash mirror to drift.
    param(
        [Parameter(Mandatory = $true)] $Target,
        [switch] $Build,
        [string] $BootstrapRef = ''
    )
    if ([string]$Target.connection.type -ne 'ssh') {
        throw "remote_deploy_transport: target '$($Target.id)' is not an ssh target."
    }

    $execBits = ''
    if ('restore-exec-bits' -in @($Target.post_clone_steps)) {
        # F-2: a Windows-authored checkout carries 100644 for *.sh, and repo.sh
        # execs tools/packman/python.sh, so bash-invocation alone is not enough.
        $execBits = @'
echo "== restore exec bits (F-2) =="
find "$DEPLOY_ROOT" -type f -name '*.sh' -exec chmod +x {} +
for f in "$DEPLOY_ROOT"/bim-streaming-server/tools/packman/packman \
         "$DEPLOY_ROOT"/bim-streaming-server/tools/packman/bootstrap/*; do
  [ -f "$f" ] && chmod +x "$f" || true
done
'@
    }

    # Default: reset to the freshly fetched origin/main, exactly as the contract
    # requires. A bootstrap ref additionally fetches that unmerged revision and
    # resets to it - only reachable through the guarded bootstrap entrypoint, and
    # the resulting evidence is self_referential_bootstrap, never deploy-target.
    $bootstrapFetch = ''
    $resetTarget = 'refs/remotes/origin/main'
    if (-not [string]::IsNullOrWhiteSpace($BootstrapRef)) {
        if ($BootstrapRef -notmatch '^[A-Za-z0-9._\-/]{1,200}$') {
            throw "remote_deploy_transport: bootstrap ref '$BootstrapRef' contains unsafe characters."
        }
        $bootstrapFetch = "echo '== BOOTSTRAP: fetching unmerged ref $BootstrapRef (stack_kind=self_referential_bootstrap) =='`ngit fetch origin '+refs/heads/$BootstrapRef`:refs/remotes/origin/$BootstrapRef'"
        $resetTarget = "refs/remotes/origin/$BootstrapRef"
    }

    $buildStep = ''
    if ($Build) {
        $buildStep = @'
echo "== deploy.ps1 -Build =="
cd "$DEPLOY_ROOT"
pwsh -NoProfile -NonInteractive -File scripts/deploy.ps1 -Build
echo "DEPLOY_EXIT=$?"
'@
    }

    $template = @'
#!/bin/bash
set -euo pipefail
umask 077
DEPLOY_ROOT='{{DEPLOY_ROOT}}'
DATA_ROOT='{{DATA_ROOT}}'
REPO_URL='{{REPO_URL}}'
TARGET_ID='{{TARGET_ID}}'
TARGET_INVENTORY="$DATA_ROOT/target.local.json"
TOOLING_PRESERVE_DIR=''
MERGE_TMP=''
SNAPSHOT_TMP=''
cleanup() {
  [ -z "${TOOLING_PRESERVE_DIR:-}" ] || rm -rf -- "$TOOLING_PRESERVE_DIR"
  [ -z "${MERGE_TMP:-}" ] || rm -f -- "$MERGE_TMP"
  [ -z "${SNAPSHOT_TMP:-}" ] || rm -f -- "$SNAPSHOT_TMP"
}
trap cleanup EXIT

# The owner provisions this file out-of-band. Transport deliberately never
# uploads or overwrites private topology.
if [ ! -f "$TARGET_INVENTORY" ]; then
  echo "missing owner-controlled target inventory" >&2
  exit 3
fi
chmod 600 "$TARGET_INVENTORY"
export AI_BIM_DEPLOY_TARGET_INVENTORY="$TARGET_INVENTORY"

echo "== ensure checkout =="
if [ ! -d "$DEPLOY_ROOT/.git" ]; then
  git clone "$REPO_URL" "$DEPLOY_ROOT"
fi
cd "$DEPLOY_ROOT"

OLD_REV="$(git rev-parse HEAD 2>/dev/null || true)"

echo "== freshly fetch origin/main (contract: stop on failure, never stale) =="
git fetch origin '+refs/heads/main:refs/remotes/origin/main'
{{BOOTSTRAP_FETCH}}
NEW_REV="$(git rev-parse {{RESET_TARGET}})"
KIT_INPUTS_CHANGED=0
if [ -z "$OLD_REV" ] || ! git diff --quiet "$OLD_REV" "$NEW_REV" -- \
  bim-streaming-server/source \
  bim-streaming-server/repo.toml \
  bim-streaming-server/repo.sh \
  bim-streaming-server/repo.bat \
  bim-streaming-server/premake5.lua \
  bim-streaming-server/tools; then
  KIT_INPUTS_CHANGED=1
fi

echo "== local changes before reset =="
git status --porcelain || true

git reset --hard {{RESET_TARGET}}
git clean -fd -e '.env*'

echo "== remove tracked agent tooling from deployment checkout =="
TOOLING_PRESERVE_DIR="$DATA_ROOT/.deploy-preserve.$$"
mkdir -p -m 700 "$TOOLING_PRESERVE_DIR"
if [ -f "$DEPLOY_ROOT/docs/plans/ai-bim-governance.css" ]; then
  cp -- "$DEPLOY_ROOT/docs/plans/ai-bim-governance.css" "$TOOLING_PRESERVE_DIR/ai-bim-governance.css"
fi
find "$DEPLOY_ROOT" -type f \( -name 'AGENTS.md' -o -name 'CLAUDE.md' \) -delete
rm -rf -- \
  "$DEPLOY_ROOT/.codex" \
  "$DEPLOY_ROOT/.agents" \
  "$DEPLOY_ROOT/.agent" \
  "$DEPLOY_ROOT/.claude" \
  "$DEPLOY_ROOT/.cursor" \
  "$DEPLOY_ROOT/.windsurf" \
  "$DEPLOY_ROOT/.github/skills" \
  "$DEPLOY_ROOT/.github/prompts" \
  "$DEPLOY_ROOT/docs" \
  "$DEPLOY_ROOT/openspec" \
  "$DEPLOY_ROOT/patches"
if [ -f "$TOOLING_PRESERVE_DIR/ai-bim-governance.css" ]; then
  mkdir -p "$DEPLOY_ROOT/docs/plans"
  cp -- "$TOOLING_PRESERVE_DIR/ai-bim-governance.css" "$DEPLOY_ROOT/docs/plans/ai-bim-governance.css"
fi
rm -rf -- "$TOOLING_PRESERVE_DIR"
TOOLING_PRESERVE_DIR=''

if [ "$KIT_INPUTS_CHANGED" -eq 1 ]; then
  echo "== invalidate stale Kit build outputs =="
  rm -rf "$DEPLOY_ROOT/bim-streaming-server/_build"
fi

{{EXEC_BITS}}

echo "== place effective env =="
BASE_ENV="$DATA_ROOT/{{ENV_NAME}}.base"
LOCAL_ENV="$DATA_ROOT/env.local"
EFFECTIVE_ENV="$DEPLOY_ROOT/{{ENV_NAME}}"
if [ ! -f "$BASE_ENV" ]; then
  echo "missing pushed base env: $BASE_ENV" >&2
  exit 3
fi
mkdir -p "$DATA_ROOT"
[ -f "$LOCAL_ENV" ] || : > "$LOCAL_ENV"
chmod 600 "$BASE_ENV" "$LOCAL_ENV"
MERGE_TMP="$(mktemp --suffix .ps1)"
SNAPSHOT_TMP="$(mktemp --suffix .json)"
cat > "$MERGE_TMP" <<'PSEOF'
param($BasePath, $LocalPath, $OutPath, $SnapshotPath, $LibPath, $TargetId)
. $LibPath
$base = if (Test-Path -LiteralPath $BasePath) { [string](Get-Content -LiteralPath $BasePath -Raw) } else { '' }
$local = if (Test-Path -LiteralPath $LocalPath) { [string](Get-Content -LiteralPath $LocalPath -Raw) } else { '' }
$merge = Merge-DeployTargetEnvLayers -BaseContent $base -OverrideContent $local
Set-Content -LiteralPath $OutPath -Value (ConvertTo-DeployEnvContent -Values $merge.Values) -NoNewline -Encoding utf8
$snapshot = New-DeployTargetEnvSnapshot -Values $merge.Values -TargetId $TargetId -OverriddenKeys $merge.OverriddenKeys
[System.IO.File]::WriteAllText($SnapshotPath, ($snapshot | ConvertTo-Json -Depth 6 -Compress), [System.Text.UTF8Encoding]::new($false))
PSEOF
pwsh -NoProfile -NonInteractive -File "$MERGE_TMP" \
  -BasePath "$BASE_ENV" -LocalPath "$LOCAL_ENV" -OutPath "$EFFECTIVE_ENV" \
  -SnapshotPath "$SNAPSHOT_TMP" -LibPath "$DATA_ROOT/transport-lib.ps1" -TargetId "$TARGET_ID"
chmod 600 "$EFFECTIVE_ENV" "$SNAPSHOT_TMP"

echo "== effective env snapshot begin =="
cat "$SNAPSHOT_TMP"
echo # F-17: the snapshot JSON has no trailing newline; keep the end marker on its own line
echo "== effective env snapshot end =="

{{BUILD_STEP}}
'@

    $script = $template.
        Replace('{{DEPLOY_ROOT}}', [string]$Target.deploy_root).
        Replace('{{DATA_ROOT}}', [string]$Target.runtime_data_root).
        Replace('{{REPO_URL}}', $script:RemoteDeployRepoUrl).
        Replace('{{TARGET_ID}}', [string]$Target.id).
        Replace('{{ENV_NAME}}', '.env.web-plane.host-kit').
        Replace('{{EXEC_BITS}}', $execBits).
        Replace('{{BOOTSTRAP_FETCH}}', $bootstrapFetch).
        Replace('{{RESET_TARGET}}', $resetTarget).
        Replace('{{BUILD_STEP}}', $buildStep)
    return ($script -replace "`r`n", "`n")
}

function Get-RemoteDeploySshArguments {
    # Key-based batch-mode ssh as the target's service user. -DryRun callers use
    # this to assert the exact command line without a live connection.
    param(
        [Parameter(Mandatory = $true)] $Target,
        [string] $IdentityFile = ''
    )
    if ([string]$Target.connection.type -ne 'ssh') {
        throw "remote_deploy_transport: target '$($Target.id)' is not an ssh target."
    }
    $arguments = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
    if (-not [string]::IsNullOrWhiteSpace($IdentityFile)) {
        $arguments += @('-i', $IdentityFile)
    }
    $arguments += "$([string]$Target.connection.user)@$([string]$Target.connection.host)"
    return $arguments
}


function Get-DeployTagName {
    # B13 (owner directive 2026-08-05): every successful deployment to the
    # canonical target is tagged. Name format = date + timer ticker + number:
    #   deploy-<yyyyMMdd>-<UtcTicks>-<NNN>
    # UtcTicks is the 100ns tick count of the dispatch timestamp (the "timer
    # ticker"); NNN is the 1-based sequence of deployments that UTC day.
    # Pure and deterministic so the format is testable without a clock.
    param(
        [Parameter(Mandatory = $true)][DateTimeOffset] $TimestampUtc,
        [Parameter(Mandatory = $true)][int] $Sequence
    )
    if ($Sequence -lt 1 -or $Sequence -gt 999) {
        throw "remote_deploy_transport: deploy tag sequence must be 1..999 (got $Sequence)."
    }
    return ('deploy-{0:yyyyMMdd}-{1}-{2:000}' -f $TimestampUtc.UtcDateTime, $TimestampUtc.UtcTicks, $Sequence)
}

function New-RemoteDeployTag {
    # Creates and pushes the B13 annotated tag for a deployment that EXITed 0,
    # then syncs origin/main to the same commit. Binds to the commit the TARGET
    # actually checked out (parsed from the remote transcript), not to whatever
    # the operator happens to have locally. The tag name and message carry no
    # host/account/network detail (policy A).
    param(
        [Parameter(Mandatory = $true)][string] $OperatorRepoRoot,
        [Parameter(Mandatory = $true)][string] $TargetId,
        [Parameter(Mandatory = $true)][string] $DeployedSha,
        [Parameter(Mandatory = $true)][string] $SnapshotName,
        [DateTimeOffset] $TimestampUtc = [DateTimeOffset]::UtcNow,
        [scriptblock] $GitRunner = {
            param([string[]] $GitArgs)
            $out = & git -C $OperatorRepoRoot @GitArgs 2>&1
            [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($out | Out-String) }
        }
    )
    if ($DeployedSha -notmatch '^[0-9a-f]{7,40}$') {
        throw "remote_deploy_transport: deploy tag requires the deployed commit sha (got '$DeployedSha')."
    }
    $dateToken = '{0:yyyyMMdd}' -f $TimestampUtc.UtcDateTime
    # Sequence counts existing tags for the day; fetch first so parallel operators
    # converge. A fetch failure downgrades to local-only counting (offline dispatch
    # is still a deployment worth recording).
    $null = & $GitRunner @('fetch', '--tags', '--quiet', 'origin')
    $tagName = ''
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $existing = & $GitRunner @('tag', '--list', "deploy-$dateToken-*")
        $count = @(($existing.Output -split "`r?`n") | Where-Object { $_ }).Count
        $candidate = Get-DeployTagName -TimestampUtc $TimestampUtc -Sequence ($count + 1 + $attempt)
        $message = "deploy target=$TargetId exit=0 snapshot=$SnapshotName deployed=$DeployedSha"
        $created = & $GitRunner @('tag', '-a', $candidate, '-m', $message, $DeployedSha)
        if ($created.ExitCode -eq 0) { $tagName = $candidate; break }
    }
    if ([string]::IsNullOrWhiteSpace($tagName)) {
        throw 'remote_deploy_transport: could not create a unique deploy tag after 3 attempts.'
    }
    $pushed = & $GitRunner @('push', 'origin', "refs/tags/$tagName")
    if ($pushed.ExitCode -ne 0) {
        # B13: a push failure must never leave a local-only tag - a later
        # sequence count would treat a record origin never accepted as existing.
        $deleted = & $GitRunner @('tag', '-d', $tagName)
        $cleanup = if ($deleted.ExitCode -eq 0) { 'local tag deleted' } else { "local tag cleanup ALSO failed: $($deleted.Output)" }
        throw "remote_deploy_transport: deploy tag '$tagName' could not be pushed ($cleanup): $($pushed.Output)"
    }
    # Owner directive 2026-08-19: a tagged deploy must leave origin/main
    # pointing at (or past) the deployed commit too. Pushing the sha directly -
    # rather than a local 'main' branch ref - works regardless of what the
    # operator checkout has checked out, and is a no-op whenever origin/main
    # already contains the commit (the expected case, since the deploy source
    # is always a fresh fetch of origin/main). A rejection here means
    # origin/main diverged from what was actually deployed - worth surfacing,
    # not silently swallowing - but it never unwinds the tag above, which
    # stays correct evidence of what was deployed regardless.
    $mainSynced = & $GitRunner @('push', 'origin', "${DeployedSha}:refs/heads/main")
    if ($mainSynced.ExitCode -ne 0) {
        throw "remote_deploy_transport: deploy tag '$tagName' was pushed, but origin/main could not be synced to the deployed commit $DeployedSha ($($mainSynced.Output))."
    }
    return $tagName
}

function ConvertFrom-DeployEnvSnapshotTranscript {
    # Extracts the redacted env snapshot from a remote rebuild transcript. The
    # snapshot JSON is written without a trailing newline, so the remote template
    # must emit a bare echo after `cat` (F-17) for the end marker to start its
    # own line; this parser is the single implementation live dispatch uses.
    param([AllowEmptyString()][string] $OutputText)
    if ($OutputText -match '(?s)== effective env snapshot begin ==\r?\n(.*?)\r?\n== effective env snapshot end ==') {
        try { return $Matches[1] | ConvertFrom-Json } catch {
            throw "remote_deploy_transport: remote redacted env snapshot is invalid JSON: $($_.Exception.Message)"
        }
    }
    return $null
}

function Invoke-RemoteTestDeployRebuild {
    # Remote counterpart of Invoke-TestDeployRebuild. Pushes the base env layer,
    # streams the rebuild script over ssh stdin, captures the effective-env
    # section, and writes the masked snapshot locally next to the deploy reports.
    param(
        [Parameter(Mandatory = $true)] $Target,
        [Parameter(Mandatory = $true)][string] $OperatorRepoRoot,
        [switch] $Build,
        [string] $IdentityFile = '',
        [switch] $DryRun,
        [string] $BootstrapRef = '',
        [string] $BootstrapLedgerEntry = ''
    )

    if (-not [string]::IsNullOrWhiteSpace($BootstrapRef)) {
        if ([string]::IsNullOrWhiteSpace($BootstrapLedgerEntry)) {
            throw 'remote_deploy_transport: -BootstrapRef requires -BootstrapLedgerEntry naming the open ledger entry that authorises verifying an unmerged revision.'
        }
        $null = Assert-BootstrapRefAllowed -BootstrapRef $BootstrapRef -LedgerEntryId $BootstrapLedgerEntry -OperatorRepoRoot $OperatorRepoRoot
    } elseif (-not [string]::IsNullOrWhiteSpace($BootstrapLedgerEntry)) {
        throw 'remote_deploy_transport: -BootstrapLedgerEntry is meaningless without -BootstrapRef.'
    }

    $baseEnvPath = Join-Path $OperatorRepoRoot ([string]$Target.env_file)
    if (-not (Test-Path -LiteralPath $baseEnvPath -PathType Leaf)) {
        throw "remote_deploy_transport: operator canonical env file not found: $baseEnvPath (registry env_file for '$($Target.id)')."
    }
    $rebuildScript = New-RemoteRebuildScript -Target $Target -Build:$Build -BootstrapRef $BootstrapRef
    $sshArguments = Get-RemoteDeploySshArguments -Target $Target -IdentityFile $IdentityFile
    $effectiveEnvName = '.env.web-plane.host-kit'
    $inventoryCheckCommand = "test -f '$([string]$Target.runtime_data_root)/target.local.json' && chmod 600 '$([string]$Target.runtime_data_root)/target.local.json'"
    $pushCommand = "umask 077 && mkdir -p '$([string]$Target.runtime_data_root)' && cat > '$([string]$Target.runtime_data_root)/$effectiveEnvName.base' && chmod 600 '$([string]$Target.runtime_data_root)/$effectiveEnvName.base'"
    # The remote merge cannot rely on the lib existing in the remote checkout
    # (a pre-merge branch is exactly the self-referential bootstrap situation),
    # so the operator ships THIS file alongside the dispatch - still the single
    # implementation, delivered rather than assumed.
    $libPushCommand = "mkdir -p '$([string]$Target.runtime_data_root)' && cat > '$([string]$Target.runtime_data_root)/transport-lib.ps1'"

    if ($DryRun) {
        return [pscustomobject]@{
            SshArguments   = $sshArguments
            InventoryCheckCommand = $inventoryCheckCommand
            PushCommand    = $pushCommand
            LibPushCommand = $libPushCommand
            Script         = $rebuildScript
        }
    }

    # Fail before uploading the base env or helper library. The remote script
    # checks again immediately before use to close the check/use race.
    & ssh @sshArguments $inventoryCheckCommand | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'remote_deploy_transport: owner-controlled private inventory preflight failed.' }

    # PS has no '<' stdin redirection; the pipeline feeds native stdin instead.
    Get-Content -LiteralPath $PSCommandPath -Raw | & ssh @sshArguments $libPushCommand
    if ($LASTEXITCODE -ne 0) { throw "remote_deploy_transport: transport lib push failed with exit $LASTEXITCODE." }

    Get-Content -LiteralPath $baseEnvPath -Raw | & ssh @sshArguments $pushCommand
    if ($LASTEXITCODE -ne 0) { throw "remote_deploy_transport: base env push failed with exit $LASTEXITCODE." }

    # The PS pipeline appends an OS newline (CRLF on Windows) when feeding native
    # stdin, which lands a stray \r line in bash. Base64 transport is byte-precise.
    $scriptB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($rebuildScript))
    # #531/#540-3: the report's execution window must CONTAIN any container
    # recreate this rebuild performs (the durability proof compares container
    # creation time against it), so the clock starts before the remote dispatch
    # and stops only after it returns.
    $executionStartedAt = [DateTimeOffset]::UtcNow
    $output = & ssh @sshArguments "echo '$scriptB64' | base64 -d | bash" 2>&1
    $exitCode = $LASTEXITCODE
    $executionFinishedAt = [DateTimeOffset]::UtcNow

    $outputText = ($output | Out-String)
    $snapshot = ConvertFrom-DeployEnvSnapshotTranscript -OutputText $outputText
    if ($null -eq $snapshot -and $exitCode -eq 0) {
        throw 'remote_deploy_transport: remote rebuild reported success but emitted no effective env snapshot section.'
    }

    $reportDir = Join-Path $OperatorRepoRoot "artifacts/deploy-reports/$([string]$Target.id)"
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $snapshotPath = Join-Path $reportDir "$stamp-effective-env.json"
    if ($null -ne $snapshot) {
        # #531/#540-3: persist the dispatch execution window alongside the
        # redacted snapshot. Timestamps only - no env value, host, or topology.
        $snapshot | Add-Member -NotePropertyName 'execution_window' -NotePropertyValue ([pscustomobject]@{
            started_at  = $executionStartedAt.ToString('o')
            finished_at = $executionFinishedAt.ToString('o')
        }) -Force
        $snapshot | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $snapshotPath -Encoding utf8
    } else {
        $snapshotPath = ''
    }

    # B13: a successful, non-dry-run, non-bootstrap deployment of the canonical
    # target is tagged on the commit the TARGET actually checked out ("HEAD is
    # now at <sha>" in its transcript), resolved to the full sha operator-side.
    # A bootstrap rebuild verifies an unmerged revision and its evidence is
    # never deploy-target evidence, so it is never tagged. Once eligible, the
    # tag is mandatory: an unresolvable sha is a hard error, not a skipped
    # record, because B13 requires every successful canonical deployment tagged.
    $deployTag = ''
    $tagEligible = ($exitCode -eq 0 -and -not $DryRun -and
        [string]::IsNullOrWhiteSpace($BootstrapRef) -and
        $null -ne $Target.PSObject.Properties['role'] -and
        [string]$Target.role -ceq 'canonical_test_deploy')
    if ($tagEligible) {
        $shaMatch = [regex]::Match($outputText, 'HEAD is now at ([0-9a-f]{7,40})')
        if (-not $shaMatch.Success) {
            throw 'remote_deploy_transport: successful canonical deployment reported no checked-out sha, so its required B13 deploy tag cannot be created.'
        }
        $shortSha = $shaMatch.Groups[1].Value
        $fullSha = (& git -C $OperatorRepoRoot rev-parse ($shortSha + '^{commit}') 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $fullSha) {
            # The remote resets to a freshly fetched origin/main that a stale
            # operator checkout may not have yet - fetch once and retry.
            $null = & git -C $OperatorRepoRoot fetch --quiet origin 2>$null
            $fullSha = (& git -C $OperatorRepoRoot rev-parse ($shortSha + '^{commit}') 2>$null | Out-String).Trim()
        }
        if ($LASTEXITCODE -ne 0 -or -not $fullSha) {
            throw "remote_deploy_transport: deployed commit '$shortSha' is not resolvable operator-side even after fetching origin, so the required B13 deploy tag cannot be created."
        }
        $deployTag = New-RemoteDeployTag -OperatorRepoRoot $OperatorRepoRoot -TargetId ([string]$Target.id) `
            -DeployedSha $fullSha -SnapshotName ([IO.Path]::GetFileName([string]$snapshotPath))
        Write-Host "[deploy-tag] $deployTag -> $fullSha"
    } elseif ($exitCode -eq 0 -and -not $DryRun -and -not [string]::IsNullOrWhiteSpace($BootstrapRef)) {
        Write-Host '[deploy-tag] skipped: bootstrap rebuild evidence is never deploy-target evidence.'
    }

    return [pscustomobject]@{
        ExitCode        = $exitCode
        Output          = $outputText
        SnapshotPath    = $snapshotPath
        EffectiveKeys   = if ($null -ne $snapshot) { @($snapshot.entries | ForEach-Object { [string]$_.key }) } else { @() }
        DeployTag       = $deployTag
        ExecutionWindow = [pscustomobject]@{
            started_at  = $executionStartedAt.ToString('o')
            finished_at = $executionFinishedAt.ToString('o')
        }
    }
}
