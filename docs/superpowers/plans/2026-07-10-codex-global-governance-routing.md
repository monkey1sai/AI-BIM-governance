# Codex Global Governance and Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize the live Windows Codex governance files into one compact routing source, valid standalone profiles, and canonical read-only custom roles without changing secrets or MCP credentials.

**Architecture:** Perform all host edits as a single backupable transaction. `config.toml` owns defaults and permissions; standalone profile files own session lanes; custom agent TOMLs own role capabilities; `task-routing.md` owns generic dispatch. Claude compatibility files become pointers rather than second sources of truth.

**Tech Stack:** PowerShell 7.5.4, Codex CLI 0.144.1, TOML, Markdown, SHA256 and Windows ACL inspection.

## Global Constraints

- The approved default is `gpt-5.6-sol` with `high`; the current live `max` value is an execution precondition requiring owner resolution.
- `desktop.git-always-force-push = false`, `agents.max_threads = 6`, and `agents.max_depth = 1`.
- Permissions use `default_permissions`; do not mix it with `sandbox_mode` or `[sandbox_workspace_write]`.
- Use `:workspace_roots` and `deny`; remove legacy `:project_roots` and `none` tokens.
- Preserve Windows elevated sandbox implementation; it is not equivalent to unrestricted access.
- Do not alter MCP registrations, auth, tokens, or credentials.
- Global `AGENTS.md` target is 120-160 physical lines; repo-local budgets are handled in Plan B.

---

### Task G0: Capture drift, backup, and rollback manifest

**Files:**
- Create: `C:\Users\IOT\.codex\maintenance\preflight\20260710-global-baseline.json`
- Create: timestamped backups beside every modified global/Claude file
- Read: `C:\Users\IOT\.codex\config.toml`, `AGENTS.md`, `agents\*.toml`, and `C:\Users\IOT\.claude\docs\agents\*.md`

**Interfaces:**
- Produces a redacted manifest containing absolute path, existence, length, SHA256, owner SID, ACL SDDL, and the fact that each new profile was absent.
- Consumes no secrets and never stores file contents.

- [ ] **Step 1: Run the failing baseline checks**

```powershell
codex --version
codex --strict-config doctor --summary
foreach ($p in 'fast-fix','dev','deep-review','net-install') { codex --profile $p mcp list }
```

Expected: CLI `0.144.1`; doctor has zero failures and the accepted existing warnings; each profile command fails because legacy inline profiles are present.

- [ ] **Step 2: Resolve the effort drift before editing**

Compare the approved `high` target with the live default. If the owner reaffirms `high`, record `decision = approved-high`; if the owner intentionally keeps `max`, stop this plan and update the approved spec before continuing. Never infer the decision from the current machine value.

- [ ] **Step 3: Write the manifest and backups**

Use a PowerShell script that creates one UTC timestamp directory, copies every target file with `Copy-Item`, calculates `Get-FileHash -Algorithm SHA256`, and records `Get-Acl`. Re-hash the live files immediately; abort if any hash changed between baseline and backup.

- [ ] **Step 4: Verify rollback rehearsal**

Restore the copied files into a disposable directory and compare hashes and ACL owner fields. Expected: exact hash match; no live file is changed by the rehearsal.

No Git commit is made for host-only backups. The manifest is the checkpoint.

### Task G1: Migrate root config and create standalone profiles

**Files:**
- Modify: `C:\Users\IOT\.codex\config.toml`
- Create: `C:\Users\IOT\.codex\fast-fix.config.toml`
- Create: `C:\Users\IOT\.codex\dev.config.toml`
- Create: `C:\Users\IOT\.codex\deep-review.config.toml`
- Create: `C:\Users\IOT\.codex\net-install.config.toml`

**Interfaces:**
- Root config remains the only default/MCP/feature registry.
- Profiles expose only model, effort, plan effort, permissions, and approved session behavior.

- [ ] **Step 1: Assert the legacy selectors are present**

```powershell
$cfg = Get-Content -Raw 'C:\Users\IOT\.codex\config.toml'
if ($cfg -notmatch '\[profiles\.' -or $cfg -notmatch 'sandbox_mode' -or $cfg -notmatch 'sandbox_workspace_write') { throw 'RED fixture missing' }
```

- [ ] **Step 2: Apply the minimal root diff**

Set `approvals_reviewer = "auto_review"`; set the resolved default model/effort; set `desktop.git-always-force-push = false`; set `agents.max_threads = 6`; replace `:project_roots` with `:workspace_roots` and `"none"` with `"deny"`; remove only the four CLI-removed feature overrides, inline `[profiles.*]`, root `sandbox_mode`, and `[sandbox_workspace_write]`; remove the codebase-memory SessionStart echo hook while preserving its MCP registration and the Windows elevated sandbox setting.

- [ ] **Step 3: Create the four profile files**

```toml
# fast-fix.config.toml
model = "gpt-5.6-terra"
model_reasoning_effort = "low"
default_permissions = "safe-workspace"

# dev.config.toml
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
default_permissions = "safe-workspace"

# deep-review.config.toml
model = "gpt-5.6-sol"
model_reasoning_effort = "max"
default_permissions = ":read-only"

# net-install.config.toml
model = "gpt-5.6-terra"
model_reasoning_effort = "medium"
default_permissions = "network-install"
```

Copy only the existing non-legacy session keys that each lane needs; omit `sandbox_mode` and inline profile tables. Preserve approved plan effort values rather than inventing new keys.

- [ ] **Step 4: Run the Green gate**

```powershell
codex --strict-config doctor --summary
codex mcp list
foreach ($p in 'fast-fix','dev','deep-review','net-install') { codex --profile $p mcp list }
```

Expected: every command exits 0; no new warning type or count; each profile loads the same approved MCP inventory. Any failure restores the complete G0 cohort.

### Task G2: Migrate custom roles

**Files:**
- Modify: `C:\Users\IOT\.codex\agents\explorer.toml`
- Modify: `C:\Users\IOT\.codex\agents\debugger.toml`
- Modify: `C:\Users\IOT\.codex\agents\reviewer.toml`
- Modify: `C:\Users\IOT\.codex\agents\security_auditor.toml`

**Interfaces:**
- Each file has exactly one `model`, `model_reasoning_effort`, `default_permissions = ":read-only"`, and `developer_instructions` block.
- Role lanes: explorer Terra/medium; debugger Sol/high; reviewer Sol/high; security_auditor Sol/max.

- [ ] **Step 1: Run the RED scan**

```powershell
rg -n 'gpt-5\.5|sandbox_mode' 'C:\Users\IOT\.codex\agents'
```

Expected: all four files match.

- [ ] **Step 2: Replace only model/access selectors**

Change each `sandbox_mode = "read-only"` to `default_permissions = ":read-only"`; update the model and effort matrix above; keep role instructions and output contract unchanged.

- [ ] **Step 3: Run schema and doctor checks**

Parse each TOML with the installed Codex CLI by invoking a profile that loads the role, then assert the four required keys with a line-oriented static check. Expected: no `gpt-5.5` or `sandbox_mode` matches and doctor remains Green.

### Task G3: Create global routing and maintenance source documents

**Files:**
- Create: `C:\Users\IOT\.codex\docs\agents\task-routing.md`
- Create: `C:\Users\IOT\.codex\docs\agents\maintenance.md`
- Modify: `C:\Users\IOT\.codex\AGENTS.md`
- Modify: `C:\Users\IOT\.claude\docs\agents\loop-workflows-core.md`
- Modify: `C:\Users\IOT\.claude\docs\agents\codex-loop-workflows.md`
- Verify unchanged: `C:\Users\IOT\.claude\CLAUDE.md`

**Interfaces:**
- `task-routing.md` is the only file defining the seven task-shape rows, worker output fields, scope rules, and high-risk stopping rules.
- `maintenance.md` defines Audit/Stage/Apply/Rollback, candidate age, trust root, health gates, report fields, and the pointer to the deterministic engine.
- Claude files point to the global source and retain the existing import line exactly once.

- [ ] **Step 1: Run the RED uniqueness checks**

Count the dispatch-table header and model-lane headings across the global and Claude docs. Expected: duplicate definitions and a 223-line global `AGENTS.md`.

- [ ] **Step 2: Write the single routing document**

Include the task rows from the approved design: trivial/simple single coordinator; discovery with explorer when material; normal implementation with bounded worker and reviewer; bug/runtime loop with debugger then reviewer; PR/E2E fan-out; auth/permissions/deploy adversarial security_auditor plus reviewer; open-ended candidate design with 2-4 lenses. Require `Scope`, `Evidence`, `Finding`, `Uncertainty`, `Risk`, and `Next step` from every worker.

- [ ] **Step 3: Compress global entrypoints and Claude compatibility docs**

Keep language, safety, evidence, coding, and done rules in global `AGENTS.md`; replace generic routing prose with lazy-load links. Keep tool-neutral workflow modes in `loop-workflows-core.md`; turn `codex-loop-workflows.md` into a short pointer. Remove the generated project-specific codebase-memory block from global `AGENTS.md`; preserve the repo GitNexus-generated blocks for Plan B.

- [ ] **Step 4: Run Green static checks**

Assert global `AGENTS.md` is 120-160 lines, the Claude adapter import occurs once, the dispatch table occurs only in `task-routing.md`, no global/Claude Markdown contains an exact `gpt-5.x` slug, and all referenced files exist.

### Task G4: Host integration and rollback gate

**Files:**
- Modify: `C:\Users\IOT\.codex\maintenance\preflight\20260710-global-baseline.json`

- [ ] **Step 1: Compare final health to G0**

Run doctor, all four profile commands, MCP/plugin summaries, static legacy-token checks, role matrix checks, line budgets, and import/index checks. Warning categories and counts must not worsen.

- [ ] **Step 2: Exercise full rollback**

Restore every G0 backup, remove only the four newly created profile files, and rerun the baseline commands. Expected: original hashes, zero doctor failures, and no warning regression.

- [ ] **Step 3: Reapply only after rollback Green**

Reapply the validated cohort and record `appliedAtUtc`, hashes, and command summaries in the redacted manifest. Do not create Scheduled Tasks in this plan; Plan C owns registration.

