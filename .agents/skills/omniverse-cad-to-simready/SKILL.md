---
name: omniverse-cad-to-simready
description: "Coordinate the end-to-end CAD/source-asset to SimReady workflow. Use for broad requests such as CAD to SimReady, source asset to simulation-ready USD, or prop packaging that require conversion, material/physics assignment, SimReady conformance, validation, and optional package creation; deploy or verify Content Agents services first when property assignment is enabled; route single-stage work through nested references."
version: "0.1.0"
license: Apache-2.0
tools:
  - Read
  - Shell
compatibility: >
  Orchestrator skill. Managed Content Agents deployment requires NVIDIA_API_KEY
  (build.nvidia.com), Docker + NVIDIA Container Toolkit + GPU, Python 3.12, and
  an upstream checkout of nvidia-omniverse/content-agents on branch
  main. Reused/provided endpoints may instead use explicit endpoint and
  usage-token environment variables. Linux/macOS only.
metadata:
  author: Omniverse
  tags:
    - physical-ai
    - simready
    - workflow
    - cad
    - conversion
  domain: ai-ml
  languages:
    - python
---

# Repo discovery adapter

Read `.codex/skills/omniverse-cad-to-simready/SKILL.md` from the repository root before using this skill. That file is the canonical procedure; resolve its referenced files and scripts relative to its own directory.

Follow the applicable AGENTS.md and current task authorization. This adapter adds no approval, merge, deployment, credential, or runtime evidence authority.
