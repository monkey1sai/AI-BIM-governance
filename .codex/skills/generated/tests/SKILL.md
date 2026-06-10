---
name: tests
description: "Skill for the Tests area of AI-BIM-governance. 189 symbols across 25 files."
---

# Tests

189 symbols | 25 files | Cohesion: 89%

## When to Use

- Working with code in `bim-streaming-server/`
- Understanding how test_identity_authoring_writes_psets_and_spatial_relationships_as_sidecars, test_sidecar_ordinal_mapping_is_explicitly_not_guid_exact, test_identity_profile_convert_uses_ifc_directly_without_powershell_or_revit work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `bim-streaming-server/tests/test_host_native_conversion_service.py` | _clear_pxr_test_stubs, _install_fake_identity_ifcopenshell, test_identity_authoring_writes_psets_and_spatial_relationships_as_sidecars, test_sidecar_ordinal_mapping_is_explicitly_not_guid_exact, test_identity_profile_convert_uses_ifc_directly_without_powershell_or_revit (+79) |
| `bim-streaming-server/tests/test_conversion_authority_api.py` | make_client, ifc_ready_payload, job_file_count, test_ifc_ready_creates_queued_streaming_conversion_job, test_b_scheme_request_does_not_require_retired_worker_ids (+22) |
| `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/ifc2usdc_powershell_adapter.py` | _materialize_sidecars, _adopt_converter_sidecars, _enumerate_usd_stage, _read_ifc_custom_data, _load_ifc_semantic_sidecar (+11) |
| `services/kit-manager-api/tests/test_kit_service_runtime_status.py` | make_service, test_open_artifacts_marks_open_when_control_command_is_sent, test_close_instance_marks_closed_when_control_command_is_sent, test_open_artifacts_marks_blocked_when_control_is_blocked, test_close_instance_marks_blocked_when_control_is_blocked (+3) |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/tests/test_extensions.py` | _wait, wait_stage_loading, _get_1_1_1_rotation, _validate_extensions_load, test_l1_extensions_load |
| `services/kit-manager-api/tests/test_settings_cors.py` | test_cors_origins_defaults_to_wildcard_when_unset, test_cors_origins_parses_comma_separated_allowlist, test_cors_origins_empty_string_falls_back_to_wildcard, test_cors_origins_comma_only_falls_back_to_wildcard |
| `tests/test_contracts_and_fakes.py` | _contract, test_ifc_ready_contract_parses_with_required_fields, test_conversion_result_callback_contract_metadata_only, test_ifc_ready_contract_includes_image_derived_worker_compatibility_payload |
| `bim-streaming-server/templates/extensions/usd_explorer.setup/template/{{python_module_path}}/tests/test_app_startup.py` | app_startup_time, test_l1_app_startup_time, app_startup_warning_count, test_l1_app_startup_warning_count |
| `bim-streaming-server/templates/extensions/usd_composer.setup/template/{{python_module_path}}/tests/test_app_startup.py` | app_startup_time, test_l1_app_startup_time, app_startup_warning_count, test_l1_app_startup_warning_count |
| `bim-review-coordinator/tests/conversion-dispatch-queue.test.ts` | startControllableStreamingStub, send, releaseNext |

## Entry Points

Start here when exploring this area:

- **`test_identity_authoring_writes_psets_and_spatial_relationships_as_sidecars`** (Function) — `bim-streaming-server/tests/test_host_native_conversion_service.py:905`
- **`test_sidecar_ordinal_mapping_is_explicitly_not_guid_exact`** (Function) — `bim-streaming-server/tests/test_host_native_conversion_service.py:980`
- **`test_identity_profile_convert_uses_ifc_directly_without_powershell_or_revit`** (Function) — `bim-streaming-server/tests/test_host_native_conversion_service.py:1007`
- **`test_enumeration_path_writes_semantic_fields`** (Function) — `bim-streaming-server/tests/test_host_native_conversion_service.py:1721`
- **`test_enumeration_path_empty_custom_data_stays_honest`** (Function) — `bim-streaming-server/tests/test_host_native_conversion_service.py:1767`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `FakeSuccessfulConverter` | Class | `bim-streaming-server/tests/test_conversion_authority_api.py` | 25 |
| `FakeIdentityConverter` | Class | `bim-streaming-server/tests/test_conversion_authority_api.py` | 62 |
| `FakePlaceholderConverter` | Class | `bim-streaming-server/tests/test_conversion_authority_api.py` | 87 |
| `FakePlaceholderBeyondPrefixConverter` | Class | `bim-streaming-server/tests/test_conversion_authority_api.py` | 306 |
| `FakeSuccessfulConverter` | Class | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 32 |
| `test_identity_authoring_writes_psets_and_spatial_relationships_as_sidecars` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 905 |
| `test_sidecar_ordinal_mapping_is_explicitly_not_guid_exact` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 980 |
| `test_identity_profile_convert_uses_ifc_directly_without_powershell_or_revit` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1007 |
| `test_enumeration_path_writes_semantic_fields` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1721 |
| `test_enumeration_path_empty_custom_data_stays_honest` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1767 |
| `test_adopt_path_supplements_missing_semantic_fields` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1800 |
| `test_adopt_path_does_not_overwrite_existing_semantic` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 1849 |
| `test_enumeration_reads_sidecar_when_prim_custom_data_empty` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 2030 |
| `test_enumeration_prefers_prim_custom_data_over_sidecar` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 2083 |
| `test_materialize_sidecars_runs_sidecar_pass_when_hoops_has_no_ifc_custom_data` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 2124 |
| `test_materialize_runs_sidecar_pass_when_adopt_returns_semantic_falsy` | Function | `bim-streaming-server/tests/test_host_native_conversion_service.py` | 2236 |
| `make_client` | Function | `bim-streaming-server/tests/test_conversion_authority_api.py` | 99 |
| `ifc_ready_payload` | Function | `bim-streaming-server/tests/test_conversion_authority_api.py` | 112 |
| `job_file_count` | Function | `bim-streaming-server/tests/test_conversion_authority_api.py` | 137 |
| `test_ifc_ready_creates_queued_streaming_conversion_job` | Function | `bim-streaming-server/tests/test_conversion_authority_api.py` | 141 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → _path` | cross_community | 4 |
| `Main → _default_powershell_exe` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Messaging | 10 calls |

## How to Explore

1. `gitnexus_context({name: "test_identity_authoring_writes_psets_and_spatial_relationships_as_sidecars"})` — see callers and callees
2. `gitnexus_query({query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
