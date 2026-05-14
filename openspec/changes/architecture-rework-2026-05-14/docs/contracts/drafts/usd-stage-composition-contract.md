# Draft Contract: USD stage composition

## openStageRequest v2

```json
{
  "event_type": "openStageRequest",
  "payload": {
    "mode": "stage_composition_v2",
    "stage_composition": {
      "primary": {
        "artifact_id": "artifact_usdc_A",
        "url": "http://127.0.0.1:49100/artifacts/A/model.usdc",
        "role": "primary_root_layer"
      },
      "secondary_layers": [
        {
          "artifact_id": "artifact_usdc_B",
          "url": "http://127.0.0.1:49100/artifacts/B/model.usdc",
          "role": "secondary_sub_layer",
          "order": 10
        },
        {
          "artifact_id": "artifact_usdc_C",
          "url": "http://127.0.0.1:49100/artifacts/C/model.usdc",
          "role": "secondary_sub_layer",
          "order": 20
        }
      ],
      "session_layer": {
        "enabled": true,
        "purpose": "runtime_review_overrides"
      }
    }
  }
}
```

## openedStageResult v2

```json
{
  "event_type": "openedStageResult",
  "payload": {
    "ok": true,
    "applied_mode": "stage_composition_v2",
    "applied_primary": "artifact_usdc_A",
    "applied_secondary_layers": ["artifact_usdc_B"],
    "skipped_secondary_layers": [
      {
        "artifact_id": "artifact_usdc_C",
        "reason": "layer_not_found"
      }
    ],
    "stage_summary": {
      "root_layer": "artifact_usdc_A",
      "session_layer_enabled": true,
      "sub_layer_count": 1
    }
  }
}
```
