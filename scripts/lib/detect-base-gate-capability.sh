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
$unshadowedAssertions = @($orderedAssertions | Where-Object {
    $assertion = $_
    $latestDotSourceOffset = @($dotSources | Where-Object {
        $_.Extent.StartOffset -lt $assertion.Extent.StartOffset
    } | ForEach-Object { $_.Extent.StartOffset } | Measure-Object -Maximum)[0].Maximum
    @($assertionDefinitions | Where-Object {
        $_.Extent.StartOffset -gt $latestDotSourceOffset -and
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
  prnumber-reassigned)
    echo "incomplete: base checker reassigns the PrNumber parameter before the bootstrap assertion"
    exit 0
    ;;
  early-root-termination)
    echo "incomplete: base checker can terminate at root before invoking the bootstrap assertion"
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
