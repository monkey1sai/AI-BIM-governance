# agent-doc-context-budget 條文機器化：行數預算 / index 完整性 / dead-link / mirror 配對進 agent-governance gate

- 日期：2026-07-06
- Branch：`doc-governance-gates`
- 形式地位：本檔為本 PR 的 formal spec（`docs/superpowers/specs/*.md`，消 pr-review-agent `missing_openspec`）

## 問題

`openspec/specs/agent-doc-context-budget/spec.md` 有一組 SHALL 條文（AGENTS.md ≤250 行、CLAUDE.md ≤130 行、index 表涵蓋全部 `docs/agents/*.md` 無孤兒、index 列不得指向不存在的檔、CLAUDE.md 必須聲明 AGENTS.md 為 source of truth），但全部靠人肉 review 維護——治理規則自己沒有被治理。全域 CLAUDE.md 的原則「好規則要有 trigger、action、validation」尚未套用到規則本身。

## 假設

這些條文全部可機器判定，且正確落點是既有的 `scripts/tests/test-agent-governance-check.ps1`（agent-governance required check、PowerShell 5.1、無路徑過濾）：不新增 CI job、不新增腳本檔，沿用既有 Assert 模式延伸即可。

## 改動面（最小）

僅一檔 code：`scripts/tests/test-agent-governance-check.ps1` 新增一節機器閘門（純 ASCII，避 PS 5.1 無 BOM 編碼地雷）：

1. **行數預算**：`AGENTS.md` ≤ 250、`CLAUDE.md` ≤ 130（Get-Content 行數，等價 spec 的 wc -l 閘門；量 tracked 檔本體）。
2. **鏡像聲明**：CLAUDE.md 必須引用 AGENTS.md 並含 `source of truth` 字樣。
3. **無孤兒 sub-file**：每個 tracked `docs/agents/*.md` 必須同時出現在 AGENTS.md 與 CLAUDE.md 的 index；>400 行 sub-file 依 spec SHOULD 出非阻斷 Write-Warning（現況：repo-boundary-detail.md 667 行，已知、不阻斷）。
4. **無 dead link**：兩主檔引用的所有 `docs/**.md` 路徑必須存在（regex 抽取，glob/萬用字元天然排除）。
5. **mirror 配對**：每個 tracked `*/CLAUDE.md` 必有 sibling `*/AGENTS.md`，反向亦然（repo-local 七段 schema 慣例的機器化）。

## 成功標準

- 本機 PowerShell 5.1 跑 `test-agent-governance-check.ps1` 全 assert 通過（baseline 現狀即綠，僅一條預期警告）。
- agent-governance required check 在 CI 綠。
- 未來任何 PR 讓主檔爆預算、index 漏列、連結 404、mirror 缺半邊，agent-governance 直接紅，不再依賴人肉 review 記得檢查。

## 明確不做（YAGNI）

- GitNexus index 新鮮度檢查：CI 環境無 index，不可機器判定（pr-review-agent 已刻意 `-SkipGitNexus`）。
- sub-file >400 行升級為硬性失敗：spec 明文 SHOULD（非硬性），維持警告。
- 兩主檔 index「集合逐字相等」斷言：雙向全涵蓋（無孤兒）已蘊含存在檔案上的集合一致，逐字比對會被散文提及誤傷。
- 修改 openspec 既有 spec 本文：條文不動，只補執行面。
