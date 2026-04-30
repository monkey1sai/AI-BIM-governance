# Review MVP v0.2 Baseline

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
