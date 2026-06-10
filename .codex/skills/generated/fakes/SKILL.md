---
name: fakes
description: "Skill for the Fakes area of AI-BIM-governance. 20 symbols across 4 files."
---

# Fakes

20 symbols | 4 files | Cohesion: 100%

## When to Use

- Working with code in `tests/`
- Understanding how test_cloud_bim_control_double_records_callbacks_and_filters, test_metadata_only_guard_rejects_embedded_model_body, walk work
- Modifying fakes-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/fakes/cloud_bim_control_api.py` | record_callback, _assert_metadata_only, walk, get_callbacks, last_callback (+6) |
| `tests/fakes/external_ifc_worker_client.py` | load_contract, build_ifc_ready_payload, build_worker_compatibility_payload, auth_headers, post_ifc_ready |
| `tests/test_contracts_and_fakes.py` | test_cloud_bim_control_double_records_callbacks_and_filters, test_metadata_only_guard_rejects_embedded_model_body, test_control_plane_read_doubles_answer_locally |
| `bim-streaming-server/templates/extensions/basic_cpp/template/plugins/{{extension_name}}/CppExtension.cpp` | onShutdown |

## Entry Points

Start here when exploring this area:

- **`test_cloud_bim_control_double_records_callbacks_and_filters`** (Function) — `tests/test_contracts_and_fakes.py:87`
- **`test_metadata_only_guard_rejects_embedded_model_body`** (Function) — `tests/test_contracts_and_fakes.py:99`
- **`walk`** (Function) — `tests/fakes/cloud_bim_control_api.py:55`
- **`load_contract`** (Function) — `tests/fakes/external_ifc_worker_client.py:27`
- **`build_ifc_ready_payload`** (Function) — `tests/fakes/external_ifc_worker_client.py:31`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `test_cloud_bim_control_double_records_callbacks_and_filters` | Function | `tests/test_contracts_and_fakes.py` | 87 |
| `test_metadata_only_guard_rejects_embedded_model_body` | Function | `tests/test_contracts_and_fakes.py` | 99 |
| `walk` | Function | `tests/fakes/cloud_bim_control_api.py` | 55 |
| `load_contract` | Function | `tests/fakes/external_ifc_worker_client.py` | 27 |
| `build_ifc_ready_payload` | Function | `tests/fakes/external_ifc_worker_client.py` | 31 |
| `build_worker_compatibility_payload` | Function | `tests/fakes/external_ifc_worker_client.py` | 41 |
| `auth_headers` | Function | `tests/fakes/external_ifc_worker_client.py` | 54 |
| `post_ifc_ready` | Function | `tests/fakes/external_ifc_worker_client.py` | 62 |
| `test_control_plane_read_doubles_answer_locally` | Function | `tests/test_contracts_and_fakes.py` | 107 |
| `load_contract` | Function | `tests/fakes/cloud_bim_control_api.py` | 105 |
| `example_callback` | Function | `tests/fakes/cloud_bim_control_api.py` | 109 |
| `record_callback` | Method | `tests/fakes/cloud_bim_control_api.py` | 45 |
| `get_callbacks` | Method | `tests/fakes/cloud_bim_control_api.py` | 79 |
| `last_callback` | Method | `tests/fakes/cloud_bim_control_api.py` | 84 |
| `seed_model_version` | Method | `tests/fakes/cloud_bim_control_api.py` | 88 |
| `get_model_version_artifacts` | Method | `tests/fakes/cloud_bim_control_api.py` | 94 |
| `get_review_issues` | Method | `tests/fakes/cloud_bim_control_api.py` | 97 |
| `reset` | Method | `tests/fakes/cloud_bim_control_api.py` | 100 |
| `onShutdown` | Method | `bim-streaming-server/templates/extensions/basic_cpp/template/plugins/{{extension_name}}/CppExtension.cpp` | 66 |
| `_assert_metadata_only` | Method | `tests/fakes/cloud_bim_control_api.py` | 54 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Post_ifc_ready → Load_contract` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "test_cloud_bim_control_double_records_callbacks_and_filters"})` — see callers and callees
2. `gitnexus_query({query: "fakes"})` — find related execution flows
3. Read key files listed above for implementation details
