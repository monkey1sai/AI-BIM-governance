# Section 0 前置 hard gate — 執行證據(2026-07-18)

> 本檔為 tasks.md §0 的執行證據暫存,開 PR 時摘錄進 PR body(0.2/0.3/0.4 的 DoD 載體)。全部指令於主 checkout、分支 `openspec-doc-first-canon-v2`(base=origin/main @ 0d24fb6)實跑。

## 0.1 錨點可行性 spike(hard gate)— PASS

```
grep -o 'id="[^"]*"' "docs/plans/AI-BIM 前後端設計文件.dc.html" | sort -u
→ id="sec1" … id="sec8"(恰 8 個,章級錨,無需求/區塊級錨)
grep -o 'id="[^"]*"' "docs/plans/AI-BIM Console Hi-Fi.dc.html"
→ 0 命中(Hi-Fi 檔連章級 id 錨都沒有)
grep -c 'data-canon-id' docs/plans/*.dc.html → 兩檔皆 0
```

三段結論(已制入 design.md §1.3/§1.5,本次親驗確認):
1. 正本章級錨 `sec1..sec8` 已證實存在;需求/區塊級錨不存在。**補充事實:Hi-Fi 檔零 id 錨——v2 草稿植錨方案必須涵蓋雙檔(Hi-Fi 亦需建立章級+區塊級錨)。**
2. 首選=v2 草稿自帶 `data-canon-id` 細粒度穩定錨(現存 0 命中,無命名衝突;屬提案文字一部分,隨使用者採納生效,與 R-A1 相容)。
3. sidecar anchor map 僅為使用者拒絕植錨時的末位降級(與 file:line 同屬易腐,不得作 R-C1 主要載體;design.md §1.5 已記)。

## 0.2 PF-1/PF-2 硬前置檢查 — PASS(main 仍為 v3)

```
grep -n "Workflow v3 and product design artifacts have distinct, non-overlapping authority" openspec/specs/documentation-source-of-truth/spec.md
→ 8:### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority
```

main 上 header 仍為 **v3**(align-frontend 的 RENAMED v3→v4 尚未落地)→ 本 change 的 MODIFIED delta 對準 v3 正確,PF-2 rebase 條件未觸發。開 PR 前須重跑本檢查一次。

## 0.3 MODIFIED 範圍對齊檢查 — PASS

- main spec `documentation-source-of-truth` 恰 **6 條** requirement(line 8/31/45/61/79/100)。
- change delta MODIFIED 恰 **2 條**,header 與 main line 8(「Workflow v3 and product design artifacts have distinct, non-overlapping authority」)、line 31(「文件分工調整必須走 PR 治理流程」)**逐字一致**;其餘 4 條(line 45/61/79/100)未出現在 delta=未觸碰。
- ADDED:documentation-source-of-truth 12 條(R-B1..R-B6、R-C1..R-C4、R-C2a、R-C2b)+ design-canon-change-control 4 條(R-A1..R-A4)。deltaCount=18。
- `npx openspec validate doc-first-canon-v2 --strict` → `Change 'doc-first-canon-v2' is valid`(openspec CLI v1.6.0,本 session 實跑;Section 0 完成後複跑一次亦綠,輸出見 commit)。

## 0.4 R-A4 可回復基準+dry-run restore — PASS

- 基準:git tag **`canon-v2-baseline-20260718`** → `0d24fb6`(=origin/main,四份手寫正本的改寫前狀態;本機 tag,開 PR 時一併 push)。
- dry-run restore:`git checkout canon-v2-baseline-20260718 -- <四份手寫正本>` 後 `git diff --stat -- docs/plans/` → **空**,`git status --porcelain -- docs/plans/` → **空**(restore 路徑可用、無殘留)。
- 一步 restore 指令(供 R-A4 引用):`git checkout canon-v2-baseline-20260718 -- "docs/plans/AI-BIM 前後端設計文件.dc.html" "docs/plans/AI-BIM Console Hi-Fi.dc.html" "docs/plans/docs-plans-README.md" "docs/plans/ai-bim-governance.css"`

## 使用者裁決轉錄(2026-07-18;指揮官第一手轉錄,非 subagent 產出)

**背景**:指揮官於 session 向使用者提出「六個待裁點+建議答案」表;使用者回覆逐字為:

> 「ultracode
> 全照建議，需使用spec-to-done技能執行+依照任務難度分配模型opus 4.8, fable 5, soneet 5 , with max or xhigh,」

「全照建議」=概括採納下列六點**指揮官建議內容**(使用者未逐點複述;內容措辭為指揮官原文,非使用者親述):

| # | 待裁點 | 採納之建議內容(指揮官原文摘要) |
|---|---|---|
| 1 | OQ-1 asbuilt-partial | 不採用;維持 7 值封閉 enum+non-normative 註記塊 |
| 2 | OQ-2 NVIDIA 綠授權盲區 | 裁「已關閉」(建議理由原文:「你 7/16 已拍板青系為唯一品牌方向;css 色票視為自有 token、無外部授權依賴,ledger 記關閉即可」) |
| 3 | OQ-3 AST drift CI | 不採用;留 follow-up drift-gate-lightweight |
| 4 | OQ-4 ui-open-regression 空窗 | 接受 known gap 標註;接 CI 列 canon v2 之後第一順位 follow-up |
| 5 | PR 時機 | 完稿後開正式 PR,**不掛 auto-merge** |
| 6 | 殘留檔 grill-round1-verify.js | 暫留 untracked |

**轉錄性質聲明**:repo 內此前無此裁決之 artifact(gap-ledger task 5.3 依證據紀律記 undecided 係**正確行為**,非誤植);本節為指揮官對 session 對話的第一手轉錄,subagent 無法查證對話故不得代寫。**最終 auditable 確認=使用者對本 PR 的 review 裁決**;若 review 時對任一點提出異議,以 review 為準。
