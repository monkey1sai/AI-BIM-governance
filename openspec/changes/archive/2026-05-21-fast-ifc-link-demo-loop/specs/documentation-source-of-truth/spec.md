# documentation-source-of-truth — Spec Delta (fast-ifc-link-demo-loop)

> Delta against `openspec/specs/documentation-source-of-truth/spec.md`(本檔僅含本 change 的差異)。本 change 在 `AGENTS.md` §3.4 與 `bim-review-coordinator/CLAUDE.md` MUST NOT 段加 carve-out,讓 coordinator 在 ifc-ready intake 階段可同步下載 IFC 至本地 shared volume,作為 dispatch streaming-server 前的臨時通道。

## MODIFIED Requirements

### Requirement: AGENTS.md is the source-of-truth for repo boundary

`AGENTS.md` SHALL remain the single source-of-truth for cross-repo boundary rules, agent behavior, and OpenSpec / GitHub workflow. `CLAUDE.md`(root + per-service), OpenSpec artifacts, Graphify wiki, and installed skills are auxiliary; on conflict, `AGENTS.md` wins.

> **Implementation status (2026-05-21 fast-mvp loop)**: change `fast-ifc-link-demo-loop` 在 `AGENTS.md` §3.4 「`bim-review-coordinator` 不應做的事」段下加一段 carve-out,允許 coordinator 在 `ifc-ready` intake 同步階段下載 IFC 至本地 shared volume 路徑 `storage/ifc-cache/<ifc_ready_job_id>/source.ifc`,作為 dispatch streaming-server 前的臨時通道快取。coordinator 不視為該 IFC bytes 的資料權威;權威仍屬外部公司雲端 control-plane(`external_model_version_id` 參照),streaming-server 為 conversion authority。對應 carve-out 同步寫進 `bim-review-coordinator/CLAUDE.md` MUST NOT 段,並由 spec `local-coordinator-ifc-ready-intake-boundary` 內「Coordinator synchronously downloads IFC to shared volume before responding」requirement 規範行為細節。Transition 過後若另有對接設計(streaming-server 直接從 MinIO pull、或 sidecar service 處理下載),此 carve-out 可在新 OpenSpec change 中收斂回原邊界。

(既有 scenarios 全保留 — 文字 carve-out 屬補述,不改 source-of-truth 優先序)

#### Scenario: AGENTS.md wins on conflict

(unchanged — preserved from existing spec)

- **WHEN** a CLAUDE.md, OpenSpec artifact, or skill description contradicts `AGENTS.md`
- **THEN** the implementation MUST follow `AGENTS.md` and update the conflicting source to align

#### Scenario: Carve-out補述不變更權威歸屬

- **WHEN** the boundary carve-out for coordinator IFC download is read alongside the original "coordinator 不直接保存大型模型檔案 byte" rule
- **THEN** the carve-out MUST be interpreted as a **transient pass-through** allowance, not as transferring data authority — IFC artifact ownership remains with the external cloud control-plane(`external_model_version_id` reference)and conversion authority remains with `bim-streaming-server`
