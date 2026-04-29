[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string[]] $IfcPath,

    [Alias("OutputNamne")]
    [string] $OutputName = "{source-file-name}.usdc",

    [string] $OutputDir = ".\bim-models",

    [string] $ConfigPath = "",

    [string] $KitExePath = "",

    [string] $HoopsMainPath = "",

    [ValidateRange(1, 86400)]
    [int] $TimeoutSeconds = 600,

    [switch] $Force,

    [switch] $PlanOnly,

    [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path

function ConvertTo-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Resolve-IfcInputs {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Patterns
    )

    $byPath = [ordered]@{}
    $missingPatterns = New-Object System.Collections.Generic.List[string]

    foreach ($pattern in $Patterns) {
        $fullPattern = ConvertTo-AbsolutePath -Path $pattern

        if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($fullPattern)) {
            $found = @(
                Get-ChildItem -Path $fullPattern -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Extension -ieq ".ifc" }
            )
            if ($found.Count -eq 0) {
                $missingPatterns.Add($pattern) | Out-Null
            }

            foreach ($item in $found) {
                $byPath[$item.FullName] = $item
            }
            continue
        }

        if (-not (Test-Path -LiteralPath $fullPattern -PathType Leaf)) {
            $missingPatterns.Add($pattern) | Out-Null
            continue
        }

        $file = Get-Item -LiteralPath $fullPattern
        if ($file.Extension -ine ".ifc") {
            throw "Input is not an .ifc file: $($file.FullName)"
        }
        $byPath[$file.FullName] = $file
    }

    if ($missingPatterns.Count -gt 0) {
        $joined = ($missingPatterns -join ", ")
        throw "No IFC file matched: $joined"
    }

    return @($byPath.Values)
}

function Expand-OutputName {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.FileInfo] $SourceFile,

        [Parameter(Mandatory = $true)]
        [string] $Template
    )

    $sourceBaseName = [System.IO.Path]::GetFileNameWithoutExtension($SourceFile.Name)
    $sourceExtension = $SourceFile.Extension.TrimStart(".")

    $name = $Template
    $name = $name.Replace("{source-file-name}", $sourceBaseName)
    $name = $name.Replace("{source-name}", $SourceFile.Name)
    $name = $name.Replace("{source-extension}", $sourceExtension)

    if ([string]::IsNullOrWhiteSpace([System.IO.Path]::GetExtension($name))) {
        $name = "$name.usdc"
    }

    return $name
}

function ConvertTo-KitPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    return $Path.Replace("\", "/")
}

function Find-KitExe {
    if (-not [string]::IsNullOrWhiteSpace($KitExePath)) {
        $resolved = ConvertTo-AbsolutePath -Path $KitExePath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Kit executable not found: $resolved"
        }
        return $resolved
    }

    $default = Join-Path $RepoRoot "_build\windows-x86_64\release\kit\kit.exe"
    if (-not (Test-Path -LiteralPath $default -PathType Leaf)) {
        throw "Kit executable not found: $default. Run .\repo.bat build first."
    }
    return (Resolve-Path -LiteralPath $default).Path
}

function Find-HoopsMain {
    if (-not [string]::IsNullOrWhiteSpace($HoopsMainPath)) {
        $resolved = ConvertTo-AbsolutePath -Path $HoopsMainPath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "HOOPS conversion entrypoint not found: $resolved"
        }
        return $resolved
    }

    $searchRoots = @(
        (Join-Path $RepoRoot "_build\windows-x86_64\release\extscache"),
        (Join-Path $RepoRoot "_build\windows-x86_64\release\exts"),
        (Join-Path $RepoRoot "_build\windows-x86_64\release\extsbuild")
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

    foreach ($root in $searchRoots) {
        $candidateRoots = @($root)
        $candidateRoots += @(
            Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty FullName
        )

        foreach ($candidateRoot in $candidateRoots) {
            $matches = @(
                Get-ChildItem -LiteralPath $candidateRoot -Recurse -File -Filter "hoops_main.py" -ErrorAction SilentlyContinue |
                    Where-Object { $_.FullName -match "omni[\\/]services[\\/]convert[\\/]cad[\\/]services[\\/]process[\\/]hoops_main\.py$" } |
                    Sort-Object FullName
            )
            if ($matches.Count -gt 0) {
                return $matches[0].FullName
            }
        }
    }

    throw @"
NVIDIA CAD Converter service entrypoint was not found.

Expected: omni/services/convert/cad/services/process/hoops_main.py

Run a build/precache after this change so the official converter extensions are downloaded:
    .\repo.bat build

If the extension already exists outside this repo, pass:
    -HoopsMainPath <path-to-hoops_main.py>
"@
}

function Resolve-ConverterConfigPath {
    if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
        $resolved = ConvertTo-AbsolutePath -Path $ConfigPath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Converter config not found: $resolved"
        }
        return $resolved
    }

    $defaultConfig = Join-Path $RepoRoot "config\ifc-hoops-converter.json"
    if (-not (Test-Path -LiteralPath $defaultConfig -PathType Leaf)) {
        throw "Default converter config not found: $defaultConfig"
    }
    return (Resolve-Path -LiteralPath $defaultConfig).Path
}

function New-ConversionPlan {
    $resolvedOutputDir = ConvertTo-AbsolutePath -Path $OutputDir
    if (-not (Test-Path -LiteralPath $resolvedOutputDir -PathType Container)) {
        New-Item -ItemType Directory -Path $resolvedOutputDir | Out-Null
    }

    $inputs = @(Resolve-IfcInputs -Patterns $IfcPath | Sort-Object FullName)
    if ($inputs.Count -eq 0) {
        throw "No IFC inputs found."
    }

    $outputByPath = @{}
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($inputFile in $inputs) {
        $outName = Expand-OutputName -SourceFile $inputFile -Template $OutputName
        $outPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedOutputDir $outName))

        if ($outputByPath.ContainsKey($outPath)) {
            throw "Multiple IFC files map to the same output: $outPath. Use -OutputName '{source-file-name}.usdc'."
        }
        $outputByPath[$outPath] = $inputFile.FullName

        $status = "missing"
        if (Test-Path -LiteralPath $outPath -PathType Leaf) {
            $outputFile = Get-Item -LiteralPath $outPath
            if ($outputFile.LastWriteTimeUtc -lt $inputFile.LastWriteTimeUtc) {
                $status = "stale"
            }
            else {
                $status = "ready"
            }
        }

        if ($Force) {
            $status = "force"
        }

        $rows.Add([pscustomobject]@{
            Status = $status
            IfcPath = $inputFile.FullName
            OutputPath = $outPath
            KitPath = ConvertTo-KitPath -Path $outPath
        }) | Out-Null
    }

    return $rows.ToArray()
}

function Invoke-KitConversion {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Item
    )

    $kitExe = Find-KitExe
    $hoopsMain = Find-HoopsMain
    $resolvedConfigPath = Resolve-ConverterConfigPath
    $buildRoot = Join-Path $RepoRoot "_build\windows-x86_64\release"
    $wrapperScript = Join-Path $RepoRoot "scripts\kit-cad-convert-and-quit.py"
    if (-not (Test-Path -LiteralPath $wrapperScript -PathType Leaf)) {
        throw "Kit converter wrapper not found: $wrapperScript"
    }

    $execScript = "`"$wrapperScript`" --process-script `"$hoopsMain`" --input-path `"$($Item.IfcPath)`" --output-path `"$($Item.OutputPath)`" --config-path `"$resolvedConfigPath`""
    $kitArgs = @(
        "--ext-folder", (Join-Path $buildRoot "exts"),
        "--ext-folder", (Join-Path $buildRoot "extscache"),
        "--ext-folder", (Join-Path $buildRoot "apps"),
        "--no-window",
        "--enable", "omni.services.convert.cad",
        "--enable", "omni.kit.converter.hoops_core",
        "--exec", $execScript,
        "--/app/fastShutdown=1",
        "--info"
    )

    Write-Host "[ifc-convert] $($Item.IfcPath)"
    Write-Host "[ifc-convert] -> $($Item.OutputPath)"

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new($kitExe)
    $startInfo.UseShellExecute = $false
    $startInfo.WorkingDirectory = $RepoRoot
    foreach ($arg in $kitArgs) {
        $startInfo.ArgumentList.Add($arg) | Out-Null
    }

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if (-not $process) {
        throw "Kit CAD conversion process did not start for $($Item.IfcPath)"
    }

    try {
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw "Kit CAD conversion timed out after $TimeoutSeconds seconds for $($Item.IfcPath)"
        }

        $exitCode = $process.ExitCode
    }
    finally {
        $process.Dispose()
    }

    if ($exitCode -ne 0) {
        throw "Kit CAD conversion failed with exit code $exitCode for $($Item.IfcPath)"
    }
    if (-not (Test-Path -LiteralPath $Item.OutputPath -PathType Leaf)) {
        throw "Kit CAD conversion completed but output was not created: $($Item.OutputPath)"
    }
}

$plan = @(New-ConversionPlan)

if ($Json) {
    $plan | ConvertTo-Json -Depth 4
}
else {
    foreach ($item in $plan) {
        Write-Host "Status : $($item.Status)"
        Write-Host "IFC    : $($item.IfcPath)"
        Write-Host "USDC   : $($item.OutputPath)"
        Write-Host ""
    }
}

if ($PlanOnly) {
    return
}

foreach ($item in $plan) {
    if ($item.Status -eq "ready") {
        Write-Host "[ifc-convert] up-to-date: $($item.OutputPath)"
        continue
    }
    Invoke-KitConversion -Item $item
}
