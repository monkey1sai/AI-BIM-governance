# Tasks — governance-throughput-budget

> **本 change 為 doc-only 治理提案（供審，非自動採納）。** §1 為本 commit 已完成之提案本體（draft-submitted）；§2 為使用者裁決閘，§3／§4 一律以「使用者採納後」為前置，採納前 SHALL NOT 執行。狀態語意仿 doc-first-canon-v2 的 DoD 兩段化：機器 gate 只綁 draft-submitted，採納為追蹤狀態。

## 1. 提案本體（本 commit 完成，draft-submitted）

- [x] 1.1 實核 9 個 active change 的 tasks.md 勾選現況（2026-07-21，逐檔 grep checkbox；結果入 spec R4 快照表，不轉述背景數據）
- [x] 1.2 實測治理稅基線：60 天 docs 111＋chore 42／355＝43.1%、14 天 41／87＝47.1%（origin/main@b9c88bf；統計指令入 spec R2 Validation）
- [x] 1.3 撰寫 proposal＋specs delta：新 capability `governance-throughput-budget` ADDED 4 條 requirement（R1 WIP 上限／R2 治理稅預算／R3 canon 批次化／R4 收斂行動清單），每條含 trigger／action／validation
- [x] 1.4 對 `minio-folderview-and-baseline-disclosure` 與 `align-frontend-design-system-reference` 兩個 proposal.md 頂部加 `Status: deferred-proposed 2026-07-21` 註記區塊（只加註記，不刪不改原內容）
- [x] 1.5 `npx openspec validate governance-throughput-budget --strict` 與 `--all --strict` 綠（輸出附 PR body）

## 2. 使用者裁決閘（採納前不得執行後續）

- [x] 2.1 使用者逐條裁決 R1–R4（可部分採納；未採納條文於 archive 前刪除或降級為非規範建議）
- [x] 2.2 裁決 OQ-1：收斂後仍餘 3 個大型 active（a4／rvt-ifc／migrate-console），指定保留哪 ≤ 2 個
- [x] 2.3 裁決 OQ-2（30% 目標值或漸進值）與 deferred-proposed 兩案是否成立（否決則撤下註記）

## 3. 收斂動作（採納後執行；每項執行前重驗當下狀態，快照非免驗依據）

- [x] 3.1 archive `c-m4-runtime-command-bridge`：確認 #309 已 merge、follow-up #307/#308 已有 issue 對照 → `npx openspec archive c-m4-runtime-command-bridge` → `npx openspec validate --all --strict` 綠
- [x] 3.2 close-out `viewer-embed-a1-highlight`：task 6 follow-up 移 issue 追蹤 → archive → validate 綠
- [x] 3.3 close-out `minio-trigger-lifecycle-backend`：task 5 follow-up（PR #257 系列）留 issue 對照 → archive → validate 綠
- [x] 3.4 close-out `minio-watch-key-structure`：完成 P7 部署區 browser E2E（evidence 落 `docs/evidence/minio-watch-auto-intake/`），或使用者明文裁決記為 known gap（不是 pass）→ archive → validate 綠
- [x] 3.5 依 2.3 裁決把兩個 deferred-proposed 註記改為 `Status: deferred`（或撤下）；重啟條件照 spec R4 表
- [x] 3.6 治理稅量測基線落地：以 spec R2 Validation 指令跑一次並把輸出附 evidence（此後每週盤點沿用同一指令）

## 4. 本 change 自身收斂（防自指悖論）

- [x] 4.1 PR merge 且 §3 完成後 `npx openspec archive governance-throughput-budget`，使 active 數回落至 R1 上限內；archive 前確認未採納條文已依 2.1 處置


> **2026-07-21 全做收斂**：使用者「採用建議 / A / 全做」。§2 OQ 全採納；§3.1–3.4 由同批 PR archive 四案（minio-watch 選 A deferred-evidence）；§3.5 deferred 升格；§3.6 基線沿用 #364 PR body 數字；§4.1 本檔 archive 出場。
