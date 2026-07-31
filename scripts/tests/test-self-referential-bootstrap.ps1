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
        [bool] $HasBase = $true,
        [int] $PrNumber = 500,
        [string] $GateRepoRoot = '',
        [string] $BaseSha = ''
    )
    $headPath = Write-LedgerFile "head-$([Guid]::NewGuid().ToString('N')).json" $HeadJson
    Assert-SelfReferentialBootstrapBody -Body 'body' -ChangedPaths $ChangedPaths -LedgerPath $headPath `
        -GetTableValue { param($b, $label) $Rows[$label] }.GetNewClosure() `
        -BaseLedgerJson $BaseJson -HasBaseContext $HasBase -PrNumber $PrNumber `
        -RepoRoot $GateRepoRoot -BaseSha $BaseSha
}

try {
    $mechanism = @('scripts/deploy.ps1')
    $emptyJson = New-LedgerJson -Entries @()

    # --- git fixture repo for fixpoint ancestry + evidence existence ----------------
    $gitRoot = Join-Path $tempRoot 'gitfx'
    New-Item -ItemType Directory -Path $gitRoot -Force | Out-Null
    & git -C $gitRoot init -q
    & git -C $gitRoot -c user.email=t@t -c user.name=t commit -q --allow-empty -m 'mechanism merged'
    $fixpointCommit = (& git -C $gitRoot rev-parse HEAD).Trim()
    # Evidence must be COMMITTED blobs at HEAD (filesystem-only presence is not
    # reviewable evidence), so the fixture commits them into the base commit.
    New-Item -ItemType Directory -Path (Join-Path $gitRoot 'docs/evidence/remote-linux-deploy/self-referential-bootstrap') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $gitRoot 'docs/evidence/remote-linux-deploy/fixpoint') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $gitRoot 'docs/evidence/remote-linux-deploy/self-referential-bootstrap/summary.md') -Value 'evidence'
    Set-Content -LiteralPath (Join-Path $gitRoot 'docs/evidence/remote-linux-deploy/fixpoint/summary.md') -Value 'fixpoint evidence'
    Set-Content -LiteralPath (Join-Path $gitRoot 'untracked-evidence.md') -Value 'untracked'
    & git -C $gitRoot add docs
    & git -C $gitRoot -c user.email=t@t -c user.name=t commit -q -m 'base with evidence'
    $baseSha = (& git -C $gitRoot rev-parse HEAD).Trim()

    # --- mechanism path detection (incl. enforcement workflows: review P2) ----------
    $matched = Get-SelfReferentialMechanismPaths -ChangedPaths @(
        'scripts/deploy.ps1',
        '.github/workflows/pr-review-agent.yml',
        '.github/workflows/agent-governance.yml',
        '.github/workflows/ci.yml',
        'scripts/verification-manifest.json',
        'scripts/tests/verify-functional-runtime-result.ps1',
        'scripts/tests/verify-security-exceptions.ps1',
        'scripts/dev/check-pr-local-preflight.ps1',
        'scripts/hooks/require-gstack-evidence.ps1',
        'web-viewer-sample/src/Window.tsx'
    )
    Assert-True ($matched.Count -eq 9) "enforcement workflows, manifest, verifiers, and local enforcement entrypoints must classify as mechanism (matched: $($matched -join ', '))"

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

    # --- ledger integrity (structure-level, unchanged rules) ------------------------
    $null = Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry)))
    Assert-Throws -Context 'garbage opened_at in ledger' -MessagePattern 'ISO-8601' -Action {
        Get-SelfReferentialBootstrapLedger -Json (New-LedgerJson -Entries @((New-Entry -Override @{ opened_at = '2026-99-99T99:99:99garbage' })))
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
    # legal closure passes
    $legalClosed = New-LedgerJson -Entries @((New-Entry -Override @{
        status = 'closed'
        fixpoint = @{ reverified_at = '2026-08-01T08:00:00Z'; mechanism_commit = $fixpointCommit; evidence_refs = @('docs/evidence/remote-linux-deploy/fixpoint/summary.md') }
    }))
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $legalClosed -BaseJson $openBase -GateRepoRoot $gitRoot -BaseSha $baseSha

    # --- base context is mandatory when the ledger is in play (review P1 #4) --------
    Assert-Throws -Context 'head-only evaluation with ledger entries' -MessagePattern 'base context' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $openBase -HasBase $false
    }
    # mechanism PR with an empty untouched ledger still passes without base context
    Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $emptyJson -HasBase $false

    # --- pr binding for new entries (review P2) -------------------------------------
    Assert-Throws -Context 'new entry bound to a different PR number' -MessagePattern 'must bind to their originating PR' -Action {
        Invoke-BodyGate -Rows @{
            'Self-referential bootstrap' = 'yes'
            'Bootstrap ledger entry' = 'remote-linux-deploy-target'
            'Bootstrap reason' = $goodReason
        } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $emptyJson -PrNumber 501
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

    # --- legal self-registration passes ---------------------------------------------
    Invoke-BodyGate -Rows @{
        'Self-referential bootstrap' = 'yes'
        'Bootstrap ledger entry' = 'remote-linux-deploy-target'
        'Bootstrap reason' = $goodReason
    } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot

    # --- silently adding debt while declaring no ------------------------------------
    Assert-Throws -Context 'ledger gains entries under bootstrap=no' -MessagePattern 'requires declaring yes' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $emptyJson -GateRepoRoot $gitRoot
    }

    # --- inherited open debt blocks (declared no, entry untouched) ------------------
    Assert-Throws -Context 'inherited open debt blocks mechanism PRs' -MessagePattern 'open ledger debt' -Action {
        Invoke-BodyGate -Rows @{ 'Self-referential bootstrap' = 'no' } -ChangedPaths $mechanism -HeadJson $openBase -BaseJson $openBase
    }

    # --- non-mechanism PRs are untouched by all of this -----------------------------
    Invoke-BodyGate -Rows @{} -ChangedPaths @('web-viewer-sample/src/Window.tsx') -HeadJson $openBase -BaseJson $openBase

    # --- wire-up through the real PR body checker (base context = HEAD) -------------
    $checker = Join-Path $repoRoot 'scripts/tests/check-pr-body-evidence.ps1'
    $pathsPath = Join-Path $tempRoot 'paths.txt'
    Set-Content -LiteralPath $pathsPath -Value 'scripts/dev/rebuild-test-deploy.ps1' -Encoding utf8
    $headSha = (& git -C $repoRoot rev-parse HEAD).Trim()

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
