# Review MVP v0.2 Baseline

> Historical note: this baseline predates the worker-only runtime. Mentions of `_s3_storage`, `_conversion-service`, `_conversion-server`, ports `8002` / `8003`, or `/static/projects/...` are archival context only. Current behavior is governed by `AGENTS.md`, `README.md`, and `docs/contracts/worker-api.md`.

This baseline records the local review MVP boundary used before the v0.3 Demo UI pass.

Canonical local loop:

```txt
_bim-control metadata
→ _s3_storage model files
→ _conversion-service conversion API
→ bim-review-coordinator session and Socket.IO
→ web-viewer-sample browser UI
→ bim-streaming-server DataChannel runtime
```

Current validation and acceptance status lives in:

```txt
docs/plans/BIM_REVIEW_MVP_COMPLETION_PLAN_v0_3_DEMO_UI.md
```
