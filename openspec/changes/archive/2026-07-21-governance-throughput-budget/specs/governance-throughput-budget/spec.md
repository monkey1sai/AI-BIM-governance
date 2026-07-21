## ADDED Requirements

### Requirement: active OpenSpec change 同時數量 SHALL 不超過 2（WIP 上限）

（採納後生效）`openspec/changes/` 下之 active change——不含 `archive/`、不含 proposal.md 頂部帶 `Status: deferred` 系列標記者——同時 SHALL ≤ 2。deferred 標記格式 SHALL 為 proposal.md 頂部 blockquote：提案期 `Status: deferred-proposed <日期>`、使用者採納後改 `Status: deferred <日期>`，並各附理由與重啟條件；標記 SHALL 只加註不刪改原內容。

- **Trigger**：任何人或 agent 欲新建 active change（`/openspec new`、openspec-forge 產出落地前）。
- **Action**：先計數 active change；已達 2 → SHALL NOT 新建，改為先 archive／close-out／defer 既有 change 騰出額度。緊急安全修補或誠實鐵律違規修正得暫時超額，但 SHALL 於同 PR body 揭露超額理由與回落計畫。
- **Validation**（repo root，PowerShell）：

```powershell
(Get-ChildItem openspec/changes -Directory |
  Where-Object { $_.Name -ne 'archive' } |
  Where-Object { -not (Select-String -Path (Join-Path $_.FullName 'proposal.md') -Pattern 'Status: deferred' -Quiet) }
).Count
```

輸出 SHALL ≤ 2；或以 `npx openspec list` 人工核對。

#### Scenario: 已有 2 個 active change 時新提案被擋下

- **WHEN** active（非 deferred）change 數已達 2 且 agent 欲新建第 3 個 change
- **THEN** agent SHALL 停止新建並回報現有 active 清單與收斂選項（archive／close-out／defer）
- **AND** 僅在使用者裁決騰出額度或明文核准暫時超額後才得新建

### Requirement: rolling 14 天 docs+chore commit 佔比 SHALL 以 30% 為預算上限（治理稅預算）

（採納後生效）以 origin/main 的 rolling 14 天 commit 為母體，subject 以 `docs`／`chore` 開頭者計為治理稅，佔比目標 SHALL ≤ 30%。

- **Trigger**：每週一次盤點；或開任何 docs／chore PR 前自檢。
- **Action**：佔比 > 30% 時，當週 SHALL 只接受功能／缺陷類 PR（feat／fix／perf／test），非豁免之 docs／chore PR 延後至佔比回落。豁免項：安全修補、誠實鐵律違規修正；豁免合併時 SHALL 在 PR body 附當前佔比數字。
- **Validation**（git log 統計指令，repo root，PowerShell）：

```powershell
git fetch origin
$all = (git log --since="14 days ago" --oneline origin/main | Measure-Object -Line).Lines
$tax = (git log --since="14 days ago" --oneline origin/main |
  Select-String -Pattern '^[0-9a-f]+ (docs|chore)' | Measure-Object -Line).Lines
"tax={0} total={1} ratio={2:P1}" -f $tax, $all, ($tax / $all)
```

（基線實測 2026-07-21@b9c88bf：60 天 153/355＝43.1%；14 天 41/87＝47.1%。）

#### Scenario: 佔比超標當週 docs PR 被延後

- **WHEN** 週盤點顯示 rolling 14 天 docs+chore 佔比 > 30%
- **THEN** 當週新開之非豁免 docs／chore PR SHALL 延後合併，功能／缺陷 PR 照常
- **AND** 豁免項（安全／誠實修正）合併時 SHALL 在 PR body 附當前佔比數字

### Requirement: canon 修訂 SHALL 累積雙週一批處理，不逐條開 PR（canon 修訂批次化）

（採納後生效）手寫正本（`docs/plans/*.dc.html` 兩份、`docs/plans/docs-plans-README.md`）與 AGENTS.md／CLAUDE.md 參照鏈之修訂提案 SHALL 累積至雙週窗口，以單一 batch 提案 PR 提交（內含逐條變更清單與各自理由），SHALL NOT 逐條開獨立 PR 分散審批。豁免項：安全修補與誠實鐵律違規修正得即時單獨提案。本條不改變 `design-canon-change-control` 的寫入授權邊界（AI 僅提案、正本採納由使用者裁決），只約束提案的批次節奏。

- **Trigger**：任何非緊急 canon 修訂需求出現。
- **Action**：記入待批清單（issue 或 backlog 文件），於雙週窗口彙整為一個 batch 提案 PR 供使用者一次審批。
- **Validation**（git log 統計指令）：

```powershell
git log --since="14 days ago" --oneline origin/main -- `
  "docs/plans/*.dc.html" docs/plans/docs-plans-README.md AGENTS.md CLAUDE.md
```

雙週窗口內 touch 上述檔案之 PR 數 SHALL ≤ 1（豁免項除外；超出即為批次化失效訊號）。

#### Scenario: 兩條 canon 修訂需求併為一批

- **WHEN** 雙週內出現多條非緊急 canon 修訂需求
- **THEN** 它們 SHALL 併入同一個 batch 提案 PR 供使用者一次審批
- **AND** SHALL NOT 各自開獨立 PR

### Requirement: 現有 9 個 active change SHALL 依收斂行動清單處置（一次性收斂）

（採納後執行；下表為 2026-07-21 對各 change tasks.md 之實核勾選快照。比照分支收斂 spec §4 原則，**快照非免驗依據**——執行每項處置前 SHALL 重驗該 change 當下勾選現況與對應 PR merge 狀態。）

| change | 實核勾選（2026-07-21） | 處置提案 | close-out／重啟條件 |
|---|---|---|---|
| `c-m4-runtime-command-bridge` | 主 tasks 7/7 [x]；僅餘 2 條 follow-up（明文「本 change 範圍外，另立 issue」#307/#308） | archive | 前置：確認 #309 已 merge、follow-up 已有 issue 對照；跑 `npx openspec archive c-m4-runtime-command-bridge` |
| `viewer-embed-a1-highlight` | 6/7 [x]；僅餘 task 6 follow-up（明文不在本 change） | close-out → archive | follow-up 移 issue 追蹤後 archive |
| `minio-trigger-lifecycle-backend` | 5/6 [x]；僅餘 task 5 follow-up（明文不在本 change，含 PR #257 系列） | close-out → archive | follow-up 留 issue 對照後 archive |
| `minio-watch-key-structure` | 4/5 [x]；餘 task 5「P7 部署區 browser E2E」 | 條件式 close-out | 完成 P7 E2E 並附 evidence 後 archive；或使用者明文裁決記為 known gap（不是 pass）後 archive |
| `minio-folderview-and-baseline-disclosure` | 0/7 未動工 | deferred | 重啟條件：active ≤ 2 有額度且需求回到當期優先；重啟時 SHALL 先重驗 main 現況（#259 trigger 端點、watcher ledger）再調和 tasks |
| `align-frontend-design-system-reference` | 0/23 未動工（specs delta 已由 #363 PF-3 調和至 doc-first） | deferred | 重啟條件：active ≤ 2 有額度；重啟時 SHALL 重跑 `openspec validate --strict` 確認 delta 仍對準當時 main spec |
| `a4-semantic-search-model-qa` | 0/64 未動工（8 節全空） | 留待 OQ-1 裁決 | — |
| `rvt-ifc-usdc-lineage` | 1/48（僅 8.1 contract-only） | 留待 OQ-1 裁決 | — |
| `migrate-console-to-hifi-design` | tasks 0/35 未勾，但 main #357 已落 1/2 product code | 留待 OQ-1 裁決（建議傾向優先收尾） | 先對帳 tasks.md 勾選與 main 實際落地，再裁 |

- **Trigger**：本 change 被使用者採納且 OQ-1 裁決完成。
- **Action**：依本 change tasks §3 逐項執行，每項附最小驗證；deferred 註記由 `deferred-proposed` 改為 `deferred`。
- **Validation**：全部執行後，R1 之計數指令輸出 SHALL ≤ 2（另加本 change 自身於 archive 前的暫時 +1），且 `npx openspec validate --all --strict` 綠。

#### Scenario: 採納後執行收斂使 active 降至上限內

- **WHEN** 使用者採納本 change 並完成 OQ-1 裁決
- **THEN** 執行收斂動作後 `openspec/changes/` 之 active（非 deferred）change 數 SHALL ≤ 2（不計本 change 自身 archive 前的暫時佔位）
- **AND** 每個被 archive 的 change SHALL 滿足：對應 PR 已 merge、剩餘 follow-up 有 issue 對照或明文 known gap 紀錄
