# Synthetic-only deployment wiring checks; never source the deploy entrypoint.
. (Join-Path $PSScriptRoot 'test-helpers.ps1')
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'scripts/lib/preflight-env.ps1')
$deploy = Join-Path $repoRoot 'scripts/deploy.ps1'
$parseTokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($deploy, [ref]$parseTokens, [ref]$parseErrors)
Assert-Equal 0 @($parseErrors).Count 'deploy syntax'
foreach ($name in @('Resolve-ConversionInternalToken', 'Get-DeploySecretFingerprint', 'New-ConversionRuntimeSignature', 'New-WebPlaneRuntimeSignature')) {
    $functions = @($ast.FindAll({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }.GetNewClosure(), $true))
    Assert-Equal 1 $functions.Count "one $name helper"
    . ([scriptblock]::Create($functions[0].Extent.Text))
}
$sandbox = Join-Path $repoRoot "scripts/.run/conversion-auth-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $sandbox | Out-Null
$envPath = Join-Path $sandbox 'synthetic.env'
$emptyEnv = Join-Path $sandbox 'empty.env'
$tokenA = 'fixture-only-conversion-A'
$tokenB = 'fixture-only-conversion-B'
try {
    Set-Content -LiteralPath $emptyEnv -Value '' -Encoding utf8
    Set-Content -LiteralPath $envPath -Value 'OTHER=value' -Encoding utf8
    Assert-Equal $tokenA (Resolve-ConversionInternalToken -EnvFile $envPath -ProcessValue $tokenA) 'absent file key uses process fallback'
    Set-Content -LiteralPath $envPath -Value 'STREAMING_CONVERSION_INTERNAL_TOKEN=' -Encoding utf8
    Assert-True ([string]::IsNullOrEmpty((Resolve-ConversionInternalToken -EnvFile $envPath -ProcessValue $tokenA))) 'explicit empty file revokes inherited token'
    Set-Content -LiteralPath $envPath -Value "STREAMING_CONVERSION_INTERNAL_TOKEN='$tokenB'" -Encoding utf8
    $resolved = Resolve-ConversionInternalToken -EnvFile $envPath -ProcessValue $tokenA
    Assert-Equal $tokenB $resolved 'file wins over inherited value'
    Set-Content -LiteralPath $envPath -Value "STREAMING_CONVERSION_INTERNAL_TOKEN=' $tokenB '" -Encoding utf8
    Assert-Throws { Resolve-ConversionInternalToken -EnvFile $envPath -ProcessValue $tokenA } 'quoted whitespace is rejected, not trimmed'
    foreach ($invalid in @('contains space', "two`nlines", "two`rlines", "tab`tvalue", '非ASCII')) {
        Assert-Throws { Resolve-ConversionInternalToken -EnvFile $emptyEnv -ProcessValue $invalid } 'invalid header value is rejected'
    }
    Write-TestPass 'explicit blank, precedence and header-safe input'

    $conversion = @{ BindHost='127.0.0.1'; Port=49101; HealthHost='127.0.0.1'; ArtifactsRoot='/fixture/artifacts'; Revision=('1'*40) }
    $web = @{ A4ConversionArtifactsHostRoot='/fixture/artifacts'; A4InternalContextTokenFingerprint='unconfigured'; SessionIdleTimeoutMs=''; ConversionTriggerIpAllowlistFingerprint='unconfigured' }
    foreach ($signature in @(
        @{ Name='conversion'; Invoke={ param($fingerprint) New-ConversionRuntimeSignature @conversion -InternalConversionTokenFingerprint $fingerprint }.GetNewClosure() },
        @{ Name='web'; Invoke={ param($fingerprint) New-WebPlaneRuntimeSignature @web -InternalConversionTokenFingerprint $fingerprint }.GetNewClosure() }
    )) {
        $a = & $signature.Invoke (Get-DeploySecretFingerprint -Value $tokenA)
        $same = & $signature.Invoke (Get-DeploySecretFingerprint -Value $tokenA)
        $b = & $signature.Invoke (Get-DeploySecretFingerprint -Value $tokenB)
        $cleared = & $signature.Invoke 'unconfigured'
        Assert-Equal $a $same "$($signature.Name): same configuration is stable"
        Assert-True ($a -ne $b -and $b -ne $cleared -and $a -ne $cleared) "$($signature.Name): rotation and clearing require reload"
        Assert-True (-not $a.Contains($tokenA) -and -not $b.Contains($tokenB)) "$($signature.Name): no raw token in signature"
    }
    Write-TestPass 'both service signatures track rotation and removal without raw values'

    # A real child receives the resolved value via environment, never argv.
    function Invoke-SyntheticChild {
        param([string] $FilePath, [string[]] $Arguments, [string] $Value)
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $FilePath
        $start.WorkingDirectory = $repoRoot
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
        if ($Value) { Assert-True (-not ($Arguments -join ' ').Contains($Value)) 'raw configuration is absent from child argv' }
        if ($Value) { $start.Environment['STREAMING_CONVERSION_INTERNAL_TOKEN'] = $Value }
        else { [void]$start.Environment.Remove('STREAMING_CONVERSION_INTERNAL_TOKEN') }
        $process = [Diagnostics.Process]::Start($start)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { throw 'Synthetic child timed out; no pass.' }
        $result = $stdout.GetAwaiter().GetResult()
        [void]$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'Synthetic child failed; raw output withheld.' }
        $process.Dispose()
        return $result
    }
    $childCode = '[string]::IsNullOrEmpty($env:STREAMING_CONVERSION_INTERNAL_TOKEN)'
    $pwsh = (Get-Process -Id $PID).Path
    Assert-Equal 'False' (Invoke-SyntheticChild -FilePath $pwsh -Arguments @('-NoProfile','-NonInteractive','-Command',$childCode) -Value $resolved).Trim() 'host child receives nonempty resolved configuration'
    Assert-Equal 'True' (Invoke-SyntheticChild -FilePath $pwsh -Arguments @('-NoProfile','-NonInteractive','-Command',$childCode) -Value '').Trim() 'host child clears configuration'
    $hashCode = '[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($env:STREAMING_CONVERSION_INTERNAL_TOKEN)))'
    $expectedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($resolved)))
    Assert-Equal $expectedHash (Invoke-SyntheticChild -FilePath $pwsh -Arguments @('-NoProfile','-NonInteractive','-Command',$hashCode) -Value $resolved).Trim() 'host child receives exact configuration bytes'
    $docker = (Get-Command docker -ErrorAction Stop).Source
    foreach ($files in @(
        @('-f',(Join-Path $repoRoot 'compose.runtime-manager.yml')),
        @('-f',(Join-Path $repoRoot 'compose.runtime-manager.yml'),'-f',(Join-Path $repoRoot 'compose.host-kit.yml'))
    )) {
        foreach ($value in @($resolved, '')) {
            $arguments = @('compose','--env-file',$emptyEnv,'--project-name','conversion-auth-fixture') + $files + @('config','--format','json')
            $rendered = Invoke-SyntheticChild -FilePath $docker -Arguments $arguments -Value $value | ConvertFrom-Json
            Assert-True ([string]$rendered.services.coordinator.environment.STREAMING_CONVERSION_INTERNAL_TOKEN -ceq $value) 'coordinator receives exactly the same parsed value or blank'
        }
    }
    Write-TestPass 'actual compose rendering and child environment agree for configured and empty values'
} finally {
    # Only the two files and empty directory created above may be removed.
    $resolvedSandbox = (Resolve-Path -LiteralPath $sandbox).Path
    $runRoot = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'scripts/.run')).Path
    if (-not $resolvedSandbox.StartsWith($runRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test cleanup target' }
    foreach ($file in @($envPath, $emptyEnv)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
    Remove-Item -LiteralPath $resolvedSandbox
}
