---
name: deploy-main-to-linux-test
description: >
  Use when the user asks to deploy origin/main to the canonical Linux test host,
  says "部署 main 到 181", "部署 origin main", "deploy main to linux",
  "重建測試區並打 tag", or wants the deploy-* tag pushed for a fresh canonical
  deployment. For preflight-only questions or non-canonical targets, use
  deploy-linux-test-environment directly instead.
---

# Deploy origin/main to the Canonical Linux Test Host

單一目標:把**乾淨的 `origin/main`** 部署到 canonical Linux 測試機(registry 的
`canonical_target`,即 owner inventory 解析出的那台),成功後 wrapper 自動打
`deploy-*` tag 並 push。

**單一真相是 `deploy-linux-test-environment` runbook**(同倉 `.claude/skills/`)。
它持有全部防線(SID/ACL/handle/reparse/staging/confirmation);本技能只是它的
聚焦入口,收錄一條 2026-08-11 實測通過的最短正確路徑與踩坑表。兩份文件若有出入,
以 runbook 為準。

## Core Workflow

1. **讀 runbook**:載入 `deploy-linux-test-environment` 的 SKILL.md,依它的
   「Load current truth」清單讀 wrapper 與 registry。**部署防線的權威是
   `scripts/dev/rebuild-test-deploy.ps1` 本體**,不是任何 driver 腳本。
2. **確認 target 就是使用者要的那台**:只比對 inventory 的
   `connection.host`/`public_host` 與使用者指定的 IP,輸出 match/mismatch 布林,
   絕不印其他欄位值。mismatch 即 HELD。
3. **Isolated worktree**:fetch 後從 `origin/main` 開一次性 worktree
   (`AI-BIM-governance.deploy-canonical-<timestamp>`),caller branch 永不執行部署。
4. **Stage canonical env**:把 owner 私有的 canonical env 檔複製到 isolated
   worktree 根(transport 從 registry `env_file` 檔名讀取)。少了這步 wrapper 會
   以 `operator canonical env file not found` HELD。確認 `git check-ignore` 命中,
   結束時 finally 刪除並驗證確實消失。
5. **正規形 rebuild(無 -TargetId)**:

   ```powershell
   # pwsh 7 必要(見踩坑表);正規 canonical 調用不帶 -TargetId ——
   # wrapper 預設解析 registry 的 canonical_target,顯式 id 是 on-demand 目標專用。
   $p = @{ Build = $true; InventoryPath = $inventoryPath; IdentityFile = $identityFile }
   & .\scripts\dev\rebuild-test-deploy.ps1 @p
   if ($LASTEXITCODE -ne 0) { throw "deploy failed with exit $LASTEXITCODE" }
   ```

6. **驗證**:`deploy_exit=0` 之外至少要——
   - wrapper log 的 `[deploy-tag] deploy-<date>-<ticks>-<seq> -> <sha>` 且
     `git fetch --tags` 後本地看得到該 tag(= 已 push);
   - 五端點:`:8004/health`、`:8004/ui`、`:5173`、`:49101/health` 皆 HTTP 200,
     `:49100` TCP reachable;
   - effective-env snapshot 出現在
     `artifacts/deploy-reports/canonical-linux/<ts>-effective-env.json`。
   - 完整驗證(governance `:49102`、Kit Manager `:8010`)走 runbook 的遠端
     `verify-all -Profile Deployment` 段;沒跑就在報告誠實列 skipped gate。
7. **Cleanup**:staged env 刪除 → isolated worktree/branch 移除(dirty 即 HELD
   保留待查)。報告分 Verified facts / Inferences / Unverified risks / Next actions。

## 踩坑表(2026-08-11 實測)

| 坑 | 症狀 | 對策 |
|---|---|---|
| 用 `powershell.exe`(5.1)跑 driver | ssh/git 的 stderr 進度被當 RemoteException,流程中途炸 | 一律 `pwsh -NoProfile -NonInteractive`;runbook 本來就要求 PowerShell 7 |
| 略過 env staging | `remote_deploy_transport: operator canonical env file not found` HELD | Workflow 第 4 步;這是防線不是 bug |
| `git worktree add` 接管道包裝 | stderr 進度觸發 NativeCommandError | native git 呼叫用 `*> $null` 或不接管道,以 `$LASTEXITCODE` 判定 |
| 對 evidence/測試寫 `-TargetId canonical-linux` | 冒充正規形;canonical 證據必須是無參調用 | 正規形=不帶 `-TargetId`;單元測試用中性 id |

## Output Checklist

- [ ] isolated worktree 來自 fresh `origin/main`,HEAD SHA 已記錄
- [ ] target host 與使用者指定 IP 的 match 布林已回報(未印私有欄位)
- [ ] `deploy_exit=0`
- [ ] `deploy-*` tag 名稱與指向 SHA 已回報,且 fetch 後可見(= pushed)
- [ ] 五端點健康結果逐一列出
- [ ] staged env 已刪除、isolated worktree 已清(或 HELD 原因)
- [ ] 未跑的 gate(如遠端 `verify-all -Profile Deployment`)誠實列為 skipped
