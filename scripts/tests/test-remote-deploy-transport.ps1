[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $MessagePattern,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    try { & $Action } catch {
        $failed = $true
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "ASSERT FAILED: $Context threw, but message '$($_.Exception.Message)' does not match '$MessagePattern'."
        }
    }
    Assert-True $failed "$Context was expected to throw."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/deploy-target-registry.ps1')
. (Join-Path $repoRoot 'scripts/lib/remote-deploy-transport.ps1')

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "ai-bim-remote-transport-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    $inventoryPath = Join-Path $tempRoot 'operator-target.local.json'
    @{
        schema_version = 'deploy-target-private-inventory/v1'
        targets = @(@{
            id = 'canonical-linux'
            connection = @{ host = 'deploy.example.invalid'; user = 'deploy-fixture' }
            deploy_root = '/srv/ai-bim/example-deploy'
            runtime_data_root = '/srv/ai-bim/example-runtime-data'
            public_host = '192.0.2.10'
            edge_site_id = 'site-example'
            host_native_bind_host = '192.0.2.1'
        })
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $inventoryPath -Encoding utf8

    # --- env parsing and layering ---------------------------------------------------
    $base = @"
# comment line
PUBLIC_HOST=192.0.2.10
KIT_STREAM_SERVER=192.0.2.10
A4_INTERNAL_CONTEXT_TOKEN=super-secret-value
EMPTY_OK=
LOCAL_ONLY_FLAG=0

not-a-valid-line
1BAD_KEY=nope
"@
    $override = @"
KIT_STREAM_SERVER=198.51.100.9
LOCAL_ONLY_FLAG=1
"@

    $merge = Merge-DeployTargetEnvLayers -BaseContent $base -OverrideContent $override
    Assert-True ($merge.Values['KIT_STREAM_SERVER'] -eq '198.51.100.9') 'override must win per key'
    Assert-True ($merge.Values['PUBLIC_HOST'] -eq '192.0.2.10') 'base-only keys must survive'
    Assert-True ($merge.Values['LOCAL_ONLY_FLAG'] -eq '1') 'declared local override keys may replace base values'
    Assert-True ($merge.Values['EMPTY_OK'] -eq '') 'empty values are legal'
    Assert-True (-not $merge.Values.Contains('1BAD_KEY')) 'invalid key names are ignored'
    Assert-True (@($merge.OverriddenKeys) -contains 'KIT_STREAM_SERVER') 'overridden keys are reported'
    Assert-True (@($merge.OverrideOnlyKeys).Count -eq 0) 'override-only keys are impossible after allowlist validation'
    Assert-True (@($merge.Values.Keys)[0] -eq 'PUBLIC_HOST') 'base key order is preserved'
    Assert-Throws -Context 'unknown override key' -MessagePattern 'not declared by the base env' -Action {
        Merge-DeployTargetEnvLayers -BaseContent $base -OverrideContent "UNDECLARED_REMOTE_KEY=1`n"
    }

    $emptyMerge = Merge-DeployTargetEnvLayers -BaseContent '' -OverrideContent ''
    Assert-True (@($emptyMerge.Values.Keys).Count -eq 0) 'empty layers merge to empty'
    $roundtrip = ConvertTo-DeployEnvContent -Values $merge.Values
    Assert-True ($roundtrip -match '(?m)^KIT_STREAM_SERVER=198\.51\.100\.9$') 'serialized content carries merged values'

    # --- effective-env snapshot masking ---------------------------------------------
    $snapshot = New-DeployTargetEnvSnapshot -Values $merge.Values -TargetId 'canonical-linux' -OverriddenKeys $merge.OverriddenKeys
    Assert-True ([string]$snapshot.schema_version -eq 'deploy-target-env-snapshot/v1') 'snapshot schema version'
    $tokenEntry = @($snapshot.entries | Where-Object { $_.key -eq 'A4_INTERNAL_CONTEXT_TOKEN' })[0]
    Assert-True ([bool]$tokenEntry.secret) 'token key must be classified secret'
    Assert-True ($tokenEntry.fingerprint -match '^[0-9a-f]{8}$') 'secret entry carries an 8-hex fingerprint'
    Assert-True ($null -eq $tokenEntry.PSObject.Properties['value']) 'secret entry must not carry the value'
    Assert-True ([int]$tokenEntry.length -eq 'super-secret-value'.Length) 'secret entry records only the length'
    $hostEntry = @($snapshot.entries | Where-Object { $_.key -eq 'PUBLIC_HOST' })[0]
    Assert-True (-not [bool]$hostEntry.secret) 'public host is not classified as a credential'
    Assert-True ([bool]$hostEntry.topology) 'public host is classified as topology'
    Assert-True ($null -eq $hostEntry.PSObject.Properties['value']) 'topology entry must not carry the value'
    Assert-True ($hostEntry.fingerprint -match '^[0-9a-f]{8}$') 'topology entry carries only a fingerprint'
    $flagEntry = @($snapshot.entries | Where-Object { $_.key -eq 'LOCAL_ONLY_FLAG' })[0]
    Assert-True ($null -eq $flagEntry.PSObject.Properties['value']) 'even unclassified entries must not carry the value'
    Assert-True ($flagEntry.fingerprint -match '^[0-9a-f]{8}$') 'unclassified entry carries only a fingerprint'
    $snapshotJson = $snapshot | ConvertTo-Json -Depth 6
    Assert-True ($snapshotJson -notmatch 'super-secret-value') 'serialized snapshot never contains a secret value'
    Assert-True ($snapshotJson -notmatch '192\.0\.2\.10|198\.51\.100\.9') 'serialized snapshot never contains topology values'
    $aliasValues = [ordered]@{
        AUTHORIZATION = 'Bearer synthetic-authorization'
        COOKIE = 'synthetic-cookie'
        SESSION = 'synthetic-session'
        JWT = 'synthetic-jwt'
        CORS_ORIGINS = 'https://synthetic-origin.invalid'
        ORIGIN = 'https://synthetic-origin.invalid'
        DOMAIN = 'synthetic-domain.invalid'
        REDIS = 'redis://synthetic-cache.invalid:6379'
    }
    $aliasSnapshot = New-DeployTargetEnvSnapshot -Values $aliasValues -TargetId 'canonical-linux'
    foreach ($entry in $aliasSnapshot.entries) {
        Assert-True ($null -eq $entry.PSObject.Properties['value']) "snapshot entry '$($entry.key)' must never carry a raw value"
        Assert-True ($entry.fingerprint -match '^[0-9a-f]{8}$') "snapshot entry '$($entry.key)' carries an 8-hex fingerprint"
    }
    $aliasSnapshotJson = $aliasSnapshot | ConvertTo-Json -Depth 6
    foreach ($rawValue in $aliasValues.Values) {
        Assert-True (-not $aliasSnapshotJson.Contains([string]$rawValue)) 'serialized snapshot must exclude every synthetic raw value'
    }
    $snapshot2 = New-DeployTargetEnvSnapshot -Values $merge.Values -TargetId 'canonical-linux'
    $fp1 = @($snapshot.entries | Where-Object { $_.key -eq 'A4_INTERNAL_CONTEXT_TOKEN' })[0].fingerprint
    $fp2 = @($snapshot2.entries | Where-Object { $_.key -eq 'A4_INTERNAL_CONTEXT_TOKEN' })[0].fingerprint
    Assert-True ($fp1 -eq $fp2) 'fingerprint must be deterministic'

    # --- remote rebuild script generation ------------------------------------------
    $remoteTarget = Get-DeployTarget -Id 'canonical-linux' -InventoryPath $inventoryPath
    $script = New-RemoteRebuildScript -Target $remoteTarget -Build
    Assert-True ($script.Contains("git fetch origin '+refs/heads/main:refs/remotes/origin/main'")) 'script freshly fetches the contract refspec'
    Assert-True ($script.Contains('git clone "$REPO_URL" "$DEPLOY_ROOT"')) 'script clones when checkout is missing'
    Assert-True ($script.Contains('https://github.com/monkey1sai/AI-BIM-governance.git')) 'clone uses zero-credential HTTPS'
    Assert-True ($script.Contains('git reset --hard refs/remotes/origin/main')) 'script resets to fresh origin/main'
    Assert-True ($script.Contains("git clean -fd -e '.env*'")) 'clean preserves env files'
    Assert-True ($script.Contains('find "$DEPLOY_ROOT" -type f \(') -and $script.Contains("-name 'AGENTS.md' -o -name 'CLAUDE.md'")) 'remote cleanup removes nested agent instruction files'
    foreach ($toolingPath in @('.codex', '.agents', '.agent', '.claude', '.cursor', '.windsurf', '.github/skills', '.github/prompts', 'docs', 'openspec', 'patches')) {
        Assert-True ($script.Contains("`$DEPLOY_ROOT/$toolingPath")) "remote cleanup removes tracked tooling path $toolingPath"
    }
    Assert-True (-not $script.Contains('"$DEPLOY_ROOT/.github/workflows"')) 'remote cleanup preserves GitHub workflows'
    Assert-True ($script.Contains('cp -- "$DEPLOY_ROOT/docs/plans/ai-bim-governance.css"')) 'remote cleanup snapshots the production CSS dependency'
    Assert-True ($script.Contains('cp -- "$TOOLING_PRESERVE_DIR/ai-bim-governance.css" "$DEPLOY_ROOT/docs/plans/ai-bim-governance.css"')) 'remote cleanup restores the production CSS dependency'
    Assert-True ($script.Contains('KIT_INPUTS_CHANGED=1')) 'source revision changes invalidate stale Kit outputs'
    Assert-True ($script.Contains('rm -rf "$DEPLOY_ROOT/bim-streaming-server/_build"')) 'only ignored Kit output is invalidated'
    Assert-True ($script.Contains('restore exec bits (F-2)')) 'linux target restores exec bits'
    Assert-True ($script.Contains('scripts/deploy.ps1 -Build')) 'build flag runs deploy.ps1 -Build'
    Assert-True ($script.Contains("DATA_ROOT='/srv/ai-bim/example-runtime-data'")) 'override layer uses synthetic repo-external runtime data root'
    Assert-True ($script.Contains('TARGET_INVENTORY="$DATA_ROOT/target.local.json"')) 'remote inventory path is outside checkout'
    Assert-True ($script.Contains('export AI_BIM_DEPLOY_TARGET_INVENTORY="$TARGET_INVENTORY"')) 'deploy receives the owner-provisioned inventory path'
    Assert-True ($script.Contains('missing owner-controlled target inventory')) 'missing remote inventory fails closed'
    Assert-True (-not $script.Contains('cat > "$TARGET_INVENTORY"')) 'transport never uploads or overwrites private inventory'
    Assert-True ($script.Contains('Merge-DeployTargetEnvLayers')) 'remote merge calls the shared implementation'
    Assert-True ($script.Contains('/transport-lib.ps1')) 'remote merge uses the shipped library'
    Assert-True (-not $script.Contains("`r")) 'script is LF-only'
    Assert-True (-not ($script -match '\{\{[A-Z_]+\}\}')) 'no template placeholders remain'

    $scriptNoBuild = New-RemoteRebuildScript -Target $remoteTarget
    Assert-True (-not $scriptNoBuild.Contains('scripts/deploy.ps1 -Build')) 'without -Build the script does not deploy'
    $windowsTarget = Get-DeployTarget -Id 'local-windows'
    Assert-Throws -Context 'script generation for non-ssh target' -MessagePattern 'not an ssh target' -Action {
        New-RemoteRebuildScript -Target $windowsTarget
    }

    # --- ssh argument shape ---------------------------------------------------------
    $sshArguments = Get-RemoteDeploySshArguments -Target $remoteTarget
    Assert-True (($sshArguments -join ' ').Contains('BatchMode=yes')) 'ssh runs in batch mode'
    Assert-True ($sshArguments[-1] -eq 'deploy-fixture@deploy.example.invalid') 'ssh endpoint comes from private inventory'
    $sshWithKey = Get-RemoteDeploySshArguments -Target $remoteTarget -IdentityFile 'C:/keys/fixture'
    Assert-True (($sshWithKey -join ' ').Contains('-i C:/keys/fixture')) 'identity file is honored'

    # --- dispatch dry run -----------------------------------------------------------
    Assert-Throws -Context 'dispatch without canonical env file' -MessagePattern 'canonical env file not found' -Action {
        Invoke-RemoteTestDeployRebuild -Target $remoteTarget -OperatorRepoRoot $tempRoot -DryRun
    }
    Set-Content -LiteralPath (Join-Path $tempRoot ([string]$remoteTarget.env_file)) -Value "PUBLIC_HOST=192.0.2.10`n" -Encoding utf8
    $dry = Invoke-RemoteTestDeployRebuild -Target $remoteTarget -OperatorRepoRoot $tempRoot -Build -DryRun
    Assert-True ($dry.SshArguments[-1] -eq 'deploy-fixture@deploy.example.invalid') 'dry run uses private-inventory endpoint'
    Assert-True ($dry.InventoryCheckCommand.Contains("test -f '/srv/ai-bim/example-runtime-data/target.local.json'")) 'inventory preflight runs before staging'
    Assert-True (-not $dry.InventoryCheckCommand.Contains('cat >')) 'inventory preflight never writes private inventory'
    Assert-True ($dry.PushCommand.Contains('/srv/ai-bim/example-runtime-data/.env.web-plane.host-kit.base')) 'base env stages outside checkout'
    Assert-True (-not $dry.PushCommand.Contains('/srv/ai-bim/example-deploy/.env.web-plane.host-kit.base')) 'base push leaves fresh clone destination empty'
    Assert-True ($dry.PushCommand.Contains('chmod 600')) 'staged base env is owner-only'
    Assert-True ($dry.LibPushCommand.Contains('/srv/ai-bim/example-runtime-data/transport-lib.ps1')) 'transport library stages under runtime data root'
    Assert-True ($dry.Script.Contains('effective env snapshot begin')) 'remote returns only a redacted snapshot marker'
    Assert-True (-not $dry.Script.Contains('cat "$EFFECTIVE_ENV"')) 'remote output never prints raw effective env'
    Assert-True ($dry.Script.Contains('deploy.ps1 -Build')) 'dry-run script includes build'
    $transportSource = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts/lib/remote-deploy-transport.ps1') -Raw
    Assert-True ($transportSource.IndexOf('private inventory preflight failed') -lt $transportSource.IndexOf('transport lib push failed')) 'private inventory preflight precedes all staging'

    # --- isolated live dispatch / report persistence -------------------------------
    # Shadow the native ssh executable only inside this test process. This executes
    # all four transport calls without network access and exercises marker parsing
    # plus the ignored local report write (the dry-run assertions above do not).
    $script:fakeSshCallCount = 0
    $script:fakeSshSnapshotJson = $aliasSnapshot | ConvertTo-Json -Depth 6 -Compress
    function ssh {
        $null = @($input)
        $script:fakeSshCallCount++
        $global:LASTEXITCODE = 0
        if ($script:fakeSshCallCount -eq 4) {
            '== effective env snapshot begin =='
            $script:fakeSshSnapshotJson
            '== effective env snapshot end =='
            'synthetic-non-snapshot-output'
        }
    }
    try {
        $live = Invoke-RemoteTestDeployRebuild -Target $remoteTarget -OperatorRepoRoot $tempRoot -Build
    } finally {
        Remove-Item -LiteralPath Function:\ssh -Force -ErrorAction SilentlyContinue
    }
    Assert-True ($script:fakeSshCallCount -eq 4) 'live dispatch performs inventory check, library push, base push, then rebuild'
    Assert-True ([int]$live.ExitCode -eq 0) 'fake live dispatch succeeds'
    Assert-True (Test-Path -LiteralPath $live.SnapshotPath -PathType Leaf) 'redacted snapshot report is persisted'
    $persistedSnapshotJson = Get-Content -LiteralPath $live.SnapshotPath -Raw
    Assert-True ($persistedSnapshotJson -notmatch 'synthetic-non-snapshot-output') 'report excludes output outside snapshot markers'
    foreach ($rawValue in $aliasValues.Values) {
        Assert-True (-not $persistedSnapshotJson.Contains([string]$rawValue)) 'persisted report excludes every synthetic raw value'
    }
    $persistedSnapshot = $persistedSnapshotJson | ConvertFrom-Json
    foreach ($entry in $persistedSnapshot.entries) {
        Assert-True ($null -eq $entry.PSObject.Properties['value']) "persisted snapshot entry '$($entry.key)' must never carry a raw value"
    }
    Assert-True (@($live.EffectiveKeys) -contains 'AUTHORIZATION') 'parsed effective keys come from the redacted snapshot'

    $script:fakeSshCallCount = 0
    function ssh {
        $null = @($input)
        $script:fakeSshCallCount++
        $global:LASTEXITCODE = 0
        if ($script:fakeSshCallCount -eq 4) { 'synthetic-success-without-snapshot' }
    }
    try {
        Assert-Throws -Context 'successful rebuild without snapshot' -MessagePattern 'reported success but emitted no effective env snapshot' -Action {
            Invoke-RemoteTestDeployRebuild -Target $remoteTarget -OperatorRepoRoot $tempRoot -Build
        }
    } finally {
        Remove-Item -LiteralPath Function:\ssh -Force -ErrorAction SilentlyContinue
    }

    # --- F-17: snapshot end marker must start its own line --------------------------
    # The compressed snapshot JSON is written WITHOUT a trailing newline, so real
    # bash `cat` ends mid-line. Before F-17 the end marker was glued onto the JSON
    # line, the operator-side parser never matched, and a SUCCESSFUL real rebuild
    # was rejected as "no effective env snapshot section". The fake ssh above emits
    # PS objects that Out-String newline-joins, which can never reproduce that
    # shape - these assertions pin the real byte semantics.
    Assert-True ($dry.Script -match '(?m)^cat "\$SNAPSHOT_TMP"\necho\s*(#[^\n]*)?\necho "== effective env snapshot end =="') 'template emits a bare echo between cat and the end marker (F-17)'
    $compressedJson = '{"schema_version":"deploy-target-env-snapshot/v1","target_id":"canonical-linux","entries":[],"overridden_keys":[]}'
    $postFixTranscript = "== effective env snapshot begin ==`n" + $compressedJson + "`n== effective env snapshot end ==`n"
    $parsedTranscript = ConvertFrom-DeployEnvSnapshotTranscript -OutputText $postFixTranscript
    Assert-True ($null -ne $parsedTranscript -and [string]$parsedTranscript.target_id -eq 'canonical-linux') 'parser accepts the fixed transcript shape (newline-terminated cat)'
    $preFixTranscript = "== effective env snapshot begin ==`n" + $compressedJson + '== effective env snapshot end ==' + "`n"
    Assert-True ($null -eq (ConvertFrom-DeployEnvSnapshotTranscript -OutputText $preFixTranscript)) 'the pre-F-17 glued shape must not parse - this is the failure the echo prevents'
    Write-Host '[PASS] F-17 snapshot terminator newline'

    # --- B13 deploy tags: 日期+timer ticker+序號 -----------------------------------
    $ts = [DateTimeOffset]::new(2026, 8, 5, 1, 2, 3, [TimeSpan]::Zero)
    $expected = 'deploy-20260805-{0}-007' -f $ts.UtcTicks
    if ((Get-DeployTagName -TimestampUtc $ts -Sequence 7) -cne $expected) {
        throw "ASSERT FAILED: tag name must be deploy-<yyyyMMdd>-<UtcTicks>-<NNN> (expected $expected)"
    }
    foreach ($bad in @(0, 1000)) {
        $threw = $false
        try { $null = Get-DeployTagName -TimestampUtc $ts -Sequence $bad } catch { $threw = $true }
        if (-not $threw) { throw "ASSERT FAILED: sequence $bad must be rejected" }
    }

    # New-RemoteDeployTag drives git only through the injectable runner: the
    # sequence counts the day's existing tags, a name collision retries with the
    # next number, and a failed push is a hard error (a local-only tag would
    # silently lie about what origin knows).
    $script:tagCalls = [System.Collections.Generic.List[string]]::new()
    $runner = {
        param([string[]] $GitArgs)
        $script:tagCalls.Add(($GitArgs -join ' '))
        $joined = $GitArgs -join ' '
        if ($joined -match '^tag --list') { return [pscustomobject]@{ ExitCode = 0; Output = "deploy-20260805-1-001`ndeploy-20260805-2-002" } }
        if ($joined -match '^tag -a \S+-003 ') { return [pscustomobject]@{ ExitCode = 1; Output = 'already exists' } }
        return [pscustomobject]@{ ExitCode = 0; Output = '' }
    }
    $sha = 'a' * 40
    $name = New-RemoteDeployTag -OperatorRepoRoot 'X:/nowhere' -TargetId 'canonical-linux' -DeployedSha $sha -SnapshotName 'snap.json' -TimestampUtc $ts -GitRunner $runner
    if ($name -notmatch '-004$') { throw "ASSERT FAILED: collision on -003 must retry to -004 (got $name)" }
    if (-not ($script:tagCalls | Where-Object { $_ -eq "push origin refs/tags/$name" })) { throw 'ASSERT FAILED: the tag must be pushed to origin' }

    $threw = $false
    try {
        $null = New-RemoteDeployTag -OperatorRepoRoot 'X:/nowhere' -TargetId 't' -DeployedSha $sha -SnapshotName 's' -TimestampUtc $ts -GitRunner {
            param([string[]] $GitArgs)
            if (($GitArgs -join ' ') -match '^push ') { return [pscustomobject]@{ ExitCode = 1; Output = 'denied' } }
            return [pscustomobject]@{ ExitCode = 0; Output = '' }
        }
    } catch { $threw = $true }
    if (-not $threw) { throw 'ASSERT FAILED: a failed push must be a hard error, not a silent local tag' }

    $threw = $false
    try { $null = New-RemoteDeployTag -OperatorRepoRoot 'X:' -TargetId 't' -DeployedSha 'not-a-sha' -SnapshotName 's' -TimestampUtc $ts } catch { $threw = $true }
    if (-not $threw) { throw 'ASSERT FAILED: a non-sha deployed ref must be rejected' }
    Write-Host '[PASS] B13 deploy tag naming, sequencing, collision retry, push discipline'

    Write-Host '[test-remote-deploy-transport] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
