#requires -Version 7.0
<#
.SYNOPSIS
    Behaviour tests for the Agent Governance Policy module.

.DESCRIPTION
    Structure follows the architecture gates (tests/test_layered_architecture.py,
    tests/test_lifecycle_contracts.py):

      1. per-rule-kind behaviour, driven through the in-memory RepoSnapshotPort adapter
      2. YAML subset reader behaviour, including every construct that must fail closed
      3. ratchet behaviour, with base and head supplied as two refs on one fake snapshot
      4. a canonical test that runs the real rule document against the real working tree
      5. PINNED_* constants that make policy loosening visible in a review diff

    Rule INSTANCES deliberately have no individual tests: they are data, and the canonical test
    proves the whole set holds against this repository. What is tested here is the machinery that
    interprets them, which is the part that can be wrong in ways data cannot.

.PARAMETER DumpFingerprints
    Print the canonical fingerprint of every load-bearing rule and exit. Used when a load-bearing
    rule is deliberately changed and PINNED_LOAD_BEARING has to be updated in the same commit.
#>
[CmdletBinding()]
param(
    [switch] $DumpFingerprints
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Failures = 0
$script:Assertions = 0

function Assert-True {
    param([object] $Condition, [string] $Message)

    $script:Assertions++
    if ($Condition -is [array]) {
        $Condition = ($Condition.Count -gt 0 -and -not ($Condition -contains $false))
    }
    if (-not $Condition) {
        Write-Host "  FAIL  $Message" -ForegroundColor Red
        $script:Failures++
    }
}

function Assert-Throws {
    param([scriptblock] $Action, [string] $Message)

    $script:Assertions++
    try {
        & $Action | Out-Null
        Write-Host "  FAIL  $Message (no exception was thrown)" -ForegroundColor Red
        $script:Failures++
    } catch {
        # expected
    }
}

function Test-FindingCodes {
    param([object] $Verdict, [string[]] $Expected, [string] $Message)

    $actual = @($Verdict.findings | ForEach-Object { $_.code }) | Sort-Object
    $wanted = @($Expected) | Sort-Object
    Assert-True (($actual -join ',') -eq ($wanted -join ',')) "$Message (got: $($actual -join ',') want: $($wanted -join ','))"
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Import-Module (Join-Path $repoRoot 'scripts/lib/agent-governance-policy.psm1') -Force

# ---------------------------------------------------------------------------------------------
# Canonical fingerprint of one rule: key order and JSON formatting must not change the value, or
# a reformat of the rule file would read as a policy change.
# ---------------------------------------------------------------------------------------------
function ConvertTo-CanonicalText {
    param([AllowNull()] $Node)

    if ($null -eq $Node) { return 'null' }
    if ($Node -is [System.Collections.IDictionary]) {
        $parts = foreach ($key in (@($Node.Keys) | Sort-Object)) {
            '{0}={1}' -f $key, (ConvertTo-CanonicalText -Node $Node[$key])
        }
        return '{' + ($parts -join ';') + '}'
    }
    if ($Node -is [System.Array]) {
        return '[' + ((@($Node) | ForEach-Object { ConvertTo-CanonicalText -Node $_ }) -join ';') + ']'
    }
    return [string]$Node
}

function Get-RuleFingerprint {
    param([System.Collections.IDictionary] $Rule)

    # 'replaces' is provenance for the migration, not policy, so it is excluded: rewording it must
    # not read as a rule change.
    $subject = [ordered]@{}
    foreach ($key in (@($Rule.Keys) | Sort-Object)) {
        if ($key -eq 'replaces') { continue }
        $subject[$key] = $Rule[$key]
    }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-CanonicalText -Node $subject))
    $stream = [System.IO.MemoryStream]::new($bytes)
    try {
        return (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash.ToLowerInvariant().Substring(0, 16)
    } finally {
        $stream.Dispose()
    }
}

# ---------------------------------------------------------------------------------------------
# PINNED: the review-enforced layer. The ratchet catches removal and severity downgrade; these
# catch a load-bearing rule being quietly hollowed out while keeping its id. Changing either set
# requires editing this file, which is exactly the point - it shows up in the review diff.
# ---------------------------------------------------------------------------------------------
$PINNED_RULE_KINDS = @(
    'codeowners_owns'
    'file_exists'
    'json_node'
    'json_schema'
    'yaml_every'
    'yaml_node'
)

$PINNED_LOAD_BEARING = [ordered]@{
    'governance-surface-present'                     = 'b2a45aa669ebd7a9'
    'verification-manifest-schema'                   = 'fb24fc481fe18915'
    'trusted-host-merge-contract-schema'             = 'cf10f54074df9194'
    'metrics-authority-self-change-full-dispatch'    = '8cf53f93182a965a'
    'root-contract-trigger-closure'                  = '703944f11987d023'
    'agent-governance-target-binds-required-context' = '52ccf4d270fdc55e'
    'metrics-not-merge-authority'                    = '0c0c0a65fad975cd'
    'classifier-guard-on-every-dependent-job'        = 'e58b4e7e5fd4df31'
    'classifier-guard-condition'                     = '9dd528aa80c1d6fd'
    'agent-governance-suite-runs-the-static-check'   = 'e6063538915df9a3'
    'agent-governance-steps-use-pwsh'                = 'a43527ee9d261012'
    'codeowners-wildcard-fallback'                   = '71b95146d5152586'
}

$rulesPath = Join-Path $repoRoot 'scripts/agent-governance-rules.json'
$canonicalRules = (Get-Content -LiteralPath $rulesPath -Raw -Encoding utf8) | ConvertFrom-Json -AsHashtable

if ($DumpFingerprints) {
    foreach ($rule in $canonicalRules['rules']) {
        $id = [string]$rule['id']
        if ($PINNED_LOAD_BEARING.Contains($id)) {
            Write-Host ("    '{0}'{1}= '{2}'" -f $id, (' ' * [Math]::Max(1, 48 - $id.Length)), (Get-RuleFingerprint -Rule $rule))
        }
    }
    exit 0
}

# =============================================================================================
Write-Host 'rule kinds: file_exists'
# =============================================================================================
$snapshot = New-AgentGovernanceFakeSnapshot -Files @{
    ':present.md' = 'body'
}
$verdict = Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules @{
    rules = @(@{ id = 'r'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('present.md') })
}
Assert-True ($verdict.status -eq 'passed') 'file_exists passes when the path is present'

$verdict = Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules @{
    rules = @(@{ id = 'r'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('present.md', 'gone.md') })
}
Test-FindingCodes -Verdict $verdict -Expected @('file.missing') 'file_exists reports each absent path'
Assert-True ($verdict.evaluated_count -eq 1) 'a multi-path rule counts as one evaluated rule'

# Regression guard: one rule can emit several findings, and each must be counted separately. A
# nested-array return makes error_count collapse to one per RULE, which reads as "fewer problems".
$verdict = Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules @{
    rules = @(@{ id = 'r'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('gone-a.md', 'gone-b.md', 'present.md') })
}
Assert-True ($verdict.error_count -eq 2) 'every finding from a single rule is counted individually'
Assert-True (@($verdict.findings).Count -eq 2) 'findings are flat, not nested per rule'

# An empty file is present, not missing: '' and $null must stay distinguishable across the port.
$emptySnapshot = New-AgentGovernanceFakeSnapshot -Files @{ ':empty.md' = '' }
$verdict = Invoke-AgentGovernancePolicy -Snapshot $emptySnapshot -Rules @{
    rules = @(@{ id = 'r'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('empty.md') })
}
Assert-True ($verdict.status -eq 'passed') 'an empty file counts as present'

# =============================================================================================
Write-Host 'rule kinds: json_node'
# =============================================================================================
$jsonSnapshot = New-AgentGovernanceFakeSnapshot -Files @{
    ':m.json' = '{"policy":{"targets":["a","b"],"scope":"deployables-only","slot":null},"classes":[{"id":"x","globs":["g1"]},{"id":"y","globs":["g2"]}]}'
    ':bad.json' = '{not json'
}

function New-JsonRule {
    param([hashtable] $Extra)
    $rule = @{ id = 'r'; kind = 'json_node'; severity = 'error'; title = 't'; path = 'm.json' }
    foreach ($key in $Extra.Keys) { $rule[$key] = $Extra[$key] }
    return @{ rules = @($rule) }
}

Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.scope'; equals = 'deployables-only' })).status -eq 'passed') `
    'json_node equals matches'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.scope'; equals = 'Deployables-Only' })).status -eq 'failed') `
    'json_node equals is case-sensitive'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.targets'; contains = @('a', 'b') })).status -eq 'passed') `
    'json_node contains matches every needle'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.targets'; contains = @('a', 'c') })).status -eq 'failed') `
    'json_node contains fails on a missing needle'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.slot'; is_null = $true })).status -eq 'passed') `
    'json_node is_null accepts a declared-but-empty slot'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.scope'; is_null = $true })).status -eq 'failed') `
    'json_node is_null rejects a populated slot'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.absent'; exists = $false })).status -eq 'passed') `
    'json_node exists=false accepts an absent key'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.slot'; exists = $false })).status -eq 'failed') `
    'json_node distinguishes a null value from an absent key'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'classes[id=y].globs'; contains = @('g2') })).status -eq 'passed') `
    'json_node selects an array element by field'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'classes[id=zzz].globs'; contains = @('g2') })).status -eq 'failed') `
    'json_node fails closed when the selector matches nothing'
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules (New-JsonRule @{ pointer = 'policy.targets.0'; equals = 'a' })).status -eq 'passed') `
    'json_node indexes arrays positionally'

$verdict = Invoke-AgentGovernancePolicy -Snapshot $jsonSnapshot -Rules @{
    rules = @(@{ id = 'r'; kind = 'json_node'; severity = 'error'; title = 't'; path = 'bad.json'; pointer = 'a' })
}
Test-FindingCodes -Verdict $verdict -Expected @('json.unparsed') 'unparseable JSON fails closed rather than passing'

# =============================================================================================
Write-Host 'rule kinds: json_schema'
# =============================================================================================
$schemaSnapshot = New-AgentGovernanceFakeSnapshot -Files @{
    ':doc.json'      = '{"n":1}'
    ':bad.json'      = '{"n":"text"}'
    ':s.json'        = '{"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}'
    ':vacuous.json'  = '{}'
}
function New-SchemaRule {
    param([string] $Path, [string] $Schema)
    return @{ rules = @(@{ id = 'r'; kind = 'json_schema'; severity = 'error'; title = 't'; path = $Path; schema = $Schema }) }
}
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $schemaSnapshot -Rules (New-SchemaRule 'doc.json' 's.json')).status -eq 'passed') `
    'json_schema passes a conforming document'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $schemaSnapshot -Rules (New-SchemaRule 'bad.json' 's.json')) `
    -Expected @('schema.violation') 'json_schema rejects a non-conforming document'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $schemaSnapshot -Rules (New-SchemaRule 'doc.json' 'vacuous.json')) `
    -Expected @('schema.vacuous') 'a schema replaced by {} fails instead of vacuously passing'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $schemaSnapshot -Rules (New-SchemaRule 'doc.json' 'absent.json')) `
    -Expected @('schema.missing') 'a missing schema fails closed'

# =============================================================================================
Write-Host 'rule kinds: yaml_every'
# =============================================================================================
$workflowYaml = @'
jobs:
  guarded:
    if: always() && (needs.changes.result != 'success')
    steps:
      - name: Require changed-path classifier success
        run: throw
  unguarded:
    if: needs.changes.outputs.x == 'true'
    steps:
      - name: Checkout
'@

$yamlSnapshot = New-AgentGovernanceFakeSnapshot -Files @{ ':w.yml' = $workflowYaml }
$everyRule = @{
    id = 'r'; kind = 'yaml_every'; severity = 'error'; title = 't'; path = 'w.yml'; collection = 'jobs'
    where = @{ pointer = 'if'; starts_with = 'always() && (' }
    require = @{ pointer = 'steps.0.name'; equals = 'Require changed-path classifier success' }
}
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $yamlSnapshot -Rules @{ rules = @($everyRule) }).status -eq 'passed') `
    'yaml_every checks only the members its where clause selects'

$everyAll = $everyRule.Clone()
$everyAll.Remove('where')
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $yamlSnapshot -Rules @{ rules = @($everyAll) }) `
    -Expected @('yaml.every') 'yaml_every without a where clause holds every member to the requirement'

$everyNoMatch = $everyRule.Clone()
$everyNoMatch.where = @{ pointer = 'if'; starts_with = 'never() && (' }
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $yamlSnapshot -Rules @{ rules = @($everyNoMatch) }) `
    -Expected @('yaml.where_matched_nothing') 'a where clause that selects nothing fails closed rather than passing vacuously'

$everyEmpty = $everyRule.Clone()
$everyEmpty.collection = 'jobs.guarded.missing'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $yamlSnapshot -Rules @{ rules = @($everyEmpty) }) `
    -Expected @('yaml.collection_missing') 'a pointer typo in collection fails closed'

# Selecting a step by name must not depend on where it sits. A positional pointer is the same
# mistake as a count: it pins today's layout instead of the invariant. PR #553 inserted a step into
# the real Agent Governance suite, and index-pinned rules only survived because the insertion
# happened to land after them.
$namedStepYaml = @'
jobs:
  suite:
    steps:
      - name: Checkout
      - name: Run governance static check
        run: the-command
'@
$shiftedStepYaml = @'
jobs:
  suite:
    steps:
      - name: Checkout
      - name: Newly inserted step
        run: something-else
      - name: Run governance static check
        run: the-command
'@
$byNameRule = @{
    id = 'r'; kind = 'yaml_every'; severity = 'error'; title = 't'; path = 'w.yml'
    collection = 'jobs.suite.steps'
    where = @{ pointer = 'name'; equals = 'Run governance static check' }
    require = @{ pointer = 'run'; equals = 'the-command' }
}
foreach ($case in @(
    @{ Yaml = $namedStepYaml;   Why = 'at its original index' }
    @{ Yaml = $shiftedStepYaml; Why = 'after a step is inserted before it' }
)) {
    $snap = New-AgentGovernanceFakeSnapshot -Files @{ ':w.yml' = $case.Yaml }
    Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $snap -Rules @{ rules = @($byNameRule) }).status -eq 'passed') `
        "a name-selected step rule holds $($case.Why)"
}
# Renaming the step away must fail closed rather than pass vacuously: the invariant is that the
# named step exists AND runs the command.
$renamedSnap = New-AgentGovernanceFakeSnapshot -Files @{ ':w.yml' = ($namedStepYaml -replace 'Run governance static check', 'Run something else') }
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $renamedSnap -Rules @{ rules = @($byNameRule) }) `
    -Expected @('yaml.where_matched_nothing') 'renaming the selected step away fails closed'

$everyScalar = $everyRule.Clone()
$everyScalar.collection = 'jobs.guarded.if'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $yamlSnapshot -Rules @{ rules = @($everyScalar) }) `
    -Expected @('yaml.collection_not_iterable') 'a scalar collection fails closed'

# =============================================================================================
Write-Host 'rule kinds: codeowners_owns'
# =============================================================================================
$coSnapshot = New-AgentGovernanceFakeSnapshot -Files @{
    ':CODEOWNERS'      = "# comment`n* @owner`ndocs/ @docs-owner @second`n"
    ':commented'       = "# * @owner`n"
    ':duplicated'      = "* @owner`n* @other`n"
}
function New-CoRule {
    param([string] $Path, [string[]] $Owners, [bool] $Exactly = $false)
    return @{ rules = @(@{ id = 'r'; kind = 'codeowners_owns'; severity = 'error'; title = 't'; path = $Path; pattern = '*'; owners = $Owners; exactly = $Exactly }) }
}
Assert-True ((Invoke-AgentGovernancePolicy -Snapshot $coSnapshot -Rules (New-CoRule 'CODEOWNERS' @('@owner') $true)).status -eq 'passed') `
    'codeowners_owns matches an exact single owner'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $coSnapshot -Rules (New-CoRule 'CODEOWNERS' @('@nobody'))) `
    -Expected @('codeowners.owner_missing') 'codeowners_owns reports a missing owner'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $coSnapshot -Rules (New-CoRule 'commented' @('@owner'))) `
    -Expected @('codeowners.pattern_missing') 'a commented-out owner line does not satisfy the rule'
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $coSnapshot -Rules (New-CoRule 'duplicated' @('@owner'))) `
    -Expected @('codeowners.pattern_duplicated') 'a duplicated pattern fails closed because the last one silently wins'

# =============================================================================================
Write-Host 'YAML subset reader'
# =============================================================================================
$doc = ConvertFrom-AgentGovernanceYaml -Text "on:`n  push:`n    branches: [main, dev]`nname: x`n"
Assert-True ($doc.Contains('on')) "the 'on' key stays the string 'on' rather than becoming a boolean"
Assert-True ((@($doc['on']['push']['branches']) -join ',') -eq 'main,dev') 'inline flow sequences parse'
Assert-True ($doc['name'] -eq 'x') 'plain scalars parse'

$doc = ConvertFrom-AgentGovernanceYaml -Text "labels:`n  - a`n  - b`n"
Assert-True ((@($doc['labels']) -join ',') -eq 'a,b') 'plain scalar sequence items parse'

$doc = ConvertFrom-AgentGovernanceYaml -Text "steps:`n  - name: one`n    run: x`n  - name: two`n"
Assert-True (@($doc['steps']).Count -eq 2 -and $doc['steps'][0]['run'] -eq 'x') 'mapping sequence items keep their sibling keys'

$doc = ConvertFrom-AgentGovernanceYaml -Text "url: https://example.com/a`n"
Assert-True ($doc['url'] -eq 'https://example.com/a') 'a colon without a following space stays part of the scalar'

$doc = ConvertFrom-AgentGovernanceYaml -Text "text: `"a\nb`"`n"
Assert-True ($doc['text'] -eq "a`nb") 'double-quoted escape sequences expand'

$doc = ConvertFrom-AgentGovernanceYaml -Text "text: `"a\\`"b`"`n"
Assert-True ($doc['text'] -eq 'a\"b') 'escapes expand left to right rather than by sequential replacement'

$doc = ConvertFrom-AgentGovernanceYaml -Text "run: |`n  line one`n  line two`nnext: x`n"
Assert-True ($doc['run'] -eq "line one`nline two`n") 'literal block scalars keep their newlines'
Assert-True ($doc['next'] -eq 'x') 'a block scalar releases the keys that follow it'

$doc = ConvertFrom-AgentGovernanceYaml -Text "a: 1 # trailing`nb: '# not a comment'`n"
Assert-True ($doc['a'] -eq '1') 'trailing comments are stripped from plain scalars'
Assert-True ($doc['b'] -eq '# not a comment') 'a quoted hash is not a comment'

$doc = ConvertFrom-AgentGovernanceYaml -Text "empty:`nafter: x`n"
Assert-True ($doc.Contains('empty') -and $null -eq $doc['empty']) 'an empty value is a present key with a null value'

# Fail closed on everything outside the subset.
foreach ($unsupported in @(
    @{ Text = "a: &anchor x`n";              Why = 'anchors' }
    @{ Text = "a: *alias`n";                 Why = 'aliases' }
    @{ Text = "a: !!str x`n";                Why = 'explicit tags' }
    @{ Text = "a: {b: c}`n";                 Why = 'flow mappings' }
    @{ Text = "a: 1`n---`nb: 2`n";           Why = 'multi-document streams' }
    @{ Text = "a: 1`na: 2`n";                Why = 'duplicate keys' }
    @{ Text = "a:`n`tb: 1`n";                Why = 'tab indentation' }
    @{ Text = "a: `"unterminated`n";         Why = 'unterminated quotes' }
    @{ Text = "a: `"bad\q`"`n";              Why = 'unknown escapes' }
    @{ Text = "- item`n  nested: x`n";       Why = 'keys nested under a scalar sequence item' }
)) {
    Assert-Throws { ConvertFrom-AgentGovernanceYaml -Text $unsupported.Text } "the reader fails closed on $($unsupported.Why)"
}

# An unreadable document must redden the rule, never satisfy it.
$brokenSnapshot = New-AgentGovernanceFakeSnapshot -Files @{ ':w.yml' = "a: &anchor x`n" }
Test-FindingCodes -Verdict (Invoke-AgentGovernancePolicy -Snapshot $brokenSnapshot -Rules @{
    rules = @(@{ id = 'r'; kind = 'yaml_node'; severity = 'error'; title = 't'; path = 'w.yml'; pointer = 'a' })
}) -Expected @('yaml.unparsed') 'an unparseable document fails the rule rather than satisfying it'

# =============================================================================================
Write-Host 'rule document validation'
# =============================================================================================
Assert-Throws { Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules @{ } } 'a document without a rules array is rejected'
Assert-Throws { Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules @{ rules = @(@{ id = 'a'; kind = 'regex_matches'; severity = 'error'; title = 't' }) } } `
    'an unknown rule kind is rejected - there is no regex escape hatch'
Assert-Throws { Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules @{ rules = @(@{ id = 'a'; kind = 'file_exists'; severity = 'fatal'; title = 't'; paths = @('x') }) } } `
    'an unknown severity is rejected'
Assert-Throws { Invoke-AgentGovernancePolicy -Snapshot $snapshot -Rules @{ rules = @(
    @{ id = 'dup'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('x') }
    @{ id = 'dup'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('y') }
) } } 'duplicate rule ids are rejected'

# =============================================================================================
Write-Host 'ratchet'
# =============================================================================================
function New-RuleSet {
    param([object[]] $Rules, [object[]] $Retired = @())
    return @{ schema_version = 'agent-governance-rules/v1'; purpose = 'p'; rules = $Rules; retired = $Retired }
}
$ruleA = @{ id = 'a'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('x') }
$ruleB = @{ id = 'b'; kind = 'file_exists'; severity = 'error'; title = 't'; paths = @('y') }
$ruleAWarning = @{ id = 'a'; kind = 'file_exists'; severity = 'warning'; title = 't'; paths = @('x') }
$validRetirement = @{ rule_id = 'b'; owner = '@monkey1sai'; reason = 'superseded'; pr = 999; retired_on = '2026-08-17' }

Assert-True ((Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleA)) -HeadRules (New-RuleSet @($ruleA, $ruleB))).status -eq 'passed') `
    'adding a rule is free'
Assert-True ((Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleA)) -HeadRules (New-RuleSet @($ruleA))).status -eq 'passed') `
    'an unchanged document passes'

$removed = Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleA, $ruleB)) -HeadRules (New-RuleSet @($ruleA))
Test-FindingCodes -Verdict $removed -Expected @('ratchet.rule_removed') 'removing a rule without a retirement record fails closed'

$downgraded = Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleA)) -HeadRules (New-RuleSet @($ruleAWarning))
Test-FindingCodes -Verdict $downgraded -Expected @('ratchet.severity_downgraded') 'downgrading severity fails closed'

Assert-True ((Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleAWarning)) -HeadRules (New-RuleSet @($ruleA))).status -eq 'passed') `
    'tightening severity is free'

Assert-True ((Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleA, $ruleB)) -HeadRules (New-RuleSet @($ruleA) @($validRetirement))).status -eq 'passed') `
    'a complete retirement record authorises the removal'

foreach ($field in @('rule_id', 'owner', 'reason', 'pr', 'retired_on')) {
    $incomplete = $validRetirement.Clone()
    $incomplete[$field] = ''
    $verdict = Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleA, $ruleB)) -HeadRules (New-RuleSet @($ruleA) @($incomplete))
    Assert-True ($verdict.status -eq 'failed') "a retirement record missing '$field' is rejected"
}

$unknownRetirement = @{ rule_id = 'never-existed'; owner = '@x'; reason = 'r'; pr = 1; retired_on = '2026-08-17' }
$verdict = Test-AgentGovernancePolicyRatchet -BaseRules (New-RuleSet @($ruleA)) -HeadRules (New-RuleSet @($ruleA) @($unknownRetirement))
Test-FindingCodes -Verdict $verdict -Expected @('ratchet.retirement_unknown_rule') 'a retirement record cannot pre-authorise a future removal'

# The ratchet reads both documents through one port at two refs, which is the shape the
# self-referential bootstrap gate lacks - it shells out to git inside its own assertions.
$refSnapshot = New-AgentGovernanceFakeSnapshot -Files @{
    ':rules.json'      = (New-RuleSet @($ruleA, $ruleB) | ConvertTo-Json -Depth 8)
    'base:rules.json'  = (New-RuleSet @($ruleA, $ruleB) | ConvertTo-Json -Depth 8)
}
$headText = & $refSnapshot.ReadText 'rules.json' ''
$baseText = & $refSnapshot.ReadText 'rules.json' 'base'
Assert-True ($null -ne $headText -and $null -ne $baseText) 'the port reads the same path at two refs'
Assert-True ((Test-AgentGovernancePolicyRatchet -BaseRules ($baseText | ConvertFrom-Json -AsHashtable) -HeadRules ($headText | ConvertFrom-Json -AsHashtable)).status -eq 'passed') `
    'base and head are comparable entirely through the port'

# =============================================================================================
Write-Host 'PINNED vocabulary and load-bearing rules'
# =============================================================================================
$actualKinds = @(Get-AgentGovernanceRuleKinds) | Sort-Object
Assert-True ((($actualKinds) -join ',') -eq (($PINNED_RULE_KINDS | Sort-Object) -join ',')) `
    'the rule kind vocabulary matches PINNED_RULE_KINDS - adding a kind must be a visible edit here'
Assert-True ($actualKinds -notcontains 'regex_matches') 'no regex escape hatch has been reintroduced'

$rulesById = [ordered]@{}
foreach ($rule in $canonicalRules['rules']) { $rulesById[[string]$rule['id']] = $rule }

foreach ($id in $PINNED_LOAD_BEARING.Keys) {
    Assert-True ($rulesById.Contains($id)) "load-bearing rule '$id' is still present"
    if ($rulesById.Contains($id)) {
        $actual = Get-RuleFingerprint -Rule $rulesById[$id]
        Assert-True ($actual -eq $PINNED_LOAD_BEARING[$id]) `
            "load-bearing rule '$id' matches its pinned fingerprint (actual: $actual). Re-run with -DumpFingerprints if the change is deliberate."
    }
}

# =============================================================================================
Write-Host 'canonical repository'
# =============================================================================================
# The rule INSTANCES have no individual tests; this is what proves the whole set holds. Warnings
# count as failures here for the same reason the architecture ratchets assert warning_count == 0:
# a stale rule must force a cleanup rather than sit amber forever.
Assert-True ((Get-Content -LiteralPath $rulesPath -Raw -Encoding utf8) | Test-Json -SchemaFile (Join-Path $repoRoot 'scripts/tests/agent-governance-rules.schema.json') -ErrorAction SilentlyContinue) `
    'the canonical rule document satisfies its own Draft-07 schema'

$canonicalSnapshot = New-AgentGovernanceSnapshot -RepoRoot $repoRoot
$canonicalVerdict = Invoke-AgentGovernancePolicy -Snapshot $canonicalSnapshot -Rules $canonicalRules
foreach ($finding in $canonicalVerdict.findings) {
    Write-Host ("        {0} [{1}] {2}" -f $finding.rule_id, $finding.code, $finding.detail) -ForegroundColor Yellow
}
Assert-True ($canonicalVerdict.error_count -eq 0) 'the canonical rule set holds against this repository'
Assert-True ($canonicalVerdict.warning_count -eq 0) 'the canonical rule set produces no warnings'
Assert-True ($canonicalVerdict.evaluated_count -eq @($canonicalRules['rules']).Count) 'every canonical rule was evaluated'

# =============================================================================================
Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "[test-agent-governance-policy] $($script:Failures) of $($script:Assertions) assertions FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "[test-agent-governance-policy] all $($script:Assertions) assertions passed" -ForegroundColor Green
