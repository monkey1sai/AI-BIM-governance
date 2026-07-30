[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Executable,
    [Parameter(Mandatory)][string] $PayloadBase64,
    [Parameter(Mandatory)][string] $EntrypointMarker,
    [Parameter(Mandatory)][ValidateSet('governance','coordinator')][string] $Role,
    [Parameter(Mandatory)][string] $ExpectedPortMarkerBase64,
    [Parameter(Mandatory)][ValidateRange(1,65535)][int] $ExpectedPort,
    [Parameter(Mandatory)][string] $BindingMarker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$payloadText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
$payload = $payloadText | ConvertFrom-Json -AsHashtable -Depth 8
if ($payload -isnot [Collections.IDictionary] -or
    $payload.environment -isnot [Collections.IDictionary] -or
    $payload.arguments -isnot [Collections.IEnumerable]) {
    throw 'Isolated child payload is malformed.'
}

$childArguments = @($payload.arguments | ForEach-Object { [string]$_ })
if (-not ($childArguments -ccontains $EntrypointMarker)) {
    throw 'Isolated child payload is not bound to the expected entrypoint.'
}

$expectedPortMarker = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExpectedPortMarkerBase64))
$rolePortMarker = if ($Role -eq 'governance') { '--port' } else { '--isolated-stack-port' }
$forbiddenPortMarker = if ($Role -eq 'governance') { '--isolated-stack-port' } else { '--port' }
$markerIndexes = @(
    for ($index = 0; $index -lt $childArguments.Count; $index++) {
        if ($childArguments[$index] -ceq $expectedPortMarker) { $index }
    }
)
$expectedBindingMarker = "isolated-$Role-port-$ExpectedPort $expectedPortMarker $ExpectedPort"
if ($expectedPortMarker -cne $rolePortMarker -or
    $markerIndexes.Count -ne 1 -or
    @($childArguments | Where-Object { $_ -ceq $forbiddenPortMarker }).Count -ne 0 -or
    [int]$markerIndexes[0] + 1 -ge $childArguments.Count -or
    [string]$childArguments[[int]$markerIndexes[0] + 1] -cne [string]$ExpectedPort -or
    $BindingMarker -cne $expectedBindingMarker) {
    throw 'Isolated child payload is not bound to the expected backend port.'
}

foreach ($entry in $payload.environment.GetEnumerator()) {
    $name = [string]$entry.Key
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains('=')) {
        throw 'Isolated child environment contains an invalid variable name.'
    }
    [Environment]::SetEnvironmentVariable($name, [string]$entry.Value, 'Process')
}

& $Executable @childArguments
if ($LASTEXITCODE -is [int]) { exit $LASTEXITCODE }
if (-not $?) { exit 1 }
