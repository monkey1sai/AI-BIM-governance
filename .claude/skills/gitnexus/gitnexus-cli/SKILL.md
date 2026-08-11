---
name: gitnexus-cli
description: "Use when the user needs to index a repository, check GitNexus status, clean an index, generate a wiki, or list indexed repositories"
---

# GitNexus CLI Commands

This repository is CLI-only and reviews GitNexus **1.6.9**. Do not use a moving package tag or an unpinned generated wrapper.

## Preflight

From the repository root:

```bash
gitnexus --version
gitnexus status
```

The version must be `1.6.9`. If the binary is absent or mismatched, stop unless the current turn explicitly authorizes installation or re-indexing.

## Pinned installation and recovery

Use one of these exact 1.6.9 paths:

```bash
npx gitnexus@1.6.9 analyze --index-only
npm i -g gitnexus@1.6.9
pnpm --allow-build=@ladybugdb/core --allow-build=gitnexus --allow-build=tree-sitter dlx gitnexus@1.6.9 analyze --index-only
```

The npm 11 installer can fail with `node.target is null`; use the pinned global or pnpm path in that case. `--index-only` is mandatory because it prevents agent-context file injection.

## Commands

### Analyze

```bash
npx gitnexus@1.6.9 analyze --index-only
```

Useful flags include `--force`, `--embeddings`, `--drop-embeddings`, and `--pdg`. Keep `--index-only` on every refresh in this repo.

### Status

```bash
gitnexus status
```

The analyze banner is not proof of success; confirm status and the index metadata.

### Clean

```bash
gitnexus clean
```

This deletes the local index and unregisters the repository. Run it only with explicit authorization and a recovery plan. Use `--force` only when separately authorized.

### Wiki

```bash
gitnexus wiki
```

Wiki generation requires an LLM provider and may publish data when `--gist` is used. Confirm data and publication scope first.

### List repositories

```bash
gitnexus list
```

## After indexing

1. Run `gitnexus status`.
2. Use `gitnexus query`, `context`, `impact`, `trace`, and `detect-changes` through the shell.
3. Read source and executable tests to arbitrate graph uncertainty.

## Troubleshooting

- **Not inside a git repository:** run from the target repository root.
- **Stale after analyze:** rerun `gitnexus status`; never treat the banner as success.
- **Ambiguous repository name:** pass the exact absolute path with `-r`.
- **Install or re-index not authorized:** use the repository unavailable gate and report UNKNOWN, not pass.
