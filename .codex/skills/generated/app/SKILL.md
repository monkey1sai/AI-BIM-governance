---
name: app
description: "Skill for the App area of AI-BIM-governance. 20 symbols across 5 files."
---

# App

20 symbols | 5 files | Cohesion: 100%

## When to Use

- Working with code in `services/`
- Understanding how open_selected, close_instance, current_instance work
- Modifying app-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `services/kit-manager-api/app/kit_service.py` | open_artifacts, close_instance, _stage_composition_payload, _runtime_status, get_state (+1) |
| `services/kit-manager-api/app/main.py` | open_selected, close_instance, current_instance, list_usdc |
| `services/kit-manager-api/app/usdc_repository.py` | __init__, list_artifacts, resolve, _artifact_id |
| `bim-review-coordinator/tests/app/viewerLogIntake.test.ts` | baseRecord, records, valid |
| `services/kit-manager-api/app/kit_gateway.py` | open_stage, close_stage, _post |

## Entry Points

Start here when exploring this area:

- **`open_selected`** (Function) — `services/kit-manager-api/app/main.py:45`
- **`close_instance`** (Function) — `services/kit-manager-api/app/main.py:52`
- **`current_instance`** (Function) — `services/kit-manager-api/app/main.py:37`
- **`list_usdc`** (Function) — `services/kit-manager-api/app/main.py:41`
- **`open_artifacts`** (Method) — `services/kit-manager-api/app/kit_service.py:15`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `open_selected` | Function | `services/kit-manager-api/app/main.py` | 45 |
| `close_instance` | Function | `services/kit-manager-api/app/main.py` | 52 |
| `current_instance` | Function | `services/kit-manager-api/app/main.py` | 37 |
| `list_usdc` | Function | `services/kit-manager-api/app/main.py` | 41 |
| `open_artifacts` | Method | `services/kit-manager-api/app/kit_service.py` | 15 |
| `close_instance` | Method | `services/kit-manager-api/app/kit_service.py` | 32 |
| `list_artifacts` | Method | `services/kit-manager-api/app/usdc_repository.py` | 8 |
| `resolve` | Method | `services/kit-manager-api/app/usdc_repository.py` | 26 |
| `open_stage` | Method | `services/kit-manager-api/app/kit_gateway.py` | 10 |
| `close_stage` | Method | `services/kit-manager-api/app/kit_gateway.py` | 13 |
| `get_state` | Method | `services/kit-manager-api/app/kit_service.py` | 48 |
| `list_usdc` | Method | `services/kit-manager-api/app/kit_service.py` | 12 |
| `baseRecord` | Function | `bim-review-coordinator/tests/app/viewerLogIntake.test.ts` | 9 |
| `records` | Function | `bim-review-coordinator/tests/app/viewerLogIntake.test.ts` | 74 |
| `valid` | Function | `bim-review-coordinator/tests/app/viewerLogIntake.test.ts` | 90 |
| `_stage_composition_payload` | Method | `services/kit-manager-api/app/kit_service.py` | 51 |
| `_runtime_status` | Method | `services/kit-manager-api/app/kit_service.py` | 64 |
| `__init__` | Method | `services/kit-manager-api/app/usdc_repository.py` | 5 |
| `_artifact_id` | Method | `services/kit-manager-api/app/usdc_repository.py` | 33 |
| `_post` | Method | `services/kit-manager-api/app/kit_gateway.py` | 16 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Open_selected → _stage_composition_payload` | intra_community | 3 |
| `Open_selected → _runtime_status` | intra_community | 3 |
| `Close_instance → _runtime_status` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "open_selected"})` — see callers and callees
2. `gitnexus_query({query: "app"})` — find related execution flows
3. Read key files listed above for implementation details
