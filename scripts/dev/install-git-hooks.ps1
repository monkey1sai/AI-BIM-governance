<#
.SYNOPSIS
  Compatibility shim for the retired repository-controlled Git hook installer.
.DESCRIPTION
  Git hook installation is intentionally disabled. Use explicit agents-board
  lifecycle commands; existing legacy hooks are never overwritten here.
#>

[CmdletBinding()]
param()

Write-Error 'HELD: repository-controlled Git hook installation is disabled; use explicit lifecycle commands.'
exit 2
