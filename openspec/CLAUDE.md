# openspec/ — Claude Mirror Entry

本檔是 [`openspec/AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則以 sibling `AGENTS.md` 為準。

衝突時依根目錄 [`CLAUDE.md`](../CLAUDE.md) §1 優先序解析：

```
使用者最新明確指令 > 根目錄 AGENTS.md / repo-local boundary > 根目錄 CLAUDE.md > OpenSpec artifacts > installed skills / wiki
```

## Verify 入口

```powershell
npx openspec validate <change-id> --strict
npx openspec validate --all --strict
```

`archive/` 是 immutable historical state，不受新規範回溯約束；修改 archive 需獨立 PR 並在描述標示為 historical correction。
