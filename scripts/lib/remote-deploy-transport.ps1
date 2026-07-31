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
# The effective env is snapshotted at deploy time: non-secret values in the
# clear, secret-looking keys reduced to a sha256-8 fingerprint (never the value).

Set-StrictMode -Version Latest

$script:RemoteDeployRepoUrl = 'https://github.com/monkey1sai/AI-BIM-governance.git'
$script:RemoteEnvSecretKeyPattern = '(?i)(token|secret|password|passwd|api[_-]?key|private[_-]?key|credential)'

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
    # Deterministic per-key merge: override wins, base-only keys survive,
    # override-only keys are appended after base keys.
    param(
        [AllowEmptyString()][string] $BaseContent,
        [AllowEmptyString()][string] $OverrideContent
    )
    $base = ConvertFrom-DeployEnvContent -Content $BaseContent
    $override = ConvertFrom-DeployEnvContent -Content $OverrideContent
    $merged = [ordered]@{}
    foreach ($key in $base.Keys) {
        $merged[$key] = if ($override.Contains($key)) { $override[$key] } else { $base[$key] }
    }
    foreach ($key in $override.Keys) {
        if (-not $merged.Contains($key)) { $merged[$key] = $override[$key] }
    }
    $overriddenKeys = @($override.Keys | Where-Object { $base.Contains($_) })
    return [pscustomobject]@{
        Values         = $merged
        OverriddenKeys = $overriddenKeys
        OverrideOnlyKeys = @($override.Keys | Where-Object { -not $base.Contains($_) })
    }
}

function ConvertTo-DeployEnvContent {
    param([Parameter(Mandatory = $true)] $Values)
    $lines = foreach ($key in $Values.Keys) { "$key=$($Values[$key])" }
    return ($lines -join "`n") + "`n"
}

function New-DeployTargetEnvSnapshot {
    # Point-in-time attestation of the effective env (decision D-15): the record
    # proves what was in force when evidence was taken. Secret-looking keys keep
    # only a fingerprint; the value never enters the snapshot (the repo is public).
    param(
        [Parameter(Mandatory = $true)] $Values,
        [Parameter(Mandatory = $true)][string] $TargetId,
        [AllowEmptyCollection()][string[]] $OverriddenKeys = @()
    )
    $entries = foreach ($key in $Values.Keys) {
        $value = [string]$Values[$key]
        if ($key -match $script:RemoteEnvSecretKeyPattern) {
            $fingerprint = ''
            if ($value.Length -gt 0) {
                $sha = [System.Security.Cryptography.SHA256]::Create()
                try {
                    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))
                    $fingerprint = ([BitConverter]::ToString($hash) -replace '-', '').Substring(0, 8).ToLowerInvariant()
                } finally { $sha.Dispose() }
            }
            [pscustomobject]@{ key = $key; secret = $true; fingerprint = $fingerprint; length = $value.Length }
        } else {
            [pscustomobject]@{ key = $key; secret = $false; value = $value }
        }
    }
    return [pscustomobject]@{
        schema_version = 'deploy-target-env-snapshot/v1'
        target_id      = $TargetId
        entries        = @($entries)
        overridden_keys = @($OverriddenKeys)
    }
}

function New-RemoteRebuildScript {
    # Emits the bash script that runs ON the remote target. LF line endings are
    # mandatory (bash chokes on CRLF). The env merge deliberately calls
    # Merge-DeployTargetEnvLayers from THIS lib inside the freshly-reset remote
    # checkout via pwsh - one merge implementation, no bash mirror to drift.
    param(
        [Parameter(Mandatory = $true)] $Target,
        [switch] $Build
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
DEPLOY_ROOT='{{DEPLOY_ROOT}}'
DATA_ROOT='{{DATA_ROOT}}'
REPO_URL='{{REPO_URL}}'

echo "== ensure checkout =="
if [ ! -d "$DEPLOY_ROOT/.git" ]; then
  git clone "$REPO_URL" "$DEPLOY_ROOT"
fi
cd "$DEPLOY_ROOT"

echo "== freshly fetch origin/main (contract: stop on failure, never stale) =="
git fetch origin '+refs/heads/main:refs/remotes/origin/main'

echo "== local changes before reset =="
git status --porcelain || true

git reset --hard refs/remotes/origin/main
git clean -fd -e '.env*'

{{EXEC_BITS}}

echo "== place effective env =="
BASE_ENV="$DEPLOY_ROOT/{{ENV_NAME}}.base"
LOCAL_ENV="$DATA_ROOT/env.local"
EFFECTIVE_ENV="$DEPLOY_ROOT/{{ENV_NAME}}"
if [ ! -f "$BASE_ENV" ]; then
  echo "missing pushed base env: $BASE_ENV" >&2
  exit 3
fi
mkdir -p "$DATA_ROOT"
[ -f "$LOCAL_ENV" ] || : > "$LOCAL_ENV"
MERGE_TMP="$(mktemp --suffix .ps1)"
cat > "$MERGE_TMP" <<'PSEOF'
param($BasePath, $LocalPath, $OutPath, $LibPath)
. $LibPath
$base = if (Test-Path -LiteralPath $BasePath) { [string](Get-Content -LiteralPath $BasePath -Raw) } else { '' }
$local = if (Test-Path -LiteralPath $LocalPath) { [string](Get-Content -LiteralPath $LocalPath -Raw) } else { '' }
$merge = Merge-DeployTargetEnvLayers -BaseContent $base -OverrideContent $local
Set-Content -LiteralPath $OutPath -Value (ConvertTo-DeployEnvContent -Values $merge.Values) -NoNewline -Encoding utf8
PSEOF
pwsh -NoProfile -NonInteractive -File "$MERGE_TMP" \
  -BasePath "$BASE_ENV" -LocalPath "$LOCAL_ENV" -OutPath "$EFFECTIVE_ENV" \
  -LibPath "$DEPLOY_ROOT/scripts/lib/remote-deploy-transport.ps1"
rm -f "$MERGE_TMP"

echo "== effective env begin =="
cat "$EFFECTIVE_ENV"
echo "== effective env end =="

{{BUILD_STEP}}
'@

    $script = $template.
        Replace('{{DEPLOY_ROOT}}', [string]$Target.deploy_root).
        Replace('{{DATA_ROOT}}', [string]$Target.runtime_data_root).
        Replace('{{REPO_URL}}', $script:RemoteDeployRepoUrl).
        Replace('{{ENV_NAME}}', '.env.web-plane.host-kit').
        Replace('{{EXEC_BITS}}', $execBits).
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

function Invoke-RemoteTestDeployRebuild {
    # Remote counterpart of Invoke-TestDeployRebuild. Pushes the base env layer,
    # streams the rebuild script over ssh stdin, captures the effective-env
    # section, and writes the masked snapshot locally next to the deploy reports.
    param(
        [Parameter(Mandatory = $true)] $Target,
        [Parameter(Mandatory = $true)][string] $OperatorRepoRoot,
        [switch] $Build,
        [string] $IdentityFile = '',
        [switch] $DryRun
    )

    $baseEnvPath = Join-Path $OperatorRepoRoot ([string]$Target.env_file)
    if (-not (Test-Path -LiteralPath $baseEnvPath -PathType Leaf)) {
        throw "remote_deploy_transport: operator canonical env file not found: $baseEnvPath (registry env_file for '$($Target.id)')."
    }
    $rebuildScript = New-RemoteRebuildScript -Target $Target -Build:$Build
    $sshArguments = Get-RemoteDeploySshArguments -Target $Target -IdentityFile $IdentityFile
    $effectiveEnvName = '.env.web-plane.host-kit'
    $pushCommand = "mkdir -p '$([string]$Target.deploy_root)' && cat > '$([string]$Target.deploy_root)/$effectiveEnvName.base'"

    if ($DryRun) {
        return [pscustomobject]@{
            SshArguments = $sshArguments
            PushCommand  = $pushCommand
            Script       = $rebuildScript
        }
    }

    # PS has no '<' stdin redirection; the pipeline feeds native stdin instead.
    Get-Content -LiteralPath $baseEnvPath -Raw | & ssh @sshArguments $pushCommand
    if ($LASTEXITCODE -ne 0) { throw "remote_deploy_transport: base env push failed with exit $LASTEXITCODE." }

    $output = $rebuildScript | & ssh @sshArguments 'bash -s' 2>&1
    $exitCode = $LASTEXITCODE

    $outputText = ($output | Out-String)
    $effectiveContent = ''
    if ($outputText -match '(?s)== effective env begin ==\r?\n(.*?)\r?\n== effective env end ==') {
        $effectiveContent = $Matches[1]
    }
    $values = ConvertFrom-DeployEnvContent -Content $effectiveContent
    $snapshot = New-DeployTargetEnvSnapshot -Values $values -TargetId ([string]$Target.id)

    $reportDir = Join-Path $OperatorRepoRoot "artifacts/deploy-reports/$([string]$Target.id)"
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $snapshotPath = Join-Path $reportDir "$stamp-effective-env.json"
    $snapshot | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $snapshotPath -Encoding utf8

    return [pscustomobject]@{
        ExitCode      = $exitCode
        Output        = $outputText
        SnapshotPath  = $snapshotPath
        EffectiveKeys = @($values.Keys)
    }
}
