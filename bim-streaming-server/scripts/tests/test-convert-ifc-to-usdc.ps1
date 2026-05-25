[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$ScriptPath = Join-Path $RepoRoot "scripts\convert-ifc-to-usdc.ps1"
$FixtureDir = Join-Path $RepoRoot "_test_ifc_data"
$FixturePath = Join-Path $FixtureDir "許良宇圖書館建築_2026.ifc"
$CreatedFixtureDir = $false
$CreatedFixtureFile = $false

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool] $Condition,

        [Parameter(Mandatory = $true)]
        [string] $Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Invoke-JsonPlan {
    param(
        [Parameter(Mandatory = $true)]
        [string] $OutputNameParameter
    )

    Push-Location $RepoRoot
    try {
        if ($OutputNameParameter -eq "OutputNamne") {
            $json = & $ScriptPath -IfcPath ".\_test_ifc_data\*.ifc" -OutputNamne "{source-file-name}.usdc" -OutputDir ".\bim-models" -PlanOnly -Json
        }
        else {
            $json = & $ScriptPath -IfcPath ".\_test_ifc_data\*.ifc" -OutputName "{source-file-name}.usdc" -OutputDir ".\bim-models" -PlanOnly -Json
        }
    }
    finally {
        Pop-Location
    }

    return $json | ConvertFrom-Json
}

Assert-True (Test-Path -LiteralPath $ScriptPath -PathType Leaf) "Expected converter script to exist: $ScriptPath"

try {
    if (-not (Test-Path -LiteralPath $FixtureDir -PathType Container)) {
        New-Item -ItemType Directory -Path $FixtureDir | Out-Null
        $CreatedFixtureDir = $true
    }
    if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)) {
        Set-Content -LiteralPath $FixturePath -Encoding UTF8 -Value @(
            "ISO-10303-21;",
            "HEADER;",
            "FILE_DESCRIPTION(('test fixture'),'2;1');",
            "FILE_NAME('fixture.ifc','2026-05-25T00:00:00',('AI-BIM'),('AI-BIM'),'','','');",
            "FILE_SCHEMA(('IFC4'));",
            "ENDSEC;",
            "DATA;",
            "ENDSEC;",
            "END-ISO-10303-21;"
        )
        $CreatedFixtureFile = $true
    }

    $plan = @(Invoke-JsonPlan -OutputNameParameter "OutputName")
    Assert-True ($plan.Count -eq 1) "Expected exactly one IFC plan item."
    Assert-True ($plan[0].IfcPath.EndsWith("_test_ifc_data\許良宇圖書館建築_2026.ifc")) "Expected test IFC path in plan."
    Assert-True ($plan[0].OutputPath.EndsWith("bim-models\許良宇圖書館建築_2026.usdc")) "Expected {source-file-name}.usdc mapping."

    $expectedStatus = "missing"
    if (Test-Path -LiteralPath $plan[0].OutputPath -PathType Leaf) {
        $sourceFile = Get-Item -LiteralPath $plan[0].IfcPath
        $outputFile = Get-Item -LiteralPath $plan[0].OutputPath
        if ($outputFile.LastWriteTimeUtc -lt $sourceFile.LastWriteTimeUtc) {
            $expectedStatus = "stale"
        }
        else {
            $expectedStatus = "ready"
        }
    }
    Assert-True ($plan[0].Status -eq $expectedStatus) "Expected status $expectedStatus for current IFC/USDC timestamps."

    $aliasPlan = @(Invoke-JsonPlan -OutputNameParameter "OutputNamne")
    Assert-True ($aliasPlan[0].OutputPath -eq $plan[0].OutputPath) "Expected OutputNamne alias to map the same output path."
}
finally {
    if ($CreatedFixtureFile -and (Test-Path -LiteralPath $FixturePath -PathType Leaf)) {
        Remove-Item -LiteralPath $FixturePath -Force
    }
    if ($CreatedFixtureDir -and (Test-Path -LiteralPath $FixtureDir -PathType Container)) {
        Remove-Item -LiteralPath $FixtureDir -Force
    }
}

Write-Host "convert-ifc-to-usdc tests passed"
