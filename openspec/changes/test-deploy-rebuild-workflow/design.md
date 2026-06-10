## Context

目前測試部署區固定在 `D:\Users\deploy\AI-bim-geo`。使用者口令「請測試部署區重建」代表要重建這個 deployment checkout，並把環境拉起來供檢視。風險在於 agent 容易改用目前 worktree、使用 stale `origin/main`、用 `-DryRun` 代替真 build，或把 `AGENTS.md`、`.codex/`、OpenSpec / docs / patches 等 agent / planning artifact 一起帶進部署區。

既有 golden path 是部署區內的 `scripts\deploy.ps1 -Build`。本設計只新增一層安全 wrapper，負責重建 deployment checkout 與清理非 runtime 檔案；不改動 product runtime、service API、IFC / USDC / session / governance 資料契約。

## Goals / Non-Goals

**Goals:**

- 固定「請測試部署區重建」只能執行 `scripts\dev\rebuild-test-deploy.ps1 -Build`。
- 在任何 reset 前都先 freshly fetch `origin/main`，fetch 失敗即停止，不使用 stale ref。
- 僅允許操作固定部署路徑 `D:\Users\deploy\AI-bim-geo`；測試可透過明確 test-only escape 使用 sandbox。
- 清理 agent/tooling artifact 與 root `docs/`、`openspec/`、`patches/`，但保留 `.github/workflows/`。
- 從部署區執行 `scripts\deploy.ps1 -Build`，回傳其 exit code 並回報 log path。

**Non-Goals:**

- 不新增 product runtime API、service、資料表、event 或 browser UI。
- 不改 `scripts\deploy.ps1` 的正式 deploy contract。
- 不把 OpenSpec / Superpowers / GitNexus / skills 安裝狀態當成部署 runtime 需求。
- 不支援 `-DryRun`、`-Force` 或任意 deployment path。

## Decisions

### Decision 1: Wrapper 固定為 build-only entrypoint

`scripts\dev\rebuild-test-deploy.ps1` 只接受 `-Build`。若未帶 `-Build`，wrapper 直接輸出 usage 並失敗；程式與測試都禁止 `DryRun` token。這讓 agent 不能用看似成功但未拉起環境的 dry run 取代部署驗證。

### Decision 2: Deployment checkout 以 freshly fetched origin/main 為唯一來源

重建流程先以 explicit refspec fetch `+refs/heads/main:refs/remotes/origin/main` 更新遠端 main；fetch 失敗即停止。部署 checkout reset 到 `origin/main` 後再 `git clean -fdx`，避免 local changes 或 stale tracking ref 混入結果。

### Decision 3: 固定路徑與 destructive guard 分離

production path 僅允許 `D:\Users\deploy\AI-bim-geo`。測試需要檔案刪除驗證時，必須透過 `-AllowNonFixedPathForTests` 並搭配 mocked command runner；production flow 不暴露任意 path。

### Decision 4: 清理非 runtime artifact，而不是修改 deploy.ps1

清理邏輯放在 wrapper/lib：所有層級 `AGENTS.md` / `CLAUDE.md` 會移除；root `.codex/`、`.agents/`、`.agent/`、`.claude/`、`.cursor/`、`.windsurf/`、`.github/skills/`、`.github/prompts/`、`docs/`、`openspec/`、`patches/` 會移除；`.github/workflows/` 保留。這避免把 agent/planning artifact 帶入部署，同時不改 golden deploy path。

### Decision 5: Runtime blocker 授權只限必要 port/process

若 `deploy.ps1 -Build` Phase 3 被外部 host-native runtime blocker 擋住（例如 `kit.exe` 或 conversion `python.exe` 佔用必要 ports），agent 可停止該 blocking PID 後重跑同一條 `-Build`。不得停止無關 process，不得改用 `-Force` / `-DryRun`。

## Risks / Trade-offs

- [Risk] `D:\Users\deploy\AI-bim-geo` reset / clean 會丟棄部署區 local changes → Mitigation: wrapper reset 前回報 local changes 摘要；使用者口令代表允許重建部署區。
- [Risk] network restricted 時 fetch origin/main 失敗 → Mitigation: fail fast 並回報 blocker，不使用 stale `origin/main`。
- [Risk] 清理規則誤刪 runtime 所需檔案 → Mitigation: 清理清單限 agent/tooling 與 root docs/openspec/patches；`.github/workflows` 與 production scripts/services/tests 保留，並以 PowerShell test 驗證。
- [Risk] origin/main deploy code 本身壞掉 → Mitigation: wrapper 只保證來源與流程正確；deploy failure 透過 exit code / log path 回報。
- [Risk] GitNexus / OpenSpec 工具在 CI 或本機不可用 → Mitigation: OpenSpec change 正式落地並跑 `npx @fission-ai/openspec validate ... --strict`；GitNexus unavailable 只在 review agent policy 允許時降為 warning。
