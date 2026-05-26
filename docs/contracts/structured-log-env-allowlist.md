# Structured Log — Environment Variable Allow-List

> Companion to `docs/contracts/structured-log-schema.md` §5.1.
> JSON Schema artifact: `tests/contracts/structured-log/schema.json`.

This document is the **single source of truth** for environment variable names whose raw values are emitted as plaintext in `env_snapshot` records. Adapters compare `env.key` against this list (case-sensitive); a hit emits the raw value, a miss falls through to the secret-pattern or type-only redaction rules in `docs/contracts/structured-log-schema.md` §5.1.

Any PR that adds, renames, or removes an environment variable that should appear in plaintext in `env_snapshot` records MUST update this file in the same change. Adding a variable whose value would carry a credential is **forbidden**; such variables MUST fall through to redaction.

## Allow-list

| Key | Used by | Notes |
|---|---|---|
| `NODE_ENV` | coordinator | `development` / `production` / `test` |
| `STORAGE_ROOT` | coordinator, streaming-server | Repo-relative or absolute path to shared storage volume |
| `LOG_ROOT` | all 4 adapters | Override for the default `logs/` directory; absolute path |
| `LOG_RETENTION_DAYS` | retention script, adapters (read-only) | Integer; default `30` |
| `BIM_TRACE_ID` | PowerShell scripts | Inbound trace_id carrier for cross-script invocation |
| `COORDINATOR_PORT` | coordinator | Default `8004` |
| `COORDINATOR_HOST` | coordinator, viewer | Default `127.0.0.1` |
| `VIEWER_PORT` | viewer, coordinator (compose) | Default `5173` |
| `KIT_RUNTIME_PORT` | streaming-server | Default `49100` (WebRTC) |
| `KIT_CONVERSION_PORT` | streaming-server | Default `49101` (conversion HTTP) |
| `IFC_DOWNLOAD_STRICT` | coordinator | `true` in production; `false` allows `tests/fakes` fallback |
| `IFC_DOWNLOAD_FALLBACK_ON_FETCH_ERROR` | coordinator | Boolean; default `false` |
| `CONVERSION_SERVICE_BASE_URL` | coordinator | Internal-only; logical hostname, no credentials |
| `CONVERSION_RESULT_CALLBACK_URL` | streaming-server | Coordinator callback path; logical hostname |
| `EXTERNAL_CLOUD_BIM_CONTROL_BASE_URL` | coordinator | Logical hostname for external company cloud control-plane |
| `OPENSPEC_CHANGE` | scripts | Current OpenSpec change id (governance metadata, never a credential) |
| `BIM_RUNTIME_PROFILE` | coordinator, streaming-server | Profile selector (`local-dev` / `docker-compose` / `cloud-vm`) |
| `RUN_ID_PREFIX` | adapters | Optional override for adapter-generated `run_id` prefix; used in tests |

## Patterns NOT in allow-list (always redacted)

Any key matching the following case-insensitive patterns falls through to `[REDACTED:type=...,len=...]` regardless of allow-list status:

- `TOKEN` (e.g. `INTERNAL_API_TOKEN`, `GITHUB_TOKEN`)
- `SECRET` (e.g. `JWT_SECRET`)
- `KEY` (e.g. `API_KEY`, `PRIVATE_KEY`; note this also matches some legitimate keys like `KIT_RUNTIME_PORT` is **not** matched because the pattern needs `KEY` as a token, not as a substring — adapters use word-boundary regex `\bKEY\b` or check `endsWith("_KEY")`/`endsWith("KEY")` to avoid false positives)
- `PASSWORD`
- `AUTH` (e.g. `AUTH_CLIENT_ID` — even though client id is sometimes non-secret, we err on the side of redacting)
- `CREDENTIAL`

## Sources

`env_snapshot.vars[].source` MUST be one of:

| Source | Meaning |
|---|---|
| `.env` | Loaded from `<repo-root>/.env` or `<sub-repo>/.env` |
| `.env.example` | Loaded from the matching `.env.example` (placeholder values; not real secrets) |
| `system` | Process-inherited from OS / shell environment |
| `docker-compose` | Injected by `compose.*.yml` `environment:` block at container start |
| `default` | Adapter / service hard-coded default applied when env was absent |

Adapters MUST detect source by checking presence in the matching dotenv file before falling back to `system` then `default`.

## Adding a variable

1. Decide whether the variable's value carries a credential. If yes — do NOT add to this allow-list; the secret pattern (§5.1) will handle redaction automatically.
2. If the value is non-sensitive and operators need to see it in plaintext, append a row to the table above.
3. Update `docs/contracts/structured-log-schema.md` if the addition implies a new `subject_kind`, `event_type`, or propagation carrier.
4. Add or update `tests/contracts/structured-log/fixtures/env_snapshot-*.jsonl` to cover the new variable.
5. Submit the change in the same PR as the new env consumer.
