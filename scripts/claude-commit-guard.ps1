[CmdletBinding()]
param()

$ErrorActionPreference = "SilentlyContinue"

$payloadText = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($payloadText)) {
    exit 0
}

try {
    $payload = $payloadText | ConvertFrom-Json -ErrorAction Stop
} catch {
    exit 0
}

$command = ""
if ($payload.tool_input -and $payload.tool_input.command) {
    $command = [string] $payload.tool_input.command
}

if ($command -match '(^|\s)git(\.exe)?\s+commit(\s|$)') {
    [Console]::Error.WriteLine("[commit-guard] 提交前確認：(1) 已跑 verify (2) 已檢查 diff 範圍 (3) commit message scope 對應改動 repo")
}

exit 0
