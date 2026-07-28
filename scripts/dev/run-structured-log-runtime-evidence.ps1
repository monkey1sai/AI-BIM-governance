[CmdletBinding()]
param(
    [string] $AttemptRoot = '',
    [string] $FixturePath = '',
    [string] $PythonExe = '',
    [ValidateSet(8005)] [int] $CoordinatorPort = 8005,
    [ValidateSet(5175)] [int] $ViewerPort = 5175,
    [ValidateSet(49104)] [int] $ConversionPort = 49104,
    [ValidateSet('Build', 'VerifiedPackage')] [string] $KitProvisionMode = 'Build',
    [string] $KitPackagePath = '',
    [string] $KitPackageSha256 = '',
    [ValidateRange(1, 3600)] [int] $LivePollSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-StructuredLogAbsolutePath {
    param([string] $Path)
    return -not [string]::IsNullOrWhiteSpace($Path) -and [System.IO.Path]::IsPathFullyQualified($Path)
}

function Assert-StructuredLogAttemptRoot {
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $AttemptRoot,
        [string] $AttemptId = '',
        [switch] $RequireExisting
    )
    if (-not (Test-StructuredLogAbsolutePath $RepoRoot) -or -not (Test-StructuredLogAbsolutePath $AttemptRoot)) { throw 'HELD: repo and attempt roots must be absolute' }
    if ($AttemptRoot -match '(^|[\\/])\.\.([\\/]|$)' -or $AttemptRoot -match '(^|[\\/])\.([\\/]|$)') { throw 'HELD: attempt root must use canonical spelling without dot segments' }
    $resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop).Path
    $attemptFull = [IO.Path]::GetFullPath($AttemptRoot).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
    if ($attemptFull -cne $AttemptRoot.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)) { throw 'HELD: attempt root is not canonical or case-correct' }
    $evidenceRoot = Join-Path $resolvedRepo 'artifacts\spec-to-done\cross-service-structured-log-baseline\evidence'
    if ((Split-Path -Parent $attemptFull) -cne $evidenceRoot) { throw "HELD: attempt root must be confined directly under $evidenceRoot" }
    $leaf = Split-Path -Leaf $attemptFull
    if ([string]::IsNullOrWhiteSpace($leaf) -or (-not [string]::IsNullOrWhiteSpace($AttemptId) -and $leaf -cne $AttemptId)) { throw 'HELD: attempt root leaf must case-exactly equal attempt_id' }

    $relative = [IO.Path]::GetRelativePath($resolvedRepo,$attemptFull)
    $cursor = $resolvedRepo
    foreach ($segment in @($relative -split '[\\/]')) {
        if ([string]::IsNullOrWhiteSpace($segment)) { continue }
        if (Test-Path -LiteralPath $cursor -PathType Container) {
            $actualChild = Get-ChildItem -LiteralPath $cursor -Force -ErrorAction Stop | Where-Object { $_.Name -ieq $segment } | Select-Object -First 1
            if ($null -ne $actualChild) {
                if ([string]$actualChild.Name -cne $segment) { throw 'HELD: attempt root path casing does not match the filesystem' }
                if (($actualChild.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HELD: reparse points are forbidden in attempt root ancestors or leaf' }
            }
        }
        $cursor = Join-Path $cursor $segment
    }
    $repoItem = Get-Item -LiteralPath $resolvedRepo -Force
    if (($repoItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'HELD: reparse repo root is not trusted for runtime evidence' }
    if ($RequireExisting -and -not (Test-Path -LiteralPath $attemptFull -PathType Container)) { throw 'HELD: attempt root does not exist' }
    return $attemptFull
}

function Write-StructuredLogJson {
    param([string] $Path, $Value)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Value | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Get-StructuredLogPortListeners {
    param([int] $Port)
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return @() }
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object {
        $processPath = $null
        try { $processPath = (Get-Process -Id $_.OwningProcess -ErrorAction Stop).Path } catch {}
        [pscustomobject]@{ pid = [int]$_.OwningProcess; path = $processPath }
    })
}

function New-StructuredLogAttemptContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $AttemptRoot,
        [Parameter(Mandatory)] [string] $FixturePath,
        [Parameter(Mandatory)] [string] $PythonExe,
        [Parameter(Mandatory)] $Ports,
        [scriptblock] $PortInspector = ${function:Get-StructuredLogPortListeners}
    )

    foreach ($entry in ([ordered]@{ RepoRoot=$RepoRoot; AttemptRoot=$AttemptRoot; FixturePath=$FixturePath; PythonExe=$PythonExe }).GetEnumerator()) {
        if (-not (Test-StructuredLogAbsolutePath -Path ([string]$entry.Value))) {
            throw "$($entry.Key) must be an absolute path"
        }
    }
    $resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop).Path
    $validatedAttemptRoot = Assert-StructuredLogAttemptRoot -RepoRoot $resolvedRepo -AttemptRoot $AttemptRoot
    if (Test-Path -LiteralPath $AttemptRoot) { throw "attempt root already exists; attempt reuse is forbidden: $AttemptRoot" }
    if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf) -or [System.IO.Path]::GetExtension($FixturePath) -cne '.ifc') {
        throw "IFC fixture is missing or invalid: $FixturePath"
    }
    if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "Python executable is missing: $PythonExe" }

    $expectedPorts = [ordered]@{ Coordinator=8005; Viewer=5175; Conversion=49104 }
    foreach ($name in $expectedPorts.Keys) {
        if ($null -eq $Ports.$name -or [int]$Ports.$name -ne $expectedPorts[$name]) {
            throw "Only isolated ports 8005/5175/49104 are supported"
        }
        $listeners = @(& $PortInspector ([int]$Ports.$name))
        if ($listeners.Count -gt 0) {
            $listenerSummary = ($listeners | ForEach-Object { "pid=$($_.pid)" }) -join ','
            throw "HELD: occupied listener on owned candidate port $($Ports.$name) ($listenerSummary); no process was stopped"
        }
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $validatedAttemptRoot) -Force -ErrorAction Stop | Out-Null
    Assert-StructuredLogAttemptRoot -RepoRoot $resolvedRepo -AttemptRoot $validatedAttemptRoot | Out-Null
    New-Item -ItemType Directory -Path $validatedAttemptRoot -ErrorAction Stop | Out-Null
    Assert-StructuredLogAttemptRoot -RepoRoot $resolvedRepo -AttemptRoot $validatedAttemptRoot -RequireExisting | Out-Null
    $attemptRootResolved = (Resolve-Path -LiteralPath $AttemptRoot).Path
    $logRoot = Join-Path $attemptRootResolved 'logs'
    $storageRoot = Join-Path $attemptRootResolved 'storage'
    New-Item -ItemType Directory -Path $logRoot, $storageRoot -Force | Out-Null
    $fixtureCopy = Join-Path $storageRoot ([System.IO.Path]::GetFileName($FixturePath))
    Copy-Item -LiteralPath $FixturePath -Destination $fixtureCopy -ErrorAction Stop

    $fixtureInfo = Get-Item -LiteralPath $FixturePath
    $fixtureCapture = [ordered]@{
        schema_version = '1'
        name = $fixtureInfo.Name
        size_bytes = [int64]$fixtureInfo.Length
        sha256 = (Get-FileHash -LiteralPath $FixturePath -Algorithm SHA256).Hash.ToLowerInvariant()
        source_path = $fixtureInfo.FullName
        attempt_copy = $fixtureCopy
    }
    $machineCapture = [ordered]@{
        schema_version = '1'
        machine_name = [Environment]::MachineName
        os_version = [Environment]::OSVersion.VersionString
        pwsh_version = $PSVersionTable.PSVersion.ToString()
        process_architecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    }
    Write-StructuredLogJson -Path (Join-Path $attemptRootResolved 'fixture.json') -Value $fixtureCapture
    Write-StructuredLogJson -Path (Join-Path $attemptRootResolved 'machine.json') -Value $machineCapture

    return [pscustomobject]@{
        RepoRoot = $resolvedRepo
        AttemptRoot = $attemptRootResolved
        AttemptId = (Split-Path -Leaf $attemptRootResolved)
        FixturePath = $fixtureCopy
        SourceFixturePath = $fixtureInfo.FullName
        FixtureSha256 = $fixtureCapture.sha256
        PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
        Ports = [ordered]@{ Coordinator=8005; Viewer=5175; Conversion=49104 }
        LogRoot = $logRoot
        StorageRoot = $storageRoot
        ProvenancePath = (Join-Path $attemptRootResolved 'command-provenance.jsonl')
        LeasePath = (Join-Path $attemptRootResolved 'runtime-lease.json')
        Kit = $null
        TouchedEnvironment = [ordered]@{}
    }
}

function Write-StructuredLogProvenance {
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)] [string] $Phase,
        [Parameter(Mandatory)] [string] $Command,
        [Parameter(Mandatory)] [string] $Cwd,
        [Parameter(Mandatory)] [string] $Status,
        [AllowNull()] $ExitCode,
        [string] $StartedUtc = '',
        [string] $EndedUtc = ''
    )
    if ([string]::IsNullOrWhiteSpace($StartedUtc)) { $StartedUtc = [DateTimeOffset]::UtcNow.ToString('o') }
    if ([string]::IsNullOrWhiteSpace($EndedUtc)) { $EndedUtc = [DateTimeOffset]::UtcNow.ToString('o') }
    $seq = if (Test-Path -LiteralPath $Context.ProvenancePath) { @(Get-Content -LiteralPath $Context.ProvenancePath).Count + 1 } else { 1 }
    $record = [ordered]@{
        seq = $seq
        ts_utc = $EndedUtc
        started_utc = $StartedUtc
        ended_utc = $EndedUtc
        phase = $Phase
        command = $Command
        cwd = $Cwd
        status = $Status
        exit_code = $ExitCode
    }
    ($record | ConvertTo-Json -Compress -Depth 8) | Add-Content -LiteralPath $Context.ProvenancePath -Encoding utf8
    return [pscustomobject]$record
}

function Get-StructuredLogKitAssetPaths {
    param([string] $RepoRoot, [string] $SearchRoot = '', [switch] $BuildDiscovery)
    $serverRoot = if ([string]::IsNullOrWhiteSpace($SearchRoot)) { Join-Path $RepoRoot 'bim-streaming-server' } else { $SearchRoot }
    $buildRoot = Join-Path $serverRoot '_build\windows-x86_64\release'
    $canonicalHoopsSuffix = 'omni/services/convert/cad/services/process/hoops_main.py'
    $selectedHoops = $null
    :hoopsSearch foreach ($relativeRoot in @('extscache','exts','extsbuild')) {
        $searchRootPath = Join-Path $buildRoot $relativeRoot
        if (-not (Test-Path -LiteralPath $searchRootPath -PathType Container)) { continue }
        $candidates = [Collections.Generic.List[IO.DirectoryInfo]]::new()
        $candidates.Add((Get-Item -LiteralPath $searchRootPath -Force))
        if ($BuildDiscovery) {
            foreach ($child in @(Get-ChildItem -LiteralPath $searchRootPath -Directory -Force -ErrorAction SilentlyContinue | Sort-Object -Property FullName)) { $candidates.Add($child) }
        }
        foreach ($candidate in $candidates) {
            $candidateMatches = @(Get-ChildItem -LiteralPath $candidate.FullName -Recurse -File -Filter 'hoops_main.py' -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName.Replace('\','/').EndsWith($canonicalHoopsSuffix,[StringComparison]::OrdinalIgnoreCase) } |
                Sort-Object -Property FullName)
            if ($candidateMatches.Count -gt 0) { $selectedHoops = $candidateMatches[0].FullName; break hoopsSearch }
        }
    }
    return [ordered]@{
        kit_exe = Join-Path $buildRoot 'kit\kit.exe'
        hoops_main = if ($null -ne $selectedHoops) { $selectedHoops } else { Join-Path $buildRoot 'exts\omni.services.convert.cad\omni\services\convert\cad\services\process\hoops_main.py' }
        converter_config = Join-Path $serverRoot 'source\apps\ezplus.bim_ifc_usd_converter.kit'
        converter_wrapper = Join-Path $serverRoot 'scripts\convert-ifc-to-usdc.ps1'
    }
}

function Test-StructuredLogKitAssetPaths {
    param($Paths)
    return @('kit_exe', 'hoops_main', 'converter_config', 'converter_wrapper') | Where-Object { -not (Test-Path -LiteralPath $Paths[$_] -PathType Leaf) }
}

function Assert-StructuredLogSafePackageArchive {
    param([Parameter(Mandatory)] [string] $PackagePath, [Parameter(Mandatory)] [string] $DestinationRoot)
    Add-Type -AssemblyName System.IO.Compression
    $destinationFull = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
    $destinationPrefix = $destinationFull + [IO.Path]::DirectorySeparatorChar
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $items = [Collections.Generic.List[object]]::new()
    $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        if ($archive.Entries.Count -eq 0) { throw 'HELD: package archive is empty' }
        foreach ($entry in $archive.Entries) {
            $raw = [string]$entry.FullName
            if ([string]::IsNullOrWhiteSpace($raw) -or $raw.Contains('\') -or $raw.StartsWith('/') -or $raw.StartsWith('//') -or $raw -match '^[A-Za-z]:' -or $raw.Contains(':')) { throw "HELD: unsafe archive entry path: $raw" }
            $isDirectory = $raw.EndsWith('/')
            $canonical = $raw.TrimEnd('/')
            $segments = @($canonical -split '/')
            if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -in @('','.','..') }).Count -gt 0) { throw "HELD: unsafe archive entry segments: $raw" }
            $target = [IO.Path]::GetFullPath((Join-Path $destinationFull ($canonical.Replace('/',[IO.Path]::DirectorySeparatorChar))))
            if (-not $target.StartsWith($destinationPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw "HELD: archive entry escapes destination: $raw" }
            if (-not $seen.Add($canonical)) { throw "HELD: duplicate archive entry: $raw" }
            $attributes = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.ExternalAttributes),0)
            $unixType = (($attributes -shr 16) -band 0xF000)
            if ($unixType -eq 0xA000 -or (($attributes -band [uint32][IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "HELD: symlink or reparse archive entry is forbidden: $raw" }
            $items.Add([pscustomobject]@{path=$canonical;is_directory=$isDirectory})
        }
    } finally { $archive.Dispose() }
    foreach ($left in $items) {
        if ($left.is_directory) { continue }
        foreach ($right in $items) {
            if ($left.path -ieq $right.path) { continue }
            if ($right.path.StartsWith("$($left.path)/",[StringComparison]::OrdinalIgnoreCase)) { throw "HELD: archive file-directory collision at $($left.path)" }
        }
    }
}

function Assert-StructuredLogExtractedTreeSafe {
    param([Parameter(Mandatory)] [string] $DestinationRoot)
    $rootFull = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
    $prefix = $rootFull + [IO.Path]::DirectorySeparatorChar
    $rootItem = Get-Item -LiteralPath $rootFull -Force -ErrorAction Stop
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "HELD: extraction root itself is a reparse point: $rootFull" }
    foreach ($item in @(Get-ChildItem -LiteralPath $rootFull -Recurse -Force -ErrorAction Stop)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "HELD: extracted package contains a reparse point: $($item.FullName)" }
        $full = [IO.Path]::GetFullPath($item.FullName)
        if (-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw "HELD: extracted package path escaped destination: $full" }
    }
}

function Resolve-StructuredLogKitPrerequisites {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)] [ValidateSet('Build', 'VerifiedPackage')] [string] $KitProvisionMode,
        [string] $KitPackagePath = '',
        [string] $KitPackageSha256 = '',
        [scriptblock] $ProcessInvoker = {
            param($filePath, $argumentList, $cwd, $stdoutPath, $stderrPath)
            $process = Start-Process -FilePath $filePath -ArgumentList $argumentList -WorkingDirectory $cwd -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -Wait
            return [int]$process.ExitCode
        },
        [scriptblock] $PackageSnapshotCopier = { param($source,$snapshot) Copy-Item -LiteralPath $source -Destination $snapshot -ErrorAction Stop },
        [scriptblock] $PackageExtractor = {
            param($packagePath, $destination)
            Expand-Archive -LiteralPath $packagePath -DestinationPath $destination -Force
        }
    )
    if ($KitProvisionMode -eq 'Build') {
        $serverRoot = Join-Path $Context.RepoRoot 'bim-streaming-server'
        $repoBat = Join-Path $serverRoot 'repo.bat'
        if (-not (Test-Path -LiteralPath $repoBat -PathType Leaf)) { throw "HELD: branch-local repo.bat is missing: $repoBat" }
        $stdout = Join-Path $Context.AttemptRoot 'kit-build.stdout.log'
        $stderr = Join-Path $Context.AttemptRoot 'kit-build.stderr.log'
        $exitCode = $null
        try {
            $exitCode = & $ProcessInvoker $repoBat @('build') $serverRoot $stdout $stderr
            if ([int]$exitCode -ne 0) { throw "branch-local Kit build failed with exit code $exitCode" }
            Write-StructuredLogProvenance -Context $Context -Phase 'kit_provision' -Command 'repo.bat build' -Cwd $serverRoot -Status 'passed' -ExitCode $exitCode | Out-Null
        } catch {
            Write-StructuredLogProvenance -Context $Context -Phase 'kit_provision' -Command 'repo.bat build' -Cwd $serverRoot -Status 'failed' -ExitCode $exitCode | Out-Null
            throw
        }
    } else {
        if (-not (Test-StructuredLogAbsolutePath $KitPackagePath) -or -not (Test-Path -LiteralPath $KitPackagePath -PathType Leaf)) {
            throw 'VerifiedPackage requires an explicit absolute package path'
        }
        if ($KitPackageSha256 -notmatch '^[0-9A-Fa-f]{64}$') { throw 'VerifiedPackage requires an expected SHA-256'
        }
        $snapshotRoot = Join-Path $Context.AttemptRoot 'kit-package-input'
        New-Item -ItemType Directory -Path $snapshotRoot -Force | Out-Null
        $snapshotPath = Join-Path $snapshotRoot (([guid]::NewGuid().ToString('N')) + '.zip')
        & $PackageSnapshotCopier $KitPackagePath $snapshotPath
        if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) { throw 'HELD: package snapshot was not created' }
        $actualHash = (Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -cne $KitPackageSha256.ToLowerInvariant()) { throw "VerifiedPackage SHA-256 checksum mismatch" }
        $serverRoot = Join-Path $Context.AttemptRoot 'kit-package'
        if (Test-Path -LiteralPath $serverRoot) { throw "HELD: verified package extract root must be fresh: $serverRoot" }
        Assert-StructuredLogSafePackageArchive -PackagePath $snapshotPath -DestinationRoot $serverRoot
        try {
            & $PackageExtractor $snapshotPath $serverRoot
            Assert-StructuredLogExtractedTreeSafe -DestinationRoot $serverRoot
            Write-StructuredLogProvenance -Context $Context -Phase 'kit_provision' -Command 'verified-package extract' -Cwd $serverRoot -Status 'passed' -ExitCode 0 | Out-Null
        } catch {
            Write-StructuredLogProvenance -Context $Context -Phase 'kit_provision' -Command 'verified-package extract' -Cwd $serverRoot -Status 'failed' -ExitCode 1 | Out-Null
            throw
        }
    }

    $paths = if ($KitProvisionMode -eq 'Build') {
        Get-StructuredLogKitAssetPaths -RepoRoot $Context.RepoRoot -BuildDiscovery
    } else {
        Get-StructuredLogKitAssetPaths -RepoRoot $Context.RepoRoot -SearchRoot $serverRoot
    }
    $missing = @(Test-StructuredLogKitAssetPaths -Paths $paths)
    if ($missing.Count -gt 0) { throw "HELD: Kit/HOOPS assets missing after provisioning: $($missing -join ', ')" }
    return [pscustomobject]$paths
}

function New-StructuredLogProcessSpecs {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Context)
    if ($null -eq $Context.Kit) { throw 'Kit prerequisites must be resolved before process specs' }
    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $coordinatorBase = "http://127.0.0.1:$($Context.Ports.Coordinator)"
    $viewerBase = "http://127.0.0.1:$($Context.Ports.Viewer)"
    $conversionBase = "http://127.0.0.1:$($Context.Ports.Conversion)"
    $coordinatorData = Join-Path $Context.AttemptRoot 'coordinator-data'
    $conversionServiceRoot = Join-Path $Context.AttemptRoot 'c'
    $conversionArtifactsRoot = Join-Path $conversionServiceRoot 'a'
    $conversionJobsRoot = Join-Path $conversionServiceRoot 'j'
    $projectedModelPath = [IO.Path]::GetFullPath((Join-Path $conversionArtifactsRoot 'stream_conv_YYYYMMDDHHMMSS_12345678\model.usdc'))
    if ($projectedModelPath.Length -ge 260) {
        throw "HELD: projected OpenUSD model path exceeds the Windows path budget ($($projectedModelPath.Length) >= 260): $projectedModelPath"
    }
    New-Item -ItemType Directory -Path $coordinatorData -Force | Out-Null
    New-Item -ItemType Directory -Path $conversionServiceRoot -Force | Out-Null

    $conversion = [pscustomobject]@{
        name = 'conversion'
        file_path = $pwsh
        argument_list = @('-NoProfile', '-File', (Join-Path $Context.RepoRoot 'bim-streaming-server\scripts\start-host-native-conversion-service.ps1'), '-BindHost', '127.0.0.1', '-PortRaw', [string]$Context.Ports.Conversion, '-PythonExe', $Context.PythonExe)
        cwd = Join-Path $Context.RepoRoot 'bim-streaming-server'
        env = [ordered]@{
            STREAMING_CONVERSION_HOST = '127.0.0.1'
            STREAMING_CONVERSION_PORT = [string]$Context.Ports.Conversion
            STREAMING_CONVERSION_PYTHON = $Context.PythonExe
            STREAMING_CONVERSION_KIT_EXE = [string]$Context.Kit.kit_exe
            STREAMING_CONVERSION_HOOPS_MAIN = [string]$Context.Kit.hoops_main
            STREAMING_CONVERSION_CONFIG_PATH = [string]$Context.Kit.converter_config
            STREAMING_CONVERSION_WRAPPER = [string]$Context.Kit.converter_wrapper
            STREAMING_CONVERSION_SERVICE_ROOT = $conversionServiceRoot
            STREAMING_CONVERSION_ARTIFACTS_ROOT = $conversionArtifactsRoot
            STREAMING_CONVERSION_JOBS_DIR = $conversionJobsRoot
            STORAGE_ROOT = $Context.StorageRoot
            LOG_ROOT = $Context.LogRoot
        }
        port = [int]$Context.Ports.Conversion
        health_uri = "$conversionBase/health"
        stdout_path = Join-Path $Context.AttemptRoot 'conversion.stdout.log'
        stderr_path = Join-Path $Context.AttemptRoot 'conversion.stderr.log'
        viewer_log_endpoint = $null
    }
    $coordinator = [pscustomobject]@{
        name = 'coordinator'
        file_path = $npm
        argument_list = @('run', 'dev')
        cwd = Join-Path $Context.RepoRoot 'bim-review-coordinator'
        env = [ordered]@{
            NODE_ENV = 'development'
            HOST = '127.0.0.1'
            PORT = [string]$Context.Ports.Coordinator
            COORDINATOR_PORT = [string]$Context.Ports.Coordinator
            COORDINATOR_PUBLIC_BASE_URL = $coordinatorBase
            VIEWER_PORT = [string]$Context.Ports.Viewer
            VIEWER_PUBLIC_BASE_URL = $viewerBase
            CORS_ORIGINS = $viewerBase
            STREAMING_CONVERSION_API_BASE = $conversionBase
            STORAGE_ROOT = $Context.StorageRoot
            STORAGE_HOST_ROOT = $Context.StorageRoot
            RUNTIME_STORAGE_ROOT = $Context.StorageRoot
            EDGE_RUNTIME_DATA_ROOT = $coordinatorData
            SESSION_STORE_DIR = Join-Path $coordinatorData 'sessions'
            EVENT_LOG_DIR = Join-Path $coordinatorData 'events'
            CALLBACK_OUTBOX_STORE_PATH = Join-Path $coordinatorData 'callback-outbox.json'
            CONVERSION_LEDGER_STORE_PATH = Join-Path $coordinatorData 'conversion-ledger.json'
            ARTIFACT_HEALTH_LEDGER_STORE_PATH = Join-Path $coordinatorData 'artifact-health-ledger.json'
            LOG_ROOT = $Context.LogRoot
        }
        port = [int]$Context.Ports.Coordinator
        health_uri = "$coordinatorBase/health"
        stdout_path = Join-Path $Context.AttemptRoot 'coordinator.stdout.log'
        stderr_path = Join-Path $Context.AttemptRoot 'coordinator.stderr.log'
        viewer_log_endpoint = $null
    }
    $viewer = [pscustomobject]@{
        name = 'viewer'
        file_path = $npm
        argument_list = @('run', 'dev', '--', '--host', '127.0.0.1', '--port', [string]$Context.Ports.Viewer, '--strictPort')
        cwd = Join-Path $Context.RepoRoot 'web-viewer-sample'
        env = [ordered]@{
            VITE_COORDINATOR_API_BASE = $coordinatorBase
            VITE_ALLOWED_COORDINATOR_ORIGINS = $coordinatorBase
            VIEWER_PORT = [string]$Context.Ports.Viewer
            LOG_ROOT = $Context.LogRoot
        }
        port = [int]$Context.Ports.Viewer
        health_uri = "$viewerBase/"
        stdout_path = Join-Path $Context.AttemptRoot 'viewer.stdout.log'
        stderr_path = Join-Path $Context.AttemptRoot 'viewer.stderr.log'
        viewer_log_endpoint = "$coordinatorBase/api/internal/viewer-log"
    }
    return @($conversion, $coordinator, $viewer)
}

function Set-StructuredLogEnvironment {
    param([Parameter(Mandatory)] $Values)
    $snapshot = [ordered]@{}
    foreach ($key in $Values.Keys) {
        $previous = [Environment]::GetEnvironmentVariable([string]$key, 'Process')
        $snapshot[[string]$key] = [pscustomobject]@{ existed = $null -ne $previous; value = $previous }
        [Environment]::SetEnvironmentVariable([string]$key, [string]$Values[$key], 'Process')
    }
    return $snapshot
}

function Restore-StructuredLogEnvironment {
    param([AllowNull()] $Snapshot)
    if ($null -eq $Snapshot) { return }
    foreach ($key in $Snapshot.Keys) {
        $item = $Snapshot[$key]
        if ($item.existed) {
            [Environment]::SetEnvironmentVariable([string]$key, [string]$item.value, 'Process')
        } else {
            [Environment]::SetEnvironmentVariable([string]$key, $null, 'Process')
            Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
        }
    }
}

function Get-StructuredLogProcessIdentity {
    param([int] $ProcessId)
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    $start = $null
    try { $start = (Get-Process -Id $ProcessId -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o') } catch {
        $start = ([Management.ManagementDateTimeConverter]::ToDateTime($cim.CreationDate)).ToUniversalTime().ToString('o')
    }
    return [pscustomobject]@{
        pid = [int]$cim.ProcessId
        parent_pid = [int]$cim.ParentProcessId
        path = [string]$cim.ExecutablePath
        start_time_utc = $start
    }
}

function Start-StructuredLogOwnedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)] $ProcessSpec,
        [scriptblock] $StartProcessInvoker = {
            param($filePath, $argumentList, $cwd, $stdoutPath, $stderrPath)
            Start-Process -FilePath $filePath -ArgumentList $argumentList -WorkingDirectory $cwd -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
        },
        [scriptblock] $IdentityProvider = ${function:Get-StructuredLogProcessIdentity},
        [scriptblock] $FallbackIdentityProvider = {
            param($ownedHandle)
            $fallbackPath = $null
            $fallbackStart = $null
            try { $fallbackPath = [string]$ownedHandle.Path } catch {}
            if ([string]::IsNullOrWhiteSpace($fallbackPath)) { try { $fallbackPath = [string]$ownedHandle.MainModule.FileName } catch {} }
            try { $fallbackStart = $ownedHandle.StartTime.ToUniversalTime().ToString('o') } catch {}
            [pscustomobject]@{
                pid = [int]$ownedHandle.Id
                parent_pid = $PID
                path = $fallbackPath
                start_time_utc = $fallbackStart
                handle_type = $ownedHandle.GetType().FullName
                has_exited = if ($null -ne $ownedHandle.PSObject.Properties['HasExited']) { [bool]$ownedHandle.HasExited } else { $null }
            }
        },
        [scriptblock] $LeaseWriter = { param($path,$value) Write-StructuredLogJsonAtomic -Path $path -Value $value },
        [scriptblock] $OwnedHandleCleanup = {
            param($ownedHandle)
            Stop-Process -InputObject $ownedHandle -ErrorAction Stop
            try { $ownedHandle.WaitForExit(10000) | Out-Null } catch {}
        }
    )
    foreach ($path in @($ProcessSpec.cwd, (Split-Path -Parent $ProcessSpec.stdout_path), (Split-Path -Parent $ProcessSpec.stderr_path))) {
        if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    }
    $envSnapshot = Set-StructuredLogEnvironment -Values $ProcessSpec.env
    $process = $null
    $identity = $null
    $leaseEntry = $null
    $lease = $null
    $pidfile = Join-Path $Context.AttemptRoot "$($ProcessSpec.name).pid"
    $leaseLock = $null
    try {
        try {
            $process = & $StartProcessInvoker $ProcessSpec.file_path @($ProcessSpec.argument_list) $ProcessSpec.cwd $ProcessSpec.stdout_path $ProcessSpec.stderr_path
        } finally {
            Restore-StructuredLogEnvironment -Snapshot $envSnapshot
        }
        if ($null -eq $process -or [int]$process.Id -le 0) { throw "Start-Process -PassThru did not return a valid PID for $($ProcessSpec.name)" }
        $identity = & $IdentityProvider ([int]$process.Id)
        if ($null -eq $identity -or [string]::IsNullOrWhiteSpace([string]$identity.path) -or [string]::IsNullOrWhiteSpace([string]$identity.start_time_utc)) {
            throw "Unable to persist immediate process identity for $($ProcessSpec.name)"
        }
        $leaseEntry = [ordered]@{
            name = [string]$ProcessSpec.name
            pid = [int]$identity.pid
            parent_pid = [int]$identity.parent_pid
            path = [string]$identity.path
            start_time_utc = [string]$identity.start_time_utc
            cwd = [string]$ProcessSpec.cwd
            argv = @($ProcessSpec.argument_list)
            env_keys = @($ProcessSpec.env.Keys | Sort-Object)
            port = [int]$ProcessSpec.port
            pidfile = $pidfile
        }
        Write-StructuredLogJsonAtomic -Path $pidfile -Value ([string]$identity.pid)
        $lockPath = "$($Context.LeasePath).lock"
        $leaseLock = [IO.FileStream]::new($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $lease = [ordered]@{ schema_version='1'; attempt_id=$Context.AttemptId; processes=@() }
        if (Test-Path -LiteralPath $Context.LeasePath) {
            $existing = Get-Content -Raw -LiteralPath $Context.LeasePath | ConvertFrom-Json
            if ([string]$existing.attempt_id -cne [string]$Context.AttemptId) { throw 'durable lease attempt_id mismatch' }
            $lease.processes = @($existing.processes)
        }
        $lease.processes += @([pscustomobject]$leaseEntry)
        & $LeaseWriter $Context.LeasePath $lease
        $leaseLock.Dispose(); $leaseLock = $null
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
        Write-StructuredLogProvenance -Context $Context -Phase 'start' -Command "$($ProcessSpec.file_path) $($ProcessSpec.argument_list -join ' ')" -Cwd $ProcessSpec.cwd -Status 'started' -ExitCode $null | Out-Null
        return [pscustomobject]$leaseEntry
    } catch {
        $failure = $_
        if ($null -ne $leaseLock) { $leaseLock.Dispose(); $leaseLock = $null }
        Remove-Item -LiteralPath "$($Context.LeasePath).lock" -Force -ErrorAction SilentlyContinue
        $cleanupFailure = $null
        if ($null -ne $process -and [int]$process.Id -gt 0) {
            try { & $OwnedHandleCleanup $process } catch { $cleanupFailure = $_ }
            if ($null -eq $cleanupFailure -and $null -ne $process.PSObject.Properties['HasExited'] -and -not [bool]$process.HasExited) {
                $cleanupFailure = [System.Management.Automation.ErrorRecord]::new(
                    [InvalidOperationException]::new("owned process PID $($process.Id) is still running after cleanup"),
                    'StructuredLogOwnedProcessStillRunning',
                    [System.Management.Automation.ErrorCategory]::ResourceBusy,
                    $process
                )
            }
        }
        if ($null -ne $cleanupFailure) {
            $fallbackIdentity = $null
            $fallbackIdentityFailure = $null
            if ($null -eq $leaseEntry -and $null -ne $process) {
                try { $fallbackIdentity = & $FallbackIdentityProvider $process } catch { $fallbackIdentityFailure = $_ }
                if ($null -ne $fallbackIdentity -and [int]$fallbackIdentity.pid -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$fallbackIdentity.path) -and -not [string]::IsNullOrWhiteSpace([string]$fallbackIdentity.start_time_utc)) {
                    $identity = $fallbackIdentity
                }
            }
            if ($null -eq $leaseEntry -and $null -ne $identity -and -not [string]::IsNullOrWhiteSpace([string]$identity.path) -and -not [string]::IsNullOrWhiteSpace([string]$identity.start_time_utc)) {
                $leaseEntry = [ordered]@{name=[string]$ProcessSpec.name;pid=[int]$identity.pid;parent_pid=[int]$identity.parent_pid;path=[string]$identity.path;start_time_utc=[string]$identity.start_time_utc;cwd=[string]$ProcessSpec.cwd;argv=@($ProcessSpec.argument_list);env_keys=@($ProcessSpec.env.Keys|Sort-Object);port=[int]$ProcessSpec.port;pidfile=$pidfile}
            }
            $evidencePid = if ($null -ne $process) { [int]$process.Id } elseif ($null -ne $fallbackIdentity) { [int]$fallbackIdentity.pid } else { 0 }
            if ($evidencePid -gt 0) { Write-StructuredLogJsonAtomic -Path $pidfile -Value ([string]$evidencePid) }
            $quarantinePath = Join-Path $Context.AttemptRoot 'cleanup-quarantine.json'
            $quarantineStatus = if ($null -ne $leaseEntry) { 'cleanup_failed' } else { 'cleanup_failed_identity_unavailable' }
            $handleEvidence = [ordered]@{
                handle_type = if ($null -ne $fallbackIdentity -and $null -ne $fallbackIdentity.PSObject.Properties['handle_type']) { [string]$fallbackIdentity.handle_type } elseif ($null -ne $process) { $process.GetType().FullName } else { $null }
                has_exited = if ($null -ne $fallbackIdentity -and $null -ne $fallbackIdentity.PSObject.Properties['has_exited']) { $fallbackIdentity.has_exited } elseif ($null -ne $process -and $null -ne $process.PSObject.Properties['HasExited']) { [bool]$process.HasExited } else { $null }
                path = if ($null -ne $fallbackIdentity) { [string]$fallbackIdentity.path } else { $null }
                start_time_utc = if ($null -ne $fallbackIdentity) { [string]$fallbackIdentity.start_time_utc } else { $null }
            }
            $quarantineEntry = [ordered]@{
                name = [string]$ProcessSpec.name
                pid = $evidencePid
                port = [int]$ProcessSpec.port
                path = if ($null -ne $leaseEntry) { [string]$leaseEntry.path } else { [string]$handleEvidence.path }
                start_time_utc = if ($null -ne $leaseEntry) { [string]$leaseEntry.start_time_utc } else { [string]$handleEvidence.start_time_utc }
                handle_evidence = $handleEvidence
                primary_error = [string]$failure.Exception.Message
                cleanup_error = [string]$cleanupFailure.Exception.Message
                fallback_identity_error = if ($null -ne $fallbackIdentityFailure) { [string]$fallbackIdentityFailure.Exception.Message } else { $null }
                recorded_utc = [DateTimeOffset]::UtcNow.ToString('o')
            }
            if ($null -ne $leaseEntry) {
                if ($null -eq $lease) { $lease = [ordered]@{schema_version='1';attempt_id=$Context.AttemptId;processes=@()} }
                if (@($lease.processes | Where-Object { [int]$_.pid -eq [int]$leaseEntry.pid }).Count -eq 0) { $lease.processes += @([pscustomobject]$leaseEntry) }
                Write-StructuredLogJsonAtomic -Path $Context.LeasePath -Value $lease
            }
            $quarantine = [ordered]@{schema_version='1';attempt_id=$Context.AttemptId;status=$quarantineStatus;entries=@([pscustomobject]$quarantineEntry)}
            Write-StructuredLogJsonAtomic -Path $quarantinePath -Value $quarantine
            Write-StructuredLogProvenance -Context $Context -Phase 'start' -Command "$($ProcessSpec.file_path) $($ProcessSpec.argument_list -join ' ')" -Cwd $ProcessSpec.cwd -Status 'failed' -ExitCode $null | Out-Null
            $identitySuffix = if ($quarantineStatus -eq 'cleanup_failed_identity_unavailable') { '; fallback identity unavailable' } else { '' }
            throw [InvalidOperationException]::new("$($failure.Exception.Message); cleanup failed: $($cleanupFailure.Exception.Message)$identitySuffix", $failure.Exception)
        }
        Remove-Item -LiteralPath $pidfile -Force -ErrorAction SilentlyContinue
        Write-StructuredLogProvenance -Context $Context -Phase 'start' -Command "$($ProcessSpec.file_path) $($ProcessSpec.argument_list -join ' ')" -Cwd $ProcessSpec.cwd -Status 'failed' -ExitCode $null | Out-Null
        throw $failure
    }
}

function Wait-StructuredLogHealth {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Context,
        [Parameter(Mandatory)] [object[]] $ProcessSpecs,
        [scriptblock] $RequestInvoker = { param($uri) Invoke-WebRequest -Uri $uri -Method Get -TimeoutSec 5 },
        [ValidateRange(1, 600)] [int] $TimeoutSeconds = 90
    )
    $probes = [System.Collections.Generic.List[object]]::new()
    foreach ($spec in $ProcessSpecs) {
        $started = [DateTimeOffset]::UtcNow
        $deadline = $started.AddSeconds($TimeoutSeconds)
        $status = 'failed'
        $httpStatus = $null
        $errorType = $null
        do {
            try {
                $response = & $RequestInvoker ([string]$spec.health_uri)
                $httpStatus = [int]$response.StatusCode
                if ($httpStatus -ge 200 -and $httpStatus -lt 400) { $status = 'passed'; break }
            } catch {
                $errorType = $_.Exception.GetType().FullName
            }
            if ([DateTimeOffset]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
        } while ([DateTimeOffset]::UtcNow -lt $deadline)
        $ended = [DateTimeOffset]::UtcNow
        $probes.Add([pscustomobject][ordered]@{
            name = [string]$spec.name
            uri = [string]$spec.health_uri
            started_utc = $started.ToString('o')
            ended_utc = $ended.ToString('o')
            status = $status
            http_status = $httpStatus
            error_type = $errorType
        })
        Write-StructuredLogProvenance -Context $Context -Phase 'health_probe' -Command "GET $([string]$spec.health_uri)" -Cwd $Context.RepoRoot -Status $status -ExitCode $httpStatus -StartedUtc $started.ToString('o') -EndedUtc $ended.ToString('o') | Out-Null
    }
    $health = [pscustomobject][ordered]@{ schema_version='1'; probes=@($probes) }
    Write-StructuredLogJson -Path (Join-Path $Context.AttemptRoot 'health.json') -Value $health
    $failed = @($probes | Where-Object status -ne 'passed')
    if ($failed.Count -gt 0) { throw "HELD: health probes failed: $(($failed.name) -join ', ')" }
    return $health
}

function Invoke-StructuredLogSupportedSmoke {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Context,
        [ValidateRange(1, 3600)] [int] $LivePollSeconds = 180,
        [scriptblock] $SmokeInvoker = {
            param($scriptPath, $arguments)
            $smokeOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $scriptPath @arguments 2>&1)
            $exitCode = [int]$LASTEXITCODE
            foreach ($line in $smokeOutput) { Write-Host "[supported-smoke] $line" }
            return $exitCode
        }
    )
    $scriptPath = Join-Path $Context.RepoRoot 'scripts\smoke-bscheme-intake.ps1'
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "supported smoke runner missing: $scriptPath" }
    $evidencePath = Join-Path $Context.AttemptRoot 'bscheme-readiness.json'
    $browserDir = Join-Path $Context.AttemptRoot 'browser'
    New-Item -ItemType Directory -Path $browserDir -Force | Out-Null
    $arguments = @(
        '-EvidencePath', $evidencePath,
        '-StorageRoot', $Context.StorageRoot,
        '-CoordinatorBaseUrl', "http://127.0.0.1:$($Context.Ports.Coordinator)",
        '-StreamingConversionApiBase', "http://127.0.0.1:$($Context.Ports.Conversion)",
        '-LivePollSeconds', [string]$LivePollSeconds,
        '-StructLogRoot', $Context.LogRoot,
        '-BrowserArtifactDir', $browserDir,
        '-ExecutionProfile', 'owned_runtime',
        '-SkipVerificationTiers',
        '-SkipKitLauncher'
    )
    $snapshot = Set-StructuredLogEnvironment -Values ([ordered]@{ LOG_ROOT=$Context.LogRoot })
    $exitCode = $null
    try {
        $exitCode = & $SmokeInvoker $scriptPath $arguments
        if ([int]$exitCode -ne 0) { throw "supported smoke exited with code $exitCode" }
        if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) { throw 'supported smoke did not produce bscheme-readiness.json' }
        try {
            $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json -ErrorAction Stop
        } catch {
            throw "supported smoke evidence is not valid JSON: $($_.Exception.Message)"
        }

        $readiness = Test-StructuredLogReadinessEvidence -Evidence $evidence
        if (-not $readiness.valid) {
            throw "supported smoke evidence is invalid: $($readiness.errors -join ',')"
        }
        Write-StructuredLogProvenance -Context $Context -Phase 'supported_smoke' -Command 'scripts/smoke-bscheme-intake.ps1 (supported)' -Cwd $Context.RepoRoot -Status 'passed' -ExitCode $exitCode | Out-Null
    } catch {
        Write-StructuredLogProvenance -Context $Context -Phase 'supported_smoke' -Command 'scripts/smoke-bscheme-intake.ps1 (supported)' -Cwd $Context.RepoRoot -Status 'failed' -ExitCode $exitCode | Out-Null
        throw
    } finally {
        Restore-StructuredLogEnvironment -Snapshot $snapshot
    }
    return [pscustomobject]@{ exit_code=[int]$exitCode; evidence_path=$evidencePath }
}

function Get-StructuredLogProcessInventory {
    $items = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    return @($items | ForEach-Object {
        $start = $null
        try { $start = (Get-Process -Id ([int]$_.ProcessId) -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o') } catch {}
        [pscustomobject]@{ pid=[int]$_.ProcessId; parent_pid=[int]$_.ParentProcessId; path=[string]$_.ExecutablePath; start_time_utc=$start }
    })
}

function Test-StructuredLogIdentityMatch {
    param($Expected, $Actual)
    if ($null -eq $Actual) { return $false }
    $pathMatch = [string]$Expected.path -ieq [string]$Actual.path
    try {
        $expectedStart = if ($Expected.start_time_utc -is [DateTime]) { ([DateTime]$Expected.start_time_utc).ToUniversalTime() } else { [DateTimeOffset]::Parse([string]$Expected.start_time_utc).UtcDateTime }
        $actualStart = if ($Actual.start_time_utc -is [DateTime]) { ([DateTime]$Actual.start_time_utc).ToUniversalTime() } else { [DateTimeOffset]::Parse([string]$Actual.start_time_utc).UtcDateTime }
        $timeMatch = $expectedStart -eq $actualStart
    } catch { $timeMatch = $false }
    return [int]$Expected.pid -eq [int]$Actual.pid -and $pathMatch -and $timeMatch
}

function Stop-StructuredLogOwnedProcesses {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Context,
        [scriptblock] $ProcessInventoryProvider = ${function:Get-StructuredLogProcessInventory},
        [scriptblock] $StopProcessInvoker = {
            param($processId)
            $handle = Get-Process -Id $processId -ErrorAction Stop
            Stop-Process -InputObject $handle -ErrorAction Stop
            $handle.WaitForExit(10000) | Out-Null
        },
        [scriptblock] $ListenerInspector = ${function:Get-StructuredLogPortListeners}
    )
    $leaseProcesses = @()
    if (Test-Path -LiteralPath $Context.LeasePath) {
        try { $leaseProcesses = @((Get-Content -Raw -LiteralPath $Context.LeasePath | ConvertFrom-Json).processes) } catch {}
    }
    $entries = [System.Collections.Generic.List[object]]::new()
    $inventory = @(& $ProcessInventoryProvider)
    foreach ($leaseEntry in @($leaseProcesses | Sort-Object -Property pid -Descending)) {
        $current = $inventory | Where-Object { [int]$_.pid -eq [int]$leaseEntry.pid } | Select-Object -First 1
        $match = Test-StructuredLogIdentityMatch -Expected $leaseEntry -Actual $current
        if (-not $match) {
            $entries.Add([pscustomobject][ordered]@{ pid=[int]$leaseEntry.pid;path=[string]$leaseEntry.path;start_time_utc=[string]$leaseEntry.start_time_utc;identity_match=$false;action='none';result=if($null -eq $current){'not_running'}else{'identity_mismatch'} })
            continue
        }
        $tree = [System.Collections.Generic.List[object]]::new()
        $tree.Add($current)
        do {
            $added = $false
            foreach ($candidate in $inventory) {
                if ($tree.pid -contains [int]$candidate.pid) { continue }
                if ($tree.pid -contains [int]$candidate.parent_pid) { $tree.Add($candidate); $added = $true }
            }
        } while ($added)

        $orderedTree = @($tree | ForEach-Object {
            $depth=0;$cursor=$_
            while([int]$cursor.pid -ne [int]$leaseEntry.pid) {
                $parent = $inventory | Where-Object { [int]$_.pid -eq [int]$cursor.parent_pid } | Select-Object -First 1
                if($null -eq $parent){break};$depth++;$cursor=$parent
            }
            [pscustomobject]@{item=$_;depth=$depth}
        } | Sort-Object -Property depth -Descending)
        foreach ($node in $orderedTree) {
            $fresh = @(& $ProcessInventoryProvider) | Where-Object { [int]$_.pid -eq [int]$node.item.pid } | Select-Object -First 1
            $nodeMatch = Test-StructuredLogIdentityMatch -Expected $node.item -Actual $fresh
            if (-not $nodeMatch) {
                $result = if ($null -eq $fresh) { 'not_running' } else { 'identity_changed' }
                $entries.Add([pscustomobject][ordered]@{pid=[int]$node.item.pid;path=[string]$node.item.path;start_time_utc=[string]$node.item.start_time_utc;identity_match=$false;action='none';result=$result})
                continue
            }
            try {
                & $StopProcessInvoker ([int]$node.item.pid)
                $entries.Add([pscustomobject][ordered]@{pid=[int]$node.item.pid;path=[string]$node.item.path;start_time_utc=[string]$node.item.start_time_utc;identity_match=$true;action='stop_owned';result='stopped'})
            } catch {
                $entries.Add([pscustomobject][ordered]@{pid=[int]$node.item.pid;path=[string]$node.item.path;start_time_utc=[string]$node.item.start_time_utc;identity_match=$true;action='stop_owned';result='failed';error_type=$_.Exception.GetType().FullName})
            }
        }
    }
    $foreign = [System.Collections.Generic.List[object]]::new()
    foreach ($port in @($Context.Ports.Values)) {
        foreach ($listener in @(& $ListenerInspector ([int]$port))) {
            $foreign.Add([pscustomobject]@{port=[int]$port;pid=[int]$listener.pid;path=[string]$listener.path;action='reported_only'})
        }
    }
    $entryArray = @($entries | ForEach-Object { $_ })
    $foreignArray = @($foreign | ForEach-Object { $_ })
    $shutdownStatus = if (@($entryArray | Where-Object result -in @('failed','identity_mismatch','identity_changed')).Count -eq 0) { 'succeeded' } else { 'failed' }
    $shutdown = [pscustomobject][ordered]@{schema_version='1';attempt_id=$Context.AttemptId;status=$shutdownStatus;entries=$entryArray;foreign_listeners=$foreignArray}
    Write-StructuredLogJson -Path (Join-Path $Context.AttemptRoot 'shutdown.json') -Value $shutdown
    return $shutdown
}

function Find-StructuredLogNamedValues {
    param($Value, [string] $NamePattern)
    $found = [System.Collections.Generic.List[object]]::new()
    function Visit-StructuredLogValue {
        param($Node)
        if ($null -eq $Node -or $Node -is [string] -or $Node -is [ValueType]) { return }
        if ($Node -is [System.Collections.IDictionary]) {
            foreach ($key in $Node.Keys) {
                if ([string]$key -match $NamePattern) { $found.Add($Node[$key]) }
                Visit-StructuredLogValue $Node[$key]
            }
            return
        }
        if ($Node -is [System.Collections.IEnumerable]) {
            foreach ($item in $Node) { Visit-StructuredLogValue $item }
            return
        }
        foreach ($property in $Node.PSObject.Properties) {
            if ($property.Name -match $NamePattern) { $found.Add($property.Value) }
            Visit-StructuredLogValue $property.Value
        }
    }
    Visit-StructuredLogValue $Value
    return @($found | ForEach-Object { $_ })
}

function Test-StructuredLogReadinessEvidence {
    [CmdletBinding()]
    param([Parameter(Mandatory)] $Evidence)

    $errors = [System.Collections.Generic.List[string]]::new()
    function Get-ReadinessPathValue {
        param($Object, [string[]] $Path)
        $current = $Object
        foreach ($name in $Path) {
            if ($null -eq $current) { return $null }
            if ($current -is [System.Collections.IDictionary]) {
                if (-not $current.Contains($name)) { return $null }
                $current = $current[$name]
                continue
            }
            $property = $current.PSObject.Properties[$name]
            if ($null -eq $property) { return $null }
            $current = $property.Value
        }
        return $current
    }

    if ([string](Get-ReadinessPathValue $Evidence @('schema_version')) -cne 'demo-runtime-readiness-smoke/v1') {
        $errors.Add('readiness:schema-version')
    }
    $tiersValue = Get-ReadinessPathValue $Evidence @('tiers')
    $tiers = if ($null -eq $tiersValue) { @() } else { @($tiersValue) }
    $liveTiers = @($tiers | Where-Object { [string](Get-ReadinessPathValue $_ @('tier')) -ceq 'real_ifc_intake_conversion' })
    if ($liveTiers.Count -ne 1) { $errors.Add('readiness:live-tier-count') }
    $liveTier = if ($liveTiers.Count -eq 1) { $liveTiers[0] } else { $null }

    $rootTraceId = [string](Get-ReadinessPathValue $liveTier @('detail','root_trace_id'))
    $ifcReadyJobId = [string](Get-ReadinessPathValue $liveTier @('ids','ifc_ready_job_id'))
    $conversionJobId = [string](Get-ReadinessPathValue $liveTier @('ids','conversion_job_id'))
    $reviewSessionId = [string](Get-ReadinessPathValue $liveTier @('detail','review_session_id'))
    $kitInstanceId = [string](Get-ReadinessPathValue $liveTier @('ids','kit_instance_id'))
    $browserArtifacts = Get-ReadinessPathValue $liveTier @('detail','browser_artifacts')
    $expectedBrowserStates = @('ready','flush_loading','flush_failure','retry_loading','flush_success','close_loading','closed')
    if ($null -ne $liveTier) {
        if ([string](Get-ReadinessPathValue $liveTier @('status')) -cne 'passed') { $errors.Add('readiness:live-tier-status') }
        if ([string](Get-ReadinessPathValue $Evidence @('context','execution_mode')) -cne 'production') { $errors.Add('readiness:context-execution-mode') }
        if ([string](Get-ReadinessPathValue $liveTier @('detail','execution_mode')) -cne 'production') { $errors.Add('readiness:tier-execution-mode') }
        if ($rootTraceId -cnotmatch '^ifcready_[A-Za-z0-9_.-]+$') { $errors.Add('readiness:root-trace-id') }
        if ([string]::IsNullOrWhiteSpace($ifcReadyJobId) -or $rootTraceId -cne $ifcReadyJobId) { $errors.Add('readiness:ifc-ready-job-id') }
        if ([string]::IsNullOrWhiteSpace($conversionJobId)) { $errors.Add('readiness:conversion-job-id') }
        if ([string]::IsNullOrWhiteSpace($reviewSessionId)) { $errors.Add('readiness:review-session-id') }
        if ([string]::IsNullOrWhiteSpace($kitInstanceId)) { $errors.Add('readiness:kit-instance-id') }
        if ([string](Get-ReadinessPathValue $liveTier @('detail','browser_status')) -cne 'passed') { $errors.Add('readiness:browser-status') }
        if ([string](Get-ReadinessPathValue $liveTier @('detail','close_status')) -cne 'closed') { $errors.Add('readiness:close-status') }
        if ([string](Get-ReadinessPathValue $liveTier @('detail','close_origin')) -cne 'browser') { $errors.Add('readiness:close-origin') }
        if ([string](Get-ReadinessPathValue $browserArtifacts @('root_trace_id')) -cne $rootTraceId) { $errors.Add('readiness:browser-root-trace-id') }
        if ([string](Get-ReadinessPathValue $browserArtifacts @('review_session_id')) -cne $reviewSessionId) { $errors.Add('readiness:browser-review-session-id') }
        if ([string](Get-ReadinessPathValue $browserArtifacts @('conversion_job_id')) -cne $conversionJobId) { $errors.Add('readiness:browser-conversion-job-id') }
        if ([string](Get-ReadinessPathValue $browserArtifacts @('kit_instance_id')) -cne $kitInstanceId) { $errors.Add('readiness:browser-kit-instance-id') }
        $states = @((Get-ReadinessPathValue $browserArtifacts @('state_transitions')) | ForEach-Object {[string]$_})
        if (($states -join ',') -cne ($expectedBrowserStates -join ',')) { $errors.Add('readiness:browser-state-transitions') }
        if ([string](Get-ReadinessPathValue $browserArtifacts @('failure_provenance')) -cne 'playwright_intercepted_503') { $errors.Add('readiness:browser-failure-provenance') }
        $forcedStatuses = @((Get-ReadinessPathValue $browserArtifacts @('forced_viewer_log_statuses')) | ForEach-Object {[int]$_})
        if ($forcedStatuses.Count -ne 3 -or @($forcedStatuses | Where-Object { $_ -ne 503 }).Count -ne 0) { $errors.Add('readiness:browser-forced-statuses') }
        $retryStatus = [int](Get-ReadinessPathValue $browserArtifacts @('retry_viewer_log_status'))
        if ($retryStatus -lt 200 -or $retryStatus -ge 300) { $errors.Add('readiness:browser-retry-status') }
        $closeHttpStatus = [int](Get-ReadinessPathValue $browserArtifacts @('close_http_status'))
        if ($closeHttpStatus -lt 200 -or $closeHttpStatus -ge 300) { $errors.Add('readiness:browser-close-http-status') }
        $artifactPaths = [ordered]@{
            failure_screenshot = 'browser/structured-log-failure.png'
            final_screenshot = 'browser/structured-log-success-closed.png'
            playwright_trace = 'browser/structured-log-trace.zip'
            console_events = 'browser/structured-log-console.json'
            network_events = 'browser/structured-log-network.json'
            operability = 'browser/structured-log-operability.json'
        }
        foreach ($artifact in $artifactPaths.GetEnumerator()) {
            if ([string](Get-ReadinessPathValue $browserArtifacts @('artifacts',$artifact.Key,'path')) -cne $artifact.Value) {
                $errors.Add("readiness:browser-artifact-$($artifact.Key)")
            }
        }
    }

    foreach ($propertyName in @('root_trace_id','ifc_ready_job_id','conversion_job_id','review_session_id','kit_instance_id')) {
        $distinct = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        foreach ($value in @(Find-StructuredLogNamedValues -Value $Evidence -NamePattern "^$propertyName$")) {
            if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $distinct.Add([string]$value) | Out-Null }
        }
        if ($distinct.Count -ne 1) { $errors.Add("readiness:ambiguous-$propertyName") }
    }

    return [pscustomobject][ordered]@{
        valid = $errors.Count -eq 0
        errors = @($errors | ForEach-Object { $_ })
        live_tier = $liveTier
        root_trace_id = $rootTraceId
        runtime_ids = [ordered]@{
            ifc_ready_job_id = $ifcReadyJobId
            conversion_job_id = $conversionJobId
            review_session_id = $reviewSessionId
            kit_instance_id = $kitInstanceId
        }
    }
}

function Get-StructuredLogRequiredArtifactNames {
    return @(
        'attempt-manifest.json',
        'runtime-lease.json',
        'command-provenance.jsonl',
        'machine.json',
        'fixture.json',
        'health.json',
        'bscheme-readiness.json',
        'root-trace-timeline.json',
        'runtime-log-validation.json',
        'shutdown.json',
        'pr-fields.json',
        'evidence-summary.md',
        'browser/structured-log-failure.png',
        'browser/structured-log-success-closed.png',
        'browser/structured-log-trace.zip',
        'browser/structured-log-console.json',
        'browser/structured-log-network.json',
        'browser/structured-log-operability.json'
    )
}

function Test-StructuredLogTraceValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Value,
        [switch] $AllowUrlProperty
    )

    $errors = [System.Collections.Generic.List[string]]::new()
    function Visit-StructuredLogTraceValue {
        param($Node, [string] $PropertyName = '', [int] $Depth = 0)
        if ($Depth -gt 100) {
            $errors.Add('depth')
            return
        }
        if ($null -eq $Node -or $Node -is [ValueType]) { return }
        if ($Node -is [string]) {
            if ($Node.Contains([char]0) -or
                $Node -match '(?i)bearer\s+|(?:access[_-]?token|api[_-]?key|password|secret|authorization|cookie)\s*[:=]' -or
                $Node -match '(?i)^[A-Za-z]:[\\/]' -or $Node -match '(?i)^file:' -or $Node -match '^\\\\') {
                $errors.Add('unsafe-string')
            }
            if ($Node -match '(?i)https?://' -and (-not $AllowUrlProperty -or $PropertyName -cne 'url')) {
                $errors.Add('unscoped-url')
            }
            return
        }
        if ($Node -is [System.Collections.IDictionary]) {
            foreach ($key in $Node.Keys) {
                $name = [string]$key
                if ($name -match '(?i)header|cookie|authorization|token|secret|password|credential|query|body|postdata') {
                    $errors.Add("forbidden-key:$name")
                }
                Visit-StructuredLogTraceValue -Node $Node[$key] -PropertyName $name -Depth ($Depth + 1)
            }
            return
        }
        if ($Node -is [System.Collections.IEnumerable]) {
            foreach ($item in $Node) { Visit-StructuredLogTraceValue -Node $item -PropertyName $PropertyName -Depth ($Depth + 1) }
            return
        }
        foreach ($property in $Node.PSObject.Properties) {
            if ($property.Name -match '(?i)header|cookie|authorization|token|secret|password|credential|query|body|postdata') {
                $errors.Add("forbidden-key:$($property.Name)")
            }
            Visit-StructuredLogTraceValue -Node $property.Value -PropertyName $property.Name -Depth ($Depth + 1)
        }
    }

    Visit-StructuredLogTraceValue -Node $Value
    return @($errors | ForEach-Object { $_ })
}

function Test-StructuredLogPlaywrightTrace {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $ExpectedTraceId,
        [Parameter(Mandatory)] [string] $ExpectedSessionId,
        [Parameter(Mandatory)] [int] $ExpectedCoordinatorPort
    )
    $errors = [System.Collections.Generic.List[string]]::new()
    if ($ExpectedTraceId -cnotmatch '^(?:ifcready_|rev_|stream_conv_|script_)[A-Za-z0-9_-]+$') { $errors.Add('expected-trace-id') }
    if ($ExpectedSessionId -cnotmatch '^(?:lwv_|review_session_)[A-Za-z0-9_]+$') { $errors.Add('expected-session-id') }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $errors.Add('missing')
        return [pscustomobject]@{valid=$false;errors=@($errors)}
    }
    $traceFile = Get-Item -LiteralPath $Path -Force
    if ($traceFile.Length -le 0 -or $traceFile.Length -gt 32MB -or ($traceFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        $errors.Add('archive-size-or-type')
        return [pscustomobject]@{valid=$false;errors=@($errors)}
    }

    Add-Type -AssemblyName System.IO.Compression
    $stream = $null
    $archive = $null
    try {
        $stream = [IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        $archive = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$false)
        $entries = @($archive.Entries)
        if ($entries.Count -ne 3) { $errors.Add('entry-count') }
        $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $byName = @{}
        [int64]$totalLength = 0
        foreach ($entry in $entries) {
            $name = [string]$entry.FullName
            if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains('\') -or $name.StartsWith('/') -or $name.Contains(':') -or
                @($name.Split('/') | Where-Object { [string]::IsNullOrWhiteSpace($_) -or $_ -in @('.','..') }).Count -gt 0 -or -not $seen.Add($name)) {
                $errors.Add('entry-path')
                continue
            }
            $attributes = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.ExternalAttributes),0)
            $mode = (($attributes -shr 16) -band 0xf000)
            if ($mode -eq 0xa000) { $errors.Add("entry-symlink:$name") }
            if ($entry.Length -lt 0 -or $entry.Length -gt 5MB -or ($entry.CompressedLength -eq 0 -and $entry.Length -ne 0) -or
                $entry.Length -gt ([Math]::Max([int64]1,[int64]$entry.CompressedLength) * 50)) {
                $errors.Add("entry-size:$name")
            }
            $totalLength += [int64]$entry.Length
            if ($totalLength -gt 32MB) { $errors.Add('expanded-size') }
            $byName[$name] = $entry
            if ($name -in @('trace.trace','trace.network','trace.stacks')) { continue }
            $errors.Add("entry-allowlist:$name")
        }
        foreach ($required in @('trace.trace','trace.network','trace.stacks')) {
            if (-not $byName.ContainsKey($required)) { $errors.Add("missing-entry:$required") }
        }
        if ($byName.ContainsKey('trace.network') -and [int64]$byName['trace.network'].Length -ne 0) { $errors.Add('network-not-empty') }

        if ($byName.ContainsKey('trace.trace')) {
            $reader = [IO.StreamReader]::new($byName['trace.trace'].Open())
            [int]$lineCount = 0
            [int]$beforeCount = 0
            [int]$afterCount = 0
            [int]$urlCount = 0
            try {
                while (($line = $reader.ReadLine()) -ne $null) {
                    if ([string]::IsNullOrWhiteSpace($line)) { continue }
                    $lineCount++
                    if ($lineCount -gt 5000) { $errors.Add('trace-line-count'); break }
                    if ($line -match '"[^"\\]*(?:header|cookie|authorization|token|secret|password|credential|query|body|postdata)[^"\\]*"\s*:' -or
                        $line -match '(?i)bearer\s+|(?:access[_-]?token|api[_-]?key|password|secret|authorization|cookie)\s*[:=]' -or
                        $line -match '(?i)file:|"[A-Za-z]:[\\/]') {
                        $errors.Add('trace-forbidden-data')
                        continue
                    }
                    try { $event = $line | ConvertFrom-Json -Depth 100 } catch { $errors.Add('trace-json'); continue }
                    $typeProperty = $event.PSObject.Properties['type']
                    if ($null -eq $typeProperty -or [string]$typeProperty.Value -cnotin @('context-options','before','after','input')) {
                        $errors.Add('trace-event-type')
                        continue
                    }
                    foreach ($privacyError in @(Test-StructuredLogTraceValue -Value $event -AllowUrlProperty)) {
                        $errors.Add("trace-value:$privacyError")
                    }
                    if ([string]$typeProperty.Value -ceq 'before') { $beforeCount++ }
                    if ([string]$typeProperty.Value -ceq 'after') { $afterCount++ }
                    $urls = @(Find-StructuredLogNamedValues -Value $event -NamePattern '^url$')
                    foreach ($urlValue in $urls) {
                        $urlCount++
                        try { $uri = [Uri]::new([string]$urlValue,[UriKind]::Absolute) } catch { $errors.Add('trace-url'); continue }
                        if ($uri.Scheme -cne 'http' -or $uri.Host -cne '127.0.0.1' -or $uri.Port -ne $ExpectedCoordinatorPort -or
                            -not [string]::IsNullOrWhiteSpace($uri.UserInfo) -or $uri.AbsolutePath -cne '/ui/open' -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
                            $errors.Add('trace-url')
                            continue
                        }
                        $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
                        if (@($query.AllKeys).Count -ne 2 -or @($query.AllKeys | Where-Object { $_ -cnotin @('session','trace_id') }).Count -ne 0 -or
                            @($query.GetValues('session')).Count -ne 1 -or [string]$query.GetValues('session')[0] -cne $ExpectedSessionId -or
                            @($query.GetValues('trace_id')).Count -ne 1 -or [string]$query.GetValues('trace_id')[0] -cne $ExpectedTraceId) {
                            $errors.Add('trace-url-query')
                        }
                    }
                    $withoutAllowedUrls = [regex]::Replace($line, '"url"\s*:\s*"https?://[^"\\]*"', '"url":"<allowed>"')
                    if ($withoutAllowedUrls -match 'https?://') { $errors.Add('trace-unscoped-url') }
                }
            } finally { $reader.Dispose() }
            if ($lineCount -eq 0 -or $beforeCount -eq 0 -or $afterCount -eq 0 -or $urlCount -eq 0) { $errors.Add('trace-actions') }
        }

        if ($byName.ContainsKey('trace.stacks')) {
            $reader = [IO.StreamReader]::new($byName['trace.stacks'].Open())
            try { $stackRaw = $reader.ReadToEnd() } finally { $reader.Dispose() }
            if ($stackRaw.Length -le 0 -or $stackRaw.Length -gt 1MB -or $stackRaw -match '(?i)https?://|file:|"[A-Za-z]:[\\/]|bearer\s+|(?:access[_-]?token|api[_-]?key|password|secret|authorization|cookie)\s*[:=]') {
                $errors.Add('trace-stacks-data')
            } else {
                try { $stacks = $stackRaw | ConvertFrom-Json -Depth 100 } catch { $errors.Add('trace-stacks-json'); $stacks = $null }
                if ($null -ne $stacks) {
                    foreach ($privacyError in @(Test-StructuredLogTraceValue -Value $stacks)) {
                        $errors.Add("trace-stacks-value:$privacyError")
                    }
                    if ($null -eq $stacks.PSObject.Properties['files'] -or $null -eq $stacks.PSObject.Properties['stacks']) {
                        $errors.Add('trace-stacks-shape')
                    } else {
                        $files = @($stacks.files)
                        if ($files.Count -gt 64 -or @($files | Where-Object { [string]$_ -cnotmatch '^playwright-helper-[0-9]+\.mjs$' }).Count -gt 0) {
                            $errors.Add('trace-stacks-files')
                        }
                    }
                }
            }
        }
    } catch {
        $errors.Add('archive-read')
    } finally {
        if ($null -ne $archive) { $archive.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
    return [pscustomobject]@{valid=$errors.Count -eq 0;errors=@($errors | ForEach-Object {$_})}
}

function Test-StructuredLogArtifactManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $AttemptRoot)
    $manifestPath = Join-Path $AttemptRoot 'artifact-manifest.json'
    $errors = [System.Collections.Generic.List[string]]::new()
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        return [pscustomobject]@{valid=$false;errors=@('missing artifact-manifest.json')}
    }
    try { $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json } catch {
        return [pscustomobject]@{valid=$false;errors=@('invalid artifact-manifest.json')}
    }
    foreach ($field in @('schema_version','attempt_id','status','files','root_trace_id','shutdown_status','known_gaps')) {
        if ($null -eq $manifest.PSObject.Properties[$field]) { $errors.Add("missing-field:$field") }
    }
    if ($errors.Count -gt 0) {
        return [pscustomobject]@{valid=$false;errors=@($errors);attempt_id=$manifest.attempt_id}
    }
    if ([string]$manifest.schema_version -cne '1') { $errors.Add('schema_version') }
    if ([string]$manifest.status -cne 'succeeded') { $errors.Add('status') }
    $expectedAttemptId = Split-Path -Leaf ([System.IO.Path]::GetFullPath($AttemptRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
    if ([string]::IsNullOrWhiteSpace([string]$manifest.attempt_id) -or [string]$manifest.attempt_id -cne $expectedAttemptId) { $errors.Add('attempt_id') }
    if ([string]::IsNullOrWhiteSpace([string]$manifest.root_trace_id)) { $errors.Add('root_trace_id') }
    if ([string]::IsNullOrWhiteSpace([string]$manifest.shutdown_status)) { $errors.Add('shutdown_status') }

    $required = @(Get-StructuredLogRequiredArtifactNames)
    $entries = @($manifest.files)
    if ($entries.Count -ne $required.Count) { $errors.Add('file-count') }
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $rootFull = [System.IO.Path]::GetFullPath($AttemptRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $rootPrefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    try {
        $rootItem = Get-Item -LiteralPath $rootFull -Force -ErrorAction Stop
        if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $errors.Add('reparse:attempt-root') }
    } catch { $errors.Add('path:attempt-root') }
    foreach ($entry in $entries) {
        $rawPath = [string]$entry.path
        $rawName = [string]$entry.name
        if ([string]::IsNullOrWhiteSpace($rawPath) -or [System.IO.Path]::IsPathRooted($rawPath)) {
            $errors.Add("path:$rawPath")
            continue
        }
        try {
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rawPath))
            $relativePath = [System.IO.Path]::GetRelativePath($rootFull, $fullPath).Replace('\','/')
        } catch {
            $errors.Add("path:$rawPath")
            continue
        }
        $suppliedPath = $rawPath.Replace('\','/')
        if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
            $suppliedPath -cne $relativePath -or
            $relativePath.StartsWith('../', [System.StringComparison]::Ordinal) -or
            -not $seen.Add($relativePath)) {
            $errors.Add("path:$rawPath")
            continue
        }
        if ($rawName -cne $relativePath -or $relativePath -cnotin $required) { $errors.Add("name:$rawName") }
        $cursor = $rootFull
        foreach ($segment in @($relativePath -split '/')) {
            if ([string]::IsNullOrWhiteSpace($segment) -or -not (Test-Path -LiteralPath $cursor -PathType Container)) { break }
            $candidateChild = Join-Path $cursor $segment
            if (-not (Test-Path -LiteralPath $candidateChild)) { break }
            $actualChild = Get-Item -LiteralPath $candidateChild -Force -ErrorAction SilentlyContinue
            if ($null -eq $actualChild) { break }
            if ([string]$actualChild.Name -cne $segment) { $errors.Add("path-case:$relativePath") }
            if (($actualChild.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $errors.Add("reparse:$relativePath") }
            $cursor = $actualChild.FullName
        }
        $sha = [string]$entry.sha256
        if ($sha -cnotmatch '^[0-9a-f]{64}$') { $errors.Add("sha256:$relativePath"); continue }
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { $errors.Add("missing:$relativePath"); continue }
        [int64]$declaredSize = 0
        if (-not [int64]::TryParse([string]$entry.size_bytes, [ref]$declaredSize) -or $declaredSize -le 0) {
            $errors.Add("size:$relativePath")
        } elseif ((Get-Item -LiteralPath $fullPath -Force).Length -ne $declaredSize) {
            $errors.Add("size:$relativePath")
        }
        $actual = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -cne $sha) { $errors.Add("hash:$relativePath") }
    }
    foreach ($name in $required) {
        if (-not $seen.Contains($name)) { $errors.Add("required:$name") }
    }
    $cleanupQuarantinePath = Join-Path $AttemptRoot 'cleanup-quarantine.json'
    if (Test-Path -LiteralPath $cleanupQuarantinePath -PathType Leaf) {
        try {
            $cleanupQuarantine = Get-Content -Raw -LiteralPath $cleanupQuarantinePath | ConvertFrom-Json
            if ([string]$cleanupQuarantine.status -in @('cleanup_failed','cleanup_failed_identity_unavailable')) { $errors.Add("quarantine:$($cleanupQuarantine.status)") }
        } catch { $errors.Add('json:cleanup-quarantine.json') }
    }

    $jsonArtifacts = @(
        'attempt-manifest.json','runtime-lease.json','machine.json','fixture.json','health.json',
        'bscheme-readiness.json','root-trace-timeline.json','runtime-log-validation.json','shutdown.json','pr-fields.json',
        'browser/structured-log-console.json','browser/structured-log-network.json','browser/structured-log-operability.json'
    )
    $values = @{}
    foreach ($name in $jsonArtifacts) {
        $path = Join-Path $AttemptRoot $name
        try { $value = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json } catch { $errors.Add("json:$name"); continue }
        $values[$name] = $value
        if ($null -eq $value.PSObject.Properties['schema_version'] -or [string]::IsNullOrWhiteSpace([string]$value.schema_version)) {
            $errors.Add("schema_version:$name")
        } elseif ($name -ne 'bscheme-readiness.json' -and [string]$value.schema_version -cne '1') {
            $errors.Add("schema_version:$name")
        }
        if ($null -ne $value.PSObject.Properties['attempt_id'] -and [string]$value.attempt_id -cne [string]$manifest.attempt_id) {
            $errors.Add("attempt_id:$name")
        }
    }
    $requiredFields = [ordered]@{
        'attempt-manifest.json' = @('attempt_id','status','root_trace_id','ports','fixture_sha256')
        'runtime-lease.json' = @('attempt_id','processes')
        'machine.json' = @('machine_name','os_version','pwsh_version','process_architecture')
        'fixture.json' = @('name','size_bytes','sha256','source_path','attempt_copy')
        'health.json' = @('probes')
        'bscheme-readiness.json' = @('context','tiers')
        'root-trace-timeline.json' = @('root_trace_id','records')
        'runtime-log-validation.json' = @('status','files','line_counts','event_counts','violations','redaction_violations')
        'shutdown.json' = @('attempt_id','status','entries','foreign_listeners')
        'pr-fields.json' = @('attempt_id','root_trace_id','runtime_ids','shutdown_status','tests','screenshot_trace','browser_evidence','known_gaps')
        'browser/structured-log-console.json' = @('events')
        'browser/structured-log-network.json' = @('events')
        'browser/structured-log-operability.json' = @('root_trace_id','review_session_id','conversion_job_id','kit_instance_id','browser_run_id','state_transitions','failure_provenance','forced_viewer_log_statuses','retry_viewer_log_status','close_origin','close_status','close_http_status','artifacts')
    }
    foreach ($artifactName in $requiredFields.Keys) {
        if (-not $values.ContainsKey($artifactName)) { continue }
        foreach ($field in $requiredFields[$artifactName]) {
            if ($null -eq $values[$artifactName].PSObject.Properties[$field]) { $errors.Add("field:${artifactName}:$field") }
        }
    }
    if ($values.ContainsKey('attempt-manifest.json') -and [string]$values['attempt-manifest.json'].status -cne 'succeeded') { $errors.Add('status:attempt-manifest.json') }
    if ($values.ContainsKey('runtime-lease.json') -and [string]$values['runtime-lease.json'].attempt_id -cne [string]$manifest.attempt_id) { $errors.Add('attempt_id:runtime-lease.json') }
    if ($values.ContainsKey('fixture.json') -and [string]$values['fixture.json'].sha256 -cnotmatch '^[0-9a-f]{64}$') { $errors.Add('sha256:fixture.json') }
    if ($values.ContainsKey('health.json')) {
        foreach ($probe in @($values['health.json'].probes)) {
            foreach ($field in @('name','uri','started_utc','ended_utc','status','http_status','error_type')) {
                if ($null -eq $probe.PSObject.Properties[$field]) { $errors.Add("field:health.json:probe.$field") }
            }
            if ([string]$probe.status -notin @('passed','failed')) { $errors.Add('status:health.json') }
        }
    }
    $readiness = $null
    if ($values.ContainsKey('bscheme-readiness.json')) {
        try {
            $readiness = Test-StructuredLogReadinessEvidence -Evidence $values['bscheme-readiness.json']
            foreach ($readinessError in @($readiness.errors)) { $errors.Add([string]$readinessError) }
            if ($readiness.valid) {
                $expectedRootTraceId = [string]$readiness.root_trace_id
                if ([string]$manifest.root_trace_id -cne $expectedRootTraceId) { $errors.Add('root-mismatch:artifact-manifest.json') }
                foreach ($artifactName in @('attempt-manifest.json','root-trace-timeline.json','pr-fields.json')) {
                    if (-not $values.ContainsKey($artifactName)) { continue }
                    $rootProperty = $values[$artifactName].PSObject.Properties['root_trace_id']
                    if ($null -eq $rootProperty -or [string]$rootProperty.Value -cne $expectedRootTraceId) { $errors.Add("root-mismatch:$artifactName") }
                }
            }
        } catch {
            $errors.Add('readiness:validation-exception')
        }
    }
    if ($values.ContainsKey('runtime-log-validation.json')) {
        $validation = $values['runtime-log-validation.json']
        if ([string]$validation.status -cne 'passed' -or @($validation.violations).Count -gt 0 -or @($validation.redaction_violations).Count -gt 0) { $errors.Add('status:runtime-log-validation.json') }
    }
    if ($values.ContainsKey('shutdown.json') -and [string]$values['shutdown.json'].status -cne 'succeeded') { $errors.Add('status:shutdown.json') }
    if ($values.ContainsKey('pr-fields.json') -and [string]$values['pr-fields.json'].shutdown_status -notin @('owned_shutdown_complete','owned_shutdown_failed')) { $errors.Add('status:pr-fields.json') }
    if ([string]$manifest.shutdown_status -notin @('owned_shutdown_complete','owned_shutdown_failed')) { $errors.Add('shutdown_status') }

    foreach ($browserJsonName in @('browser/structured-log-console.json','browser/structured-log-network.json','browser/structured-log-operability.json')) {
        $browserJsonPath = Join-Path $AttemptRoot $browserJsonName
        $rawBrowserJson = Get-Content -Raw -LiteralPath $browserJsonPath -ErrorAction SilentlyContinue
        if ($rawBrowserJson -match '"(?:headers?|body|query|url|token|cookie|authorization)"\s*:') { $errors.Add("forbidden-field:$browserJsonName") }
    }
    if ($values.ContainsKey('browser/structured-log-console.json')) {
        $consoleEvents = @($values['browser/structured-log-console.json'].events)
        if ($consoleEvents.Count -gt 200) { $errors.Add('bounded:browser-console') }
        foreach ($event in $consoleEvents) {
            foreach ($property in @($event.PSObject.Properties.Name)) {
                if ($property -cnotin @('seq','type','name')) { $errors.Add("field:browser-console:$property") }
            }
        }
    }
    if ($values.ContainsKey('browser/structured-log-network.json')) {
        $networkEvents = @($values['browser/structured-log-network.json'].events)
        if ($networkEvents.Count -gt 200) { $errors.Add('bounded:browser-network') }
        foreach ($event in $networkEvents) {
            foreach ($property in @($event.PSObject.Properties.Name)) {
                if ($property -cnotin @('seq','kind','method','path','status','phase','provenance')) { $errors.Add("field:browser-network:$property") }
            }
            if ([string]$event.method -cne 'POST' -or [string]$event.path -cnotmatch '^/api/(?:internal/viewer-log|review-sessions/[A-Za-z0-9_]+/close)$') {
                $errors.Add('value:browser-network')
            }
        }
    }
    if ($null -ne $readiness -and $readiness.valid -and $values.ContainsKey('browser/structured-log-operability.json')) {
        $operability = $values['browser/structured-log-operability.json']
        if ([string]$operability.root_trace_id -cne [string]$readiness.root_trace_id) { $errors.Add('browser-operability:root-trace-id') }
        if ([string]$operability.review_session_id -cne [string]$readiness.runtime_ids.review_session_id) { $errors.Add('browser-operability:review-session-id') }
        if ([string]$operability.conversion_job_id -cne [string]$readiness.runtime_ids.conversion_job_id) { $errors.Add('browser-operability:conversion-job-id') }
        if ([string]$operability.kit_instance_id -cne [string]$readiness.runtime_ids.kit_instance_id) { $errors.Add('browser-operability:kit-instance-id') }
        if ((@($operability.state_transitions | ForEach-Object {[string]$_}) -join ',') -cne 'ready,flush_loading,flush_failure,retry_loading,flush_success,close_loading,closed') { $errors.Add('browser-operability:state-transitions') }
        if ([string]$operability.failure_provenance -cne 'playwright_intercepted_503') { $errors.Add('browser-operability:failure-provenance') }
        $forced = @($operability.forced_viewer_log_statuses | ForEach-Object {[int]$_})
        if ($forced.Count -ne 3 -or @($forced | Where-Object {$_ -ne 503}).Count -ne 0) { $errors.Add('browser-operability:forced-statuses') }
        if ([int]$operability.retry_viewer_log_status -lt 200 -or [int]$operability.retry_viewer_log_status -ge 300) { $errors.Add('browser-operability:retry-status') }
        if ([string]$operability.close_origin -cne 'browser' -or [string]$operability.close_status -cne 'closed' -or [int]$operability.close_http_status -lt 200 -or [int]$operability.close_http_status -ge 300) { $errors.Add('browser-operability:close') }
        $artifactContainerProperty = $operability.PSObject.Properties['artifacts']
        $artifactContainer = if ($null -eq $artifactContainerProperty) { $null } else { $artifactContainerProperty.Value }
        if ($null -eq $artifactContainer -or $artifactContainer -is [string] -or $artifactContainer -is [ValueType]) {
            $errors.Add('browser-operability:artifacts')
            $artifactContainer = $null
        }
        foreach ($artifact in ([ordered]@{
            failure_screenshot='structured-log-failure.png'
            final_screenshot='structured-log-success-closed.png'
            playwright_trace='structured-log-trace.zip'
            console_events='structured-log-console.json'
            network_events='structured-log-network.json'
        }).GetEnumerator()) {
            if ($null -eq $artifactContainer) { continue }
            $descriptorProperty = $artifactContainer.PSObject.Properties[$artifact.Key]
            if ($null -eq $descriptorProperty) { $errors.Add("browser-operability:artifact-$($artifact.Key)"); continue }
            $descriptor = $descriptorProperty.Value
            if ($null -eq $descriptor -or $descriptor -is [string] -or $descriptor -is [ValueType] -or
                $null -eq $descriptor.PSObject.Properties['path'] -or $null -eq $descriptor.PSObject.Properties['size_bytes'] -or $null -eq $descriptor.PSObject.Properties['sha256']) {
                $errors.Add("browser-operability:artifact-descriptor-$($artifact.Key)")
                continue
            }
            $artifactPath = Join-Path $AttemptRoot "browser/$($artifact.Value)"
            if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { $errors.Add("browser-operability:artifact-$($artifact.Key)"); continue }
            [int64]$descriptorSize = 0
            if ([string]$descriptor.path -cne $artifact.Value -or -not [int64]::TryParse([string]$descriptor.size_bytes,[ref]$descriptorSize) -or
                $descriptorSize -le 0 -or $descriptorSize -ne [int64](Get-Item -LiteralPath $artifactPath -Force).Length) {
                $errors.Add("browser-operability:artifact-$($artifact.Key)")
            }
            $descriptorSha = [string]$descriptor.sha256
            if ($descriptorSha -cnotmatch '^[0-9a-f]{64}$' -or $descriptorSha -cne (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()) {
                $errors.Add("browser-operability:artifact-hash-$($artifact.Key)")
            }
        }
        $coordinatorPort = 0
        if ($values.ContainsKey('attempt-manifest.json')) {
            $portsProperty = $values['attempt-manifest.json'].PSObject.Properties['ports']
            if ($null -ne $portsProperty -and $null -ne $portsProperty.Value -and $null -ne $portsProperty.Value.PSObject.Properties['Coordinator']) {
                [void][int]::TryParse([string]$portsProperty.Value.Coordinator,[ref]$coordinatorPort)
            }
        }
        if ($coordinatorPort -le 0) {
            $errors.Add('playwright-trace:coordinator-port')
        } else {
            $traceCheck = Test-StructuredLogPlaywrightTrace -Path (Join-Path $AttemptRoot 'browser/structured-log-trace.zip') `
                -ExpectedTraceId ([string]$operability.root_trace_id) -ExpectedSessionId ([string]$operability.review_session_id) `
                -ExpectedCoordinatorPort $coordinatorPort
            foreach ($traceError in @($traceCheck.errors)) { $errors.Add("playwright-trace:$traceError") }
        }
    }

    $provenancePath = Join-Path $AttemptRoot 'command-provenance.jsonl'
    $expectedSeq = 1
    foreach ($line in @(Get-Content -LiteralPath $provenancePath -ErrorAction SilentlyContinue)) {
        try { $record = $line | ConvertFrom-Json } catch { $errors.Add('jsonl:command-provenance.jsonl'); continue }
        foreach ($field in @('seq','ts_utc','started_utc','ended_utc','phase','command','cwd','status','exit_code')) {
            if ($null -eq $record.PSObject.Properties[$field]) { $errors.Add("field:command-provenance.jsonl:$field") }
        }
        if ([int]$record.seq -ne $expectedSeq) { $errors.Add('seq:command-provenance.jsonl') }
        if ([string]$record.status -notin @('started','passed','failed','succeeded')) { $errors.Add('status:command-provenance.jsonl') }
        $expectedSeq++
    }
    if ($expectedSeq -eq 1) { $errors.Add('empty:command-provenance.jsonl') }

    $summaryLines = @(Get-Content -LiteralPath (Join-Path $AttemptRoot 'evidence-summary.md') -ErrorAction SilentlyContinue)
    foreach ($heading in @('## Revision and machine','## Fixture name-size-SHA256','## Exact command provenance','## Owned process lease and shutdown','## Root trace timeline and runtime IDs','## Schema/env-snapshot/redaction validation','## OpenSpec 10.1-10.5 mapping','## Verified facts','## Inferences','## Unverified risks','## Skipped checks')) {
        if ($summaryLines -cnotcontains $heading) { $errors.Add("heading:$heading") }
    }
    return [pscustomobject]@{valid=$errors.Count -eq 0;errors=@($errors | ForEach-Object {$_});attempt_id=$manifest.attempt_id}
}

function Write-StructuredLogEvidenceArtifacts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Context,
        [scriptblock] $ValidatorInvoker = {
            param($python, $arguments, $outputPath)
            & $python @arguments
            return [int]$LASTEXITCODE
        }
    )
    $baseRequired = @(
        'machine.json','fixture.json','health.json','bscheme-readiness.json','runtime-lease.json','shutdown.json','command-provenance.jsonl',
        'browser/structured-log-failure.png','browser/structured-log-success-closed.png','browser/structured-log-trace.zip',
        'browser/structured-log-console.json','browser/structured-log-network.json','browser/structured-log-operability.json'
    )
    foreach ($name in $baseRequired) {
        if (-not (Test-Path -LiteralPath (Join-Path $Context.AttemptRoot $name) -PathType Leaf)) { throw "required evidence artifact missing: $name" }
    }
    $smoke = Get-Content -Raw -LiteralPath (Join-Path $Context.AttemptRoot 'bscheme-readiness.json') | ConvertFrom-Json
    $readiness = Test-StructuredLogReadinessEvidence -Evidence $smoke
    if (-not $readiness.valid) { throw "supported smoke evidence is invalid: $($readiness.errors -join ',')" }
    $rootTraceId = [string]$readiness.root_trace_id
    $runtimeIds = [ordered]@{
        ifc_ready_job_id = @([string]$readiness.runtime_ids.ifc_ready_job_id)
        conversion_job_id = @([string]$readiness.runtime_ids.conversion_job_id)
        review_session_id = @([string]$readiness.runtime_ids.review_session_id)
        kit_instance_id = @([string]$readiness.runtime_ids.kit_instance_id)
    }
    foreach ($property in @('runtime_id')) {
        $values = @(Find-StructuredLogNamedValues -Value $smoke -NamePattern "^$property$" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
        if ($values.Count -gt 0) { $runtimeIds[$property] = @($values | ForEach-Object {[string]$_}) }
    }

    $validationPath = Join-Path $Context.AttemptRoot 'runtime-log-validation.json'
    $validatorPath = Join-Path $Context.RepoRoot 'tests\contracts\structured-log\validate_runtime_logs.py'
    $validatorArgs = @($validatorPath,'--log-root',$Context.LogRoot,'--trace-id',$rootTraceId,'--require-services','coordinator','streaming-server','viewer','scripts','--require-one-env-snapshot-per-run','--output',$validationPath)
    $validatorCommand = 'python validate_runtime_logs.py --log-root <attempt-log-root> --trace-id <root-trace-id> --require-services coordinator streaming-server viewer scripts --output runtime-log-validation.json'
    $validatorStarted = [DateTimeOffset]::UtcNow.ToString('o')
    $validatorExit = $null
    try {
        $validatorExit = & $ValidatorInvoker $Context.PythonExe $validatorArgs $validationPath
        if ([int]$validatorExit -ne 0 -or -not (Test-Path -LiteralPath $validationPath -PathType Leaf)) { throw "canonical structured-log validator failed with exit code $validatorExit" }
        $validation = Get-Content -Raw -LiteralPath $validationPath | ConvertFrom-Json
        if (@($validation.violations).Count -gt 0 -or @($validation.redaction_violations).Count -gt 0) { throw 'canonical structured-log validation report contains violations' }
        $validation | Add-Member -NotePropertyName schema_version -NotePropertyValue '1' -Force
        $validation | Add-Member -NotePropertyName status -NotePropertyValue 'passed' -Force
        Write-StructuredLogJson -Path $validationPath -Value $validation
        Write-StructuredLogProvenance -Context $Context -Phase 'runtime_validator' -Command $validatorCommand -Cwd $Context.RepoRoot -Status 'passed' -ExitCode $validatorExit -StartedUtc $validatorStarted -EndedUtc ([DateTimeOffset]::UtcNow.ToString('o')) | Out-Null
    } catch {
        Write-StructuredLogProvenance -Context $Context -Phase 'runtime_validator' -Command $validatorCommand -Cwd $Context.RepoRoot -Status 'failed' -ExitCode $validatorExit -StartedUtc $validatorStarted -EndedUtc ([DateTimeOffset]::UtcNow.ToString('o')) | Out-Null
        throw
    }

    $timeline = [System.Collections.Generic.List[object]]::new()
    foreach ($file in @(Get-ChildItem -LiteralPath $Context.LogRoot -Recurse -File -Filter '*.jsonl' -ErrorAction SilentlyContinue)) {
        foreach ($line in @(Get-Content -LiteralPath $file.FullName)) {
            try { $record = $line | ConvertFrom-Json } catch { continue }
            if ([string]$record.trace_id -cne $rootTraceId) { continue }
            $timeline.Add([pscustomobject][ordered]@{ts=[string]$record.ts;service=[string]$record.service;event_type=[string]$record.event_type;level=[string]$record.level;run_id=[string]$record.run_id;trace_id=[string]$record.trace_id;seq=$record.seq})
        }
    }
    $timelineValue = [pscustomobject][ordered]@{schema_version='1';root_trace_id=$rootTraceId;records=@($timeline | Sort-Object -Property ts)}
    Write-StructuredLogJson -Path (Join-Path $Context.AttemptRoot 'root-trace-timeline.json') -Value $timelineValue

    $shutdown = Get-Content -Raw -LiteralPath (Join-Path $Context.AttemptRoot 'shutdown.json') | ConvertFrom-Json
    $shutdownEntries = if ($null -ne $shutdown.PSObject.Properties['entries']) { @($shutdown.entries) } else { @() }
    $shutdownStatus = if (@($shutdownEntries | Where-Object result -eq 'failed').Count -eq 0) { 'owned_shutdown_complete' } else { 'owned_shutdown_failed' }
    $browserArtifactDetail = $readiness.live_tier.detail.browser_artifacts
    $references = [ordered]@{
        failure_screenshot = [string]$browserArtifactDetail.artifacts.failure_screenshot.path
        final_screenshot = [string]$browserArtifactDetail.artifacts.final_screenshot.path
        trace = [string]$browserArtifactDetail.artifacts.playwright_trace.path
    }
    $browserEvidence = [ordered]@{
        console = [string]$browserArtifactDetail.artifacts.console_events.path
        network = [string]$browserArtifactDetail.artifacts.network_events.path
        operability = [string]$browserArtifactDetail.artifacts.operability.path
        state_transitions = @($browserArtifactDetail.state_transitions | ForEach-Object {[string]$_})
        failure_provenance = [string]$browserArtifactDetail.failure_provenance
        retry_viewer_log_status = [int]$browserArtifactDetail.retry_viewer_log_status
        close_origin = [string]$readiness.live_tier.detail.close_origin
    }
    $knownGaps = @('WebRTC first-frame, render fidelity, and stage evidence are not claimed by this runtime-log evidence pass.')
    $attemptManifest = [ordered]@{schema_version='1';attempt_id=$Context.AttemptId;status='succeeded';root_trace_id=$rootTraceId;ports=$Context.Ports;fixture_sha256=$Context.FixtureSha256}
    Write-StructuredLogJson -Path (Join-Path $Context.AttemptRoot 'attempt-manifest.json') -Value $attemptManifest
    $prFields = [ordered]@{schema_version='1';attempt_id=$Context.AttemptId;root_trace_id=$rootTraceId;runtime_ids=$runtimeIds;shutdown_status=$shutdownStatus;tests='scripts/tests/test-run-structured-log-runtime-evidence.ps1';screenshot_trace=$references;browser_evidence=$browserEvidence;known_gaps=$knownGaps}
    Write-StructuredLogJson -Path (Join-Path $Context.AttemptRoot 'pr-fields.json') -Value $prFields
    @(
        '# Structured Log Runtime Evidence','',
        '## Revision and machine','See `machine.json`.','',
        '## Fixture name-size-SHA256','See `fixture.json`.','',
        '## Exact command provenance','See `command-provenance.jsonl`.','',
        '## Owned process lease and shutdown','See `runtime-lease.json` and `shutdown.json`.','',
        '## Root trace timeline and runtime IDs',"Root trace: ``$rootTraceId``. See ``root-trace-timeline.json``.",'',
        '## Schema/env-snapshot/redaction validation','See `runtime-log-validation.json`; canonical validator reported no violations.','',
        '## OpenSpec 10.1-10.5 mapping','Evidence remains subject to the tracked OpenSpec evidence review.','',
        '## Verified facts','Artifacts referenced above are hash-bound by `artifact-manifest.json`.','',
        '## Inferences','No additional inference.','',
        '## Unverified risks',$knownGaps[0],'',
        '## Skipped checks','WebRTC/render/design evidence is outside this runner.'
    ) | Set-Content -LiteralPath (Join-Path $Context.AttemptRoot 'evidence-summary.md') -Encoding utf8

    $manifestNames = @(Get-StructuredLogRequiredArtifactNames)
    $files = @($manifestNames | ForEach-Object {
        $path = Join-Path $Context.AttemptRoot $_
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "artifact missing during hash render: $_" }
        [pscustomobject]@{name=$_;path=$_;size_bytes=[int64](Get-Item -LiteralPath $path -Force).Length;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
    })
    $manifest = [ordered]@{schema_version='1';attempt_id=$Context.AttemptId;status='succeeded';files=$files;root_trace_id=$rootTraceId;runtime_ids=$runtimeIds;shutdown_status=$shutdownStatus;known_gaps=$knownGaps;screenshot_trace=$references;browser_evidence=$browserEvidence}
    Write-StructuredLogJson -Path (Join-Path $Context.AttemptRoot 'artifact-manifest.json') -Value $manifest
    $check = Test-StructuredLogArtifactManifest -AttemptRoot $Context.AttemptRoot
    if (-not $check.valid) { throw "artifact manifest self-check failed: $($check.errors -join ',')" }
    return [pscustomobject]$manifest
}

function Resolve-StructuredLogActiveAttempt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $HeadOid,
        [scriptblock] $ShutdownInvoker = { param($context) Stop-StructuredLogOwnedProcesses -Context $context },
        [scriptblock] $AtomicStateWriter = { param($repoRoot,$state) Set-StructuredLogActiveAttempt -RepoRoot $repoRoot -State $state }
    )
    if (-not (Test-StructuredLogAbsolutePath $RepoRoot)) { throw 'RepoRoot must be absolute' }
    $pointerPath = Join-Path $RepoRoot 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json'
    if (-not (Test-Path -LiteralPath $pointerPath -PathType Leaf)) {
        return [pscustomobject]@{action='none';attempt_root=$null;lineage=@()}
    }
    try { $state = Get-Content -Raw -LiteralPath $pointerPath | ConvertFrom-Json } catch {
        return [pscustomobject]@{action='invalid_pointer';attempt_root=$null;lineage=@();detail='active-attempt.json is invalid JSON'}
    }
    foreach ($name in @('schema_version','head_oid','attempt_id','attempt_root','status','started_utc','lineage')) {
        if ($null -eq $state.PSObject.Properties[$name]) { return [pscustomobject]@{action='invalid_pointer';attempt_root=$null;lineage=@();detail="missing $name"} }
    }
    if ([string]$state.schema_version -cne '1' -or [string]$state.status -notin @('running','failed','succeeded','superseded')) {
        return [pscustomobject]@{action='invalid_pointer';attempt_root=[string]$state.attempt_root;lineage=@($state.lineage);detail='invalid schema_version or status'}
    }
    try { $validatedAttemptRoot = Assert-StructuredLogAttemptRoot -RepoRoot $RepoRoot -AttemptRoot ([string]$state.attempt_root) -AttemptId ([string]$state.attempt_id) -RequireExisting } catch {
        return [pscustomobject]@{action='invalid_pointer';attempt_root=[string]$state.attempt_root;lineage=@($state.lineage);detail=$_.Exception.Message}
    }
    if ([string]$state.status -eq 'succeeded' -and [string]$state.head_oid -ceq $HeadOid) {
        $check = Test-StructuredLogArtifactManifest -AttemptRoot ([string]$state.attempt_root)
        if ($check.valid -and [string]$state.attempt_id -cne [string]$check.attempt_id) {
            return [pscustomobject]@{action='invalid_pointer';attempt_root=[string]$state.attempt_root;lineage=@($state.lineage);detail='pointer attempt_id does not match artifact manifest attempt_id'}
        }
        if ($check.valid) { return [pscustomobject]@{action='resume_succeeded';attempt_root=[string]$state.attempt_root;lineage=@($state.lineage);attempt_id=[string]$state.attempt_id} }
        return [pscustomobject]@{action='invalid_succeeded_artifacts';attempt_root=[string]$state.attempt_root;lineage=@($state.lineage);detail=($check.errors -join ',')}
    }
    if ([string]$state.status -eq 'running') {
        $attemptRoot = [string]$state.attempt_root
        $quarantinePath = Join-Path $attemptRoot 'cleanup-quarantine.json'
        if (Test-Path -LiteralPath $quarantinePath -PathType Leaf) {
            try { $quarantine = Get-Content -Raw -LiteralPath $quarantinePath | ConvertFrom-Json } catch {
                return [pscustomobject]@{action='unsafe_running_identity';attempt_root=$attemptRoot;lineage=@($state.lineage);detail='cleanup quarantine is invalid and ownership cannot be proven'}
            }
            if ([string]$quarantine.status -eq 'cleanup_failed_identity_unavailable') {
                return [pscustomobject]@{action='unsafe_running_identity';attempt_root=$attemptRoot;lineage=@($state.lineage);detail='cleanup failed and complete process identity is unavailable'}
            }
        }
        $context = [pscustomobject]@{
            RepoRoot = $RepoRoot
            AttemptRoot = $attemptRoot
            AttemptId = [string]$state.attempt_id
            LeasePath = Join-Path $attemptRoot 'runtime-lease.json'
            Ports = [ordered]@{Coordinator=8005;Viewer=5175;Conversion=49104}
        }
        $shutdown = & $ShutdownInvoker $context
        $unsafe = @($shutdown.entries | Where-Object { $_.result -in @('identity_mismatch','identity_changed','failed') })
        if ($unsafe.Count -gt 0) {
            return [pscustomobject]@{action='unsafe_running_identity';attempt_root=$attemptRoot;lineage=@($state.lineage);detail='owned process identity could not be reconciled'}
        }
        $lineage = @($state.lineage) + @([pscustomobject]@{attempt_id=[string]$state.attempt_id;attempt_root=$attemptRoot;head_oid=[string]$state.head_oid;status='superseded';started_utc=$state.started_utc;finished_utc=[DateTimeOffset]::UtcNow.ToString('o')})
        $updated = [ordered]@{schema_version='1';head_oid=[string]$state.head_oid;attempt_id=[string]$state.attempt_id;attempt_root=$attemptRoot;status='superseded';started_utc=$state.started_utc;finished_utc=[DateTimeOffset]::UtcNow.ToString('o');lineage=$lineage}
        & $AtomicStateWriter $RepoRoot $updated
        return [pscustomobject]@{action='superseded_owned_runtime';attempt_root=$attemptRoot;lineage=$lineage;attempt_id=[string]$state.attempt_id}
    }
    return [pscustomobject]@{action='none';attempt_root=[string]$state.attempt_root;lineage=@($state.lineage);prior_status=[string]$state.status}
}

function Confirm-StructuredLogLeasedProcessesEnded {
    param(
        [Parameter(Mandatory)] $Context,
        [scriptblock] $ProcessInventoryProvider = ${function:Get-StructuredLogProcessInventory}
    )
    if (-not (Test-Path -LiteralPath $Context.LeasePath -PathType Leaf)) { return $true }
    $lease = Get-Content -Raw -LiteralPath $Context.LeasePath | ConvertFrom-Json
    $inventory = @(& $ProcessInventoryProvider)
    $stillOwned = @()
    foreach ($entry in @($lease.processes)) {
        $current = $inventory | Where-Object { [int]$_.pid -eq [int]$entry.pid } | Select-Object -First 1
        if (Test-StructuredLogIdentityMatch -Expected $entry -Actual $current) { $stillOwned += @($entry) }
    }
    if ($stillOwned.Count -gt 0) { throw "owned leased process identities remain after shutdown: $(($stillOwned.pid) -join ',')" }
    return $true
}

function Write-StructuredLogJsonAtomic {
    param([Parameter(Mandatory)] [string] $Path, [Parameter(Mandatory)] $Value)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $tempPath = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $json = $Value | ConvertTo-Json -Depth 16
    $utf8 = [Text.UTF8Encoding]::new($false)
    $stream = $null
    $writer = $null
    try {
        $stream = [IO.FileStream]::new($tempPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $writer = [IO.StreamWriter]::new($stream, $utf8)
        $writer.Write($json)
        $writer.Write("`n")
        $writer.Flush()
        $stream.Flush($true)
        $writer.Dispose(); $writer = $null
        $stream.Dispose(); $stream = $null
        [IO.File]::Move($tempPath, $Path, $true)
    } finally {
        if ($null -ne $writer) { $writer.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    }
}

function Set-StructuredLogActiveAttempt {
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] $State,
        [scriptblock] $AtomicWriter = { param($path,$value) Write-StructuredLogJsonAtomic -Path $path -Value $value }
    )
    $pointerPath = Join-Path $RepoRoot 'artifacts\spec-to-done\cross-service-structured-log-baseline\active-attempt.json'
    & $AtomicWriter $pointerPath $State
}

function Get-StructuredLogEnvironmentSnapshot {
    param([string[]] $Keys)
    $snapshot = [ordered]@{}
    foreach ($key in $Keys) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        $snapshot[$key] = [pscustomobject]@{existed=$null -ne $value;value=$value}
    }
    return $snapshot
}

function Invoke-StructuredLogRuntimeEvidence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $AttemptRoot,
        [Parameter(Mandatory)] [string] $FixturePath,
        [Parameter(Mandatory)] [string] $PythonExe,
        [int] $CoordinatorPort = 8005,
        [int] $ViewerPort = 5175,
        [int] $ConversionPort = 49104,
        [string] $KitProvisionMode = 'Build',
        [string] $KitPackagePath = '',
        [string] $KitPackageSha256 = '',
        [int] $LivePollSeconds = 180,
        [System.Collections.IDictionary] $Dependencies = @{}
    )
    $headOid = if ($Dependencies.Contains('GetHeadOid')) { & $Dependencies.GetHeadOid $RepoRoot } else { (& git -C $RepoRoot rev-parse HEAD).Trim() }
    if ([string]::IsNullOrWhiteSpace([string]$headOid)) { throw 'HELD: unable to resolve current HEAD OID' }
    $reconcile = if ($Dependencies.Contains('Reconcile')) { & $Dependencies.Reconcile $RepoRoot ([string]$headOid) } else { Resolve-StructuredLogActiveAttempt -RepoRoot $RepoRoot -HeadOid ([string]$headOid) }
    if ($null -eq $reconcile) { throw 'HELD: active-attempt reconcile returned no result' }
    switch ([string]$reconcile.action) {
        'resume_succeeded' { return [pscustomobject]@{action='resume_succeeded';attempt_root=[string]$reconcile.attempt_root;attempt_id=[string]$reconcile.attempt_id;lineage=@($reconcile.lineage)} }
        'none' { }
        'superseded_owned_runtime' { }
        'invalid_pointer' { throw "HELD: invalid active-attempt pointer: $($reconcile.detail)" }
        'unsafe_running_identity' { throw "HELD: unsafe running attempt identity: $($reconcile.detail)" }
        'invalid_succeeded_artifacts' { throw "HELD: succeeded attempt artifacts are invalid: $($reconcile.detail)" }
        default { throw "HELD: unsupported active-attempt reconcile action '$($reconcile.action)'" }
    }
    $context = $null
    $processSpecs = @()
    $primaryFailure = $null
    $shutdownFailure = $null
    $renderFailure = $null
    $result = $null
    $shutdownResult = $null
    $finalizeFailure = $null
    $outerEnvironment = Get-StructuredLogEnvironmentSnapshot -Keys @('LOG_ROOT','BIM_TRACE_ID')
    $startedUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $lineage = @($reconcile.lineage)
    $runningState = $null
    try {
        $ports = [ordered]@{Coordinator=$CoordinatorPort;Viewer=$ViewerPort;Conversion=$ConversionPort}
        $context = if ($Dependencies.Contains('NewContext')) { & $Dependencies.NewContext $RepoRoot $AttemptRoot $FixturePath $PythonExe $ports } else { New-StructuredLogAttemptContext -RepoRoot $RepoRoot -AttemptRoot $AttemptRoot -FixturePath $FixturePath -PythonExe $PythonExe -Ports $ports }
        Write-StructuredLogJson -Path (Join-Path $context.AttemptRoot 'attempt-manifest.json') -Value ([ordered]@{schema_version='1';attempt_id=$context.AttemptId;status='running';ports=$context.Ports;fixture_sha256=$context.FixtureSha256})
        $runningState = [ordered]@{schema_version='1';head_oid=[string]$headOid;attempt_id=$context.AttemptId;attempt_root=$context.AttemptRoot;status='running';started_utc=$startedUtc;finished_utc=$null;lineage=$lineage}
        Set-StructuredLogActiveAttempt -RepoRoot $RepoRoot -State $runningState
        $context.Kit = if ($Dependencies.Contains('ResolveKit')) { & $Dependencies.ResolveKit $context $KitProvisionMode $KitPackagePath $KitPackageSha256 } else { Resolve-StructuredLogKitPrerequisites -Context $context -KitProvisionMode $KitProvisionMode -KitPackagePath $KitPackagePath -KitPackageSha256 $KitPackageSha256 }
        $processSpecs = @(if ($Dependencies.Contains('ProcessSpecs')) { & $Dependencies.ProcessSpecs $context } else { New-StructuredLogProcessSpecs -Context $context })
        foreach ($processSpec in $processSpecs) {
            if ($Dependencies.Contains('Start')) { & $Dependencies.Start $context $processSpec | Out-Null } else { Start-StructuredLogOwnedProcess -Context $context -ProcessSpec $processSpec | Out-Null }
        }
        if ($Dependencies.Contains('Health')) { & $Dependencies.Health $context $processSpecs | Out-Null } else { Wait-StructuredLogHealth -Context $context -ProcessSpecs $processSpecs | Out-Null }
        if ($Dependencies.Contains('Smoke')) { & $Dependencies.Smoke $context $LivePollSeconds | Out-Null } else { Invoke-StructuredLogSupportedSmoke -Context $context -LivePollSeconds $LivePollSeconds | Out-Null }
    } catch {
        $primaryFailure = $_
    } finally {
        if ($null -ne $context) {
            try {
                $shutdownResult = if ($Dependencies.Contains('Shutdown')) { & $Dependencies.Shutdown $context } else { Stop-StructuredLogOwnedProcesses -Context $context }
                $unsafeShutdown = @($shutdownResult.entries | Where-Object { $_.result -in @('identity_mismatch','identity_changed','failed') })
                if ($unsafeShutdown.Count -gt 0) { throw 'owned shutdown could not prove every leased process identity' }
                if ($Dependencies.Contains('ConfirmEnded')) { & $Dependencies.ConfirmEnded $context | Out-Null } else { Confirm-StructuredLogLeasedProcessesEnded -Context $context | Out-Null }
            } catch {
                $shutdownFailure = $_
                if (-not (Test-Path -LiteralPath (Join-Path $context.AttemptRoot 'shutdown.json'))) {
                    Write-StructuredLogJson -Path (Join-Path $context.AttemptRoot 'shutdown.json') -Value ([ordered]@{schema_version='1';attempt_id=$context.AttemptId;entries=@();foreign_listeners=@();status='failed';error_type=$_.Exception.GetType().FullName})
                }
            }
            Restore-StructuredLogEnvironment -Snapshot $outerEnvironment
            if ($null -eq $primaryFailure -and $null -eq $shutdownFailure) {
                try {
                    $result = if ($Dependencies.Contains('Render')) { & $Dependencies.Render $context } else { Write-StructuredLogEvidenceArtifacts -Context $context }
                    $finalCheck = if ($Dependencies.Contains('ManifestCheck')) { & $Dependencies.ManifestCheck $context.AttemptRoot } else { Test-StructuredLogArtifactManifest -AttemptRoot $context.AttemptRoot }
                    if (-not $finalCheck.valid) { throw "artifact manifest self-check failed after orchestration: $($finalCheck.errors -join ',')" }
                } catch { $renderFailure = $_ }
            }
            $finalStatus = if ($null -eq $primaryFailure -and $null -eq $shutdownFailure -and $null -eq $renderFailure) { 'succeeded' } else { 'failed' }
            if ($finalStatus -eq 'failed') {
                $manifestPath = Join-Path $context.AttemptRoot 'attempt-manifest.json'
                $manifest = [ordered]@{schema_version='1';attempt_id=$context.AttemptId;status=$finalStatus;ports=$context.Ports;fixture_sha256=$context.FixtureSha256;finished_utc=[DateTimeOffset]::UtcNow.ToString('o')}
                Write-StructuredLogJson -Path $manifestPath -Value $manifest
            }
            $finishedState = [ordered]@{schema_version='1';head_oid=[string]$headOid;attempt_id=$context.AttemptId;attempt_root=$context.AttemptRoot;status=$finalStatus;started_utc=$startedUtc;finished_utc=[DateTimeOffset]::UtcNow.ToString('o');lineage=$lineage}
            try {
                if ($Dependencies.Contains('Finalize')) { & $Dependencies.Finalize $RepoRoot $finishedState } else { Set-StructuredLogActiveAttempt -RepoRoot $RepoRoot -State $finishedState }
            } catch { $finalizeFailure = $_ }
        } else {
            Restore-StructuredLogEnvironment -Snapshot $outerEnvironment
        }
        Restore-StructuredLogEnvironment -Snapshot $outerEnvironment
    }
    if ($null -ne $primaryFailure) { throw $primaryFailure }
    if ($null -ne $shutdownFailure) { throw $shutdownFailure }
    if ($null -ne $renderFailure) { throw $renderFailure }
    if ($null -ne $finalizeFailure) { throw $finalizeFailure }
    return $result
}

if ($MyInvocation.InvocationName -ne '.') {
    $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    Invoke-StructuredLogRuntimeEvidence -RepoRoot $repoRoot -AttemptRoot $AttemptRoot -FixturePath $FixturePath -PythonExe $PythonExe `
        -CoordinatorPort $CoordinatorPort -ViewerPort $ViewerPort -ConversionPort $ConversionPort -KitProvisionMode $KitProvisionMode `
        -KitPackagePath $KitPackagePath -KitPackageSha256 $KitPackageSha256 -LivePollSeconds $LivePollSeconds
}
