## 1. OpenSpec 與 workflow contract

- [x] 1.1 建立 `test-deploy-rebuild-workflow` OpenSpec proposal / design / spec，定義固定部署目錄、fresh `origin/main`、清理規則與 deploy command。
- [x] 1.2 更新 `AGENTS.md` 與 `CLAUDE.md`，要求同義口令固定執行 `scripts\dev\rebuild-test-deploy.ps1 -Build`，禁止 `-DryRun`。
- [x] 1.3 更新 `docs/agents/product-operability-and-script-contract.md` 與 `docs/agents/sub-repo-verify-commands.md`，記錄 fetch fail-fast、清理規則、log / exit code 回報與 runtime blocker 授權。

## 2. PowerShell rebuild helper

- [x] 2.1 新增 `scripts\lib\rebuild-test-deploy.ps1`，實作固定 path guard、fresh fetch/reset/clean、agent/tooling artifact removal、deploy script invocation 與 exit code propagation。
- [x] 2.2 新增 `scripts\dev\rebuild-test-deploy.ps1` wrapper，只允許 `-Build` 並回報 deployment path、origin main commit、removed artifact count、deploy exit code 與 log path。
- [x] 2.3 清理規則移除所有層級 `AGENTS.md` / `CLAUDE.md`，root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/`，保留 `.github/workflows/`。

## 3. 驗證

- [x] 3.1 新增 `scripts\tests\test-rebuild-test-deploy.ps1`，覆蓋 path guard、清理規則、fetch failure、deploy exit code、wrapper syntax 與禁止 `DryRun` token。
- [x] 3.2 執行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1`。
- [x] 3.3 執行 `npx @fission-ai/openspec validate test-deploy-rebuild-workflow --strict`。
- [x] 3.4 以 `scripts\dev\rebuild-test-deploy.ps1 -Build` 重建 `D:\Users\deploy\AI-bim-geo`，並以健康檢查確認環境拉起。
