# test-deploy-rebuild Design

## Summary

使用者要讓「請測試部署區重建」成為 code agent 可執行的固定口令。當口令出現時，agent 必須在 `D:\Users\deploy\AI-bim-geo` 重建測試部署區，部署內容來自目前 repo 的 `origin/main`，然後從部署區執行 `.\scripts\deploy.ps1 -Build` 拉起環境。

這個流程採用 3+2 混合方案：

- `D:\Users\deploy\AI-bim-geo` 維持為真實 git checkout，保留可追溯的 `origin/main` 對齊方式。
- repo 內新增可審查的 helper script 收斂重建步驟與排除規則，避免每次靠 agent 手動操作。
- 真正 runtime 啟動仍只走部署區內的 `scripts\deploy.ps1 -Build`，helper script 只負責 prepare / clean / handoff。

## Trigger

當使用者說出以下語意，agent 應套用本設計：

- `請測試部署區重建`
- `測試部屬區重建`
- `重建 D:\Users\deploy\AI-bim-geo`
- 同義要求：以 `origin/main` 重建測試部署區並啟動

## Success Criteria

- Deployment checkout 位於固定路徑 `D:\Users\deploy\AI-bim-geo`。
- Deployment checkout 對齊目前 repo 的 `origin/main` commit，而不是目前 worktree 的 dirty state。
- Deployment checkout 不包含明確 agent / tooling 檔案。
- 清理後仍存在 `D:\Users\deploy\AI-bim-geo\scripts\deploy.ps1`。
- 啟動命令固定為：

```powershell
cd D:\Users\deploy\AI-bim-geo
.\scripts\deploy.ps1 -Build
```

- 最終回報包含 deployment path、`origin/main` commit SHA、排除規則、deploy exit code、log path 或 blocker。

## Exclusion Policy

使用者確認採用 A 排除強度：只排除明確 agent / tooling 路徑與所有層級的 `AGENTS.md` / `CLAUDE.md`，保留 `.github/workflows/` 等 CI 基礎設施。

必須排除：

- 所有層級的 `AGENTS.md`
- 所有層級的 `CLAUDE.md`
- `.codex/`
- `.agents/`
- `.agent/`
- `.claude/`
- `.cursor/`
- `.windsurf/`

不得排除：

- `.github/workflows/`
- production scripts / services / tests / docs
- `scripts/deploy.ps1`

## Proposed Implementation

新增 helper script：

```txt
scripts/dev/rebuild-test-deploy.ps1
```

預期職責：

1. Resolve fixed deployment path `D:\Users\deploy\AI-bim-geo`。
2. Verify resolved path exactly matches the fixed deployment path before any delete / reset / clean action.
3. Read current repo `origin` URL and verify `origin/main` exists.
4. If deployment path is not a git checkout, create a checkout from the same origin URL. If the fixed deployment path exists but is non-empty, the script may replace its contents only after the exact-path safety check passes, and must report that it rebuilt a non-git deployment directory.
5. If deployment path is already a git checkout, verify its `origin` URL matches the current repo origin URL.
6. Fetch `origin main`.
7. Reset deployment checkout to `origin/main`.
8. Remove the Exclusion Policy paths from the deployment checkout only.
9. Verify `scripts\deploy.ps1` exists after cleanup.
10. With `-DryRun`, emit the exact checkout / cleanup / deploy plan without changing files. With `-Build`, perform the rebuild and run `.\scripts\deploy.ps1 -Build`.

The helper script is not a runtime entrypoint. It is a deployment checkout preparation guard. The canonical runtime entrypoint remains `scripts\deploy.ps1`.

## Safety Rules

- Never run recursive delete or clean unless the resolved absolute target path is exactly `D:\Users\deploy\AI-bim-geo`.
- Never delete paths outside the deployment checkout.
- Never commit the post-clean deployment checkout state.
- Never replace `scripts\deploy.ps1 -Build` with sub-repo start commands.
- If deployment checkout has local modifications, the rebuild may discard them, but must report that the directory was reset to `origin/main`.
- If `scripts\deploy.ps1` is missing after cleanup, stop and report blocker.

## Documentation Updates

Update:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/agents/product-operability-and-script-contract.md`
- `docs/agents/sub-repo-verify-commands.md`

The docs must state that when the user asks for test deploy rebuild, agent should use the helper script to rebuild `D:\Users\deploy\AI-bim-geo` from `origin/main`, apply the A exclusion policy, then run `.\scripts\deploy.ps1 -Build` from the deployment checkout.

## Verification

Minimum verification for implementation:

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -DryRun
git diff --check -- scripts/dev/rebuild-test-deploy.ps1 AGENTS.md CLAUDE.md docs/agents/product-operability-and-script-contract.md docs/agents/sub-repo-verify-commands.md
```

If running the real deployment is requested or safe:

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build
```

Expected real deployment behavior:

- `D:\Users\deploy\AI-bim-geo` becomes a checkout aligned to `origin/main`.
- Agent/tooling files are absent according to the A exclusion policy.
- `.github/workflows/` remains if present in `origin/main`.
- `D:\Users\deploy\AI-bim-geo\scripts\deploy.ps1 -Build` is executed.

## Risks

- `D:\Users\deploy\AI-bim-geo` is outside the Codex workspace writable root; real rebuild may require user approval for filesystem writes.
- Resetting the deployment checkout discards local changes inside that deployment directory.
- If network is restricted, fetching `origin/main` can fail; the agent must report the blocker rather than using stale code silently.
- If `origin/main` itself contains broken deploy code, the rebuild succeeds but deployment may fail during `deploy.ps1 -Build`.

## Implementation Flags

The helper script must support these flags:

- `-DryRun`: print planned checkout / reset / exclusion / deploy command only.
- `-Build`: perform rebuild and then run `.\scripts\deploy.ps1 -Build`.

This keeps the user口令 simple while preserving a safe dry-run validation path.
