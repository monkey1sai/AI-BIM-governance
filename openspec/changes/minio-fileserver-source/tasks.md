# Tasks — minio-fileserver-source

對應 plan：`docs/superpowers/plans/2026-06-10-minio-fileserver-source.md`；spec：`docs/superpowers/specs/2026-06-10-minio-fileserver-source-design.md`。

- [x] Task 0：governance-service `file_library` 唯讀 tree API（兩層 IFC 結構、traversal 防護、保留目錄排除、竣工排序、空 root 200）＋ pytest（commits `1f6ac9b`、`871ff4c`、`7e5b170`、`85c936a`）
- [x] Task 1：coordinator governanceProxy 加 `GET /api/governance/files/tree` 白名單一條 ＋ vitest（commit `5772c16`）
- [x] Task 2：`governanceClient.filesTree()` ＋ `FilesTreeResponse` 型別 ＋ vitest（commit `68a2ea4`）
- [x] Task 3：`#/minio` 接真檔案庫樹（loading/error/empty 三態）＋ `#/a1` 三層選擇器（手動輸入保留）＋ vitest（commits `14e83fb`、`2fa563c`、`85c936a`）
- [x] Task 4：Playwright E2E（`#/minio` 真樹 + `#/a1` 選擇器→rule-run）＋ tracked 證據 `docs/evidence/minio-fileserver-source/`（commits `085a08d`、`e46c77c`、`874c680`、`85c936a`）
