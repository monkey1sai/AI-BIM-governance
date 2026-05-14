# Draft Contract: demo readiness evidence v2

## Evidence tiers

```txt
rvt_intake                    _bim-control
rvt_to_ifc_bridge             _worker
streaming_conversion_job      bim-streaming-server
mapping_quality               bim-streaming-server
coordinator_session_lifecycle bim-review-coordinator
single_kit_render             bim-streaming-server + web-viewer-sample
single_kit_multi_viewer       coordinator + streaming + viewer
usd_stage_composition         coordinator + streaming
```

## Status values

```txt
passed
failed
blocked
deferred
not_observed
```

## Evidence JSON skeleton

```json
{
  "observed_at": "2026-05-14T00:00:00+08:00",
  "architecture_scheme": "B",
  "tiers": {
    "rvt_intake": {
      "status": "passed",
      "owner": "_bim-control",
      "evidence": { "source_artifact_id": "artifact_rvt_demo_001" }
    },
    "rvt_to_ifc_bridge": {
      "status": "blocked",
      "owner": "_worker",
      "blocker": { "code": "REVIT_RUNTIME_UNAVAILABLE" }
    },
    "streaming_conversion_job": {
      "status": "not_observed",
      "owner": "bim-streaming-server",
      "reason": "No ifc_ready handoff received in this run"
    }
  }
}
```

## Invariants

- Historical `_worker` IFC→USDC evidence cannot mark `streaming_conversion_job` as passed.
- Conversion readiness cannot mark WebRTC readiness as passed.
- Coordinator lifecycle pass cannot mark model readiness as passed.
- Missing Revit license is a bridge blocker, not a conversion failure.
