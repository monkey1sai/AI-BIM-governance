# Script Contract

`scripts/` 只保留產品、runtime、部署、smoke 與本機驗證用途。

## Canonical operator entrypoints

| Script | Role |
|---|---|
| `scripts/deploy.ps1` | build / deploy / demo golden path |
| `scripts/stop-all.ps1` | ownership-aware stop / cleanup path |

其他 `start-*`、`check-*`、`smoke-*` 與 `scripts/dev/` 工具是 adapter 或診斷入口，不得暗中建立第二條 production 部署路徑。Root-level command 必須登記在 `scripts/script-registry.json`。

## Verification

Runtime、Docker、Kit、viewer、ports、env 或 conversion 變更至少執行：

```powershell
.\scripts\deploy.ps1 -DryRun
```

再依受影響 service 執行 `docs/agents/local-verification.md` 的 targeted checks。GPU/Kit、browser 與正式部署證據彼此不可替代。

## Deployment boundary

測試部署只從已合併且 freshly fetched 的 `origin/main`，使用：

```powershell
.\scripts\dev\rebuild-test-deploy.ps1 -Build -InventoryPath '<repo-external target.local.json>'
```

私有 inventory、credentials 與 target topology 不得提交或輸出。工具無法證明 process ownership 時必須停止，不得以 `-Force`、ACL 變更或任意 PID 終止繞過。
