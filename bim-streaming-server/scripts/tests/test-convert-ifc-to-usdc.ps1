[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$ScriptPath = Join-Path $RepoRoot "scripts\convert-ifc-to-usdc.ps1"

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

$plan = Invoke-JsonPlan -OutputNameParameter "OutputName"
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

$aliasPlan = Invoke-JsonPlan -OutputNameParameter "OutputNamne"
Assert-True ($aliasPlan[0].OutputPath -eq $plan[0].OutputPath) "Expected OutputNamne alias to map the same output path."

Write-Host "convert-ifc-to-usdc tests passed"
