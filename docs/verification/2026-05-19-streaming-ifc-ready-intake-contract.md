# Streaming IFC-ready Intake Contract Slice Verification (2026-05-19)

## Scope

Change id: `streaming-ifc-ready-intake-contract`

This is a streaming-only slice. It formalizes the existing `bim-streaming-server`
internal conversion adapter at `POST /api/conversions/ifc-to-usdc` with:

- optional internal service-token auth via `X-Internal-Conversion-Token`
- idempotency by `idempotency_key`, falling back to `event_id`
- 409 conflict for reused idempotency keys with incompatible payloads
- 400/401/403 request rejection without creating conversion jobs

This slice does not make `bim-streaming-server` the official external IFC-ready
entry point. Per `AGENTS.md` and Phase B, official external intake remains
`bim-review-coordinator` `POST /api/external/ifc-ready`.

## Impact Analysis

GitNexus index status on 2026-05-19:

- `mcp__gitnexus__.list_repos` reported the indexed `AI-BIM-governance` repo was stale.
- `npx gitnexus analyze` inside the sandbox failed with `Not inside a git repository`.
- Escalated analyzer refresh was rejected because it may export/index repository content externally.
- Result: impact analysis below uses the existing GitNexus index plus local file inspection.

Impact results used before editing:

- API route `/api/conversions/ifc-to-usdc`: LOW
  - direct consumers: 0
  - affected flows: 11
- Symbol `create_conversion`: LOW
  - impacted symbols: 0
- Method `StreamingConversionStore.create_conversion_job`: LOW
  - direct caller: `create_conversion`
  - affected module: `Messaging`
- Function `_safe_id`: HIGH
  - affected flows include `create_conversion`, `get_conversion`, `get_conversion_result`, and `complete_conversion_job`
  - mitigation: this slice did not modify `_safe_id`

## TDD Evidence

RED:

```powershell
python -m pytest bim-streaming-server/tests/test_conversion_authority_api.py -q
```

Expected failure observed after adding tests first:

- `TypeError: ConversionAuthoritySettings.__init__() got an unexpected keyword argument 'internal_conversion_token'`
- 10 tests failed because the new setting and behavior were not implemented yet.

GREEN:

```powershell
python -m pytest bim-streaming-server/tests/test_conversion_authority_api.py -q
```

Result:

```txt
10 passed in 0.62s
```

Known warning:

- `PytestDeprecationWarning` from `pytest_asyncio` about unset `asyncio_default_fixture_loop_scope`; not introduced by this slice.

OpenSpec validation:

```powershell
openspec validate streaming-ifc-ready-intake-contract --strict
openspec validate --specs --strict
```

Result:

```txt
Change 'streaming-ifc-ready-intake-contract' is valid
Totals: 23 passed, 0 failed (23 items)
```

Whitespace check:

```powershell
git -c safe.directory=C:/Users/IOT/.codex/worktrees/6c0e/AI-BIM-governance diff --check
```

Result: exit code 0. Git reported LF -> CRLF warnings for the two touched Python files; no whitespace errors.

GitNexus `detect_changes`:

- MCP `detect_changes` with repo `C:\Users\IOT\.codex\worktrees\6c0e\AI-BIM-governance` failed because this current worktree is not indexed.
- CLI `gitnexus detect-changes` failed because multiple repos are indexed and this current worktree is not one of the available indexed repos.
- Analyzer refresh was not rerun because the escalated request was rejected for external code-index/export risk.

## Files Covered

- `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/conversion_authority.py`
- `bim-streaming-server/tests/test_conversion_authority_api.py`
- `openspec/changes/streaming-ifc-ready-intake-contract/`

## Remaining Risk

- Production auth is only enforced when `ConversionAuthoritySettings.internal_conversion_token` is configured by the hosting adapter/launcher.
- The request fingerprint currently treats any payload field change, except `event_id` and `idempotency_key`, as incompatible. Relaxing this needs a future explicit contract change.
- GitNexus analyzer refresh was not completed in this environment; final `detect_changes` should be interpreted with the same stale-index caveat.
