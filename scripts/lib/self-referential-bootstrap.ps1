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
    # Direct adjudicator dependencies are as load-bearing as the manifest that
    # invokes them. Contract prose also changes what reviewers and fixpoint PRs
    # are required to prove, so it is part of the mechanism surface.
    '^scripts/lib/security-exceptions-cli\.mjs$'
    '^scripts/tests/(invoke-powershell-static|scan-secret-patterns)\.ps1$'
    '^scripts/tests/verification-plan\.schema\.json$'
    '^docs/agents/self-referential-bootstrap\.md$'
) -join '|'

# These files define or dispatch this gate's own adjudication. Unlike an
# ordinary verification-mechanism edit, a change here cannot be accepted under
# bootstrap=no because that would let the changed rule validate itself without
# registering fixpoint debt. The ledger is intentionally excluded so a later
# ledger-only closure remains possible.
$script:SelfReferentialAdjudicatorPaths = @(
    '.github/workflows/pr-review-agent.yml'
    'scripts/lib/detect-base-gate-capability.sh'
    'scripts/lib/self-referential-bootstrap.ps1'
    'scripts/tests/check-pr-body-evidence.ps1'
    'docs/agents/self-referential-bootstrap.md'
)

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
    return @($ChangedPaths | Where-Object { $_ -cmatch $script:SelfReferentialMechanismPattern })
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

function Assert-SelfReferentialRawTimestampTokens {
    # JsonDocument decodes escaped property names before exposing Name, so a key
    # such as "opene\u0064_at" cannot bypass validation. Regex over raw JSON
    # cannot provide that guarantee.
    param([Parameter(Mandatory = $true)][string] $Json)

    $document = [System.Text.Json.JsonDocument]::Parse($Json)
    try {
        $pending = [System.Collections.Generic.Stack[System.Text.Json.JsonElement]]::new()
        $pending.Push($document.RootElement)
        while ($pending.Count -gt 0) {
            $element = $pending.Pop()
            if ($element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
                foreach ($property in $element.EnumerateObject()) {
                    if ($property.Name -ieq 'opened_at' -or $property.Name -ieq 'reverified_at') {
                        if ($property.Value.ValueKind -eq [System.Text.Json.JsonValueKind]::String) {
                            $rawTimestamp = $property.Value.GetString()
                            if (-not (Test-SelfReferentialIsoTimestamp -Value $rawTimestamp)) {
                                throw "self_referential_bootstrap: timestamp '$rawTimestamp' is not an allowed anchored ISO-8601 form (raw-string validation after key decoding)."
                            }
                        }
                    }
                    if ($property.Value.ValueKind -in @(
                        [System.Text.Json.JsonValueKind]::Object,
                        [System.Text.Json.JsonValueKind]::Array)) {
                        $pending.Push($property.Value)
                    }
                }
            } elseif ($element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
                foreach ($item in $element.EnumerateArray()) { $pending.Push($item) }
            }
        }
    } finally {
        $document.Dispose()
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

    $jsonWasSupplied = $PSBoundParameters.ContainsKey('Json')
    if (-not $jsonWasSupplied) {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            throw "self_referential_bootstrap: ledger not found at $Path"
        }
        $Json = Get-Content -LiteralPath $Path -Raw
    }
    if ([string]::IsNullOrWhiteSpace($Json)) {
        throw 'self_referential_bootstrap: ledger is empty; an existing base ledger must contain valid JSON.'
    }
    try {
        $ledger = $Json | ConvertFrom-Json
    } catch {
        throw "self_referential_bootstrap: ledger is not valid JSON: $($_.Exception.Message)"
    }

    # ConvertFrom-Json eagerly materializes ISO-looking strings as [datetime].
    # Validate decoded raw string tokens first, including escaped property names.
    Assert-SelfReferentialRawTimestampTokens -Json $Json

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
        # Open entries are immutable and block later mechanism PRs until closed.
        # An opened_at with no representable later fixpoint (e.g. the last
        # millisecond of year 9999) permanently poisons the ledger, so reject
        # any opening time that cannot host a strictly later reverified_at in
        # the same anchored ISO formats.
        $openedAt = ConvertTo-SelfReferentialTimestamp $entry.opened_at
        $latestRepresentable = [DateTimeOffset]::Parse(
            '9999-12-31T23:59:58.998Z',
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal)
        if ($openedAt -ge $latestRepresentable) {
            throw "self_referential_bootstrap: entry '$id' opened_at leaves no valid later fixpoint.reverified_at under the allowed ISO-8601 formats."
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
            $fpRefs = Assert-SelfReferentialStringList -Value $fp.evidence_refs `
                -Context "entry '$id' fixpoint.evidence_refs"
            # Same rule as bootstrap_evidence_refs: the mechanism cannot be its own
            # evidence. Applying it only to the opening refs left the CLOSING side -
            # the one that actually clears debt - able to cite the gate library or the
            # ledger as the post-merge re-verification result (Codex: "Reject
            # mechanism files as fixpoint evidence").
            foreach ($fpRef in $fpRefs) {
                if (@(Get-SelfReferentialMechanismPaths -ChangedPaths @([string]$fpRef)).Count -gt 0) {
                    throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$fpRef' is a verification-mechanism file; the mechanism cannot be its own re-verification result."
                }
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
    # Evidence must be a COMMITTED regular file at the PR HEAD SHA. Use ls-tree
    # mode rather than cat-file -t alone: Git stores symlinks as blobs (mode
    # 120000), so a dangling symlink would otherwise pass as "evidence".
    # Filesystem Test-Path would also accept '.', directories, and untracked
    # workflow artifacts; ambient HEAD would accept blobs that only exist in
    # the synthetic pull-request merge tree.
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Ref,
        [Parameter(Mandatory = $true)][string] $Context,
        [string] $HeadSha = ''
    )
    $revision = if ([string]::IsNullOrWhiteSpace($HeadSha)) { 'HEAD' } else { $HeadSha }
    # -z is not used: a single path should yield at most one record. Reject
    # multi-line results so path '.' cannot accidentally match a child blob.
    $treeLines = @(& git -C $RepoRoot ls-tree --full-tree $revision -- $Ref 2>$null |
        ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0 -or $treeLines.Count -ne 1) {
        throw "self_referential_bootstrap: $Context evidence ref '$Ref' is not a committed file at the PR head revision."
    }
    $treeEntry = $treeLines[0]
    if ($treeEntry -notmatch '^([0-7]{6})\s+(\S+)\s+([0-9a-fA-F]{40,64})\t(.+)$') {
        throw "self_referential_bootstrap: $Context cannot parse the head tree entry for evidence '$Ref'."
    }
    $mode = $Matches[1]
    $objectType = $Matches[2]
    $entryPath = $Matches[4] -replace '\\', '/'
    $normalizedRef = $Ref -replace '\\', '/'
    if ($entryPath -cne $normalizedRef) {
        throw "self_referential_bootstrap: $Context evidence ref '$Ref' is not a committed file at the PR head revision (resolved path '$entryPath')."
    }
    if ($objectType -cne 'blob' -or $mode -notin @('100644', '100755')) {
        throw "self_referential_bootstrap: $Context evidence ref '$Ref' must be a regular committed file (mode 100644/100755 blob); got mode=$mode type=$objectType."
    }
}

function Assert-SelfReferentialEvidenceContentFreshness {
    # Changed-path metadata is not content evidence: chmod-only changes alter a
    # tree entry and satisfy `git diff`, while retaining the exact same blob.
    # Resolve both immutable revisions and require either no base object (new
    # evidence) or a different base/head object id.
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Ref,
        [Parameter(Mandatory = $true)][string] $Context,
        [Parameter(Mandatory = $true)][string] $BaseSha,
        [Parameter(Mandatory = $true)][string] $HeadSha
    )
    if ([string]::IsNullOrWhiteSpace($BaseSha) -or [string]::IsNullOrWhiteSpace($HeadSha)) {
        throw "self_referential_bootstrap: $Context evidence '$Ref' requires exact BaseSha and HeadSha to verify content freshness."
    }

    & git -C $RepoRoot cat-file -e "$BaseSha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "self_referential_bootstrap: $Context cannot resolve BaseSha '$BaseSha' while verifying evidence '$Ref'."
    }
    & git -C $RepoRoot cat-file -e "$HeadSha^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "self_referential_bootstrap: $Context cannot resolve HeadSha '$HeadSha' while verifying evidence '$Ref'."
    }
    $headOid = (& git -C $RepoRoot rev-parse --verify "${HeadSha}:$Ref" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($headOid)) {
        throw "self_referential_bootstrap: $Context cannot resolve evidence '$Ref' at HeadSha '$HeadSha'."
    }
    $baseTreeEntry = (& git -C $RepoRoot ls-tree --full-tree $BaseSha -- $Ref 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "self_referential_bootstrap: $Context cannot inspect evidence '$Ref' at BaseSha '$BaseSha'."
    }
    if ([string]::IsNullOrWhiteSpace($baseTreeEntry)) {
        return
    }
    if ($baseTreeEntry -notmatch '^([0-7]{6})\s+(\S+)\s+([0-9a-fA-F]{40,64})\t') {
        throw "self_referential_bootstrap: $Context cannot parse the base tree entry for evidence '$Ref'."
    }
    if ($Matches[2] -cne 'blob') {
        return
    }
    $baseOid = $Matches[3].ToLowerInvariant()
    if ($baseOid -ceq $headOid) {
        throw "self_referential_bootstrap: $Context evidence '$Ref' is unchanged between BaseSha and HeadSha (identical blob OID); metadata-only or mode-only changes are not fresh evidence."
    }
}

function Assert-SelfReferentialLedgerEvidenceBlobs {
    param(
        [Parameter(Mandatory = $true)] $Ledger,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $HeadSha,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths
    )
    foreach ($entry in @($Ledger.entries)) {
        $id = [string]$entry.id
        foreach ($ref in @($entry.bootstrap_evidence_refs)) {
            $evidenceRef = [string]$ref
            if (@($ChangedPaths) -ccontains $evidenceRef) {
                Assert-SelfReferentialEvidenceBlob -RepoRoot $RepoRoot -Ref $evidenceRef `
                    -Context "entry '$id' bootstrap" -HeadSha $HeadSha
            }
        }
        if ([string]$entry.status -eq 'closed') {
            foreach ($ref in @($entry.fixpoint.evidence_refs)) {
                $evidenceRef = [string]$ref
                if (@($ChangedPaths) -ccontains $evidenceRef) {
                    Assert-SelfReferentialEvidenceBlob -RepoRoot $RepoRoot -Ref $evidenceRef `
                        -Context "entry '$id' fixpoint" -HeadSha $HeadSha
                }
            }
        }
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
            # -notin is CASE-INSENSITIVE in PowerShell, but git paths are not: an
            # entry declaring 'Scripts/Deploy.ps1' would have matched the real
            # 'scripts/deploy.ps1' and bound the debt to a path that does not exist
            # (Codex: "Compare declared mechanism paths case-sensitively").
            $undeclaredPaths = @($declaredPaths | Where-Object { -not (@($ChangedPaths) -ccontains $_) })
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
                $nonMechanism = @($declaredPaths | Where-Object { -not (@($MechanismPaths) -ccontains $_) })
                if ($nonMechanism.Count -gt 0) {
                    throw "self_referential_bootstrap: new entry '$id' declares paths that are not classified verification-mechanism paths: $($nonMechanism -join ', ')."
                }
                $uncovered = @($MechanismPaths | Where-Object { -not (@($declaredPaths) -ccontains $_) })
                if ($uncovered.Count -gt 0) {
                    throw "self_referential_bootstrap: new entry '$id' does not cover every mechanism path this PR changes; missing: $($uncovered -join ', ')."
                }
            }
            if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
                foreach ($ref in @($head.bootstrap_evidence_refs)) {
                    $evidenceRef = [string]$ref
                    Assert-SelfReferentialEvidenceBlob -RepoRoot $RepoRoot -Ref $evidenceRef -Context "new entry '$id'" -HeadSha $HeadSha
                    if (-not (@($ChangedPaths) -ccontains $evidenceRef)) {
                        throw "self_referential_bootstrap: new entry '$id' bootstrap evidence '$evidenceRef' must be added or modified by this PR; reusing an unchanged base artefact is not branch-specific evidence."
                    }
                    Assert-SelfReferentialEvidenceContentFreshness -RepoRoot $RepoRoot `
                        -Ref $evidenceRef -Context "new entry '$id' bootstrap" `
                        -BaseSha $BaseSha -HeadSha $HeadSha
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
        $firstParentHistory = @(& git -C $RepoRoot rev-list --first-parent $BaseSha 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not ($firstParentHistory -ccontains $commit)) {
            throw "self_referential_bootstrap: entry '$id' fixpoint.mechanism_commit $commit is not on the PR base first-parent history; bind closure to the mainline merge/squash commit, not a side-branch ancestor."
        }
        # Bind the closure to THIS entry's complete mechanism (not any ancient
        # ancestor): the mechanism_commit must have touched every declared
        # verification_mechanism_path. Requiring only one path would let a
        # multi-surface gate close without merging the rest of its mechanism.
        # NOTE: use $head, not $entry. $entry is still bound by the earlier
        # foreach loops in this function and would silently refer to the LAST
        # head entry, mis-binding closures whenever the ledger has >1 entry
        # (narrower bug surfaced by the Codex apex while refuting L1-correctness-1).
        $parentLine = (& git -C $RepoRoot rev-list --parents -n 1 $commit 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($parentLine)) {
            throw "self_referential_bootstrap: cannot inspect parents of mechanism_commit $commit."
        }
        $parents = @($parentLine -split '\s+')
        $untouchedDeclaredPaths = @()
        foreach ($declaredPath in @($head.verification_mechanism_paths)) {
            if ($parents.Count -gt 1) {
                # Compare a merge to its first parent so branch-side mechanism
                # changes are visible. `git show --name-only <merge>` emits no
                # ordinary diff by default and falsely rejected legitimate merges.
                $touched = @(& git -C $RepoRoot diff-tree --no-commit-id -r --name-only `
                    $parents[1] $commit -- ([string]$declaredPath) 2>$null | Where-Object { $_ })
            } else {
                $touched = @(& git -C $RepoRoot diff-tree --root --no-commit-id -r --name-only `
                    $commit -- ([string]$declaredPath) 2>$null | Where-Object { $_ })
            }
            if ($touched.Count -eq 0) {
                $untouchedDeclaredPaths += [string]$declaredPath
            }
        }
        if ($untouchedDeclaredPaths.Count -gt 0) {
            throw "self_referential_bootstrap: entry '$id' fixpoint.mechanism_commit $commit did not modify every declared verification_mechanism_path; missing: $($untouchedDeclaredPaths -join ', ')."
        }
        $commitMessage = (& git -C $RepoRoot log -1 --format=%B $commit 2>$null | Out-String).Trim()
        $originatingPr = [int]$head.pr
        $commitSubject = @($commitMessage -split "\r?\n")[0]
        $mergeSubject = "^Merge pull request #$originatingPr from .+"
        $squashSubject = "\(#$originatingPr\)$"
        if ($LASTEXITCODE -ne 0 -or
            ($commitSubject -notmatch $mergeSubject -and $commitSubject -notmatch $squashSubject)) {
            throw "self_referential_bootstrap: entry '$id' mechanism_commit $commit is not bound to originating PR #$originatingPr in its merge/squash message."
        }
        foreach ($ref in @($fp.evidence_refs)) {
            $evidenceRef = [string]$ref
            Assert-SelfReferentialEvidenceBlob -RepoRoot $RepoRoot -Ref $evidenceRef -Context "entry '$id' fixpoint" -HeadSha $HeadSha
            if ([string]::IsNullOrWhiteSpace($HeadSha)) {
                throw "self_referential_bootstrap: closing entry '$id' requires HeadSha to bind evidence chronology; refusing ambient-HEAD resolution."
            }
            if (-not (@($ChangedPaths) -ccontains $evidenceRef)) {
                throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$evidenceRef' must be added or modified by this closure PR; unchanged base evidence is not closure-specific re-verification."
            }
            Assert-SelfReferentialEvidenceContentFreshness -RepoRoot $RepoRoot `
                -Ref $evidenceRef -Context "entry '$id' fixpoint" `
                -BaseSha $BaseSha -HeadSha $HeadSha
            # Post-merge binding: the evidence blob must have been introduced or
            # modified at or after the mechanism merged - a pre-existing unrelated
            # blob cannot stand in for the required post-merge re-verification.
            # The walk MUST start at the supplied head revision: bare `git log`
            # starts at ambient HEAD, which in a pull_request checkout is the
            # synthetic merge ref, so a base-side commit could supply the
            # chronology for a blob validated at head (Codex L1-correctness-4).
            $evidenceIntroCommit = (& git -C $RepoRoot log -1 --format=%H $HeadSha -- $evidenceRef 2>$null | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($evidenceIntroCommit)) {
                throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$evidenceRef' has no commit history reachable from the PR head; cannot bind it to post-merge re-verification."
            }
            & git -C $RepoRoot merge-base --is-ancestor $evidenceIntroCommit $BaseSha 2>$null
            $evidenceInBaseExit = $LASTEXITCODE
            if ($evidenceInBaseExit -eq 0) {
                throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$evidenceRef' latest commit is already in BaseSha; closure must commit a new re-verification result."
            }
            if ($evidenceInBaseExit -ne 1) {
                throw "self_referential_bootstrap: cannot compare fixpoint evidence '$evidenceRef' history with BaseSha."
            }
            # STRICT descendant. `--is-ancestor X X` succeeds, so an evidence file
            # committed IN the mechanism commit itself passed this check - letting
            # the original bootstrap artefact stand in for the post-merge rerun it
            # is supposed to prove happened afterwards (Codex: "Require fixpoint
            # evidence to postdate the mechanism commit").
            if ($evidenceIntroCommit -eq $commit) {
                throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$evidenceRef' was committed by mechanism_commit $commit itself; the post-merge re-verification must produce NEW evidence, not cite the bootstrap artefact."
            }
            & git -C $RepoRoot merge-base --is-ancestor $commit $evidenceIntroCommit 2>$null
            if ($LASTEXITCODE -ne 0) {
                throw "self_referential_bootstrap: entry '$id' fixpoint evidence '$evidenceRef' predates mechanism_commit $commit; it cannot be the post-merge re-verification result."
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
        [Nullable[bool]] $BaseLedgerExists = $null,
        [bool] $HasBaseContext = $false,
        [int] $PrNumber = 0,
        [string] $RepoRoot = '',
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )

    $mechanismPaths = @(Get-SelfReferentialMechanismPaths -ChangedPaths $ChangedPaths)
    $hasExactHeadContext = -not [string]::IsNullOrWhiteSpace($HeadSha) -and
        -not [string]::IsNullOrWhiteSpace($RepoRoot)
    if ($mechanismPaths.Count -eq 0 -and -not $hasExactHeadContext) { return }

    # Integrity first: a malformed head ledger fails closed before any gating
    # decision. When the head SHA is known, the ledger is read from that exact
    # revision - never from the ambient checkout, which in a pull_request job is
    # the synthetic merge tree.
    if ($hasExactHeadContext) {
        $headLedgerJson = (& git -C $RepoRoot show "${HeadSha}:scripts/self-referential-bootstrap-ledger.json" 2>$null) -join "`n"
        if ($LASTEXITCODE -ne 0) {
            throw "self_referential_bootstrap: ledger missing at the PR head revision $HeadSha."
        }
        $headLedger = Get-SelfReferentialBootstrapLedger -Json $headLedgerJson
    } else {
        $headLedger = Get-SelfReferentialBootstrapLedger -Path $LedgerPath
    }
    if ($hasExactHeadContext) {
        Assert-SelfReferentialLedgerEvidenceBlobs -Ledger $headLedger -RepoRoot $RepoRoot `
            -HeadSha $HeadSha -ChangedPaths $ChangedPaths
    }
    if ($mechanismPaths.Count -eq 0) { return }

    # The transition can only be judged against the base. Without base context the
    # deletion/impersonation/forged-closure checks are blind, so any PR that touches
    # the ledger (or whose head ledger carries entries) fails closed.
    $ledgerTouched = [bool](@($ChangedPaths | Where-Object { $_ -eq 'scripts/self-referential-bootstrap-ledger.json' }).Count)
    if (-not $HasBaseContext) {
        if ($ledgerTouched -or @($headLedger.entries).Count -gt 0) {
            throw 'self_referential_bootstrap: base context (BaseSha) is required to evaluate the ledger transition; refusing head-only evaluation.'
        }
        $baseLedger = $headLedger
    } else {
        $baseLedgerPresent = if ($null -eq $BaseLedgerExists) {
            -not [string]::IsNullOrWhiteSpace($BaseLedgerJson)
        } else {
            [bool]$BaseLedgerExists
        }
        if (-not $baseLedgerPresent) {
            # Ledger did not exist at base: every head entry is new.
            $baseLedger = [pscustomobject]@{
                schema_version = 'self-referential-bootstrap-ledger/v1'
                entries        = @()
            }
        } else {
            # An existing-but-empty or corrupt base ledger is not equivalent to a
            # missing first-introduction ledger. Parse it and fail closed.
            $baseLedger = Get-SelfReferentialBootstrapLedger -Json $BaseLedgerJson
        }
    }

    $transition = Compare-SelfReferentialLedgerTransition `
        -BaseLedger $baseLedger -HeadLedger $headLedger `
        -ChangedPaths $ChangedPaths -MechanismPaths $mechanismPaths `
        -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
    $newIds = @($transition.NewEntries | ForEach-Object { [string]$_.id })

    if (@($transition.ClosedEntries).Count -gt 0) {
        $nonLedgerMechanismEdits = @($mechanismPaths | Where-Object {
            $_ -cne 'scripts/self-referential-bootstrap-ledger.json'
        })
        if ($nonLedgerMechanismEdits.Count -gt 0) {
            throw "self_referential_bootstrap: a fixpoint closure PR may only change the ledger within the mechanism surface; separate these edits: $($nonLedgerMechanismEdits -join ', ')."
        }
    }

    $declared = & $GetTableValue $Body 'Self-referential bootstrap'
    if ([string]::IsNullOrWhiteSpace($declared)) {
        throw "This PR changes the verification mechanism ($($mechanismPaths -join ', ')); the PR body must declare 'Self-referential bootstrap' as yes or no."
    }
    $declared = $declared.Trim().ToLowerInvariant()
    if ($declared -notin @('yes', 'no')) {
        throw "PR body 'Self-referential bootstrap' must be yes or no; actual='$declared'."
    }

    if ($declared -eq 'no') {
        $selfAdjudicatingChanges = @($mechanismPaths | Where-Object {
            $script:SelfReferentialAdjudicatorPaths -ccontains $_
        })
        if ($selfAdjudicatingChanges.Count -gt 0) {
            throw "self_referential_bootstrap: changes to this gate's own adjudicators must declare bootstrap=yes and register new fixpoint debt: $($selfAdjudicatingChanges -join ', ')."
        }
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
