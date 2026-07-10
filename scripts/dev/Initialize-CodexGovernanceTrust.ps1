[CmdletBinding()]
param([Parameter(Mandatory)][string]$CandidatePath,[Parameter(Mandatory)][string]$AllowlistPath,[Parameter(Mandatory)][string]$SealPath)
. (Join-Path $PSScriptRoot '..\lib\codex-governance\Maintenance.Trust.ps1')
$allow=Get-Content $AllowlistPath -Raw|ConvertFrom-Json; $candidate=Get-Content $CandidatePath -Raw|ConvertFrom-Json
$trusted=New-TrustedInventory -Candidate $candidate -Allowlist $allow
$json=Get-CanonicalJsonBytes $trusted; [IO.File]::WriteAllBytes($AllowlistPath+'.candidate.tmp',$json)
Seal-Allowlist -AllowlistPath ($AllowlistPath+'.candidate.tmp') -SealPath $SealPath | Out-Null
Move-Item ($AllowlistPath+'.candidate.tmp') $AllowlistPath -Force
Write-Output 'foreground trust onboarding complete'
