# scripts\lib\cfd-solver-deploy.ps1
# CFD (OpenFOAM in docker) deployment helpers for the canonical deploy path
# (docs/plans/building-energy-cfd-p2-contract.md S4).
#
# - Resolve-CfdDeployEnvironment: reads the CFD_* keys from the canonical env file
#   (through the caller-supplied reader) and returns the process environment the
#   host-native conversion service needs. CFD stays disabled unless CFD_ENABLED is
#   truthy; invalid values fail closed instead of being silently defaulted.
# - Ensure-CfdSolverImage: makes sure the pinned solver image is present on the
#   deploy host and, when a digest is configured, that the local image carries it.
#   Missing image -> pull (by digest when configured); digest mismatch -> throw.
# - Set-CfdProcessEnvironment: applies the resolved map to the current process
#   environment (inherited by the conversion service child process).
# - Get-CfdRunDeployGuard: before a deploy stops or replaces the host-native conversion
#   service (which hosts the CFD job worker), lists the CFD runs that stop would kill and
#   refuses unless the operator explicitly allows interrupting them.
#
# Pure PowerShell, no Pester; docker and HTTP calls are injectable for tests.

Set-StrictMode -Version Latest

$script:CfdDefaultImage = 'opencfd/openfoam-default:2412'
$script:CfdDefaultImageDigest = 'sha256:1ba02114b1c025c370f2e269a07677c16c9bea8d990fcd75ac8378aff9d41b50'
$script:CfdEnvironmentKeys = @(
    'CFD_ENABLED',
    'CFD_IMAGE',
    'CFD_IMAGE_DIGEST',
    'CFD_N_PROCS',
    'CFD_MAX_DIRECTIONS',
    'CFD_MAX_CELLS_PER_DIRECTION',
    'CFD_ARTIFACTS_ROOT',
    'CFD_PUBLIC_ARTIFACTS_URL'
)

function ConvertTo-CfdBoolString {
    param([AllowNull()][AllowEmptyString()][string] $Value)
    $normalized = ([string]$Value).Trim().ToLowerInvariant()
    if ($normalized -in @('1', 'true', 'yes', 'on')) { return 'true' }
    if ($normalized -in @('', '0', 'false', 'no', 'off')) { return 'false' }
    throw "CFD_ENABLED must be one of 1/true/yes/on or 0/false/no/off: '$Value'"
}

function Get-CfdPublicArtifactsUrl {
    # The coordinator derives `/cfd-artifacts` from the public `/artifacts` origin the same
    # way (bim-review-coordinator/src/routes/cfdRunRoutes.ts derivePublicCfdArtifactsUrl);
    # both sides must agree or overlay URLs handed to Kit point at the wrong origin.
    param([AllowNull()][AllowEmptyString()][string] $ConversionPublicArtifactsUrl)
    $base = ([string]$ConversionPublicArtifactsUrl).Trim().TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($base)) { return '' }
    if ($base.EndsWith('/artifacts')) {
        return $base.Substring(0, $base.Length - '/artifacts'.Length) + '/cfd-artifacts'
    }
    return "$base/cfd-artifacts"
}

function Resolve-CfdDeployEnvironment {
    [CmdletBinding()]
    param(
        # { param($Name, $Default) -> string } — deploy.ps1 passes Get-DeployEnvValue bound to the canonical env file.
        [Parameter(Mandatory = $true)][scriptblock] $EnvValueReader,
        [AllowEmptyString()][string] $ConversionPublicArtifactsUrl = '',
        [int] $DefaultNProcs = 4
    )
    $read = { param($Name, $Default) [string](& $EnvValueReader $Name $Default) }

    $enabled = ConvertTo-CfdBoolString -Value (& $read 'CFD_ENABLED' 'false')
    $image = (& $read 'CFD_IMAGE' $script:CfdDefaultImage).Trim()
    if ($image -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*(:[A-Za-z0-9._-]+)?$') {
        throw "CFD_IMAGE is not a plain image reference (repository[:tag]): '$image'"
    }
    $digest = (& $read 'CFD_IMAGE_DIGEST' $script:CfdDefaultImageDigest).Trim()
    if (-not [string]::IsNullOrWhiteSpace($digest) -and $digest -notmatch '^sha256:[0-9a-f]{64}$') {
        throw "CFD_IMAGE_DIGEST must be 'sha256:<64 hex>' or empty: '$digest'"
    }
    $nProcsRaw = (& $read 'CFD_N_PROCS' ([string]$DefaultNProcs)).Trim()
    $nProcs = 0
    if (-not [int]::TryParse($nProcsRaw, [ref]$nProcs) -or $nProcs -lt 1 -or $nProcs -gt 64) {
        throw "CFD_N_PROCS must be an integer in 1..64: '$nProcsRaw'"
    }
    $maxDirectionsRaw = (& $read 'CFD_MAX_DIRECTIONS' '16').Trim()
    $maxDirections = 0
    if (-not [int]::TryParse($maxDirectionsRaw, [ref]$maxDirections) -or $maxDirections -lt 1 -or $maxDirections -gt 16) {
        throw "CFD_MAX_DIRECTIONS must be an integer in 1..16: '$maxDirectionsRaw'"
    }
    # Optional (S8): compute hard cap per wind direction, checked against the estimate at submission. Empty keeps the
    # job service default (cfd_job_service.DEFAULT_MAX_CELLS_PER_DIRECTION); a value must be an integer the service
    # would not clamp, so a typo fails the deploy instead of silently becoming the clamp bound.
    $maxCellsRaw = (& $read 'CFD_MAX_CELLS_PER_DIRECTION' '').Trim()
    if (-not [string]::IsNullOrWhiteSpace($maxCellsRaw)) {
        $maxCells = 0L
        if (-not [long]::TryParse($maxCellsRaw, [ref]$maxCells) -or $maxCells -lt 100000 -or $maxCells -gt 200000000) {
            throw "CFD_MAX_CELLS_PER_DIRECTION must be an integer in 100000..200000000 or empty: '$maxCellsRaw'"
        }
        $maxCellsRaw = [string]$maxCells
    }
    # Optional: where run directories (case files, overlay layers, run_record.json) live. Empty keeps the
    # job service default `<conversion artifacts root>/cfd`, i.e. the same tree that serves /artifacts.
    $artifactsRoot = (& $read 'CFD_ARTIFACTS_ROOT' '').Trim()
    # IsPathFullyQualified (pwsh 7 / .NET Core): rejects drive-relative `C:cfd` and root-relative `\cfd`
    # on Windows, which IsPathRooted would accept; deploy.ps1 already requires pwsh 7.
    if (-not [string]::IsNullOrWhiteSpace($artifactsRoot) -and -not [System.IO.Path]::IsPathFullyQualified($artifactsRoot)) {
        throw "CFD_ARTIFACTS_ROOT must be a fully qualified absolute path or empty: '$artifactsRoot'"
    }
    $publicUrl = (& $read 'CFD_PUBLIC_ARTIFACTS_URL' '').Trim()
    if ([string]::IsNullOrWhiteSpace($publicUrl)) {
        $publicUrl = Get-CfdPublicArtifactsUrl -ConversionPublicArtifactsUrl $ConversionPublicArtifactsUrl
    }

    return [ordered]@{
        CFD_ENABLED              = $enabled
        CFD_IMAGE                = $image
        CFD_IMAGE_DIGEST         = $digest
        CFD_N_PROCS              = [string]$nProcs
        CFD_MAX_DIRECTIONS       = [string]$maxDirections
        CFD_MAX_CELLS_PER_DIRECTION = $maxCellsRaw
        CFD_ARTIFACTS_ROOT       = $artifactsRoot
        CFD_PUBLIC_ARTIFACTS_URL = $publicUrl
    }
}

function Set-CfdProcessEnvironment {
    # Applies the resolved map to this process; child services inherit it. Keys with an
    # empty value are removed so a stale value from a previous deploy cannot leak through.
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $CfdEnvironment)
    foreach ($key in $script:CfdEnvironmentKeys) {
        $value = if ($CfdEnvironment.Contains($key)) { [string]$CfdEnvironment[$key] } else { '' }
        if ([string]::IsNullOrWhiteSpace($value)) {
            [Environment]::SetEnvironmentVariable($key, $null)
        } else {
            [Environment]::SetEnvironmentVariable($key, $value)
        }
    }
}

function Get-CfdImageRepository {
    param([Parameter(Mandatory = $true)][string] $Image)
    $lastSlash = $Image.LastIndexOf('/')
    $lastColon = $Image.LastIndexOf(':')
    if ($lastColon -gt $lastSlash) { return $Image.Substring(0, $lastColon) }
    return $Image
}

function Ensure-CfdSolverImage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Image,
        [AllowEmptyString()][string] $Digest = '',
        # { param($ArgList) -> @{ ExitCode; Stdout } } — real docker by default; tests inject a stub.
        [scriptblock] $DockerCommand = {
            param($ArgList)
            $out = docker @ArgList 2>&1
            @{ ExitCode = $LASTEXITCODE; Stdout = ($out | Out-String).Trim() }
        }
    )
    $repository = Get-CfdImageRepository -Image $Image
    $inspect = { & $DockerCommand @(@('image', 'inspect', '--format', '{{join .RepoDigests ","}}', $Image)) }

    $result = & $inspect
    $pulled = $false
    if ($result.ExitCode -ne 0) {
        $target = if ([string]::IsNullOrWhiteSpace($Digest)) { $Image } else { "$repository@$Digest" }
        $pull = & $DockerCommand @(@('pull', $target))
        if ($pull.ExitCode -ne 0) {
            throw "docker pull $target failed (exit $($pull.ExitCode)): $($pull.Stdout)"
        }
        $pulled = $true
        if (-not [string]::IsNullOrWhiteSpace($Digest)) {
            # A digest pull leaves an untagged image; give it the configured tag so the job
            # service (which runs `docker run <image>`) resolves the exact pinned bytes.
            $tag = & $DockerCommand @(@('tag', $target, $Image))
            if ($tag.ExitCode -ne 0) { throw "docker tag $target $Image failed (exit $($tag.ExitCode)): $($tag.Stdout)" }
        }
        $result = & $inspect
        if ($result.ExitCode -ne 0) { throw "docker image inspect $Image failed after pull (exit $($result.ExitCode)): $($result.Stdout)" }
    }

    $digests = @(([string]$result.Stdout) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $actual = @($digests | ForEach-Object { if ($_ -match '@(sha256:[0-9a-f]{64})$') { $Matches[1] } })
    if (-not [string]::IsNullOrWhiteSpace($Digest) -and ($actual -notcontains $Digest)) {
        throw "CFD solver image $Image is present but its digest ($($actual -join ',')) is not the pinned CFD_IMAGE_DIGEST $Digest; refusing to deploy an unpinned solver."
    }
    return [ordered]@{
        image           = $Image
        digest_expected = $Digest
        digest_actual   = ($(if ($actual.Count -gt 0) { $actual[0] } else { '' }))
        pulled          = $pulled
    }
}

function Get-CfdRunDeployGuard {
    # Decides, on the deploy target, whether the host-native conversion service may be stopped
    # or replaced. That service hosts the CFD job worker, and every start of it runs
    # CfdJobService.reconcile_on_start (cfd_job_service.py): a run in preprocessing, meshing,
    # solving or postprocessing has its solver container killed and ends failed
    # (worker_unavailable); queued runs are re-enqueued and survive. The runs come from the
    # service's own list route, GET /api/cfd-runs?status=<status> (reads need no token):
    #   service not running  -> nothing can be interrupted: proceed
    #   no run in progress   -> proceed; queued runs are reported
    #   runs in progress     -> blocked; run ids and statuses are listed
    #   run list unreadable  -> blocked (fail closed): a run in progress cannot be ruled out
    # -AllowInterruptingCfdRuns lets both blocked cases proceed; the message still records them.
    # Every message starts with 'CFD run guard:' (the remote transport echoes those lines).
    [CmdletBinding()]
    param(
        # Whether the service the deploy would stop is alive (the pid file that stop acts on is live).
        [Parameter(Mandatory = $true)][bool] $ServiceRunning,
        # Its origin as reached from the target itself, e.g. http://127.0.0.1:49101.
        [Parameter(Mandatory = $true)][string] $ServiceBaseUrl,
        [switch] $AllowInterruptingCfdRuns,
        # { param($Uri) -> parsed JSON body } — Invoke-RestMethod by default; tests inject a stub.
        [scriptblock] $HttpGet = {
            param($Uri)
            Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 10 -ErrorAction Stop
        }
    )
    $verdict = {
        param([string] $Status, [bool] $Blocked, [string] $Message, $ActiveRuns = @(), $QueuedRuns = @())
        [pscustomobject]@{
            Status     = $Status
            Blocked    = $Blocked
            ActiveRuns = @($ActiveRuns)
            QueuedRuns = @($QueuedRuns)
            Message    = "CFD run guard: $Message"
        }
    }
    if (-not $ServiceRunning) {
        return (& $verdict 'not_running' $false 'the host-native conversion service is not running, so no CFD run can be interrupted.')
    }

    $inProgressStatuses = @('preprocessing', 'meshing', 'solving', 'postprocessing')
    # Pipeline order: a run only moves forward, so one that advances between two requests is
    # still seen by the later request, and the last status seen per run wins.
    $lastSeen = [ordered]@{}
    $uri = ''
    try {
        foreach ($status in @('queued') + $inProgressStatuses) {
            # The status filter applies before the limit; 500 is the route's own cap.
            $uri = '{0}/api/cfd-runs?status={1}&limit=500' -f $ServiceBaseUrl.TrimEnd('/'), $status
            $body = & $HttpGet $uri
            if ($null -eq $body -or $null -eq $body.PSObject.Properties['items'] -or $null -eq $body.items) {
                throw 'response has no items list'
            }
            foreach ($item in @($body.items)) {
                $runId = if ($null -ne $item -and $item.PSObject.Properties['run_id']) { [string]$item.run_id } else { '' }
                $runStatus = if ($null -ne $item -and $item.PSObject.Properties['status']) { [string]$item.status } else { '' }
                if ([string]::IsNullOrWhiteSpace($runId) -or [string]::IsNullOrWhiteSpace($runStatus)) {
                    throw 'a listed run has no run_id or status'
                }
                $lastSeen[$runId] = $runStatus
            }
        }
    } catch {
        $detail = "GET $uri failed: $(([string]$_.Exception.Message -replace '\s+', ' ').Trim())"
        if ($AllowInterruptingCfdRuns) {
            return (& $verdict 'query_failed' $false "the CFD run list could not be read ($detail); proceeding because -AllowInterruptingCfdRuns is set, which interrupts any run in progress.")
        }
        return (& $verdict 'query_failed' $true "refusing to stop the host-native conversion service: it is running but its CFD run list could not be read ($detail), so a run in progress cannot be ruled out. Check the service, or re-run with -AllowInterruptingCfdRuns to stop it anyway.")
    }

    $active = @($lastSeen.Keys | Where-Object { $inProgressStatuses -contains $lastSeen[$_] } | Sort-Object |
        ForEach-Object { [pscustomobject]@{ run_id = $_; status = $lastSeen[$_] } })
    $queued = @($lastSeen.Keys | Where-Object { $lastSeen[$_] -eq 'queued' } | Sort-Object)
    $queuedNote = if ($queued.Count -gt 0) { "queued runs, re-enqueued by the restart: $($queued -join ', ')" } else { 'no queued runs' }
    if ($active.Count -eq 0) {
        return (& $verdict 'clear' $false "no CFD run in progress; $queuedNote." @() $queued)
    }
    $activeList = @($active | ForEach-Object { "$($_.run_id) ($($_.status))" }) -join ', '
    if ($AllowInterruptingCfdRuns) {
        return (& $verdict 'active_runs' $false "-AllowInterruptingCfdRuns is set: stopping the host-native conversion service interrupts $($active.Count) CFD run(s) in progress, which end failed (worker_unavailable): $activeList; $queuedNote." $active $queued)
    }
    return (& $verdict 'active_runs' $true "refusing to stop the host-native conversion service: $($active.Count) CFD run(s) in progress would be killed and end failed (worker_unavailable): $activeList; $queuedNote. Wait for them to finish or cancel them (coordinator POST /api/cfd/runs/<run_id>/cancel), then re-run; -AllowInterruptingCfdRuns interrupts them deliberately, and scripts/stop-all.ps1 would interrupt them too." $active $queued)
}
