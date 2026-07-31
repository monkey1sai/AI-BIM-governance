# scripts/lib/self-referential-bootstrap.ps1
# Self-referential change bootstrap: ledger parsing, integrity validation, and the
# PR-time debt gate. Portable rule text lives in docs/agents/self-referential-bootstrap.md.
#
# Design constraints (decision D-7, plan docs/plans/remote-linux-test-deploy-target.plan.md):
# - The rule is a general capability, not a one-off exception: it triggers whenever a PR
#   edits the verification mechanism itself (deploy path / evidence harness / gate script).
# - Enforcement is machine-checked: an unclosed ledger entry blocks the NEXT PR that
#   triggers the same rule, and the only way to clear the debt is to commit fixpoint
#   evidence (which is itself reviewable).
# - The ledger FORMAT is scaffold (portable); the CONTENT is product-owned.

Set-StrictMode -Version Latest

# Paths whose modification means "this PR changes the verification mechanism itself".
# Deliberately narrow: the canonical deploy path, the evidence harnesses, the gate
# scripts that adjudicate evidence, and this mechanism's own files (self-referential).
$script:SelfReferentialMechanismPattern = @(
    '^scripts/deploy\.ps1$'
    '^scripts/verify-all\.ps1$'
    '^scripts/dev/rebuild-test-deploy\.ps1$'
    '^scripts/dev/start-isolated-branch-stack\.ps1$'
    '^scripts/lib/(preflight-[a-z-]+|deploy-report|host-native-launcher|rebuild-test-deploy|start-child-with-environment|kit-log-probe|smoke-evidence)\.ps1$'
    '^scripts/lib/platform/'
    '^scripts/lib/(design-system-gate|pr-review-agent|production-boundary-contract)\.ps1$'
    '^scripts/tests/(check-pr-body-evidence|verify-design-system-reference|verify-design-system-visual-result|verify-openspec-lifecycle)\.ps1$'
    '^scripts/lib/self-referential-bootstrap\.ps1$'
    '^scripts/self-referential-bootstrap-ledger\.json$'
) -join '|'

$script:GenericReasonBlocklist = @(
    'bootstrap', 'needed', 'required', 'self-referential', 'chicken and egg', 'because'
)

function Get-SelfReferentialMechanismPaths {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths)
    return @($ChangedPaths | Where-Object { $_ -match $script:SelfReferentialMechanismPattern })
}

function Test-SelfReferentialIsoTimestamp {
    # ConvertFrom-Json on pwsh 7 eagerly deserializes ISO-8601 strings into [datetime],
    # so accept either representation.
    param([AllowNull()] $Value)
    if ($Value -is [datetime] -or $Value -is [System.DateTimeOffset]) { return $true }
    return ([string]$Value -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')
}

function Get-SelfReferentialBootstrapLedger {
    param([Parameter(Mandatory = $true)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "self_referential_bootstrap: ledger not found at $Path"
    }
    try {
        $ledger = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        throw "self_referential_bootstrap: ledger is not valid JSON: $($_.Exception.Message)"
    }

    if ([string]$ledger.schema_version -ne 'self-referential-bootstrap-ledger/v1') {
        throw "self_referential_bootstrap: unsupported schema_version '$($ledger.schema_version)'."
    }
    if ($null -eq $ledger.PSObject.Properties['entries']) {
        throw 'self_referential_bootstrap: ledger has no entries array.'
    }

    $seen = @{}
    foreach ($entry in @($ledger.entries)) {
        $id = [string]$entry.id
        if ($id -notmatch '^[a-z0-9][a-z0-9-]{2,63}$') {
            throw "self_referential_bootstrap: entry id '$id' must be kebab-case (3-64 chars)."
        }
        if ($seen.ContainsKey($id)) { throw "self_referential_bootstrap: duplicate entry id '$id'." }
        $seen[$id] = $true

        if ([string]$entry.status -notin @('open', 'closed')) {
            throw "self_referential_bootstrap: entry '$id' status must be open or closed."
        }
        if (-not ([int]$entry.pr -gt 0)) {
            throw "self_referential_bootstrap: entry '$id' must record its PR number."
        }
        if (-not (Test-SelfReferentialIsoTimestamp -Value $entry.opened_at)) {
            throw "self_referential_bootstrap: entry '$id' opened_at must be an ISO timestamp."
        }
        Assert-SelfReferentialBootstrapReason -Reason ([string]$entry.reason) -Context "ledger entry '$id'"
        if (@($entry.verification_mechanism_paths).Count -eq 0) {
            throw "self_referential_bootstrap: entry '$id' must list the verification_mechanism_paths it changes."
        }
        $refs = @($entry.bootstrap_evidence_refs)
        if ($refs.Count -eq 0) {
            throw "self_referential_bootstrap: entry '$id' must list bootstrap_evidence_refs."
        }
        foreach ($ref in $refs) {
            if ([string]$ref -notmatch 'self[-_]referential[-_]bootstrap') {
                throw "self_referential_bootstrap: entry '$id' evidence ref '$ref' is not labeled with the self_referential_bootstrap stack kind."
            }
        }

        $fixpoint = $entry.PSObject.Properties['fixpoint']
        $hasFixpoint = ($null -ne $fixpoint) -and ($null -ne $fixpoint.Value)
        if ([string]$entry.status -eq 'open' -and $hasFixpoint) {
            throw "self_referential_bootstrap: open entry '$id' must not carry a fixpoint record."
        }
        if ([string]$entry.status -eq 'closed') {
            if (-not $hasFixpoint) {
                throw "self_referential_bootstrap: closed entry '$id' must carry a complete fixpoint record."
            }
            $fp = $fixpoint.Value
            if (-not (Test-SelfReferentialIsoTimestamp -Value $fp.reverified_at)) {
                throw "self_referential_bootstrap: entry '$id' fixpoint.reverified_at must be an ISO timestamp."
            }
            if ([string]$fp.mechanism_commit -notmatch '^[0-9a-f]{40}$') {
                throw "self_referential_bootstrap: entry '$id' fixpoint.mechanism_commit must be a full 40-hex commit of the merged mechanism."
            }
            if (@($fp.evidence_refs).Count -eq 0) {
                throw "self_referential_bootstrap: entry '$id' fixpoint.evidence_refs must not be empty."
            }
        }
    }
    return $ledger
}

function Assert-SelfReferentialBootstrapReason {
    param(
        [AllowNull()][AllowEmptyString()][string] $Reason,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $trimmed = ([string]$Reason).Trim()
    if ($trimmed.Length -lt 30) {
        throw "self_referential_bootstrap: $Context reason must concretely explain why the pre-change mechanism cannot produce this evidence (>=30 chars)."
    }
    if ($trimmed.ToLowerInvariant() -in $script:GenericReasonBlocklist) {
        throw "self_referential_bootstrap: $Context reason is generic; name the mechanism gap explicitly."
    }
}

function Assert-SelfReferentialBootstrapBody {
    param(
        [Parameter(Mandatory = $true)][string] $Body,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][string] $LedgerPath,
        [Parameter(Mandatory = $true)][scriptblock] $GetTableValue
    )

    $mechanismPaths = @(Get-SelfReferentialMechanismPaths -ChangedPaths $ChangedPaths)
    if ($mechanismPaths.Count -eq 0) { return }

    # Integrity first: a malformed ledger fails closed before any gating decision.
    $ledger = Get-SelfReferentialBootstrapLedger -Path $LedgerPath
    $openEntries = @(@($ledger.entries) | Where-Object { [string]$_.status -eq 'open' })

    $declared = & $GetTableValue $Body 'Self-referential bootstrap'
    if ([string]::IsNullOrWhiteSpace($declared)) {
        throw "This PR changes the verification mechanism ($($mechanismPaths -join ', ')); the PR body must declare 'Self-referential bootstrap' as yes or no."
    }
    $declared = $declared.Trim().ToLowerInvariant()
    if ($declared -notin @('yes', 'no')) {
        throw "PR body 'Self-referential bootstrap' must be yes or no; actual='$declared'."
    }

    if ($declared -eq 'no') {
        if ($openEntries.Count -gt 0) {
            $ids = @($openEntries | ForEach-Object { [string]$_.id }) -join ', '
            throw "self_referential_bootstrap: open ledger debt ($ids) blocks further verification-mechanism PRs until fixpoint evidence is committed."
        }
        return
    }

    $entryId = ([string](& $GetTableValue $Body 'Bootstrap ledger entry')).Trim()
    $reason = ([string](& $GetTableValue $Body 'Bootstrap reason')).Trim()
    if ([string]::IsNullOrWhiteSpace($entryId)) {
        throw "PR body 'Bootstrap ledger entry' must name the ledger entry id added by this PR."
    }
    Assert-SelfReferentialBootstrapReason -Reason $reason -Context "PR body 'Bootstrap reason'"

    $entry = @($ledger.entries) | Where-Object { [string]$_.id -eq $entryId } | Select-Object -First 1
    if ($null -eq $entry) {
        throw "self_referential_bootstrap: PR body names ledger entry '$entryId' but the ledger does not contain it; the PR must add its own open entry."
    }
    if ([string]$entry.status -ne 'open') {
        throw "self_referential_bootstrap: ledger entry '$entryId' must be open while its originating PR is in flight."
    }

    $otherOpen = @($openEntries | Where-Object { [string]$_.id -ne $entryId })
    if ($otherOpen.Count -gt 0) {
        $ids = @($otherOpen | ForEach-Object { [string]$_.id }) -join ', '
        throw "self_referential_bootstrap: open ledger debt ($ids) blocks further verification-mechanism PRs until fixpoint evidence is committed."
    }
}
