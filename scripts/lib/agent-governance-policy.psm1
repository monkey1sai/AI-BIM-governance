Set-StrictMode -Version Latest

# Agent Governance Policy — structural evaluation of repository governance rules.
#
# The rules this module evaluates are DATA (scripts/agent-governance-rules.json), not code.
# Adding a governance capability adds a rule row; it does not edit this module. Editing this
# module is a mechanism-surface change (docs/agents/self-referential-bootstrap.md §2.1); editing
# the rule data is not. That split is the whole point, and it only holds while the rule
# vocabulary stays closed — see Get-AgentGovernanceRuleKinds.
#
# Deliberately absent: a `regex_matches` rule kind. Asserting that another artifact's SOURCE TEXT
# contains a pattern is the erosion this module exists to remove: it makes a rephrase break a
# merge gate, and it expresses "every X has property P" as "P occurs N times". Structural rules
# (yaml_every) express the invariant directly, so adding a job or a step no longer reddens a gate
# that never meant to count anything.
#
# Public interface (four entry points):
#   New-AgentGovernanceSnapshot        - build the RepoSnapshotPort (git-backed by default)
#   Invoke-AgentGovernancePolicy       - evaluate rules against a snapshot -> verdict
#   Test-AgentGovernancePolicyRatchet  - compare head rules against base rules -> verdict
#   Get-AgentGovernanceRuleKinds       - the closed rule vocabulary

$script:AgentGovernanceRuleKinds = @(
    'file_exists'
    'json_schema'
    'json_node'
    'yaml_node'
    'yaml_every'
    'codeowners_owns'
)

$script:AgentGovernanceSeverities = @{ 'error' = 2; 'warning' = 1 }

$script:AgentGovernanceRetiredRequiredFields = @('rule_id', 'owner', 'reason', 'pr', 'retired_on')

# A mapping entry is a key followed by ':' and then either end-of-line or whitespace. Requiring the
# whitespace is what keeps 'https://example.com' a scalar instead of a key named 'https'.
$script:AgentGovernanceYamlEntryPattern = '^(?<key>"(?:[^"\\]|\\.)*"|''(?:[^'']|'''')*''|[^:#]+?)\s*:(?<rest>\s.*|)$'

#region RepoSnapshotPort

<#
.SYNOPSIS
    Build the RepoSnapshotPort: the seam between policy evaluation and the repository.

.DESCRIPTION
    Two operations, both parameterized by git ref so the ratchet can read the same rule file at
    the PR base and at head through one port:

        ReadText(path, ref)     -> file content, or $null when the path is absent at that ref
        ListTracked(glob, ref)  -> tracked paths matching glob at that ref

    An empty $Ref means the working tree. The defaults shell out to git; tests pass an in-memory
    adapter built from a hashtable keyed "<ref>:<path>". Two adapters, so this is a real seam:
    without it, testing this module would mean writing objects into the repository's own git
    object store, which is exactly the fixture cost that scripts/tests/test-self-referential-bootstrap.ps1
    pays today.
#>
function New-AgentGovernanceSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [scriptblock] $ReadText = $null,
        [scriptblock] $ListTracked = $null
    )

    $resolvedRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

    if ($null -eq $ReadText) {
        $ReadText = {
            param([string] $Path, [string] $Ref)

            if ([string]::IsNullOrWhiteSpace($Ref)) {
                $absolute = Join-Path $resolvedRoot $Path
                if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { return $null }
                return (Get-Content -LiteralPath $absolute -Raw -Encoding utf8)
            }

            $text = & git -C $resolvedRoot -c "safe.directory=$resolvedRoot" show "${Ref}:$Path" 2>$null
            if ($LASTEXITCODE -ne 0) { return $null }
            return ($text -join "`n")
        }.GetNewClosure()
    }

    if ($null -eq $ListTracked) {
        $ListTracked = {
            param([string] $Glob, [string] $Ref)

            $output = if ([string]::IsNullOrWhiteSpace($Ref)) {
                & git -C $resolvedRoot -c "safe.directory=$resolvedRoot" ls-files -- $Glob 2>$null
            } else {
                & git -C $resolvedRoot -c "safe.directory=$resolvedRoot" ls-tree -r --name-only $Ref -- $Glob 2>$null
            }
            if ($LASTEXITCODE -ne 0) { return @() }
            return @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        }.GetNewClosure()
    }

    return [pscustomobject]@{
        RepoRoot    = $resolvedRoot
        ReadText    = $ReadText
        ListTracked = $ListTracked
    }
}

<#
.SYNOPSIS
    In-memory RepoSnapshotPort adapter. The second adapter that makes the seam real.

.DESCRIPTION
    $Files is keyed "<ref>:<path>"; the working tree uses an empty ref, so ":AGENTS.md".
    Absent keys read back as $null, which is how rules observe a missing file.
#>
function New-AgentGovernanceFakeSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][hashtable] $Files
    )

    $snapshot = $Files.Clone()

    $readText = {
        param([string] $Path, [string] $Ref)

        $key = '{0}:{1}' -f $Ref, $Path
        if (-not $snapshot.ContainsKey($key)) { return $null }
        return [string]$snapshot[$key]
    }.GetNewClosure()

    $listTracked = {
        param([string] $Glob, [string] $Ref)

        $prefix = '{0}:' -f $Ref
        $pattern = ConvertTo-AgentGovernanceGlobRegex -Glob $Glob
        return @(
            $snapshot.Keys |
                Where-Object { $_.StartsWith($prefix, [System.StringComparison]::Ordinal) } |
                ForEach-Object { $_.Substring($prefix.Length) } |
                Where-Object { $_ -match $pattern } |
                Sort-Object
        )
    }.GetNewClosure()

    return [pscustomobject]@{
        RepoRoot    = '<in-memory>'
        ReadText    = $readText
        ListTracked = $listTracked
    }
}

function ConvertTo-AgentGovernanceGlobRegex {
    param([Parameter(Mandatory = $true)][string] $Glob)

    # Only the glob syntax git ls-files pathspecs actually use here: '*' within a path segment and
    # '**' across segments. Anything else is treated literally rather than guessed at.
    $escaped = [regex]::Escape($Glob)
    $escaped = $escaped.Replace('\*\*/', '(?:.*/)?')
    $escaped = $escaped.Replace('\*\*', '.*')
    $escaped = $escaped.Replace('\*', '[^/]*')
    return '^' + $escaped + '$'
}

function Read-AgentGovernanceText {
    param(
        [Parameter(Mandatory = $true)][pscustomobject] $Snapshot,
        [Parameter(Mandatory = $true)][string] $Path,
        [string] $Ref = ''
    )

    return & $Snapshot.ReadText $Path $Ref
}

#endregion

#region YAML subset reader

<#
.SYNOPSIS
    Parse the YAML subset this repository's workflow and issue-template files actually use.

.DESCRIPTION
    Supported: block mappings, block sequences, plain and quoted scalars, inline flow sequences,
    block scalars (| > with - + chomping), comments, one optional leading document marker.

    Everything else - anchors, aliases, tags, flow mappings, multi-document streams, merge keys,
    duplicate keys - throws. Fail closed, never partial: a construct we cannot read must redden the
    gate rather than silently evaluate to "nothing matched", because "nothing matched" and "the
    rule holds" would otherwise be indistinguishable. This mirrors the lifecycle-contract TS union
    scan, which fails closed on any union shape it does not recognize.

    Scalars stay strings. No YAML 1.1 type coercion, so the `on:` key stays the string "on" rather
    than becoming a boolean, and version numbers stay as written.
#>
function ConvertFrom-AgentGovernanceYaml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Text,
        [string] $Origin = '<yaml>'
    )

    $rawLines = @($Text -split "`r?`n")
    $lines = New-Object System.Collections.Generic.List[object]

    for ($i = 0; $i -lt $rawLines.Count; $i++) {
        $raw = $rawLines[$i]
        $lineNumber = $i + 1

        if ($raw -match '^\s*$') {
            $lines.Add([pscustomobject]@{ Kind = 'blank'; Indent = -1; Text = ''; Raw = $raw; Line = $lineNumber })
            continue
        }
        if ($raw -match '^\s*#') {
            $lines.Add([pscustomobject]@{ Kind = 'comment'; Indent = -1; Text = ''; Raw = $raw; Line = $lineNumber })
            continue
        }
        if ($raw -match '^(---|\.\.\.)\s*$') {
            if ($lineNumber -ne 1) {
                throw "agent_governance_yaml: $Origin line $lineNumber uses a document marker; multi-document streams are not supported."
            }
            $lines.Add([pscustomobject]@{ Kind = 'comment'; Indent = -1; Text = ''; Raw = $raw; Line = $lineNumber })
            continue
        }
        if ($raw -match "`t") {
            throw "agent_governance_yaml: $Origin line $lineNumber contains a tab; YAML forbids tabs in indentation."
        }

        $indent = ($raw.Length - $raw.TrimStart(' ').Length)
        $lines.Add([pscustomobject]@{ Kind = 'node'; Indent = $indent; Text = $raw.TrimStart(' '); Raw = $raw; Line = $lineNumber })
    }

    $cursor = [ref]0
    $node = Read-AgentGovernanceYamlNode -Lines $lines -Cursor $cursor -Indent 0 -Origin $Origin

    # Any node left unconsumed means the indentation did not nest the way we assumed.
    Skip-AgentGovernanceYamlFiller -Lines $lines -Cursor $cursor
    if ($cursor.Value -lt $lines.Count) {
        $stray = $lines[$cursor.Value]
        throw "agent_governance_yaml: $Origin line $($stray.Line) is not reachable from the document root; indentation is not a plain block structure."
    }

    return $node
}

function Skip-AgentGovernanceYamlFiller {
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[object]] $Lines,
        [Parameter(Mandatory = $true)][ref] $Cursor
    )

    while ($Cursor.Value -lt $Lines.Count -and $Lines[$Cursor.Value].Kind -ne 'node') {
        $Cursor.Value++
    }
}

function Read-AgentGovernanceYamlNode {
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[object]] $Lines,
        [Parameter(Mandatory = $true)][ref] $Cursor,
        [Parameter(Mandatory = $true)][int] $Indent,
        [Parameter(Mandatory = $true)][string] $Origin
    )

    Skip-AgentGovernanceYamlFiller -Lines $Lines -Cursor $Cursor
    if ($Cursor.Value -ge $Lines.Count) { return $null }

    $first = $Lines[$Cursor.Value]
    if ($first.Indent -lt $Indent) { return $null }

    if ($first.Text -match '^-(\s|$)') {
        return Read-AgentGovernanceYamlSequence -Lines $Lines -Cursor $Cursor -Indent $first.Indent -Origin $Origin
    }
    return Read-AgentGovernanceYamlMapping -Lines $Lines -Cursor $Cursor -Indent $first.Indent -Origin $Origin
}

function Read-AgentGovernanceYamlSequence {
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[object]] $Lines,
        [Parameter(Mandatory = $true)][ref] $Cursor,
        [Parameter(Mandatory = $true)][int] $Indent,
        [Parameter(Mandatory = $true)][string] $Origin
    )

    $items = New-Object System.Collections.Generic.List[object]

    while ($true) {
        Skip-AgentGovernanceYamlFiller -Lines $Lines -Cursor $Cursor
        if ($Cursor.Value -ge $Lines.Count) { break }

        $line = $Lines[$Cursor.Value]
        if ($line.Indent -lt $Indent) { break }
        if ($line.Indent -gt $Indent) {
            throw "agent_governance_yaml: $Origin line $($line.Line) is indented deeper than its sequence without a '-' marker."
        }
        if ($line.Text -notmatch '^-(\s|$)') { break }

        $rest = $line.Text.Substring(1)
        $restTrimmed = $rest.TrimStart(' ')

        if ([string]::IsNullOrEmpty($restTrimmed)) {
            # "-" alone: the item is the block on the following deeper-indented lines.
            $Cursor.Value++
            $items.Add((Read-AgentGovernanceYamlNode -Lines $Lines -Cursor $Cursor -Indent ($Indent + 1) -Origin $Origin))
            continue
        }

        if ($restTrimmed -match '^[|>][-+]?[0-9]*$') {
            throw "agent_governance_yaml: $Origin line $($line.Line) opens a block scalar directly as a sequence item; not supported."
        }

        $isBlock = ($restTrimmed -match $script:AgentGovernanceYamlEntryPattern) -or ($restTrimmed -match '^-(\s|$)')
        if (-not $isBlock) {
            # "- some-label": a plain scalar item. Nothing may be nested under it.
            $Cursor.Value++
            Skip-AgentGovernanceYamlFiller -Lines $Lines -Cursor $Cursor
            if ($Cursor.Value -lt $Lines.Count -and $Lines[$Cursor.Value].Indent -gt $Indent) {
                throw "agent_governance_yaml: $Origin line $($Lines[$Cursor.Value].Line) is nested under the scalar sequence item on line $($line.Line)."
            }
            $items.Add((ConvertFrom-AgentGovernanceYamlInline -Raw $restTrimmed -Origin $Origin -Line $line.Line))
            continue
        }

        # "- key: value" starts a block whose indent is the column of the first content character.
        # Rewriting the line in place lets the mapping reader consume the item's remaining keys,
        # which sit at that same column on the following lines.
        $itemIndent = $Indent + 1 + ($rest.Length - $restTrimmed.Length)
        $Lines[$Cursor.Value] = [pscustomobject]@{
            Kind   = 'node'
            Indent = $itemIndent
            Text   = $restTrimmed
            Raw    = $line.Raw
            Line   = $line.Line
        }
        $items.Add((Read-AgentGovernanceYamlNode -Lines $Lines -Cursor $Cursor -Indent $itemIndent -Origin $Origin))
    }

    return , $items.ToArray()
}

function Read-AgentGovernanceYamlMapping {
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[object]] $Lines,
        [Parameter(Mandatory = $true)][ref] $Cursor,
        [Parameter(Mandatory = $true)][int] $Indent,
        [Parameter(Mandatory = $true)][string] $Origin
    )

    $map = [ordered]@{}

    while ($true) {
        Skip-AgentGovernanceYamlFiller -Lines $Lines -Cursor $Cursor
        if ($Cursor.Value -ge $Lines.Count) { break }

        $line = $Lines[$Cursor.Value]
        if ($line.Indent -lt $Indent) { break }
        if ($line.Indent -gt $Indent) {
            throw "agent_governance_yaml: $Origin line $($line.Line) is indented deeper than the mapping it belongs to."
        }
        if ($line.Text -match '^-(\s|$)') { break }

        $match = [regex]::Match($line.Text, $script:AgentGovernanceYamlEntryPattern)
        if (-not $match.Success) {
            throw "agent_governance_yaml: $Origin line $($line.Line) is not a supported mapping entry: '$($line.Text)'."
        }

        $key = ConvertFrom-AgentGovernanceYamlScalar -Raw $match.Groups['key'].Value -Origin $Origin -Line $line.Line
        if ($map.Contains($key)) {
            throw "agent_governance_yaml: $Origin line $($line.Line) redefines key '$key'; duplicate keys are rejected rather than silently last-wins."
        }

        $valueText = $match.Groups['rest'].Value.Trim()
        $keyLineIndex = $Cursor.Value
        $Cursor.Value++

        if ($valueText -match '^[|>][-+]?[0-9]*$') {
            $map[$key] = Read-AgentGovernanceYamlBlockScalar -Lines $Lines -Cursor $Cursor -ParentIndent $Indent -Header $valueText -Origin $Origin
            continue
        }

        if ([string]::IsNullOrEmpty($valueText)) {
            $map[$key] = Read-AgentGovernanceYamlNode -Lines $Lines -Cursor $Cursor -Indent ($Indent + 1) -Origin $Origin
            continue
        }

        $map[$key] = ConvertFrom-AgentGovernanceYamlInline -Raw $valueText -Origin $Origin -Line $Lines[$keyLineIndex].Line
    }

    return $map
}

function Read-AgentGovernanceYamlBlockScalar {
    param(
        [Parameter(Mandatory = $true)][System.Collections.Generic.List[object]] $Lines,
        [Parameter(Mandatory = $true)][ref] $Cursor,
        [Parameter(Mandatory = $true)][int] $ParentIndent,
        [Parameter(Mandatory = $true)][string] $Header,
        [Parameter(Mandatory = $true)][string] $Origin
    )

    if ($Header -match '[0-9]') {
        throw "agent_governance_yaml: $Origin uses an explicit block-scalar indentation indicator ('$Header'); not supported."
    }

    $folded = $Header.StartsWith('>', [System.StringComparison]::Ordinal)
    $chomp = if ($Header.EndsWith('-', [System.StringComparison]::Ordinal)) { 'strip' }
             elseif ($Header.EndsWith('+', [System.StringComparison]::Ordinal)) { 'keep' }
             else { 'clip' }

    $collected = New-Object System.Collections.Generic.List[string]
    $blockIndent = -1

    while ($Cursor.Value -lt $Lines.Count) {
        $line = $Lines[$Cursor.Value]

        if ($line.Kind -ne 'node') {
            # Blank and comment lines belong to the block only if content follows at block indent.
            $collected.Add($line.Raw)
            $Cursor.Value++
            continue
        }
        if ($line.Indent -le $ParentIndent) { break }

        if ($blockIndent -lt 0) { $blockIndent = $line.Indent }
        if ($line.Indent -lt $blockIndent) {
            throw "agent_governance_yaml: $Origin line $($line.Line) is less indented than the block scalar it opened."
        }

        $collected.Add($line.Raw)
        $Cursor.Value++
    }

    # Trailing blank/comment lines captured past the end of the block belong to the next node.
    while ($collected.Count -gt 0 -and $collected[$collected.Count - 1] -match '^\s*$') {
        $collected.RemoveAt($collected.Count - 1)
        $Cursor.Value--
    }

    if ($blockIndent -lt 0) { return '' }

    $body = @($collected | ForEach-Object {
        if ($_.Length -ge $blockIndent) { $_.Substring($blockIndent) } else { $_.TrimStart(' ') }
    })

    $joined = if ($folded) {
        ($body -join ' ').Trim()
    } else {
        $body -join "`n"
    }

    switch ($chomp) {
        'strip' { return $joined.TrimEnd("`n") }
        'keep'  { return $joined + "`n" }
        default { return $joined.TrimEnd("`n") + "`n" }
    }
}

function ConvertFrom-AgentGovernanceYamlInline {
    param(
        [Parameter(Mandatory = $true)][string] $Raw,
        [Parameter(Mandatory = $true)][string] $Origin,
        [Parameter(Mandatory = $true)][int] $Line
    )

    $value = $Raw.Trim()

    if ($value.StartsWith('{', [System.StringComparison]::Ordinal)) {
        throw "agent_governance_yaml: $Origin line $Line uses a flow mapping; not supported."
    }
    if ($value.StartsWith('&', [System.StringComparison]::Ordinal) -or $value.StartsWith('*', [System.StringComparison]::Ordinal)) {
        throw "agent_governance_yaml: $Origin line $Line uses an anchor or alias; not supported."
    }
    if ($value.StartsWith('!', [System.StringComparison]::Ordinal)) {
        throw "agent_governance_yaml: $Origin line $Line uses an explicit tag; not supported."
    }

    if ($value.StartsWith('[', [System.StringComparison]::Ordinal)) {
        if (-not $value.EndsWith(']', [System.StringComparison]::Ordinal)) {
            throw "agent_governance_yaml: $Origin line $Line has an unterminated flow sequence."
        }
        $inner = $value.Substring(1, $value.Length - 2).Trim()
        if ([string]::IsNullOrEmpty($inner)) { return , @() }
        $parts = @($inner -split ',')
        return , @($parts | ForEach-Object { ConvertFrom-AgentGovernanceYamlScalar -Raw $_.Trim() -Origin $Origin -Line $Line })
    }

    return ConvertFrom-AgentGovernanceYamlScalar -Raw $value -Origin $Origin -Line $Line
}

<#
.SYNOPSIS
    Expand YAML double-quoted escape sequences left to right.

.DESCRIPTION
    Sequential string replacement cannot do this correctly - unescaping '\"' before '\\' turns the
    literal backslash-quote in '\\"' into a quote. Unknown escapes throw rather than passing
    through, so a scalar we cannot read reddens the rule instead of comparing wrongly.
#>
function Expand-AgentGovernanceYamlEscapes {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Inner,
        [Parameter(Mandatory = $true)][string] $Origin,
        [Parameter(Mandatory = $true)][int] $Line
    )

    $builder = New-Object System.Text.StringBuilder
    $index = 0

    while ($index -lt $Inner.Length) {
        $char = $Inner[$index]
        if ($char -ne '\') {
            [void]$builder.Append($char)
            $index++
            continue
        }

        $index++
        if ($index -ge $Inner.Length) {
            throw "agent_governance_yaml: $Origin line $Line ends with a dangling escape character."
        }

        $escape = $Inner[$index]
        $index++

        switch -CaseSensitive ($escape) {
            '0' { [void]$builder.Append([char]0) }
            'a' { [void]$builder.Append([char]7) }
            'b' { [void]$builder.Append([char]8) }
            't' { [void]$builder.Append("`t") }
            'n' { [void]$builder.Append("`n") }
            'v' { [void]$builder.Append([char]11) }
            'f' { [void]$builder.Append([char]12) }
            'r' { [void]$builder.Append("`r") }
            'e' { [void]$builder.Append([char]27) }
            ' ' { [void]$builder.Append(' ') }
            '"' { [void]$builder.Append('"') }
            '/' { [void]$builder.Append('/') }
            '\' { [void]$builder.Append('\') }
            'x' { [void]$builder.Append((Read-AgentGovernanceYamlCodePoint -Inner $Inner -Index ([ref]$index) -Width 2 -Origin $Origin -Line $Line)) }
            'u' { [void]$builder.Append((Read-AgentGovernanceYamlCodePoint -Inner $Inner -Index ([ref]$index) -Width 4 -Origin $Origin -Line $Line)) }
            'U' { [void]$builder.Append((Read-AgentGovernanceYamlCodePoint -Inner $Inner -Index ([ref]$index) -Width 8 -Origin $Origin -Line $Line)) }
            default {
                throw "agent_governance_yaml: $Origin line $Line uses an unsupported escape '\$escape'."
            }
        }
    }

    return $builder.ToString()
}

function Read-AgentGovernanceYamlCodePoint {
    param(
        [Parameter(Mandatory = $true)][string] $Inner,
        [Parameter(Mandatory = $true)][ref] $Index,
        [Parameter(Mandatory = $true)][int] $Width,
        [Parameter(Mandatory = $true)][string] $Origin,
        [Parameter(Mandatory = $true)][int] $Line
    )

    if ($Index.Value + $Width -gt $Inner.Length) {
        throw "agent_governance_yaml: $Origin line $Line has a truncated unicode escape."
    }

    $digits = $Inner.Substring($Index.Value, $Width)
    if ($digits -notmatch '^[0-9A-Fa-f]+$') {
        throw "agent_governance_yaml: $Origin line $Line has a malformed unicode escape '$digits'."
    }

    $Index.Value += $Width
    return [char]::ConvertFromUtf32([Convert]::ToInt32($digits, 16))
}

function ConvertFrom-AgentGovernanceYamlScalar {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Raw,
        [Parameter(Mandatory = $true)][string] $Origin,
        [Parameter(Mandatory = $true)][int] $Line
    )

    $value = $Raw.Trim()
    if ([string]::IsNullOrEmpty($value)) { return '' }

    if ($value.StartsWith('"', [System.StringComparison]::Ordinal)) {
        if ($value.Length -lt 2 -or -not $value.EndsWith('"', [System.StringComparison]::Ordinal)) {
            throw "agent_governance_yaml: $Origin line $Line has an unterminated double-quoted scalar."
        }
        return Expand-AgentGovernanceYamlEscapes -Inner $value.Substring(1, $value.Length - 2) -Origin $Origin -Line $Line
    }

    if ($value.StartsWith("'", [System.StringComparison]::Ordinal)) {
        if ($value.Length -lt 2 -or -not $value.EndsWith("'", [System.StringComparison]::Ordinal)) {
            throw "agent_governance_yaml: $Origin line $Line has an unterminated single-quoted scalar."
        }
        return $value.Substring(1, $value.Length - 2).Replace("''", "'")
    }

    # Plain scalar: an unquoted '#' preceded by whitespace opens a trailing comment.
    $commentMatch = [regex]::Match($value, '\s#')
    if ($commentMatch.Success) {
        $value = $value.Substring(0, $commentMatch.Index).TrimEnd()
    }
    return $value
}

#endregion

#region Pointer resolution

<#
.SYNOPSIS
    Resolve a dotted pointer against a parsed YAML or JSON node.

.DESCRIPTION
    Segments are separated by '.'; a numeric segment indexes a sequence. Returns a result object
    rather than throwing, because "the node is absent" is an ordinary rule outcome, not an error.
    Wildcards are deliberately unsupported - a rule that needs to talk about "every item" says so
    with yaml_every, which names the collection explicitly.
#>
function Resolve-AgentGovernancePointer {
    param(
        [Parameter(Mandatory = $true)][AllowNull()] $Node,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Pointer
    )

    if ([string]::IsNullOrEmpty($Pointer)) {
        return [pscustomobject]@{ Found = $true; Value = $Node }
    }

    $current = $Node
    foreach ($rawSegment in ($Pointer -split '\.')) {
        if ([string]::IsNullOrEmpty($rawSegment)) {
            return [pscustomobject]@{ Found = $false; Value = $null }
        }
        if ($null -eq $current) {
            return [pscustomobject]@{ Found = $false; Value = $null }
        }

        # "path_classes[id=powershell]" selects the one array element whose field equals the value.
        # Registries in this repo are arrays of objects keyed by an id field, so without this a rule
        # would have to name a positional index and break the moment the array is reordered.
        $segment = $rawSegment
        $selector = [regex]::Match($rawSegment, '^(?<name>[^\[\]]*)\[(?<field>[^\[\]=]+)=(?<value>[^\[\]]*)\]$')
        if ($selector.Success) {
            $segment = $selector.Groups['name'].Value
            if (-not [string]::IsNullOrEmpty($segment)) {
                $step = Resolve-AgentGovernancePointer -Node $current -Pointer $segment
                if (-not $step.Found) { return [pscustomobject]@{ Found = $false; Value = $null } }
                $current = $step.Value
            }
            if ($current -isnot [System.Array]) {
                return [pscustomobject]@{ Found = $false; Value = $null }
            }

            $field = $selector.Groups['field'].Value
            $wanted = $selector.Groups['value'].Value
            $selected = @($current | Where-Object {
                $_ -is [System.Collections.IDictionary] -and $_.Contains($field) -and ([string]$_[$field]) -ceq $wanted
            })
            # Ambiguity is a rule-authoring error, not a silent first-wins.
            if ($selected.Count -ne 1) { return [pscustomobject]@{ Found = $false; Value = $null } }
            $current = $selected[0]
            continue
        }

        if ($current -is [System.Collections.IDictionary]) {
            if (-not $current.Contains($segment)) {
                return [pscustomobject]@{ Found = $false; Value = $null }
            }
            $current = $current[$segment]
            continue
        }

        if ($current -is [System.Array]) {
            $index = 0
            if (-not [int]::TryParse($segment, [ref]$index)) {
                return [pscustomobject]@{ Found = $false; Value = $null }
            }
            if ($index -lt 0 -or $index -ge $current.Length) {
                return [pscustomobject]@{ Found = $false; Value = $null }
            }
            $current = $current[$index]
            continue
        }

        return [pscustomobject]@{ Found = $false; Value = $null }
    }

    return [pscustomobject]@{ Found = $true; Value = $current }
}

function Get-AgentGovernanceCollectionItems {
    param([Parameter(Mandatory = $true)][AllowNull()] $Node)

    if ($null -eq $Node) { return $null }
    if ($Node -is [System.Collections.IDictionary]) {
        return @($Node.Keys | ForEach-Object { [pscustomobject]@{ Name = [string]$_; Value = $Node[$_] } })
    }
    if ($Node -is [System.Array]) {
        $index = -1
        return @($Node | ForEach-Object { $index++; [pscustomobject]@{ Name = "[$index]"; Value = $_ } })
    }
    return $null
}

#endregion

#region CODEOWNERS reader

<#
.SYNOPSIS
    Parse CODEOWNERS into pattern/owner records.

.DESCRIPTION
    CODEOWNERS is line-oriented but genuinely structured: a path pattern followed by owners.
    Reading it as structure rather than grepping its text is what lets a rule say "the wildcard is
    owned by exactly this account" instead of "this file contains this string" - the latter passes
    just as happily when the line is commented out.
#>
function ConvertFrom-AgentGovernanceCodeowners {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string] $Text)

    $entries = New-Object System.Collections.Generic.List[object]

    foreach ($line in ($Text -split "`r?`n")) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrEmpty($trimmed)) { continue }
        if ($trimmed.StartsWith('#', [System.StringComparison]::Ordinal)) { continue }

        $fields = @($trimmed -split '\s+' | Where-Object { -not [string]::IsNullOrEmpty($_) })
        if ($fields.Count -lt 2) { continue }

        $entries.Add([pscustomobject]@{
            Pattern = $fields[0]
            Owners  = @($fields[1..($fields.Count - 1)])
        })
    }

    return , $entries.ToArray()
}

#endregion

#region Rule evaluation

function Get-AgentGovernanceRuleKinds {
    [CmdletBinding()]
    param()

    # A copy, not the module's own array: PowerShell arrays are references, and the pinned
    # vocabulary must not be mutable through its own accessor.
    # No leading comma either - callers wrap with @() themselves. Returning ,@(...) would hand back
    # a single-element array CONTAINING the array, which silently breaks any caller that enumerates.
    return $script:AgentGovernanceRuleKinds.Clone()
}

function New-AgentGovernanceFinding {
    param(
        # AllowEmptyString: a malformed retirement record with a blank rule_id must produce a
        # finding about itself, not crash the ratchet before it can report anything.
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $RuleId,
        [Parameter(Mandatory = $true)][string] $Severity,
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Detail
    )

    return [pscustomobject]@{
        rule_id  = $RuleId
        severity = $Severity
        code     = $Code
        detail   = $Detail
    }
}

# json_node and yaml_node take the same expectation vocabulary as a yaml_every `require` clause,
# so one shape is lifted out of the rule rather than each kind inventing its own field names.
function New-AgentGovernanceExpectation {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary] $Rule)

    $expectation = [ordered]@{ pointer = [string]$Rule['pointer'] }
    foreach ($optional in @('equals', 'one_of', 'contains', 'starts_with', 'exists', 'is_null')) {
        if ($Rule.Contains($optional)) { $expectation[$optional] = $Rule[$optional] }
    }
    return $expectation
}

function Test-AgentGovernanceExpectation {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary] $Expectation,
        [Parameter(Mandatory = $true)][AllowNull()] $Node,
        [Parameter(Mandatory = $true)][string] $Label
    )

    $pointer = if ($Expectation.Contains('pointer')) { [string]$Expectation['pointer'] } else { '' }
    $resolved = Resolve-AgentGovernancePointer -Node $Node -Pointer $pointer

    $exists = if ($Expectation.Contains('exists')) { [bool]$Expectation['exists'] } else { $true }
    if (-not $resolved.Found) {
        if (-not $exists) { return [pscustomobject]@{ Ok = $true; Detail = '' } }
        return [pscustomobject]@{ Ok = $false; Detail = "$Label has no '$pointer'" }
    }
    if (-not $exists) {
        return [pscustomobject]@{ Ok = $false; Detail = "$Label still has '$pointer'" }
    }

    # A declared-but-empty policy slot ("the key is present and null") is a different statement from
    # "the key is absent", and this repo uses the first deliberately - a null coverage percentage
    # means "we refuse to publish one", not "nobody thought about it".
    if ($Expectation.Contains('is_null')) {
        $wantNull = [bool]$Expectation['is_null']
        $isNull = ($null -eq $resolved.Value)
        if ($isNull -ne $wantNull) {
            $state = if ($isNull) { 'null' } else { "'$([string]$resolved.Value)'" }
            $wanted = if ($wantNull) { 'null' } else { 'a value' }
            return [pscustomobject]@{ Ok = $false; Detail = "$Label '$pointer' is $state, expected $wanted" }
        }
    }

    if ($Expectation.Contains('starts_with')) {
        $prefix = [string]$Expectation['starts_with']
        $actual = [string]$resolved.Value
        if (-not $actual.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            return [pscustomobject]@{ Ok = $false; Detail = "$Label '$pointer' does not start with '$prefix'" }
        }
    }

    if ($Expectation.Contains('equals')) {
        $expected = [string]$Expectation['equals']
        $actual = [string]$resolved.Value
        if ($actual -cne $expected) {
            return [pscustomobject]@{ Ok = $false; Detail = "$Label '$pointer' is '$actual', expected '$expected'" }
        }
    }

    if ($Expectation.Contains('one_of')) {
        $allowed = @($Expectation['one_of'] | ForEach-Object { [string]$_ })
        $actual = [string]$resolved.Value
        if ($allowed -cnotcontains $actual) {
            return [pscustomobject]@{ Ok = $false; Detail = "$Label '$pointer' is '$actual', expected one of: $($allowed -join ', ')" }
        }
    }

    if ($Expectation.Contains('contains')) {
        $needles = @($Expectation['contains'] | ForEach-Object { [string]$_ })
        $haystack = if ($resolved.Value -is [System.Array]) {
            @($resolved.Value | ForEach-Object { [string]$_ })
        } else {
            @([string]$resolved.Value)
        }
        foreach ($needle in $needles) {
            if ($haystack -cnotcontains $needle) {
                return [pscustomobject]@{ Ok = $false; Detail = "$Label '$pointer' does not contain '$needle'" }
            }
        }
    }

    return [pscustomobject]@{ Ok = $true; Detail = '' }
}

function Invoke-AgentGovernanceRule {
    param(
        [Parameter(Mandatory = $true)][pscustomobject] $Snapshot,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary] $Rule,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Ref
    )

    $findings = New-Object System.Collections.Generic.List[object]
    $ruleId = [string]$Rule['id']
    $severity = [string]$Rule['severity']
    $kind = [string]$Rule['kind']

    switch ($kind) {
        'file_exists' {
            foreach ($path in @($Rule['paths'])) {
                $text = Read-AgentGovernanceText -Snapshot $Snapshot -Path ([string]$path) -Ref $Ref
                if ($null -eq $text) {
                    $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'file.missing' -Detail "$path is absent"))
                }
            }
        }

        'json_schema' {
            $path = [string]$Rule['path']
            $schemaPath = [string]$Rule['schema']
            $text = Read-AgentGovernanceText -Snapshot $Snapshot -Path $path -Ref $Ref
            $schemaText = Read-AgentGovernanceText -Snapshot $Snapshot -Path $schemaPath -Ref $Ref

            if ($null -eq $text) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'file.missing' -Detail "$path is absent"))
            } elseif ($null -eq $schemaText) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'schema.missing' -Detail "$schemaPath is absent"))
            } else {
                # A schema replaced by '{}' constrains nothing; treat a vacuous schema as a failure
                # rather than a pass, matching the *.schema_vacuous rule in observed_architecture.
                $compactSchema = ($schemaText -replace '\s', '')
                if ($compactSchema -eq '{}' -or $compactSchema -eq 'true') {
                    $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'schema.vacuous' -Detail "$schemaPath imposes no constraints"))
                } elseif (-not (Test-Json -Json $text -Schema $schemaText -ErrorAction SilentlyContinue)) {
                    $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'schema.violation' -Detail "$path does not satisfy $schemaPath"))
                }
            }
        }

        'json_node' {
            $path = [string]$Rule['path']
            $text = Read-AgentGovernanceText -Snapshot $Snapshot -Path $path -Ref $Ref
            if ($null -eq $text) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'file.missing' -Detail "$path is absent"))
                break
            }

            $document = $null
            try {
                $document = $text | ConvertFrom-Json -AsHashtable
            } catch {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'json.unparsed' -Detail "$path is not valid JSON"))
                break
            }

            $outcome = Test-AgentGovernanceExpectation -Expectation (New-AgentGovernanceExpectation -Rule $Rule) -Node $document -Label $path
            if (-not $outcome.Ok) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'json.expectation' -Detail $outcome.Detail))
            }
        }

        'yaml_node' {
            $path = [string]$Rule['path']
            $document = Read-AgentGovernanceYamlDocument -Snapshot $Snapshot -Path $path -Ref $Ref -RuleId $ruleId -Severity $severity -Findings $findings
            if ($null -eq $document) { break }

            $outcome = Test-AgentGovernanceExpectation -Expectation (New-AgentGovernanceExpectation -Rule $Rule) -Node $document.Value -Label $path
            if (-not $outcome.Ok) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'yaml.expectation' -Detail $outcome.Detail))
            }
        }

        'yaml_every' {
            $path = [string]$Rule['path']
            $document = Read-AgentGovernanceYamlDocument -Snapshot $Snapshot -Path $path -Ref $Ref -RuleId $ruleId -Severity $severity -Findings $findings
            if ($null -eq $document) { break }

            $collectionPointer = [string]$Rule['collection']
            $resolved = Resolve-AgentGovernancePointer -Node $document.Value -Pointer $collectionPointer
            if (-not $resolved.Found) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'yaml.collection_missing' -Detail "$path has no '$collectionPointer'"))
                break
            }

            $items = Get-AgentGovernanceCollectionItems -Node $resolved.Value
            if ($null -eq $items) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'yaml.collection_not_iterable' -Detail "$path '$collectionPointer' is a scalar, not a collection"))
                break
            }
            # An empty collection satisfying a universal rule is almost always a pointer typo
            # rather than a real "no members" state, so it fails closed.
            if ($items.Count -eq 0) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'yaml.collection_empty' -Detail "$path '$collectionPointer' has no members"))
                break
            }

            $where = if ($Rule.Contains('where')) { $Rule['where'] } else { $null }
            $require = $Rule['require']
            $matched = 0

            foreach ($item in $items) {
                if ($null -ne $where) {
                    $filter = Test-AgentGovernanceExpectation -Expectation $where -Node $item.Value -Label "$path $collectionPointer.$($item.Name)"
                    if (-not $filter.Ok) { continue }
                }
                $matched++
                $outcome = Test-AgentGovernanceExpectation -Expectation $require -Node $item.Value -Label "$path $collectionPointer.$($item.Name)"
                if (-not $outcome.Ok) {
                    $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'yaml.every' -Detail $outcome.Detail))
                }
            }

            if ($matched -eq 0) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'yaml.where_matched_nothing' -Detail "$path '$collectionPointer' has no member matching the rule's where clause"))
            }
        }

        'codeowners_owns' {
            $path = [string]$Rule['path']
            $text = Read-AgentGovernanceText -Snapshot $Snapshot -Path $path -Ref $Ref
            if ($null -eq $text) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'file.missing' -Detail "$path is absent"))
                break
            }

            $entries = ConvertFrom-AgentGovernanceCodeowners -Text $text
            $pattern = [string]$Rule['pattern']
            $matchedEntry = @($entries | Where-Object { $_.Pattern -ceq $pattern })

            if ($matchedEntry.Count -eq 0) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'codeowners.pattern_missing' -Detail "$path has no rule for '$pattern'"))
                break
            }
            if ($matchedEntry.Count -gt 1) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'codeowners.pattern_duplicated' -Detail "$path declares '$pattern' $($matchedEntry.Count) times; the last one silently wins"))
                break
            }

            $actualOwners = @($matchedEntry[0].Owners)
            foreach ($owner in @($Rule['owners'])) {
                if ($actualOwners -cnotcontains [string]$owner) {
                    $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'codeowners.owner_missing' -Detail "$path '$pattern' is owned by [$($actualOwners -join ', ')], missing '$owner'"))
                }
            }

            if ($Rule.Contains('exactly') -and [bool]$Rule['exactly']) {
                $expected = @($Rule['owners'] | ForEach-Object { [string]$_ })
                foreach ($owner in $actualOwners) {
                    if ($expected -cnotcontains $owner) {
                        $findings.Add((New-AgentGovernanceFinding -RuleId $ruleId -Severity $severity -Code 'codeowners.owner_unexpected' -Detail "$path '$pattern' also grants '$owner'"))
                    }
                }
            }
        }

        default {
            throw "agent_governance_policy: rule '$ruleId' declares unknown kind '$kind'."
        }
    }

    # No leading comma: the caller wraps with @(). Returning ,$array would make the caller's foreach
    # see ONE item (the array), so every rule would contribute a single nested finding and the
    # error count would be per-rule instead of per-finding.
    return $findings.ToArray()
}

function Read-AgentGovernanceYamlDocument {
    param(
        [Parameter(Mandatory = $true)][pscustomobject] $Snapshot,
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string] $Ref,
        [Parameter(Mandatory = $true)][string] $RuleId,
        [Parameter(Mandatory = $true)][string] $Severity,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[object]] $Findings
    )

    $text = Read-AgentGovernanceText -Snapshot $Snapshot -Path $Path -Ref $Ref
    if ($null -eq $text) {
        $Findings.Add((New-AgentGovernanceFinding -RuleId $RuleId -Severity $Severity -Code 'file.missing' -Detail "$Path is absent"))
        return $null
    }

    try {
        $parsed = ConvertFrom-AgentGovernanceYaml -Text $text -Origin $Path
        return [pscustomobject]@{ Value = $parsed }
    } catch {
        # Fail closed: an unreadable document must redden the rule, never evaluate to "satisfied".
        $Findings.Add((New-AgentGovernanceFinding -RuleId $RuleId -Severity $Severity -Code 'yaml.unparsed' -Detail $_.Exception.Message))
        return $null
    }
}

<#
.SYNOPSIS
    Evaluate every rule against one repository snapshot.

.OUTPUTS
    status          - 'passed' when no error-severity finding was produced
    findings        - every finding, error and warning alike
    error_count     - error-severity findings
    warning_count   - warning-severity findings
    evaluated_count - rules actually evaluated (retired rules are skipped)
#>
function Invoke-AgentGovernancePolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][pscustomobject] $Snapshot,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary] $Rules,
        [string] $Ref = ''
    )

    Assert-AgentGovernanceRuleDocument -Rules $Rules

    $findings = New-Object System.Collections.Generic.List[object]
    $evaluated = 0

    foreach ($rule in @($Rules['rules'])) {
        $evaluated++
        foreach ($finding in @(Invoke-AgentGovernanceRule -Snapshot $Snapshot -Rule $rule -Ref $Ref)) {
            $findings.Add($finding)
        }
    }

    $errorCount = @($findings | Where-Object { $_.severity -eq 'error' }).Count
    $warningCount = @($findings | Where-Object { $_.severity -eq 'warning' }).Count
    $status = if ($errorCount -eq 0) { 'passed' } else { 'failed' }

    # ToArray(), not @($findings): wrapping an EMPTY List[object] in @() yields a value that makes
    # the [pscustomobject] cast throw "Argument types do not match", so the all-clear path is the
    # one that would break.
    return [pscustomobject]@{
        status          = $status
        findings        = $findings.ToArray()
        error_count     = $errorCount
        warning_count   = $warningCount
        evaluated_count = $evaluated
    }
}

function Assert-AgentGovernanceRuleDocument {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary] $Rules)

    if (-not $Rules.Contains('rules')) {
        throw 'agent_governance_policy: rule document has no "rules" array.'
    }

    $seen = New-Object System.Collections.Generic.HashSet[string]
    foreach ($rule in @($Rules['rules'])) {
        if ($rule -isnot [System.Collections.IDictionary]) {
            throw 'agent_governance_policy: every entry in "rules" must be an object.'
        }
        foreach ($field in @('id', 'kind', 'severity')) {
            if (-not $rule.Contains($field) -or [string]::IsNullOrWhiteSpace([string]$rule[$field])) {
                throw "agent_governance_policy: a rule is missing required field '$field'."
            }
        }
        $id = [string]$rule['id']
        if (-not $seen.Add($id)) {
            throw "agent_governance_policy: duplicate rule id '$id'."
        }
        if ($script:AgentGovernanceRuleKinds -cnotcontains [string]$rule['kind']) {
            throw "agent_governance_policy: rule '$id' declares unknown kind '$($rule['kind'])'."
        }
        if (-not $script:AgentGovernanceSeverities.ContainsKey([string]$rule['severity'])) {
            throw "agent_governance_policy: rule '$id' declares unknown severity '$($rule['severity'])'."
        }
    }
}

#endregion

#region Ratchet

<#
.SYNOPSIS
    Compare the head rule document against the PR base: rules may be added or tightened, never
    quietly removed or downgraded.

.DESCRIPTION
    Monotonic on two things, and deliberately only two:

      - the rule id set at head must be a superset of the base's
      - no rule may drop in severity (error -> warning)

    A removal is legal only when head declares it in `retired` with every ARCH-EXC-001 field
    present. Rule CONTENT is not compared here; that layer is PINNED_LOAD_BEARING in
    scripts/tests/test-agent-governance-policy.ps1, so loosening a load-bearing rule's body has to
    edit a test and therefore show up in the review diff.
#>
function Test-AgentGovernancePolicyRatchet {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary] $BaseRules,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary] $HeadRules
    )

    Assert-AgentGovernanceRuleDocument -Rules $BaseRules
    Assert-AgentGovernanceRuleDocument -Rules $HeadRules

    $findings = New-Object System.Collections.Generic.List[object]

    $baseById = [ordered]@{}
    foreach ($rule in @($BaseRules['rules'])) { $baseById[[string]$rule['id']] = $rule }

    $headById = [ordered]@{}
    foreach ($rule in @($HeadRules['rules'])) { $headById[[string]$rule['id']] = $rule }

    $retiredById = [ordered]@{}
    if ($HeadRules.Contains('retired')) {
        foreach ($entry in @($HeadRules['retired'])) {
            if ($entry -isnot [System.Collections.IDictionary]) {
                throw 'agent_governance_policy: every entry in "retired" must be an object.'
            }
            $retiredById[[string]$entry['rule_id']] = $entry
        }
    }

    foreach ($id in $baseById.Keys) {
        if ($headById.Contains($id)) {
            $baseSeverity = [string]$baseById[$id]['severity']
            $headSeverity = [string]$headById[$id]['severity']
            if ($script:AgentGovernanceSeverities[$headSeverity] -lt $script:AgentGovernanceSeverities[$baseSeverity]) {
                $findings.Add((New-AgentGovernanceFinding -RuleId $id -Severity 'error' -Code 'ratchet.severity_downgraded' `
                    -Detail "severity dropped from '$baseSeverity' to '$headSeverity' without a retirement record"))
            }
            continue
        }

        if (-not $retiredById.Contains($id)) {
            $findings.Add((New-AgentGovernanceFinding -RuleId $id -Severity 'error' -Code 'ratchet.rule_removed' `
                -Detail "rule present at base is absent at head and is not declared in 'retired'"))
            continue
        }

        $record = $retiredById[$id]
        $missing = @($script:AgentGovernanceRetiredRequiredFields | Where-Object {
            -not $record.Contains($_) -or [string]::IsNullOrWhiteSpace([string]$record[$_])
        })
        if ($missing.Count -gt 0) {
            $findings.Add((New-AgentGovernanceFinding -RuleId $id -Severity 'error' -Code 'ratchet.retirement_incomplete' `
                -Detail "retirement record is missing: $($missing -join ', ')"))
        }
    }

    # A retirement record for a rule that never existed at base is a paperwork error, and left
    # unchecked it becomes a place to pre-authorize future removals.
    foreach ($id in $retiredById.Keys) {
        if (-not $baseById.Contains($id)) {
            $findings.Add((New-AgentGovernanceFinding -RuleId $id -Severity 'error' -Code 'ratchet.retirement_unknown_rule' `
                -Detail "retirement record names a rule that does not exist at the PR base"))
        }
    }

    $errorCount = @($findings | Where-Object { $_.severity -eq 'error' }).Count
    $status = if ($errorCount -eq 0) { 'passed' } else { 'failed' }

    return [pscustomobject]@{
        status      = $status
        findings    = $findings.ToArray()
        error_count = $errorCount
    }
}

#endregion

Export-ModuleMember -Function @(
    'New-AgentGovernanceSnapshot'
    'New-AgentGovernanceFakeSnapshot'
    'Invoke-AgentGovernancePolicy'
    'Test-AgentGovernancePolicyRatchet'
    'Get-AgentGovernanceRuleKinds'
    'ConvertFrom-AgentGovernanceYaml'
    'ConvertTo-AgentGovernanceGlobRegex'
)
