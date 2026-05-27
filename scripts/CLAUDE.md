# scripts/ — Claude Mirror Entry

本檔是 [`scripts/AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則以 sibling `AGENTS.md` 為準。

衝突時依根目錄 [`CLAUDE.md`](../CLAUDE.md) §1 優先序解析：

```
使用者最新明確指令 > 根目錄 AGENTS.md / repo-local boundary > 根目錄 CLAUDE.md > OpenSpec artifacts > installed skills / wiki
```

## Verify 入口

```powershell
pwsh scripts/verify-all.ps1 -TsOnly
```

完整跨 sub-repo 驗證指令見根目錄 [`docs/agents/sub-repo-verify-commands.md`](../docs/agents/sub-repo-verify-commands.md)。
