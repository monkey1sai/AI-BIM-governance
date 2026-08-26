# P2: Autonomous PR Queue Management & Skills Deduplication Plan

> **Implementation authorization:** This plan establishes concrete actionable steps to build the autonomous PR queue management system (auto-merge, auto-fix, auto-update branch, auto-resolve conflict) and registers the pr-queue-manager skill. Following the superpowers lifecycle: Plan -> Worktree -> Implement -> Verify -> PR -> Code Review -> Merge to main.

**Goal:** Provide an end-to-end autonomous PR queue management engine (scripts/dev/manage-pr-queue.mjs) and skill (pr-queue-manager) allowing agents to automatically update stale branches, resolve trivial conflicts, fix metadata/CI issues, submit counted blip approvals, and squash-merge green PRs.

**Architecture:**
- Create scripts/dev/manage-pr-queue.mjs handling queue status, branch updating, conflict resolution, counted approval triggering, and squash merge.
- Create .agents/skills/pr-queue-manager/SKILL.md as canonical skill.
- Sync skill across .claude/skills and .codex/skills and update agent-skills-manifest.json.
- Single PR delivery under Lean Governance.

**Tech Stack:** Node.js (ESM), GitHub CLI (gh), Git CLI, PowerShell (pwsh).

## Global Constraints
- Single Active Writer principle.
- Sibling worktree isolation during implementation.
- Must support exact-head verification and counted review rules.
- Single atomic PR delivery.

---

### Task 1: Implement Autonomous PR Queue Manager Engine (scripts/dev/manage-pr-queue.mjs)
- [ ] **Step 1.1: Build status command** (query open PRs, base/head SHAs, mergeable state, CI check states, review decisions).
- [ ] **Step 1.2: Build update-branch & auto-resolve-conflict command** (auto-fetch origin/main, rebase PR branch, auto-resolve trivial docs/metadata conflicts, push).
- [ ] **Step 1.3: Build auto-fix & approve command** (ensure compliant metadata table, call run_blip_human_equivalent_approve_once.ps1).
- [ ] **Step 1.4: Build merge & process-queue command** (poll CI checks, execute squash merge, prune local/remote branches).

### Task 2: Create Canonical Skill & Align Manifest
- [ ] **Step 2.1: Author .agents/skills/pr-queue-manager/SKILL.md**.
- [ ] **Step 2.2: Update agent-skills-manifest.json and sync skills**.

### Task 3: Local Verification, PR, Review & Merge
- [ ] **Step 3.1: Verify manage-pr-queue.mjs on active open PRs**.
- [ ] **Step 3.2: Run local preflight and commit**.
- [ ] **Step 3.3: Open PR, submit approval, pass CI, merge to main**.
