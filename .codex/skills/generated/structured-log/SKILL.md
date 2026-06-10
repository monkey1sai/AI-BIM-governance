---
name: structured-log
description: "Skill for the Structured-log area of AI-BIM-governance. 28 symbols across 3 files."
---

# Structured-log

28 symbols | 3 files | Cohesion: 85%

## When to Use

- Working with code in `tests/`
- Understanding how validator, test_schema_is_valid_draft7, test_event_type_enum_covers_seven_documented_values work
- Modifying structured-log-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/contracts/structured-log/test_validate.py` | _load_schema, validator, test_schema_is_valid_draft7, test_event_type_enum_covers_seven_documented_values, test_lifecycle_subject_kinds_match_contract (+6) |
| `tests/contracts/structured-log/test_python_adapter.py` | fixed_clock, test_create_logger_emits_env_snapshot_to_daily_file, test_with_trace_id_shares_run_id_file_and_seq_counters, test_logger_error_captures_name_message_and_stack_tail, test_sink_failure_does_not_throw_and_records_last_failure (+5) |
| `tests/contracts/structured-log/test_cross_service_integration.py` | _persist_raw_record, _grep_records_by_trace, test_one_trace_id_joins_records_across_four_services, test_parent_trace_id_links_review_session_to_ifc_ready_origin, test_grep_by_trace_id_is_sorted_chronologically (+2) |

## Entry Points

Start here when exploring this area:

- **`validator`** (Function) — `tests/contracts/structured-log/test_validate.py:48`
- **`test_schema_is_valid_draft7`** (Function) — `tests/contracts/structured-log/test_validate.py:52`
- **`test_event_type_enum_covers_seven_documented_values`** (Function) — `tests/contracts/structured-log/test_validate.py:92`
- **`test_lifecycle_subject_kinds_match_contract`** (Function) — `tests/contracts/structured-log/test_validate.py:134`
- **`fixed_clock`** (Function) — `tests/contracts/structured-log/test_python_adapter.py:73`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `validator` | Function | `tests/contracts/structured-log/test_validate.py` | 48 |
| `test_schema_is_valid_draft7` | Function | `tests/contracts/structured-log/test_validate.py` | 52 |
| `test_event_type_enum_covers_seven_documented_values` | Function | `tests/contracts/structured-log/test_validate.py` | 92 |
| `test_lifecycle_subject_kinds_match_contract` | Function | `tests/contracts/structured-log/test_validate.py` | 134 |
| `fixed_clock` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 73 |
| `test_create_logger_emits_env_snapshot_to_daily_file` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 165 |
| `test_with_trace_id_shares_run_id_file_and_seq_counters` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 248 |
| `test_logger_error_captures_name_message_and_stack_tail` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 313 |
| `test_sink_failure_does_not_throw_and_records_last_failure` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 337 |
| `test_logger_writes_all_event_types_passing_schema` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 189 |
| `test_circular_reference_does_not_crash_emit` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 274 |
| `test_daily_rotate_opens_new_file_on_utc_date_change` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 291 |
| `test_bim_trace_id_env_overrides_default_initial_trace` | Function | `tests/contracts/structured-log/test_python_adapter.py` | 358 |
| `test_one_trace_id_joins_records_across_four_services` | Function | `tests/contracts/structured-log/test_cross_service_integration.py` | 106 |
| `test_parent_trace_id_links_review_session_to_ifc_ready_origin` | Function | `tests/contracts/structured-log/test_cross_service_integration.py` | 296 |
| `test_grep_by_trace_id_is_sorted_chronologically` | Function | `tests/contracts/structured-log/test_cross_service_integration.py` | 335 |
| `test_valid_fixture_passes_schema` | Function | `tests/contracts/structured-log/test_validate.py` | 73 |
| `test_invalid_fixture_fails_schema` | Function | `tests/contracts/structured-log/test_validate.py` | 83 |
| `test_valid_fixture_count_meets_minimum` | Function | `tests/contracts/structured-log/test_validate.py` | 57 |
| `test_invalid_fixture_count_meets_minimum` | Function | `tests/contracts/structured-log/test_validate.py` | 64 |

## How to Explore

1. `gitnexus_context({name: "validator"})` — see callers and callees
2. `gitnexus_query({query: "structured-log"})` — find related execution flows
3. Read key files listed above for implementation details
