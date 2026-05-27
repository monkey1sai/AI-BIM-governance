# tests/ — Claude Mirror Entry

本檔是 [`tests/AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則以 sibling `AGENTS.md` 為準。

衝突時依根目錄 [`CLAUDE.md`](../CLAUDE.md) §1 優先序解析：

```
使用者最新明確指令 > 根目錄 AGENTS.md / repo-local boundary > 根目錄 CLAUDE.md > OpenSpec artifacts > installed skills / wiki
```

## Verify 入口

```powershell
.\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider
```

`.venv` 與 `-p no:cacheprovider` 不可省（規則見根目錄 `CLAUDE.md` §3）。
