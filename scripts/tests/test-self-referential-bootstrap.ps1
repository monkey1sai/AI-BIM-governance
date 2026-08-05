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

function New-Entry {
    param([hashtable] $Override = @{})
    $entry = [ordered]@{
        id = 'remote-linux-deploy-target'
        status = 'open'
        pr = 500
        opened_at = '2026-07-31T08:00:00Z'
        reason = $goodReason
        verification_mechanism_paths = @('scripts/deploy.ps1')
        verification_contract = [ordered]@{
            id = 'self-referential-bootstrap-gate/v1'
            command_ids = @(
                'test-self-referential-bootstrap',
                'test-base-gate-capability',
                'test-preflight-prnumber-forwarding',
                'test-agent-governance-check',
                'test-pr-body-evidence',
                'test-pr-review-agent',
                'invoke-powershell-static',
                'detect-base-gate-capability-bash-syntax'
            )
            contract_sha256 = '0f37135086c5b61af8246ba89ac584287ab57749c6b0ff9e7eabd7a6a4351367'
        }
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
        '.github/workflows/pr-review-agent.yml',
        '.github/workflows/agent-governance.yml',
        '.github/workflows/ci.yml',
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
    Assert-True ($matched -notcontains 'web-viewer-sample/src/Window.tsx') 'ordinary product code must NOT classify as mechanism'
    $wrongCaseMechanismPaths = @(Get-SelfReferentialMechanismPaths -ChangedPaths @(
        'Scripts/Deploy.ps1',
        '.github/workflows/CI.yml'
    ))
    Assert-True ($wrongCaseMechanismPaths.Count -eq 0) `
        "wrong-case git paths must not classify as mechanisms (matched: $($wrongCaseMechanismPaths -join ', '))"
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

    # --- real repo ledger: parse-integrity ONLY, no emptiness assumption ------------
    $realLedger = Get-SelfReferentialBootstrapLedger -Path (Join-Path $repoRoot 'scripts/self-referential-bootstrap-ledger.json')
    Assert-True ($null -ne $realLedger) 'repo ledger must parse and validate'

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

    Assert-Throws -Context 'self-adjudicator edit under bootstrap=no' -MessagePattern 'must declare bootstrap=yes' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } `
            -ChangedPaths @('scripts/lib/self-referential-bootstrap.ps1') `
            -HeadJson $emptyJson -BaseJson $emptyJson
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

    $bodyMissing = Join-Path $tempRoot 'body-missing.md'
    Set-Content -LiteralPath $bodyMissing -Value $baseBody -Encoding utf8
    $output = & pwsh -NoProfile -NonInteractive -File $checker -BodyPath $bodyMissing -ChangedPathsPath $pathsPath -BaseSha $headSha -HeadSha $headSha 2>&1 | Out-String
    Assert-True ($LASTEXITCODE -ne 0) 'checker must fail when a mechanism PR omits the bootstrap declaration'
    Assert-True ($output -match 'Self-referential bootstrap') "checker failure must name the missing label (got: $output)"

    $bodyOk = Join-Path $tempRoot 'body-ok.md'
    Set-Content -LiteralPath $bodyOk -Value ($baseBody + "`n" + '| Self-referential bootstrap | no |') -Encoding utf8
    & pwsh -NoProfile -NonInteractive -File $checker -BodyPath $bodyOk -ChangedPathsPath $pathsPath -BaseSha $headSha -HeadSha $headSha *> $null
    Assert-True ($LASTEXITCODE -eq 0) 'checker must pass for a declared-no mechanism PR whose ledger transition is clean'

    Write-Host '[test-self-referential-bootstrap] all assertions passed'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
