---
name: omniverse-usd-performance-tuning
description: "Top-level workflow skill for USD performance diagnosis and optimization. Use for slow loading, high memory, low FPS, or 'optimize my scene' requests; delegates auth/runtime setup to Phase 0 owners."
version: "0.1.0"
license: Apache-2.0
tools:
  - Read
  - Shell
  - Write
compatibility: >
  Orchestrator skill. Downstream phases may require Kit, Scene Optimizer, Asset Validator, USD Python, writable output paths, and omniverse:// authentication selected by setup-usd-performance-tuning.
metadata:
  author: NVIDIA Omniverse
  tags:
    - triage
    - performance
    - usd
    - profiling
  domain: ai-ml
  languages:
    - python
---

# Repo discovery adapter

Read `.codex/skills/omniverse-usd-performance-tuning/SKILL.md` from the repository root before using this skill. That file is the canonical procedure; resolve its referenced files and scripts relative to its own directory.

Follow the applicable AGENTS.md and current task authorization. This adapter adds no approval, merge, deployment, credential, or runtime evidence authority.
