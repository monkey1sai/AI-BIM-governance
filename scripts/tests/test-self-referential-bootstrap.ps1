[CmdletBinding()]
param()

# Adversarial coverage for the self-referential bootstrap gate. Every attack from
# the PR #459 review round has a test here: deleting debt, impersonating an
# earlier PR's entry, forging a fixpoint, padded reasons, garbage timestamps,
# unbound PR numbers, and unclassified enforcement-workflow edits. Gate tests use
# fixture ledgers ONLY - the real repo ledger gets a parse-integrity check and is
# never assumed empty (real debt entries must not break unrelated CI).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param([Parameter(Mandatory = $true)] $Condition, [Parameter(Mandatory = $true)][string] $Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $MessagePattern,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    try { & $Action } catch {
        $failed = $true
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "ASSERT FAILED: $Context threw, but message '$($_.Exception.Message)' does not match '$MessagePattern'."
        }
    }
    Assert-True $failed "$Context was expected to throw."
}

function New-FixtureLedgerRevision {
    # Writes a commit into the object store whose tree holds ONLY the ledger, and
    # returns its sha. No ref is created, so the object stays unreachable and is
    # collected like any other dangling object. This exists so wire-up tests can
    # exercise the real checker against a ledger they control: the gate reads both
    # ledgers with `git show <sha>:...`, so a fixture revision is the only way to
    # test it without depending on whatever debt the live repo carries.
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $TempRoot,
        [Parameter(Mandatory = $true)][string] $LedgerJson
    )

    $blob = (($LedgerJson | & git -C $RepoRoot hash-object -w --stdin 2>&1) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "fixture ledger: hash-object failed ($blob)." }

    $indexFile = Join-Path $TempRoot "fixture-index-$([Guid]::NewGuid().ToString('N'))"
    $hadIndex = Test-Path Env:\GIT_INDEX_FILE
    $previousIndex = if ($hadIndex) { $env:GIT_INDEX_FILE } else { $null }
    try {
        $env:GIT_INDEX_FILE = $indexFile
        # Start from the real HEAD tree, not an empty one: the checker reads other
        # paths out of the head revision too (the design-system manifest, for one),
        # so the fixture must be "the repo at HEAD with this ledger swapped in".
        $null = & git -C $RepoRoot read-tree HEAD 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'fixture ledger: read-tree HEAD failed.' }
        $null = & git -C $RepoRoot update-index --add --cacheinfo "100644,$blob,scripts/self-referential-bootstrap-ledger.json" 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'fixture ledger: update-index failed.' }
        $tree = ((& git -C $RepoRoot write-tree 2>&1) | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "fixture ledger: write-tree failed ($tree)." }
    } finally {
        if ($hadIndex) { $env:GIT_INDEX_FILE = $previousIndex }
        else { Remove-Item Env:\GIT_INDEX_FILE -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $indexFile -Force -ErrorAction SilentlyContinue
    }

    # Pinned ident and dates: commit-tree needs an author, and pinning both keeps the
    # fixture sha reproducible on a machine with no user.name configured.
    $stamp = '1700000000 +0000'
    $hadAuthorDate = Test-Path Env:\GIT_AUTHOR_DATE
    $hadCommitterDate = Test-Path Env:\GIT_COMMITTER_DATE
    $previousAuthorDate = if ($hadAuthorDate) { $env:GIT_AUTHOR_DATE } else { $null }
    $previousCommitterDate = if ($hadCommitterDate) { $env:GIT_COMMITTER_DATE } else { $null }
    try {
        $env:GIT_AUTHOR_DATE = $stamp
        $env:GIT_COMMITTER_DATE = $stamp
        $commit = ((& git -C $RepoRoot `
            -c 'user.name=fixture' -c 'user.email=fixture@invalid' `
            commit-tree $tree -m 'fixture: empty self-referential bootstrap ledger' 2>&1) | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "fixture ledger: commit-tree failed ($commit)." }
    } finally {
        if ($hadAuthorDate) { $env:GIT_AUTHOR_DATE = $previousAuthorDate }
        else { Remove-Item Env:\GIT_AUTHOR_DATE -ErrorAction SilentlyContinue }
        if ($hadCommitterDate) { $env:GIT_COMMITTER_DATE = $previousCommitterDate }
        else { Remove-Item Env:\GIT_COMMITTER_DATE -ErrorAction SilentlyContinue }
    }
    return $commit
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $repoRoot 'scripts/lib/self-referential-bootstrap.ps1')

$tempRoot = Join-Path $repoRoot "artifacts/tmp/self-referential-bootstrap-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

$goodReason = 'the deploy contract only verifies merged origin/main, so a PR changing the deploy path itself cannot obtain deploy-target evidence pre-merge'

function New-VerificationContract {
    param(
        [string] $Id = 'self-referential-bootstrap-gate/v1',
        [string[]] $CommandIds = @(
            'test-self-referential-bootstrap',
            'test-base-gate-capability',
            'test-preflight-prnumber-forwarding',
            'test-agent-governance-check',
            'test-pr-body-evidence',
            'test-pr-review-agent',
            'invoke-powershell-static',
            'detect-base-gate-capability-bash-syntax'
        )
    )
    $separator = [string][char]10
    $canonical = (@($Id) + @($CommandIds)) -join $separator
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = ([BitConverter]::ToString(
            $sha256.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($canonical))
        )).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
    return [ordered]@{
        id = $Id
        command_ids = @($CommandIds)
        contract_sha256 = $digest
    }
}

function New-Entry {
    param([hashtable] $Override = @{})
    $entry = [ordered]@{
        id = 'remote-linux-deploy-target'
        status = 'open'
        pr = 500
        opened_at = '2026-07-31T08:00:00Z'
        reason = $goodReason
        verification_mechanism_paths = @('scripts/deploy.ps1')
        verification_contract = New-VerificationContract
        bootstrap_evidence_refs = @('docs/evidence/remote-linux-deploy/self-referential-bootstrap/summary.md')
        fixpoint = $null
    }
    foreach ($key in $Override.Keys) { $entry[$key] = $Override[$key] }
    return $entry
}

function New-LedgerJson {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][array] $Entries)
    return ([ordered]@{
        schema_version = 'self-referential-bootstrap-ledger/v1'
        entries = $Entries
    } | ConvertTo-Json -Depth 8)
}

function New-FixpointAttestationJson {
    param(
        [Parameter(Mandatory = $true)] $Entry,
        [Parameter(Mandatory = $true)][string] $MechanismCommit,
        [hashtable] $Override = @{}
    )
    $attestation = [ordered]@{
        schema_version = 'self-referential-fixpoint-attestation/v1'
        entry_id = [string]$Entry.id
        mechanism_commit = $MechanismCommit
        verification_contract_sha256 = [string]$Entry.verification_contract.contract_sha256
        result = 'pass'
        commands = @($Entry.verification_contract.command_ids | ForEach-Object {
            [ordered]@{ id = [string]$_; exit_code = 0 }
        })
    }
    foreach ($key in $Override.Keys) { $attestation[$key] = $Override[$key] }
    return ($attestation | ConvertTo-Json -Depth 8)
}

function Write-LedgerFile {
    param([string] $Name, [string] $Json)
    $path = Join-Path $tempRoot $Name
    Set-Content -LiteralPath $path -Value $Json -Encoding utf8
    return $path
}

function Invoke-BodyGate {
    param(
        [hashtable] $Rows,
        [string[]] $ChangedPaths,
        [string] $HeadJson,
        [AllowEmptyString()][string] $BaseJson = '',
        [Nullable[bool]] $BaseLedgerExists = $null,
        [bool] $HasBase = $true,
        [int] $PrNumber = 500,
        [string] $GateRepoRoot = '',
        [string] $BaseSha = '',
        [string] $HeadSha = ''
    )
    $headPath = Write-LedgerFile "head-$([Guid]::NewGuid().ToString('N')).json" $HeadJson
    Assert-SelfReferentialBootstrapBody -Body 'body' -ChangedPaths $ChangedPaths -LedgerPath $headPath `
        -GetTableValue { param($b, $label) $Rows[$label] }.GetNewClosure() `
        -BaseLedgerJson $BaseJson -BaseLedgerExists $BaseLedgerExists `
        -HasBaseContext $HasBase -PrNumber $PrNumber `
        -RepoRoot $GateRepoRoot -BaseSha $BaseSha -HeadSha $HeadSha
}

try {
    $mechanism = @('scripts/deploy.ps1')
    $emptyJson = New-LedgerJson -Entries @()

    # --- git fixture repo: mechanism_commit must touch a declared path, and
    # fixpoint evidence must be introduced at/after that commit (review round 4) ------
    $gitRoot = Join-Path $tempRoot 'gitfx'
    New-Item -ItemType Directory -Path $gitRoot -Force | Out-Null
    function Invoke-FixtureGit {
        param([Parameter(Mandatory = $true)][string[]] $Arguments)
        $output = @(& git -C $gitRoot -c commit.gpgsign=false @Arguments 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "fixture git failed: git $($Arguments -join ' '): $($output -join [Environment]::NewLine)"
        }
        return $output
    }
    $null = Invoke-FixtureGit -Arguments @('init', '-q')
    # `git merge --no-commit` still prepares merge metadata and requires an
    # identity on a clean CI runner. Keep the fixture self-contained: configure
    # only this disposable repository, never the caller's global Git config.
    $null = Invoke-FixtureGit -Arguments @('config', 'user.email', 'fixture@invalid')
    $null = Invoke-FixtureGit -Arguments @('config', 'user.name', 'fixture')
    $mainBranch = ((Invoke-FixtureGit -Arguments @('branch', '--show-current')) | Out-String).Trim()
    $commit = {
        param($msg, [bool] $AllowEmpty = $false)
        $commitArguments = @(
            '-c', 'user.email=t@t', '-c', 'user.name=t',
            'commit', '--no-gpg-sign', '-q')
        if ($AllowEmpty) { $commitArguments += '--allow-empty' }
        $commitArguments += @('-m', $msg)
        $null = Invoke-FixtureGit -Arguments $commitArguments
        return ((Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD')) | Out-String).Trim()
    }
    $write = { param($rel, $val) $full = Join-Path $gitRoot $rel; New-Item -ItemType Directory -Path (Split-Path $full) -Force | Out-Null; Set-Content -LiteralPath $full -Value $val }

    # c0: pre-mechanism evidence blob (labeled, but predates the mechanism merge)
    & $write 'docs/evidence/old/self-referential-bootstrap/old.md' 'old evidence'
    $null = Invoke-FixtureGit -Arguments @('add', 'docs')
    $oldEvidenceCommit = & $commit 'pre-mechanism evidence'
    # c1: an ancestor that does NOT touch any declared mechanism path
    & $write 'README.md' 'unrelated'
    $null = Invoke-FixtureGit -Arguments @('add', 'README.md')
    $unrelatedAncestor = & $commit 'unrelated ancestor'

    # c2: make a real two-parent mechanism merge. The old `git show --name-only`
    # logic emitted no paths for this commit; first-parent diff must see deploy.ps1.
    $null = Invoke-FixtureGit -Arguments @('checkout', '-q', '-b', 'mechanism-pr')
    & $write 'scripts/deploy.ps1' '# mechanism'
    $null = Invoke-FixtureGit -Arguments @('add', 'scripts/deploy.ps1')
    $branchMechanismCommit = & $commit 'mechanism branch change (#500)'
    $null = Invoke-FixtureGit -Arguments @('checkout', '-q', $mainBranch)
    $null = Invoke-FixtureGit -Arguments @('merge', '--no-ff', '--no-commit', 'mechanism-pr')

    # Carry an evidence file in the merge commit itself so strict chronology has
    # an equality case to reject.
    & $write 'docs/evidence/remote-linux-deploy/fixpoint/born-with-mechanism.md' 'committed by the mechanism commit itself'
    $null = Invoke-FixtureGit -Arguments @('add', 'docs')
    $fixpointCommit = & $commit 'Merge pull request #500 from fixture/mechanism-pr'
    $mergeParents = @(((Invoke-FixtureGit -Arguments @('rev-list', '--parents', '-n', '1', $fixpointCommit)) | Out-String).Trim() -split '\s+')
    Assert-True ($mergeParents.Count -eq 3) 'mechanism fixture must be a real two-parent merge commit'

    # A path-touching ancestor from a different PR must not close this entry.
    & $write 'scripts/deploy.ps1' '# mechanism from another PR'
    $null = Invoke-FixtureGit -Arguments @('add', 'scripts/deploy.ps1')
    $wrongPrMechanismCommit = & $commit 'other mechanism update (#499)'

    # A foreign squash subject can mention this PR while ending in its own PR
    # number. Matching the marker anywhere would accept it.
    & $write 'scripts/deploy.ps1' '# spoofed cross-reference'
    $null = Invoke-FixtureGit -Arguments @('add', 'scripts/deploy.ps1')
    $spoofedPrMechanismCommit = & $commit 'cross-reference (#500) from another PR (#498)'

    # c3 (base): post-merge evidence introduced AFTER the mechanism commit
    & $write 'docs/evidence/remote-linux-deploy/self-referential-bootstrap/summary.md' 'evidence'
    & $write 'docs/evidence/remote-linux-deploy/fixpoint/summary.md' 'fixpoint evidence'
    Set-Content -LiteralPath (Join-Path $gitRoot 'untracked-evidence.md') -Value 'untracked'
    & $write 'scripts/self-referential-bootstrap-ledger.json' (New-LedgerJson -Entries @())
    $null = Invoke-FixtureGit -Arguments @('add', 'docs', 'scripts')
    $baseSha = & $commit 'base with post-merge evidence'

    # Independent squash-style fixture whose mechanism commit changes two
    # declared surfaces, followed by evidence from a later revision.
    & $write 'scripts/deploy.ps1' '# multi-path mechanism'
    & $write 'scripts/verify-all.ps1' '# multi-path mechanism'
    $null = Invoke-FixtureGit -Arguments @('add', 'scripts/deploy.ps1', 'scripts/verify-all.ps1')
    $twoPathFixpointCommit = & $commit 'multi-path mechanism (#500)'
    & $write 'docs/evidence/multi-path/fixpoint/summary.md' 'multi-path fixpoint evidence'
    $null = Invoke-FixtureGit -Arguments @('add', 'docs/evidence/multi-path/fixpoint/summary.md')
    $twoPathBaseSha = & $commit 'base with multi-path fixpoint evidence'

    # Commits a head ledger into the fixture and returns that SHA, so the body
    # gate can load the ledger from an exact revision instead of ambient HEAD.
    # This is the differential fixture the Codex review asked for (TG-3): the
    # ledger at $HeadSha and the ledger in the working tree can differ.
    function New-FixtureHeadCommit {
        param([Parameter(Mandatory = $true)][string] $Json, [string] $Message = 'head ledger')
        & $write 'scripts/self-referential-bootstrap-ledger.json' $Json
        $null = Invoke-FixtureGit -Arguments @('add', 'scripts')
        return (& $commit $Message $true)
    }

    # --- mechanism path detection (incl. enforcement workflows: review P2) ----------
    $expectedMechanismPaths = @(
        'scripts/deploy.ps1',
        'scripts/deploy-target-registry.json',
        'scripts/lib/deploy-target-registry.ps1',
        'scripts/lib/remote-deploy-transport.ps1',
        'scripts/lib/windows-verification-scope.ps1',
        '.github/workflows/pr-review-agent.yml',
        '.github/workflows/agent-governance.yml',
        '.github/workflows/ci.yml',
        '.github/workflows/trusted-elevated-merge.yml',
        '.gitattributes',
        'web-viewer-sample/.gitattributes',
        'scripts/dev/trusted-host-merge.mjs',
        'scripts/lib/trusted-host-merge-contract.mjs',
        'scripts/lib/trusted-host-merge-evidence.mjs',
        'scripts/lib/trusted-host-merge-executor.mjs',
        'scripts/lib/trusted-host-merge-runtime.mjs',
        'scripts/lib/trusted-host-merge.mjs',
        'scripts/tests/test-trusted-host-merge.mjs',
        'scripts/tests/test-trusted-host-merge-runtime.mjs',
        'scripts/tests/fixtures/trusted-host-merge-machine-fixtures.json',
        'agent-contracts/trusted-host-merge.contract.json',
        'agent-contracts/trusted-host-merge.contract.schema.json',
        'agent-contracts/trusted-host-merge-assertion.schema.json',
        'agent-contracts/trusted-host-merge-evidence.schema.json',
        'agent-contracts/trusted-host-merge-verdict.schema.json',
        'agent-contracts/trusted-host-merge-result.schema.json',
        'agent-contracts/spec-to-done.contract.json',
        'agent-contracts/spec-to-done.contract.schema.json',
        'scripts/verification-manifest.json',
        'scripts/tests/verify-functional-runtime-result.ps1',
        'scripts/tests/verify-security-exceptions.ps1',
        'scripts/dev/check-pr-local-preflight.ps1',
        'scripts/hooks/require-gstack-evidence.ps1',
        'scripts/lib/design-assets.ps1',
        # Codex round-6: three adjudicating surfaces the classifier used to miss.
        # A PR touching only one of these could change what "verified" means, or
        # declare every base gate-capable, without ever triggering this rule.
        'scripts/lib/detect-base-gate-capability.sh',
        'scripts/verify-all.sh',
        'scripts/lib/verification-plan.mjs',
        'scripts/lib/verification-runner.mjs',
        'scripts/lib/verification-command-policy.mjs',
        'scripts/lib/verification-outcome.mjs',
        'scripts/lib/security-exceptions-cli.mjs',
        'scripts/lib/security-exceptions.mjs',
        'scripts/security-exceptions.json',
        'scripts/lib/openspec-lifecycle.ps1',
        'scripts/lib/openspec-machine-truth.mjs',
        'scripts/agent-governance-rules.json',
        'scripts/tests/agent-governance-rules.schema.json',
        'scripts/lib/agent-governance-policy.psm1',
        'scripts/tests/verify-governance-policy.ps1',
        'scripts/tests/test-agent-governance-policy.ps1',
        'scripts/tests/verification-plan.schema.json',
        'scripts/tests/invoke-powershell-static.ps1',
        'scripts/tests/scan-secret-patterns.ps1',
        'scripts/tests/test-self-referential-bootstrap.ps1',
        'scripts/tests/test-base-gate-capability.ps1',
        'scripts/tests/test-preflight-prnumber-forwarding.ps1',
        'web-viewer-sample/scripts/verify-design-system-pixels.mjs',
        'web-viewer-sample/scripts/lib/png-preflight.mjs',
        'scripts/tests/test-png-preflight.mjs',
        'scripts/start-web-plane-docker.ps1',
        '.github/CODEOWNERS',
        'scripts/tests/test-agent-governance-check.ps1',
        'docs/agents/self-referential-bootstrap.md'
    )
    $matched = Get-SelfReferentialMechanismPaths -ChangedPaths @($expectedMechanismPaths + 'web-viewer-sample/src/Window.tsx')
    Assert-True ($matched.Count -eq $expectedMechanismPaths.Count) "every direct adjudicator and contract path must classify as mechanism (matched: $($matched -join ', '))"
    foreach ($expectedPath in $expectedMechanismPaths) {
        Assert-True ($matched -ccontains $expectedPath) "mechanism classifier includes $expectedPath"
    }
    $trustedMergeContract = Get-Content -LiteralPath (Join-Path $repoRoot 'agent-contracts/trusted-host-merge.contract.json') -Raw | ConvertFrom-Json -Depth 100
    $trustedMergePatterns = @($trustedMergeContract.executor.required_check_trust_boundary.mechanism_path_patterns)
    foreach ($expectedPath in $expectedMechanismPaths) {
        $coveredByTrustedMerge = @($trustedMergePatterns | Where-Object {
            [regex]::IsMatch($expectedPath, [string]$_, [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)
        }).Count -gt 0
        Assert-True $coveredByTrustedMerge "trusted merge mechanism policy is a superset of the self-referential classifier example: $expectedPath"
    }
    # These future paths do not exist on this prerequisite branch. Pre-register
    # them in the base-owned debt classifier so the later implementation PR can
    # bind every new adjudicating surface without asking its head classifier to
    # self-authorize an expanded path set.
    $futureAutonomousMechanismPaths = @(
        'agent-contracts/autonomous-delivery-adjudication-packet.schema.json',
        'agent-contracts/autonomous-delivery-attestation-envelope.schema.json',
        'agent-contracts/autonomous-delivery-classifier-input.schema.json',
        'agent-contracts/autonomous-delivery-terminal-record.schema.json',
        'agent-contracts/autonomous-delivery-transition.contract.json',
        'scripts/lib/autonomous-delivery-contract.mjs',
        'scripts/tests/test-autonomous-linux-delivery-contracts.mjs',
        'tests/test_autonomous_delivery_contract_schemas.py'
    )
    $futureAutonomousMatches = @(Get-SelfReferentialMechanismPaths -ChangedPaths $futureAutonomousMechanismPaths)
    Assert-True ($futureAutonomousMatches.Count -eq $futureAutonomousMechanismPaths.Count) `
        "every future autonomous-delivery authority path must classify exactly (matched: $($futureAutonomousMatches -join ', '))"
    foreach ($expectedPath in $futureAutonomousMechanismPaths) {
        Assert-True ($futureAutonomousMatches -ccontains $expectedPath) "future mechanism classifier includes $expectedPath"
    }
    $adjacentAutonomousPaths = @(
        'agent-contracts/autonomous-delivery-not-normative.txt',
        'scripts/lib/autonomous-delivery-ui.mjs',
        'scripts/tests/test-autonomous-linux-delivery-contracts-extra.mjs'
    )
    $adjacentAutonomousMatches = @(Get-SelfReferentialMechanismPaths -ChangedPaths $adjacentAutonomousPaths)
    Assert-True ($adjacentAutonomousMatches.Count -eq 0) `
        "adjacent autonomous-delivery names must not broaden mechanism scope (matched: $($adjacentAutonomousMatches -join ', '))"
    Assert-True ($matched -notcontains 'web-viewer-sample/src/Window.tsx') 'ordinary product code must NOT classify as mechanism'
    $wrongCaseMechanismPaths = @(Get-SelfReferentialMechanismPaths -ChangedPaths @(
        'Scripts/Deploy.ps1',
        '.github/workflows/CI.yml',
        'agent-contracts/Autonomous-delivery-terminal-record.schema.json',
        'scripts/Agent-governance-rules.json',
        'scripts/tests/Agent-governance-rules.schema.json'
    ))
    Assert-True ($wrongCaseMechanismPaths.Count -eq 0) `
        "wrong-case git paths must not classify as mechanisms (matched: $($wrongCaseMechanismPaths -join ', '))"
    $adjacentGovernancePolicyPaths = @(Get-SelfReferentialMechanismPaths -ChangedPaths @(
        'scripts/agent-governance-rules.json.bak',
        'scripts/archive/agent-governance-rules.json',
        'scripts/tests/agent-governance-rules.schema.json.bak',
        'scripts/tests/archive/agent-governance-rules.schema.json'
    ))
    Assert-True ($adjacentGovernancePolicyPaths.Count -eq 0) `
        "adjacent governance-policy paths must not classify as mechanisms (matched: $($adjacentGovernancePolicyPaths -join ', '))"
    $prTemplate = Get-Content -LiteralPath (Join-Path $repoRoot '.github/PULL_REQUEST_TEMPLATE.md') -Raw
    $prTemplateBooleanPattern = '(?m)^\| Self-referential bootstrap \| yes / no \|\r?$'
    Assert-True ($prTemplate -match $prTemplateBooleanPattern) `
        'PR template shows bare yes/no values accepted by the checker, not backticked literals'
    $prTemplateCrlf = $prTemplate -replace '\r?\n', "`r`n"
    Assert-True ($prTemplateCrlf -match $prTemplateBooleanPattern) `
        'PR template boolean assertion accepts the CRLF checkout used by Windows CI'

    # --- list-typed fields reject scalars (Codex round-6) ---------------------------
    # `@($value).Count` wraps a bare string into a one-element array, so a scalar
    # passed every emptiness check even though the schema says array.
    foreach ($field in @('verification_mechanism_paths', 'bootstrap_evidence_refs')) {
        $scalar = if ($field -eq 'verification_mechanism_paths') { 'scripts/deploy.ps1' }
                  else { 'docs/evidence/x/self-referential-bootstrap/e.md' }
        Assert-Throws -Context "scalar $field" -MessagePattern 'must be a JSON array of strings' -Action {
            Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ $field = $scalar })))
        }
    }
    Assert-Throws -Context 'scalar fixpoint.evidence_refs' -MessagePattern 'must be a JSON array of strings' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{
            status = 'closed'
            fixpoint = @{ reverified_at = '2026-08-02T00:00:00Z'; mechanism_commit = ('a' * 40); evidence_refs = 'docs/evidence/x/fixpoint/e.md' }
        })))
    }
    Assert-Throws -Context 'non-string list member' -MessagePattern 'only non-empty strings' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ verification_mechanism_paths = @('scripts/deploy.ps1', '') })))
    }

    # --- linked-successor relation shape and graph integrity -----------------------
    Assert-Throws -Context 'successor_of as non-string' -MessagePattern 'successor_of must be a JSON string' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ successor_of = 500 })))
    }
    Assert-Throws -Context 'successor_of with invalid entry id' -MessagePattern 'must name a kebab-case ledger entry id' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ successor_of = 'Wrong_Case' })))
    }
    Assert-Throws -Context 'self-referential successor' -MessagePattern 'cannot be its own successor' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ successor_of = 'remote-linux-deploy-target' })))
    }
    Assert-Throws -Context 'successor names missing predecessor' -MessagePattern 'names missing ledger entry' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{
            id = 'orphan-successor'
            successor_of = 'missing-predecessor'
        })))
    }
    $linkedParent = New-Entry
    $linkedChild = New-Entry -Override @{
        id = 'linked-successor'
        pr = 501
        successor_of = 'remote-linux-deploy-target'
        bootstrap_evidence_refs = @('docs/evidence/linked/self-referential-bootstrap/summary.md')
    }
    $null = Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @($linkedParent, $linkedChild))
    Assert-Throws -Context 'closed successor below an open predecessor' `
        -MessagePattern 'cannot be closed while predecessor.*remains open' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @(
            $linkedParent,
            (New-Entry -Override @{
                id = 'closed-linked-successor'
                status = 'closed'
                pr = 501
                successor_of = 'remote-linux-deploy-target'
                bootstrap_evidence_refs = @('docs/evidence/closed-linked/self-referential-bootstrap/summary.md')
                fixpoint = @{
                    reverified_at = '2026-08-02T00:00:00Z'
                    mechanism_commit = ('a' * 40)
                    evidence_refs = @('docs/evidence/closed-linked/fixpoint/summary.md')
                }
            })
        ))
    }
    Assert-Throws -Context 'predecessor with two successors' -MessagePattern 'more than one successor' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @(
            $linkedParent,
            $linkedChild,
            (New-Entry -Override @{
                id = 'second-linked-successor'
                pr = 502
                successor_of = 'remote-linux-deploy-target'
                bootstrap_evidence_refs = @('docs/evidence/linked-two/self-referential-bootstrap/summary.md')
            })
        ))
    }
    Assert-Throws -Context 'multi-entry successor cycle' -MessagePattern 'contains a cycle' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @(
            (New-Entry -Override @{
                id = 'cycle-entry-a'
                pr = 510
                successor_of = 'cycle-entry-b'
                bootstrap_evidence_refs = @('docs/evidence/cycle-a/self-referential-bootstrap/summary.md')
            }),
            (New-Entry -Override @{
                id = 'cycle-entry-b'
                pr = 511
                successor_of = 'cycle-entry-a'
                bootstrap_evidence_refs = @('docs/evidence/cycle-b/self-referential-bootstrap/summary.md')
            })
        ))
    }

    # --- the mechanism cannot be its own evidence (Codex round-6) -------------------
    # The stack-kind label is a substring test and the mechanism files are named
    # after the stack kind, so the ledger itself satisfied it.
    foreach ($selfRef in @('scripts/self-referential-bootstrap-ledger.json', 'scripts/lib/self-referential-bootstrap.ps1')) {
        Assert-Throws -Context "evidence ref '$selfRef'" -MessagePattern 'cannot be its own evidence' -Action {
            Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ bootstrap_evidence_refs = @($selfRef) })))
        }
    }
    # A genuine artefact ABOUT the mechanism still passes.
    $null = Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{
        bootstrap_evidence_refs = @('docs/evidence/slug/self-referential-bootstrap/README.md')
    })))

    # --- the closing side obeys the same self-evidence rule (Codex round-7) --------
    foreach ($selfRef in @('scripts/self-referential-bootstrap-ledger.json', 'scripts/lib/self-referential-bootstrap.ps1')) {
        Assert-Throws -Context "fixpoint evidence ref '$selfRef'" -MessagePattern 'cannot be its own re-verification result' -Action {
            Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{
                status = 'closed'
                fixpoint = @{ reverified_at = '2026-08-02T00:00:00Z'; mechanism_commit = ('a' * 40); evidence_refs = @($selfRef) }
            })))
        }
    }

    # --- real repo ledger: integrity + command resolvability, no emptiness assumption
    $realLedger = Get-SelfReferentialBootstrapLedger -Path (Join-Path $repoRoot 'scripts/self-referential-bootstrap-ledger.json')
    Assert-True ($null -ne $realLedger) 'repo ledger must parse and validate'
    $pwshPrefix = @('pwsh', '-NoProfile', '-NonInteractive', '-File')
    $commandSpecById = @{
        'canonical-linux-deployment-verify' = @{
            Path = 'scripts/verify-all.ps1'
            Invocation = @($pwshPrefix + @('scripts/verify-all.ps1', '-Profile', 'Deployment', '-InventoryPath', '<owner-private-inventory>'))
        }
        'canonical-linux-rebuild' = @{
            Path = 'scripts/dev/rebuild-test-deploy.ps1'
            Invocation = @($pwshPrefix + @('scripts/dev/rebuild-test-deploy.ps1', '-Build', '-InventoryPath', '<owner-private-inventory>'))
        }
        'detect-base-gate-capability-bash-syntax' = @{ Path = 'scripts/lib/detect-base-gate-capability.sh'; Invocation = @('bash', '-n', 'scripts/lib/detect-base-gate-capability.sh') }
        'harden-cad-extension-cache' = @{ Path = 'bim-streaming-server/scripts/harden-cad-extension-cache.py'; Invocation = @('python', 'bim-streaming-server/scripts/harden-cad-extension-cache.py', '--repo-root', 'bim-streaming-server') }
        'invoke-powershell-static' = @{ Path = 'scripts/tests/invoke-powershell-static.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/invoke-powershell-static.ps1') }
        'scan-secret-patterns' = @{ Path = 'scripts/tests/scan-secret-patterns.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/scan-secret-patterns.ps1') }
        'test-agent-governance-check' = @{ Path = 'scripts/tests/test-agent-governance-check.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-agent-governance-check.ps1') }
        'test-agent-governance-policy' = @{ Path = 'scripts/tests/test-agent-governance-policy.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-agent-governance-policy.ps1') }
        'verify-governance-policy' = @{ Path = 'scripts/tests/verify-governance-policy.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/verify-governance-policy.ps1') }
        'test-verification-plan' = @{ Path = 'scripts/tests/test-verification-plan.mjs'; Invocation = @('node', '--test', 'scripts/tests/test-verification-plan.mjs', 'scripts/tests/test-verification-command-policy.mjs', 'scripts/tests/test-verification-runner.mjs') }
        'test-base-gate-capability' = @{ Path = 'scripts/tests/test-base-gate-capability.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-base-gate-capability.ps1') }
        'test-deploy-governance-static' = @{ Path = 'scripts/tests/test-deploy-governance-static.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-deploy-governance-static.ps1') }
        'test-deploy-target-registry' = @{ Path = 'scripts/tests/test-deploy-target-registry.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-deploy-target-registry.ps1') }
        'test-host-native-child-launch' = @{ Path = 'scripts/tests/test-host-native-child-launch.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-host-native-child-launch.ps1') }
        'test-host-native-conversion-service' = @{ Path = 'bim-streaming-server/tests/test_host_native_conversion_service.py'; Invocation = @('python', '-m', 'pytest', 'bim-streaming-server/tests/test_host_native_conversion_service.py', '-q') }
        'test-host-native-launcher' = @{ Path = 'scripts/tests/test-host-native-launcher.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-host-native-launcher.ps1') }
        'test-kit-manager-api' = @{ Path = 'services/kit-manager-api/tests/test_kit_service_runtime_status.py'; Invocation = @('python', '-m', 'pytest', 'services/kit-manager-api/tests', '-q') }
        'test-kit-log-probe' = @{ Path = 'scripts/tests/test-kit-log-probe.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-kit-log-probe.ps1') }
        'test-measure-session-baseline' = @{ Path = 'scripts/tests/test-measure-session-baseline.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-measure-session-baseline.ps1') }
        'test-openspec-machine-truth' = @{ Path = 'scripts/tests/test-openspec-machine-truth.mjs'; Invocation = @('node', '--test', 'scripts/tests/test-openspec-machine-truth.mjs', 'scripts/tests/test-openspec-machine-truth-cli.mjs') }
        'test-openspec-repository-lifecycle' = @{ Path = 'scripts/tests/test-openspec-repository-lifecycle.mjs'; Invocation = @('node', '--test', 'scripts/tests/test-openspec-repository-lifecycle.mjs') }
        'test-openspec-ledger-reconciliation' = @{ Path = 'scripts/tests/test-openspec-ledger-reconciliation.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-openspec-ledger-reconciliation.ps1') }
        'verify-openspec-lifecycle' = @{ Path = 'scripts/tests/verify-openspec-lifecycle.ps1'; Invocation = @($pwshPrefix + @('scripts/tests/verify-openspec-lifecycle.ps1', '-BaseRef', '<origin-main-sha>')) }
        'test-platform-adapter' = @{ Path = 'scripts/tests/test-platform-adapter.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-platform-adapter.ps1') }
        'test-pr-body-evidence' = @{ Path = 'scripts/tests/test-pr-body-evidence.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-pr-body-evidence.ps1') }
        'test-pr-review-agent' = @{ Path = 'scripts/tests/test-pr-review-agent.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-pr-review-agent.ps1') }
        'test-preflight-host-native' = @{ Path = 'scripts/tests/test-preflight-host-native.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-preflight-host-native.ps1') }
        'test-preflight-ports' = @{ Path = 'scripts/tests/test-preflight-ports.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-preflight-ports.ps1') }
        'test-preflight-prnumber-forwarding' = @{ Path = 'scripts/tests/test-preflight-prnumber-forwarding.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-preflight-prnumber-forwarding.ps1') }
        'test-rebuild-test-deploy' = @{ Path = 'scripts/tests/test-rebuild-test-deploy.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-rebuild-test-deploy.ps1') }
        'test-remote-deploy-transport' = @{ Path = 'scripts/tests/test-remote-deploy-transport.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-remote-deploy-transport.ps1') }
        'test-self-referential-bootstrap' = @{ Path = 'scripts/tests/test-self-referential-bootstrap.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-self-referential-bootstrap.ps1') }
        'test-review-risk' = @{ Path = 'scripts/tests/test-review-risk.mjs'; Invocation = @('node', '--test', 'scripts/tests/test-review-risk.mjs') }
        'test-routing-consistency' = @{ Path = 'tests/test_routing_consistency.py'; Invocation = @('python', '-m', 'pytest', 'tests/test_routing_consistency.py', '-q', '-p', 'no:cacheprovider') }
        'test-ship-item-runtime' = @{ Path = 'tests/test_ship_item_runtime.mjs'; Invocation = @('node', '--test', 'tests/test_ship_item_runtime.mjs') }
        'test-trusted-host-merge' = @{ Path = 'scripts/tests/test-trusted-host-merge.mjs'; Invocation = @('node', '--test', 'scripts/tests/test-trusted-host-merge.mjs', 'scripts/tests/test-trusted-host-merge-runtime.mjs') }
        'test-verify-all' = @{ Path = 'scripts/tests/test-verify-all.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-verify-all.ps1') }
        'test-windows-verification-scope' = @{ Path = 'scripts/tests/test-windows-verification-scope.ps1'; Invocation = @($pwshPrefix + 'scripts/tests/test-windows-verification-scope.ps1') }
    }
    foreach ($entry in @($realLedger.entries)) {
        foreach ($commandId in @($entry.verification_contract.command_ids)) {
            Assert-True ($commandSpecById.ContainsKey([string]$commandId)) "ledger command id '$commandId' resolves through the immutable command map"
            $commandSpec = $commandSpecById[[string]$commandId]
            Assert-True (@($commandSpec.Invocation).Count -gt 0) "ledger command id '$commandId' preserves a non-empty invocation"
            $commandPath = Join-Path $repoRoot ([string]$commandSpec.Path)
            Assert-True (Test-Path -LiteralPath $commandPath -PathType Leaf) "ledger command id '$commandId' resolves to an existing executable source path"
        }
    }
    $linuxHardeningEntries = @($realLedger.entries | Where-Object { [string]$_.id -ceq 'linux-test-deploy-verifier-hardening' })
    Assert-True ($linuxHardeningEntries.Count -eq 1) 'repo ledger retains exactly one linux-test-deploy-verifier-hardening entry'
    $linuxHardeningCommandIds = @($linuxHardeningEntries[0].verification_contract.command_ids | ForEach-Object { [string]$_ })
    foreach ($requiredCanonicalCommandId in @('canonical-linux-rebuild', 'canonical-linux-deployment-verify')) {
        Assert-True ($linuxHardeningCommandIds -ccontains $requiredCanonicalCommandId) "linux-test-deploy-verifier-hardening retains required command id '$requiredCanonicalCommandId'"
    }
    $expectedCanonicalRebuild = @($pwshPrefix + @('scripts/dev/rebuild-test-deploy.ps1', '-Build', '-InventoryPath', '<owner-private-inventory>'))
    $expectedCanonicalVerify = @($pwshPrefix + @('scripts/verify-all.ps1', '-Profile', 'Deployment', '-InventoryPath', '<owner-private-inventory>'))
    Assert-True ((@($commandSpecById['canonical-linux-rebuild'].Invocation) -join "`n") -ceq ($expectedCanonicalRebuild -join "`n")) 'canonical rebuild invocation preserves -Build, target, and owner-private inventory metadata'
    Assert-True ((@($commandSpecById['canonical-linux-deployment-verify'].Invocation) -join "`n") -ceq ($expectedCanonicalVerify -join "`n")) 'canonical deployment verification preserves the executable Deployment profile and owner-private inventory metadata'
    Assert-True (-not (@($commandSpecById['canonical-linux-deployment-verify'].Invocation) -ccontains '-TargetId')) 'executing Deployment verification must resolve the Linux target from the platform instead of using the PlanOnly-only TargetId parameter'
    Assert-True (-not (@($commandSpecById['canonical-linux-rebuild'].Invocation) -ccontains '-TargetId')) 'the canonical rebuild regular form takes no explicit selector: the wrapper defaults to the registry canonical target, and -TargetId exists for on-demand targets only'

    # --- timestamp: real parse, not prefix match (review P2) ------------------------
    Assert-True (Test-SelfReferentialIsoTimestamp -Value '2026-07-31T08:00:00Z') 'valid ISO timestamp accepted'
    Assert-True (-not (Test-SelfReferentialIsoTimestamp -Value '2026-99-99T99:99:99garbage')) 'garbage with a plausible prefix must be rejected'
    Assert-True (-not (Test-SelfReferentialIsoTimestamp -Value '2026-13-01T00:00:00Z')) 'impossible month must be rejected'

    # --- reason: padded generic flooding (review P2) --------------------------------
    Assert-Throws -Context 'padded generic reason' -MessagePattern 'reason' -Action {
        Assert-SelfReferentialBootstrapReason -Reason 'bootstrap bootstrap bootstrap bootstrap bootstrap bootstrap' -Context 'test'
    }
    Assert-Throws -Context 'generic-vocabulary-dominated reason' -MessagePattern 'generic vocabulary' -Action {
        Assert-SelfReferentialBootstrapReason -Reason 'bootstrap needed required because chicken egg self-referential' -Context 'test'
    }
    Assert-Throws -Context 'punctuated generic reason' -MessagePattern 'reason' -Action {
        Assert-SelfReferentialBootstrapReason -Reason 'bootstrap, needed, required, because, chicken, egg.' -Context 'test'
    }
    Assert-SelfReferentialBootstrapReason -Reason $goodReason -Context 'test'
    # CJK prose is first-class in this repository (review round 3)
    Assert-SelfReferentialBootstrapReason -Reason '部署契約只驗證已合併的 origin/main，因此修改部署路徑本身的 PR 無法在合併前取得部署區證據' -Context 'test'
    Assert-Throws -Context 'short CJK reason' -MessagePattern 'reason' -Action {
        Assert-SelfReferentialBootstrapReason -Reason '需要引導程序' -Context 'test'
    }
    # padded CJK (>=12 ideographs but few distinct) must still fail (round 4)
    Assert-Throws -Context 'padded CJK reason' -MessagePattern 'distinct characters' -Action {
        Assert-SelfReferentialBootstrapReason -Reason ('引導' * 15) -Context 'test'
    }

    # --- ledger integrity (structure-level, unchanged rules) ------------------------
    $null = Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry)))
    Assert-Throws -Context 'top-level ledger array' -MessagePattern 'top-level JSON object' -Action {
        Get-SelfReferentialBootstrapLedger -Json "[$(New-LedgerJson -Entries @((New-Entry)))]"
    }
    Assert-Throws -Context 'duplicate top-level entries property' -MessagePattern 'duplicate JSON property' -Action {
        Get-SelfReferentialBootstrapLedger -Json '{"schema_version":"self-referential-bootstrap-ledger/v1","entries":[],"entries":[]}'
    }
    Assert-Throws -Context 'numeric ledger entry id' -MessagePattern 'id must be a JSON string' -Action {
        Get-SelfReferentialBootstrapLedger -Json ((New-LedgerJson -Entries @((New-Entry))) -replace '"id": "remote-linux-deploy-target"', '"id": 123')
    }
    Assert-Throws -Context 'mixed-case ledger entry id' -MessagePattern 'kebab-case' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ id = 'Remote-linux-deploy-target' })))
    }
    Assert-Throws -Context 'mixed-case ledger entry status' -MessagePattern 'status must be exactly' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ status = 'OPEN' })))
    }
    $missingFixpointEntry = New-Entry
    $missingFixpointEntry.Remove('fixpoint')
    Assert-Throws -Context 'open entry missing fixpoint property' -MessagePattern 'missing required JSON property.*fixpoint' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @($missingFixpointEntry))
    }
    $missingContractEntry = New-Entry
    $missingContractEntry.Remove('verification_contract')
    Assert-Throws -Context 'entry missing verification contract' -MessagePattern 'missing required JSON property.*verification_contract' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @($missingContractEntry))
    }
    $wrongContractDigestEntry = New-Entry
    $wrongContractDigestEntry.verification_contract.contract_sha256 = ('0' * 64)
    Assert-Throws -Context 'verification contract digest mismatch' -MessagePattern 'contract_sha256 does not match' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @($wrongContractDigestEntry))
    }
    $duplicateContractCommandEntry = New-Entry
    $duplicateContractCommandEntry.verification_contract.command_ids = @(
        'test-self-referential-bootstrap',
        'test-self-referential-bootstrap'
    )
    Assert-Throws -Context 'verification contract duplicate command id' -MessagePattern 'duplicate command id' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @($duplicateContractCommandEntry))
    }
    Assert-Throws -Context 'garbage opened_at in ledger' -MessagePattern 'ISO-8601' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ opened_at = '2026-99-99T99:99:99garbage' })))
    }
    $null = Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{
        opened_at = '9999-12-31T23:59:59.998Z'
    })))
    Assert-Throws -Context 'opened_at with no valid successor' -MessagePattern 'no valid later fixpoint' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{
            opened_at = '9999-12-31T23:59:59.999Z'
        })))
    }
    Assert-Throws -Context 'open entry with fixpoint' -MessagePattern 'must not carry a fixpoint' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = ('a' * 40); evidence_refs = @('x') } })))
    }
    Assert-Throws -Context 'closed entry without fixpoint' -MessagePattern 'complete fixpoint' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ status = 'closed' })))
    }
    Assert-Throws -Context 'entries as null' -MessagePattern 'must be an array' -Action {
        Get-SelfReferentialBootstrapLedger -Json '{"schema_version":"self-referential-bootstrap-ledger/v1","entries":null}'
    }
    Assert-Throws -Context 'entries as object' -MessagePattern 'must be an array' -Action {
        Get-SelfReferentialBootstrapLedger -Json '{"schema_version":"self-referential-bootstrap-ledger/v1","entries":{"id":"x"}}'
    }
    Assert-Throws -Context 'fixpoint predating its debt' -MessagePattern 'cannot predate' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{
            status = 'closed'
            fixpoint = @{ reverified_at = '2026-07-30T08:00:00Z'; mechanism_commit = ('a' * 40); evidence_refs = @('docs/evidence/x/self-referential-bootstrap/f.md') }
        })))
    }
    # ConvertFrom-Json materializes lenient ISO strings as [datetime]; the raw
    # JSON tokens must still satisfy the anchored formats (review round 3)
    Assert-Throws -Context 'timezone-less timestamp in raw JSON' -MessagePattern 'raw-string validation' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ opened_at = '2026-07-31T08:00:00' })))
    }
    # a differently-cased timestamp key must not bypass raw validation (round 4)
    Assert-Throws -Context 'mixed-case timestamp key with bad value' -MessagePattern 'raw-string validation' -Action {
        Get-SelfReferentialBootstrapLedger -Json ((New-LedgerJson -Entries @((New-Entry))) -replace '"opened_at": "[^"]*"', '"Opened_at": "2026-07-31T08:00:00"')
    }
    Assert-Throws -Context 'escaped timestamp key with bad value' -MessagePattern 'raw-string validation' -Action {
        Get-SelfReferentialBootstrapLedger -Json ((New-LedgerJson -Entries @((New-Entry))) `
            -replace '"opened_at": "[^"]*"', '"opene\u0064_at": "2026-07-31T08:00:00"')
    }
    Assert-Throws -Context 'explicit empty ledger JSON' -MessagePattern 'ledger is empty' -Action {
        Get-SelfReferentialBootstrapLedger -Json ''
    }
    Assert-Throws -Context 'pr as a JSON string' -MessagePattern 'native integer' -Action {
        Get-SelfReferentialBootstrapLedger -Json ((New-LedgerJson -Entries @((New-Entry))) -replace '"pr": 500', '"pr": "500"')
    }
    Assert-Throws -Context 'pr as a fraction' -MessagePattern 'native integer' -Action {
        Get-SelfReferentialBootstrapLedger -Json ((New-LedgerJson -Entries @((New-Entry))) -replace '"pr": 500', '"pr": 500.4')
    }
    # evidence blobs resolve against the passed head SHA, not ambient HEAD
    Assert-Throws -Context 'evidence blob absent at the given head revision' -MessagePattern 'not a committed file' -Action {
        Assert-SelfReferentialEvidenceBlob -RepoRoot $gitRoot -Ref 'docs/evidence/remote-linux-deploy/fixpoint/summary.md' -Context 'test' -HeadSha $fixpointCommit
    }
    Assert-SelfReferentialEvidenceBlob -RepoRoot $gitRoot -Ref 'docs/evidence/remote-linux-deploy/fixpoint/summary.md' -Context 'test' -HeadSha $baseSha

    # Git symlinks are blobs (mode 120000). A dangling symlink must not count as
    # re-verification evidence even though cat-file -t would report "blob".
    $symlinkRepo = Join-Path $tempRoot 'symlink-evidence-repo'
    New-Item -ItemType Directory -Path $symlinkRepo -Force | Out-Null
    Push-Location -LiteralPath $symlinkRepo
    try {
        $null = & git -c init.defaultBranch=main init -q
        $null = & git -c user.email=t@t -c user.name=t config user.email t@t
        $null = & git -c user.email=t@t -c user.name=t config user.name t
        # Create a symlink via git update-index so the fixture works on Windows
        # without requiring elevated symlink privileges.
        $emptyBlob = (('target' | & git hash-object -w --stdin) | Out-String).Trim()
        $null = & git update-index --add --cacheinfo "120000,$emptyBlob,docs/evidence/x/self-referential-bootstrap/link.md"
        $null = & git -c user.email=t@t -c user.name=t commit --no-gpg-sign -q -m 'symlink evidence'
        $symlinkHead = ((& git rev-parse HEAD) | Out-String).Trim()
        Assert-Throws -Context 'symlink evidence blob' -MessagePattern 'regular committed file|mode=120000' -Action {
            Assert-SelfReferentialEvidenceBlob -RepoRoot $symlinkRepo `
                -Ref 'docs/evidence/x/self-referential-bootstrap/link.md' `
                -Context 'test' -HeadSha $symlinkHead
        }
    } finally {
        Pop-Location
    }

    # --- transition: deletion of open debt (review P1 #1) ---------------------------
    $openBase = New-LedgerJson -Entries @((New-Entry))
    Assert-Throws -Context 'deleting an open entry' -MessagePattern 'append-only' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $emptyJson -BaseJson $openBase
    }

    # --- transition: impersonating an earlier PR's open entry (review P1 #2) --------
    Assert-Throws -Context 'declaring a pre-existing open entry' -MessagePattern 'does not ADD it' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $openBase
    }

    # --- transition: mutating entries is refused ------------------------------------
    $mutatedHead = New-LedgerJson -Entries @((New-Entry -Override @{ pr = 777 }))
    Assert-Throws -Context 'mutating an open entry' -MessagePattern 'was modified' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $mutatedHead -BaseJson $openBase
    }

    # Entry immutability must be CASE-SENSITIVE. PowerShell's -ne is not: measured
    # on 7.5.4, 'abc' -ne 'ABC' is False while 'abc' -cne 'ABC' is True. So a
    # case-only edit to any entry field read as "unchanged" and walked straight
    # past the immutability rule - and for declared git paths, which ARE
    # case-sensitive, that silently rebinds the debt to a path that does not exist.
    Assert-Throws -Context 'open entry reason changed only in case' -MessagePattern 'was modified' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson (New-LedgerJson -Entries @((New-Entry -Override @{ reason = $goodReason.ToUpperInvariant() }))) `
            -BaseJson $openBase
    }
    Assert-Throws -Context 'open entry mechanism path changed only in case' -MessagePattern 'was modified' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson (New-LedgerJson -Entries @((New-Entry -Override @{ verification_mechanism_paths = @('Scripts/Deploy.ps1') }))) `
            -BaseJson $openBase
    }
    $caseClosedFixpoint = @{
        reverified_at = '2026-08-01T08:00:00Z'
        mechanism_commit = ('a' * 40)
        evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md')
    }
    $caseClosedBase = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'; fixpoint = $caseClosedFixpoint
    }))
    $caseClosedHead = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'; fixpoint = $caseClosedFixpoint; reason = $goodReason.ToUpperInvariant()
    }))
    Assert-Throws -Context 'closed entry reason changed only in case' -MessagePattern 'closed entries are immutable' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson $caseClosedHead -BaseJson $caseClosedBase
    }
    # ...and the same on the open -> closed comparison, which excludes status and
    # fixpoint but must still hold every other field byte-for-byte.
    Assert-Throws -Context 'closure changes another field only in case' `
        -MessagePattern 'fields other than status/fixpoint changed during closure' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson $caseClosedHead -BaseJson $openBase
    }

    # --- transition: forged fixpoint (review P1 #3) ---------------------------------
    $forgedClosed = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = ('a' * 40); evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }))
    Assert-Throws -Context 'fixpoint with a nonexistent commit' -MessagePattern 'does not exist in this repository' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $forgedClosed -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $baseSha
    }
    $nonAncestorClosed = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $baseSha; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }))
    Assert-Throws -Context 'fixpoint commit not an ancestor of base' -MessagePattern 'ancestor' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $nonAncestorClosed -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $fixpointCommit
    }
    Assert-Throws -Context 'closure without base context' -MessagePattern 'refusing format-only closure' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $forgedClosed -BaseJson $openBase -GateRepoRoot '' -BaseSha ''
    }
    $missingEvidenceClosed = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/nope/missing.md') }
    }))
    Assert-Throws -Context 'fixpoint evidence ref missing from head tree' -MessagePattern 'not a committed file' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $missingEvidenceClosed -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $baseSha
    }
    # filesystem presence without a commit is NOT evidence (review round 2, P1)
    $untrackedEvidenceClosed = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('untracked-evidence.md') }
    }))
    Assert-Throws -Context 'fixpoint evidence ref present on disk but untracked' -MessagePattern 'not a committed file' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $untrackedEvidenceClosed -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $baseSha
    }
    $dotEvidenceClosed = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('.') }
    }))
    Assert-Throws -Context 'fixpoint evidence ref pointing at a directory' -MessagePattern 'not a committed file' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $dotEvidenceClosed -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $baseSha
    }
    # Closure tests run against the git fixture with the ledger committed at an
    # exact head revision (differential fixture, Codex TG-3).
    function Invoke-Closure {
        param(
            [hashtable] $Fixpoint,
            [hashtable] $EntryOverride = @{},
            [string[]] $ChangedPaths = @('scripts/self-referential-bootstrap-ledger.json'),
            [string] $BaseLedgerJson = $openBase,
            [string] $ClosureBaseSha = $baseSha,
            [AllowEmptyString()][string] $RefreshEvidenceRef = '',
            [AllowEmptyString()][string] $ModeOnlyEvidenceRef = '',
            [hashtable] $AttestationOverride = @{},
            [switch] $OmitAttestation
        )
        $override = @{ status = 'closed'; fixpoint = $Fixpoint } + $EntryOverride
        $closedEntry = New-Entry -Override $override
        $effectiveChangedPaths = @($ChangedPaths)
        if (-not [string]::IsNullOrWhiteSpace($RefreshEvidenceRef)) {
            & $write $RefreshEvidenceRef "closure re-verification $([Guid]::NewGuid().ToString('N'))"
            $evidenceFiles = @($RefreshEvidenceRef)
            if (-not $OmitAttestation) {
                $attestationRootMatch = [regex]::Match(
                    $RefreshEvidenceRef, '^(docs/evidence/[^/]+)/fixpoint/')
                if (-not $attestationRootMatch.Success) {
                    throw "test fixture refresh evidence must use docs/evidence/<slug>/fixpoint/: $RefreshEvidenceRef"
                }
                $attestationRef = $attestationRootMatch.Groups[1].Value + '/fixpoint/attestation.json'
                if (-not (@($closedEntry.fixpoint.evidence_refs) -ccontains $attestationRef)) {
                    $closedEntry.fixpoint.evidence_refs = @($closedEntry.fixpoint.evidence_refs) + $attestationRef
                }
                & $write $attestationRef (New-FixpointAttestationJson -Entry $closedEntry -MechanismCommit ([string]$closedEntry.fixpoint.mechanism_commit) -Override $AttestationOverride)
                $evidenceFiles += $attestationRef
            }
            $null = Invoke-FixtureGit -Arguments (@('add', '--') + $evidenceFiles)
            $effectiveChangedPaths += $evidenceFiles
        }
        if (-not [string]::IsNullOrWhiteSpace($ModeOnlyEvidenceRef)) {
            $null = Invoke-FixtureGit -Arguments @('update-index', '--chmod=+x', '--', $ModeOnlyEvidenceRef)
            $effectiveChangedPaths += $ModeOnlyEvidenceRef
        }
        $json = New-LedgerJson -Entries @($closedEntry)
        $headSha = New-FixtureHeadCommit -Json $json
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $effectiveChangedPaths `
            -HeadJson $json -BaseJson $BaseLedgerJson -GateRepoRoot $gitRoot -BaseSha $ClosureBaseSha -HeadSha $headSha
    }

    # mechanism_commit is an ancestor but did not touch a declared path (round 4)
    Assert-Throws -Context 'mechanism_commit did not touch a declared path' -MessagePattern 'did not modify every declared verification_mechanism_path' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $unrelatedAncestor; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }
    Assert-Throws -Context 'side-branch mechanism commit is not the mainline merge' -MessagePattern 'first-parent history' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $branchMechanismCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }
    Assert-Throws -Context 'mechanism_commit belongs to another PR' -MessagePattern 'originating PR #500' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $wrongPrMechanismCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }
    Assert-Throws -Context 'foreign squash subject only cross-references this PR' -MessagePattern 'originating PR #500' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $spoofedPrMechanismCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }
    # Pre-existing evidence cannot be reused by a ledger-only closure, whether it
    # predates the mechanism or was committed by the mechanism itself.
    Assert-Throws -Context 'unchanged pre-mechanism evidence reused by closure' -MessagePattern 'added or modified by this closure PR' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/old/self-referential-bootstrap/old.md') }
    }
    Assert-Throws -Context 'unchanged mechanism-commit evidence reused by closure' -MessagePattern 'added or modified by this closure PR' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/born-with-mechanism.md') }
    }
    Assert-Throws -Context 'closure reuses post-mechanism evidence already present at base' `
        -MessagePattern 'added or modified by this closure PR' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }
    Assert-Throws -Context 'closure claims unchanged base evidence as changed' `
        -MessagePattern 'unchanged between BaseSha and HeadSha' -Action {
        Invoke-Closure `
            -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') } `
            -ChangedPaths @(
                'scripts/self-referential-bootstrap-ledger.json',
                'docs/evidence/remote-linux-deploy/fixpoint/summary.md'
            )
    }
    Assert-Throws -Context 'closure claims a mode-only evidence change as fresh content' `
        -MessagePattern 'unchanged between BaseSha and HeadSha' -Action {
        Invoke-Closure `
            -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') } `
            -ModeOnlyEvidenceRef 'docs/evidence/remote-linux-deploy/fixpoint/summary.md'
    }
    Assert-Throws -Context 'fresh arbitrary text without fixpoint attestation' -MessagePattern 'fixpoint.*attestation' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') } -RefreshEvidenceRef 'docs/evidence/remote-linux-deploy/fixpoint/summary.md' -OmitAttestation
    }
    $badCommands = @((New-Entry).verification_contract.command_ids | ForEach-Object {
        [ordered]@{ id = [string]$_; exit_code = 0 }
    })
    $badCommands[0].exit_code = 1
    $attestationMutations = @(
        @{ Name = 'wrong entry id'; Override = @{ entry_id = 'another-ledger-entry' } },
        @{ Name = 'wrong mechanism commit'; Override = @{ mechanism_commit = ('b' * 40) } },
        @{ Name = 'wrong verification contract digest'; Override = @{ verification_contract_sha256 = ('0' * 64) } },
        @{ Name = 'failed aggregate result'; Override = @{ result = 'fail' } },
        @{ Name = 'nonzero command exit'; Override = @{ commands = $badCommands } }
    )
    foreach ($mutation in $attestationMutations) {
        Assert-Throws -Context "fixpoint attestation rejects $($mutation.Name)" -MessagePattern 'fixpoint attestation' -Action {
            Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') } -RefreshEvidenceRef 'docs/evidence/remote-linux-deploy/fixpoint/summary.md' -AttestationOverride $mutation.Override
        }
    }

    # Legal closure passes only when this PR refreshes the referenced evidence
    # and supplies an exact entry/commit/contract-bound passing attestation.
    Invoke-Closure `
        -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') } `
        -RefreshEvidenceRef 'docs/evidence/remote-linux-deploy/fixpoint/summary.md'

    # A closure cannot use bootstrap=yes to close the old debt and appoint a
    # fresh open entry in the same transition.
    $nextEvidenceRef = 'docs/evidence/next-gate/self-referential-bootstrap/summary.md'
    $nextEntry = New-Entry -Override @{
        id = 'next-gate-debt'
        opened_at = '2026-08-02T08:00:00Z'
        verification_mechanism_paths = @('scripts/self-referential-bootstrap-ledger.json')
        bootstrap_evidence_refs = @($nextEvidenceRef)
    }
    $closedAndNewJson = New-LedgerJson -Entries @(
        (New-Entry -Override @{
            status = 'closed'
            fixpoint = @{
                reverified_at = '2026-08-01T08:00:00Z'
                mechanism_commit = $fixpointCommit
                evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md')
            }
        }),
        $nextEntry
    )
    & $write 'docs/evidence/remote-linux-deploy/fixpoint/summary.md' "closure re-verification $([Guid]::NewGuid().ToString('N'))"
    & $write $nextEvidenceRef 'next mechanism bootstrap evidence'
    $null = Invoke-FixtureGit -Arguments @('add', '--',
        'docs/evidence/remote-linux-deploy/fixpoint/summary.md', $nextEvidenceRef)
    $closedAndNewHead = New-FixtureHeadCommit -Json $closedAndNewJson 'closure cannot open successor debt'
    Assert-Throws -Context 'closure PR also opens new debt' -MessagePattern 'cannot also open new debt' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'next-gate-debt'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths @(
            'scripts/self-referential-bootstrap-ledger.json',
            'docs/evidence/remote-linux-deploy/fixpoint/summary.md',
            $nextEvidenceRef
        ) -HeadJson $closedAndNewJson -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $baseSha -HeadSha $closedAndNewHead
    }

    # A multi-surface mechanism cannot close when its merge touched only one of
    # the declared paths (Codex L1-COR-003). The singleton positive above remains
    # the control proving ordinary one-path closures still pass.
    $twoPathOpenBase = New-LedgerJson -Entries @((New-Entry -Override @{
        verification_mechanism_paths = @('scripts/deploy.ps1', 'scripts/verify-all.ps1')
    }))
    Assert-Throws -Context 'multi-path closure whose commit touched only one declared path' `
        -MessagePattern 'did not modify every declared verification_mechanism_path' -Action {
        Invoke-Closure `
            -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') } `
            -EntryOverride @{ verification_mechanism_paths = @('scripts/deploy.ps1', 'scripts/verify-all.ps1') } `
            -BaseLedgerJson $twoPathOpenBase
    }
    Invoke-Closure `
        -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $twoPathFixpointCommit; evidence_refs = @('docs/evidence/multi-path/fixpoint/summary.md') } `
        -EntryOverride @{ verification_mechanism_paths = @('scripts/deploy.ps1', 'scripts/verify-all.ps1') } `
        -BaseLedgerJson $twoPathOpenBase `
        -ClosureBaseSha $twoPathBaseSha `
        -RefreshEvidenceRef 'docs/evidence/multi-path/fixpoint/summary.md'
    Assert-Throws -Context 'closure PR also edits another mechanism path' -MessagePattern 'may only change the ledger' -Action {
        Invoke-Closure -Fixpoint @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') } `
            -ChangedPaths @('scripts/self-referential-bootstrap-ledger.json', 'scripts/deploy.ps1') `
            -RefreshEvidenceRef 'docs/evidence/remote-linux-deploy/fixpoint/summary.md'
    }

    # closure without HeadSha must refuse rather than resolve chronology from
    # ambient HEAD, which in a pull_request checkout is the synthetic merge ref
    # (Codex L1-correctness-4)
    $legalClosedJson = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }))
    Assert-Throws -Context 'closure without HeadSha' -MessagePattern 'requires HeadSha' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson $legalClosedJson -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $baseSha
    }

    # the gate must follow the ledger at the SUPPLIED head revision, not the one
    # sitting in the working tree / ambient checkout (Codex TG-3)
    $cleanHeadSha = New-FixtureHeadCommit -Json $emptyJson 'head ledger: empty'
    & $write 'scripts/self-referential-bootstrap-ledger.json' $openBase   # dirty worktree disagrees
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
        -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot -BaseSha $baseSha -HeadSha $cleanHeadSha
    $null = Invoke-FixtureGit -Arguments @('checkout', '--', 'scripts')

    # --- base context is mandatory when the ledger is in play (review P1 #4) --------
    Assert-Throws -Context 'head-only evaluation with ledger entries' -MessagePattern 'base context' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $openBase -HasBase $false
    }
    # mechanism PR with an empty untouched ledger still passes without base context
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $emptyJson -HasBase $false

    Assert-Throws -Context 'existing but empty base ledger' -MessagePattern 'ledger is empty' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson $emptyJson -BaseJson '' -BaseLedgerExists $true
    }
    Assert-Throws -Context 'existing but corrupt base ledger' -MessagePattern 'not valid JSON' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson $emptyJson -BaseJson '{' -BaseLedgerExists $true
    }

    # --- pr binding for new entries (review P2) -------------------------------------
    Assert-Throws -Context 'new entry bound to a different PR number' -MessagePattern 'must bind to their originating PR' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $emptyJson -PrNumber 501
    }

    # --- declared paths must be CLASSIFIED mechanism paths and cover them all -------
    # (Codex L1-correctness-3: change a real mechanism file plus an unrelated file,
    # declare only the unrelated one, then close against the unrelated path.)
    $unrelatedDecl = New-LedgerJson -Entries @((New-Entry -Override @{
        verification_mechanism_paths = @('docs/notes.md')
    }))
    Assert-Throws -Context 'declaring a non-mechanism path' -MessagePattern 'not classified verification-mechanism paths' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths @('scripts/deploy.ps1', 'docs/notes.md') -HeadJson $unrelatedDecl -BaseJson $emptyJson -GateRepoRoot $gitRoot
    }
    Assert-Throws -Context 'declaring only some of the changed mechanism paths' -MessagePattern 'does not cover every mechanism path' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths @('scripts/deploy.ps1', 'scripts/verify-all.ps1') -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot
    }

    # Path comparison must be CASE-SENSITIVE. PowerShell's -in/-notin are not, and
    # git paths are, so 'Scripts/Deploy.ps1' used to satisfy a declaration for the
    # real 'scripts/deploy.ps1' - binding the debt to a path that does not exist
    # (Codex round-7: "Compare declared mechanism paths case-sensitively").
    $wrongCaseDecl = New-LedgerJson -Entries @((New-Entry -Override @{
        verification_mechanism_paths = @('Scripts/Deploy.ps1')
    }))
    Assert-Throws -Context 'declared path differing only in case' -MessagePattern 'claims mechanism paths this PR does not change' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths @('scripts/deploy.ps1') -HeadJson $wrongCaseDecl -BaseJson $emptyJson -GateRepoRoot $gitRoot
    }

    # --- multi-entry ledger must bind each closure to its OWN entry -----------------
    # ($entry leaked from an earlier foreach and pointed at the LAST head entry.)
    $secondEntry = New-Entry -Override @{
        id = 'second-mechanism-entry'
        verification_mechanism_paths = @('scripts/verify-all.ps1')
        bootstrap_evidence_refs = @('docs/evidence/second/self-referential-bootstrap/summary.md')
    }
    $twoOpenBase = New-LedgerJson -Entries @((New-Entry), $secondEntry)
    & $write 'docs/evidence/second/self-referential-bootstrap/summary.md' 'second entry bootstrap evidence'
    $null = Invoke-FixtureGit -Arguments @('add', '--', 'docs/evidence/second/self-referential-bootstrap/summary.md')
    $twoEntryBaseSha = New-FixtureHeadCommit -Json $twoOpenBase 'two open entries with complete base evidence'
    $firstClosedJson = New-LedgerJson -Entries @(
        (New-Entry -Override @{
            status = 'closed'
            fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $unrelatedAncestor; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
        }),
        $secondEntry
    )
    $twoHeadSha = New-FixtureHeadCommit -Json $firstClosedJson 'two entries, first closed'
    Assert-Throws -Context 'multi-entry closure binds to its own entry paths' -MessagePattern 'did not modify every declared verification_mechanism_path' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism `
            -HeadJson $firstClosedJson -BaseJson $twoOpenBase -GateRepoRoot $gitRoot -BaseSha $twoEntryBaseSha -HeadSha $twoHeadSha
    }

    # --- new entry must scope to this PR's changed paths (review P2) ----------------
    Assert-Throws -Context 'new entry claiming unchanged mechanism paths' -MessagePattern 'does not change' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths @('scripts/verify-all.ps1') -HeadJson $openBase -BaseJson $emptyJson
    }

    # --- new entry evidence must exist in the head tree -----------------------------
    Assert-Throws -Context 'new entry with missing evidence file' -MessagePattern 'not a committed file' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $tempRoot
    }

    $bootstrapEvidenceRef = 'docs/evidence/remote-linux-deploy/self-referential-bootstrap/summary.md'
    Assert-Throws -Context 'new entry reusing unchanged base evidence' -MessagePattern 'added or modified by this PR' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot
    }

    $modeOnlyOpeningBaseSha = ((Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD')) | Out-String).Trim()
    $null = Invoke-FixtureGit -Arguments @('update-index', '--chmod=+x', '--', $bootstrapEvidenceRef)
    $modeOnlyOpeningHeadSha = New-FixtureHeadCommit -Json $openBase 'mode-only bootstrap evidence change'
    Assert-Throws -Context 'new entry claims a mode-only evidence change as fresh content' `
        -MessagePattern 'unchanged between BaseSha and HeadSha' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths @($mechanism + $bootstrapEvidenceRef) `
            -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot `
            -BaseSha $modeOnlyOpeningBaseSha -HeadSha $modeOnlyOpeningHeadSha
    }

    # --- legal self-registration passes ---------------------------------------------
    $legalOpeningBaseSha = ((Invoke-FixtureGit -Arguments @('rev-parse', 'HEAD')) | Out-String).Trim()
    & $write $bootstrapEvidenceRef "fresh bootstrap evidence $([Guid]::NewGuid().ToString('N'))"
    $null = Invoke-FixtureGit -Arguments @('add', '--', $bootstrapEvidenceRef)
    $legalOpeningHeadSha = New-FixtureHeadCommit -Json $openBase 'content-fresh bootstrap evidence'
    Invoke-BodyGate -Rows @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'remote-linux-deploy-target'
        'Bootstrap reason' = $goodReason
    } -ChangedPaths @($mechanism + $bootstrapEvidenceRef) `
        -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot `
        -BaseSha $legalOpeningBaseSha -HeadSha $legalOpeningHeadSha

    # --- silently adding debt while declaring no ------------------------------------
    Assert-Throws -Context 'ledger gains entries under bootstrap=no' -MessagePattern 'requires declaring yes' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } `
            -ChangedPaths @($mechanism + $bootstrapEvidenceRef) `
            -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot `
            -BaseSha $legalOpeningBaseSha -HeadSha $legalOpeningHeadSha
    }

    foreach ($selfAdjudicator in @(
        'scripts/lib/self-referential-bootstrap.ps1',
        'scripts/lib/windows-verification-scope.ps1',
        'agent-contracts/spec-to-done.contract.json',
        'agent-contracts/spec-to-done.contract.schema.json'
    )) {
        Assert-Throws -Context "self-adjudicator edit under bootstrap=no: $selfAdjudicator" -MessagePattern 'must declare bootstrap=yes' -Action {
            Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } `
                -ChangedPaths @($selfAdjudicator) `
                -HeadJson $emptyJson -BaseJson $emptyJson
        }
    }

    # --- inherited open debt blocks (declared no, entry untouched) ------------------
    Assert-Throws -Context 'inherited open debt blocks mechanism PRs' -MessagePattern 'open ledger debt' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $openBase
    }

    foreach ($classifiedPath in $expectedMechanismPaths) {
        Assert-Throws -Context "classified path reaches debt gate: $classifiedPath" -MessagePattern 'open ledger debt|must declare bootstrap=yes' -Action {
            Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @($classifiedPath) -HeadJson $openBase -BaseJson $openBase
        }
    }

    # --- regression-repair lane (issue #494) ----------------------------------------
    # A fixpoint run that surfaces a mechanism regression had no legal repair
    # channel: naming the open entry hit the impersonation guard, opening a second
    # entry hit the other-open-debt gate, and bootstrap=no hit it too. The lane
    # opens exactly one door - append THIS PR's number to the open entry's
    # repair_prs - and keeps every other invariant.
    $repairSurface = @('scripts/deploy.ps1', 'scripts/self-referential-bootstrap-ledger.json')
    $repairChangedPaths = @('scripts/deploy.ps1', 'scripts/self-referential-bootstrap-ledger.json')
    $repairRows = @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'remote-linux-deploy-target'
        'Bootstrap reason' = $goodReason
    }
    $repairBase = New-LedgerJson -Entries @((New-Entry -Override @{
        verification_mechanism_paths = $repairSurface
    }))
    function New-RepairHeadJson {
        param([hashtable] $Override = @{})
        $base = @{ verification_mechanism_paths = $repairSurface; repair_prs = @(601) }
        foreach ($key in $Override.Keys) { $base[$key] = $Override[$key] }
        return (New-LedgerJson -Entries @((New-Entry -Override $base)))
    }
    $repairHead = New-RepairHeadJson

    # A legal repair passes: pre-existing open debt, own PR number appended, edits
    # confined to the surface that entry already declared, no adjudicator touched.
    Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
        -HeadJson $repairHead -BaseJson $repairBase -PrNumber 601

    # A repair that crosses the immutable surface must register one linked
    # successor. Missing that successor fails closed instead of deadlocking later.
    Assert-Throws -Context 'repair PR crosses surface without linked successor' `
        -MessagePattern 'must open exactly one linked successor debt' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths @($repairChangedPaths + 'scripts/verify-all.ps1') `
            -HeadJson $repairHead -BaseJson $repairBase -PrNumber 601
    }

    # (4) adjudicator paths ARE repairable, but only inside the declared surface.
    # Banning them outright deadlocked the debt it meant to protect: an entry that
    # declares an adjudicator path - as this repository's own open entry does -
    # could never have a failing fixpoint repaired, reproducing issue #494 one
    # level up. Self-clearance is prevented by base-pinned adjudication
    # (.github/workflows/pr-review-agent.yml checks out pull_request.base.sha and
    # fails closed rather than falling back to head), not by this list.
    $repairAdjudicatorSurface = @($repairSurface + 'scripts/lib/self-referential-bootstrap.ps1')
    $repairAdjudicatorBase = New-LedgerJson -Entries @((New-Entry -Override @{
        verification_mechanism_paths = $repairAdjudicatorSurface
    }))
    $repairAdjudicatorHead = New-LedgerJson -Entries @((New-Entry -Override @{
        verification_mechanism_paths = $repairAdjudicatorSurface
        repair_prs = @(601)
    }))
    Invoke-BodyGate -Rows $repairRows `
        -ChangedPaths @($repairChangedPaths + 'scripts/lib/self-referential-bootstrap.ps1') `
        -HeadJson $repairAdjudicatorHead -BaseJson $repairAdjudicatorBase -PrNumber 601
    # ...and an adjudicator OUTSIDE the declared surface needs its own linked
    # successor instead of silently widening the predecessor.
    Assert-Throws -Context 'repair PR edits outside adjudicator without successor' `
        -MessagePattern 'must open exactly one linked successor debt' -Action {
        Invoke-BodyGate -Rows $repairRows `
            -ChangedPaths @($repairChangedPaths + 'scripts/lib/self-referential-bootstrap.ps1') `
            -HeadJson $repairHead -BaseJson $repairBase -PrNumber 601
    }

    # (3) a repair must do real work. The ledger is itself a mechanism path and a
    # repair PR necessarily edits it to append repair_prs, so "changed at least one
    # mechanism path" is true by construction; only a NON-LEDGER mechanism path
    # distinguishes a real fix from a bare audit-history entry.
    Assert-Throws -Context 'repair PR that only appends the repair record' `
        -MessagePattern 'changes no verification-mechanism path other than the ledger' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths @('scripts/self-referential-bootstrap-ledger.json') `
            -HeadJson $repairHead -BaseJson $repairBase -PrNumber 601
    }

    # (2) the appended number must be exactly this PR: neither someone else's...
    Assert-Throws -Context 'repair appends a foreign PR number' `
        -MessagePattern 'must append exactly this PR number' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson $repairHead -BaseJson $repairBase -PrNumber 602
    }
    # ...nor a batch that smuggles extra PRs in alongside it.
    Assert-Throws -Context 'repair appends more than its own PR number' `
        -MessagePattern 'must append exactly this PR number' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-RepairHeadJson -Override @{ repair_prs = @(600, 601) }) `
            -BaseJson $repairBase -PrNumber 601
    }
    # An unbound PR number cannot be checked against, so it is refused outright.
    Assert-Throws -Context 'repair without a live PR number' `
        -MessagePattern 'requires a live PR number' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson $repairHead -BaseJson $repairBase -PrNumber 0
    }

    # (2b) ONE PR repairs ONE entry (L1-COR-001). The transition records every open
    # entry whose sole change is a repair_prs tail append, but the body names only
    # one - so validating just the named record let a second entry's audit history
    # ride along without ever meeting the PR-number or declared-surface checks.
    $secondOpenEvidence = 'docs/evidence/second-open/self-referential-bootstrap/summary.md'
    function New-SecondOpenEntry {
        param([hashtable] $Override = @{})
        $base = @{
            id = 'second-open-debt'
            verification_mechanism_paths = $repairSurface
            bootstrap_evidence_refs = @($secondOpenEvidence)
        }
        foreach ($key in $Override.Keys) { $base[$key] = $Override[$key] }
        return (New-Entry -Override $base)
    }
    $twoOpenRepairBase = New-LedgerJson -Entries @(
        (New-Entry -Override @{ verification_mechanism_paths = $repairSurface }),
        (New-SecondOpenEntry)
    )
    $twoOpenRepairHead = New-LedgerJson -Entries @(
        (New-Entry -Override @{ verification_mechanism_paths = $repairSurface; repair_prs = @(601) }),
        (New-SecondOpenEntry -Override @{ repair_prs = @(590) })
    )
    Assert-Throws -Context 'repair PR also appends repair_prs to an entry the body does not name' `
        -MessagePattern 'must touch exactly one ledger entry' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson $twoOpenRepairHead -BaseJson $twoOpenRepairBase -PrNumber 601
    }
    # Control: appending to ONLY the entry the body does not name must still be
    # caught by the original self-registration guard, so the single-door check is
    # an addition to that guard rather than a replacement for it.
    Assert-Throws -Context 'repair PR appends only to the entry the body does not name' `
        -MessagePattern 'does not ADD it' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-LedgerJson -Entries @(
                (New-Entry -Override @{ verification_mechanism_paths = $repairSurface }),
                (New-SecondOpenEntry -Override @{ repair_prs = @(590) }))) `
            -BaseJson $twoOpenRepairBase -PrNumber 601
    }

    # A repair with no outside-surface path may not manufacture successor debt.
    $repairPlusNewJson = New-LedgerJson -Entries @(
        (New-Entry -Override @{ verification_mechanism_paths = $repairSurface; repair_prs = @(601) }),
        (New-Entry -Override @{
            id = 'successor-mechanism-debt'
            pr = 601
            verification_mechanism_paths = $repairSurface
            bootstrap_evidence_refs = @('docs/evidence/successor/self-referential-bootstrap/summary.md')
        })
    )
    Assert-Throws -Context 'repair PR also opens new debt' `
        -MessagePattern 'has no outside-surface mechanism path' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson $repairPlusNewJson -BaseJson $repairBase -PrNumber 601
    }

    # --- linked successor for a necessary outside-surface repair -------------------
    $outsideRepairPath = 'scripts/tests/test-base-gate-capability.ps1'
    $successorEvidence = 'docs/evidence/linked-successor/self-referential-bootstrap/summary.md'
    $predecessorCommands = @((New-Entry).verification_contract.command_ids | ForEach-Object { [string]$_ })
    $successorContract = New-VerificationContract -Id 'linked-successor-gate/v1' `
        -CommandIds @($predecessorCommands + 'linked-successor-scope')
    function New-LinkedSuccessorEntry {
        param([hashtable] $Override = @{})
        $base = @{
            id = 'linked-successor-debt'
            pr = 601
            successor_of = 'remote-linux-deploy-target'
            verification_mechanism_paths = @('scripts/self-referential-bootstrap-ledger.json', $outsideRepairPath)
            verification_contract = $successorContract
            bootstrap_evidence_refs = @($successorEvidence)
        }
        foreach ($key in $Override.Keys) { $base[$key] = $Override[$key] }
        return (New-Entry -Override $base)
    }
    function New-LinkedRepairHeadJson {
        param(
            [hashtable] $SuccessorOverride = @{},
            [array] $ExtraEntries = @(),
            [array] $PrefixEntries = @()
        )
        return (New-LedgerJson -Entries @(
            @($PrefixEntries)
            (New-Entry -Override @{ verification_mechanism_paths = $repairSurface; repair_prs = @(601) })
            (New-LinkedSuccessorEntry -Override $SuccessorOverride)
            @($ExtraEntries)
        ))
    }
    $successorRepairChangedPaths = @($repairChangedPaths + $outsideRepairPath)

    # Valid path: predecessor remains immutable except repair_prs, successor is
    # current-PR-bound and owns exactly the outside path plus the ledger.
    Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
        -HeadJson (New-LinkedRepairHeadJson) -BaseJson $repairBase -PrNumber 601

    $missingRelationEntry = New-LinkedSuccessorEntry -Override @{
        successor_of = $null
        # Without the relation this is parsed as an ordinary entry, so cover all
        # paths to reach the repair-lane relationship check itself.
        verification_mechanism_paths = $successorRepairChangedPaths
    }
    $missingRelationEntry.Remove('successor_of')
    Assert-Throws -Context 'successor missing successor_of' -MessagePattern 'must declare successor_of' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LedgerJson -Entries @(
                (New-Entry -Override @{ verification_mechanism_paths = $repairSurface; repair_prs = @(601) }),
                $missingRelationEntry
            )) -BaseJson $repairBase -PrNumber 601
    }

    $alternateParent = New-Entry -Override @{
        id = 'alternate-parent'
        status = 'closed'
        pr = 499
        bootstrap_evidence_refs = @('docs/evidence/alternate/self-referential-bootstrap/summary.md')
        fixpoint = @{
            reverified_at = '2026-08-01T08:00:00Z'
            mechanism_commit = ('a' * 40)
            evidence_refs = @('docs/evidence/alternate/fixpoint/summary.md')
        }
    }
    $repairBaseWithAlternate = New-LedgerJson -Entries @(
        $alternateParent,
        (New-Entry -Override @{ verification_mechanism_paths = $repairSurface })
    )
    Assert-Throws -Context 'successor points to wrong predecessor' -MessagePattern "must declare successor_of='remote-linux-deploy-target'" -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -PrefixEntries @($alternateParent) `
                -SuccessorOverride @{ successor_of = 'alternate-parent' }) `
            -BaseJson $repairBaseWithAlternate -PrNumber 601
    }
    Assert-Throws -Context 'successor omits outside path' -MessagePattern 'must equal the ledger plus every outside-surface classified path' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -SuccessorOverride @{
                verification_mechanism_paths = @('scripts/self-referential-bootstrap-ledger.json')
            }) -BaseJson $repairBase -PrNumber 601
    }
    Assert-Throws -Context 'successor overlaps predecessor surface' -MessagePattern 'must equal the ledger plus every outside-surface classified path' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -SuccessorOverride @{
                verification_mechanism_paths = @(
                    'scripts/self-referential-bootstrap-ledger.json',
                    $outsideRepairPath,
                    'scripts/deploy.ps1'
                )
            }) -BaseJson $repairBase -PrNumber 601
    }
    Assert-Throws -Context 'successor duplicates a declared path' -MessagePattern 'duplicates=' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -SuccessorOverride @{
                verification_mechanism_paths = @(
                    'scripts/self-referential-bootstrap-ledger.json',
                    $outsideRepairPath,
                    $outsideRepairPath
                )
            }) -BaseJson $repairBase -PrNumber 601
    }
    Assert-Throws -Context 'successor claims classified path not changed by repair' -MessagePattern 'claims mechanism paths this PR does not change' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -SuccessorOverride @{
                verification_mechanism_paths = @(
                    'scripts/self-referential-bootstrap-ledger.json',
                    $outsideRepairPath,
                    'scripts/verify-all.ps1'
                )
            }) -BaseJson $repairBase -PrNumber 601
    }
    Assert-Throws -Context 'successor contract removes predecessor command' -MessagePattern 'downgrades predecessor' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -SuccessorOverride @{
                verification_contract = (New-VerificationContract -Id 'linked-successor-gate/v1' `
                    -CommandIds @($predecessorCommands[0..($predecessorCommands.Count - 2)]))
            }) -BaseJson $repairBase -PrNumber 601
    }
    $reorderedCommands = @($predecessorCommands)
    $reorderedCommands[0], $reorderedCommands[1] = $reorderedCommands[1], $reorderedCommands[0]
    Assert-Throws -Context 'successor contract reorders predecessor commands' -MessagePattern 'ordered prefix' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -SuccessorOverride @{
                verification_contract = (New-VerificationContract -Id 'linked-successor-gate/v1' `
                    -CommandIds @($reorderedCommands + 'linked-successor-scope'))
            }) -BaseJson $repairBase -PrNumber 601
    }
    Assert-Throws -Context 'repair opens two successors' -MessagePattern 'more than one successor|must open exactly one linked successor' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -ExtraEntries @(
                (New-LinkedSuccessorEntry -Override @{
                    id = 'second-linked-successor'
                    bootstrap_evidence_refs = @('docs/evidence/linked-successor-two/self-referential-bootstrap/summary.md')
                })
            )) -BaseJson $repairBase -PrNumber 601
    }
    $unrelatedNewEntry = New-Entry -Override @{
        id = 'unrelated-new-debt'
        pr = 601
        verification_mechanism_paths = $successorRepairChangedPaths
        bootstrap_evidence_refs = @('docs/evidence/unrelated/self-referential-bootstrap/summary.md')
    }
    Assert-Throws -Context 'repair opens linked successor plus unrelated debt' -MessagePattern 'must open exactly one linked successor' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $successorRepairChangedPaths `
            -HeadJson (New-LinkedRepairHeadJson -ExtraEntries @($unrelatedNewEntry)) `
            -BaseJson $repairBase -PrNumber 601
    }

    # A later fixpoint can discover another dependency while the original
    # predecessor is still open. The actual repair target owns repair_prs, but new
    # debt attaches to the unique open leaf. Outside scope is measured against the
    # whole active-chain union, so paths already owned by either A or B do not get
    # duplicated into C.
    $nestedOutsideRepairPath = 'scripts/verify-all.ps1'
    $nestedSuccessorEvidence = 'docs/evidence/nested-successor/self-referential-bootstrap/summary.md'
    $nestedSuccessorContract = New-VerificationContract -Id 'nested-successor-gate/v1' `
        -CommandIds @($successorContract.command_ids + 'nested-successor-scope')
    $openGrandparent = New-Entry -Override @{
        id = 'open-grandparent-debt'
        pr = 400
        verification_mechanism_paths = $repairSurface
        bootstrap_evidence_refs = @('docs/evidence/grandparent/self-referential-bootstrap/summary.md')
    }
    $linkedRepairTarget = New-LinkedSuccessorEntry -Override @{
        successor_of = 'open-grandparent-debt'
    }
    $nestedSuccessor = New-Entry -Override @{
        id = 'nested-successor-debt'
        pr = 602
        successor_of = 'linked-successor-debt'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            $nestedOutsideRepairPath
        )
        verification_contract = $nestedSuccessorContract
        bootstrap_evidence_refs = @($nestedSuccessorEvidence)
    }
    $linkedChainRepairRows = @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'linked-successor-debt'
        'Bootstrap reason' = $goodReason
    }
    $grandparentRepairRows = @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'open-grandparent-debt'
        'Bootstrap reason' = $goodReason
    }
    $nestedRepairChangedPaths = @(
        'scripts/self-referential-bootstrap-ledger.json',
        'scripts/deploy.ps1',
        $outsideRepairPath,
        $nestedOutsideRepairPath
    )
    $linkedChainBase = New-LedgerJson -Entries @($openGrandparent, $linkedRepairTarget)
    $linkedChainHead = New-LedgerJson -Entries @(
        $openGrandparent,
        (New-LinkedSuccessorEntry -Override @{
            successor_of = 'open-grandparent-debt'
            repair_prs = @(602)
        }),
        $nestedSuccessor
    )
    Invoke-BodyGate -Rows $linkedChainRepairRows -ChangedPaths $nestedRepairChangedPaths `
        -HeadJson $linkedChainHead -BaseJson $linkedChainBase -PrNumber 602

    # A non-leaf target is also legal: repair bookkeeping stays on A while C
    # still attaches to B, preserving a single lineage instead of forking A.
    $grandparentRepairHead = New-LedgerJson -Entries @(
        (New-Entry -Override @{
            id = 'open-grandparent-debt'
            pr = 400
            verification_mechanism_paths = $repairSurface
            bootstrap_evidence_refs = @('docs/evidence/grandparent/self-referential-bootstrap/summary.md')
            repair_prs = @(602)
        }),
        $linkedRepairTarget,
        $nestedSuccessor
    )
    Invoke-BodyGate -Rows $grandparentRepairRows -ChangedPaths $nestedRepairChangedPaths `
        -HeadJson $grandparentRepairHead -BaseJson $linkedChainBase -PrNumber 602

    Assert-Throws -Context 'nested successor forks from non-leaf repair target' `
        -MessagePattern 'more than one successor' -Action {
        Invoke-BodyGate -Rows $grandparentRepairRows -ChangedPaths $nestedRepairChangedPaths `
            -HeadJson (New-LedgerJson -Entries @(
                (New-Entry -Override @{
                    id = 'open-grandparent-debt'
                    pr = 400
                    verification_mechanism_paths = $repairSurface
                    bootstrap_evidence_refs = @('docs/evidence/grandparent/self-referential-bootstrap/summary.md')
                    repair_prs = @(602)
                }),
                $linkedRepairTarget,
                (New-Entry -Override @{
                    id = 'nested-successor-debt'
                    pr = 602
                    successor_of = 'open-grandparent-debt'
                    verification_mechanism_paths = @(
                        'scripts/self-referential-bootstrap-ledger.json',
                        $nestedOutsideRepairPath
                    )
                    verification_contract = $nestedSuccessorContract
                    bootstrap_evidence_refs = @($nestedSuccessorEvidence)
                })
            )) -BaseJson $linkedChainBase -PrNumber 602
    }
    Assert-Throws -Context 'nested successor overlaps active-chain ancestor surface' `
        -MessagePattern 'must equal the ledger plus every outside-surface classified path' -Action {
        Invoke-BodyGate -Rows $linkedChainRepairRows -ChangedPaths $nestedRepairChangedPaths `
            -HeadJson (New-LedgerJson -Entries @(
                $openGrandparent,
                (New-LinkedSuccessorEntry -Override @{
                    successor_of = 'open-grandparent-debt'
                    repair_prs = @(602)
                }),
                (New-Entry -Override @{
                    id = 'nested-successor-debt'
                    pr = 602
                    successor_of = 'linked-successor-debt'
                    verification_mechanism_paths = @(
                        'scripts/self-referential-bootstrap-ledger.json',
                        $nestedOutsideRepairPath,
                        'scripts/deploy.ps1'
                    )
                    verification_contract = $nestedSuccessorContract
                    bootstrap_evidence_refs = @($nestedSuccessorEvidence)
                })
            )) -BaseJson $linkedChainBase -PrNumber 602
    }
    $ancestorOnlyCommands = @($predecessorCommands + 'nested-successor-scope')
    Assert-Throws -Context 'nested successor preserves target but downgrades leaf contract' `
        -MessagePattern 'ordered prefix' -Action {
        Invoke-BodyGate -Rows $grandparentRepairRows -ChangedPaths $nestedRepairChangedPaths `
            -HeadJson (New-LedgerJson -Entries @(
                (New-Entry -Override @{
                    id = 'open-grandparent-debt'
                    pr = 400
                    verification_mechanism_paths = $repairSurface
                    bootstrap_evidence_refs = @('docs/evidence/grandparent/self-referential-bootstrap/summary.md')
                    repair_prs = @(602)
                }),
                $linkedRepairTarget,
                (New-Entry -Override @{
                    id = 'nested-successor-debt'
                    pr = 602
                    successor_of = 'linked-successor-debt'
                    verification_mechanism_paths = @(
                        'scripts/self-referential-bootstrap-ledger.json',
                        $nestedOutsideRepairPath
                    )
                    verification_contract = (New-VerificationContract -Id 'nested-successor-gate/v1' `
                        -CommandIds $ancestorOnlyCommands)
                    bootstrap_evidence_refs = @($nestedSuccessorEvidence)
                })
            )) -BaseJson $linkedChainBase -PrNumber 602
    }
    $unrelatedChainDebt = New-Entry -Override @{
        id = 'unrelated-chain-debt'
        pr = 590
        verification_mechanism_paths = @('scripts/verify-all.ps1')
        bootstrap_evidence_refs = @('docs/evidence/unrelated-chain/self-referential-bootstrap/summary.md')
    }
    Assert-Throws -Context 'nested successor beside unrelated open debt' `
        -MessagePattern 'one contiguous successor chain' -Action {
        Invoke-BodyGate -Rows $linkedChainRepairRows -ChangedPaths $nestedRepairChangedPaths `
            -HeadJson (New-LedgerJson -Entries @(
                $openGrandparent,
                (New-LinkedSuccessorEntry -Override @{
                    successor_of = 'open-grandparent-debt'
                    repair_prs = @(602)
                }),
                $unrelatedChainDebt,
                $nestedSuccessor
            )) -BaseJson (New-LedgerJson -Entries @(
                $openGrandparent,
                $linkedRepairTarget,
                $unrelatedChainDebt
            )) -PrNumber 602
    }

    # A linked successor is not an ordinary self-registering entry. Even when its
    # predecessor is already closed, the body must name the predecessor repair.
    $ordinarySuccessorRows = @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'linked-successor-debt'
        'Bootstrap reason' = $goodReason
    }
    Assert-Throws -Context 'successor self-registers as ordinary new debt' -MessagePattern 'cannot be self-registered as ordinary new debt' -Action {
        Invoke-BodyGate -Rows $ordinarySuccessorRows `
            -ChangedPaths @('scripts/self-referential-bootstrap-ledger.json', $outsideRepairPath) `
            -HeadJson (New-LedgerJson -Entries @($alternateParent, (New-LinkedSuccessorEntry -Override @{
                successor_of = 'alternate-parent'
            }))) `
            -BaseJson (New-LedgerJson -Entries @($alternateParent)) -PrNumber 601
    }

    # Everything except repair_prs stays immutable: an append cannot smuggle a
    # field rewrite past the open-entry immutability rule.
    Assert-Throws -Context 'repair append alongside another field change' -MessagePattern 'was modified' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-RepairHeadJson -Override @{ pr = 777 }) `
            -BaseJson $repairBase -PrNumber 601
    }
    # ...and the append really must be an append, not a rewrite of history.
    $repairTwiceBase = New-LedgerJson -Entries @((New-Entry -Override @{
        verification_mechanism_paths = $repairSurface
        repair_prs = @(590)
    }))
    Assert-Throws -Context 'repair rewrites an earlier repair_prs element' -MessagePattern 'was modified' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-RepairHeadJson -Override @{ repair_prs = @(591, 601) }) `
            -BaseJson $repairTwiceBase -PrNumber 601
    }
    Assert-Throws -Context 'repair drops an earlier repair_prs element' -MessagePattern 'was modified' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson $repairHead -BaseJson $repairTwiceBase -PrNumber 601
    }
    # A second repair on top of an existing repair_prs record is legal.
    Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
        -HeadJson (New-RepairHeadJson -Override @{ repair_prs = @(590, 601) }) `
        -BaseJson $repairTwiceBase -PrNumber 601

    # repair_prs schema: positive integers, strictly increasing, no duplicates.
    Assert-Throws -Context 'repair_prs out of order' -MessagePattern 'strictly increasing' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-RepairHeadJson -Override @{ repair_prs = @(602, 601) }) `
            -BaseJson $repairBase -PrNumber 601
    }
    Assert-Throws -Context 'repair_prs duplicate' -MessagePattern 'strictly increasing' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-RepairHeadJson -Override @{ repair_prs = @(601, 601) }) `
            -BaseJson $repairBase -PrNumber 601
    }
    foreach ($badRepairPrs in @(@('601'), @(601.5), @(0), @(-1))) {
        Assert-Throws -Context "repair_prs non-positive-integer member: $($badRepairPrs -join ',')" `
            -MessagePattern 'positive integers' -Action {
            Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
                -HeadJson (New-RepairHeadJson -Override @{ repair_prs = $badRepairPrs }) `
                -BaseJson $repairBase -PrNumber 601
        }
    }
    Assert-Throws -Context 'repair_prs as a scalar' -MessagePattern 'positive integers' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-RepairHeadJson -Override @{ repair_prs = 601 }) `
            -BaseJson $repairBase -PrNumber 601
    }
    # Unknown properties are still rejected: repair_prs is the ONLY new key.
    Assert-Throws -Context 'unknown ledger entry property' -MessagePattern 'unknown JSON property' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson (New-RepairHeadJson -Override @{ repair_notes = 'x' }) `
            -BaseJson $repairBase -PrNumber 601
    }

    # A NEW entry may not arrive carrying repair history. repair_prs is optional at
    # the schema level so the pre-lane closed entries stay parsable, which means a
    # self-registering entry could otherwise be born with a fabricated repair
    # record - never produced by a repair transition, never bound to any PR number.
    # The empty array is refused too: presence is the violation, not content.
    foreach ($fabricatedRepairPrs in @(@(), @(123), @(123, 456))) {
        Assert-Throws -Context "new entry born with repair_prs: [$($fabricatedRepairPrs -join ', ')]" `
            -MessagePattern 'new entry .* must not declare repair_prs|repair_prs must be non-empty when present' -Action {
            Invoke-BodyGate -Rows @{
                'Self-referential bootstrap' = 'yes'
                'Bootstrap ledger entry' = 'remote-linux-deploy-target'
                'Bootstrap reason' = $goodReason
            } -ChangedPaths $mechanism `
                -HeadJson (New-LedgerJson -Entries @((New-Entry -Override @{ repair_prs = $fabricatedRepairPrs }))) `
                -BaseJson $emptyJson
        }
    }

    # closed entries remain immutable - repair_prs is not a back door into them.
    $closedRepairBase = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = ('a' * 40); evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }))
    $closedRepairHead = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = ('a' * 40); evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
        repair_prs = @(601)
    }))
    Assert-Throws -Context 'appending repair_prs to a closed entry' -MessagePattern 'closed entries are immutable' -Action {
        Invoke-BodyGate -Rows $repairRows -ChangedPaths $repairChangedPaths `
            -HeadJson $closedRepairHead -BaseJson $closedRepairBase -PrNumber 601
    }

    # (5) a repair may not close debt in the same transition. Since condition 3
    # started demanding a non-ledger mechanism path, this combination is blocked on
    # BOTH reachable paths before condition 5 is consulted, so both are pinned here
    # and the condition-5 closure check itself is defence in depth:
    #   ledger-only changed paths -> condition 3 (the repair fixes nothing)
    #   any non-ledger mechanism path -> the closure single-purpose rule, which
    #   fires while evaluating the closure and before the body rows are read.
    # The closure below is otherwise fully legal, so the refusal is about the
    # combination and not about a defective fixpoint.
    $repairTargetEvidence = 'docs/evidence/repairable/self-referential-bootstrap/summary.md'
    $repairTargetEntry = New-Entry -Override @{
        id = 'repairable-mechanism-entry'
        verification_mechanism_paths = @('scripts/self-referential-bootstrap-ledger.json', 'scripts/deploy.ps1')
        bootstrap_evidence_refs = @($repairTargetEvidence)
    }
    & $write $repairTargetEvidence 'repair target bootstrap evidence'
    $null = Invoke-FixtureGit -Arguments @('add', '--', $repairTargetEvidence)
    $repairClosureBase = New-LedgerJson -Entries @((New-Entry), $repairTargetEntry)
    $repairClosureBaseSha = New-FixtureHeadCommit -Json $repairClosureBase 'base: closable entry plus repair target'
    $repairClosureSummary = 'docs/evidence/repair-closure/fixpoint/summary.md'
    $repairClosureAttestation = 'docs/evidence/repair-closure/fixpoint/attestation.json'
    $repairClosureEntry = New-Entry -Override @{
        status = 'closed'
        fixpoint = @{
            reverified_at = '2026-08-01T08:00:00Z'
            mechanism_commit = $fixpointCommit
            evidence_refs = @($repairClosureSummary, $repairClosureAttestation)
        }
    }
    & $write $repairClosureSummary 'repair-plus-closure re-verification'
    & $write $repairClosureAttestation (New-FixpointAttestationJson -Entry $repairClosureEntry -MechanismCommit $fixpointCommit)
    $null = Invoke-FixtureGit -Arguments @('add', '--', $repairClosureSummary, $repairClosureAttestation)
    $repairPlusClosureJson = New-LedgerJson -Entries @(
        $repairClosureEntry,
        (New-Entry -Override @{
            id = 'repairable-mechanism-entry'
            verification_mechanism_paths = @('scripts/self-referential-bootstrap-ledger.json', 'scripts/deploy.ps1')
            bootstrap_evidence_refs = @($repairTargetEvidence)
            repair_prs = @(601)
        })
    )
    $repairPlusClosureHead = New-FixtureHeadCommit -Json $repairPlusClosureJson 'closure plus repair in one transition'
    $repairPlusClosureRows = @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'repairable-mechanism-entry'
        'Bootstrap reason' = $goodReason
    }
    Assert-Throws -Context 'repair PR also closes debt, changing only the ledger' `
        -MessagePattern 'changes no verification-mechanism path other than the ledger' -Action {
        Invoke-BodyGate -Rows $repairPlusClosureRows -ChangedPaths @(
            'scripts/self-referential-bootstrap-ledger.json',
            $repairClosureSummary,
            $repairClosureAttestation
        ) -HeadJson $repairPlusClosureJson -BaseJson $repairClosureBase `
            -GateRepoRoot $gitRoot -BaseSha $repairClosureBaseSha -HeadSha $repairPlusClosureHead -PrNumber 601
    }
    Assert-Throws -Context 'repair PR also closes debt while doing real repair work' `
        -MessagePattern 'may only change the ledger' -Action {
        Invoke-BodyGate -Rows $repairPlusClosureRows -ChangedPaths @(
            'scripts/self-referential-bootstrap-ledger.json',
            'scripts/deploy.ps1',
            $repairClosureSummary,
            $repairClosureAttestation
        ) -HeadJson $repairPlusClosureJson -BaseJson $repairClosureBase `
            -GateRepoRoot $gitRoot -BaseSha $repairClosureBaseSha -HeadSha $repairPlusClosureHead -PrNumber 601
    }

    # --- linked predecessor closure while its one successor remains open -----------
    # Reproduce the post-repair state with real commits: PR #500 opened the
    # predecessor, PR #601 repaired it and opened its linked successor, then a
    # ledger-only PR closes #500. The remaining successor must not deadlock that
    # fully attested closure, but unrelated debt still must.
    $linkedParentBootstrap = 'docs/evidence/linked-parent/self-referential-bootstrap/summary.md'
    $linkedChildBootstrap = 'docs/evidence/linked-child/self-referential-bootstrap/summary.md'
    $linkedParentOpen = New-Entry -Override @{
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            'scripts/deploy.ps1'
        )
        bootstrap_evidence_refs = @($linkedParentBootstrap)
    }
    & $write $linkedParentBootstrap 'linked parent bootstrap evidence'
    & $write 'scripts/deploy.ps1' '# linked parent mechanism'
    & $write 'scripts/self-referential-bootstrap-ledger.json' `
        (New-LedgerJson -Entries @($linkedParentOpen))
    $null = Invoke-FixtureGit -Arguments @('add', '--',
        $linkedParentBootstrap,
        'scripts/deploy.ps1',
        'scripts/self-referential-bootstrap-ledger.json')
    $linkedParentMechanismCommit = & $commit 'linked parent mechanism (#500)'

    $linkedParentRepaired = New-Entry -Override @{
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            'scripts/deploy.ps1'
        )
        bootstrap_evidence_refs = @($linkedParentBootstrap)
        repair_prs = @(601)
    }
    $linkedChildOpen = New-Entry -Override @{
        id = 'linked-closure-successor'
        pr = 601
        successor_of = 'remote-linux-deploy-target'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            $outsideRepairPath
        )
        verification_contract = $successorContract
        bootstrap_evidence_refs = @($linkedChildBootstrap)
    }
    $linkedOpenLedger = New-LedgerJson -Entries @($linkedParentRepaired, $linkedChildOpen)
    & $write $linkedChildBootstrap 'linked child bootstrap evidence'
    & $write $outsideRepairPath '# linked successor mechanism'
    & $write 'scripts/self-referential-bootstrap-ledger.json' $linkedOpenLedger
    $null = Invoke-FixtureGit -Arguments @('add', '--',
        $linkedChildBootstrap,
        $outsideRepairPath,
        'scripts/self-referential-bootstrap-ledger.json')
    $linkedClosureBaseSha = & $commit 'linked successor mechanism (#601)'

    $linkedClosureSummary = 'docs/evidence/linked-parent/fixpoint/summary.md'
    $linkedClosureAttestation = 'docs/evidence/linked-parent/fixpoint/attestation.json'
    $linkedParentClosed = New-Entry -Override @{
        status = 'closed'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            'scripts/deploy.ps1'
        )
        bootstrap_evidence_refs = @($linkedParentBootstrap)
        repair_prs = @(601)
        fixpoint = @{
            reverified_at = '2026-08-03T08:00:00Z'
            mechanism_commit = $linkedParentMechanismCommit
            evidence_refs = @($linkedClosureSummary, $linkedClosureAttestation)
        }
    }
    $linkedClosedLedger = New-LedgerJson -Entries @($linkedParentClosed, $linkedChildOpen)
    & $write $linkedClosureSummary 'linked predecessor post-repair re-verification'
    & $write $linkedClosureAttestation `
        (New-FixpointAttestationJson -Entry $linkedParentClosed -MechanismCommit $linkedParentMechanismCommit)
    $null = Invoke-FixtureGit -Arguments @('add', '--', $linkedClosureSummary, $linkedClosureAttestation)
    $linkedClosureHeadSha = New-FixtureHeadCommit -Json $linkedClosedLedger 'close linked predecessor only'
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
        'scripts/self-referential-bootstrap-ledger.json',
        $linkedClosureSummary,
        $linkedClosureAttestation
    ) -HeadJson $linkedClosedLedger -BaseJson $linkedOpenLedger `
        -GateRepoRoot $gitRoot -BaseSha $linkedClosureBaseSha -HeadSha $linkedClosureHeadSha
    Assert-Throws -Context 'linked closure carries unrelated non-mechanism change' -MessagePattern 'open ledger debt' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
            'scripts/self-referential-bootstrap-ledger.json',
            $linkedClosureSummary,
            $linkedClosureAttestation,
            'README.md'
        ) -HeadJson $linkedClosedLedger -BaseJson $linkedOpenLedger `
            -GateRepoRoot $gitRoot -BaseSha $linkedClosureBaseSha -HeadSha $linkedClosureHeadSha
    }
    Assert-Throws -Context 'existing entry carries empty repair_prs' `
        -MessagePattern 'repair_prs must be non-empty when present' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @(
            (New-Entry -Override @{ repair_prs = @() })
        ))
    }

    # A later fixpoint may extend the open lineage before the oldest predecessor
    # can close. Exercise the full A -> B -> C lifecycle with real commits: close
    # exactly the oldest open root, preserve the contiguous suffix, and repeat.
    $linkedGrandchildBootstrap = 'docs/evidence/linked-grandchild/self-referential-bootstrap/summary.md'
    $linkedGrandchildOpen = New-Entry -Override @{
        id = 'linked-closure-grandchild'
        pr = 602
        successor_of = 'linked-closure-successor'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            $nestedOutsideRepairPath
        )
        verification_contract = $nestedSuccessorContract
        bootstrap_evidence_refs = @($linkedGrandchildBootstrap)
    }
    $threeOpenLedger = New-LedgerJson -Entries @(
        $linkedParentRepaired,
        $linkedChildOpen,
        $linkedGrandchildOpen
    )
    & $write $linkedGrandchildBootstrap 'linked grandchild bootstrap evidence'
    & $write $nestedOutsideRepairPath '# nested successor mechanism'
    & $write 'scripts/self-referential-bootstrap-ledger.json' $threeOpenLedger
    $null = Invoke-FixtureGit -Arguments @('add', '--',
        $linkedGrandchildBootstrap,
        $nestedOutsideRepairPath,
        'scripts/self-referential-bootstrap-ledger.json')
    $threeOpenBaseSha = & $commit 'nested successor mechanism (#602)'

    $chainParentSummary = 'docs/evidence/chain-parent/fixpoint/summary.md'
    $chainParentAttestation = 'docs/evidence/chain-parent/fixpoint/attestation.json'
    $chainParentClosed = New-Entry -Override @{
        status = 'closed'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            'scripts/deploy.ps1'
        )
        bootstrap_evidence_refs = @($linkedParentBootstrap)
        repair_prs = @(601)
        fixpoint = @{
            reverified_at = '2026-08-06T08:00:00Z'
            mechanism_commit = $linkedParentMechanismCommit
            evidence_refs = @($chainParentSummary, $chainParentAttestation)
        }
    }
    $parentClosedChainLedger = New-LedgerJson -Entries @(
        $chainParentClosed,
        $linkedChildOpen,
        $linkedGrandchildOpen
    )
    & $write $chainParentSummary 'oldest root verified before closing A'
    & $write $chainParentAttestation `
        (New-FixpointAttestationJson -Entry $chainParentClosed -MechanismCommit $linkedParentMechanismCommit)
    $null = Invoke-FixtureGit -Arguments @('add', '--', $chainParentSummary, $chainParentAttestation)
    $parentClosedChainHeadSha = New-FixtureHeadCommit -Json $parentClosedChainLedger 'close A and leave B to C open'
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
        'scripts/self-referential-bootstrap-ledger.json',
        $chainParentSummary,
        $chainParentAttestation
    ) -HeadJson $parentClosedChainLedger -BaseJson $threeOpenLedger `
        -GateRepoRoot $gitRoot -BaseSha $threeOpenBaseSha -HeadSha $parentClosedChainHeadSha

    $chainChildSummary = 'docs/evidence/chain-child/fixpoint/summary.md'
    $chainChildAttestation = 'docs/evidence/chain-child/fixpoint/attestation.json'
    $chainChildClosed = New-Entry -Override @{
        id = 'linked-closure-successor'
        status = 'closed'
        pr = 601
        successor_of = 'remote-linux-deploy-target'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            $outsideRepairPath
        )
        verification_contract = $successorContract
        bootstrap_evidence_refs = @($linkedChildBootstrap)
        fixpoint = @{
            reverified_at = '2026-08-07T08:00:00Z'
            mechanism_commit = $linkedClosureBaseSha
            evidence_refs = @($chainChildSummary, $chainChildAttestation)
        }
    }
    $childClosedChainLedger = New-LedgerJson -Entries @(
        $chainParentClosed,
        $chainChildClosed,
        $linkedGrandchildOpen
    )
    & $write $chainChildSummary 'next root verified before closing B'
    & $write $chainChildAttestation `
        (New-FixpointAttestationJson -Entry $chainChildClosed -MechanismCommit $linkedClosureBaseSha)
    $null = Invoke-FixtureGit -Arguments @('add', '--', $chainChildSummary, $chainChildAttestation)
    $childClosedChainHeadSha = New-FixtureHeadCommit -Json $childClosedChainLedger 'close B and leave C open'
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
        'scripts/self-referential-bootstrap-ledger.json',
        $chainChildSummary,
        $chainChildAttestation
    ) -HeadJson $childClosedChainLedger -BaseJson $parentClosedChainLedger `
        -GateRepoRoot $gitRoot -BaseSha $parentClosedChainHeadSha -HeadSha $childClosedChainHeadSha

    $chainGrandchildSummary = 'docs/evidence/chain-grandchild/fixpoint/summary.md'
    $chainGrandchildAttestation = 'docs/evidence/chain-grandchild/fixpoint/attestation.json'
    $chainGrandchildClosed = New-Entry -Override @{
        id = 'linked-closure-grandchild'
        status = 'closed'
        pr = 602
        successor_of = 'linked-closure-successor'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            $nestedOutsideRepairPath
        )
        verification_contract = $nestedSuccessorContract
        bootstrap_evidence_refs = @($linkedGrandchildBootstrap)
        fixpoint = @{
            reverified_at = '2026-08-08T08:00:00Z'
            mechanism_commit = $threeOpenBaseSha
            evidence_refs = @($chainGrandchildSummary, $chainGrandchildAttestation)
        }
    }
    $closedChainLedger = New-LedgerJson -Entries @(
        $chainParentClosed,
        $chainChildClosed,
        $chainGrandchildClosed
    )
    & $write $chainGrandchildSummary 'leaf verified before closing C'
    & $write $chainGrandchildAttestation `
        (New-FixpointAttestationJson -Entry $chainGrandchildClosed -MechanismCommit $threeOpenBaseSha)
    $null = Invoke-FixtureGit -Arguments @('add', '--', $chainGrandchildSummary, $chainGrandchildAttestation)
    $closedChainHeadSha = New-FixtureHeadCommit -Json $closedChainLedger 'close final chain leaf C'
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
        'scripts/self-referential-bootstrap-ledger.json',
        $chainGrandchildSummary,
        $chainGrandchildAttestation
    ) -HeadJson $closedChainLedger -BaseJson $childClosedChainLedger `
        -GateRepoRoot $gitRoot -BaseSha $childClosedChainHeadSha -HeadSha $closedChainHeadSha

    # Closure order is predecessor first. Closing the successor while its
    # predecessor remains open could strand that predecessor behind the global
    # no-second-successor invariant.
    $successorFirstBaseSha = New-FixtureHeadCommit -Json $linkedOpenLedger 'base for forbidden successor-first closure'
    $successorFirstSummary = 'docs/evidence/linked-child-first/fixpoint/summary.md'
    $successorFirstAttestation = 'docs/evidence/linked-child-first/fixpoint/attestation.json'
    $linkedChildClosedFirst = New-Entry -Override @{
        id = 'linked-closure-successor'
        status = 'closed'
        pr = 601
        successor_of = 'remote-linux-deploy-target'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            $outsideRepairPath
        )
        verification_contract = $successorContract
        bootstrap_evidence_refs = @($linkedChildBootstrap)
        fixpoint = @{
            reverified_at = '2026-08-03T09:00:00Z'
            mechanism_commit = $linkedClosureBaseSha
            evidence_refs = @($successorFirstSummary, $successorFirstAttestation)
        }
    }
    $successorFirstClosedLedger = New-LedgerJson -Entries @($linkedParentRepaired, $linkedChildClosedFirst)
    & $write $successorFirstSummary 'successor-first closure must remain blocked'
    & $write $successorFirstAttestation `
        (New-FixpointAttestationJson -Entry $linkedChildClosedFirst -MechanismCommit $linkedClosureBaseSha)
    $null = Invoke-FixtureGit -Arguments @('add', '--', $successorFirstSummary, $successorFirstAttestation)
    $successorFirstHeadSha = New-FixtureHeadCommit -Json $successorFirstClosedLedger 'attempt successor-first closure'
    Assert-Throws -Context 'successor closes before open predecessor' `
        -MessagePattern 'cannot be closed while predecessor.*remains open' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
            'scripts/self-referential-bootstrap-ledger.json',
            $successorFirstSummary,
            $successorFirstAttestation
        ) -HeadJson $successorFirstClosedLedger -BaseJson $linkedOpenLedger `
            -GateRepoRoot $gitRoot -BaseSha $successorFirstBaseSha -HeadSha $successorFirstHeadSha
    }

    # Closing both linked entries at once would make OpenDebt empty and bypass the
    # body-level singular exception. The transition itself must reject the pair.
    $closeBothParentSummary = 'docs/evidence/close-both-parent/fixpoint/summary.md'
    $closeBothParentAttestation = 'docs/evidence/close-both-parent/fixpoint/attestation.json'
    $closeBothChildSummary = 'docs/evidence/close-both-child/fixpoint/summary.md'
    $closeBothChildAttestation = 'docs/evidence/close-both-child/fixpoint/attestation.json'
    $closeBothParent = New-Entry -Override @{
        status = 'closed'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            'scripts/deploy.ps1'
        )
        bootstrap_evidence_refs = @($linkedParentBootstrap)
        repair_prs = @(601)
        fixpoint = @{
            reverified_at = '2026-08-05T08:00:00Z'
            mechanism_commit = $linkedParentMechanismCommit
            evidence_refs = @($closeBothParentSummary, $closeBothParentAttestation)
        }
    }
    $closeBothChild = New-Entry -Override @{
        id = 'linked-closure-successor'
        status = 'closed'
        pr = 601
        successor_of = 'remote-linux-deploy-target'
        verification_mechanism_paths = @(
            'scripts/self-referential-bootstrap-ledger.json',
            $outsideRepairPath
        )
        verification_contract = $successorContract
        bootstrap_evidence_refs = @($linkedChildBootstrap)
        fixpoint = @{
            reverified_at = '2026-08-05T08:01:00Z'
            mechanism_commit = $linkedClosureBaseSha
            evidence_refs = @($closeBothChildSummary, $closeBothChildAttestation)
        }
    }
    $closeBothLedger = New-LedgerJson -Entries @($closeBothParent, $closeBothChild)
    & $write $closeBothParentSummary 'parent half of forbidden close-both transition'
    & $write $closeBothParentAttestation `
        (New-FixpointAttestationJson -Entry $closeBothParent -MechanismCommit $linkedParentMechanismCommit)
    & $write $closeBothChildSummary 'child half of forbidden close-both transition'
    & $write $closeBothChildAttestation `
        (New-FixpointAttestationJson -Entry $closeBothChild -MechanismCommit $linkedClosureBaseSha)
    $null = Invoke-FixtureGit -Arguments @('add', '--',
        $closeBothParentSummary,
        $closeBothParentAttestation,
        $closeBothChildSummary,
        $closeBothChildAttestation)
    $closeBothHeadSha = New-FixtureHeadCommit -Json $closeBothLedger 'attempt linked close-both transition'
    Assert-Throws -Context 'linked predecessor and successor close together' `
        -MessagePattern 'must close exactly one ledger entry' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
            'scripts/self-referential-bootstrap-ledger.json',
            $closeBothParentSummary,
            $closeBothParentAttestation,
            $closeBothChildSummary,
            $closeBothChildAttestation
        ) -HeadJson $closeBothLedger -BaseJson $linkedOpenLedger `
            -GateRepoRoot $gitRoot -BaseSha $linkedClosureBaseSha -HeadSha $closeBothHeadSha
    }

    # The exception is direct and singular: an unrelated open entry beside the
    # linked successor keeps blocking the closure.
    $unrelatedLinkedEvidence = 'docs/evidence/unrelated-linked/self-referential-bootstrap/summary.md'
    $unrelatedLinkedEntry = New-Entry -Override @{
        id = 'unrelated-linked-debt'
        pr = 777
        verification_mechanism_paths = @('scripts/verify-all.ps1')
        bootstrap_evidence_refs = @($unrelatedLinkedEvidence)
    }
    & $write $unrelatedLinkedEvidence 'unrelated open debt evidence'
    $null = Invoke-FixtureGit -Arguments @('add', '--', $unrelatedLinkedEvidence)
    $linkedOpenWithUnrelated = New-LedgerJson -Entries @(
        $linkedParentRepaired,
        $linkedChildOpen,
        $unrelatedLinkedEntry
    )
    $linkedUnrelatedBaseSha = New-FixtureHeadCommit -Json $linkedOpenWithUnrelated 'base with linked and unrelated debt'
    $linkedUnrelatedSummary = 'docs/evidence/linked-parent-unrelated/fixpoint/summary.md'
    $linkedUnrelatedAttestation = 'docs/evidence/linked-parent-unrelated/fixpoint/attestation.json'
    $linkedClosedWithUnrelated = New-LedgerJson -Entries @(
        (New-Entry -Override @{
            status = 'closed'
            verification_mechanism_paths = @(
                'scripts/self-referential-bootstrap-ledger.json',
                'scripts/deploy.ps1'
            )
            bootstrap_evidence_refs = @($linkedParentBootstrap)
            repair_prs = @(601)
            fixpoint = @{
                reverified_at = '2026-08-04T08:00:00Z'
                mechanism_commit = $linkedParentMechanismCommit
                evidence_refs = @($linkedUnrelatedSummary, $linkedUnrelatedAttestation)
            }
        }),
        $linkedChildOpen,
        $unrelatedLinkedEntry
    )
    $linkedUnrelatedClosedEntry = @((Get-SelfReferentialBootstrapLedger -Json $linkedClosedWithUnrelated).entries | Where-Object {
        [string]$_.id -ceq 'remote-linux-deploy-target'
    })[0]
    & $write $linkedUnrelatedSummary 'closure must remain blocked by unrelated debt'
    & $write $linkedUnrelatedAttestation `
        (New-FixpointAttestationJson -Entry $linkedUnrelatedClosedEntry -MechanismCommit $linkedParentMechanismCommit)
    $null = Invoke-FixtureGit -Arguments @('add', '--', $linkedUnrelatedSummary, $linkedUnrelatedAttestation)
    $linkedUnrelatedHeadSha = New-FixtureHeadCommit -Json $linkedClosedWithUnrelated 'attempt closure beside unrelated debt'
    Assert-Throws -Context 'linked closure with unrelated open debt' `
        -MessagePattern 'one contiguous successor chain' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths @(
            'scripts/self-referential-bootstrap-ledger.json',
            $linkedUnrelatedSummary,
            $linkedUnrelatedAttestation
        ) -HeadJson $linkedClosedWithUnrelated -BaseJson $linkedOpenWithUnrelated `
            -GateRepoRoot $gitRoot -BaseSha $linkedUnrelatedBaseSha -HeadSha $linkedUnrelatedHeadSha
    }

    # --- non-mechanism PRs are untouched by all of this -----------------------------
    Invoke-BodyGate -Rows @{} -ChangedPaths @('web-viewer-sample/src/Window.tsx') -HeadJson $openBase -BaseJson $openBase

    # With exact head context, unrelated PRs still load the ledger only to protect
    # referenced evidence from deletion; ordinary product changes remain allowed.
    $openLedgerHead = New-FixtureHeadCommit -Json $openBase 'open ledger before unrelated change'
    Invoke-BodyGate -Rows @{} -ChangedPaths @('web-viewer-sample/src/Window.tsx') `
        -HeadJson $openBase -BaseJson $openBase -GateRepoRoot $gitRoot `
        -BaseSha $openLedgerHead -HeadSha $openLedgerHead

    $bootstrapEvidencePath = 'docs/evidence/remote-linux-deploy/self-referential-bootstrap/summary.md'
    $renamedBootstrapEvidencePath = 'docs/evidence/remote-linux-deploy/self-referential-bootstrap/renamed-summary.md'
    Move-Item -LiteralPath (Join-Path $gitRoot $bootstrapEvidencePath) -Destination (Join-Path $gitRoot $renamedBootstrapEvidencePath)
    $null = Invoke-FixtureGit -Arguments @('add', '-A')
    $openEvidenceRenamedHead = & $commit 'unrelated PR renames referenced bootstrap evidence'
    Assert-Throws -Context 'rename destination list cannot hide removed bootstrap evidence source' -MessagePattern 'immutable referenced evidence' -Action {
        Invoke-BodyGate -Rows @{} -ChangedPaths @($renamedBootstrapEvidencePath) -HeadJson $openBase -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $openLedgerHead -HeadSha $openEvidenceRenamedHead
    }
    Move-Item -LiteralPath (Join-Path $gitRoot $renamedBootstrapEvidencePath) -Destination (Join-Path $gitRoot $bootstrapEvidencePath)
    $null = Invoke-FixtureGit -Arguments @('add', '-A')
    $null = & $commit 'restore referenced bootstrap evidence after rename probe'

    & $write $bootstrapEvidencePath 'substituted bootstrap evidence'
    $null = Invoke-FixtureGit -Arguments @('add', '--', $bootstrapEvidencePath)
    $openEvidenceRewrittenHead = & $commit 'unrelated PR rewrites referenced bootstrap evidence'
    Assert-Throws -Context 'unrelated PR rewrites open-entry bootstrap evidence' -MessagePattern 'immutable referenced evidence' -Action {
        Invoke-BodyGate -Rows @{} -ChangedPaths @($bootstrapEvidencePath) -HeadJson $openBase -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $openLedgerHead -HeadSha $openEvidenceRewrittenHead
    }

    Remove-Item -LiteralPath (Join-Path $gitRoot $bootstrapEvidencePath) -Force
    $null = Invoke-FixtureGit -Arguments @('add', '-u', '--', $bootstrapEvidencePath)
    $openEvidenceDeletedHead = & $commit 'unrelated PR deletes referenced bootstrap evidence'
    Assert-Throws -Context 'unrelated PR deletes open-entry bootstrap evidence' -MessagePattern 'not a committed file' -Action {
        Invoke-BodyGate -Rows @{} -ChangedPaths @($bootstrapEvidencePath) `
            -HeadJson $openBase -BaseJson $openBase -GateRepoRoot $gitRoot `
            -BaseSha $openLedgerHead -HeadSha $openEvidenceDeletedHead
    }

    # Restore the opening evidence while committing a valid closed ledger, then
    # prove the same protection applies to the closed entry's fixpoint evidence.
    & $write $bootstrapEvidencePath 'restored bootstrap evidence'
    $null = Invoke-FixtureGit -Arguments @('add', '--', $bootstrapEvidencePath)
    $closedLedgerHead = New-FixtureHeadCommit -Json $legalClosedJson 'closed ledger with intact evidence'
    $fixpointEvidencePath = 'docs/evidence/remote-linux-deploy/fixpoint/summary.md'
    & $write $fixpointEvidencePath 'substituted fixpoint evidence'
    $null = Invoke-FixtureGit -Arguments @('add', '--', $fixpointEvidencePath)
    $closedEvidenceRewrittenHead = & $commit 'unrelated PR rewrites referenced fixpoint evidence'
    Assert-Throws -Context 'unrelated PR rewrites closed-entry fixpoint evidence' -MessagePattern 'immutable referenced evidence' -Action {
        Invoke-BodyGate -Rows @{} -ChangedPaths @($fixpointEvidencePath) `
            -HeadJson $legalClosedJson -BaseJson $legalClosedJson -GateRepoRoot $gitRoot `
            -BaseSha $closedLedgerHead -HeadSha $closedEvidenceRewrittenHead
    }

    Remove-Item -LiteralPath (Join-Path $gitRoot $fixpointEvidencePath) -Force
    $null = Invoke-FixtureGit -Arguments @('add', '-u', '--', $fixpointEvidencePath)
    $closedEvidenceDeletedHead = & $commit 'unrelated PR deletes referenced fixpoint evidence'
    Assert-Throws -Context 'unrelated PR deletes closed-entry fixpoint evidence' -MessagePattern 'not a committed file' -Action {
        Invoke-BodyGate -Rows @{} -ChangedPaths @($fixpointEvidencePath) `
            -HeadJson $legalClosedJson -BaseJson $legalClosedJson -GateRepoRoot $gitRoot `
            -BaseSha $closedLedgerHead -HeadSha $closedEvidenceDeletedHead
    }

    # --- wire-up through the real PR body checker (fixture ledger revision) ---------
    # This file's contract is "gate tests use fixture ledgers ONLY". Pointing base and
    # head at the live HEAD broke it: the gate reads both ledgers with
    # `git show <sha>:scripts/self-referential-bootstrap-ledger.json`, so the moment a
    # real open entry landed in the repo ledger this case silently changed meaning
    # from "clean transition" to "inherited open debt" and failed for a reason that
    # has nothing to do with wire-up. Build a synthetic commit whose tree holds an
    # empty ledger and read the gate through that, so the assertion stays about the
    # checker's wiring and not about whatever debt the repo currently carries.
    $checker = Join-Path $repoRoot 'scripts/tests/check-pr-body-evidence.ps1'
    $pathsPath = Join-Path $tempRoot 'paths.txt'
    Set-Content -LiteralPath $pathsPath -Value 'scripts/dev/rebuild-test-deploy.ps1' -Encoding utf8
    $headSha = New-FixtureLedgerRevision -RepoRoot $repoRoot -TempRoot $tempRoot -LedgerJson @'
{
  "schema_version": "self-referential-bootstrap-ledger/v1",
  "entries": []
}
'@

    $baseBody = @'
| Item | Result |
|---|---|
| Change lane | G |
| Behavior contract changed | yes |
| Requirement source | docs/plans |
| Linked issue | docs/plans/remote-linux-test-deploy-target.plan.md |
| CODEOWNERS / owner review | requested |
| GitNexus evidence | detect_changes |
| Browser E2E evidence | not user-facing |
| Agent workflow changed? | no |
| Required checks expected | CI / Agent Governance / PR Metadata Contract |
| Affects runtime / docker / Kit / viewer / ports / env? | yes |
| Canonical deploy path updated? | verified |
| Deploy dry-run command | .\scripts\deploy.ps1 -DryRun |
| Verify command | .\scripts\verify-all.ps1 |
'@
    $baseBody += "`n| Windows verification tier | deploy_dryrun |`n| Windows verification evidence | head $headSha; synthetic fixture run; https://github.com/monkey1sai/AI-BIM-governance/actions/runs/123456789 |"

    $bodyMissing = Join-Path $tempRoot 'body-missing.md'
    Set-Content -LiteralPath $bodyMissing -Value $baseBody -Encoding utf8
    $output = & pwsh -NoProfile -NonInteractive -File $checker -BodyPath $bodyMissing -ChangedPathsPath $pathsPath -BaseSha $headSha -HeadSha $headSha 2>&1 | Out-String -Width 4096
    Assert-True ($LASTEXITCODE -ne 0) 'checker must fail when a mechanism PR omits the bootstrap declaration'
    Assert-True ($output -match '(?s)Self-referential.{0,200}bootstrap') "checker failure must name the missing label even when the host inserts formatted error prefixes (got: $output)"

    $bodyOk = Join-Path $tempRoot 'body-ok.md'
    Set-Content -LiteralPath $bodyOk -Value ($baseBody + "`n" + '| Self-referential bootstrap | no |') -Encoding utf8
    & pwsh -NoProfile -NonInteractive -File $checker -BodyPath $bodyOk -ChangedPathsPath $pathsPath -BaseSha $headSha -HeadSha $headSha *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'checker must pass for a declared-no mechanism PR whose ledger transition is clean'

    Write-Host '[test-self-referential-bootstrap] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
