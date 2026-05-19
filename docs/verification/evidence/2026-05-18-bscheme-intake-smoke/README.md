# B-scheme intake smoke evidence

Generated with:

```powershell
powershell -NoProfile -File scripts\smoke-bscheme-intake.ps1
```

Current 2026-05-19 result in this worktree:

| Tier | Status | Evidence |
|---|---|---|
| `external_ifc_ready_intake` | `passed` | repo-root contract/fake pytest passed |
| `real_ifc_fixture` | `blocked` | current `storage/*.ifc` has 0 IFC files |
| `real_ifc_intake_conversion` | `blocked` | not run because current `storage/*.ifc` is empty |
| `coordinator_session_lifecycle` | `passed` | `bim-review-coordinator` build + vitest passed |
| `streaming_internal_conversion` | `passed` | streaming conversion authority pytest 10 passed |
| `mapping_quality` | `not_observed` | no real streaming-owned conversion result was produced |
| `cloud_callback_outbox` | `passed` | coordinator callback outbox tests passed |
| `runtime_image_kit_launcher` | `deferred` | Docker engine not available, so Kit launcher was not validated |
| `single_kit_render` | `deferred` | no live Kit/WebRTC render evidence collected |
| `single_kit_multi_viewer` | `not_observed` | no browser multi-viewer evidence collected |
| `usd_stage_composition` | `not_observed` | no live USD stage composition evidence collected |

Machine-readable evidence:

- `bscheme-readiness.json`
- `../2026-05-18-t0-kit-launcher/kit-launcher-readiness.json`

To collect live real IFC evidence, place a real `.ifc` directly under `storage/`, start `bim-review-coordinator` on `8004`, start a streaming conversion API on `49101`, then rerun the command above.
