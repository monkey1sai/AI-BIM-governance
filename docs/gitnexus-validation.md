# GitNexus Validation

> Document nature: **historical validation record** captured on 2026-05-06. This is not an active runbook; do not rerun the commands below. Current repository policy is `AGENTS.md` §4 plus `docs/agents/gitnexus-usage.md`, and every index refresh must use `--index-only`.

Recorded: 2026-05-06

## Historical Goal

The 2026-05-06 validation attempt used the then-current GitNexus CLI flow:

- `gitnexus analyze` to create the repository knowledge graph.
- `--embeddings` with an OpenAI-compatible `/v1/embeddings` endpoint.
- `gitnexus wiki` with an OpenAI-compatible chat completions endpoint.

Do not use `--skills` for this workspace cleanup path. `AGENTS.md` and
`CLAUDE.md` remain repo-authored instruction files; GitNexus-generated agent
context should not be reintroduced unless there is a separate explicit decision.

## Permanent Local Settings

PowerShell profile:

```powershell
C:\Users\IOT\Documents\PowerShell\Microsoft.PowerShell_profile.ps1
```

The profile reads the key from:

```powershell
C:\Users\IOT\.api-key\embeddings-key
```

It sets these environment variables without storing the API key in the profile:

```powershell
GITNEXUS_EMBEDDING_URL=https://api.openai.com/v1
GITNEXUS_EMBEDDING_MODEL=text-embedding-3-small
GITNEXUS_EMBEDDING_DIMS=1536
GITNEXUS_EMBEDDING_API_KEY=<read from key file>
GITNEXUS_API_KEY=<same key, read from key file>
GITNEXUS_LLM_BASE_URL=https://api.openai.com/v1
GITNEXUS_MODEL=gpt-4o-mini
```

Verified in a fresh PowerShell process:

```text
EMBED_URL=https://api.openai.com/v1
EMBED_MODEL=text-embedding-3-small
EMBED_DIMS=1536
LLM_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
KEY_LENGTH=164
```

## API Key Validation

Embeddings endpoint:

```text
OPENAI_EMBEDDINGS_OK model=text-embedding-3-small dims=1536 tokens=6
```

Chat completions endpoint for GitNexus wiki:

```text
OPENAI_CHAT_OK model=gpt-4o-mini-2024-07-18 finish=stop
```

## GitNexus CLI State

Installed GitNexus version:

```text
1.6.3
```

NPM latest check:

```text
1.6.3
```

Current repository status after attempted indexing:

```text
Repository not indexed.
Run: gitnexus analyze
```

`gitnexus list`:

```text
No indexed repositories found.
Run `gitnexus analyze` in a git repo to index it.
```

## Attempted Official Commands

Full official target command:

```powershell
gitnexus analyze . --force --embeddings
```

Result:

```text
GitNexus Analyzer
```

Exit code: `1`. No `.gitnexus/meta.json` was created.

Core analyzer isolation command:

```powershell
gitnexus analyze . --force --verbose --max-file-size 1
```

Result:

```text
GitNexus Analyzer
GITNEXUS_MAX_FILE_SIZE: effective threshold 1KB (default 512KB)
Skipped 281 large files (>1KB)
```

Exit code: `1`. No `.gitnexus/meta.json` was created.

Small folder isolation command:

```powershell
gitnexus analyze _bim-control --force --verbose --skip-git --max-file-size 512
```

Result:

```text
GitNexus Analyzer
Warning: no .git directory found - commit-tracking and incremental updates disabled.
```

Exit code: `1`. No `_bim-control/.gitnexus/meta.json` was created.

Wiki command:

```powershell
gitnexus wiki . --force --provider openai --model gpt-4o-mini --base-url https://api.openai.com/v1
```

Result:

```text
Error: No GitNexus index found.
Run `gitnexus analyze` first to index this repository.
```

## Historical Blocker

OpenAI embeddings and chat API calls both work. The blocker is local GitNexus analyzer execution on this Windows machine. GitNexus exits before completing analysis and before writing `meta.json`, even when embeddings and skills are disabled and even when indexing a small subfolder with `--skip-git`.

Do not treat the partial `.gitnexus/lbug` and `.gitnexus/lbug.wal` files as a successful index. The success gate is:

```powershell
gitnexus status
Test-Path .gitnexus\meta.json
```

Both must pass before running `gitnexus wiki`.

## Current Procedure

The former re-run recipe is retired. Do not copy commands from this historical record. Follow `AGENTS.md` §4 and `docs/agents/gitnexus-usage.md`; refreshes must be injection-free and use `gitnexus analyze --index-only` (or the equivalent project-local runner form).
