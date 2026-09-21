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
#
# Pure PowerShell, no Pester; docker calls are injectable for tests.

Set-StrictMode -Version Latest

$script:CfdDefaultImage = 'opencfd/openfoam-default:2412'
$script:CfdDefaultImageDigest = 'sha256:1ba02114b1c025c370f2e269a07677c16c9bea8d990fcd75ac8378aff9d41b50'
$script:CfdEnvironmentKeys = @(
    'CFD_ENABLED',
    'CFD_IMAGE',
    'CFD_IMAGE_DIGEST',
    'CFD_N_PROCS',
    'CFD_MAX_DIRECTIONS',
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
    # Optional: where run directories (case files, overlay layers, run_record.json) live. Empty keeps the
    # job service default `<conversion artifacts root>/cfd`, i.e. the same tree that serves /artifacts.
    $artifactsRoot = (& $read 'CFD_ARTIFACTS_ROOT' '').Trim()
    if (-not [string]::IsNullOrWhiteSpace($artifactsRoot) -and -not [System.IO.Path]::IsPathRooted($artifactsRoot)) {
        throw "CFD_ARTIFACTS_ROOT must be an absolute path or empty: '$artifactsRoot'"
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
