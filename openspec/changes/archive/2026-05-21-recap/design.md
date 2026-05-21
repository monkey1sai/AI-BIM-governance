## Context

長線 roadmap 規劃 8 個 Phase，但對「明天要 demo 給客戶看」這個現實場景沒有具體答案。repo 已有的能力（coordinator + streaming-server + viewer + fakes）足以證明閉環，但隱性知識散亂導致重複踩雷。本 change 凍結 demo 路徑，目的是讓任何熟悉 repo 結構的人能在不踩坑的前提下 30 分鐘內把 demo 跑起來。

## Goals / Non-Goals

### Goals

- 把 demo 啟動順序 / port matrix / host vs container 邊界 / WSL Kit graphics 約束寫進 repo 唯一一份 runbook（`docs/demo/fast-mvp-demo-recap.md`）
- 提供 `scripts/demo/` 最小 PowerShell 包裝，串接既有 `npm run` / `python -m pytest` / `npm test` 入口，不重新發明
- 用 `tests/fakes` 觸發已知能跑通的 ifc-ready 路徑，避免接真實外部
- 明寫驗收長相（什麼算成功、什麼算失敗），讓 demo 結束時有客觀判定

### Non-Goals

- 不解 WSL Kit graphics blocker（host-native 即是答案）
- 不引入任何 long-roadmap Phase 1/2/5/6 元件
- 不取代 `CLAUDE.md` §5 既有驗證指令（runbook 引用它們，不複製）
- 不寫自動化 e2e（demo 是 human-driven walkthrough，不是 CI gate）
- 不為 demo 改 production code

## Decisions

### Decision 1: docs + scripts 而非 runtime code

**選擇**：把 `recap` 做成純文檔 + PowerShell 包裝 scripts，不改任何 service source。

**理由**：

- repo 既有三服務的能力已涵蓋 demo 所需，缺的不是功能而是 orchestration
- 任何 production code 改動都需要走完整 four-layer verification + GitNexus impact，對 docs-only change 是 over-engineering
- docs 是 source of truth 的延伸；當約束（如 WSL Kit graphics）改變，更新 runbook 比改 code 容易

**代價**：

- runbook 與 code 漂移風險（mitigation：runbook 引用 `CLAUDE.md` §5 既有指令，不複製）
- 沒有 CI 守 runbook 正確性（接受 — demo 是 human walkthrough）

### Decision 2: Windows host-native 為唯一 streaming path

**選擇**：runbook 明寫 `bim-streaming-server` 必須跑 Windows host-native，不嘗試 WSL / Docker GPU。

**理由**：

- Claude memory `kit-gpu-render-needs-windows-native` 與 `wsl-ubuntu-24-04-container-toolkit-setup` 已證實 WSL2 + Container Toolkit 對 Kit graphics 仍卡 Vulkan 天花板
- repo `runtime-image-linux-kit-launcher-readiness` capability 已標 `deferred`，原因同
- demo 不是 production deploy，single-path 比 multi-path 容錯重要

**代價**：

- demo 機必須是 Windows + RTX GPU，無法在 Linux server demo（接受 — 與 host-native conversion authority 已歸檔的決策一致）

### Decision 3: 三服務分別啟動 vs docker-compose 整包

**選擇**：runbook 與 `scripts/demo/start-services.ps1` 採「streaming-server host-native + coordinator/viewer 各自 npm run」方式，不寫 docker-compose 整合包。

**理由**：

- streaming-server 跑 Windows host，coordinator/viewer 跑 Node，混跑 docker-compose 無法統一 host 模式
- 三服務啟動指令已在 `CLAUDE.md` §5，runbook 只負責編排順序與健康檢查
- 未來若 demo 規模擴大需要 multi-instance / OVAS，再另開 change（`runtime-manager-docker-kit-mvp` capability 已歸檔，可作為基線）

**代價**：

- 一鍵啟動體驗較弱，但 demo 場景下需要 demo 主操作員理解每一步發生什麼，不算負面

### Decision 4: storage/ 既有 `轉檔測試*.ifc` 不入 git

**選擇**：runbook 提示 demo 機需有 `storage/轉檔測試*.ifc` 樣本檔，但不把這些檔案 commit 進 repo。`.gitignore` 既有 `M` 修改保持原狀不在本 change 處理。

**理由**：

- IFC 檔案大（避免炸 repo size，與長 roadmap Caveat 一致）
- 樣本檔可能含客戶資料，不應入公開 repo
- `.gitignore` 修改另循其他流程（與本 change 正交）

**代價**：

- demo 機需手動準備樣本（mitigation：runbook 列出最小樣本清單與來源路徑）

## Risks / Trade-offs

- **Risk**：runbook 與實際 repo 漂移
  - **Mitigation**：runbook 用相對路徑引用既有 `CLAUDE.md` / `AGENTS.md` / `package.json` script 名稱，不抄死指令字串
- **Risk**：predecessor `coordinator-ifc-ready-worker-webhook` archive 未落地，違反 `NoSuccessorWhilePredecessorOpen`
  - **Mitigation**：proposal.md 已明確標註此狀態，apply 階段 PR body 重複提醒；本 change 與 predecessor 在 capability 上完全正交（demo orchestration vs control-plane session handoff），不會造成 spec conflict
- **Risk**：demo 機沒有 RTX GPU
  - **Mitigation**：runbook 明寫硬體前置條件，缺則 demo 無法執行（不是 runbook 能 work around 的問題）

## Migration Plan

無 migration — 本 change 純新增 docs 與 scripts，不影響任何既有路徑。既有 `CLAUDE.md` §5 驗證指令繼續可用且為 runbook 的引用基礎。

## Open Questions

兩輪 explore 收斂後，無 open question 阻擋實作：

- ~~OQ1：是否需要 docker-compose 整包？~~ → Decision 3 解：不需要
- ~~OQ2：是否要為 runbook 加 CI gate？~~ → Non-Goal 明確排除
- ~~OQ3：demo 觸發 payload 用哪個 `轉檔測試*.ifc`？~~ → runbook 列入「現場不要抽不認識的檔」原則，由 demo 主操作員預先驗證選定
- ~~OQ4：predecessor archive 是否要先處理？~~ → 已在 proposal Impact 標註提醒；本 change 與其正交，不阻擋；建議使用者在 review gate 前先把 predecessor archive PR 開出來
