# Structured log contract test fixtures

Each `.jsonl` file in `valid/` and `invalid/` contains **exactly one** structured log record. The shared validators (`bim-review-coordinator/tests/contracts/structured-log/validate.contract.test.ts` for TS via ajv, `tests/contracts/structured-log/test_validate.py` for Python via `jsonschema`) read every fixture from both directories and assert:

- Records in `valid/` MUST pass schema validation.
- Records in `invalid/` MUST fail schema validation.

When adding a new fixture:

1. Keep one record per file (no multi-line JSONL inside a fixture).
2. Use realistic field values; never embed real credentials.
3. Use file name `<event_type>-<case>.jsonl` (valid) or `<violation>.jsonl` (invalid).
4. After adding, run both TS and Python validators to confirm the expected verdict.
