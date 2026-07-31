# scripts/lib/self-referential-bootstrap.ps1
# Self-referential change bootstrap: ledger parsing, integrity validation, and the
# PR-time debt gate. Portable rule text lives in docs/agents/self-referential-bootstrap.md.
#
# Design constraints (decision D-7, plan docs/plans/remote-linux-test-deploy-target.plan.md):
# - The rule is a general capability, not a one-off exception: it triggers whenever a PR
#   edits the verification mechanism itself (deploy path / evidence harness / gate script /
#   the workflows that enforce this gate).
# - Enforcement is machine-checked AGAINST THE BASE: the gate evaluates the ledger
#   transition from the PR base to the PR head. Deleting or mutating entries, impersonating
#   an earlier PR's entry, or fabricating a fixpoint all fail closed (PR #459 review round).
# - The ledger FORMAT is scaffold (portable); the CONTENT is product-owned.

Set-StrictMode -Version Latest

# Paths whose modification means "this PR changes the verification mechanism itself".
# Includes the workflows and the verification manifest that enforce the gate: editing
# the enforcement surface IS editing the mechanism.
$script:SelfReferentialMechanismPattern = @(
    '^scripts/deploy\.ps1$'
    '^scripts/verify-all\.ps1$'
    '^scripts/dev/rebuild-test-deploy\.ps1$'
    '^scripts/dev/start-isolated-branch-stack\.ps1$'
    '^scripts/lib/(preflight-[a-z-]+|deploy-report|host-native-launcher|rebuild-test-deploy|start-child-with-environment|kit-log-probe|smoke-evidence)\.ps1$'
    '^scripts/lib/platform/'
    '^scripts/lib/(design-system-gate|pr-review-agent|production-boundary-contract)\.ps1$'
    '^scripts/tests/(check-pr-body-evidence|verify-design-system-reference|verify-design-system-visual-result|verify-functional-runtime-result|verify-security-exceptions|verify-openspec-lifecycle)\.ps1$'
    '^scripts/tests/verify-openspec-machine-truth\.mjs$'
    '^scripts/lib/self-referential-bootstrap\.ps1$'
    '^scripts/self-referential-bootstrap-ledger\.json$'
    '^\.github/workflows/(agent-governance|pr-review-agent|ci)\.yml$'
    '^scripts/verification-manifest\.json$'
    '^scripts/dev/check-pr-local-preflight\.ps1$'
    '^scripts/hooks/require-gstack-evidence\.ps1$'
) -join '|'

$script:GenericReasonBlocklist = @(
    'bootstrap', 'needed', 'required', 'self-referential', 'chicken', 'egg', 'because', 'necessary'
)

function Get-SelfReferentialMechanismPaths {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths)
    return @($ChangedPaths | Where-Object { $_ -match $script:SelfReferentialMechanismPattern })
}

function ConvertTo-SelfReferentialTimestamp {
    # Callers must have validated with Test-SelfReferentialIsoTimestamp first.
    param([Parameter(Mandatory = $true)] $Value)
    if ($Value -is [System.DateTimeOffset]) { return $Value }
    if ($Value -is [datetime]) { return [System.DateTimeOffset]::new($Value.ToUniversalTime(), [TimeSpan]::Zero) }
    return [System.DateTimeOffset]::Parse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::AssumeUniversal)
}

function Test-SelfReferentialIsoTimestamp {
    # Real ISO-8601 parse, anchored - '2026-99-99T99:99:99garbage' must not pass.
    # pwsh 7 ConvertFrom-Json eagerly deserializes ISO strings into [datetime],
    # so native datetime values are accepted as already-parsed.
    param([AllowNull()] $Value)
    if ($Value -is [datetime] -or $Value -is [System.DateTimeOffset]) { return $true }
    $text = [string]$Value
    $parsed = [DateTimeOffset]::MinValue
    $formats = @(
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
        "yyyy-MM-dd'T'HH:mm:sszzz",
        "yyyy-MM-dd'T'HH:mm:ss.fffzzz"
    )
    return [DateTimeOffset]::TryParseExact(
        $text, [string[]]$formats,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::AssumeUniversal,
        [ref]$parsed)
}

function Assert-SelfReferentialBootstrapReason {
    # Length alone is gameable ('bootstrap bootstrap bootstrap bootstrap'), so the
    # reason must also carry lexical diversity and must not be dominated by the
    # generic blocklist vocabulary.
    param(
        [AllowNull()][AllowEmptyString()][string] $Reason,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $trimmed = ([string]$Reason).Trim()
    if ($trimmed.Length -lt 30) {
        throw "self_referential_bootstrap: $Context reason must concretely explain why the pre-change mechanism cannot produce this evidence (>=30 chars)."
    }
    # CJK prose is the normal documentation language in this repository and does
    # not use whitespace word boundaries: substance is judged on ideograph count.
    $cjkCount = ([regex]::Matches($trimmed, '\p{IsCJKUnifiedIdeographs}')).Count
    if ($cjkCount -ge 12) { return }
    # Otherwise: strip punctuation (Unicode-aware, so accented and non-Latin
    # letters survive) before blocklist/diversity checks, so 'bootstrap, needed.'
    # still hits the blocklist and padded phrases cannot fake diversity.
    $tokens = @($trimmed.ToLowerInvariant() -split '\s+' |
        ForEach-Object { $_ -replace '[^\p{L}\p{Nd}-]', '' } | Where-Object { $_ })
    $distinct = @($tokens | Sort-Object -Unique)
    if ($tokens.Count -lt 6 -or $distinct.Count -lt 5) {
        throw "self_referential_bootstrap: $Context reason lacks substance (needs >=6 words, >=5 distinct, or >=12 CJK ideographs); padded phrases are rejected."
    }
    $nonGeneric = @($distinct | Where-Object { $_ -notin $script:GenericReasonBlocklist })
    if ($nonGeneric.Count -lt 4) {
        throw "self_referential_bootstrap: $Context reason is dominated by generic vocabulary; name the mechanism gap explicitly."
    }
}

function Get-SelfReferentialBootstrapLedger {
    # Single-ledger integrity validation (fail closed on malformed input).
    # Accepts a -Json string or a -Path; transition rules live in
    # Compare-SelfReferentialLedgerTransition.
    param(
        [string] $Path = '',
        [AllowEmptyString()][string] $Json = ''
    )

    if ([string]::IsNullOrWhiteSpace($Json)) {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            throw "self_referential_bootstrap: ledger not found at $Path"
        }
        $Json = Get-Content -LiteralPath $Path -Raw
    }
    try {
        $ledger = $Json | ConvertFrom-Json
    } catch {
        throw "self_referential_bootstrap: ledger is not valid JSON: $($_.Exception.Message)"
    }

    # ConvertFrom-Json eagerly materializes ISO-looking strings as [datetime],
    # which would let lenient variants (e.g. missing timezone) bypass the
    # anchored format check below. Validate the RAW string tokens first.
    foreach ($match in [regex]::Matches($Json, '"(?:opened_at|reverified_at)"\s*:\s*"([^"]*)"')) {
        $rawTimestamp = $match.Groups[1].Value
        if (-not (Test-SelfReferentialIsoTimestamp -Value $rawTimestamp)) {
            throw "self_referential_bootstrap: timestamp '$rawTimestamp' is not an allowed anchored ISO-8601 form (raw-string validation)."
        }
    }

    if ([string]$ledger.schema_version -ne 'self-referential-bootstrap-ledger/v1') {
        throw "self_referential_bootstrap: unsupported schema_version '$($ledger.schema_version)'."
    }
    $entriesProperty = $ledger.PSObject.Properties['entries']
    if ($null -eq $entriesProperty -or $null -eq $entriesProperty.Value -or
        -not ($entriesProperty.Value -is [System.Collections.IList])) {
        throw 'self_referential_bootstrap: ledger entries must be an array (null/object forms are rejected).'
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
        # Native integral JSON number only: '"pr": "500"' and 'pr: 500.4' both
        # coerce to a passing [int] but are not schema-conformant bindings.
        $prValue = $entry.pr
        $isIntegral = ($prValue -is [int]) -or ($prValue -is [int64]) -or
            (($prValue -is [double] -or $prValue -is [decimal]) -and ([math]::Floor([double]$prValue) -eq [double]$prValue))
        if (-not $isIntegral -or ([int64]$prValue) -le 0) {
            throw "self_referential_bootstrap: entry '$id' pr must be a positive native integer (strings and fractions are rejected)."
        }
        if (-not (Test-SelfReferentialIsoTimestamp -Value $entry.opened_at)) {
            throw "self_referential_bootstrap: entry '$id' opened_at must be a valid ISO-8601 timestamp."
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
                throw "self_referential_bootstrap: entry '$id' fixpoint.reverified_at must be a valid ISO-8601 timestamp."
            }
            if ((ConvertTo-SelfReferentialTimestamp $fp.reverified_at) -le (ConvertTo-SelfReferentialTimestamp $entry.opened_at)) {
                throw "self_referential_bootstrap: entry '$id' fixpoint.reverified_at must be after opened_at; a fixpoint cannot predate its debt."
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

function ConvertTo-SelfReferentialCanonicalEntry {
    param([Parameter(Mandatory = $true)] $Entry)
    return ($Entry | ConvertTo-Json -Depth 8 -Compress)
}

function Assert-SelfReferentialEvidenceBlob {
    # Evidence must be a COMMITTED file at the PR HEAD SHA: 'git cat-file -t
    # <head>:<ref>' must say blob. Filesystem Test-Path would accept '.',
    # directories, and untracked workflow artifacts; ambient HEAD would accept
    # blobs that only exist in the synthetic pull-request merge tree.
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Ref,
        [Parameter(Mandatory = $true)][string] $Context,
        [string] $HeadSha = ''
    )
    $revision = if ([string]::IsNullOrWhiteSpace($HeadSha)) { 'HEAD' } else { $HeadSha }
    $objectType = (& git -C $RepoRoot cat-file -t "${revision}:$Ref" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $objectType -ne 'blob') {
        throw "self_referential_bootstrap: $Context evidence ref '$Ref' is not a committed file at the PR head revision (got '$objectType')."
    }
}

function Compare-SelfReferentialLedgerTransition {
    # Evaluates the base -> head ledger transition. The ledger is append-only and
    # entries are immutable except for the single legal open -> closed transition:
    #   removed entry                  -> violation (deleting debt is the attack)
    #   mutated entry (any field)      -> violation
    #   open -> closed                 -> fixpoint must be real (see below)
    #   new entry                      -> must be open, self-registered to THIS PR,
    #                                     and scoped to this PR's changed paths
    # Returns @{ NewEntries; ClosedEntries; OpenDebt } where OpenDebt is the union
    # of base-open entries not legally closed and head-open entries.
    param(
        [Parameter(Mandatory = $true)] $BaseLedger,
        [Parameter(Mandatory = $true)] $HeadLedger,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths,
        [int] $PrNumber = 0,
        [string] $RepoRoot = '',
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    $baseById = @{}
    foreach ($entry in @($BaseLedger.entries)) { $baseById[[string]$entry.id] = $entry }
    $headById = @{}
    foreach ($entry in @($HeadLedger.entries)) { $headById[[string]$entry.id] = $entry }

    foreach ($id in $baseById.Keys) {
        if (-not $headById.ContainsKey($id)) {
            throw "self_referential_bootstrap: ledger entry '$id' was removed; the ledger is append-only and debt cannot be deleted."
        }
    }

    $newEntries = @()
    $closedEntries = @()
    foreach ($id in $headById.Keys) {
        $head = $headById[$id]
        if (-not $baseById.ContainsKey($id)) {
            if ([string]$head.status -ne 'open') {
                throw "self_referential_bootstrap: new entry '$id' must be born open; opening and closing debt in the same PR defeats the fixpoint obligation."
            }
            if ($PrNumber -gt 0 -and [int]$head.pr -ne $PrNumber) {
                throw "self_referential_bootstrap: new entry '$id' records pr=$($head.pr) but this is PR #$PrNumber; entries must bind to their originating PR."
            }
            $undeclaredPaths = @(@($head.verification_mechanism_paths) | Where-Object { $_ -notin $ChangedPaths })
            if ($undeclaredPaths.Count -gt 0) {
                throw "self_referential_bootstrap: new entry '$id' claims mechanism paths this PR does not change: $($undeclaredPaths -join ', ')."
            }
            if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
                foreach ($ref in @($head.bootstrap_evidence_refs)) {
                    Assert-SelfReferentialEvidenceBlob -RepoRoot $RepoRoot -Ref ([string]$ref) -Context "new entry '$id'" -HeadSha $HeadSha
                }
            }
            $newEntries += $head
            continue
        }

        $base = $baseById[$id]
        $baseStatus = [string]$base.status
        $headStatus = [string]$head.status
        if ($baseStatus -eq 'closed') {
            if ((ConvertTo-SelfReferentialCanonicalEntry $base) -ne (ConvertTo-SelfReferentialCanonicalEntry $head)) {
                throw "self_referential_bootstrap: closed entry '$id' was modified; closed entries are immutable."
            }
            continue
        }
        # base open
        if ($headStatus -eq 'open') {
            if ((ConvertTo-SelfReferentialCanonicalEntry $base) -ne (ConvertTo-SelfReferentialCanonicalEntry $head)) {
                throw "self_referential_bootstrap: open entry '$id' was modified; the only legal transition is open -> closed with a real fixpoint."
            }
            continue
        }
        # open -> closed: the fixpoint must be real, not merely well-formed.
        $baseComparable = $base | Select-Object -Property * -ExcludeProperty status, fixpoint
        $headComparable = $head | Select-Object -Property * -ExcludeProperty status, fixpoint
        if ((ConvertTo-SelfReferentialCanonicalEntry $baseComparable) -ne (ConvertTo-SelfReferentialCanonicalEntry $headComparable)) {
            throw "self_referential_bootstrap: entry '$id' fields other than status/fixpoint changed during closure; entries are immutable."
        }
        $fp = $head.fixpoint
        if ([string]::IsNullOrWhiteSpace($BaseSha) -or [string]::IsNullOrWhiteSpace($RepoRoot)) {
            throw "self_referential_bootstrap: closing entry '$id' requires base context (BaseSha + RepoRoot) to verify the fixpoint commit is merged; refusing format-only closure."
        }
        $commit = [string]$fp.mechanism_commit
        & git -C $RepoRoot cat-file -e "$commit^{commit}" 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "self_referential_bootstrap: entry '$id' fixpoint.mechanism_commit $commit does not exist in this repository."
        }
        & git -C $RepoRoot merge-base --is-ancestor $commit $BaseSha 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "self_referential_bootstrap: entry '$id' fixpoint.mechanism_commit $commit is not an ancestor of the PR base; the fixpoint must run on the MERGED mechanism."
        }
        foreach ($ref in @($fp.evidence_refs)) {
            Assert-SelfReferentialEvidenceBlob -RepoRoot $RepoRoot -Ref ([string]$ref) -Context "entry '$id' fixpoint" -HeadSha $HeadSha
        }
        $closedEntries += $head
    }

    # Debt is computed over the UNION of base and head: a base-open entry counts
    # until it is legally closed, no matter what the head ledger claims.
    $openDebt = @()
    foreach ($id in $headById.Keys) {
        if ([string]$headById[$id].status -eq 'open') { $openDebt += $headById[$id] }
    }
    return [pscustomobject]@{
        NewEntries    = @($newEntries)
        ClosedEntries = @($closedEntries)
        OpenDebt      = @($openDebt)
    }
}

function Assert-SelfReferentialBootstrapBody {
    param(
        [Parameter(Mandatory = $true)][string] $Body,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths,
        [Parameter(Mandatory = $true)][string] $LedgerPath,
        [Parameter(Mandatory = $true)][scriptblock] $GetTableValue,
        [AllowEmptyString()][string] $BaseLedgerJson = '',
        [bool] $HasBaseContext = $false,
        [int] $PrNumber = 0,
        [string] $RepoRoot = '',
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    $mechanismPaths = @(Get-SelfReferentialMechanismPaths -ChangedPaths $ChangedPaths)
    if ($mechanismPaths.Count -eq 0) { return }

    # Integrity first: a malformed head ledger fails closed before any gating
    # decision. When the head SHA is known, the ledger is read from that exact
    # revision - never from the ambient checkout, which in a pull_request job is
    # the synthetic merge tree.
    if (-not [string]::IsNullOrWhiteSpace($HeadSha) -and -not [string]::IsNullOrWhiteSpace($RepoRoot)) {
        $headLedgerJson = (& git -C $RepoRoot show "${HeadSha}:scripts/self-referential-bootstrap-ledger.json" 2>$null) -join "`n"
        if ($LASTEXITCODE -ne 0) {
            throw "self_referential_bootstrap: ledger missing at the PR head revision $HeadSha."
        }
        $headLedger = Get-SelfReferentialBootstrapLedger -Json $headLedgerJson
    } else {
        $headLedger = Get-SelfReferentialBootstrapLedger -Path $LedgerPath
    }

    # The transition can only be judged against the base. Without base context the
    # deletion/impersonation/forged-closure checks are blind, so any PR that touches
    # the ledger (or whose head ledger carries entries) fails closed.
    $ledgerTouched = [bool](@($ChangedPaths | Where-Object { $_ -eq 'scripts/self-referential-bootstrap-ledger.json' }).Count)
    if (-not $HasBaseContext) {
        if ($ledgerTouched -or @($headLedger.entries).Count -gt 0) {
            throw 'self_referential_bootstrap: base context (BaseSha) is required to evaluate the ledger transition; refusing head-only evaluation.'
        }
        $baseLedger = $headLedger
    } elseif ([string]::IsNullOrWhiteSpace($BaseLedgerJson)) {
        # Ledger did not exist at base: every head entry is new.
        $baseLedger = [pscustomobject]@{
            schema_version = 'self-referential-bootstrap-ledger/v1'
            entries        = @()
        }
    } else {
        $baseLedger = Get-SelfReferentialBootstrapLedger -Json $BaseLedgerJson
    }

    $transition = Compare-SelfReferentialLedgerTransition `
        -BaseLedger $baseLedger -HeadLedger $headLedger `
        -ChangedPaths $ChangedPaths -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
    $newIds = @($transition.NewEntries | ForEach-Object { [string]$_.id })

    $declared = & $GetTableValue $Body 'Self-referential bootstrap'
    if ([string]::IsNullOrWhiteSpace($declared)) {
        throw "This PR changes the verification mechanism ($($mechanismPaths -join ', ')); the PR body must declare 'Self-referential bootstrap' as yes or no."
    }
    $declared = $declared.Trim().ToLowerInvariant()
    if ($declared -notin @('yes', 'no')) {
        throw "PR body 'Self-referential bootstrap' must be yes or no; actual='$declared'."
    }

    if ($declared -eq 'no') {
        if ($newIds.Count -gt 0) {
            throw "self_referential_bootstrap: the ledger gains entries ($($newIds -join ', ')) but the PR body declares bootstrap=no; adding debt requires declaring yes."
        }
        if (@($transition.OpenDebt).Count -gt 0) {
            $ids = @($transition.OpenDebt | ForEach-Object { [string]$_.id }) -join ', '
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

    # Impersonation guard: the declared entry must be NEW in this PR (present at
    # head, absent at base). Pointing at an earlier PR's open entry is refused.
    if ($entryId -notin $newIds) {
        throw "self_referential_bootstrap: PR body names ledger entry '$entryId' but this PR does not ADD it; each bootstrap PR must self-register its own open entry (base-vs-head verified)."
    }

    $otherOpen = @($transition.OpenDebt | Where-Object { [string]$_.id -ne $entryId })
    if ($otherOpen.Count -gt 0) {
        $ids = @($otherOpen | ForEach-Object { [string]$_.id }) -join ', '
        throw "self_referential_bootstrap: open ledger debt ($ids) blocks further verification-mechanism PRs until fixpoint evidence is committed."
    }
}
