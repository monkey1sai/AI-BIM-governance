---
name: messaging
description: "Skill for the Messaging area of AI-BIM-governance. 141 symbols across 10 files."
---

# Messaging

141 symbols | 10 files | Cohesion: 82%

## When to Use

- Working with code in `bim-streaming-server/`
- Understanding how open_stage, test_identity_path_generation_is_deterministic_usd_safe_and_preserves_originals, usd_safe_identifier work
- Modifying messaging-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/struct_log.py` | debug, info, warn, network, audit (+33) |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py` | get_conversion, get_conversion_result, get_conversion_job, complete_conversion_job, _callback_payload (+26) |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py` | _stage_has_lights, _ensure_default_lighting, _is_http_stage_url, _payload_dict, _payload_list (+15) |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc_openusd_identity_author.py` | usd_safe_identifier, build_identity_root_path, author, _make_iterator, _unique_root_path (+10) |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py` | _run_ifcopenshell_openusd_fallback, _safe_usd_prim_name, _resolve_ifc_class_token, _resolve_guid_token, _usd_mesh_data_from_ifcopenshell (+5) |
| `bim-streaming-server/tests/test_host_native_conversion_service.py` | test_identity_path_generation_is_deterministic_usd_safe_and_preserves_originals, test_ifcopenshell_openusd_fallback_writes_openable_usdc_and_sidecars, test_ifcopenshell_openusd_fallback_missing_dependency_remains_unavailable, test_ifcopenshell_openusd_fallback_rejects_no_renderable_geometry, _config (+4) |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_management.py` | _payload_list, _payload_dict, _resolve_selectable_prim_path, _on_highlight_prims, _on_focus_prim (+2) |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/kit_struct_log.py` | _parse_trace_id_from_argv, _resolve_initial_trace_id, get_logger, log_kit_startup_lifecycle, log_kit_shutdown_lifecycle |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/host_native_conversion_service.py` | _repo_root, load_config, build_app, main |
| `bim-streaming-server/tests/test_conversion_authority_api.py` | test_ifc_artifact_propagates_local_paths_when_present, test_ifc_artifact_local_paths_default_to_none_when_absent |

## Entry Points

Start here when exploring this area:

- **`open_stage`** (Function) — `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py:630`
- **`test_identity_path_generation_is_deterministic_usd_safe_and_preserves_originals`** (Function) — `bim-streaming-server/tests/test_host_native_conversion_service.py:711`
- **`usd_safe_identifier`** (Function) — `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc_openusd_identity_author.py:29`
- **`build_identity_root_path`** (Function) — `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc_openusd_identity_author.py:45`
- **`test_ifcopenshell_openusd_fallback_writes_openable_usdc_and_sidecars`** (Function) — `bim-streaming-server/tests/test_host_native_conversion_service.py:1200`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `StructLogger` | Class | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/struct_log.py` | 433 |
| `open_stage` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py` | 630 |
| `test_identity_path_generation_is_deterministic_usd_safe_and_preserves_originals` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 711 |
| `usd_safe_identifier` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc_openusd_identity_author.py` | 29 |
| `build_identity_root_path` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc_openusd_identity_author.py` | 45 |
| `test_ifcopenshell_openusd_fallback_writes_openable_usdc_and_sidecars` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1200 |
| `test_ifcopenshell_openusd_fallback_missing_dependency_remains_unavailable` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1278 |
| `test_ifcopenshell_openusd_fallback_rejects_no_renderable_geometry` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1306 |
| `get_conversion` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py` | 144 |
| `get_conversion_result` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py` | 154 |
| `test_load_config_defaults_to_local_conversion_port` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 135 |
| `test_host_native_load_config_reads_token_from_env` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 207 |
| `load_config` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/host_native_conversion_service.py` | 55 |
| `build_app` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/host_native_conversion_service.py` | 104 |
| `main` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/host_native_conversion_service.py` | 159 |
| `create_conversion_api_app` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py` | 71 |
| `test_ifc_artifact_propagates_local_paths_when_present` | Function | `bim-streaming-server/tests/test_conversion_authority_api.py` | 510 |
| `test_ifc_artifact_local_paths_default_to_none_when_absent` | Function | `bim-streaming-server/tests/test_conversion_authority_api.py` | 528 |
| `list_conversions` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py` | 126 |
| `load_allowlist` | Function | `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/struct_log.py` | 173 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Create_logger → Iso_utc_ms` | cross_community | 8 |
| `Fatal → Iso_utc_ms` | cross_community | 7 |
| `Network → Iso_utc_ms` | cross_community | 7 |
| `Audit → Iso_utc_ms` | cross_community | 7 |
| `Lifecycle → Iso_utc_ms` | cross_community | 7 |
| `Anomaly → Iso_utc_ms` | cross_community | 7 |
| `Error → Iso_utc_ms` | cross_community | 7 |
| `Create_logger → _default_allowlist_path` | cross_community | 6 |
| `Open_stage → _http_stage_host_key` | cross_community | 6 |
| `Open_stage → _http_stage_allowed_hosts` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tests | 5 calls |

## How to Explore

1. `gitnexus_context({name: "open_stage"})` — see callers and callees
2. `gitnexus_query({query: "messaging"})` — find related execution flows
3. Read key files listed above for implementation details
