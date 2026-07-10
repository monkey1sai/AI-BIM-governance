# AI-BIM Agent Governance Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repo-local governance to an AI-BIM-specific overlay, canonicalize the repo Codex permission file, and remove stale exact model routing while preserving all product and evidence gates.

**Architecture:** Global routing from Plan A supplies generic tiers, roles, effort, and worker contract. This repo adds only service boundaries, GitNexus authority, runtime/deploy risk composition, frontend-operable done evidence, and local workflow mappings. Existing GitNexus-generated blocks remain byte-identical.

**Tech Stack:** Markdown, TOML, PowerShell assertion tests, Codex strict doctor, GitNexus.

## Global Constraints

- `AGENTS.md` target is 150-180 lines; `CLAUDE.md` target is 40-70; advanced overlay 40-70; Codex loop overlay 50-90.
- Local governance must not define generic task tiers, reasoning lanes, or a second worker output contract.
- Active governance surfaces must not hard-code exact `gpt-*` model slugs.
- GitNexus is code-change impact authority; codebase-memory is advisory only.
- Generated GitNexus blocks in root `AGENTS.md` and `CLAUDE.md` are not edited.
- `.codex/config.toml` contains project permissions/network only; it does not define model or effort.
- No production dependency is added.

---

### Task 1: R1 - Add failing governance assertions

**Files:**
- Modify: `scripts/tests/test-agent-governance-check.ps1`
- Test fixture: current `AGENTS.md`, `CLAUDE.md`, overlays, `.codex/config.toml`, and `.codex/skills/spec-to-done/SKILL.md`

**Interfaces:**
- The existing assertion script remains the required-check entry point and uses the existing `Assert-True` helper.
- New assertions report the exact file and violated contract.

- [ ] **Step 1: Add the RED line-budget assertions**

```powershell
foreach ($budget in @(
    @{ Path = 'AGENTS.md'; Min = 150; Max = 180 },
    @{ Path = 'CLAUDE.md'; Min = 40; Max = 70 },
    @{ Path = 'docs/agents/advanced-agent-reasoning-contract.md'; Min = 40; Max = 70 },
    @{ Path = 'docs/agents/codex-loop-workflows.md'; Min = 50; Max = 90 }
)) {
    $count = @(Get-Content -LiteralPath $budget.Path).Count
    Assert-True ($count -ge $budget.Min -and $count -le $budget.Max) "$($budget.Path) line budget actual=$count"
}
```

Run `pwsh -NoProfile -File .\\scripts\\tests\\test-agent-governance-check.ps1`. Expected first failure: `AGENTS.md line budget actual=220`.

- [ ] **Step 2: Add source-of-truth and stale-model assertions**

Assert the two overlays contain `C:\\Users\\IOT\\.codex\\docs\\agents\\task-routing.md`, do not contain the generic headings `Task Complexity Tiers`, `Reasoning Effort Routing`, or `Codex Model / Effort Lane Routing`, and that active governance surfaces do not match `(?i)\\bgpt-[0-9]`. Do not scan the approved design spec or these plans.

- [ ] **Step 3: Add config assertions**

Assert `.codex/config.toml` contains `[permissions.safe-workspace.network]`, both approved GitHub domains, and the disabled Cloudflare plugin, while not containing `sandbox_workspace_write`, `sandbox_mode`, `model =`, or `model_reasoning_effort`.

### Task 2: R2 - Canonicalize repo Codex config

**Files:**
- Modify: `.codex/config.toml:1-13`
- Test: `scripts/tests/test-agent-governance-check.ps1`

**Interfaces:**
- The repo overlay grants only trusted project network/filesystem behavior and inherits model/effort from the global profile.

- [ ] **Step 1: Remove the legacy selector**

Delete only `[sandbox_workspace_write]` and its `network_access` key. Keep `[permissions.safe-workspace.network]`, its limited mode, the two GitHub domains, and the disabled Cloudflare plugin.

- [ ] **Step 2: Run the Green checks**

```powershell
pwsh -NoProfile -File .\\scripts\\tests\\test-agent-governance-check.ps1
$env:CODEX_HOME = 'C:\\Users\\IOT\\.codex'
codex --strict-config doctor --summary
```

Expected: assertions pass; doctor exits 0 with no new warning type or count.

- [ ] **Step 3: Commit the isolated config slice**

```powershell
git add .codex/config.toml scripts/tests/test-agent-governance-check.ps1
git commit -m "chore: canonicalize repo Codex config"
```

### Task 3: R3 - Slim repo entrypoints and AI-BIM overlays

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/agents/advanced-agent-reasoning-contract.md`
- Modify: `docs/agents/codex-loop-workflows.md`
- Read-only check: `docs/agents/gitnexus-usage.md`

**Interfaces:**
- `AGENTS.md` keeps product requirements, service boundaries, GitNexus-first rule, IFC fixture rules, deploy/PID/worktree rules, and frontend-operable done evidence.
- `CLAUDE.md` remains a thin adapter with the complete sub-file index.
- Advanced overlay contains only AI-BIM high-risk composition; Codex loop overlay contains only local task-to-role mapping.

- [ ] **Step 1: Preserve generated blocks before editing**

Save byte hashes for the generated blocks identified by `docs/agents/gitnexus-usage.md` (`AGENTS.md` and `CLAUDE.md`) and assert their post-edit hashes are identical.

- [ ] **Step 2: Replace duplicated generic prose**

Reduce root prose to the local requirements and one lazy-load pointer to global routing. Keep all tracked `docs/agents/*.md` paths in both entrypoint indexes. Remove generic tiers, model lanes, and worker output schemas from local files.

- [ ] **Step 3: Write the local role mapping**

Use these mappings only: cross-service/source discovery -> `explorer`; Kit/WebRTC/runtime incident -> `debugger` plus `reviewer`; auth/deploy/permissions/destructive scripts -> `security_auditor` plus `reviewer`; PR/E2E/user-facing done -> `reviewer`; small docs lookup -> single coordinator. Add the local route/button/fixture/API/runtime/screenshot evidence contract.

- [ ] **Step 4: Run the Green checks**

```powershell
pwsh -NoProfile -File .\\scripts\\tests\\test-agent-governance-check.ps1
git diff --check
```

Expected: all assertions pass and generated block hashes remain unchanged.

- [ ] **Step 5: Commit the overlay slice**

```powershell
git add AGENTS.md CLAUDE.md docs/agents/advanced-agent-reasoning-contract.md docs/agents/codex-loop-workflows.md scripts/tests/test-agent-governance-check.ps1
git commit -m "docs: slim AI-BIM agent governance overlays"
```

### Task 4: R4 - Route spec-to-done by role capability

**Files:**
- Modify: `.codex/skills/spec-to-done/SKILL.md:233-249,264`
- Test: `scripts/tests/test-agent-governance-check.ps1`

**Interfaces:**
- Phase order, P4/P5/P6 evidence, HELD values, `ship-item`, and resume semantics remain unchanged.
- The model budget section becomes a capability/role reference to global `task-routing.md`; it contains no exact model slug.

- [ ] **Step 1: Confirm the RED condition**

Run the governance test and capture the exact stale-slug failure in the Codex adapter.

- [ ] **Step 2: Replace only the routing table**

Remove the exact GPT table and replace it with role/capability prose: coordinator uses the selected global profile; `explorer`, `debugger`, `reviewer`, and `security_auditor` are named lanes; effort is selected by global task tier; P4/P5/P6 never downgrade because the adapter runs on Codex.

- [ ] **Step 3: Run the Green and drift checks**

```powershell
pwsh -NoProfile -File .\\scripts\\tests\\test-agent-governance-check.ps1
git diff --no-index -- .claude\\skills\\spec-to-done\\SKILL.md .codex\\skills\\spec-to-done\\SKILL.md
```

Expected: governance assertions pass; the no-index comparison exits 1, and manual review finds differences only in the adapter whitelist.

- [ ] **Step 4: Commit the adapter slice**

```powershell
git add .codex/skills/spec-to-done/SKILL.md scripts/tests/test-agent-governance-check.ps1
git commit -m "docs: route spec-to-done by Codex roles"
```

### Task 5: R5 - Final repository gates

**Files:**
- Test: all files above

- [ ] **Step 1: Run required checks**

```powershell
pwsh -NoProfile -File .\\scripts\\tests\\test-agent-governance-check.ps1
git diff --check
$env:CODEX_HOME = 'C:\\Users\\IOT\\.codex'
codex --strict-config doctor --summary
```

Expected: pass banner, empty diff check, doctor exit 0.

- [ ] **Step 2: Run GitNexus impact before the next plan**

Use `detect_changes(scope=all, worktree=<absolute dedicated worktree>)` and cross-check `git diff --cached --name-only`. Expected: docs/config changes report zero changed symbols or a low-risk result; disclose any unavailable index as a fallback note.

