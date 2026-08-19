# Align HTML-Derived Design Gate Contract Implementation Plan

> **Implementation authorization:** This plan does not authorize implementation. After the user reviews the plan, obtain explicit follow-up authorization before invoking subagent-driven-development, executing-plans, or any other implementation skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可機器驗證的 closed design-gate policy 與 Git ref-bound HTML source collection，讓兩份 tracked `docs/plans/*.html` 成為唯一、可重播的 design source inventory，且 engineering pins 不再只活在 manifest 裡。

**Architecture:** `scripts/config/design-gate-policy.json` 是 closed、versioned、無自我參照 digest 的 repo authority；PowerShell validator 以 exact failure code fail-closed。Source collector 只接受 Git index/tree 列出的 `docs/plans/*.html`，對 raw Git blob bytes 算 SHA-256，base/head 用等價 tree query（禁止 working-tree directory scan，也禁止 `git ls-tree` pathspec glob `docs/plans/*.html`，該 glob 在本 checkout 對 `.dc.html` 回傳空集合）。本 change 不接 consumer、不改 gate classifier、不寫 manifest/golden/baseline/capture/rebaseline。

**Tech Stack:** PowerShell 7、JSON Draft-07（`Test-Json -SchemaFile`）、Git（`ls-files` / `ls-tree` / `cat-file blob` / `rev-parse`）、SHA-256、既有 `scripts/tests/test-helpers.ps1` assert 風格。

## Global Constraints

- 初版 policy MUST 保留目前已驗證值：Windows `windows-2025`、Node `20.20.2`、npm `10.9.4`、Playwright `1.61.1`、Chromium revision `1228`／version `149.0.7827.55`、DPR1、`1440x900`／`1920x1080`、`zh-TW`、`Asia/Taipei`、fonts-ready、animations-disabled、pixelmatch threshold `0.1`、anti-aliasing excluded、max diff ratio `0.01` 與 semantic parity `1.0`。
- The initial policy registry SHALL contain exactly: `ai-bim-frontend-backend-design` → `docs/plans/AI-BIM 前後端設計文件.dc.html` → `architecture_behavior`；`ai-bim-console-hifi` → `docs/plans/AI-BIM Console Hi-Fi.dc.html` → `console_hifi_visual`。
- Engineering policy SHALL be versioned at `scripts/config/design-gate-policy.json` under a closed schema and SHALL NOT contain a self-referential `policy_digest`.
- The design gate SHALL define its current HTML source set from the Git-tracked result of `git ls-files -- 'docs/plans/*.html'`. Base/head collection SHALL use the equivalent ref-bound Git tree query and SHALL NOT use a working-tree directory scan.
- Invalid policy schema, missing or unknown keys, duplicate source identity, unregistered or role-ambiguous sources, external paths, origin projections, untracked files, ignored files, or unresolved base/head collection SHALL fail closed.
- The validator SHALL NOT use PR prose, screenshots, caller-supplied digests, working-tree bytes, or manual booleans as authority.
- Manifest, golden, baseline, capture, and rebaseline surfaces SHALL remain read-only.
- 不修改兩份 HTML、`design-system-reference.manifest.json`、golden PNG、baseline、rebaseline、capture script 或 production UI。
- 不修改 `scripts/lib/design-system-gate.ps1` classifier、status enum 或 precedence。
- 不接線 PR-body、local preflight、gstack、visual-result 或其他 consumer。
- 不變更 API、data/event schema、DB、storage、session/conversion lifecycle、deployment 或 runtime ownership。
- 不處理 `migrate-console-to-hifi-design` 的 human-owner task、PR #535、lineage UI、GPU、Kit、WebRTC 或 DataChannel。
- GPU、Kit、WebRTC、first-frame、stage 與 DataChannel 對本 governance-only change 為 N/A；N/A 不得被報告為 runtime/product pass。
- Full-completion eligibility is fail-closed when any route is `reference_missing` or `routes_without_approved_pixel_reference` is non-empty. This change records that rule in policy; it does not grant successful eligibility.
- `semantic_parity_required` 以 JSON number `1.0` 寫入，比較時必須與 `1` 相等（`[double]$value -eq 1`）。
- 每個 OpenSpec checkbox 是獨立 commit／push boundary。本 plan 的 Task 1 = OpenSpec 1.1，Task 2 = OpenSpec 1.2。
- 本 change 不把新測試接到 `.github/workflows/agent-governance.yml` 或 `scripts/verification-manifest.json`（那是 consumer／gate-infrastructure wiring，屬後續 successor）。P3 以 focused `pwsh -File` 驗證。

---

## File structure

| Path | Responsibility |
|---|---|
| `scripts/config/design-gate-policy.json` | Canonical closed policy（exactly two sources + engineering pins + full-completion eligibility）. Create `scripts/config/`. |
| `scripts/tests/design-gate-policy.schema.json` | Draft-07 closed schema beside tests；`additionalProperties: false`；forbids `policy_digest`. |
| `scripts/lib/design-gate-policy.ps1` | `New-DesignGateError`、`Test-DesignGatePolicy`. Exact failure codes. Does not edit `design-system-gate.ps1`. |
| `scripts/tests/test-design-gate-policy.ps1` | Schema + validator behaviour tests. |
| `scripts/tests/fixtures/design-gate-policy/*.json` | Valid policy + fail-closed fixtures. |
| `scripts/lib/design-gate-source-collector.ps1` | Ref-bound collector. Dotsources the policy validator. |
| `scripts/tests/test-design-gate-source-collector.ps1` | Current/base/head、deletion visibility、untrusted inputs、CRLF digest、excluded-file guard. |

Do not create or modify: `docs/plans/*.html`, `docs/plans/design-system-reference.manifest.json`, `docs/plans/design-system-baseline/**`, `web-viewer-sample/scripts/capture-design-system-reference.mjs`, rebaseline scripts, production UI, runtime, API, data, storage, session, or `scripts/lib/design-system-gate.ps1`.

### Verified Git source-set fact (2026-08-19, HEAD `d72f3a66e738a8f1654707185cc14d836dd26759`)

```text
git ls-files -- "docs/plans/*.html"
  docs/plans/AI-BIM Console Hi-Fi.dc.html
  docs/plans/AI-BIM 前後端設計文件.dc.html

git ls-tree -r --name-only HEAD -- "docs/plans/*.html"
  <empty>

git ls-tree -r --name-only HEAD -- docs/plans/ | Where-Object { $_ -like "*.html" }
  docs/plans/AI-BIM Console Hi-Fi.dc.html
  docs/plans/AI-BIM 前後端設計文件.dc.html

git ls-files --with-tree=HEAD -- "docs/plans/*.html"
  docs/plans/AI-BIM Console Hi-Fi.dc.html
  docs/plans/AI-BIM 前後端設計文件.dc.html
```

Collector for a named ref MUST NOT pass `docs/plans/*.html` as an `ls-tree` pathspec. Use `git ls-tree -r --name-only <ref> -- docs/plans/` and keep paths whose suffix is `.html`, or `git ls-files --with-tree=<ref> -- 'docs/plans/*.html'`.

### Closed failure codes

Policy validator (`Test-DesignGatePolicy`) throws `InvalidOperationException` whose `Message` is exactly `{code}: {detail}`:

| Code | When |
|---|---|
| `policy.missing` | Policy file absent |
| `policy.unparsed` | Not valid JSON |
| `policy.digest_forbidden` | `policy_digest` present（checked before generic unknown-key） |
| `policy.unknown_key` | Any other key outside the closed set |
| `policy.missing_key` | Required key absent |
| `policy.schema_version_unsupported` | `schema_version` is not `design-gate-policy/v1` |
| `policy.wrong_type` | Wrong JSON type or closed-const mismatch（含錯誤 source pairing、錯誤 pin） |
| `policy.duplicate_source_id` | Repeated `source_id` |
| `policy.duplicate_source_path` | Repeated `path` |
| `policy.duplicate_source_role` | Repeated `source_role` |

Check order: missing file → unparsed → `policy_digest` → unknown key → missing key → schema_version type → schema_version value → nested types/consts → duplicate id → duplicate path → duplicate role → `Test-Json` belt.

Source collector (`Get-DesignGateSourceCollection`) uses the same throw shape:

| Code | When |
|---|---|
| `source.unresolved_ref` | Ref/blob cannot be resolved |
| `source.working_tree_bytes_forbidden` | `-HashWorkingTreeBytes` bound |
| `source.caller_digest_forbidden` | `-CallerDigest` bound |
| `source.pr_prose_forbidden` | `-PrProse` bound |
| `source.screenshot_forbidden` | `-ScreenshotPath` bound |
| `source.manual_boolean_forbidden` | `-ManualBoolean` bound |
| `source.external` | Absolute path outside the repo and not the design origin |
| `source.origin_projected` | Path under `C:\Repos\design\desigin-system` |
| `source.untracked` | Candidate is in-repo, not ignored, not Git-tracked |
| `source.ignored` | Candidate is ignored |
| `source.unregistered` | Tracked HTML path is not in the policy registry |
| `source.role_ambiguous` | Candidate assigns a role that is not the unique registered role for that path |
| `source.renamed` | Registered path is base-only and an unregistered HTML path appears in head |
| `source.deleted_from_head` | Registered source exists in base and is absent in head（仍須出現在 collection result） |

On every throw path, `successful_eligibility` is not returned. On success, the object includes `successful_eligibility = $false`（this change never grants full-completion）.

---

### Task 1: Closed design-gate policy

OpenSpec 1.1. Independent commit/push boundary.

**Files:**
- Create: `scripts/config/design-gate-policy.json`
- Create: `scripts/tests/design-gate-policy.schema.json`
- Create: `scripts/lib/design-gate-policy.ps1`
- Create: `scripts/tests/test-design-gate-policy.ps1`
- Create: `scripts/tests/fixtures/design-gate-policy/valid.json`
- Create: `scripts/tests/fixtures/design-gate-policy/missing-key.json`
- Create: `scripts/tests/fixtures/design-gate-policy/unknown-key.json`
- Create: `scripts/tests/fixtures/design-gate-policy/unsupported-schema.json`
- Create: `scripts/tests/fixtures/design-gate-policy/wrong-type.json`
- Create: `scripts/tests/fixtures/design-gate-policy/policy-digest.json`
- Create: `scripts/tests/fixtures/design-gate-policy/duplicate-source-id.json`
- Create: `scripts/tests/fixtures/design-gate-policy/duplicate-source-path.json`
- Create: `scripts/tests/fixtures/design-gate-policy/duplicate-source-role.json`
- Create: `scripts/tests/fixtures/design-gate-policy/malformed.json`

**Interfaces:**
- Consumes: none from later tasks. Reads only the policy JSON + schema path.
- Produces:
  - `function New-DesignGateError { param([string]$Code, [string]$Message) }` — throws `[System.InvalidOperationException]` with `Message = "$Code: $Message"`.
  - `function Test-DesignGatePolicy { param([Parameter(Mandatory=$true)][string]$PolicyPath, [Parameter(Mandatory=$true)][string]$SchemaPath) }` — throws on fail; returns `ConvertFrom-Json` PSCustomObject on success. `$SchemaPath` is mandatory so fixture paths cannot infer the schema.
  - Canonical policy object shape in the JSON block below. Task 2 MUST call `Test-DesignGatePolicy` before collecting sources.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/test-design-gate-policy.ps1` with this complete file. Do not create the validator, schema, fixtures, or canonical policy yet.

```powershell
#requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$validatorPath = Join-Path $repoRoot 'scripts\lib\design-gate-policy.ps1'
$schemaPath = Join-Path $repoRoot 'scripts\tests\design-gate-policy.schema.json'
$canonicalPath = Join-Path $repoRoot 'scripts\config\design-gate-policy.json'
$fixtureRoot = Join-Path $PSScriptRoot 'fixtures\design-gate-policy'

Assert-True (Test-Path -LiteralPath $validatorPath -PathType Leaf) 'scripts/lib/design-gate-policy.ps1 exists'
Assert-True (Test-Path -LiteralPath $schemaPath -PathType Leaf) 'scripts/tests/design-gate-policy.schema.json exists'
Assert-True (Test-Path -LiteralPath $canonicalPath -PathType Leaf) 'scripts/config/design-gate-policy.json exists'

. $validatorPath

function Assert-PolicyCode {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    $message = ''
    try {
        & $Action | Out-Null
    } catch {
        $failed = $true
        $message = [string]$_.Exception.Message
    }
    Assert-True $failed "$Context was expected to throw"
    Assert-True ($message.StartsWith("${Code}:", [System.StringComparison]::Ordinal)) `
        "$Context expected prefix '${Code}:' actual='$message'"
}

$canonicalBytes = [System.IO.File]::ReadAllBytes($canonicalPath)
Assert-True ($canonicalBytes.Length -gt 0 -and $canonicalBytes[0] -eq 0x7B) 'canonical policy is UTF-8 without BOM'
$canonicalRaw = [System.Text.Encoding]::UTF8.GetString($canonicalBytes)
Assert-True ($canonicalRaw -notmatch '"policy_digest"') 'canonical policy does not contain policy_digest'
Assert-True ($canonicalRaw | Test-Json -SchemaFile $schemaPath) 'canonical policy satisfies the closed schema'

$validRaw = Get-Content -LiteralPath (Join-Path $fixtureRoot 'valid.json') -Raw -Encoding utf8
Assert-True ($validRaw | Test-Json -SchemaFile $schemaPath) 'valid fixture satisfies the closed schema'
$canonicalHash = (Get-FileHash -LiteralPath $canonicalPath -Algorithm SHA256).Hash
$validHash = (Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'valid.json') -Algorithm SHA256).Hash
Assert-Equal $canonicalHash $validHash 'valid fixture is byte-identical to the canonical policy'

foreach ($case in @(
    @{ File = 'missing-key.json'; Why = 'missing required key' },
    @{ File = 'unknown-key.json'; Why = 'unknown key' },
    @{ File = 'unsupported-schema.json'; Why = 'unsupported schema_version' },
    @{ File = 'wrong-type.json'; Why = 'wrong type' },
    @{ File = 'policy-digest.json'; Why = 'self-referential policy_digest' },
    @{ File = 'duplicate-source-id.json'; Why = 'duplicate source_id' },
    @{ File = 'duplicate-source-path.json'; Why = 'duplicate path' },
    @{ File = 'duplicate-source-role.json'; Why = 'duplicate source_role' },
    @{ File = 'malformed.json'; Why = 'malformed JSON' }
)) {
    $json = Get-Content -LiteralPath (Join-Path $fixtureRoot $case.File) -Raw -Encoding utf8
    $schemaOk = $false
    try { $schemaOk = $json | Test-Json -SchemaFile $schemaPath } catch { $schemaOk = $false }
    Assert-True (-not $schemaOk) "schema rejects $($case.Why)"
}

$policy = Test-DesignGatePolicy -PolicyPath $canonicalPath -SchemaPath $schemaPath
Assert-Equal 'design-gate-policy/v1' ([string]$policy.schema_version) 'schema_version'
$sources = @($policy.sources)
Assert-Equal 2 $sources.Count 'exactly two sources'
Assert-Equal 'ai-bim-frontend-backend-design' ([string]$sources[0].source_id) 'source 0 id'
Assert-Equal 'docs/plans/AI-BIM 前後端設計文件.dc.html' ([string]$sources[0].path) 'source 0 path'
Assert-Equal 'architecture_behavior' ([string]$sources[0].source_role) 'source 0 role'
Assert-Equal 'ai-bim-console-hifi' ([string]$sources[1].source_id) 'source 1 id'
Assert-Equal 'docs/plans/AI-BIM Console Hi-Fi.dc.html' ([string]$sources[1].path) 'source 1 path'
Assert-Equal 'console_hifi_visual' ([string]$sources[1].source_role) 'source 1 role'

$eng = $policy.engineering
Assert-Equal 'windows' ([string]$eng.platform) 'platform'
Assert-Equal 'chromium' ([string]$eng.browser) 'browser'
Assert-Equal 'windows-2025' ([string]$eng.ci_runner_label) 'ci_runner_label'
Assert-Equal '20.20.2' ([string]$eng.node_version) 'node_version'
Assert-Equal '10.9.4' ([string]$eng.npm_version) 'npm_version'
Assert-Equal '1.61.1' ([string]$eng.playwright_version) 'playwright_version'
Assert-Equal '1228' ([string]$eng.chromium_revision) 'chromium_revision'
Assert-Equal '149.0.7827.55' ([string]$eng.chromium_version) 'chromium_version'
Assert-True ([double]$eng.device_scale_factor -eq 1) 'DPR1'
Assert-Equal 'zh-TW' ([string]$eng.locale) 'locale'
Assert-Equal 'Asia/Taipei' ([string]$eng.timezone) 'timezone'
Assert-True ([bool]$eng.fonts_ready_required) 'fonts_ready_required'
Assert-True ([bool]$eng.animations_disabled) 'animations_disabled'
$viewportIds = @($eng.viewports | ForEach-Object { [string]$_.id })
Assert-True (($viewportIds -join '|') -eq '1440x900|1920x1080') 'viewport ids'
Assert-True ([double]$eng.pixelmatch_color_threshold -eq 0.1) 'pixelmatch 0.1'
Assert-True (-not [bool]$eng.include_antialiasing) 'anti-aliasing excluded'
Assert-True ([double]$eng.max_diff_pixel_ratio -eq 0.01) 'max diff 0.01'
Assert-True ([double]$eng.semantic_parity_required -eq 1) 'semantic parity equals 1'
Assert-True (-not [bool]$policy.full_completion_eligibility.allow_when_any_route_is_reference_missing) 'full-completion denies reference_missing'
Assert-True (-not [bool]$policy.full_completion_eligibility.allow_when_routes_without_approved_pixel_reference_nonempty) 'full-completion denies nonempty missing-pixel list'

Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'missing.json') -SchemaPath $schemaPath } 'policy.missing' 'absent file'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'malformed.json') -SchemaPath $schemaPath } 'policy.unparsed' 'malformed JSON'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'policy-digest.json') -SchemaPath $schemaPath } 'policy.digest_forbidden' 'policy_digest'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'unknown-key.json') -SchemaPath $schemaPath } 'policy.unknown_key' 'unknown key'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'missing-key.json') -SchemaPath $schemaPath } 'policy.missing_key' 'missing key'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'unsupported-schema.json') -SchemaPath $schemaPath } 'policy.schema_version_unsupported' 'unsupported schema'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'wrong-type.json') -SchemaPath $schemaPath } 'policy.wrong_type' 'wrong type'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'duplicate-source-id.json') -SchemaPath $schemaPath } 'policy.duplicate_source_id' 'duplicate id'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'duplicate-source-path.json') -SchemaPath $schemaPath } 'policy.duplicate_source_path' 'duplicate path'
Assert-PolicyCode { Test-DesignGatePolicy -PolicyPath (Join-Path $fixtureRoot 'duplicate-source-role.json') -SchemaPath $schemaPath } 'policy.duplicate_source_role' 'duplicate role'

$validatorText = Get-Content -LiteralPath $validatorPath -Raw -Encoding utf8
Assert-True ($validatorText -notmatch 'design-system-reference\.manifest\.json') 'policy validator does not read the manifest as authority'
Assert-True ($validatorText -notmatch 'policy_digest\s*=') 'validator does not invent a self-referential digest'

Write-Host '[test-design-gate-policy] passed — canonical policy plus closed-schema fail-closed fixtures'
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-design-gate-policy.ps1
```

Expected: FAIL with `ASSERT FAILED: scripts/lib/design-gate-policy.ps1 exists`. Do not continue if a different exception hides this assertion.

- [ ] **Step 3: Write the closed schema, fixtures, validator, and canonical policy**

Create `scripts/tests/design-gate-policy.schema.json` (UTF-8, no BOM):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://ai-bim-governance.local/schemas/design-gate-policy.json",
  "title": "Design gate closed engineering policy v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "sources", "engineering", "full_completion_eligibility"],
  "not": { "required": ["policy_digest"] },
  "properties": {
    "schema_version": { "const": "design-gate-policy/v1" },
    "sources": {
      "type": "array",
      "minItems": 2,
      "maxItems": 2,
      "uniqueItems": true,
      "items": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["source_id", "path", "source_role"],
            "properties": {
              "source_id": { "const": "ai-bim-frontend-backend-design" },
              "path": { "const": "docs/plans/AI-BIM 前後端設計文件.dc.html" },
              "source_role": { "const": "architecture_behavior" }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["source_id", "path", "source_role"],
            "properties": {
              "source_id": { "const": "ai-bim-console-hifi" },
              "path": { "const": "docs/plans/AI-BIM Console Hi-Fi.dc.html" },
              "source_role": { "const": "console_hifi_visual" }
            }
          }
        ]
      }
    },
    "engineering": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "platform",
        "browser",
        "ci_runner_label",
        "node_version",
        "npm_version",
        "playwright_version",
        "chromium_revision",
        "chromium_version",
        "device_scale_factor",
        "locale",
        "timezone",
        "fonts_ready_required",
        "animations_disabled",
        "viewports",
        "pixelmatch_color_threshold",
        "include_antialiasing",
        "max_diff_pixel_ratio",
        "semantic_parity_required"
      ],
      "properties": {
        "platform": { "const": "windows" },
        "browser": { "const": "chromium" },
        "ci_runner_label": { "const": "windows-2025" },
        "node_version": { "const": "20.20.2" },
        "npm_version": { "const": "10.9.4" },
        "playwright_version": { "const": "1.61.1" },
        "chromium_revision": { "const": "1228" },
        "chromium_version": { "const": "149.0.7827.55" },
        "device_scale_factor": { "const": 1 },
        "locale": { "const": "zh-TW" },
        "timezone": { "const": "Asia/Taipei" },
        "fonts_ready_required": { "const": true },
        "animations_disabled": { "const": true },
        "viewports": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "uniqueItems": true,
          "items": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "required": ["id", "width", "height"],
                "properties": {
                  "id": { "const": "1440x900" },
                  "width": { "const": 1440 },
                  "height": { "const": 900 }
                }
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": ["id", "width", "height"],
                "properties": {
                  "id": { "const": "1920x1080" },
                  "width": { "const": 1920 },
                  "height": { "const": 1080 }
                }
              }
            ]
          }
        },
        "pixelmatch_color_threshold": { "type": "number", "const": 0.1 },
        "include_antialiasing": { "const": false },
        "max_diff_pixel_ratio": { "type": "number", "const": 0.01 },
        "semantic_parity_required": { "type": "number", "const": 1 }
      }
    },
    "full_completion_eligibility": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "allow_when_any_route_is_reference_missing",
        "allow_when_routes_without_approved_pixel_reference_nonempty"
      ],
      "properties": {
        "allow_when_any_route_is_reference_missing": { "const": false },
        "allow_when_routes_without_approved_pixel_reference_nonempty": { "const": false }
      }
    }
  }
}
```

Create `scripts/config/design-gate-policy.json` and copy the same bytes to `scripts/tests/fixtures/design-gate-policy/valid.json`. Write UTF-8 without BOM. Use JSON number `1.0` for `semantic_parity_required` (numeric equality with `1` is required). Do not add `policy_digest`.

```json
{
  "schema_version": "design-gate-policy/v1",
  "sources": [
    {
      "source_id": "ai-bim-frontend-backend-design",
      "path": "docs/plans/AI-BIM 前後端設計文件.dc.html",
      "source_role": "architecture_behavior"
    },
    {
      "source_id": "ai-bim-console-hifi",
      "path": "docs/plans/AI-BIM Console Hi-Fi.dc.html",
      "source_role": "console_hifi_visual"
    }
  ],
  "engineering": {
    "platform": "windows",
    "browser": "chromium",
    "ci_runner_label": "windows-2025",
    "node_version": "20.20.2",
    "npm_version": "10.9.4",
    "playwright_version": "1.61.1",
    "chromium_revision": "1228",
    "chromium_version": "149.0.7827.55",
    "device_scale_factor": 1,
    "locale": "zh-TW",
    "timezone": "Asia/Taipei",
    "fonts_ready_required": true,
    "animations_disabled": true,
    "viewports": [
      {
        "id": "1440x900",
        "width": 1440,
        "height": 900
      },
      {
        "id": "1920x1080",
        "width": 1920,
        "height": 1080
      }
    ],
    "pixelmatch_color_threshold": 0.1,
    "include_antialiasing": false,
    "max_diff_pixel_ratio": 0.01,
    "semantic_parity_required": 1.0
  },
  "full_completion_eligibility": {
    "allow_when_any_route_is_reference_missing": false,
    "allow_when_routes_without_approved_pixel_reference_nonempty": false
  }
}
```

Negative fixtures are the canonical object with one mutation each. Start from the canonical JSON, then apply only the listed change.

`scripts/tests/fixtures/design-gate-policy/missing-key.json` — delete the top-level `sources` property.

`scripts/tests/fixtures/design-gate-policy/unknown-key.json` — add top-level `"extra": true`.

`scripts/tests/fixtures/design-gate-policy/unsupported-schema.json` — set `"schema_version": "design-gate-policy/v0"`.

`scripts/tests/fixtures/design-gate-policy/wrong-type.json` — set `"device_scale_factor": "1"` (string).

`scripts/tests/fixtures/design-gate-policy/policy-digest.json` — add top-level `"policy_digest": "0000000000000000000000000000000000000000000000000000000000000000"`.

`scripts/tests/fixtures/design-gate-policy/duplicate-source-id.json` — second source `source_id` becomes `ai-bim-frontend-backend-design` (keep the hifi path and `console_hifi_visual`).

`scripts/tests/fixtures/design-gate-policy/duplicate-source-path.json` — second source `path` becomes `docs/plans/AI-BIM 前後端設計文件.dc.html` (keep `ai-bim-console-hifi` and `console_hifi_visual`).

`scripts/tests/fixtures/design-gate-policy/duplicate-source-role.json` — second source `source_role` becomes `architecture_behavior` (keep hifi id and path).

`scripts/tests/fixtures/design-gate-policy/malformed.json`:

```text
{ not json
```

Create `scripts/lib/design-gate-policy.ps1` with this complete file:

```powershell
#requires -Version 7.0
Set-StrictMode -Version Latest

function New-DesignGateError {
    param(
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Message
    )
    throw [System.InvalidOperationException]::new("${Code}: ${Message}")
}

function Get-DesignGatePolicySchemaPath {
    param([Parameter(Mandatory = $true)][string] $RepoRoot)
    return (Join-Path $RepoRoot 'scripts\tests\design-gate-policy.schema.json')
}

function Test-DesignGateClosedString {
    param(
        [Parameter(Mandatory = $true)][AllowNull()]$Node,
        [Parameter(Mandatory = $true)][string] $Pointer,
        [Parameter(Mandatory = $true)][string] $Expected
    )
    if ($Node -isnot [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be a string."
    }
    if ([string]$Node -cne $Expected) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be '$Expected'."
    }
}

function Test-DesignGateClosedBool {
    param(
        [Parameter(Mandatory = $true)]$Node,
        [Parameter(Mandatory = $true)][string] $Pointer,
        [Parameter(Mandatory = $true)][bool] $Expected
    )
    if ($Node -isnot [bool]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be a boolean."
    }
    if ([bool]$Node -ne $Expected) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be $Expected."
    }
}

function Test-DesignGateClosedNumber {
    param(
        [Parameter(Mandatory = $true)]$Node,
        [Parameter(Mandatory = $true)][string] $Pointer,
        [Parameter(Mandatory = $true)][double] $Expected
    )
    if ($Node -isnot [ValueType] -or $Node -is [bool] -or $Node -is [char]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be a number."
    }
    if ([double]$Node -ne $Expected) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "$Pointer must be $Expected."
    }
}

function Test-DesignGatePolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $PolicyPath,
        [Parameter(Mandatory = $true)][string] $SchemaPath
    )

    if (-not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) {
        New-DesignGateError -Code 'policy.missing' -Message "policy file is absent: $PolicyPath"
    }

    $raw = Get-Content -LiteralPath $PolicyPath -Raw -Encoding utf8
    $document = $null
    try {
        $document = $raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    } catch {
        New-DesignGateError -Code 'policy.unparsed' -Message "policy is not valid JSON: $PolicyPath"
    }
    if ($document -isnot [System.Collections.IDictionary]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'policy root must be an object.'
    }

    if ($document.ContainsKey('policy_digest')) {
        New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden; closed policy has no self-referential digest.'
    }

    $allowedTop = @('schema_version', 'sources', 'engineering', 'full_completion_eligibility')
    foreach ($key in @($document.Keys)) {
        if ($key -notin $allowedTop) {
            New-DesignGateError -Code 'policy.unknown_key' -Message "unknown policy key '$key'."
        }
    }
    foreach ($required in $allowedTop) {
        if (-not $document.ContainsKey($required)) {
            New-DesignGateError -Code 'policy.missing_key' -Message "missing required policy key '$required'."
        }
    }

    if ($document['schema_version'] -isnot [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'schema_version must be a string.'
    }
    if ([string]$document['schema_version'] -cne 'design-gate-policy/v1') {
        New-DesignGateError -Code 'policy.schema_version_unsupported' -Message "unsupported schema_version '$($document['schema_version'])'."
    }

    $sources = $document['sources']
    if ($sources -isnot [System.Collections.IEnumerable] -or $sources -is [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'sources must be an array.'
    }
    $sourceList = @($sources)
    if ($sourceList.Count -ne 2) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'sources must contain exactly two registry entries.'
    }

    $ids = New-Object System.Collections.Generic.List[string]
    $paths = New-Object System.Collections.Generic.List[string]
    $roles = New-Object System.Collections.Generic.List[string]
    $allowedPairs = @(
        @{ source_id = 'ai-bim-frontend-backend-design'; path = 'docs/plans/AI-BIM 前後端設計文件.dc.html'; source_role = 'architecture_behavior' }
        @{ source_id = 'ai-bim-console-hifi'; path = 'docs/plans/AI-BIM Console Hi-Fi.dc.html'; source_role = 'console_hifi_visual' }
    )
    $sourceKeys = @('source_id', 'path', 'source_role')
    foreach ($entry in $sourceList) {
        if ($entry -isnot [System.Collections.IDictionary]) {
            New-DesignGateError -Code 'policy.wrong_type' -Message 'each sources[] entry must be an object.'
        }
        if ($entry.ContainsKey('policy_digest')) {
            New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden on sources[].'
        }
        foreach ($key in @($entry.Keys)) {
            if ($key -notin $sourceKeys) {
                New-DesignGateError -Code 'policy.unknown_key' -Message "unknown sources[] key '$key'."
            }
        }
        foreach ($required in $sourceKeys) {
            if (-not $entry.ContainsKey($required)) {
                New-DesignGateError -Code 'policy.missing_key' -Message "sources[] missing '$required'."
            }
            if ($entry[$required] -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$entry[$required])) {
                New-DesignGateError -Code 'policy.wrong_type' -Message "sources[].$required must be a non-empty string."
            }
        }
        $ids.Add([string]$entry['source_id'])
        $paths.Add([string]$entry['path'])
        $roles.Add([string]$entry['source_role'])
    }
    if ((@($ids | Group-Object | Where-Object Count -gt 1).Count) -gt 0) {
        New-DesignGateError -Code 'policy.duplicate_source_id' -Message 'source_id values must be unique.'
    }
    if ((@($paths | Group-Object | Where-Object Count -gt 1).Count) -gt 0) {
        New-DesignGateError -Code 'policy.duplicate_source_path' -Message 'source path values must be unique.'
    }
    if ((@($roles | Group-Object | Where-Object Count -gt 1).Count) -gt 0) {
        New-DesignGateError -Code 'policy.duplicate_source_role' -Message 'source_role values must be unique.'
    }
    foreach ($entry in $sourceList) {
        $matched = $false
        foreach ($pair in $allowedPairs) {
            if ([string]$entry['source_id'] -ceq $pair.source_id -and [string]$entry['path'] -ceq $pair.path -and [string]$entry['source_role'] -ceq $pair.source_role) {
                $matched = $true
            }
        }
        if (-not $matched) {
            New-DesignGateError -Code 'policy.wrong_type' -Message ("sources[] pairing '{0}' / '{1}' / '{2}' is not in the closed registry." -f $entry['source_id'], $entry['path'], $entry['source_role'])
        }
    }

    $engineering = $document['engineering']
    if ($engineering -isnot [System.Collections.IDictionary]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'engineering must be an object.'
    }
    $engineeringKeys = @(
        'platform', 'browser', 'ci_runner_label', 'node_version', 'npm_version',
        'playwright_version', 'chromium_revision', 'chromium_version', 'device_scale_factor',
        'locale', 'timezone', 'fonts_ready_required', 'animations_disabled', 'viewports',
        'pixelmatch_color_threshold', 'include_antialiasing', 'max_diff_pixel_ratio',
        'semantic_parity_required'
    )
    foreach ($key in @($engineering.Keys)) {
        if ($key -eq 'policy_digest') {
            New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden on engineering.'
        }
        if ($key -notin $engineeringKeys) {
            New-DesignGateError -Code 'policy.unknown_key' -Message "unknown engineering key '$key'."
        }
    }
    foreach ($required in $engineeringKeys) {
        if (-not $engineering.ContainsKey($required)) {
            New-DesignGateError -Code 'policy.missing_key' -Message "engineering missing '$required'."
        }
    }
    Test-DesignGateClosedString -Node $engineering['platform'] -Pointer 'engineering.platform' -Expected 'windows'
    Test-DesignGateClosedString -Node $engineering['browser'] -Pointer 'engineering.browser' -Expected 'chromium'
    Test-DesignGateClosedString -Node $engineering['ci_runner_label'] -Pointer 'engineering.ci_runner_label' -Expected 'windows-2025'
    Test-DesignGateClosedString -Node $engineering['node_version'] -Pointer 'engineering.node_version' -Expected '20.20.2'
    Test-DesignGateClosedString -Node $engineering['npm_version'] -Pointer 'engineering.npm_version' -Expected '10.9.4'
    Test-DesignGateClosedString -Node $engineering['playwright_version'] -Pointer 'engineering.playwright_version' -Expected '1.61.1'
    Test-DesignGateClosedString -Node $engineering['chromium_revision'] -Pointer 'engineering.chromium_revision' -Expected '1228'
    Test-DesignGateClosedString -Node $engineering['chromium_version'] -Pointer 'engineering.chromium_version' -Expected '149.0.7827.55'
    Test-DesignGateClosedNumber -Node $engineering['device_scale_factor'] -Pointer 'engineering.device_scale_factor' -Expected 1
    Test-DesignGateClosedString -Node $engineering['locale'] -Pointer 'engineering.locale' -Expected 'zh-TW'
    Test-DesignGateClosedString -Node $engineering['timezone'] -Pointer 'engineering.timezone' -Expected 'Asia/Taipei'
    Test-DesignGateClosedBool -Node $engineering['fonts_ready_required'] -Pointer 'engineering.fonts_ready_required' -Expected $true
    Test-DesignGateClosedBool -Node $engineering['animations_disabled'] -Pointer 'engineering.animations_disabled' -Expected $true
    Test-DesignGateClosedNumber -Node $engineering['pixelmatch_color_threshold'] -Pointer 'engineering.pixelmatch_color_threshold' -Expected 0.1
    Test-DesignGateClosedBool -Node $engineering['include_antialiasing'] -Pointer 'engineering.include_antialiasing' -Expected $false
    Test-DesignGateClosedNumber -Node $engineering['max_diff_pixel_ratio'] -Pointer 'engineering.max_diff_pixel_ratio' -Expected 0.01
    Test-DesignGateClosedNumber -Node $engineering['semantic_parity_required'] -Pointer 'engineering.semantic_parity_required' -Expected 1

    $viewports = $engineering['viewports']
    if ($viewports -isnot [System.Collections.IEnumerable] -or $viewports -is [string]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'engineering.viewports must be an array.'
    }
    $viewportList = @($viewports)
    if ($viewportList.Count -ne 2) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'engineering.viewports must contain exactly two entries.'
    }
    $expectedViewports = @(
        @{ id = '1440x900'; width = 1440; height = 900 }
        @{ id = '1920x1080'; width = 1920; height = 1080 }
    )
    for ($i = 0; $i -lt 2; $i++) {
        $viewport = $viewportList[$i]
        if ($viewport -isnot [System.Collections.IDictionary]) {
            New-DesignGateError -Code 'policy.wrong_type' -Message 'each viewport must be an object.'
        }
        foreach ($key in @($viewport.Keys)) {
            if ($key -notin @('id', 'width', 'height')) {
                New-DesignGateError -Code 'policy.unknown_key' -Message "unknown viewport key '$key'."
            }
        }
        foreach ($required in @('id', 'width', 'height')) {
            if (-not $viewport.ContainsKey($required)) {
                New-DesignGateError -Code 'policy.missing_key' -Message "viewport missing '$required'."
            }
        }
        Test-DesignGateClosedString -Node $viewport['id'] -Pointer "engineering.viewports[$i].id" -Expected $expectedViewports[$i].id
        Test-DesignGateClosedNumber -Node $viewport['width'] -Pointer "engineering.viewports[$i].width" -Expected $expectedViewports[$i].width
        Test-DesignGateClosedNumber -Node $viewport['height'] -Pointer "engineering.viewports[$i].height" -Expected $expectedViewports[$i].height
    }

    $eligibility = $document['full_completion_eligibility']
    if ($eligibility -isnot [System.Collections.IDictionary]) {
        New-DesignGateError -Code 'policy.wrong_type' -Message 'full_completion_eligibility must be an object.'
    }
    $eligibilityKeys = @(
        'allow_when_any_route_is_reference_missing',
        'allow_when_routes_without_approved_pixel_reference_nonempty'
    )
    foreach ($key in @($eligibility.Keys)) {
        if ($key -eq 'policy_digest') {
            New-DesignGateError -Code 'policy.digest_forbidden' -Message 'policy_digest is forbidden on full_completion_eligibility.'
        }
        if ($key -notin $eligibilityKeys) {
            New-DesignGateError -Code 'policy.unknown_key' -Message "unknown full_completion_eligibility key '$key'."
        }
    }
    foreach ($required in $eligibilityKeys) {
        if (-not $eligibility.ContainsKey($required)) {
            New-DesignGateError -Code 'policy.missing_key' -Message "full_completion_eligibility missing '$required'."
        }
        Test-DesignGateClosedBool -Node $eligibility[$required] -Pointer "full_completion_eligibility.$required" -Expected $false
    }

    if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) {
        New-DesignGateError -Code 'policy.missing' -Message "schema file is absent: $SchemaPath"
    }
    if (-not ($raw | Test-Json -SchemaFile $SchemaPath -ErrorAction SilentlyContinue)) {
        New-DesignGateError -Code 'policy.wrong_type' -Message "policy does not satisfy closed schema $SchemaPath"
    }

    return ($raw | ConvertFrom-Json)
}
```

Write JSON files with:

```powershell
[System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
```

Never `Set-Content -Encoding utf8` on Windows PowerShell 5 (BOM). P3 runs `pwsh` 7.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-design-gate-policy.ps1
```

Expected: PASS ending with:

```text
[test-design-gate-policy] passed — canonical policy plus closed-schema fail-closed fixtures
```

- [ ] **Step 5: Commit OpenSpec 1.1**

```powershell
git add -- scripts/config/design-gate-policy.json scripts/lib/design-gate-policy.ps1 scripts/tests/design-gate-policy.schema.json scripts/tests/test-design-gate-policy.ps1 scripts/tests/fixtures/design-gate-policy
git commit -m "feat(design-gate): add closed design-gate policy"
```

Do not add HTML, manifest, golden, baseline, capture, rebaseline, or `scripts/lib/design-system-gate.ps1`. Do not push.

---

### Task 2: Ref-bound HTML source collector

OpenSpec 1.2. Independent commit/push boundary. Do not start until Task 1 is green and committed.

**Files:**
- Create: `scripts/lib/design-gate-source-collector.ps1`
- Create: `scripts/tests/test-design-gate-source-collector.ps1`

**Interfaces:**
- Consumes: `New-DesignGateError`, `Test-DesignGatePolicy` from `scripts/lib/design-gate-policy.ps1`. Canonical policy path `scripts/config/design-gate-policy.json`. Schema path `scripts/tests/design-gate-policy.schema.json`.
- Produces:
  - `function Get-DesignGateTrackedHtmlPaths { param([string]$RepoRoot, [string]$Ref) }` → `string[]` repo-relative `/` paths.
  - `function Get-GitRawBlobBytes { param([string]$RepoRoot, [string]$BlobOid) }` → `[byte[]]` from `git cat-file blob`, never working-tree files.
  - `function Get-DesignGateSha256Hex { param([byte[]]$Bytes) }` → lowercase hex.
  - `function Get-DesignGateSourceCollection { param([string]$RepoRoot, [string]$PolicyPath, [string]$SchemaPath, [string]$Ref, [string]$BaseRef, [string]$HeadRef, [string]$CallerDigest, [string]$PrProse, [string]$ScreenshotPath, [object]$ManualBoolean, [switch]$HashWorkingTreeBytes, [object[]]$CandidatePaths) }` → success object below, or throw.

Success object:

```powershell
[pscustomobject]@{
    ok = $true
    requested_ref = $requestedRef
    resolved_commit = $resolvedCommit
    successful_eligibility = $false
    sources = @(
        [pscustomobject]@{
            source_id = 'ai-bim-frontend-backend-design'
            source_role = 'architecture_behavior'
            path = 'docs/plans/AI-BIM 前後端設計文件.dc.html'
            requested_ref = $refUsedForBlob
            resolved_commit = $commitUsedForBlob
            blob_oid = '40-hex'
            sha256 = '64-hex'
            in_base = $true   # pair mode only; single-ref sets both in_base/in_head true
            in_head = $true
        }
    )
}
```

Parameter sets:
- Current checkout: omit `Ref`/`BaseRef`/`HeadRef`. Source set = `git ls-files -- 'docs/plans/*.html'` (implementation uses `git ls-files -s` so the index blob OID is available). Resolved commit = `git rev-parse HEAD`.
- Named ref: `-Ref <rev>`. Source set = `git ls-tree -r --name-only --full-tree <rev> -- docs/plans/` filtered to suffix `.html`. Never `git ls-tree ... -- 'docs/plans/*.html'`.
- Pair: `-BaseRef` and `-HeadRef`. Union by repo-relative path. Base-only paths remain in `sources` with `in_head = $false` and blob from base.

Closed rule for result vs throw:

- Untrusted caller inputs (`-CallerDigest`, `-PrProse`, `-ScreenshotPath`, `-ManualBoolean`, `-HashWorkingTreeBytes`, external/origin/untracked/ignored/role-ambiguous candidates): **throw**. No success object. No `successful_eligibility`.
- Git collection outcomes that must stay visible (base-only deletion) or describe registered-set drift (rename, unregistered tracked HTML): **return** object with `ok = $false`, `code`, `message`, `successful_eligibility = $false`, and `sources` still populated.
- Happy path: `ok = $true`, `successful_eligibility = $false`.

Tests for deletion use the returned object, not `Assert-Throws`. Tests for untrusted inputs use `Assert-Throws` / `Assert-SourceCode`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/test-design-gate-source-collector.ps1` with this complete file:

```powershell
#requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'test-helpers.ps1')

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$collectorPath = Join-Path $repoRoot 'scripts\lib\design-gate-source-collector.ps1'
$policyPath = Join-Path $repoRoot 'scripts\config\design-gate-policy.json'
$schemaPath = Join-Path $repoRoot 'scripts\tests\design-gate-policy.schema.json'

Assert-True (Test-Path -LiteralPath $collectorPath -PathType Leaf) 'scripts/lib/design-gate-source-collector.ps1 exists'
. $collectorPath

function Assert-SourceCode {
    param(
        [Parameter(Mandatory = $true)][scriptblock] $Action,
        [Parameter(Mandatory = $true)][string] $Code,
        [Parameter(Mandatory = $true)][string] $Context
    )
    $failed = $false
    $message = ''
    try { & $Action | Out-Null } catch {
        $failed = $true
        $message = [string]$_.Exception.Message
    }
    Assert-True $failed "$Context was expected to throw"
    Assert-True ($message.StartsWith("${Code}:", [System.StringComparison]::Ordinal)) `
        "$Context expected prefix '${Code}:' actual='$message'"
}

function Get-IndependentBlobSha256 {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $BlobOid
    )
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "design-gate-indep-$([guid]::NewGuid().ToString('N'))"
    $errFile = "$outFile.err"
    try {
        $proc = Start-Process -FilePath (Get-Command git -ErrorAction Stop).Source `
            -ArgumentList @('-C', $Root, '-c', "safe.directory=$Root", 'cat-file', 'blob', $BlobOid) `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile -Wait -NoNewWindow -PassThru
        Assert-Equal 0 $proc.ExitCode "independent cat-file $BlobOid"
        return (Get-FileHash -LiteralPath $outFile -Algorithm SHA256).Hash.ToLowerInvariant()
    } finally {
        Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

function New-FixturePolicyBytes {
    param([Parameter(Mandatory = $true)][string] $Root)
    $canonical = Get-Content -LiteralPath $policyPath -Raw -Encoding utf8
    $dest = Join-Path $Root 'scripts\config\design-gate-policy.json'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'scripts\tests') | Out-Null
    Copy-Item -LiteralPath $schemaPath -Destination (Join-Path $Root 'scripts\tests\design-gate-policy.schema.json')
    [System.IO.File]::WriteAllText($dest, $canonical, [System.Text.UTF8Encoding]::new($false))
    return $dest
}

function New-TrackedHtml {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string] $RelativePath,
        [Parameter(Mandatory = $true)][string] $LfBody
    )
    $absolute = Join-Path $Root ($RelativePath.Replace('/', '\'))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $absolute) | Out-Null
    [System.IO.File]::WriteAllText($absolute, $LfBody, [System.Text.UTF8Encoding]::new($false))
}

function Initialize-FixtureGit {
    param([Parameter(Mandatory = $true)][string] $Root)
    Push-Location $Root
    try {
        git init -q -b main
        git config user.email 'design-gate@example.invalid'
        git config user.name 'Design Gate Test'
    } finally {
        Pop-Location
    }
}

function Invoke-FixtureGit {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][string[]] $ArgumentList
    )
    Push-Location $Root
    try {
        $output = & git @ArgumentList
        if ($LASTEXITCODE -ne 0) { throw "fixture git $($ArgumentList -join ' ') failed: $output" }
        return $output
    } finally {
        Pop-Location
    }
}

$archPath = 'docs/plans/AI-BIM 前後端設計文件.dc.html'
$hifiPath = 'docs/plans/AI-BIM Console Hi-Fi.dc.html'
$archBody = "<!doctype html>`n<title>architecture</title>`n"
$hifiBody = "<!doctype html>`n<title>hifi</title>`n"

# --- Live repo: current checkout matches git ls-files and raw blob digest ---
$liveLs = @(& git -C $repoRoot ls-files -- 'docs/plans/*.html')
Assert-Equal 2 $liveLs.Count 'live source set has exactly two tracked HTML files'
Assert-True ($liveLs -contains $archPath) 'live set contains architecture HTML'
Assert-True ($liveLs -contains $hifiPath) 'live set contains console hifi HTML'

$live = Get-DesignGateSourceCollection -RepoRoot $repoRoot -PolicyPath $policyPath -SchemaPath $schemaPath
Assert-True $live.ok 'live current collection ok'
Assert-True (-not [bool]$live.successful_eligibility) 'live collection does not grant eligibility'
Assert-Equal 2 @($live.sources).Count 'live collection has two sources'
$head = (& git -C $repoRoot rev-parse HEAD).Trim()
Assert-Equal $head ([string]$live.resolved_commit) 'live resolved commit is HEAD'
foreach ($path in @($archPath, $hifiPath)) {
    $record = @($live.sources | Where-Object { [string]$_.path -eq $path })
    Assert-Equal 1 $record.Count "live record for $path"
    $oid = (& git -C $repoRoot rev-parse "HEAD:$path").Trim()
    Assert-Equal $oid ([string]$record[0].blob_oid) "live blob oid for $path"
    $expectedSha = Get-IndependentBlobSha256 -Root $repoRoot -BlobOid $oid
    Assert-Equal $expectedSha ([string]$record[0].sha256) "live raw-blob sha256 for $path"
}

$named = Get-DesignGateSourceCollection -RepoRoot $repoRoot -PolicyPath $policyPath -SchemaPath $schemaPath -Ref 'HEAD'
Assert-True $named.ok 'named HEAD collection ok'
Assert-Equal $head ([string]$named.resolved_commit) 'named HEAD commit'
Assert-Equal 2 @($named.sources).Count 'named HEAD has two sources'

$lsTreeGlob = @(& git -C $repoRoot ls-tree -r --name-only HEAD -- 'docs/plans/*.html')
Assert-Equal 0 @($lsTreeGlob | Where-Object { $_ }).Count 'ls-tree pathspec glob does not match .dc.html; collector must not use it'
$collectorText = Get-Content -LiteralPath $collectorPath -Raw -Encoding utf8
Assert-True ($collectorText -notmatch "ls-tree[^\r\n]*docs/plans/\*\.html") 'collector source does not pass docs/plans/*.html to ls-tree'

# --- Isolated fixture: current / base / head valid collection ---
$tempRoot = Join-Path $repoRoot "artifacts\tmp\design-gate-source-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    $validRoot = Join-Path $tempRoot 'valid'
    New-Item -ItemType Directory -Force -Path $validRoot | Out-Null
    Initialize-FixtureGit -Root $validRoot
    $fixturePolicy = New-FixturePolicyBytes -Root $validRoot
    New-TrackedHtml -Root $validRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $validRoot -RelativePath $hifiPath -LfBody $hifiBody
    Invoke-FixtureGit -Root $validRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $validRoot -ArgumentList @('commit', '-q', '-m', 'base html')
    $validHead = (Invoke-FixtureGit -Root $validRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()

    $validCurrent = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True $validCurrent.ok 'fixture current ok'
    Assert-True (-not [bool]$validCurrent.successful_eligibility) 'fixture current does not grant eligibility'
    Assert-Equal $validHead ([string]$validCurrent.resolved_commit) 'fixture current commit'
    Assert-Equal 2 @($validCurrent.sources).Count 'fixture current two sources'

    $validNamed = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -Ref $validHead
    Assert-True $validNamed.ok 'fixture named ok'
    Assert-Equal $validHead ([string]$validNamed.resolved_commit) 'fixture named commit'

    $validPair = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -BaseRef $validHead -HeadRef $validHead
    Assert-True $validPair.ok 'fixture pair same-ref ok'
    Assert-Equal 2 @($validPair.sources).Count 'fixture pair two sources'

    # Untracked HTML on disk is not authority and does not fail default collection.
    New-TrackedHtml -Root $validRoot -RelativePath 'docs/plans/scratch-untracked.html' -LfBody "<!doctype html>`n<title>scratch</title>`n"
    $stillValid = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True $stillValid.ok 'untracked extra HTML is not promoted from the working tree'
    Assert-Equal 2 @($stillValid.sources).Count 'untracked HTML is absent from the source set'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @('docs/plans/scratch-untracked.html')
    } 'source.untracked' 'untracked candidate'

    # CRLF working tree does not change raw Git blob digest.
    $hifiAbsolute = Join-Path $validRoot ($hifiPath.Replace('/', '\'))
    $crlfBody = $hifiBody.Replace("`n", "`r`n")
    [System.IO.File]::WriteAllText($hifiAbsolute, $crlfBody, [System.Text.UTF8Encoding]::new($false))
    $workHash = (Get-FileHash -LiteralPath $hifiAbsolute -Algorithm SHA256).Hash.ToLowerInvariant()
    $afterCrlf = Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json')
    $hifiRecord = @($afterCrlf.sources | Where-Object { [string]$_.path -eq $hifiPath })[0]
    Assert-True ($workHash -cne [string]$hifiRecord.sha256) 'working-tree CRLF hash differs from blob digest'
    $oid = (& git -C $validRoot rev-parse "HEAD:$hifiPath").Trim()
    $blobSha = Get-IndependentBlobSha256 -Root $validRoot -BlobOid $oid
    Assert-Equal $blobSha ([string]$hifiRecord.sha256) 'CRLF working tree leaves ref-bound digest unchanged'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -HashWorkingTreeBytes
    } 'source.working_tree_bytes_forbidden' 'working-tree bytes switch'

    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CallerDigest ('0' * 64)
    } 'source.caller_digest_forbidden' 'caller digest'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -PrProse 'looks fine in the PR body'
    } 'source.pr_prose_forbidden' 'PR prose'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -ScreenshotPath 'docs/plans/screenshot.png'
    } 'source.screenshot_forbidden' 'screenshot'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -ManualBoolean $true
    } 'source.manual_boolean_forbidden' 'manual boolean'

    $outside = Join-Path $tempRoot 'outside.html'
    [System.IO.File]::WriteAllText($outside, '<!doctype html><title>outside</title>', [System.Text.UTF8Encoding]::new($false))
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @($outside)
    } 'source.external' 'repo-external HTML'

    $originProjected = 'C:\Repos\design\desigin-system\AI-BIM Console Hi-Fi.dc.html'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @($originProjected)
    } 'source.origin_projected' 'origin-projected HTML'

    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @(@{
            path = $hifiPath
            source_role = 'architecture_behavior'
        })
    } 'source.role_ambiguous' 'role-ambiguous candidate'

    # Ignored HTML
    $ignoreRoot = Join-Path $tempRoot 'ignored'
    New-Item -ItemType Directory -Force -Path $ignoreRoot | Out-Null
    Initialize-FixtureGit -Root $ignoreRoot
    $ignorePolicy = New-FixturePolicyBytes -Root $ignoreRoot
    New-TrackedHtml -Root $ignoreRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $ignoreRoot -RelativePath $hifiPath -LfBody $hifiBody
    [System.IO.File]::WriteAllText((Join-Path $ignoreRoot '.gitignore'), "docs/plans/ignored.html`n", [System.Text.UTF8Encoding]::new($false))
    New-TrackedHtml -Root $ignoreRoot -RelativePath 'docs/plans/ignored.html' -LfBody "<!doctype html>`n<title>ignored</title>`n"
    Invoke-FixtureGit -Root $ignoreRoot -ArgumentList @('add', '--', '.gitignore', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $ignoreRoot -ArgumentList @('commit', '-q', '-m', 'ignored html')
    $ignoreCollection = Get-DesignGateSourceCollection -RepoRoot $ignoreRoot -PolicyPath $ignorePolicy -SchemaPath (Join-Path $ignoreRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True $ignoreCollection.ok 'ignored extra HTML is not promoted'
    Assert-Equal 2 @($ignoreCollection.sources).Count 'ignored HTML is absent from the source set'
    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $ignoreRoot -PolicyPath $ignorePolicy -SchemaPath (Join-Path $ignoreRoot 'scripts\tests\design-gate-policy.schema.json') -CandidatePaths @('docs/plans/ignored.html')
    } 'source.ignored' 'ignored candidate'

    # Unregistered tracked HTML
    $unregRoot = Join-Path $tempRoot 'unregistered'
    New-Item -ItemType Directory -Force -Path $unregRoot | Out-Null
    Initialize-FixtureGit -Root $unregRoot
    $unregPolicy = New-FixturePolicyBytes -Root $unregRoot
    New-TrackedHtml -Root $unregRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $unregRoot -RelativePath $hifiPath -LfBody $hifiBody
    New-TrackedHtml -Root $unregRoot -RelativePath 'docs/plans/extra.dc.html' -LfBody "<!doctype html>`n<title>extra</title>`n"
    Invoke-FixtureGit -Root $unregRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $unregRoot -ArgumentList @('commit', '-q', '-m', 'unregistered html')
    $unreg = Get-DesignGateSourceCollection -RepoRoot $unregRoot -PolicyPath $unregPolicy -SchemaPath (Join-Path $unregRoot 'scripts\tests\design-gate-policy.schema.json')
    Assert-True (-not $unreg.ok) 'unregistered tracked HTML fails closed'
    Assert-Equal 'source.unregistered' ([string]$unreg.code) 'unregistered code'
    Assert-True (-not [bool]$unreg.successful_eligibility) 'unregistered does not grant eligibility'

    # Base-only deletion visibility
    $delRoot = Join-Path $tempRoot 'deleted'
    New-Item -ItemType Directory -Force -Path $delRoot | Out-Null
    Initialize-FixtureGit -Root $delRoot
    $delPolicy = New-FixturePolicyBytes -Root $delRoot
    New-TrackedHtml -Root $delRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $delRoot -RelativePath $hifiPath -LfBody $hifiBody
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('commit', '-q', '-m', 'base both html')
    $delBase = (Invoke-FixtureGit -Root $delRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('rm', '-q', '--', $hifiPath)
    Invoke-FixtureGit -Root $delRoot -ArgumentList @('commit', '-q', '-m', 'delete hifi')
    $delHead = (Invoke-FixtureGit -Root $delRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    $deleted = Get-DesignGateSourceCollection -RepoRoot $delRoot -PolicyPath $delPolicy -SchemaPath (Join-Path $delRoot 'scripts\tests\design-gate-policy.schema.json') -BaseRef $delBase -HeadRef $delHead
    Assert-True (-not $deleted.ok) 'deletion fails closed'
    Assert-Equal 'source.deleted_from_head' ([string]$deleted.code) 'deletion code'
    Assert-True (-not [bool]$deleted.successful_eligibility) 'deletion does not grant eligibility'
    $deletedHifi = @($deleted.sources | Where-Object { [string]$_.path -eq $hifiPath })
    Assert-Equal 1 $deletedHifi.Count 'base-only hifi remains visible'
    Assert-True ([bool]$deletedHifi[0].in_base) 'deleted source in_base'
    Assert-True (-not [bool]$deletedHifi[0].in_head) 'deleted source not in_head'
    Assert-Equal $delBase ([string]$deletedHifi[0].resolved_commit) 'deleted source blob comes from base'
    Assert-Equal 2 @($deleted.sources).Count 'governed set is not silently shrunk'

    # Rename
    $renRoot = Join-Path $tempRoot 'renamed'
    New-Item -ItemType Directory -Force -Path $renRoot | Out-Null
    Initialize-FixtureGit -Root $renRoot
    $renPolicy = New-FixturePolicyBytes -Root $renRoot
    New-TrackedHtml -Root $renRoot -RelativePath $archPath -LfBody $archBody
    New-TrackedHtml -Root $renRoot -RelativePath $hifiPath -LfBody $hifiBody
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('add', '--', 'docs/plans', 'scripts/config', 'scripts/tests')
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('commit', '-q', '-m', 'base both html')
    $renBase = (Invoke-FixtureGit -Root $renRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('mv', '--', $hifiPath, 'docs/plans/renamed-hifi.dc.html')
    Invoke-FixtureGit -Root $renRoot -ArgumentList @('commit', '-q', '-m', 'rename hifi')
    $renHead = (Invoke-FixtureGit -Root $renRoot -ArgumentList @('rev-parse', 'HEAD')).Trim()
    $renamed = Get-DesignGateSourceCollection -RepoRoot $renRoot -PolicyPath $renPolicy -SchemaPath (Join-Path $renRoot 'scripts\tests\design-gate-policy.schema.json') -BaseRef $renBase -HeadRef $renHead
    Assert-True (-not $renamed.ok) 'rename fails closed'
    Assert-Equal 'source.renamed' ([string]$renamed.code) 'rename code'
    Assert-True (-not [bool]$renamed.successful_eligibility) 'rename does not grant eligibility'
    Assert-True ((@($renamed.sources | Where-Object { [string]$_.path -eq $hifiPath }).Count) -eq 1) 'old path remains visible'
    Assert-True ((@($renamed.sources | Where-Object { [string]$_.path -eq 'docs/plans/renamed-hifi.dc.html' }).Count) -eq 1) 'new path is present for diagnosis'

    Assert-SourceCode {
        Get-DesignGateSourceCollection -RepoRoot $validRoot -PolicyPath $fixturePolicy -SchemaPath (Join-Path $validRoot 'scripts\tests\design-gate-policy.schema.json') -Ref 'this-ref-does-not-exist'
    } 'source.unresolved_ref' 'unresolved ref'
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Excluded-file guard ---
$changed = @(& git -C $repoRoot diff --name-only origin/main)
$changed += @(& git -C $repoRoot diff --name-only --cached)
$status = @(& git -C $repoRoot status --porcelain)
$allTouched = @($changed + @($status | ForEach-Object { $_.Substring(3).Replace('\', '/') })) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique
$forbidden = @(
    '^docs/plans/.*\.html$'
    '^docs/plans/design-system-reference\.manifest\.json$'
    '^docs/plans/design-system-baseline/'
    'capture-design-system-reference'
    'rebaseline'
    '^scripts/lib/design-system-gate\.ps1$'
)
foreach ($path in $allTouched) {
    $normalized = [string]$path
    foreach ($pattern in $forbidden) {
        Assert-True ($normalized -notmatch $pattern) "excluded surface was modified: $normalized"
    }
}
Assert-True ($collectorText -notmatch 'Set-Content|Out-File|WriteAllText') 'collector does not write files'
Assert-True ($collectorText -notmatch 'design-system-reference\.manifest\.json') 'collector does not treat the manifest as authority'
Assert-True ($collectorText -notmatch 'design-system-baseline') 'collector does not touch baselines'

Write-Host '[test-design-gate-source-collector] passed — ref-bound collection, fail-closed untrusted inputs, excluded-file guard'
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-design-gate-source-collector.ps1
```

Expected: FAIL with `ASSERT FAILED: scripts/lib/design-gate-source-collector.ps1 exists`.

- [ ] **Step 3: Write the collector**

Create `scripts/lib/design-gate-source-collector.ps1` with this complete file:

```powershell
#requires -Version 7.0
Set-StrictMode -Version Latest

$designGatePolicyLibrary = Join-Path $PSScriptRoot 'design-gate-policy.ps1'
if (-not (Test-Path -LiteralPath $designGatePolicyLibrary -PathType Leaf)) {
    throw "design-gate-policy.ps1 is required: $designGatePolicyLibrary"
}
. $designGatePolicyLibrary

function Get-DesignGateSha256Hex {
    param([Parameter(Mandatory = $true)][byte[]] $Bytes)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [System.BitConverter]::ToString($hash.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $hash.Dispose()
    }
}

function Invoke-DesignGateGit {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string[]] $ArgumentList
    )
    $output = & git -C $RepoRoot -c "safe.directory=$RepoRoot" @ArgumentList 2>&1
    if ($LASTEXITCODE -ne 0) {
        New-DesignGateError -Code 'source.unresolved_ref' -Message ("git {0} failed: {1}" -f ($ArgumentList -join ' '), (($output | Out-String).Trim()))
    }
    return @($output | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Resolve-DesignGateCommit {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Ref
    )
    $value = @(Invoke-DesignGateGit -RepoRoot $RepoRoot -ArgumentList @('rev-parse', "$Ref^{commit}"))
    if ($value.Count -ne 1 -or [string]$value[0] -notmatch '^[0-9a-f]{40}$') {
        New-DesignGateError -Code 'source.unresolved_ref' -Message "unable to resolve commit for ref '$Ref'."
    }
    return [string]$value[0]
}

function Get-GitRawBlobBytes {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $BlobOid
    )
    if ([string]$BlobOid -notmatch '^[0-9a-f]{40}$') {
        New-DesignGateError -Code 'source.unresolved_ref' -Message "blob oid '$BlobOid' is not a Git SHA-1."
    }
    $outFile = Join-Path ([System.IO.Path]::GetTempPath()) "design-gate-blob-$([guid]::NewGuid().ToString('N'))"
    $errFile = "$outFile.err"
    try {
        $proc = Start-Process -FilePath (Get-Command git -ErrorAction Stop).Source `
            -ArgumentList @('-C', $RepoRoot, '-c', "safe.directory=$RepoRoot", 'cat-file', 'blob', $BlobOid) `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile -Wait -NoNewWindow -PassThru
        if ($proc.ExitCode -ne 0) {
            $err = ''
            if (Test-Path -LiteralPath $errFile) { $err = Get-Content -LiteralPath $errFile -Raw }
            New-DesignGateError -Code 'source.unresolved_ref' -Message "git cat-file blob $BlobOid failed: $err"
        }
        return [System.IO.File]::ReadAllBytes($outFile)
    } finally {
        Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

function Get-DesignGateTrackedHtmlRecords {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $Ref = ''
    )

    $records = New-Object System.Collections.Generic.List[object]
    if ([string]::IsNullOrWhiteSpace($Ref)) {
        $lines = @(Invoke-DesignGateGit -RepoRoot $RepoRoot -ArgumentList @('ls-files', '-s', '--', 'docs/plans/*.html'))
        foreach ($line in $lines) {
            if ([string]$line -notmatch '^100644 ([0-9a-f]{40}) [0-3]\t(.+\.html)$') {
                New-DesignGateError -Code 'source.unresolved_ref' -Message "unexpected git ls-files -s line: $line"
            }
            $records.Add([pscustomobject]@{
                path = $Matches[2].Replace('\', '/')
                blob_oid = $Matches[1]
            })
        }
        return @($records)
    }

    # Named ref: list the docs/plans tree, then keep *.html suffix.
    # Do not pass docs/plans/*.html as an ls-tree pathspec; that glob does not match .dc.html.
    $lines = @(Invoke-DesignGateGit -RepoRoot $RepoRoot -ArgumentList @('ls-tree', '-r', '--full-tree', $Ref, '--', 'docs/plans/'))
    foreach ($line in $lines) {
        if ([string]$line -notmatch '^100644 blob ([0-9a-f]{40})\t(.+)$') { continue }
        $path = $Matches[2].Replace('\', '/')
        if ($path -notlike '*.html') { continue }
        $records.Add([pscustomobject]@{
            path = $path
            blob_oid = $Matches[1]
        })
    }
    return @($records)
}

function Get-DesignGateTrackedHtmlPaths {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [string] $Ref = ''
    )
    return @((Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $Ref).path)
}

function ConvertTo-DesignGateRepoRelativePath {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $Path
    )
    $normalized = $Path.Trim().Replace('\', '/')
    $originPrefix = 'C:/Repos/design/desigin-system'
    $originWindows = 'C:\Repos\design\desigin-system'
    if ($normalized.StartsWith($originPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $Path.StartsWith($originWindows, [System.StringComparison]::OrdinalIgnoreCase)) {
        New-DesignGateError -Code 'source.origin_projected' -Message "origin-projected HTML has no authority: $Path"
    }
    $resolvedRoot = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\')
    if ([System.IO.Path]::IsPathRooted($Path)) {
        $full = $Path
        try { $full = [System.IO.Path]::GetFullPath($Path) } catch { $full = $Path }
        if ($full.StartsWith($originWindows, [System.StringComparison]::OrdinalIgnoreCase)) {
            New-DesignGateError -Code 'source.origin_projected' -Message "origin-projected HTML has no authority: $Path"
        }
        if (-not $full.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            New-DesignGateError -Code 'source.external' -Message "repo-external HTML has no authority: $Path"
        }
        $relative = $full.Substring($resolvedRoot.Length).TrimStart('\', '/').Replace('\', '/')
        return $relative
    }
    if ($normalized.Contains('..')) {
        New-DesignGateError -Code 'source.external' -Message "path escaped the repository: $Path"
    }
    return $normalized.TrimStart('/')
}

function Test-DesignGateIgnoredPath {
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $RelativePath
    )
    & git -C $RepoRoot -c "safe.directory=$RepoRoot" check-ignore -q -- $RelativePath 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Get-DesignGateSourceCollection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $RepoRoot,
        [Parameter(Mandatory = $true)][string] $PolicyPath,
        [Parameter(Mandatory = $true)][string] $SchemaPath,
        [string] $Ref = '',
        [string] $BaseRef = '',
        [string] $HeadRef = '',
        [string] $CallerDigest = '',
        [string] $PrProse = '',
        [string] $ScreenshotPath = '',
        [object] $ManualBoolean = $null,
        [switch] $HashWorkingTreeBytes,
        [object[]] $CandidatePaths = @()
    )

    if ($PSBoundParameters.ContainsKey('CallerDigest') -and -not [string]::IsNullOrWhiteSpace($CallerDigest)) {
        New-DesignGateError -Code 'source.caller_digest_forbidden' -Message 'caller-supplied digests are not authority.'
    }
    if ($PSBoundParameters.ContainsKey('PrProse') -and -not [string]::IsNullOrWhiteSpace($PrProse)) {
        New-DesignGateError -Code 'source.pr_prose_forbidden' -Message 'PR prose is not authority.'
    }
    if ($PSBoundParameters.ContainsKey('ScreenshotPath') -and -not [string]::IsNullOrWhiteSpace($ScreenshotPath)) {
        New-DesignGateError -Code 'source.screenshot_forbidden' -Message 'screenshots are not authority.'
    }
    if ($PSBoundParameters.ContainsKey('ManualBoolean') -and $null -ne $ManualBoolean) {
        New-DesignGateError -Code 'source.manual_boolean_forbidden' -Message 'manual booleans are not authority.'
    }
    if ($HashWorkingTreeBytes) {
        New-DesignGateError -Code 'source.working_tree_bytes_forbidden' -Message 'working-tree bytes are not authority.'
    }

    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
    $policy = Test-DesignGatePolicy -PolicyPath $PolicyPath -SchemaPath $SchemaPath
    $registry = @{}
    foreach ($entry in @($policy.sources)) {
        $registry[[string]$entry.path] = $entry
    }

    foreach ($candidate in @($CandidatePaths)) {
        $candidatePath = $candidate
        $candidateRole = $null
        if ($candidate -is [System.Collections.IDictionary] -or $candidate -is [pscustomobject]) {
            $candidatePath = [string]$candidate.path
            if ($null -ne $candidate.source_role) { $candidateRole = [string]$candidate.source_role }
        } else {
            $candidatePath = [string]$candidate
        }
        $relative = ConvertTo-DesignGateRepoRelativePath -RepoRoot $RepoRoot -Path $candidatePath
        if (Test-DesignGateIgnoredPath -RepoRoot $RepoRoot -RelativePath $relative) {
            New-DesignGateError -Code 'source.ignored' -Message "ignored HTML has no authority: $relative"
        }
        $trackedNow = @(Get-DesignGateTrackedHtmlPaths -RepoRoot $RepoRoot)
        if ($relative -notin $trackedNow) {
            New-DesignGateError -Code 'source.untracked' -Message "untracked HTML has no authority: $relative"
        }
        if (-not $registry.ContainsKey($relative)) {
            New-DesignGateError -Code 'source.unregistered' -Message "unregistered HTML path '$relative'."
        }
        if ($null -ne $candidateRole -and [string]$candidateRole -cne [string]$registry[$relative].source_role) {
            New-DesignGateError -Code 'source.role_ambiguous' -Message "role '$candidateRole' is not the unique registered role for '$relative'."
        }
    }

    $pairMode = -not [string]::IsNullOrWhiteSpace($BaseRef) -or -not [string]::IsNullOrWhiteSpace($HeadRef)
    if ($pairMode) {
        if ([string]::IsNullOrWhiteSpace($BaseRef) -or [string]::IsNullOrWhiteSpace($HeadRef)) {
            New-DesignGateError -Code 'source.unresolved_ref' -Message 'pair collection requires both BaseRef and HeadRef.'
        }
        if (-not [string]::IsNullOrWhiteSpace($Ref)) {
            New-DesignGateError -Code 'source.unresolved_ref' -Message 'Ref cannot be combined with BaseRef/HeadRef.'
        }
    }

    $requestedRef = if ($pairMode) { "$BaseRef...$HeadRef" } elseif ([string]::IsNullOrWhiteSpace($Ref)) { 'HEAD' } else { $Ref }
    $resolvedCommit = if ($pairMode) {
        Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref $HeadRef
    } elseif ([string]::IsNullOrWhiteSpace($Ref)) {
        Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref 'HEAD'
    } else {
        Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref $Ref
    }

    $baseRecords = @()
    $headRecords = @()
    if ($pairMode) {
        $baseRecords = @(Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $BaseRef)
        $headRecords = @(Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $HeadRef)
    } else {
        $headRecords = @(Get-DesignGateTrackedHtmlRecords -RepoRoot $RepoRoot -Ref $Ref)
        $baseRecords = $headRecords
    }

    $baseMap = @{}
    foreach ($record in $baseRecords) { $baseMap[$record.path] = $record }
    $headMap = @{}
    foreach ($record in $headRecords) { $headMap[$record.path] = $record }
    $union = @($baseMap.Keys + $headMap.Keys) | Sort-Object -Unique

    $sources = New-Object System.Collections.Generic.List[object]
    $unregisteredHead = New-Object System.Collections.Generic.List[string]
    $missingHead = New-Object System.Collections.Generic.List[string]
    foreach ($path in $union) {
        $inBase = $baseMap.ContainsKey($path)
        $inHead = $headMap.ContainsKey($path)
        $use = if ($inHead) { $headMap[$path] } else { $baseMap[$path] }
        $refForBlob = if ($inHead) {
            if ($pairMode) { $HeadRef } elseif ([string]::IsNullOrWhiteSpace($Ref)) { 'HEAD' } else { $Ref }
        } else {
            $BaseRef
        }
        $commitForBlob = Resolve-DesignGateCommit -RepoRoot $RepoRoot -Ref $refForBlob
        $bytes = Get-GitRawBlobBytes -RepoRoot $RepoRoot -BlobOid $use.blob_oid
        $registered = $registry.ContainsKey($path)
        if ($inHead -and -not $registered) { $unregisteredHead.Add($path) }
        if ($registered -and $inBase -and -not $inHead) { $missingHead.Add($path) }
        $sourceId = if ($registered) { [string]$registry[$path].source_id } else { '' }
        $sourceRole = if ($registered) { [string]$registry[$path].source_role } else { '' }
        $sources.Add([pscustomobject]@{
            source_id = $sourceId
            source_role = $sourceRole
            path = $path
            requested_ref = $refForBlob
            resolved_commit = $commitForBlob
            blob_oid = [string]$use.blob_oid
            sha256 = Get-DesignGateSha256Hex -Bytes $bytes
            in_base = [bool]$inBase
            in_head = [bool]$inHead
        })
    }

    foreach ($path in @($registry.Keys)) {
        if (-not $baseMap.ContainsKey($path) -and -not $headMap.ContainsKey($path)) {
            $unregisteredHead.Add("missing-registered:$path")
        }
    }

    $result = [pscustomobject]@{
        ok = $true
        code = $null
        message = $null
        requested_ref = $requestedRef
        resolved_commit = $resolvedCommit
        successful_eligibility = $false
        sources = @($sources)
    }

    if ($pairMode -and $unregisteredHead.Count -gt 0 -and $missingHead.Count -gt 0) {
        $result.ok = $false
        $result.code = 'source.renamed'
        $result.message = 'registered HTML was renamed; the governed source set cannot shrink silently.'
        return $result
    }
    if ($unregisteredHead.Count -gt 0) {
        $result.ok = $false
        $result.code = 'source.unregistered'
        $result.message = ("unregistered HTML is not in the policy registry: {0}" -f ($unregisteredHead -join ', '))
        return $result
    }
    if ($missingHead.Count -gt 0) {
        $result.ok = $false
        $result.code = 'source.deleted_from_head'
        $result.message = ("registered HTML deleted from head remains visible: {0}" -f ($missingHead -join ', '))
        return $result
    }

    $registeredCount = @($sources | Where-Object { -not [string]::IsNullOrWhiteSpace($_.source_id) }).Count
    if ($registeredCount -ne 2 -and -not $pairMode) {
        $result.ok = $false
        $result.code = 'source.unregistered'
        $result.message = 'current collection must resolve exactly the two registered HTML sources.'
        return $result
    }

    return $result
}
```

Implementation notes that must be preserved:

1. Current checkout uses `git ls-files -s -- 'docs/plans/*.html'` (index blob OID). Named refs use `git ls-tree -r --full-tree <ref> -- docs/plans/` plus `*.html` suffix filter.
2. Hash only `git cat-file blob <oid>` bytes via `Start-Process -RedirectStandardOutput` (raw bytes). Do not `Get-Content` the working tree, do not `git hash-object` the working tree, do not `git show` (smudge/filters).
3. Origin projection is the currently verified authoring origin `C:\Repos\design\desigin-system`. Do not read `design-system-reference.manifest.json` to obtain it.
4. The collector must not write any file except disposable temp files for `cat-file` that it deletes in `finally`. The excluded-file guard forbids `Set-Content`/`Out-File`/`WriteAllText` in this file; keep using `Start-Process -RedirectStandardOutput` to a temp path created with .NET, then `ReadAllBytes`, then delete. If the static guard is too broad because `WriteAllText` appears in comments, do not put those cmdlet names in the collector source at all.
5. `successful_eligibility` is always `$false`.

If the excluded-file guard `Set-Content|Out-File|WriteAllText` is too strict for a needed helper, move temp-file IO behind `[System.IO.File]::ReadAllBytes` / `Start-Process` only, and keep the guard. Do not weaken the guard.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-design-gate-policy.ps1
pwsh -NoProfile -NonInteractive -File .\scripts\tests\test-design-gate-source-collector.ps1
```

Expected:

```text
[test-design-gate-policy] passed — canonical policy plus closed-schema fail-closed fixtures
[test-design-gate-source-collector] passed — ref-bound collection, fail-closed untrusted inputs, excluded-file guard
```

Also confirm GitNexus impact after the new functions exist (Lane G/S, from repo root):

```powershell
gitnexus impact Test-DesignGatePolicy -d upstream -r AI-BIM-governance
gitnexus impact Get-DesignGateSourceCollection -d upstream -r AI-BIM-governance
```

If GitNexus is stale/unavailable, report that; do not invent a pass. These symbols are new, so impact may be empty/low. HIGH/CRITICAL must be reported before commit.

- [ ] **Step 5: Commit OpenSpec 1.2**

```powershell
git add -- scripts/lib/design-gate-source-collector.ps1 scripts/tests/test-design-gate-source-collector.ps1
git commit -m "feat(design-gate): add ref-bound HTML source collector"
```

Do not add HTML, manifest, golden, baseline, capture, rebaseline, or `scripts/lib/design-system-gate.ps1`. Do not push.

---

## Out of scope (do not implement in this plan)

- Field-level provenance registry / semantic locator (`align-html-derived-design-gate-provenance`)
- Base/head classifier and eight-value status (`align-html-derived-design-gate-classifier-status`)
- PR-body / local preflight / gstack / visual-result consumers (`align-html-derived-design-gate-typed-consumers`)
- Manifest v2 migration, `policy_digest` sync, golden/baseline/capture/rebaseline
- CI workflow registration for the new tests
