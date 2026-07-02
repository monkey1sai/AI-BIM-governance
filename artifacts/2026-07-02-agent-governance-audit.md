# 2026-07-02 Agent 治理體系全面審計

範圍：root/sub-repo AGENTS.md 與 CLAUDE.md、docs/agents/*、.claude/skills 與 .codex/skills 雙鏡像、.claude/workflows、.github/workflows、docs/plans/* 對齊、token 與開發速度優化。
方法：主對話盤點 + 5 個 readonly subagent（sonnet）平行深審 + 主對話（fable）綜合。全程唯讀，本檔為審計結論存檔。

---

## 一、對齊缺口（docs/plans 有、治理層沒有）— 按風險排序

| # | 風險 | 缺口 | 證據 |
|---|---|---|---|
| 1 | HIGH | **後端凍結契約零引用**：前端對齊DS手冊 §1 的 12 條凍結面（只打 :8004、proxy byte-identical、禁改 app.py/governanceProxy.ts/conversion_authority.py 等）在 AGENTS.md/CLAUDE.md/docs/agents 全部查無 | 前端對齊DS-保留後端-實作手冊.md:32-49；全治理層 grep 零命中 |
| 2 | HIGH | **需求效力序指錯**：AGENTS.md:25 把效力序第三的《設計規格.md》當「需求主來源」；真正最高效力的《互動實作規格與標準對齊.md》（22 條正典路由 A.1.1、23 張 IX 卡）治理層零引用 | docs-plans-README.md:10-21 §1 效力順序 |
| 3 | HIGH | **A1–A10 狀態唯一裁決源（對齊矩陣 §4.4）零引用**：agent 判斷 App 建成與否無指定權威，會重演「A4 誤標 built」 | design-system-對齊矩陣.md §4.4 |
| 4 | MED | 技術債防線（D-01~D-30 陷阱、§13 交付檢查表）治理層零引用 | 實作紀律與技術債防線.md |
| 5 | MED | Prov 型別僅 7 值、`"todo"` 會 TS2322 —— 治理層只有原則性「誠實鐵律」無機制線索 | web-viewer-sample/src/console/data.ts:6 |

**路由寫法矛盾**：product-operability-and-script-contract.md:26-27 教 `#/a1`（有斜線），plans 三份文件 2026-06-11 起正式勘誤為無斜線 `#a1`（EdgeConsole.tsx:36 的 regex 兩者都吃 → 非功能 bug，是文件教廢棄寫法；且該表只列 8 條路由、漏 14 條）。

**plans 內部 stale**：開發軌跡:130 O4（MinIO 自動偵測）已於 #210/#256/#258/#265 落地但未決表未標；:129 O3 應標「半解（local_fs 已落地，見 D7 :95）」。

**CARC/routeCensus 澄清**：repo 與 git history 零命中＝仍是 2026-06-24 拍板「延後落地」的方案，非已存在機制。**觸發條件已達成**（co-console PR #262 已 merge）→ §2 補登 PR（4 列別名 + demo-control stale 欄）隨時可做，零 code。

## 二、治理文件 stale 與矛盾（會真的咬人的）

| 位置 | 問題 |
|---|---|
| spec-to-done/SKILL.md:220 | 兩句與現實相反：「pr-review-agent 有 paths-ignore(#202)」→ 現行 pr-review-agent.yml **無** paths 過濾；「main 無 branch protection」→ 實查 **有** 11 項 required checks。P6 決策依據錯誤 |
| product-operability-and-script-contract.md:87 | PR body 表 label 缺 " tested" 字尾（check-pr-body-evidence.ps1:88 逐字比對 `Main button(s) tested`）→ 照抄必被 CI 擋 |
| 全部 9 份治理文件 | **「AI Coding Governance」第三張 PR body 表（7 必填欄位）零提及**；觸發條件含改 AGENTS.md/CLAUDE.md/docs/(agents\|plans) 本身（check-pr-body-evidence.ps1:69,74-82）→ 修治理文件的 PR 會撞到沒人教過的表 |
| github-workflow.md:121-123、ship-item.md:63、ship-item.js | 「官方 checks = pr-review-agent 且 CodeRabbit」→ 實查 branch protection 11 項無 CodeRabbit；required 的 agent-governance 反而沒被提 |
| governance-service/AGENTS.md:34 | 說 ifctester 未安裝 → app.py:98 + requirements.txt(≥0.8.5) + test_health_reports_ifctester_true 證實已安裝。**正本錯、鏡像(CLAUDE.md:5)對** |
| bim-streaming-server/CLAUDE.md:116-126、web-viewer-sample/CLAUDE.md:134-143 | 引用 2026-05-18 已刪的 `_bim-control`/`_s3_storage`/`_worker` 共 8 處。根因：**兩檔被各自 .gitignore 的 `/CLAUDE.md` 排除、從不進 PR review**（各 142/149 行，其中各 101 行是 GitNexus 自動樣板） |
| bim-streaming-server/AGENTS.md:32 | 受版控正本也有 1 處 `_worker` 殘留 |
| bim-streaming-server/CLAUDE.md:105、web-viewer-sample/CLAUDE.md:130 | repo-boundary-detail 章節引用 off-by-one（§3.4→應 §3.5、§3.5→應 §3.6），且誤稱「根目錄 AGENTS.md §3.x」 |
| web-viewer-sample/AGENTS.md:52-56 | 「npm run verify 等同 build」→ 實際 = build && test && test:struct-log |
| docs/agents/gitnexus-usage.md:5-47 | GitNexus block 第三份分岔拷貝：舊統計（4953 symbols vs 現行 17219）、舊工具名（gitnexus_impact vs impact）、缺 explain 條目。CLAUDE.md §4 卻指路到它 |
| AGENTS.md:25 | 引用的 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 不存在 |
| AGENTS.md:98-111 + repo-boundary-detail.md 兩份 mermaid | 缺 governance-service(:49102)/kit-manager-web/kit-manager-api 節點 |
| repo-boundary-detail.md（786 行） | **grep governance-service 零命中**（§3 邊界定義整個缺這個服務）；25-28%（~190-220 行）是散落歷史敘事，應遷 history-and-archive.md §3.1-3.3 |
| sub-repo-verify-commands.md | 無 governance-service 驗證段落（該服務測試基建齊全） |
| AGENTS.md:149-164 + repo-boundary-detail.md §12 | 宣稱 generated wiki 為 SoT 第 4 層，但 docs/wiki/ 不存在；README.md:143-144 明文警告過別這樣寫；兩段近逐字重複 |
| product-operability:115 | evidence 目錄 `viewer-validate-ifc-semantics-real-ifc/` 不存在（低風險，有備援寫法） |

## 三、Skills / 雙鏡像

- `.claude/skills` 與 `.codex/skills` 各 37 個頂層資料夾、結構完全一致；內容真 drift 7 檔：**gitnexus/* 6 檔 + obsidian-vault**。根因：#202(6/10) 把快照 commit 進 .codex、#212(6/12) 移出追蹤 → .codex 版永久凍結，.claude 版持續本機演化、無同步機制。
  - 有害案例：.codex obsidian-vault 教已知錯誤 vault 路徑（/mnt/d/...）；.codex gitnexus-guide 缺 trace/explain/pdg_query/check 四工具；gitnexus-cli 缺 `node .gitnexus/run.cjs` 用法。
- **結構性風險**：AGENTS.md:210-215 / CLAUDE.md:117-122 的 MUST 級規則指向的 gitnexus/* 6 檔**從未進 git**（.claude/* 被 gitignore）→ 新 clone / .claude 被清掉重建時 MUST 文件消失。`repo-health` skill 同樣未入白名單。
- `generated/*`＝20 個（非 23）GitNexus wiki 靜態快照（非 graphify 殘留），內容準確（引用檔案/symbol 皆在，行號系統性差 1）但**不進 session skill 清單、與活的 GitNexus MCP 完全重疊**＝冗餘可清。
- Matt Pocock 29 個中 4 個上游已標 deprecated：design-an-interface、qa、request-refactor-plan、ubiquitous-language（skills-lock.json 的 skillPath 落在 upstream skills/deprecated/）。
- spec-to-done SKILL.md 的 .claude（canonical）/.codex（model-adapter copy）是刻意設計，但互缺一段（.claude 缺 helper 路徑優先序；.codex 缺 routing.json/gen_routing.py 維運段）。
- .codex/config.toml 僅 4 行：sandbox 網路放行 + 停用 cloudflare plugin。

## 四、Workflows（22 檔 → 建議留 11）

**活（保留）**：std-plan / std-implement / std-evidence、routing.json（6 tests 親跑全綠；do_not_codegen 行號漂移為文件瑕疵零功能風險）、fu-adversarial-verify-generic、spec-to-done-adversarial-verify、repo-health-scan、ship-item.js + ship-item.md（刻意「規格+可執行」配對）、plan-next-spec-to-done-aware。

**殘留（候刪 10）**：fu1 / fu2 / fu34 / fullsystem-adversarial-verify、repo-wide-adversarial-round-1、bim-frontend-redesign-plan、fe-redesign-alignment-audit、ui-blueprint-a-vs-b-decision、spec-to-done-design（皆 #201 批次入庫後零編輯、零現役引用、部分綁死已消失的 worktree）＋ plan-next-spec-to-done.js（舊版，已被 -aware 取代）。plan-test-deploy-and-tidy.js 不確定（零引用，傾向殘留）。

**注意**：`ai-bim-branch-convergence.js`（session 起始 git status 的 untracked 檔）審計時已從磁碟消失，從未 commit、無法復原（模式同「並行 git 清 untracked」已知情境）。

**GitHub Actions**：3 個 yml 無 paths 過濾（合規）；branch protection 11 項 required checks 與 docs/PR_REVIEW_AGENT.md 逐字相符（該文件是準的）。

## 五、Token / 速度優化彙總

### 每 session 固定負擔（可動刀）
| 項目 | 現況 | 動作 | 估省 |
|---|---|---|---|
| superpowers 五件套雙重註冊 | global 手動複製版 + plugin 版並存（writing-plans、subagent-driven-development、systematic-debugging、test-driven-development、requesting-code-review） | 刪 global 複製版留 plugin | ~300-500 tok/session + 消除觸發混淆 |
| global 與專案無關 skills | baoyu-*15、ckm-*6、futu 2 = 23 個 | 移出 global（跨專案影響，需使用者拍板） | ~1-2k tok/session |
| workflows 殘留 | 10-11 條 skill 清單條目 | 刪檔或移 docs/archive/workflows/ | ~500-800 tok/session |
| repo CLAUDE.md | 124 行（工作守則 8 條近逐字重述 AGENTS.md §0.1、sub-file 表重複、§4 與 embedded block 重複） | 壓到 ~90 行 | ~700 tok/session |
| MEMORY.md | 73 條含已修/已解除/已退役標記者 | 整併壓縮 | ~1k tok/session |
| 合計 | | | **每 session 約 3.5-5k tokens** |

### 一次性檔案清理（省的是精準度與搜尋速度，非 session token）
- 15 個 worktree 目錄（git 註冊 3 + 孤兒 12）：Glob/Grep 不吃 gitignore → 每次搜尋被 stale 副本污染。三個註冊 branch 未 merge（squash-merge 需逐一比對內容再清）。
- generated/* 20×2 份、.codex 凍結 drift 7 檔、AGENTS.md/CLAUDE.md ~1500 行級冗餘。

### 行為面（最大宗，已在做、可制度化）
- routing.json 分級（haiku/sonnet/opus、judge 不可降）已是正確設計，維持。
- 「sonnet worker 收集事實 + 主模型綜合」的 dispatch 模式（本次審計即示範：5 worker 共 ~88 萬 subagent tokens 由 sonnet 承擔，主 context 只收結論）。

### 速度面
修「會咬人的 stale」= 省重試迴圈：PR body label 錯字（CI 擋一輪）、spec-to-done:220 錯誤敘述（P6 誤判）、CodeRabbit 誤導、repo-boundary 缺 governance-service（agent 查不到就亂推）、gitnexus/* 未版控（新 worktree 拿不到 MUST 文件）。

## 六、建議執行包

**P0（低風險純文件修正，一個 PR）**
1. 治理層補 plans 指路 3 行：AGENTS.md:25 改效力序摘要、§2 表加一列（docs-plans-README 跳板 + 前端凍結契約 §1）、product-operability §1 加凍結契約必讀一條
2. 修 stale：product-operability 路由改無斜線＋改指路 A.1.1、label 補 " tested"、補「AI Coding Governance」表說明一行；spec-to-done SKILL.md:220 兩句改正；CodeRabbit 措辭三處改正；governance-service/AGENTS.md:34 ifctester 改正；AGENTS.md:25 死檔名、mermaid 補節點、bim-streaming-server/AGENTS.md:32 `_worker` 殘留
3. docs/agents/gitnexus-usage.md 分岔 block 改 pointer 或重新 analyze 同步

**P1（結構收斂）**
4. 兩份 gitignored 厚 CLAUDE.md：修死服務引用後收進 AGENTS.md／改薄指標＋un-ignore（或明確接受不入版控）
5. gitnexus/* 6 檔 + repo-health 納入 .gitignore 白名單追蹤；.codex 側以 .claude 版覆蓋（含 obsidian-vault）
6. workflows 殘留 10 檔移 archive；generated/* 40 份清除
7. CLAUDE.md 124→~90、AGENTS.md 217→~192；repo-boundary-detail 歷史敘事遷 history-and-archive、**補 governance-service 邊界段**；sub-repo-verify-commands 補 governance-service 段
8. CARC §2 補登 PR（觸發條件 #262 已達成；4 列＋demo-control stale 欄，零 code）

**P2（需使用者拍板）**
9. global skills 縮編（23 個無關 + 5 個重複複製版）
10. worktree 清理（逐一驗 squash-merge 內容後 `git worktree remove` + 刪孤兒）
11. MEMORY.md 整併

## 附：證據等級
- **Verified**：本檔所有 file:line 均由 subagent 以 Read/grep/diff/git/gh api 親查；routing 6 tests 親跑通過；branch protection 以 gh api 親查。
- **Inference**：殘留判定（零引用+零編輯組合證據）、token 估算區間、CodeRabbit 措辭成因、.codex drift 根因時序。
- **Unverified**：GitNexus CLI 能否只寫單檔 embedded block；plan-test-deploy-and-tidy 原始意圖；ai-bim-branch-convergence.js 消失肇因與原內容。
