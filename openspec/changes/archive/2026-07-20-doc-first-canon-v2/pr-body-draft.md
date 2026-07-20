# PR Body 草稿 — doc-first-canon-v2（tasks.md 6.3）

> **用途**：本檔為 `doc-first-canon-v2` change 開 PR 時之 body 草稿，供指揮官／使用者開 PR 時複製「分隔線以下」全文貼入 GitHub PR body（本節說明與分隔線本身不併入；Base／Head SHA 由 GitHub PR 建立畫面自動記錄，不需寫入 body 文字）。三個 machine fields、AI Coding Governance 七欄、PF-1 重跑輸出、prep-evidence.md §0 摘要、`openspec validate` 輸出、交付物清單、提案性質聲明皆已備妥；開 PR 前僅需依「PF-1 前置檢查」節之提醒重跑一次 PF-1 grep（見該節文末 ⚠️ 提醒）。
>
> **本檔本身狀態**：draft-submitted。tasks.md 6.3 之 DoD 即本檔存在＋內容完整＋PF-1 輸出在內＋欄名與 `scripts/tests/check-pr-body-evidence.ps1`／`scripts/lib/pr-review-agent.ps1` 逐字一致。

---

## Summary

- **裁決 1（doc-first 翻轉）**：`documentation-source-of-truth` MODIFIED 2 條（「Workflow v3…」＋「文件分工調整必須走 PR 治理流程」，header 逐字重現、其餘 4 條未觸碰）＋ ADDED 12 條（R-B1..R-B6、R-C1..R-C4、R-C2a、R-C2b）：docs/plans 翻為需求唯一權威、code 偏離＝待修 implementation gap，同時保留「文件不得以宣稱掩蓋 runtime 未完成」誠實半句並證明非矛盾。
- **裁決 5（變更控制）**：新增 `design-canon-change-control` capability（ADDED，R-A1..R-A4）：手寫正本寫入邊界（AI 僅能提案、不自行 merge）、機器快照雙旗標、`support.js` 禁改、版本 bump＋備份回復程序。
- **21＋3＝24 項失真／核心翻轉**全數逐條 task 化並達 draft-submitted：改寫後正本 v2 連貫全文草稿（`.dc.html`×2＋`docs-plans-README.v2-draft.md`）、獨立 gap ledger、normative Crosswalk、24×11 追溯矩陣、AGENTS.md 參照鏈修正草稿、Open Decisions 專章——完整清單見下方「交付物清單」。
- **本 change 為 doc-only 提案**：不改任何後端凍結面（`app.py`／`governanceProxy.ts`／`conversion_authority.py`）、不改 `/ui/open`／public API／event／DB schema／MinIO layout／Kit-WebRTC protocol／GPU ownership；不改機器快照面（`design-system-reference.manifest.json`、`design-system-baseline/**`）與 `support.js`。手寫正本（兩份 `.dc.html`＋`docs-plans-README.md`＋`ai-bim-governance.css`）本身**未被本 PR 直接改動**——本 PR 只新增 `openspec/changes/doc-first-canon-v2/` 下之提案文件（spec delta＋草稿＋證據），供使用者審閱後另行採納。

## Change Classification

| Label | Value |
|---|---|
| Change lane | S |
| Behavior contract changed | no |
| Requirement source | docs/plans: openspec/changes/doc-first-canon-v2 specs delta（`documentation-source-of-truth` MODIFIED 2＋ADDED、`design-canon-change-control` ADDED；`proposal.md`／`design.md`／`tasks.md` 為承載文件） |

*（Change lane＝S：使用者 2026-07-18 明確 opt-in「使用 spec-to-done 技能執行」，見 `prep-evidence.md`「使用者裁決轉錄」節開頭之使用者逐字原話（未編號引述，第 46–47 行，含「需使用spec-to-done技能執行」）——此引述非該節六點裁決表之第 5 點（第 5 點＝「PR 時機／不掛 auto-merge」，於本檔下方提案性質聲明另作引用）；Behavior contract changed＝no：本 PR 僅新增 `openspec/changes/doc-first-canon-v2/**` 下之提案文件，不改任何 runtime 行為、不觸碰任何 code symbol，見下方 GitNexus evidence。）*

## AI Coding Governance

| Label | Value |
|---|---|
| Linked issue | 無（無對應 GitHub issue；需求承載於本 OpenSpec change 自身之 `proposal.md`／`design.md`／`specs/` delta，詳見 Requirement source 欄） |
| Requirement source | docs/plans: openspec/changes/doc-first-canon-v2 specs delta（同上，與 Change Classification 表同值） |
| CODEOWNERS / owner review | 已由 `.github/CODEOWNERS` 預設規則（`* @monkey1sai`）涵蓋；本 change 全數改動落於 `openspec/changes/doc-first-canon-v2/` 之下，未直接觸碰 `/docs/plans/`／`/AGENTS.md`／`/scripts/` 等具名 owner 路徑，故未觸發額外具名 review；owner＝使用者本人，review＝使用者對本 PR 之核准／退回裁決本身 |
| GitNexus evidence | `detect_changes({scope:"compare", base_ref:"main", worktree:".worktrees/doc-first-canon-v2"})` → risk_level=low；changed_files=17；changed_symbols=0；affected_processes=0（17 個新增檔案全數為 `.md`／`.dc.html` 文件、無 code symbol，此檔數含本檔 `pr-body-draft.md` 自身；2026-07-19 實跑，與 `git diff origin/main --stat` 之 17 files 一致） |
| Browser E2E evidence | Not run: no frontend product route or browser-facing implementation changed（doc-only；不觸碰 web-viewer-sample／governance-service 等 product code） |
| Agent workflow changed? | no（未觸碰 `.claude/workflows/`／`.github/workflows/`／`scripts/pr-review-agent.ps1` 等 agent 編排資產；本 change 全數落於 `openspec/changes/doc-first-canon-v2/` 之下） |
| Required checks expected | PR Review Agent（`pr-review-agent.yml` → `scripts/tests/check-pr-body-evidence.ps1`）；Agent Governance（`agent-governance.yml`）；CI（`ci.yml` changed-path classifier；服務層 job 因未觸及對應路徑預期 skip）；`openspec validate doc-first-canon-v2 --strict`（PR body 內附證據，非額外 CI job） |

## PF-1 前置檢查（提 PR 前必跑；本欄為 2026-07-19 重跑輸出）

proposal.md「硬前置檢查」PF-1 要求：提 PR 前 MUST 實跑下列指令確認 main 上 `documentation-source-of-truth` 仍為 **v3** header（`align-frontend-design-system-reference` change 帶有 RENAMED v3→v4 delta、尚未 archive、對同一條 requirement 對撞，見 proposal.md 現場事實段）。

```
$ grep -n "Workflow v3 and product design artifacts have distinct, non-overlapping authority" openspec/specs/documentation-source-of-truth/spec.md
8:### Requirement: Workflow v3 and product design artifacts have distinct, non-overlapping authority
```

**結論**：main 上仍為 **v3 header**（第 8 行）。PF-2（rebase 對準 v4）之觸發條件未成立，本 change 之 MODIFIED delta 對準 v3 正確，**無 blocker**。

> ⚠️ **開 PR 前提醒**：本輸出為 2026-07-19（本 task 執行時）之快照。`align-frontend-design-system-reference` 為 in-flight change，若其於本 PR 實際開出前先行 merge／archive，main 上 header 可能已變為 v4——**開 PR 當下 MUST 重新實跑本指令一次**；若已變 v4，依 proposal.md PF-2，本 change 之 MODIFIED delta 須先 rebase 對準 v4 header 再驗，此為**升級為 blocker**、須記入 PR body 並暫緩開 PR。

## Section 0 前置 Hard Gate 摘要（prep-evidence.md）＋ `openspec validate` 最終輸出

四項 hard gate 皆於 2026-07-18 執行並 PASS（完整證據見 `prep-evidence.md`；下列為摘要）：

| # | 項目 | 結果 |
|---|---|---|
| 0.1 | 錨點可行性 spike（hard gate） | PASS——正本章級錨 `id="sec1"`..`id="sec8"`（僅 `AI-BIM 前後端設計文件.dc.html`，恰 8 個）已證實存在、需求／區塊級錨不存在；Hi-Fi 檔零 id 錨（v2 草稿植錨方案已涵蓋雙檔）；首選＝v2 草稿自帶 `data-canon-id` 細粒度穩定錨（0 命名衝突）；sidecar anchor map 僅列為末位降級 |
| 0.2 | PF-1／PF-2 硬前置檢查 | PASS——main 仍為 v3 header（同上「PF-1 前置檢查」節之 2026-07-18 首次執行結果，2026-07-19 已複跑確認一致）；PF-2 rebase 條件未觸發 |
| 0.3 | MODIFIED 範圍對齊檢查 | PASS——main spec 恰 6 條 requirement（line 8/31/45/61/79/100）；delta MODIFIED 恰 2 條，header 與 main line 8／31 逐字一致；其餘 4 條（line 45/61/79/100）未觸碰；ADDED：documentation-source-of-truth 12 條＋design-canon-change-control 4 條，deltaCount=18 |
| 0.4 | R-A4 可回復基準＋dry-run restore | PASS——git tag `canon-v2-baseline-20260718` → `0d24fb6`（＝origin/main）；`git checkout canon-v2-baseline-20260718 -- <四份手寫正本>` 後 `git diff --stat -- docs/plans/` 與 `git status --porcelain -- docs/plans/` 皆為空（restore 路徑可用、無殘留）；一步 restore 指令已記入 `prep-evidence.md` §0.4，供 R-A4 引用 |

**`openspec validate doc-first-canon-v2 --strict` 最終輸出**（2026-07-19 複跑，於本 task 執行時）：

```
$ npx openspec validate doc-first-canon-v2 --strict
Change 'doc-first-canon-v2' is valid
```

## 交付物清單

**spec delta ×2**（`openspec/changes/doc-first-canon-v2/specs/`）：

- `documentation-source-of-truth/spec.md`（201 行）——MODIFIED 2 條（「Workflow v3…」／「文件分工調整必須走 PR 治理流程」）＋ ADDED 12 條（R-B1..R-B6 偏離處置序／誠實鐵律非矛盾／carve-out／需求正本邊界／R2 三態／內嵌 viewport 防護；R-C1..R-C4、R-C2a、R-C2b 承載規則）
- `design-canon-change-control/spec.md`（64 行）——ADDED 新 capability，R-A1..R-A4（手寫正本寫入邊界／機器快照雙旗標／`support.js` 禁改／改版可回復）

**三份正本 v2 改寫草稿**（`openspec/changes/doc-first-canon-v2/drafts/`，各為對應手寫正本之完整平行副本、非並行 patch）：

- `AI-BIM 前後端設計文件.v2-draft.dc.html`（817 行）
- `AI-BIM Console Hi-Fi.v2-draft.dc.html`（973 行）
- `docs-plans-README.v2-draft.md`（57 行）

**ledger**：`gap-ledger.md`（71 行，R-C1）——21＋3 項失真之唯一 `file:line` 證據集中地，正本內文只用穩定錨、零裸行號

**crosswalk**：`crosswalk.md`（95 行，R-C2a）——24 列 normative Crosswalk：失真項 ID／章節穩定錨／區塊錨／處置手法／可驗 DoD／所屬 Wave／對應裁決編號，每列獨立可勾

**矩陣**：`design.md` §3「24×11 追溯矩陣」（內嵌於 design.md，非獨立檔；R-C2b）——證明裁決↔失真項零缺格對映

**撈回**：`recovered-requirements.md`（127 行，R-C4）——`git show a271e46^`（舊七檔體系刪除前父版）實查撈回 TARGET-shell／TARGET-viewer／TARGET-contracts 負向驗收句與 A5–A10 domain 契約，逐句標 source commit file:line

**索引**：`adjudication-index.md`（64 行，tasks.md 6.2）——11 條裁決（design.md §2）逐一對號落實位置：spec delta requirement id／draft data-canon-id／task commit sha／驗證方式

**其餘交付物**：

- `drafts/AGENTS-refchain.v2-draft.md`（89 行）——AGENTS.md 參照鏈修正草稿（tasks.md 1.2；提案供審，`AGENTS.md` 本體未改動，`git diff main -- AGENTS.md` 為空）
- `design.md`（160 行）——關鍵技術決策與取捨、11 條裁決索引表、24×11 矩陣本體、gap ledger schema、follow-up changes、Open Decisions/Open Questions 專章（R-B5/OQ）、研究依據、本 change 自身失效模式風險表
- `carve-out-assertions.md`（187 行，R-B3 補償閘）——5 條 carve-out 清單逐條 diff 斷言（改寫前後語意等價檢核）
- `assembly-verification.md`（553 行，以 HEAD 為準）——§03／§08 merge-assembly 驗證＋24×11 矩陣逐格核對報告
- `prep-evidence.md`（60 行）——本節摘錄之 §0 執行證據原始載體＋使用者裁決轉錄
- `proposal.md`（51 行）／`tasks.md`（73 行）——提案主文＋24 task 分解與逐項 PASS 證據
- `pr-body-draft.md`（本檔）——tasks.md 6.3 交付物

（全數 17 個變更檔＝16 份既有交付物 ＋ 本檔 `pr-body-draft.md` 自身／`git diff origin/main --stat` 統計：17 files changed, 3763 insertions(+), 純新增、無刪除、無修改既有檔案；各交付物行數與此 insertion 數皆為 HEAD 快照，以開 PR 當下 `git diff origin/main --stat` 重算為準、後續 commit 會微調。）

## 提案性質聲明（draft-submitted vs user-adopted）

> **本 PR ＝ 提案供審，不掛 auto-merge。**

- 本 PR 之全部內容（spec delta、三份正本 v2 草稿、AGENTS.md 參照鏈草稿、gap ledger、crosswalk、矩陣、撈回、索引）皆為 **draft-submitted** 狀態——AI 已完成草稿並提交供審，尚未經使用者核准採納。
- **手寫正本本身（兩份 `.dc.html`＋`docs-plans-README.md`＋`ai-bim-governance.css`）未被本 PR 直接改動**；`design-canon-change-control` R-A1 明文：手寫正本為使用者專屬、AI 僅能提案、不自行 merge、不原地編輯。
- **user-adopted**（動真正本＋version bump）之採納訊號 ＝ 正本 v2 之 version-bump commit（merged、diff 觸及手寫正本、含版本號＋日期 bump、使用者核准／PR approve，見 `design.md` §1.4）；退回訊號 ＝ 本提案 PR 之使用者 close／comment 裁決記錄。兩者皆須**使用者核准後另行執行**，不在本 PR 範圍內、不由本 PR 自動觸發。
- 本 PR 合併（若使用者核准合併 `openspec/changes/doc-first-canon-v2/` 之提案文件本身）僅代表「提案已收斂、證據齊備、供進一步採納決策」，**不等於**手寫正本已改版；archive 前 MUST 確認使用者對採納／退回已表態（tasks.md 6.5），未表態不 archive。
- 依 `prep-evidence.md` 使用者裁決轉錄第 5 點：「完稿後開正式 PR，不掛 auto-merge」——本 PR 開出後停等使用者審閱，不套用 `default-enable-automerge-on-pr` 之預設慣例。

## 已知缺口／殘留（non-blocking，供審閱者知悉）

- **OQ-1（asbuilt-partial Prov 值）**：不採用、不併入 7 值封閉 enum；§08 R3 內以顯式 non-normative Open Decision 註記塊承載。
- **OQ-2（`ai-bim-governance.css` NVIDIA 綠品牌授權盲區）**：使用者以「全照建議」採納關閉建議（指揮官轉錄；青系為唯一品牌方向、css 色票視為自有 token、無外部授權依賴），最終確認=本 PR review；`gap-ledger.md` OQ-2 列因 R-C1 schema 無 `closed` enum，classification／status 維持 `undecided`／`open-decision`、採納鏈記於該列證據欄，未入正本 normative 條文。
- **OQ-3（AST/symbol 級 drift CI 可行性）**：不採用；列名 follow-up `drift-gate-lightweight`，工具可行性未經證實。
- **OQ-4（`ui-open-regression.spec` 未接 CI 空窗）**：正本 v2 明文標 known gap（非 pass）；接 CI 為 canon v2 之後第一順位具名 follow-up。
- **殘留 untracked**：`grill-round1-verify.js` 依使用者裁決暫留 untracked，不影響本 PR 之 tracked diff。
- **tasks.md 6.4（J1–J5 旅程端到端走查）**：軟性、非機器 gate，不列入機器完成判準；惟本 PR 內已完成走查（記錄見 `assembly-verification.md`「J1–J5 旅程端到端走查」節），並於走查中發現並修正 §08 header 標語矛盾（draft §08 改為「repo 決定「現況」」，見 `tasks.md` 6.4 PASS note）——非留待本 PR 之外另行走查。

## P5 對抗複驗結果(2026-07-19,fu-adversarial-verify-generic;開 PR 前最後一道 gate)

- **6/6 findings truly_closed**(crosswalk DoD 漂移修正、PR body 誠實化、design.md:95 裁決欄、OQ-2 schema 合規化、R2 卡三態重寫、指揮官 P4 evidence 宣稱)——每項由獨立懷疑者 refute-by-default 親跑重驗;not_closed=0、new_issues=0、**critic overall_safe=true**。
- critic 6 項非阻塞註記(誠實揭露,審查者須知):
  1. 18 處歷史 PASS 註記含方向相反的「CRLF 保留」措辭——audit-trail append-only 政策刻意保留原文+更正註記;git blob 實儲=純 LF(cat-file 核驗),完整清單見 assembly-verification.md。
  2. proposal.md/design.md §6b 對 OQ-2 仍呈「未裁決」框架——兩檔為裁決前歷史文件,刻意不回改;現態見 gap-ledger.md:45 採納鏈+prep-evidence.md 轉錄節。
  3. OQ-2 關閉與 Lane S opt-in 的唯一證據=指揮官對 session 對話的第一手轉錄(已誠實聲明性質);**最終 auditable 確認=本 PR 的 review 裁決**。
  4. tasks.md 5.6 敘述「7 張 domain 卡全標 planned」實際落地為群組級單一 banner(draft:562),語意等效、粒度描述略寬。
  5. §03/§08 merge-assembly 窮盡性證明為 task 5.1/5.2 時點快照,其後 5.7/6.1/6.4 三度編輯未重跑聯集證明;HEAD 差異已由 P5 critic 親算覆核無未解釋 hunk。
  6. GitNexus detect_changes 輸出為當時工具宣稱,P5 未重跑該工具,已以 `git diff origin/main --stat` 獨立覆核(17 檔全為 .md/.dc.html 純新增)。
