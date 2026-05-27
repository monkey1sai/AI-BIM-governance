# 2026-05-27 fix-lan-runtime-params-spectator-capacity 驗證紀錄

## Scope

OpenSpec change: `fix-lan-runtime-params-spectator-capacity`

本紀錄覆蓋 PR 前驗證：LAN handoff / spectator endpoint 設定、host-native Kit runtime build artifact preflight、script tests、compose config 與 build checks。

## Commands

| Layer | Command | Result |
|---|---|---|
| OpenSpec | `openspec validate fix-lan-runtime-params-spectator-capacity --strict` | passed |
| PowerShell parser | parse `scripts/deploy.ps1`, `scripts/lib/preflight-host-native.ps1`, `scripts/lib/host-native-launcher.ps1`, `scripts/tests/test-preflight-host-native.ps1` | passed |
| Host-native preflight tests | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-preflight-host-native.ps1` | passed |
| Deploy dry-run tests | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-deploy-dryrun.ps1` | passed |
| Port preflight tests | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-preflight-ports.ps1` | passed |
| Host-native launcher tests | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-host-native-launcher.ps1` | passed |
| Coordinator focused tests | `npm test -- --run tests/config.test.ts tests/sessions.test.ts` in `bim-review-coordinator` | 52 passed |
| Coordinator build | `npm run build` in `bim-review-coordinator` | passed |
| Viewer session contract | `npm run test:session-first` in `web-viewer-sample` | passed |
| Viewer build | `npm run build` in `web-viewer-sample` | passed |
| Root contracts/fakes | `.\.venv\Scripts\python.exe -m pytest tests -x -q` | 65 passed |
| Conversion authority | `..\.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py -x -q` in `bim-streaming-server` | 14 passed |
| Compose config | `docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example config --quiet` | passed |
| Diff hygiene | `git -c safe.directory=... diff --check` | passed |

## GitNexus

- `mcp__gitnexus__.impact` on `scripts/lib/preflight-host-native.ps1`: LOW, no indexed upstream callers.
- `mcp__gitnexus__.impact` on `scripts/deploy.ps1`: LOW, no indexed upstream callers.
- `mcp__gitnexus__.detect_changes` cannot inspect this unindexed `.worktrees\fix-lan-runtime-params-spectator-capacity` checkout; when run against indexed `AI-BIM-governance`, it reports no changes because it reads the main worktree.
- CLI `gitnexus detect-changes --scope all --repo AI-BIM-governance` has the same limitation in this checkout.
- Fallback evidence: `git diff --stat`, `git diff --check`, focused tests, build checks, and OpenSpec strict validation.

## Notes

- `web-viewer-sample` has no committed lockfile; `package-lock.json` is ignored. Validation installed local ignored `node_modules` with `npm install --package-lock=false`.
- `npm install` reported existing dependency audit findings: 2 moderate and 6 high vulnerabilities. This PR does not change package dependencies.
- `npm install` also reported Node engine warning because local Node is `v22.22.0` while `web-viewer-sample` declares `^20.0.0`.
- Runtime browser E2E remains a separate post-merge / main-workspace validation gate: primary viewer plus at least one spectator viewer must both reach live WebRTC video readiness for the same review session.
