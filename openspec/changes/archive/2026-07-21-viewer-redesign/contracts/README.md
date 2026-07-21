# viewer-redesign contracts（草案）

| 檔 | 內容 | 未來落點 |
|---|---|---|
| `kit-datachannel-v1.schema.json` | console↔Kit DataChannel 全訊息 envelope + $defs（OUT×11 / IN×11，含 `commandRejected` 首次定義與 runtime authority envelope） | 實作 change 遷入 `tests/contracts/` 並接 CI |
| `vg01-postmessage-v1.schema.json` | EmbeddedViewer 跨-origin iframe 橋（console→viewer ×5 / viewer→console ×5） | 同上 |
| `examples/valid-*.json` | 應通過驗證 | 隨遷移轉為 CI fixtures |
| `examples/invalid-*.json` | 應被 schema 拒絕（封閉列舉防呆） | 同上 |

驗證方式（本 change 階段，手動）：

```powershell
# JSON 可解析性
Get-ChildItem -Recurse *.json | ForEach-Object { $_.Name; Get-Content $_ -Raw | ConvertFrom-Json | Out-Null }
# schema 驗證（需 ajv-cli；--spec=draft2020）
npx ajv-cli validate --spec=draft2020 -s kit-datachannel-v1.schema.json -d "examples/valid-command-rejected.json"
```

> 注意：spec-only 階段刻意**不**放 `tests/contracts/`——該目錄是 §04 CI 委任的最高 payload 權威，未接 CI 驗證前放入會製造假信號（design.md §7）。
