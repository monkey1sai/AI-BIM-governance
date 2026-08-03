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
    '^scripts/lib/(preflight-[a-z-]+|deploy-report|host-native-launcher|rebuild-test-deploy|start-child-with-environment|kit-log-probe|smoke-evidence|design-assets)\.ps1$'
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
    # Deciding whether the BASE has a usable gate is itself an adjudicating
    # decision: a PR editing only this file could report every base as capable
    # and skip the gate entirely (Codex: "Classify the capability detector").
    '^scripts/lib/detect-base-gate-capability\.sh$'
    # The POSIX verification entrypoint is the peer of verify-all.ps1, and on the
    # Linux deploy target it IS the entrypoint (Codex: "Classify the POSIX
    # verification entrypoint").
    '^scripts/verify-all\.sh$'
    # The planner and runner decide WHICH verifications run, so editing them
    # changes what "verified" means (Codex: "Classify the verification planner").
    '^scripts/lib/verification-(plan|runner)\.mjs$'
) -join '|'

$script:GenericReasonBlocklist = @(
    'bootstrap', 'needed', 'required', 'self-referential', 'chicken', 'egg', 'because', 'necessary'
)

function Assert-SelfReferentialStringList {
    # The schema says these fields are LISTS. `@($value).Count` cannot enforce that:
    # it wraps a bare string into a one-element array, so a scalar passed every
    # emptiness check (Codex: "Reject scalar values for ledger list fields").
    # ConvertFrom-Json gives Object[] for a JSON array and String for a scalar, so
    # the array test is the honest one.
    param(
        [Parameter(Mandatory = $true)] $Value,
        [Parameter(Mandatory = $true)][string] $Context
    )
    if ($Value -isnot [System.Collections.IEnumerable] -or $Value -is [string]) {
        throw "self_referential_bootstrap: $Context must be a JSON array of strings, not a scalar."
    }
    $items = @($Value)
    if ($items.Count -eq 0) {
        throw "self_referential_bootstrap: $Context must not be empty."
    }
    foreach ($item in $items) {
        if ($item -isnot [string] -or [string]::IsNullOrWhiteSpace($item)) {
            throw "self_referential_bootstrap: $Context must contain only non-empty strings."
        }
    }
    return $items
}

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
    # not use whitespace word boundaries: substance is judged on ideograph count
    # AND distinct-ideograph diversity, so a padded run ('引導引導引導...') still fails.
    $cjkMatches = [regex]::Matches($trimmed, '\p{IsCJKUnifiedIdeographs}')
    if ($cjkMatches.Count -ge 12) {
        $distinctCjk = @($cjkMatches | ForEach-Object { $_.Value } | Sort-Object -Unique).Count
        if ($distinctCjk -lt 8) {
            throw "self_referential_bootstrap: $Context reason repeats too few distinct characters ($distinctCjk); padded CJK phrases are rejected."
        }
        return
    }
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
    foreach ($match in [regex]::Matches($Json, '(?i)"(?:opened_at|reverified_at)"\s*:\s*"([^"]*)"')) {
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
        $null = Assert-SelfReferentialStringList -Value $entry.verification_mechanism_paths `
            -Context "entry '$id' verification_mechanism_paths"
        $refs = Assert-SelfReferentialStringList -Value $entry.bootstrap_evidence_refs `
            -Context "entry '$id' bootstrap_evidence_refs"
        foreach ($ref in $refs) {
            if ([string]$ref -notmatch 'self[-_]referential[-_]bootstrap') {
                throw "self_referential_bootstrap: entry '$id' evidence ref '$ref' is not labeled with the self_referential_bootstrap stack kind."
            }
            # The stack-kind label is a substring test, and the mechanism files are
            # themselves named after the stack kind - so scripts/self-referential-
            # bootstrap-ledger.json passed it, letting an entry cite the ledger (or
            # the gate library) as its own evidence (Codex: "Reject governance files
            # masquerading as bootstrap evidence"). Evidence must be an artefact
            # ABOUT the mechanism, never a file that IS the mechanism.
            if (@(Get-SelfReferentialMechanismPaths -ChangedPaths @([string]$ref)).Count -gt 0) {
                throw "self_referential_bootstrap: entry '$id' evidence ref '$ref' is a verification-mechanism file; the mechanism cannot be its own evidence."
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
            $null = Assert-SelfReferentialStringList -Value $fp.evidence_refs `
                -Context "entry '$id' fixpoint.evidence_refs"
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
        [AllowEmptyCollection()][string[]] $MechanismPaths = @(),
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
            $declaredPaths = @($head.verification_mechanism_paths | ForEach-Object { [string]$_ })
            $undeclaredPaths = @($declaredPaths | Where-Object { $_ -notin $ChangedPaths })
            if ($undeclaredPaths.Count -gt 0) {
                throw "self_referential_bootstrap: new entry '$id' claims mechanism paths this PR does not change: $($undeclaredPaths -join ', ')."
            }
            # Declared paths must be CLASSIFIED mechanism paths, and must cover
            # every mechanism path that triggered the obligation. Otherwise a PR
            # could change a real mechanism file plus an unrelated file, declare
            # only the unrelated one, and later close the debt against a commit
            # touching that unrelated path - leaving the change that actually
            # triggered the gate outside the ledger binding (Codex L1-correctness-3).
            if (@($MechanismPaths).Count -gt 0) {
                $nonMechanism = @($declaredPaths | Where-Object { $_ -notin $MechanismPaths })
                if ($nonMechanism.Count -gt 0) {
                    throw "self_referential_bootstrap: new entry '$id' declares paths that are not classified verification-mechanism paths: $($nonMechanism -join ', ')."
                }
                $uncovered = @($MechanismPaths | Where-Object { $_ -notin $declaredPaths })
                if ($uncovered.Count -gt 0) {
                    throw "self_referential_bootstrap: new entry '$id' does not cover every mechanism path this PR changes; missing: $($uncovered -join ', ')."
                }
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
        # Bind the closure to THIS entry's mechanism (not any ancient ancestor):
        # the mechanism_commit must actually have touched one of the entry's
        # declared verification_mechanism_paths.
        # NOTE: use $head, not $entry. $entry is still bound by the earlier
        # foreach loops in this function and would silently refer to the LAST
        # head entry, mis-binding closures whenever the ledger has >1 entry
        # (narrower bug surfaced by the Codex apex while refuting L1-correctness-1).
        $mechanismTouched = $false
        foreach ($declaredPath in @($head.verification_mechanism_paths)) {
            $touched = @(& git -C $RepoRoot show --name-only --pretty=format: $commit -- ([string]$declaredPath) 2>$null | Where-Object { $_ })
            if ($touched.Count -gt 0) { $mechanismTouched = $true; break }
        }
        if (-not $mechanismTouched) {
            throw "self_referential_bootstrap: entry '$id' fixpoint.mechanism_commit $commit did not modify any of the entry's declared verification_mechanism_paths; it is not this mechanism's merge."
        }
        foreach ($ref in @($fp.evidence_refs)) {
            Assert-SelfReferentialEvidenceBlob -RepoRoot $RepoRoot -Ref ([string]$ref) -Context "entry '$id' fixpoint" -HeadSha $HeadSha
            # Post-merge binding: the evidence blob must have been introduced or
            # modified at or after the mechanism merged - a pre-existing unrelated
            # blob cannot stand in for the required post-merge re-verification.
            # The walk MUST start at the supplied head revision: bare `git log`
            # starts at ambient HEAD, which in a pull_request checkout is the
            # synthetic merge ref, so a base-side commit could supply the
            # chronology for a blob validated at head (Codex L1-correctness-4).
            if ([string]::IsNullOrWhiteSpace($HeadSha)) {
                throw "self_referential_bootstrap: closing entry '$id' requires HeadSha to bind evidence chronology; refusing ambient-HEAD resolution."
            }
            $evidenceIntroCommit = (& git -C $RepoRoot log -1 --format=%H $HeadSha -- ([string]$ref) 2>$null | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($evidenceIntroCommit)) {
                throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$ref' has no commit history reachable from the PR head; cannot bind it to post-merge re-verification."
            }
            & git -C $RepoRoot merge-base --is-ancestor $commit $evidenceIntroCommit 2>$null
            if ($LASTEXITCODE -ne 0) {
                throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$ref' predates mechanism_commit $commit; it cannot be the post-merge re-verification result."
            }
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
        -ChangedPaths $ChangedPaths -MechanismPaths $mechanismPaths `
        -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
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
