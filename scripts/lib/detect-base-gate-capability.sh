#!/bin/bash
# Decides whether the PR BASE revision carries the COMPLETE bootstrap gate, so
# the workflow can adjudicate a PR with base-pinned scripts instead of the PR's
# own (possibly weakened) copy.
#
# Extracted from .github/workflows/pr-review-agent.yml so the decision is
# executable in tests rather than replicated in them (Codex review TG-2). This
# adds no trust surface: the workflow that calls it is already PR-editable,
# which is the documented boundary in docs/agents/self-referential-bootstrap.md
# §4.1.
#
# Usage:  detect-base-gate-capability.sh <base_sha> [repo_root]
# Prints: "complete" or "incomplete: <reason>"; exit 0 either way. Non-zero exit
#         means the detection itself failed and the caller MUST fail closed.
#
# Completeness is the WHOLE capability, not one file. Checking only that
# check-pr-body-evidence.ps1 exists at base was the defect that let PR #459 be
# evaluated by the old base checker while the gate it introduced never ran: that
# file is MODIFIED by such a PR, not created, so the check passed vacuously.

set -euo pipefail

base_sha="${1:?usage: detect-base-gate-capability.sh <base_sha> [repo_root]}"
repo_root="${2:-.}"
pwsh_exe="${PWSH_EXE:-pwsh}"
if ! command -v "$pwsh_exe" >/dev/null 2>&1; then
  # Windows local preflight may resolve `bash` to WSL or Git Bash while pwsh is
  # installed only on the host. Keep CI on PATH-first behavior, then use the two
  # standard interop spellings as a narrow local fallback.
  for candidate in \
    '/mnt/c/Program Files/PowerShell/7/pwsh.exe' \
    '/c/Program Files/PowerShell/7/pwsh.exe'; do
    if [ -x "$candidate" ]; then
      pwsh_exe="$candidate"
      break
    fi
  done
fi
if ! command -v "$pwsh_exe" >/dev/null 2>&1 && [ ! -x "$pwsh_exe" ]; then
  echo "base gate capability detection failed: pwsh executable not found" >&2
  exit 1
fi

git_at_base() { git -C "$repo_root" cat-file -e "$base_sha:$1" 2>/dev/null; }

if ! git_at_base 'scripts/tests/check-pr-body-evidence.ps1'; then
  echo "incomplete: base has no scripts/tests/check-pr-body-evidence.ps1"
  exit 0
fi
if ! git_at_base 'scripts/lib/self-referential-bootstrap.ps1'; then
  echo "incomplete: base has no scripts/lib/self-referential-bootstrap.ps1"
  exit 0
fi

probe_dir="$(mktemp -d)"
trap 'rm -rf "$probe_dir"' EXIT
base_checker_path="$probe_dir/check-pr-body-evidence.ps1"
ast_probe_path="$probe_dir/probe-base-checker.ps1"
git -C "$repo_root" show "$base_sha:scripts/tests/check-pr-body-evidence.ps1" > "$base_checker_path"

# Text grep is not a capability check: comments and string literals can contain
# both required names without wiring either one. Parse the exact BASE checker and
# require executable PowerShell command ASTs for the dot-source and assertion.
cat > "$ast_probe_path" <<'POWERSHELL'
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $CheckerPath)

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $CheckerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
    throw "base checker has PowerShell parse errors: $($errors[0].Message)"
}

function Test-IsRootExecutableCommand {
    param([Parameter(Mandatory = $true)][System.Management.Automation.Language.Ast] $Command)
    $scriptBlockCount = 0
    for ($parent = $Command.Parent; $null -ne $parent; $parent = $parent.Parent) {
        if ($parent -is [System.Management.Automation.Language.StatementBlockAst] -or
            $parent -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
            return $false
        }
        if ($parent -is [System.Management.Automation.Language.ScriptBlockAst]) {
            $scriptBlockCount++
        }
    }
    return $scriptBlockCount -eq 1
}

function Get-RootStatement {
    param([Parameter(Mandatory = $true)][System.Management.Automation.Language.Ast] $Node)
    $candidate = $Node
    while ($null -ne $candidate.Parent) {
        if ($candidate.Parent -is [System.Management.Automation.Language.NamedBlockAst]) {
            $scriptBlock = $candidate.Parent.Parent
            if ($scriptBlock -is [System.Management.Automation.Language.ScriptBlockAst] -and
                $null -eq $scriptBlock.Parent) {
                return $candidate
            }
            $candidate = $scriptBlock
            continue
        }
        $candidate = $candidate.Parent
    }
    return $null
}

function Get-DirectParameterArgument {
    param(
        [Parameter(Mandatory = $true)][System.Management.Automation.Language.CommandAst] $Command,
        [Parameter(Mandatory = $true)][string] $Name
    )
    $elements = @($Command.CommandElements)
    for ($i = 0; $i -lt ($elements.Count - 1); $i++) {
        if ($elements[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and
            $elements[$i].ParameterName -ieq $Name) {
            if ($null -ne $elements[$i].Argument) {
                return $elements[$i].Argument
            }
            if ($elements[$i + 1] -isnot [System.Management.Automation.Language.CommandParameterAst]) {
                return $elements[$i + 1]
            }
        }
    }
    return $null
}

function Get-DirectCommandTargetArgument {
    param(
        [Parameter(Mandatory = $true)][System.Management.Automation.Language.CommandAst] $Command,
        [Parameter(Mandatory = $true)][string] $NamedParameter
    )
    $named = Get-DirectParameterArgument -Command $Command -Name $NamedParameter
    if ($null -ne $named) { return $named }

    $elements = @($Command.CommandElements)
    if ($elements.Count -gt 1 -and
        $elements[1] -isnot [System.Management.Automation.Language.CommandParameterAst]) {
        return $elements[1]
    }
    return $null
}

function Test-IsCanonicalLedgerPathArgument {
    param([AllowNull()][System.Management.Automation.Language.Ast] $Argument)
    if ($Argument -isnot [System.Management.Automation.Language.ParenExpressionAst]) {
        return $false
    }
    $commands = @($Argument.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst]
    }, $true))
    if ($commands.Count -ne 1) { return $false }

    $command = $commands[0]
    $commandName = $command.GetCommandName()
    $elements = @($command.CommandElements)
    if ($commandName -cne 'Join-Path' -or $elements.Count -ne 3) {
        return $false
    }
    if ($elements[1] -isnot [System.Management.Automation.Language.VariableExpressionAst] -or
        $elements[1].VariablePath.UserPath -cne 'RepoRoot' -or
        $elements[2] -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        return $false
    }
    $childPath = $elements[2].Value -replace '\\', '/'
    return $childPath -ceq 'scripts/self-referential-bootstrap-ledger.json'
}

function Test-IsCanonicalTableAccessorArgument {
    param([AllowNull()][System.Management.Automation.Language.Ast] $Argument)
    if ($Argument -isnot [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
        return $false
    }
    $scriptBlock = $Argument.ScriptBlock
    if ($null -eq $scriptBlock.ParamBlock -or
        $scriptBlock.ParamBlock.Parameters.Count -ne 2 -or
        $scriptBlock.ParamBlock.Parameters[0].Name.VariablePath.UserPath -cne 'b' -or
        $scriptBlock.ParamBlock.Parameters[1].Name.VariablePath.UserPath -cne 'label' -or
        $null -ne $scriptBlock.DynamicParamBlock -or
        $null -ne $scriptBlock.BeginBlock -or
        $null -ne $scriptBlock.ProcessBlock -or
        $null -eq $scriptBlock.EndBlock -or
        $scriptBlock.EndBlock.Statements.Count -ne 1 -or
        $scriptBlock.EndBlock.Traps.Count -ne 0) {
        return $false
    }

    $pipeline = $scriptBlock.EndBlock.Statements[0]
    if ($pipeline -isnot [System.Management.Automation.Language.PipelineAst] -or
        $pipeline.PipelineElements.Count -ne 1 -or
        $pipeline.PipelineElements[0] -isnot [System.Management.Automation.Language.CommandAst]) {
        return $false
    }
    $command = $pipeline.PipelineElements[0]
    $commandName = $command.GetCommandName()
    $bodyArg = Get-DirectParameterArgument -Command $command -Name 'Body'
    $labelArg = Get-DirectParameterArgument -Command $command -Name 'Label'
    return $commandName -ceq 'Get-MarkdownTableValue' -and
        $command.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Unknown -and
        $command.CommandElements.Count -eq 5 -and
        $bodyArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $bodyArg.VariablePath.UserPath -ceq 'b' -and
        $labelArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $labelArg.VariablePath.UserPath -ceq 'label'
}

function Test-IsAssertionAliasMutation {
    param([Parameter(Mandatory = $true)][System.Management.Automation.Language.CommandAst] $Command)
    $commandName = $Command.GetCommandName() -replace '^.*\\', ''
    if ($commandName -inotmatch '^(Set-Alias|New-Alias|sal|nal)$') { return $false }
    $target = Get-DirectCommandTargetArgument -Command $Command -NamedParameter 'Name'
    if ($target -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        # A dynamic alias target cannot be proven unrelated, so capability
        # detection fails closed rather than evaluating PowerShell.
        return $true
    }
    $targetName = $target.Value -replace '^(global|local|script|private):', ''
    return $targetName -ieq 'Assert-SelfReferentialBootstrapBody'
}

function Test-IsAssertionProviderMutation {
    param([Parameter(Mandatory = $true)][System.Management.Automation.Language.CommandAst] $Command)
    $commandName = $Command.GetCommandName() -replace '^.*\\', ''
    if ($commandName -imatch '^(New-Item|ni|Copy-Item|cpi|cp|copy|Rename-Item|rni|ren)$') {
        # New-Item can split a provider target across -Path/-Name, while copy
        # and rename target position 1 or a command-specific named parameter.
        # The trusted checker has no need for these commands, so any direct
        # root use before the assertion fails closed instead of implementing a
        # general PowerShell parameter binder.
        return $true
    }
    if ($commandName -inotmatch '^(Set-Item|Set-Content|si|sc)$') { return $false }
    $target = Get-DirectCommandTargetArgument -Command $Command -NamedParameter 'Path'
    if ($null -eq $target) {
        $target = Get-DirectCommandTargetArgument -Command $Command -NamedParameter 'LiteralPath'
    }
    if ($target -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        # As above, a dynamic provider path is not safe to classify as unrelated.
        return $true
    }
    return $target.Value -imatch '^(?:function|alias):[\\/]*(?:(?:global|local|script|private):)?Assert-SelfReferentialBootstrapBody$'
}

function ConvertTo-NormalizedSourceText {
    param([Parameter(Mandatory = $true)][string] $Text)
    return (($Text -replace '\s+', ' ').Trim())
}

function Get-AssignmentParentShape {
    param([Parameter(Mandatory = $true)][System.Management.Automation.Language.AssignmentStatementAst] $Assignment)
    $types = @()
    for ($parent = $Assignment.Parent; $null -ne $parent; $parent = $parent.Parent) {
        $types += $parent.GetType().Name
    }
    return ($types -join '>')
}

function Get-AssignmentIfShape {
    param([Parameter(Mandatory = $true)][System.Management.Automation.Language.AssignmentStatementAst] $Assignment)
    $parts = @()
    for ($parent = $Assignment.Parent; $null -ne $parent; $parent = $parent.Parent) {
        if ($parent -isnot [System.Management.Automation.Language.StatementBlockAst] -or
            $parent.Parent -isnot [System.Management.Automation.Language.IfStatementAst]) {
            continue
        }
        $ifAst = $parent.Parent
        $role = 'unknown'
        $condition = ''
        foreach ($clause in $ifAst.Clauses) {
            if ([object]::ReferenceEquals($clause.Item2, $parent)) {
                $role = 'if'
                $condition = ConvertTo-NormalizedSourceText -Text $clause.Item1.Extent.Text
                break
            }
        }
        if ([object]::ReferenceEquals($ifAst.ElseClause, $parent)) {
            $role = 'else'
            $condition = ConvertTo-NormalizedSourceText -Text $ifAst.Clauses[0].Item1.Extent.Text
        }
        $parts += ('{0}:{1}' -f $role, $condition)
    }
    if ($parts.Count -eq 0) { return '<none>' }
    return ($parts -join '>')
}

$dotSources = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        (Test-IsRootExecutableCommand -Command $node) -and
        $node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot -and
        $node.CommandElements.Count -gt 0 -and
        $node.CommandElements[0].Extent.Text -match 'self-referential-bootstrap\.ps1'
}, $true))
if ($dotSources.Count -eq 0) {
    Write-Output 'missing-dot-source'
    exit 0
}

$assertions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        (Test-IsRootExecutableCommand -Command $node) -and
        $node.GetCommandName() -ceq 'Assert-SelfReferentialBootstrapBody'
}, $true))
if ($assertions.Count -eq 0) {
    Write-Output 'missing-assertion'
    exit 0
}

$orderedAssertions = @($assertions | Where-Object {
    $assertion = $_
    @($dotSources | Where-Object {
        $_.Extent.StartOffset -lt $assertion.Extent.StartOffset
    }).Count -gt 0
})
if ($orderedAssertions.Count -eq 0) {
    Write-Output 'wrong-wiring-order'
    exit 0
}

# A same-scope function definition after the library load can shadow the real
# assertion while preserving the expected command spelling. Accept a candidate
# only when no root definition with that name occurs after its latest preceding
# bootstrap dot-source.
$assertionDefinitions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        (($node.Name -replace '^(global|local|script|private):', '') -ieq 'Assert-SelfReferentialBootstrapBody') -and
        ((Get-RootStatement -Node $node) -eq $node)
}, $true))
$assertionAliasMutations = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        (Test-IsRootExecutableCommand -Command $node) -and
        (Test-IsAssertionAliasMutation -Command $node)
}, $true))
$assertionProviderMutations = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        (Test-IsRootExecutableCommand -Command $node) -and
        (Test-IsAssertionProviderMutation -Command $node)
}, $true))
$unshadowedAssertions = @($orderedAssertions | Where-Object {
    $assertion = $_
    $latestDotSourceOffset = @($dotSources | Where-Object {
        $_.Extent.StartOffset -lt $assertion.Extent.StartOffset
    } | ForEach-Object { $_.Extent.StartOffset } | Measure-Object -Maximum)[0].Maximum
    @($assertionDefinitions | Where-Object {
        $_.Extent.StartOffset -gt $latestDotSourceOffset -and
            $_.Extent.StartOffset -lt $assertion.Extent.StartOffset
    }).Count -eq 0 -and
        @($assertionAliasMutations | Where-Object {
            $_.Extent.StartOffset -lt $assertion.Extent.StartOffset
        }).Count -eq 0 -and
        @($assertionProviderMutations | Where-Object {
            $_.Extent.StartOffset -lt $assertion.Extent.StartOffset
        }).Count -eq 0
})
if ($unshadowedAssertions.Count -eq 0) {
    Write-Output 'assertion-shadowed'
    exit 0
}
$assertions = $unshadowedAssertions

$hasPrNumberParameter = $null -ne $ast.ParamBlock -and
    @($ast.ParamBlock.Parameters | Where-Object {
        $_.Name.VariablePath.UserPath -ceq 'PrNumber'
    }).Count -gt 0
if (-not $hasPrNumberParameter) {
    Write-Output 'missing-prnumber-parameter'
    exit 0
}

$prBoundAssertions = @($assertions | Where-Object {
    $command = $_
    $elements = @($command.CommandElements)
    $hasPrNumberBinding = $false
    for ($i = 0; $i -lt ($elements.Count - 1); $i++) {
        if ($elements[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and
            $elements[$i].ParameterName -ceq 'PrNumber' -and
            $elements[$i + 1] -is [System.Management.Automation.Language.VariableExpressionAst] -and
            $elements[$i + 1].VariablePath.UserPath -ceq 'PrNumber') {
            $hasPrNumberBinding = $true
            break
        }
    }
    $hasPrNumberBinding
})
if ($prBoundAssertions.Count -eq 0) {
    Write-Output 'missing-prnumber-binding'
    exit 0
}

$fullyBoundAssertions = @($prBoundAssertions | Where-Object {
    $command = $_
    $bodyArg = Get-DirectParameterArgument -Command $command -Name 'Body'
    $changedPathsArg = Get-DirectParameterArgument -Command $command -Name 'ChangedPaths'
    $ledgerPathArg = Get-DirectParameterArgument -Command $command -Name 'LedgerPath'
    $getTableValueArg = Get-DirectParameterArgument -Command $command -Name 'GetTableValue'
    $baseLedgerJsonArg = Get-DirectParameterArgument -Command $command -Name 'BaseLedgerJson'
    $baseLedgerExistsArg = Get-DirectParameterArgument -Command $command -Name 'BaseLedgerExists'
    $hasBaseContextArg = Get-DirectParameterArgument -Command $command -Name 'HasBaseContext'
    $repoRootArg = Get-DirectParameterArgument -Command $command -Name 'RepoRoot'
    $baseShaArg = Get-DirectParameterArgument -Command $command -Name 'BaseSha'
    $headShaArg = Get-DirectParameterArgument -Command $command -Name 'HeadSha'

    $bodyArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $bodyArg.VariablePath.UserPath -ieq 'body' -and
        $changedPathsArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $changedPathsArg.VariablePath.UserPath -ieq 'changedPaths' -and
        (Test-IsCanonicalLedgerPathArgument -Argument $ledgerPathArg) -and
        (Test-IsCanonicalTableAccessorArgument -Argument $getTableValueArg) -and
        $baseLedgerJsonArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $baseLedgerJsonArg.VariablePath.UserPath -ieq 'baseLedgerJson' -and
        $baseLedgerExistsArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $baseLedgerExistsArg.VariablePath.UserPath -ieq 'baseLedgerExists' -and
        $hasBaseContextArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $hasBaseContextArg.VariablePath.UserPath -ieq 'hasBootstrapBaseContext' -and
        $repoRootArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $repoRootArg.VariablePath.UserPath -ieq 'RepoRoot' -and
        $baseShaArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $baseShaArg.VariablePath.UserPath -ieq 'BaseSha' -and
        $headShaArg -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $headShaArg.VariablePath.UserPath -ieq 'HeadSha'
})
if ($fullyBoundAssertions.Count -eq 0) {
    Write-Output 'missing-required-assertion-bindings'
    exit 0
}
$prBoundAssertions = $fullyBoundAssertions

# Reachability is measured against the earliest assertion that is BOTH ordered
# after the library and correctly PR-bound. An earlier unbound assertion must not
# hide a terminating statement before the real candidate.
$firstAssertionOffset = @($prBoundAssertions | ForEach-Object { $_.Extent.StartOffset } |
    Measure-Object -Minimum)[0].Minimum
$prNumberReassignments = @($ast.FindAll({
    param($node)
    if ($node -isnot [System.Management.Automation.Language.AssignmentStatementAst] -or
        $node.Extent.StartOffset -ge $firstAssertionOffset -or
        -not (Test-IsRootExecutableCommand -Command $node)) {
        return $false
    }
    return @($node.Left.FindAll({
        param($target)
        $target -is [System.Management.Automation.Language.VariableExpressionAst] -and
            (($target.VariablePath.UserPath -replace '^(global|local|script|private):', '') -ieq 'PrNumber')
    }, $true)).Count -gt 0
}, $true))
if ($prNumberReassignments.Count -gt 0) {
    Write-Output 'prnumber-reassigned'
    exit 0
}
$earlyRootTerminators = @($ast.FindAll({
    param($node)
    $isSuccessfulTerminator = (
        $node -is [System.Management.Automation.Language.ExitStatementAst] -or
        $node -is [System.Management.Automation.Language.ReturnStatementAst] -or
        $node -is [System.Management.Automation.Language.BreakStatementAst] -or
        $node -is [System.Management.Automation.Language.ContinueStatementAst])
    $isThrow = $node -is [System.Management.Automation.Language.ThrowStatementAst]
    if ((-not $isSuccessfulTerminator -and -not $isThrow) -or
        $node.Extent.StartOffset -ge $firstAssertionOffset) {
        return $false
    }
    $rootStatement = Get-RootStatement -Node $node
    if ($isSuccessfulTerminator) {
        # A function definition is inert by itself, but a root-level direct call
        # to that function executes an embedded exit and can end the checker with
        # success before the assertion. Track this bounded, statically resolvable
        # case without treating uncalled helper functions as unreachable wiring.
        if ($rootStatement -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
            if ($node -isnot [System.Management.Automation.Language.ExitStatementAst] -and
                $node -isnot [System.Management.Automation.Language.BreakStatementAst] -and
                $node -isnot [System.Management.Automation.Language.ContinueStatementAst]) {
                return $false
            }
            $functionName = $rootStatement.Name -replace '^(global|local|script|private):', ''
            return @($ast.FindAll({
                param($candidate)
                $candidate -is [System.Management.Automation.Language.CommandAst] -and
                    (Test-IsRootExecutableCommand -Command $candidate) -and
                    $candidate.Extent.StartOffset -gt $rootStatement.Extent.EndOffset -and
                    $candidate.Extent.StartOffset -lt $firstAssertionOffset -and
                    (($candidate.GetCommandName() -replace '^(global|local|script|private):', '') -ieq $functionName)
            }, $true)).Count -gt 0
        }
        return $null -ne $rootStatement -and
            $rootStatement -isnot [System.Management.Automation.Language.TypeDefinitionAst]
    }
    # Conditional validation throws are legitimate fail-closed guards. Reject
    # only explicit root/directly-executed throw shapes that make the checker
    # unconditionally unusable before the bootstrap assertion.
    return $rootStatement -is [System.Management.Automation.Language.ThrowStatementAst] -or
        $rootStatement -is [System.Management.Automation.Language.PipelineAst] -or
        $rootStatement -is [System.Management.Automation.Language.AssignmentStatementAst]
}, $true))
if ($earlyRootTerminators.Count -gt 0) {
    Write-Output 'early-root-termination'
    exit 0
}

# Binding the assertion to variables is insufficient if the checker can replace
# those variables (or their file-input provenance) before invocation. Require
# the exact, ordered root-script dataflow carried by this detector/checker pair.
# This deliberately fails closed when that dataflow is refactored: the base
# capability and its regression fixtures must be updated together.
$requiredRootParameters = @(
    'BodyPath', 'ChangedPathsPath', 'ChangedPathsNulDelimited',
    'RepoRoot', 'BaseSha', 'HeadSha', 'PrNumber'
)
$rootParameters = if ($null -eq $ast.ParamBlock) { @() } else {
    @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
}
$missingRootParameters = @($requiredRootParameters | Where-Object {
    -not ($rootParameters -ccontains $_)
})

$loadBearingVariables = @(
    'BodyPath', 'ChangedPathsPath', 'ChangedPathsNulDelimited',
    'scriptRepoRoot', 'RepoRoot', 'BaseSha', 'HeadSha', 'PrNumber',
    'body', 'pathBytes', 'pathText', 'changedPaths',
    'hasBootstrapBaseContext', 'baseLedgerJson', 'baseLedgerExists'
)
$loadBearingAssignments = @($ast.FindAll({
    param($node)
    if ($node -isnot [System.Management.Automation.Language.AssignmentStatementAst] -or
        $node.Extent.StartOffset -ge $firstAssertionOffset) {
        return $false
    }
    return @($node.Left.FindAll({
        param($target)
        $target -is [System.Management.Automation.Language.VariableExpressionAst] -and
            $loadBearingVariables -ccontains (
                $target.VariablePath.UserPath -replace '^(global|local|script|private):', '')
    }, $true)).Count -gt 0
}, $true) | Sort-Object { $_.Extent.StartOffset })

$expectedAssignmentText = @'
$scriptRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path|||NamedBlockAst>ScriptBlockAst|||<none>
$RepoRoot = $scriptRepoRoot|||StatementBlockAst>IfStatementAst>NamedBlockAst>ScriptBlockAst|||if:[string]::IsNullOrWhiteSpace($RepoRoot)
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path|||NamedBlockAst>ScriptBlockAst|||<none>
$body = Get-Content -LiteralPath $BodyPath -Raw|||NamedBlockAst>ScriptBlockAst|||<none>
$pathBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ChangedPathsPath).Path)|||StatementBlockAst>IfStatementAst>NamedBlockAst>ScriptBlockAst|||if:$ChangedPathsNulDelimited
$pathText = [Text.UTF8Encoding]::new($false, $true).GetString($pathBytes, 0, $pathBytes.Length - 1)|||StatementBlockAst>TryStatementAst>StatementBlockAst>IfStatementAst>NamedBlockAst>ScriptBlockAst|||if:$ChangedPathsNulDelimited
$changedPaths = @($pathText.Split([char]0))|||StatementBlockAst>IfStatementAst>NamedBlockAst>ScriptBlockAst|||if:$ChangedPathsNulDelimited
$changedPaths = @(Get-Content -LiteralPath $ChangedPathsPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })|||StatementBlockAst>IfStatementAst>NamedBlockAst>ScriptBlockAst|||else:$ChangedPathsNulDelimited
$hasBootstrapBaseContext = -not [string]::IsNullOrWhiteSpace($BaseSha)|||NamedBlockAst>ScriptBlockAst|||<none>
$baseLedgerJson = ''|||NamedBlockAst>ScriptBlockAst|||<none>
$baseLedgerExists = $false|||NamedBlockAst>ScriptBlockAst|||<none>
$baseLedgerExists = $true|||StatementBlockAst>IfStatementAst>StatementBlockAst>IfStatementAst>NamedBlockAst>ScriptBlockAst|||if:$LASTEXITCODE -eq 0>if:$hasBootstrapBaseContext
$baseLedgerJson = (& git -C $RepoRoot show "${BaseSha}:scripts/self-referential-bootstrap-ledger.json" 2>$null) -join "`n"|||StatementBlockAst>IfStatementAst>StatementBlockAst>IfStatementAst>NamedBlockAst>ScriptBlockAst|||if:$LASTEXITCODE -eq 0>if:$hasBootstrapBaseContext
'@
$expectedAssignmentSignatures = @($expectedAssignmentText -split "\r?\n" | Where-Object { $_ })
$actualAssignmentSignatures = @($loadBearingAssignments | ForEach-Object {
    '{0}|||{1}|||{2}' -f `
        (ConvertTo-NormalizedSourceText -Text $_.Extent.Text), `
        (Get-AssignmentParentShape -Assignment $_), `
        (Get-AssignmentIfShape -Assignment $_)
})

$assignmentProvenanceValid = $actualAssignmentSignatures.Count -eq $expectedAssignmentSignatures.Count
if ($assignmentProvenanceValid) {
    for ($i = 0; $i -lt $expectedAssignmentSignatures.Count; $i++) {
        if ($actualAssignmentSignatures[$i] -cne $expectedAssignmentSignatures[$i]) {
            $assignmentProvenanceValid = $false
            break
        }
    }
}

# Direct variable/provider mutators and ++/-- bypass AssignmentStatementAst.
# The trusted checker has no use for these before the bootstrap assertion, so
# reject the bounded mutation family rather than emulate PowerShell binding.
$inputMutationCommands = @($ast.FindAll({
    param($node)
    if ($node -isnot [System.Management.Automation.Language.CommandAst] -or
        $node.Extent.StartOffset -ge $firstAssertionOffset) {
        return $false
    }
    $commandName = $node.GetCommandName() -replace '^.*\\', ''
    return $commandName -imatch '^(Set-Variable|sv|set|New-Variable|nv|Clear-Variable|clv|Remove-Variable|rv|Set-Item|si|Set-Content|sc|Clear-Item|cli|Remove-Item|ri|rm|del|erase|rd|rmdir|New-Item|ni|Copy-Item|cpi|cp|copy|Rename-Item|rni|ren|Move-Item|mi|mv|move|Invoke-Expression|iex)$'
}, $true))
$inputUnaryMutations = @($ast.FindAll({
    param($node)
    if ($node -isnot [System.Management.Automation.Language.UnaryExpressionAst] -or
        $node.Extent.StartOffset -ge $firstAssertionOffset -or
        $node.TokenKind -notin @('PlusPlus', 'MinusMinus', 'PostfixPlusPlus', 'PostfixMinusMinus')) {
        return $false
    }
    return @($node.FindAll({
        param($target)
        $target -is [System.Management.Automation.Language.VariableExpressionAst] -and
            $loadBearingVariables -ccontains (
                $target.VariablePath.UserPath -replace '^(global|local|script|private):', '')
    }, $true)).Count -gt 0
}, $true))
$inputIndirectAssignments = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Extent.StartOffset -lt $firstAssertionOffset -and
        $node.Left -isnot [System.Management.Automation.Language.VariableExpressionAst]
}, $true))
$inputMemberMutations = @($ast.FindAll({
    param($node)
    if ($node -isnot [System.Management.Automation.Language.InvokeMemberExpressionAst] -or
        $node.Extent.StartOffset -ge $firstAssertionOffset) {
        return $false
    }
    if ($node.Member -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        # A computed method name cannot be proven non-mutating without running
        # PR-controlled PowerShell, so the capability fails closed.
        return $true
    }
    return ([string]$node.Member.Value) -imatch '^(Set|SetValue|Remove|RemoveAt|Clear|Add|Insert)$'
}, $true))

if ($missingRootParameters.Count -gt 0 -or
    -not $assignmentProvenanceValid -or
    $inputMutationCommands.Count -gt 0 -or
    $inputUnaryMutations.Count -gt 0 -or
    $inputIndirectAssignments.Count -gt 0 -or
    $inputMemberMutations.Count -gt 0) {
    Write-Output 'load-bearing-variable-provenance-invalid'
    exit 0
}

Write-Output 'complete'
POWERSHELL

native_ast_probe_path="$ast_probe_path"
native_base_checker_path="$base_checker_path"
if [[ "$pwsh_exe" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
  native_ast_probe_path="$(wslpath -w "$ast_probe_path")"
  native_base_checker_path="$(wslpath -w "$base_checker_path")"
elif [[ "$pwsh_exe" == *.exe ]] && command -v cygpath >/dev/null 2>&1; then
  native_ast_probe_path="$(cygpath -w "$ast_probe_path")"
  native_base_checker_path="$(cygpath -w "$base_checker_path")"
fi

ast_result="$("$pwsh_exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$native_ast_probe_path" -CheckerPath "$native_base_checker_path")"
ast_result="${ast_result//$'\r'/}"
case "$ast_result" in
  complete) ;;
  missing-dot-source)
    echo "incomplete: base checker does not dot-source the bootstrap library"
    exit 0
    ;;
  missing-assertion)
    echo "incomplete: base checker does not invoke the bootstrap assertion"
    exit 0
    ;;
  assertion-shadowed)
    echo "incomplete: base checker shadows the bootstrap assertion after dot-sourcing its library"
    exit 0
    ;;
  missing-prnumber-binding)
    echo "incomplete: base checker does not bind PrNumber in the bootstrap assertion"
    exit 0
    ;;
  missing-prnumber-parameter)
    echo "incomplete: base checker does not accept a root PrNumber parameter"
    exit 0
    ;;
  missing-required-assertion-bindings)
    echo "incomplete: base checker lacks required bootstrap assertion argument bindings"
    exit 0
    ;;
  prnumber-reassigned)
    echo "incomplete: base checker reassigns the PrNumber parameter before the bootstrap assertion"
    exit 0
    ;;
  early-root-termination)
    echo "incomplete: base checker can terminate at root before invoking the bootstrap assertion"
    exit 0
    ;;
  load-bearing-variable-provenance-invalid)
    echo "incomplete: base checker rebinds or lacks trusted provenance for bootstrap inputs"
    exit 0
    ;;
  wrong-wiring-order)
    echo "incomplete: base checker invokes the bootstrap assertion before dot-sourcing its library"
    exit 0
    ;;
  *)
    echo "base gate capability detection failed: unexpected AST result '$ast_result'" >&2
    exit 1
    ;;
esac

echo "complete"
