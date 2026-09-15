# Lineage contract acceptance

## Outcome 與範圍

對應 [remaining-product-backlog.md](remaining-product-backlog.md) 的 RVT → IFC → USDC lineage：
確認 metadata-only cloud publication 的 schema、HMAC、event binding 與 ACK 契約具有可重跑的本機正／負測試。
Owning service：edge `bim-review-coordinator`；external company-cloud `bim-control` 的 receiver 屬外部 owner。
本切片驗收的是契約層；publisher、receiver、MinIO、MySQL 與 browser 的端到端完成仍需各自證據。

## Source 與修改範圍

- 現行來源：`tests/contracts/lineage/reference/README.md`、request/response schemas。
- 驗證實作：`tests/contracts/lineage/protocol_validators.py`、`semantic_validators.py`。
- 測試：`test_lineage_contracts.py`、`test_cloud_publication_protocol.py`、`test_retained_reference.py`。
- 本次修改限於來源說明、退役文件一致性與 reference 完整性檢查；保留 wire/API/schema 行為。

## DoD 與重跑方式

從受審 worktree 根目錄，使用已安裝 pytest、jsonschema 的 Python：

```powershell
python -m pytest tests/contracts/lineage -q -p no:cacheprovider
```

必須 exit 0、沒有非預期 skipped；必要 reference 缺失或空檔必須失敗。
正／負案例涵蓋 HMAC raw bytes、timestamp、event identity、ACK status/code/retryable 與 intake/publication 方向隔離。
驗收結果記於 PR 的驗證方式，綁定該 PR commit；文件本身不宣告未來 checkout 已通過。

## 後續整合驗收依賴

真實 MinIO artifacts、運行中的 edge publisher、外部 receiver 與實際 ACK，以及 browser read/download/actions 尚須獨立驗收。
不得由本機 fixtures 推論這些能力已完成；不得把 REFERENCE ONLY DDL 作為 migration 執行。
依 [local-verification.md](../agents/local-verification.md) 記錄環境、commit、命令、exit code 與已跳過項目。
