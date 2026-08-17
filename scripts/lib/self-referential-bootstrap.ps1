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
    '^scripts/deploy-target-registry\.json$'
    '^scripts/lib/deploy-target-registry\.ps1$'
    '^scripts/lib/remote-deploy-transport\.ps1$'
    '^scripts/lib/windows-verification-scope\.ps1$'
    '^scripts/dev/start-isolated-branch-stack\.ps1$'
    '^scripts/start-web-plane-docker\.ps1$'
    '^scripts/lib/(preflight-[a-z-]+|deploy-report|host-native-launcher|rebuild-test-deploy|start-child-with-environment|kit-log-probe|smoke-evidence|design-assets)\.ps1$'
    '^scripts/lib/platform/'
    '^scripts/lib/(design-system-gate|pr-review-agent|production-boundary-contract)\.ps1$'
    '^scripts/tests/(check-pr-body-evidence|verify-design-system-reference|verify-design-system-visual-result|verify-functional-runtime-result|verify-security-exceptions|verify-openspec-lifecycle)\.ps1$'
    '^scripts/tests/verify-openspec-machine-truth\.mjs$'
    '^scripts/lib/self-referential-bootstrap\.ps1$'
    '^scripts/self-referential-bootstrap-ledger\.json$'
    '^\.github/workflows/(agent-governance|pr-review-agent|ci|trusted-elevated-merge)\.yml$'
    '^scripts/(dev|lib)/trusted-host-merge(?:-[a-z-]+)?\.mjs$'
    '^scripts/tests/test-trusted-host-merge(?:-runtime)?\.mjs$'
    '^scripts/tests/fixtures/trusted-host-merge-machine-fixtures\.json$'
    '^agent-contracts/trusted-host-merge(?:[.-][a-z-]+)?(?:\.schema)?\.json$'
    '^agent-contracts/spec-to-done\.contract(?:\.schema)?\.json$'
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
    '^scripts/lib/verification-(plan|runner|command-policy|outcome)\.mjs$'
    # Direct adjudicator dependencies are as load-bearing as the manifest that
    # invokes them. Contract prose also changes what reviewers and fixpoint PRs
    # are required to prove, so it is part of the mechanism surface.
    '^scripts/lib/security-exceptions-cli\.mjs$'
    '^scripts/lib/security-exceptions\.mjs$'
    '^scripts/security-exceptions\.json$'
    '^scripts/lib/openspec-lifecycle\.ps1$'
    '^scripts/lib/openspec-machine-truth\.mjs$'
    '^scripts/tests/(invoke-powershell-static|scan-secret-patterns)\.ps1$'
    # The Agent Governance Policy module, its machine-readable rules, and its adjudicating
    # gate decide whether the governance surface holds; changing any of them can change the
    # required-check verdict. The behaviour suite carries the PINNED vocabulary and
    # load-bearing fingerprints.
    '^scripts/agent-governance-rules\.json$'
    '^scripts/lib/agent-governance-policy\.psm1$'
    '^scripts/tests/verify-governance-policy\.ps1$'
    '^scripts/tests/test-agent-governance-policy\.ps1$'
    '^scripts/tests/verification-plan\.schema\.json$'
    '^scripts/tests/test-(self-referential-bootstrap|base-gate-capability|preflight-prnumber-forwarding)\.ps1$'
    '^web-viewer-sample/scripts/verify-design-system-pixels\.mjs$'
    '^web-viewer-sample/scripts/lib/png-preflight\.mjs$'
    '^scripts/tests/test-png-preflight\.mjs$'
    # CODEOWNERS and its executable invariant decide whether the fixed human
    # owner gate exists, so changing either changes what "reviewed" means.
    '^\.github/CODEOWNERS$'
    '^(?:.*/)?\.gitattributes$'
    '^scripts/tests/test-agent-governance-check\.ps1$'
    '^docs/agents/self-referential-bootstrap\.md$'
) -join '|'

# These files define or dispatch this gate's own adjudication. Unlike an
# ordinary verification-mechanism edit, a change here cannot be accepted under
# bootstrap=no because that would let the changed rule validate itself without
# registering fixpoint debt. The ledger is intentionally excluded so a later
# ledger-only closure remains possible.
$script:SelfReferentialAdjudicatorPaths = @(
    '.github/workflows/pr-review-agent.yml'
    '.github/workflows/trusted-elevated-merge.yml'
    'scripts/dev/trusted-host-merge.mjs'
    'scripts/lib/trusted-host-merge-contract.mjs'
    'scripts/lib/trusted-host-merge-evidence.mjs'
    'scripts/lib/trusted-host-merge-executor.mjs'
    'scripts/lib/trusted-host-merge-runtime.mjs'
    'scripts/lib/trusted-host-merge.mjs'
    'agent-contracts/trusted-host-merge.contract.json'
    'agent-contracts/trusted-host-merge.contract.schema.json'
    'agent-contracts/trusted-host-merge-assertion.schema.json'
    'agent-contracts/trusted-host-merge-evidence.schema.json'
    'agent-contracts/trusted-host-merge-verdict.schema.json'
    'agent-contracts/trusted-host-merge-result.schema.json'
    'agent-contracts/spec-to-done.contract.json'
    'agent-contracts/spec-to-done.contract.schema.json'
    'scripts/lib/detect-base-gate-capability.sh'
    'scripts/lib/self-referential-bootstrap.ps1'
    'scripts/lib/windows-verification-scope.ps1'
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

function Assert-SelfReferentialVerificationContract {
    param(
        [Parameter(Mandatory = $true)] $Contract,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $contractId = [string]$Contract.id
    if ($contractId -cnotmatch '^[a-z0-9][a-z0-9-]{2,63}/v[1-9][0-9]*$') {
        throw "self_referential_bootstrap: $Context id must be a lowercase versioned identifier such as gate-name/v1."
    }
    $commandIds = Assert-SelfReferentialStringList -Value $Contract.command_ids -Context "$Context command_ids"
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($commandId in $commandIds) {
        if ($commandId -cnotmatch '^[a-z0-9][a-z0-9-]{2,127}$') {
            throw "self_referential_bootstrap: $Context command id '$commandId' must be lowercase kebab-case."
        }
        if (-not $seen.Add($commandId)) {
            throw "self_referential_bootstrap: $Context has duplicate command id '$commandId'."
        }
    }
    $declaredDigest = [string]$Contract.contract_sha256
    if ($declaredDigest -cnotmatch '^[0-9a-f]{64}$') {
        throw "self_referential_bootstrap: $Context contract_sha256 must be 64 lowercase hex characters."
    }
    $separator = [string][char]10
    $canonical = (@($contractId) + @($commandIds)) -join $separator
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $actualDigest = ([BitConverter]::ToString(
            $sha256.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($canonical))
        )).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
    if ($declaredDigest -cne $actualDigest) {
        throw "self_referential_bootstrap: $Context contract_sha256 does not match its id and ordered command_ids."
    }
    return @($commandIds)
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

function Assert-SelfReferentialJsonObjectShape {
    # The property set stays EXACT. -OptionalProperties widens the allowed set
    # without widening the required set, which is the only way to add a field to
    # a schema whose existing closed entries are immutable: an entry written
    # before the field existed must keep validating byte-for-byte.
    param(
        [Parameter(Mandatory = $true)][System.Text.Json.JsonElement] $Element,
        [Parameter(Mandatory = $true)][string] $Context,
        [Parameter(Mandatory = $true)][string[]] $RequiredProperties,
        [AllowEmptyCollection()][string[]] $OptionalProperties = @()
    )
    if ($Element.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw "self_referential_bootstrap: $Context must be a JSON object."
    }
    $allowedProperties = @($RequiredProperties) + @($OptionalProperties)
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($property in $Element.EnumerateObject()) {
        if (-not $seen.Add($property.Name)) {
            throw "self_referential_bootstrap: $Context has duplicate JSON property '$($property.Name)'."
        }
        if (-not ($allowedProperties -ccontains $property.Name)) {
            throw "self_referential_bootstrap: $Context has unknown JSON property '$($property.Name)' (raw-string validation requires exact property names)."
        }
    }
    foreach ($required in $RequiredProperties) {
        if (-not $seen.Contains($required)) {
            throw "self_referential_bootstrap: $Context is missing required JSON property '$required'."
        }
    }
}

function Assert-SelfReferentialJsonRepairPrs {
    # repair_prs records which PRs repaired an open entry's mechanism (issue #494).
    # It is append-only in the transition rules, so the value itself must be a
    # strictly increasing list of positive native integers: duplicates or a
    # decreasing tail would make "the appended suffix" ambiguous, and a string or
    # fraction would coerce past a naive [int] cast the way `pr` once did.
    param(
        [Parameter(Mandatory = $true)][System.Text.Json.JsonElement] $Element,
        [Parameter(Mandatory = $true)][string] $Context
    )
    if ($Element.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
        throw "self_referential_bootstrap: $Context repair_prs must be a JSON array of positive integers."
    }
    if ($Element.GetArrayLength() -eq 0) {
        throw "self_referential_bootstrap: $Context repair_prs must be non-empty when present; omit the property until a repair transition appends a PR number."
    }
    $previous = 0
    foreach ($item in $Element.EnumerateArray()) {
        $value = 0
        if ($item.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
            -not $item.TryGetInt32([ref]$value) -or $value -le 0) {
            throw "self_referential_bootstrap: $Context repair_prs must be a JSON array of positive integers."
        }
        if ($value -le $previous) {
            throw "self_referential_bootstrap: $Context repair_prs must be strictly increasing with no duplicates."
        }
        $previous = $value
    }
}

function Assert-SelfReferentialJsonStringArray {
    param(
        [Parameter(Mandatory = $true)][System.Text.Json.JsonElement] $Element,
        [Parameter(Mandatory = $true)][string] $Context
    )
    if ($Element.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
        throw "self_referential_bootstrap: $Context must be a JSON array of strings."
    }
    foreach ($item in $Element.EnumerateArray()) {
        if ($item.ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
            throw "self_referential_bootstrap: $Context must be a JSON array of strings."
        }
    }
}

function Assert-SelfReferentialRawLedgerShape {
    # JsonDocument preserves JSON types, duplicate properties, and decoded
    # property names. ConvertFrom-Json alone silently coerces or collapses those
    # distinctions, so validate the exact v1 shape before using its objects.
    param([Parameter(Mandatory = $true)][string] $Json)

    $document = [System.Text.Json.JsonDocument]::Parse($Json)
    try {
        $root = $document.RootElement
        if ($root.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
            throw 'self_referential_bootstrap: ledger must be a top-level JSON object.'
        }
        Assert-SelfReferentialJsonObjectShape -Element $root -Context 'ledger' -RequiredProperties @('schema_version', 'entries')
        if ($root.GetProperty('schema_version').ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
            throw 'self_referential_bootstrap: ledger schema_version must be a JSON string.'
        }
        $rawEntries = $root.GetProperty('entries')
        if ($rawEntries.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
            throw 'self_referential_bootstrap: ledger entries must be an array (JSON array required).'
        }
        $entryIndex = 0
        foreach ($entry in $rawEntries.EnumerateArray()) {
            $context = "ledger entry[$entryIndex]"
            Assert-SelfReferentialJsonObjectShape -Element $entry -Context $context -RequiredProperties @(
                'id', 'status', 'pr', 'opened_at', 'reason',
                'verification_mechanism_paths', 'verification_contract',
                'bootstrap_evidence_refs', 'fixpoint') -OptionalProperties @('repair_prs', 'successor_of')
            # repair_prs is OPTIONAL, not required: the four closed entries that
            # predate the repair lane are immutable, so requiring the field would
            # make the existing ledger unparsable.
            $repairProperties = @($entry.EnumerateObject() | Where-Object { $_.Name -ceq 'repair_prs' })
            if ($repairProperties.Count -eq 1) {
                Assert-SelfReferentialJsonRepairPrs -Element $repairProperties[0].Value -Context $context
            }
            $successorProperties = @($entry.EnumerateObject() | Where-Object { $_.Name -ceq 'successor_of' })
            if ($successorProperties.Count -eq 1 -and
                $successorProperties[0].Value.ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
                throw "self_referential_bootstrap: $context successor_of must be a JSON string."
            }
            foreach ($stringProperty in @('id', 'status', 'opened_at', 'reason')) {
                if ($entry.GetProperty($stringProperty).ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
                    throw "self_referential_bootstrap: $context $stringProperty must be a JSON string."
                }
            }
            if ($entry.GetProperty('pr').ValueKind -ne [System.Text.Json.JsonValueKind]::Number) {
                throw "self_referential_bootstrap: $context pr must be a positive native integer JSON number."
            }
            Assert-SelfReferentialJsonStringArray -Element $entry.GetProperty('verification_mechanism_paths') -Context "$context verification_mechanism_paths"
            $verificationContract = $entry.GetProperty('verification_contract')
            Assert-SelfReferentialJsonObjectShape -Element $verificationContract -Context "$context verification_contract" -RequiredProperties @('id', 'command_ids', 'contract_sha256')
            foreach ($stringProperty in @('id', 'contract_sha256')) {
                if ($verificationContract.GetProperty($stringProperty).ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
                    throw "self_referential_bootstrap: $context verification_contract.$stringProperty must be a JSON string."
                }
            }
            Assert-SelfReferentialJsonStringArray -Element $verificationContract.GetProperty('command_ids') -Context "$context verification_contract.command_ids"
            Assert-SelfReferentialJsonStringArray -Element $entry.GetProperty('bootstrap_evidence_refs') -Context "$context bootstrap_evidence_refs"

            $openedAt = $entry.GetProperty('opened_at').GetString()
            if (-not (Test-SelfReferentialIsoTimestamp -Value $openedAt)) {
                throw "self_referential_bootstrap: timestamp '$openedAt' is not an allowed anchored ISO-8601 form (raw-string validation after key decoding)."
            }
            $status = $entry.GetProperty('status').GetString()
            if ($status -cnotin @('open', 'closed')) {
                throw "self_referential_bootstrap: $context status must be exactly open or closed."
            }
            $fixpoint = $entry.GetProperty('fixpoint')
            if ($status -ceq 'open') {
                if ($fixpoint.ValueKind -ne [System.Text.Json.JsonValueKind]::Null) {
                    throw "self_referential_bootstrap: $context with status open must not carry a fixpoint; fixpoint must be null."
                }
            } else {
                if ($fixpoint.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
                    throw "self_referential_bootstrap: $context with status closed must carry a complete fixpoint record."
                }
                Assert-SelfReferentialJsonObjectShape -Element $fixpoint -Context "$context fixpoint" -RequiredProperties @('reverified_at', 'mechanism_commit', 'evidence_refs')
                foreach ($stringProperty in @('reverified_at', 'mechanism_commit')) {
                    if ($fixpoint.GetProperty($stringProperty).ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
                        throw "self_referential_bootstrap: $context fixpoint.$stringProperty must be a JSON string."
                    }
                }
                Assert-SelfReferentialJsonStringArray -Element $fixpoint.GetProperty('evidence_refs') -Context "$context fixpoint.evidence_refs"
                $reverifiedAt = $fixpoint.GetProperty('reverified_at').GetString()
                if (-not (Test-SelfReferentialIsoTimestamp -Value $reverifiedAt)) {
                    throw "self_referential_bootstrap: timestamp '$reverifiedAt' is not an allowed anchored ISO-8601 form (raw-string validation after key decoding)."
                }
            }
            $entryIndex++
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
    Assert-SelfReferentialRawLedgerShape -Json $Json

    if ([string]$ledger.schema_version -cne 'self-referential-bootstrap-ledger/v1') {
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
        if ($id -cnotmatch '^[a-z0-9][a-z0-9-]{2,63}$') {
            throw "self_referential_bootstrap: entry id '$id' must be kebab-case (3-64 chars)."
        }
        if ($seen.ContainsKey($id)) { throw "self_referential_bootstrap: duplicate entry id '$id'." }
        $seen[$id] = $true

        if ([string]$entry.status -cnotin @('open', 'closed')) {
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
            '9999-12-31T23:59:59.999Z',
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal)
        if ($openedAt -ge $latestRepresentable) {
            throw "self_referential_bootstrap: entry '$id' opened_at leaves no valid later fixpoint.reverified_at under the allowed ISO-8601 formats."
        }
        Assert-SelfReferentialBootstrapReason -Reason ([string]$entry.reason) -Context "ledger entry '$id'"
        $successorProperty = $entry.PSObject.Properties['successor_of']
        if ($null -ne $successorProperty) {
            $successorOf = [string]$successorProperty.Value
            if ($successorOf -cnotmatch '^[a-z0-9][a-z0-9-]{2,63}$') {
                throw "self_referential_bootstrap: entry '$id' successor_of must name a kebab-case ledger entry id."
            }
            if ($successorOf -ceq $id) {
                throw "self_referential_bootstrap: entry '$id' cannot be its own successor."
            }
        }
        $null = Assert-SelfReferentialStringList -Value $entry.verification_mechanism_paths `
            -Context "entry '$id' verification_mechanism_paths"
        $null = Assert-SelfReferentialVerificationContract -Contract $entry.verification_contract -Context "entry '$id' verification_contract"
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
    # A successor is an append-only, one-to-one continuation of a predecessor's
    # verification surface. Validate references after the full ledger has been
    # read so forward ordering cannot change integrity semantics.
    $successorByPredecessor = @{}
    foreach ($entry in @($ledger.entries)) {
        $successorProperty = $entry.PSObject.Properties['successor_of']
        if ($null -eq $successorProperty) { continue }
        $successorOf = [string]$successorProperty.Value
        if (-not $seen.ContainsKey($successorOf)) {
            throw "self_referential_bootstrap: entry '$($entry.id)' successor_of names missing ledger entry '$successorOf'."
        }
        if ($successorByPredecessor.ContainsKey($successorOf)) {
            throw "self_referential_bootstrap: ledger entry '$successorOf' has more than one successor; successor debt must be a single linked continuation."
        }
        $predecessor = @($ledger.entries | Where-Object {
            [string]$_.id -ceq $successorOf
        })[0]
        # Closure order is a ledger-integrity invariant, not only a transition
        # rule. Along any successor lineage statuses must be a closed prefix
        # followed by a contiguous open suffix. Otherwise A(open)->B(closed) can
        # hide C(open) from active-chain checks, and a later multi-close could
        # bypass the body exception once OpenDebt reaches zero.
        if ([string]$entry.status -ceq 'closed' -and [string]$predecessor.status -ceq 'open') {
            throw "self_referential_bootstrap: successor entry '$($entry.id)' cannot be closed while predecessor '$successorOf' remains open; successor chains must close oldest-root first."
        }
        $successorByPredecessor[$successorOf] = [string]$entry.id
    }
    # Relation cycles cannot be produced by a legal transition, but the parser is
    # also the integrity boundary for an existing ledger. Reject multi-entry
    # cycles fail-closed rather than relying on admission history.
    foreach ($entry in @($ledger.entries)) {
        $chainSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        $cursor = $entry
        while ($null -ne $cursor.PSObject.Properties['successor_of']) {
            $cursorId = [string]$cursor.id
            if (-not $chainSeen.Add($cursorId)) {
                throw "self_referential_bootstrap: successor relation contains a cycle at ledger entry '$cursorId'."
            }
            $predecessorId = [string]$cursor.successor_of
            $cursor = @($ledger.entries | Where-Object { [string]$_.id -ceq $predecessorId })[0]
        }
    }
    return $ledger
}

function ConvertTo-SelfReferentialCanonicalEntry {
    param([Parameter(Mandatory = $true)] $Entry)
    return ($Entry | ConvertTo-Json -Depth 8 -Compress)
}

function Get-SelfReferentialOpenSuccessorChain {
    # Return the contiguous open successor component containing EntryId. Closed
    # ancestors are historical debt and therefore stop the active chain. Callers
    # that create another successor or use the linked-closure exception can also
    # require this component to contain every open entry, which keeps unrelated
    # debt and discontinuous open suffixes fail-closed without blocking a purely
    # in-surface repair of one existing entry.
    param(
        [Parameter(Mandatory = $true)] $Ledger,
        [Parameter(Mandatory = $true)][string] $EntryId,
        [switch] $RequireAllOpen
    )

    $openEntries = @($Ledger.entries | Where-Object { [string]$_.status -ceq 'open' })
    $openById = [System.Collections.Generic.Dictionary[string, object]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($entry in $openEntries) {
        $openById.Add([string]$entry.id, $entry)
    }
    if (-not $openById.ContainsKey($EntryId)) {
        throw "self_referential_bootstrap: ledger entry '$EntryId' is not open debt in the active successor chain."
    }

    $root = $openById[$EntryId]
    while ($null -ne $root.PSObject.Properties['successor_of']) {
        $predecessorId = [string]$root.successor_of
        if (-not $openById.ContainsKey($predecessorId)) { break }
        $root = $openById[$predecessorId]
    }

    $chain = @()
    $cursor = $root
    $visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    while ($null -ne $cursor) {
        $cursorId = [string]$cursor.id
        if (-not $visited.Add($cursorId)) {
            throw "self_referential_bootstrap: active open successor chain contains a cycle at ledger entry '$cursorId'."
        }
        $chain += $cursor
        $openSuccessors = @($openEntries | Where-Object {
            $property = $_.PSObject.Properties['successor_of']
            $null -ne $property -and [string]$property.Value -ceq $cursorId
        })
        if ($openSuccessors.Count -gt 1) {
            throw "self_referential_bootstrap: active open debt forks after ledger entry '$cursorId'."
        }
        $cursor = if ($openSuccessors.Count -eq 1) { $openSuccessors[0] } else { $null }
    }

    if (-not ($chain | Where-Object { [string]$_.id -ceq $EntryId })) {
        throw "self_referential_bootstrap: ledger entry '$EntryId' is not part of its resolved active successor chain."
    }
    if ($RequireAllOpen -and $chain.Count -ne $openEntries.Count) {
        $chainIds = @($chain | ForEach-Object { [string]$_.id })
        $unrelatedIds = @($openEntries | Where-Object {
            -not ($chainIds -ccontains [string]$_.id)
        } | ForEach-Object { [string]$_.id }) -join ', '
        throw "self_referential_bootstrap: linked successor and closure transitions require all open debt to form one contiguous successor chain; unrelated or discontinuous open debt: $unrelatedIds."
    }
    return @($chain)
}

function Get-SelfReferentialRepairPrs {
    # Absent repair_prs reads as the empty list, so an entry written before the
    # repair lane existed and an entry that has never been repaired are the same
    # thing to the transition rules.
    param([Parameter(Mandatory = $true)] $Entry)
    $property = $Entry.PSObject.Properties['repair_prs']
    if ($null -eq $property -or $null -eq $property.Value) { return @() }
    return @($property.Value | ForEach-Object { [int]$_ })
}

function Get-SelfReferentialRepairAppend {
    # Returns the PR numbers appended to repair_prs when a TAIL APPEND to that one
    # field is the only difference between the base and head entry; $null for any
    # other difference. This is what makes the repair lane narrow: the caller can
    # treat "$null" as "an open entry was mutated" and keep the original refusal.
    param(
        [Parameter(Mandatory = $true)] $BaseEntry,
        [Parameter(Mandatory = $true)] $HeadEntry
    )
    $baseComparable = $BaseEntry | Select-Object -Property * -ExcludeProperty repair_prs
    $headComparable = $HeadEntry | Select-Object -Property * -ExcludeProperty repair_prs
    if ((ConvertTo-SelfReferentialCanonicalEntry $baseComparable) -cne
        (ConvertTo-SelfReferentialCanonicalEntry $headComparable)) {
        return $null
    }
    $basePrs = @(Get-SelfReferentialRepairPrs -Entry $BaseEntry)
    $headPrs = @(Get-SelfReferentialRepairPrs -Entry $HeadEntry)
    if ($headPrs.Count -le $basePrs.Count) { return $null }
    for ($index = 0; $index -lt $basePrs.Count; $index++) {
        if ($headPrs[$index] -ne $basePrs[$index]) { return $null }
    }
    return @($headPrs[$basePrs.Count..($headPrs.Count - 1)])
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

function Assert-SelfReferentialBaseEvidenceImmutable {
    param(
        [Parameter(Mandatory = $true)] $BaseLedger,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ChangedPaths,
        [string] $RepoRoot = '',
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )
    $recordedRefs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($entry in @($BaseLedger.entries)) {
        foreach ($ref in @($entry.bootstrap_evidence_refs)) {
            $null = $recordedRefs.Add([string]$ref)
        }
        if ([string]$entry.status -ceq 'closed') {
            foreach ($ref in @($entry.fixpoint.evidence_refs)) {
                $null = $recordedRefs.Add([string]$ref)
            }
        }
    }
    if ($recordedRefs.Count -eq 0) { return }

    $exactValues = @($RepoRoot, $BaseSha, $HeadSha)
    $hasExactContext = @($exactValues | Where-Object {
        [string]::IsNullOrWhiteSpace([string]$_)
    }).Count -eq 0

    if ($hasExactContext) {
        foreach ($ref in $recordedRefs) {
            $entries = @()
            foreach ($revision in @($BaseSha, $HeadSha)) {
                $treeLines = @(& git -C $RepoRoot ls-tree --full-tree $revision -- $ref 2>$null |
                    ForEach-Object { "$_".Trim() } | Where-Object { $_ })
                if ($LASTEXITCODE -ne 0 -or $treeLines.Count -ne 1) {
                    throw "self_referential_bootstrap: immutable referenced evidence '$ref' is missing or ambiguous at revision '$revision'."
                }
                $treeMatch = [regex]::Match(
                    $treeLines[0],
                    '^([0-7]{6})\s+(\S+)\s+([0-9a-fA-F]{40,64})\t(.+)$')
                if (-not $treeMatch.Success) {
                    throw "self_referential_bootstrap: immutable referenced evidence '$ref' has an unparsable tree entry at revision '$revision'."
                }
                $entryPath = $treeMatch.Groups[4].Value -replace '\\', '/'
                $normalizedRef = ([string]$ref) -replace '\\', '/'
                if ($entryPath -cne $normalizedRef) {
                    throw "self_referential_bootstrap: immutable referenced evidence '$ref' resolves as '$entryPath' at revision '$revision'."
                }
                $entries += [pscustomobject]@{
                    Mode = $treeMatch.Groups[1].Value
                    Type = $treeMatch.Groups[2].Value
                    Oid = $treeMatch.Groups[3].Value.ToLowerInvariant()
                }
            }
            $baseEntry = $entries[0]
            $headEntry = $entries[1]
            if ($baseEntry.Type -cne 'blob' -or $headEntry.Type -cne 'blob' -or
                $baseEntry.Mode -notin @('100644', '100755') -or
                $headEntry.Mode -notin @('100644', '100755') -or
                $baseEntry.Mode -cne $headEntry.Mode -or
                $baseEntry.Oid -cne $headEntry.Oid) {
                throw "self_referential_bootstrap: immutable referenced evidence '$ref' changed between BaseSha and HeadSha; preserve its exact regular-file tree entry and add a new governed evidence ref instead."
            }
        }
        return
    }

    # Headless transition unit tests retain the legacy path-list guard. Every
    # merge-authority caller supplies exact RepoRoot/BaseSha/HeadSha and therefore
    # takes the unconditional tree-entry comparison above.
    foreach ($ref in $recordedRefs) {
        if (@($ChangedPaths) -ccontains $ref) {
            throw "self_referential_bootstrap: immutable referenced evidence '$ref' was changed; preserve the original audit artifact and add a new governed evidence ref instead."
        }
    }
}

function Assert-SelfReferentialFixpointAttestation {
    param(
        [Parameter(Mandatory = $true)] $Entry,
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $HeadSha
    )
    $entryId = [string]$Entry.id
    $mechanismCommit = [string]$Entry.fixpoint.mechanism_commit
    $contractDigest = [string]$Entry.verification_contract.contract_sha256
    $expectedCommandIds = @(Assert-SelfReferentialVerificationContract -Contract $Entry.verification_contract -Context "entry '$entryId' verification_contract")
    $fixpointRefs = @($Entry.fixpoint.evidence_refs | ForEach-Object { [string]$_ })
    $invalidNamespaceRefs = @($fixpointRefs | Where-Object {
        $_ -cnotmatch '^docs/evidence/[^/]+/fixpoint/.+'
    })
    if ($invalidNamespaceRefs.Count -gt 0) {
        throw "self_referential_bootstrap: entry '$entryId' fixpoint evidence must live under docs/evidence/<slug>/fixpoint/: $($invalidNamespaceRefs -join ', ')."
    }
    $attestationRefs = @($fixpointRefs | Where-Object {
        $_ -cmatch '^docs/evidence/[^/]+/fixpoint/attestation\.json$'
    })
    if ($attestationRefs.Count -ne 1) {
        throw "self_referential_bootstrap: entry '$entryId' fixpoint must reference exactly one docs/evidence/<slug>/fixpoint/attestation.json."
    }
    $attestationRef = $attestationRefs[0]
    $revisionRef = $HeadSha + ':' + $attestationRef
    $attestationJson = (& git -C $RepoRoot show $revisionRef 2>$null) -join ([string][char]10)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($attestationJson)) {
        throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation '$attestationRef' cannot be read from the exact PR head."
    }
    try {
        $document = [System.Text.Json.JsonDocument]::Parse($attestationJson)
    } catch {
        throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation is not valid JSON: $($_.Exception.Message)"
    }
    try {
        $root = $document.RootElement
        Assert-SelfReferentialJsonObjectShape -Element $root -Context "entry '$entryId' fixpoint attestation" -RequiredProperties @(
            'schema_version', 'entry_id', 'mechanism_commit',
            'verification_contract_sha256', 'result', 'commands')
        foreach ($propertyName in @(
            'schema_version', 'entry_id', 'mechanism_commit',
            'verification_contract_sha256', 'result')) {
            if ($root.GetProperty($propertyName).ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
                throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation $propertyName must be a JSON string."
            }
        }
        if ($root.GetProperty('schema_version').GetString() -cne 'self-referential-fixpoint-attestation/v1') {
            throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation has an unsupported schema_version."
        }
        if ($root.GetProperty('entry_id').GetString() -cne $entryId) {
            throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation entry_id does not match the ledger entry."
        }
        if ($root.GetProperty('mechanism_commit').GetString() -cne $mechanismCommit) {
            throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation mechanism_commit does not match the ledger fixpoint."
        }
        if ($root.GetProperty('verification_contract_sha256').GetString() -cne $contractDigest) {
            throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation verification_contract_sha256 does not match the immutable opening contract."
        }
        if ($root.GetProperty('result').GetString() -cne 'pass') {
            throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation result must be exactly pass."
        }
        $commands = $root.GetProperty('commands')
        if ($commands.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
            throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation commands must be a JSON array."
        }
        $commandElements = @($commands.EnumerateArray())
        if ($commandElements.Count -ne $expectedCommandIds.Count) {
            throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation must report every verification_contract command exactly once."
        }
        for ($index = 0; $index -lt $expectedCommandIds.Count; $index++) {
            $command = $commandElements[$index]
            Assert-SelfReferentialJsonObjectShape -Element $command -Context "entry '$entryId' fixpoint attestation command[$index]" -RequiredProperties @('id', 'exit_code')
            if ($command.GetProperty('id').ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
                throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation command[$index].id must be a JSON string."
            }
            if ($command.GetProperty('id').GetString() -cne $expectedCommandIds[$index]) {
                throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation command[$index] does not match the ordered verification_contract."
            }
            $exitCodeElement = $command.GetProperty('exit_code')
            $exitCode = 0
            if ($exitCodeElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or
                -not $exitCodeElement.TryGetInt32([ref]$exitCode) -or $exitCode -ne 0) {
                throw "self_referential_bootstrap: entry '$entryId' fixpoint attestation command '$($expectedCommandIds[$index])' must have integer exit_code 0."
            }
        }
    } finally {
        $document.Dispose()
    }
}

function Compare-SelfReferentialLedgerTransition {
    # Evaluates the base -> head ledger transition. The ledger is append-only and
    # entries are immutable except for the single legal open -> closed transition:
    #   removed entry                  -> violation (deleting debt is the attack)
    #   mutated entry (any field)      -> violation
    #   open -> open, repair_prs tail  -> recorded as a repair candidate; the body
    #                                     gate decides whether THIS PR may claim it
    #   open -> closed                 -> fixpoint must be real (see below)
    #   new entry                      -> must be open, self-registered to THIS PR,
    #                                     and scoped to this PR's changed paths
    # Returns @{ NewEntries; ClosedEntries; RepairEntries; OpenDebt } where OpenDebt
    # is the union of base-open entries not legally closed and head-open entries.
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
    $repairEntries = @()
    foreach ($id in $headById.Keys) {
        $head = $headById[$id]
        if (-not $baseById.ContainsKey($id)) {
            if ([string]$head.status -ne 'open') {
                throw "self_referential_bootstrap: new entry '$id' must be born open; opening and closing debt in the same PR defeats the fixpoint obligation."
            }
            # repair_prs is optional at the SCHEMA level only so that entries
            # written before the repair lane existed stay parsable and immutable.
            # An entry born in this transition has no repair history by
            # construction, so declaring the field at all - empty array included -
            # is a fabricated record: it never passed through a repair transition
            # and was never bound to a repairing PR's number. Presence is the
            # violation, not content.
            if ($null -ne $head.PSObject.Properties['repair_prs']) {
                throw "self_referential_bootstrap: new entry '$id' must not declare repair_prs; that field records completed repairs and can only be appended by a later repair PR bound to its own PR number."
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
                # A linked successor intentionally covers only the repair paths
                # outside its predecessor's immutable surface (plus the ledger).
                # The repair lane derives and checks that exact set below. Normal
                # entries retain the full-coverage invariant here.
                if ($null -eq $head.PSObject.Properties['successor_of']) {
                    $uncovered = @($MechanismPaths | Where-Object { -not (@($declaredPaths) -ccontains $_) })
                    if ($uncovered.Count -gt 0) {
                        throw "self_referential_bootstrap: new entry '$id' does not cover every mechanism path this PR changes; missing: $($uncovered -join ', ')."
                    }
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
        # Every canonical entry comparison below is -cne, never -ne: PowerShell's
        # -ne is CASE-INSENSITIVE on strings (measured on 7.5.4: 'abc' -ne 'ABC'
        # is False, 'abc' -cne 'ABC' is True), so a case-only edit to any field
        # read as "unchanged" and walked past immutability entirely. That matters
        # most for declared git paths, which ARE case-sensitive - the same reason
        # the new-entry path below compares them with -ccontains.
        if ($baseStatus -eq 'closed') {
            if ((ConvertTo-SelfReferentialCanonicalEntry $base) -cne (ConvertTo-SelfReferentialCanonicalEntry $head)) {
                throw "self_referential_bootstrap: closed entry '$id' was modified; closed entries are immutable."
            }
            continue
        }
        # base open
        if ($headStatus -eq 'open') {
            if ((ConvertTo-SelfReferentialCanonicalEntry $base) -cne (ConvertTo-SelfReferentialCanonicalEntry $head)) {
                # One narrow exception (issue #494): a tail append to repair_prs.
                # Everything else about the entry stays immutable, so the debt,
                # its contract, and its declared surface cannot be edited under
                # cover of a repair. Assert-SelfReferentialRepairLane decides
                # whether the append is legal FOR THIS PR; this only records it.
                $appendedPrs = Get-SelfReferentialRepairAppend -BaseEntry $base -HeadEntry $head
                if ($null -eq $appendedPrs) {
                    throw "self_referential_bootstrap: open entry '$id' was modified; the only legal transition is open -> closed with a real fixpoint, or an append-only repair_prs record."
                }
                $repairEntries += [pscustomobject]@{ Id = $id; AppendedPrs = @($appendedPrs) }
            }
            continue
        }
        # open -> closed: the fixpoint must be real, not merely well-formed.
        $baseComparable = $base | Select-Object -Property * -ExcludeProperty status, fixpoint
        $headComparable = $head | Select-Object -Property * -ExcludeProperty status, fixpoint
        if ((ConvertTo-SelfReferentialCanonicalEntry $baseComparable) -cne (ConvertTo-SelfReferentialCanonicalEntry $headComparable)) {
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

    # Every debt closes in its own reviewable transition. This global singularity
    # is simpler and safer than checking only direct linked pairs: a malformed or
    # legacy discontinuous chain could otherwise close non-adjacent entries
    # together, make OpenDebt empty, and skip the body-level chain exception.
    if ($closedEntries.Count -gt 1) {
        $closedIds = @($closedEntries | ForEach-Object { [string]$_.id }) -join ', '
        throw "self_referential_bootstrap: each closure transition must close exactly one ledger entry; close these entries in separate transitions: $closedIds."
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
        RepairEntries = @($repairEntries)
        OpenDebt      = @($openDebt)
    }
}

function Assert-SelfReferentialRepairLane {
    # Regression-repair lane (issue #494). The first fixpoint run of a mechanism
    # can surface a regression in that same mechanism, and the contract used to
    # leave no legal way to fix it: naming the open entry hit the impersonation
    # guard, self-registering a second entry hit the other-open-debt gate, and
    # declaring bootstrap=no hit that gate too. This lane opens exactly one door -
    # a repair PR binds itself to the EXISTING debt by appending its own number to
    # that entry's repair_prs - and every other invariant is re-asserted here:
    #   (1) the entry is pre-existing debt that stays open on both sides,
    #   (2) the append is exactly this PR's number (so the binding is machine-checked),
    #   (3) the repair does real work - a mechanism path beyond the ledger itself,
    #   (4) every in-surface path stays bound to its active-chain owner; any
    #       necessary outside path is bound to one independently contracted leaf,
    #       and
    #   (5) the transition never closes debt and opens no unrelated debt.
    # Every entry therefore keeps its single legal open -> closed transition,
    # and each linked entry's closure attestation must prove its own mechanism.
    param(
        [Parameter(Mandatory = $true)][string] $EntryId,
        [Parameter(Mandatory = $true)] $Transition,
        [Parameter(Mandatory = $true)] $BaseLedger,
        [Parameter(Mandatory = $true)] $HeadLedger,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $MechanismPaths,
        [int] $PrNumber = 0
    )

    # (1) pre-existing OPEN debt on both sides. A head-only or closed entry is the
    # impersonation case the original guard was written for, so it keeps that message.
    $baseEntries = @($BaseLedger.entries | Where-Object { [string]$_.id -ceq $EntryId })
    if ($baseEntries.Count -ne 1 -or [string]$baseEntries[0].status -cne 'open') {
        throw "self_referential_bootstrap: PR body names ledger entry '$EntryId' but this PR does not ADD it and it is not open debt at the PR base; each bootstrap PR must self-register its own open entry (base-vs-head verified)."
    }
    $headEntries = @($HeadLedger.entries | Where-Object { [string]$_.id -ceq $EntryId })
    if ($headEntries.Count -ne 1 -or [string]$headEntries[0].status -cne 'open') {
        throw "self_referential_bootstrap: repair PR for entry '$EntryId' must leave that entry open; a repair cannot double as the fixpoint closure it is repairing."
    }

    # (2) the repair must bind itself to THIS PR. Without a live PR number there is
    # nothing to bind against, so an unbound run is refused rather than skipped.
    if ($PrNumber -le 0) {
        throw "self_referential_bootstrap: repair of ledger entry '$EntryId' requires a live PR number to bind repair_prs; refusing an unbound repair."
    }
    $allRepairs = @($Transition.RepairEntries)
    $repairs = @($allRepairs | Where-Object { [string]$_.Id -ceq $EntryId })
    if ($repairs.Count -ne 1) {
        throw "self_referential_bootstrap: PR body names ledger entry '$EntryId' but this PR does not ADD it and does not append a repair_prs record for it; each bootstrap PR must self-register its own open entry, or register itself as a repair of the open entry it fixes."
    }
    # One door, one entry. The transition records EVERY open entry whose sole
    # change is a repair_prs tail append, but the body names exactly one - so
    # validating only the named record would let a second entry's audit history
    # ride along without ever meeting the PR-number or declared-surface checks
    # (L1-COR-001). A linked successor chain deliberately has multiple open
    # entries, so this is an active invariant rather than only defence in depth.
    if ($allRepairs.Count -ne 1) {
        $unnamedRepairIds = @($allRepairs |
            Where-Object { [string]$_.Id -cne $EntryId } |
            ForEach-Object { [string]$_.Id }) -join ', '
        throw "self_referential_bootstrap: a repair PR must touch exactly one ledger entry; this transition also appends repair_prs to: $unnamedRepairIds. Each repaired entry needs its own PR, bound by its own PR number."
    }
    $appendedPrs = @($repairs[0].AppendedPrs)
    if ($appendedPrs.Count -ne 1 -or ([int]$appendedPrs[0]) -ne $PrNumber) {
        throw "self_referential_bootstrap: repair of ledger entry '$EntryId' must append exactly this PR number to repair_prs; appended $($appendedPrs -join ', ') on PR #$PrNumber."
    }

    # (3) a repair must actually repair something. "Changed at least one mechanism
    # path" proves nothing here: the ledger is ITSELF a classified mechanism path,
    # and a repair PR necessarily edits it to append repair_prs, so that test is
    # true by construction (measured: Get-SelfReferentialMechanismPaths returns
    # exactly the ledger for a ledger-only PR, and a PR with no mechanism path at
    # all returns from the body gate long before reaching this lane). Requiring a
    # NON-LEDGER mechanism path is what stops a PR from appending a repair record
    # that fixes nothing and only pollutes the entry's audit history. It is the
    # exact mirror of the closure rule below, which allows a closure to touch the
    # ledger and nothing else.
    $repairedMechanism = @($MechanismPaths | Where-Object {
        $_ -cne 'scripts/self-referential-bootstrap-ledger.json'
    })
    if ($repairedMechanism.Count -eq 0) {
        throw "self_referential_bootstrap: repair of ledger entry '$EntryId' changes no verification-mechanism path other than the ledger; a repair_prs record must document real repair work, not an empty entry in the audit history."
    }

    # (4) a repair fixes the debt it is bound to - it may not widen it. Comparison
    # is case-sensitive for the same reason declared paths are: git paths are.
    #
    # This surface deliberately INCLUDES this gate's own adjudicators. An earlier
    # revision banned them outright, reasoning that a PR repairing the rule that
    # judges it could wave itself through. That reasoning does not survive the
    # workflow: .github/workflows/pr-review-agent.yml checks out
    # pull_request.base.sha, materializes the gate from BASE via `git archive`,
    # and exits non-zero with base_gate_incomplete_external_approval_required
    # rather than ever falling back to the head checker - so a PR is never
    # adjudicated by its own edited adjudicator (test-base-gate-capability.ps1 is
    # the executable form of that invariant). The ban also deadlocked the debt it
    # meant to protect: an entry that declares an adjudicator path - as this
    # repository's own open entry does - could never have a failing fixpoint
    # repaired at all, reproducing issue #494 one level up. What keeps the
    # relaxation safe is unchanged: base-pinned adjudication means no
    # self-clearance, declared-subset means no scope expansion, and the fixpoint
    # obligation still requires the repaired mechanism to prove itself against the
    # entry's frozen verification contract before the debt can close.
    $activeChain = @(Get-SelfReferentialOpenSuccessorChain -Ledger $BaseLedger -EntryId $EntryId)
    $activeSurface = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($activeEntry in $activeChain) {
        foreach ($path in @($activeEntry.verification_mechanism_paths)) {
            $null = $activeSurface.Add([string]$path)
        }
    }
    $outsidePaths = @($MechanismPaths | Where-Object { -not $activeSurface.Contains([string]$_) })
    $newEntries = @($Transition.NewEntries)

    # (5) If a real repair necessarily changes a classified dependency outside
    # the active open chain's immutable surface union, the same PR must open
    # exactly one independently contracted successor at the unique leaf. This is
    # the only exception to the repair lane's no-new-debt rule. It preserves every
    # existing entry verbatim, binds only the new delta to the current PR, and
    # prevents arbitrary scope extension or duplicate path ownership.
    if ($outsidePaths.Count -eq 0) {
        if ($newEntries.Count -gt 0) {
            $newIds = @($newEntries | ForEach-Object { [string]$_.id }) -join ', '
            throw "self_referential_bootstrap: repair of ledger entry '$EntryId' has no outside-surface mechanism path, so it must not open successor debt ($newIds)."
        }
    } else {
        if ($newEntries.Count -ne 1) {
            throw "self_referential_bootstrap: repair of ledger entry '$EntryId' changes paths outside its declared surface ($($outsidePaths -join ', ')) and must open exactly one linked successor debt; found $($newEntries.Count)."
        }
        # Only a single contiguous open lineage may grow. The entry whose
        # fixpoint failed remains the repair target (and owns repair_prs), while
        # the new debt attaches to the lineage's current leaf to avoid a fork.
        $activeChain = @(Get-SelfReferentialOpenSuccessorChain -Ledger $BaseLedger `
            -EntryId $EntryId -RequireAllOpen)
        $attachmentLeaf = $activeChain[-1]
        $attachmentLeafId = [string]$attachmentLeaf.id
        $successor = $newEntries[0]
        $successorProperty = $successor.PSObject.Properties['successor_of']
        if ($null -eq $successorProperty -or [string]$successorProperty.Value -cne $attachmentLeafId) {
            throw "self_referential_bootstrap: successor entry '$($successor.id)' must declare successor_of='$attachmentLeafId', the unique open successor-chain leaf."
        }
        $existingSuccessors = @($BaseLedger.entries | Where-Object {
            $property = $_.PSObject.Properties['successor_of']
            $null -ne $property -and [string]$property.Value -ceq $attachmentLeafId
        })
        if ($existingSuccessors.Count -gt 0) {
            throw "self_referential_bootstrap: open successor-chain leaf '$attachmentLeafId' already has successor '$($existingSuccessors[0].id)'; a second successor is forbidden."
        }

        $expectedSuccessorPaths = @('scripts/self-referential-bootstrap-ledger.json')
        $expectedSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        $null = $expectedSeen.Add('scripts/self-referential-bootstrap-ledger.json')
        foreach ($path in $outsidePaths) {
            if ($expectedSeen.Add([string]$path)) { $expectedSuccessorPaths += [string]$path }
        }
        $successorPaths = @($successor.verification_mechanism_paths | ForEach-Object { [string]$_ })
        $successorSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        $duplicateSuccessorPaths = @($successorPaths | Where-Object { -not $successorSeen.Add($_) })
        $missingSuccessorPaths = @($expectedSuccessorPaths | Where-Object { -not ($successorPaths -ccontains $_) })
        $extraSuccessorPaths = @($successorPaths | Where-Object { -not ($expectedSuccessorPaths -ccontains $_) })
        if ($duplicateSuccessorPaths.Count -gt 0 -or $missingSuccessorPaths.Count -gt 0 -or $extraSuccessorPaths.Count -gt 0) {
            throw "self_referential_bootstrap: successor entry '$($successor.id)' verification_mechanism_paths must equal the ledger plus every outside-surface classified path; missing=[$($missingSuccessorPaths -join ', ')], extra=[$($extraSuccessorPaths -join ', ')], duplicates=[$($duplicateSuccessorPaths -join ', ')]."
        }

        # The successor may add verification commands, but cannot remove or
        # reorder the attachment leaf's frozen command set. Each generation's
        # prefix preservation transitively retains every ancestor contract.
        $predecessorCommands = @($attachmentLeaf.verification_contract.command_ids | ForEach-Object { [string]$_ })
        $successorCommands = @($successor.verification_contract.command_ids | ForEach-Object { [string]$_ })
        if ($successorCommands.Count -lt $predecessorCommands.Count) {
            throw "self_referential_bootstrap: successor entry '$($successor.id)' verification_contract downgrades predecessor '$attachmentLeafId' by removing commands."
        }
        for ($index = 0; $index -lt $predecessorCommands.Count; $index++) {
            if ($successorCommands[$index] -cne $predecessorCommands[$index]) {
                throw "self_referential_bootstrap: successor entry '$($successor.id)' verification_contract must preserve predecessor '$attachmentLeafId' command_ids as an ordered prefix."
            }
        }
    }
    # Defence in depth since condition 3 began demanding a non-ledger mechanism
    # path: a repair that also closes debt is now refused before reaching here on
    # both reachable paths - ledger-only changed paths fail condition 3, and any
    # non-ledger mechanism path trips the closure single-purpose rule while the
    # closure is evaluated. Kept so the rule survives either of those moving.
    if (@($Transition.ClosedEntries).Count -gt 0) {
        $closedIds = @($Transition.ClosedEntries | ForEach-Object { [string]$_.id }) -join ', '
        throw "self_referential_bootstrap: a repair PR must not close debt in the same transition ($closedIds); the fixpoint closure must run after the repair merges."
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
    if ($mechanismPaths.Count -eq 0) {
        if (-not $HasBaseContext) {
            throw 'self_referential_bootstrap: exact base context is required to protect immutable referenced evidence.'
        }
        $evidenceBaseLedgerPresent = if ($null -eq $BaseLedgerExists) {
            -not [string]::IsNullOrWhiteSpace($BaseLedgerJson)
        } else {
            [bool]$BaseLedgerExists
        }
        $evidenceBaseLedger = if ($evidenceBaseLedgerPresent) {
            Get-SelfReferentialBootstrapLedger -Json $BaseLedgerJson
        } else {
            [pscustomobject]@{
                schema_version = 'self-referential-bootstrap-ledger/v1'
                entries = @()
            }
        }
        Assert-SelfReferentialBaseEvidenceImmutable -BaseLedger $evidenceBaseLedger -ChangedPaths $ChangedPaths -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
        return
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
            Assert-SelfReferentialBaseEvidenceImmutable -BaseLedger $baseLedger -ChangedPaths $ChangedPaths -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
        } else {
            # An existing-but-empty or corrupt base ledger is not equivalent to a
            # missing first-introduction ledger. Parse it and fail closed.
            $baseLedger = Get-SelfReferentialBootstrapLedger -Json $BaseLedgerJson
            Assert-SelfReferentialBaseEvidenceImmutable -BaseLedger $baseLedger -ChangedPaths $ChangedPaths -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
        }
    }

    $transition = Compare-SelfReferentialLedgerTransition `
        -BaseLedger $baseLedger -HeadLedger $headLedger `
        -ChangedPaths $ChangedPaths -MechanismPaths $mechanismPaths `
        -PrNumber $PrNumber -RepoRoot $RepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
    $newIds = @($transition.NewEntries | ForEach-Object { [string]$_.id })

    if (@($transition.ClosedEntries).Count -gt 0) {
        if (@($transition.NewEntries).Count -gt 0) {
            throw "self_referential_bootstrap: a fixpoint closure PR cannot also open new debt; close the existing entry and introduce the next mechanism change in separate PRs."
        }
        foreach ($closedEntry in @($transition.ClosedEntries)) {
            Assert-SelfReferentialFixpointAttestation -Entry $closedEntry -RepoRoot $RepoRoot -HeadSha $HeadSha
        }
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
            # A fully attested, ledger-only closure must remain possible while a
            # contiguous successor suffix is still open. Without this exception
            # a later fixpoint dependency merely moves the repair deadlock to
            # closure. Only the oldest open root may close, one entry per PR;
            # unrelated/discontinuous debt and all non-closure PRs stay blocked.
            $linkedClosure = $false
            $closedEntries = @($transition.ClosedEntries)
            $remainingDebt = @($transition.OpenDebt)
            if ($closedEntries.Count -eq 1 -and
                @($transition.NewEntries).Count -eq 0 -and @($transition.RepairEntries).Count -eq 0) {
                $closedEntry = $closedEntries[0]
                $baseOpenChain = @(Get-SelfReferentialOpenSuccessorChain -Ledger $baseLedger `
                    -EntryId ([string]$closedEntry.id) -RequireAllOpen)
                $expectedRemaining = @($baseOpenChain | Select-Object -Skip 1)
                $expectedRemainingIds = @($expectedRemaining | ForEach-Object { [string]$_.id })
                $closesOldestRoot = $baseOpenChain.Count -gt 1 -and
                    [string]$baseOpenChain[0].id -ceq [string]$closedEntry.id -and
                    $remainingDebt.Count -eq $expectedRemaining.Count
                if ($closesOldestRoot) {
                    foreach ($remainingEntry in $remainingDebt) {
                        if (-not ($expectedRemainingIds -ccontains [string]$remainingEntry.id)) {
                            $closesOldestRoot = $false
                            break
                        }
                    }
                }
                $allowedLinkedClosurePaths = @(
                    'scripts/self-referential-bootstrap-ledger.json'
                    @($closedEntry.fixpoint.evidence_refs | ForEach-Object { [string]$_ })
                )
                $unexpectedLinkedClosurePaths = @($ChangedPaths | Where-Object {
                    -not ($allowedLinkedClosurePaths -ccontains $_)
                })
                # Close in oldest-root -> leaf order. Allowing a descendant to
                # close first would make the active open suffix discontinuous.
                $linkedClosure = $closesOldestRoot -and
                    $unexpectedLinkedClosurePaths.Count -eq 0
            }
            if (-not $linkedClosure) {
                $ids = @($transition.OpenDebt | ForEach-Object { [string]$_.id }) -join ', '
                throw "self_referential_bootstrap: open ledger debt ($ids) blocks further verification-mechanism PRs until fixpoint evidence is committed."
            }
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
    # head, absent at base). Pointing at an earlier PR's open entry is refused -
    # EXCEPT along the regression-repair lane (issue #494), where the PR fixes the
    # mechanism that entry already owns and registers itself in its repair_prs.
    if ($entryId -notin $newIds) {
        Assert-SelfReferentialRepairLane -EntryId $entryId -Transition $transition `
            -BaseLedger $baseLedger -HeadLedger $headLedger `
            -MechanismPaths $mechanismPaths -PrNumber $PrNumber
        return
    }

    $declaredNewEntry = @($transition.NewEntries | Where-Object { [string]$_.id -ceq $entryId })[0]
    if ($null -ne $declaredNewEntry.PSObject.Properties['successor_of']) {
        throw "self_referential_bootstrap: successor entry '$entryId' cannot be self-registered as ordinary new debt; the PR body must name and repair its open predecessor."
    }

    $otherOpen = @($transition.OpenDebt | Where-Object { [string]$_.id -ne $entryId })
    if ($otherOpen.Count -gt 0) {
        $ids = @($otherOpen | ForEach-Object { [string]$_.id }) -join ', '
        throw "self_referential_bootstrap: open ledger debt ($ids) blocks further verification-mechanism PRs until fixpoint evidence is committed."
    }
}
