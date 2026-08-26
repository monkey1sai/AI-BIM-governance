# Phase 1: Lean Governance & Environment Hygiene Implementation Plan

> **✅ 全數完成並合入 main（2026-08-26）**：PR #709，Commit `73f62a5`。
> **Implementation authorization:** This plan establishes concrete actionable steps to address the findings from the 3-layer cross-adversarial analysis. Following the superpowers lifecycle: Propose/Plan -> Worktree -> Implement -> Local Preflight -> PR -> Code Review -> Merge to main.

**Goal:** Fix Python test dependencies (openpyxl for governance-service), clean up stale git worktrees and bloated ETL logs, unify duplicated skills directories, and ensure reproducible local testing.

**Architecture:**
- Isolate execution in sibling git worktree (../AI-BIM-governance.worktrees/phase1-lean-hygiene-and-env-repair).
- Resolve environment dependencies in .venv with uv pip install.
- Prune stale worktrees and clear non-essential 2GB .etl trace caches.
- Provide single source of truth for agent skills across .agents/skills, .claude/skills, and .codex/skills.
- Follow Single Active Writer and single PR delivery guidelines.

**Tech Stack:** Python 3.12, uv, pytest, git, PowerShell / bash, GitHub CLI (gh).

## Global Constraints
- Python virtual environment MUST use .venv\Scripts\python.exe (Windows).
- No global pip.
- No direct commit to main; all changes via dedicated worktree + PR.
- PR delivery in single atomic PR (no 3-PR rituals).

---

### Task 1: Fix Python Virtual Environment & Governance Test Suite
- [x] **Step 1.1: Install missing requirements into .venv**
- [x] **Step 1.2: Run governance-service pytest suite**

### Task 2: Deduplicate & Align Skills Across Agent Directories
- [x] **Step 2.1: Audit and align skills structure**

### Task 3: Clean Stale Worktrees and Purge Bloated Streaming Logs
- [x] **Step 3.1: Prune disconnected git worktree registrations**
- [x] **Step 3.2: Remove abandoned .etl performance traces**

### Task 4: Local Verification, PR Creation & Code Review Cycle
- [x] **Step 4.1: Run local preflight verification**
- [x] **Step 4.2: Commit and push branch to GitHub**
- [x] **Step 4.3: Open Pull Request with compliant PR template**
- [x] **Step 4.4: Execute Code Review and address any findings**
- [x] **Step 4.5: Approve and merge PR to main; clean up worktree**
