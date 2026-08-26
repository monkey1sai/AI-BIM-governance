<#
.SYNOPSIS
  Installs git hooks to trigger autonomous PR queue processing on git actions.
.DESCRIPTION
  Installs .git/hooks/post-commit, post-merge, and post-checkout to execute
  node scripts/dev/manage-pr-queue.mjs hook asynchronously.
#>

[CmdletBinding()]
param()

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')
Push-Location $repoRoot.Path
try {
    node (Join-Path $PSScriptRoot 'manage-pr-queue.mjs') install-hooks
}
finally {
    Pop-Location
}
