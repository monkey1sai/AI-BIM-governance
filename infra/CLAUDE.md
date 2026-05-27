# infra/ — Claude Mirror Entry

本檔是 [`infra/AGENTS.md`](AGENTS.md) 的 Claude 鏡像入口。完整規則以 sibling `AGENTS.md` 為準。

衝突時依根目錄 [`CLAUDE.md`](../CLAUDE.md) §1 優先序解析：

```
使用者最新明確指令 > 根目錄 AGENTS.md / repo-local boundary > 根目錄 CLAUDE.md > OpenSpec artifacts > installed skills / wiki
```

## Verify 入口

```powershell
docker compose -f compose.host-kit.yml config
docker compose -f compose.runtime-manager.yml config
```

`config` 只驗 YAML 與 build context 路徑；完整 build smoke 走 `scripts/check-*-docker.ps1`。
