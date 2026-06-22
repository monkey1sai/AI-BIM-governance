# AI-BIM-governance 編碼 harness 升級為「六邊形全方位編碼代理」實施計畫

> ⚠️ **早期研究稿（provenance，非現行真相）**：本檔是 2026-06-18 最初的 ultracode 研究合成，**已被正式 spec 取代並修正**——權威見 `docs/superpowers/specs/2026-06-18-hexagon-harness-upgrade-design.md`（及實際落地 PR #233/#234/#235）。本稿內的降階清單等細節後續經對抗審批判定有誤並已更正，保留僅為記錄研究起點。
>
> 本計畫每一條都對齊 repo 既有資產（`spec-to-done` SKILL.md、`std-plan.js`/`std-implement.js`/`std-evidence.js`/`fu-adversarial-verify-generic.js`/`ship-item.js`、AGENTS.md 四套工具管線、`.claude/settings.json` hooks、`artifacts/spec-to-done/*-state.md` 記憶系統）。所有「新增」檔案都標 **NEW** 並附絕對路徑；既有的標 **已有**。研究來源 inline 標註。
>
> 產出方式：ultracode dynamic workflow（7 agent，Sonnet4.6/xhigh 研究＋盤點，Opus4.8/max 合成）。約束：路由僅 Sonnet 4.6 + Opus 4.8、effort 僅 xhigh / max。

---

## 1. 六邊形定義 — 六軸現況與缺口

| # | 軸 | repo 現況（已有） | 缺口（gap） |
|---|---|---|---|
| **A. Planning / Decomposition**（拆解） | **已有且強**：`std-plan.js` 用 superpowers `writing-plans` 產 plan → 四軸平行 review（Completeness/Spec Alignment/Task Decomposition/Buildability，`std-plan.js:147`）→ opus fixer（`:178`）→ GitNexus impact 預掃（`:209`）。 | 缺「**issue-quality 前置閘**」：spec 進場前無結構化評分。GitHub 實證（2,512 issues 隨機森林 AUC 72%，arXiv:2512.21426）：well-scoped +16.44% merge 率、需外部環境 -9.4%、拆成具體步驟 +7.58%。P0 只查矛盾/placeholder（SKILL.md:37）。 |
| **B. Model + Effort Routing**（路由） | **部分有**：MEMORY `spec-to-done-multimodel-budget.md` + SKILL.md:174-184 三級散文；`.js` 內 `model:` 已落地。 | **缺差異化 effort**：實測 `std-plan.js`/`std-implement.js` 全部 Opus 與 Sonnet 都硬寫 `effort:'max'`（16 處 max、0 處 xhigh）。難度只靠 model 分流、沒靠 xhigh/max → 簡單 Opus 任務也燒 max（effort 文檔警告 max 會 overthink 結構化任務）。 |
| **C. Context Hygiene & Anti-Hallucination**（抗污染抗幻覺） | **已有且強**：(1) subagent context 天然隔離（獨立 1M、只回 schema JSON）；(2) **誠實鐵律**（AGENTS.md:68、SKILL.md:186-192）；(3) P5 refute-by-default cite file:line（`fu-...:45`）；(4) AGENTS.md/CLAUDE.md 行數預算（呼應 arXiv:2601.20404）。 | 缺「**citation-forcing 機械閘**」：P5 靠 prompt 自律、schema 未強制 `evidence:{file,line}`（可機械化，SELF-RAG arXiv:2310.11511）。缺 DACS（arXiv:2604.07911）per-agent ≤200 token registry——目前 P3 findings 全文灌進 P5。 |
| **D. Parallel Orchestration**（並行編排） | **已有骨架**：`agent()`/`parallel()`/`pipeline()`；P1 四軸平行、P5 verifier 平行。 | **P3 嚴格序列**（防衝突、正確但放棄安全並行）；缺 `pipeline()` 流式、缺 adversarial debate（proposer/skeptic/arbitrator，arXiv:2603.28488）。 |
| **E. Verification & Evidence**（驗證取證） | **已有且最強**：P4 七項 vertical slice + browser trace；P5 對抗複驗 + holistic critic；`.claude/settings.json` 真 pre-merge hook `require-gstack-evidence.ps1`（`Bash(gh pr merge*)` exit-2 阻擋）；P6 buffered merge。 | 缺 position-bias 防護（arXiv:2306.05685）；P5 critic `overall_safe` 布林被當 absolute gate，但 LLM-judge 對 absolute pass/fail 不可靠（arXiv:2503.05061）。 |
| **F. Self-Evolution & Memory**（自我進化與記憶） | **已有記憶層**：append-only `artifacts/spec-to-done/<slug>-state.md`；`plan-next-spec-to-done-aware.js` 讀 state+git log；MEMORY.md 60+ 教訓；`spec-to-done-adversarial-verify.js`。 | **完全缺自我精煉迴圈**：無 workflow self-modify SKILL.md/.js；HELD 教訓不自動回灌。缺 Voyager/MUSE skill library（arXiv:2305.16291, 2605.27366）、Darwin Gödel tried-before history（arXiv:2505.22954）。 |

**結論**：repo 在 **A/C/E 已 frontier 水準**；短邊是 **B（路由全 max 未差異化）、D（並行只用一半）、F（零自我進化）**。升級重心放這三邊。

---

## 2. Model + Effort 路由表

### 2.1 排除理由

**為何不用 Haiku 4.5**：不支援 `xhigh`（僅 Fable5/Opus4.8/4.7 支援）；200k context 天花板（非 1M）；SWE-bench Pro 39.5% vs Opus 69.2%；定位是被編排的 sub-agent 非 judge。（repo 既有 haiku Parse/Probe 屬機械抽取執行角色，不在難度分流範圍。）

**為何不用 Fable 5**：2026-06-15 官方停用（SKILL.md:172）；即便可用，$10/$50 是 Opus 2×、僅 ~6.4 分 SWE-bench 差、內容安全域會 redirect 引入非決定性。

### 2.2 路由表

| Tier | Model | Effort | spec-to-done 位置 | 依據 |
|---|---|---|---|---|
| **T1 Read/Explore/Triage** | `sonnet` | `max`¹ | P1 impact 預掃 `std-plan.js:209`、P3 per-task impact `:242` | Sonnet 快、1M 容全 repo、$3 便宜 |
| **T2 Standard Impl** | `sonnet` | `max`¹ | P3 機械 implementer `std-implement.js:275`、P1 四軸 reviewer、P3 首審 | 79.6% SWE-bench、雙 review + P5 兜底 |
| **T3 Hard Reasoning/Arch** | `opus` | **`xhigh`** ← 改點 | plan 作者 `std-plan.js:119`、非機械 implementer `:276`、BLOCKED 升級 `:282/:287`、FinalReview `:418` | Opus xhigh 是 Anthropic coding 官方推薦起點；max 會 overthink |
| **T4 Adversarial Verify/Judge** | `opus` | **`max`**（保留） | P5 verifier+critic `fu-...:45/:53`、fix-cycle `:182/:193`、fixer | judge 要最深推理；Opus 4.8 比 4.7 少 4× 放過 flaw；不可降 |

¹ Sonnet 無 `xhigh`（從 high 直跳 max）→ Sonnet 列全用 max，Sonnet↔Opus 斷層由換模型表達。
**Tie-break**：需 30+ tool-call 或 >64k 輸出？是→Opus xhigh，否→Sonnet max。

### 2.3 落地（單一 source of truth）

**NEW** `.claude\workflows\routing.js`：
```js
export const ROUTING = {
  read:   { model: 'sonnet', effort: 'max' },   // T1
  impl:   { model: 'sonnet', effort: 'max' },   // T2
  reason: { model: 'opus',   effort: 'xhigh' }, // T3 ← 唯一實質降階
  judge:  { model: 'opus',   effort: 'max' },   // T4 不可降
};
```
各 `std-*.js` import 此表取代 inline 字面。**唯一實質改動＝T3 創造層 max→xhigh（省成本+降 overthink，不動任何 gate）；T4 判斷層一律保留 max（安全邊界）**。對齊 SKILL.md:184「降級只發生在產出被 ≥2 層更強 gate 複核的位置」。

---

## 3. 抗上下文污染 & 抗幻覺（C 軸：機械化既有自律）

**已強制（保留）**：誠實鐵律（DEMO DATA/NOT BUILT/not observed）、subagent schema-isolation、AGENTS.md 行數預算。

**三條補強（NEW）**：
- **(a) Citation-forcing schema**：`fu-...js` verdict 每個 finding 強制 `evidence:{file,line,quote}`，缺則 tool-call 層 retry → 無法引用的宣稱被機械擋掉（SELF-RAG IsSUP）。
- **(b) DACS registry summary**：P5 入場改傳 ≤200 token/finding 摘要（`{id,claim,suspect_file}`）而非全文，verifier 要細節自己 Read（arXiv:2604.07911，wrong-agent 污染 28-57%→0-14%）。
- **(c) Stop hook 證據閘**：**NEW** `scripts\hooks\require-state-evidence.ps1` — 宣告 done 前檢查 state 檔有對應 phase 完成行，無則 exit-2。把 superpowers `verification-before-completion` 從自律升為強制。

---

## 4. 並行編排放大（D 軸）

- **4.1 Pipeline 流式**：**NEW** `.claude\workflows\openspec-converge.js`（loop-until-dry，把人手批次收斂自動化）；多 spec 時 P1 可流式（但 **P3 implementer 維持序列**，防衝突鐵則不破）。
- **4.2 Adversarial debate**：對「真 P1/P2 修不閉合」高風險裁定，插 proposer/skeptic/arbitrator 三角（共享 evidence、skeptic 必 cite、arbitrator 按證據強度）再回 P3 fix（arXiv:2603.28488 / 2510.12697）。
- **4.3 Loop-until-dry**：`repo-wide-adversarial-round-1.js`/`repo-health-scan.js` 從單輪改 K 輪無新發現才停。
- caps：16 並行 / 1000 total / 1 層巢狀；`parallel()` 失敗 resolve 成 null（repo 已處理）。

---

## 5. 自我進化 agent（F 軸：三層安全分級）

| 層 | 標的 | 自動? | gate |
|---|---|---|---|
| **L1 純記憶** | state.md HELD 行、MEMORY 候選 | **可自動 append** | 已 append-only 不可變 |
| **L2 skill library** | **NEW** `artifacts\skill-library\learned.jsonl` 成功 sub-procedure | **可自動 append** | 唯讀庫；入庫前須 ≥1 次 merged PR 驗證過（MUSE gating） |
| **L3 harness 本體** | SKILL.md / std-*.js / prompt | **嚴禁自動 commit** | 強制人類 PR 閘 + oracle |

**L3 安全進化迴圈**（Gödel staging + repo 既有 oracle）：累積 N 次同類 HELD → opus 提最小 diff 到 staging 分支 → 跑 `spec-to-done-adversarial-verify.js`（4 opus）當 fitness oracle → 回歸量測對比 baseline（相對非絕對，arXiv:2503.05061）→ 全綠且不劣於 baseline 才產 PR → **人類 merge**。配 **NEW** `artifacts\self-evolve\tried.jsonl` 防鬼打牆（Darwin Gödel）。MEMORY.md 索引仍人類寫。

---

## 6. spec-to-done 自主推進到 merge PR

現況**已能**跑到 merged PR（P6 buffered auto-merge），有六個強制停下點。逐閘裁決：

| 停下點 | 升級後 | 理由 |
|---|---|---|
| spec 矛盾 | **維持人類** | 誠實鐵律：不擅補 spec |
| GitNexus CRITICAL 未 ack | **維持人類** | 破壞性 blast radius 需 sign-off |
| browser evidence not observed | **維持人類** | not observed ≠ done |
| 真 P1/P2 修不閉合 | **半自主**：插 §4.2 debate 再試，仍不過才 HELD | debate 放大正確性但不繞 honesty |
| ship consent carve-out（release/hotfix/破壞性對外） | **維持人類** | merge 永遠人類於高風險 |
| 工具反覆故障 | **維持人類** | infra 壞非內容 |

**已自主、保留**：一般 PR 的 buffered auto-merge（pr-review-agent + CodeRabbit 綠 + 90~120s buffer + 無新 P1/P2 → squash merge）。pr-review-agent/CodeRabbit 扮演「非人類 approver」補上「issue creator ≠ approver」精神（GitHub Copilot pattern）。
可移植補強：PR body 寫 plan checklist 逐 commit 勾；CI 紅時起範圍化 fix agent 只吃失敗 test 輸出。
順手：統一 commit trailer（`std-*.js` 仍寫 legacy Fable 5，`ship-item.md` 寫 Opus 4.8 → 雙 trailer 不一致，統一為 Opus 4.8）。

---

## 7. 落地路線圖（最小可回復 diff + 先量 baseline）

- **Phase 0｜量 baseline**（不改 code，半天）：跑 1 代表性 spec 全程，記 token/耗時/fix 輪/HELD/gate 通過率 → **NEW** `artifacts\self-evolve\baseline.md`。沒 baseline 不算驗證過。
- **Phase 1｜Routing 差異化**（最高 ROI，1 天）：建 `routing.js`；T3 創造層 Opus max→xhigh（FinalReview `:418` 先不動）；T4 全保留 max；統一 trailer。量：成本應降、gate 通過率不掉，掉了 revert。跑 `spec-to-done-adversarial-verify.js` 確認語義沒破。
- **Phase 2｜抗幻覺機械化**（2 天）：verdict schema 加 evidence、P5 改傳 registry summary、加 Stop hook。
- **Phase 3｜並行放大**（2-3 天，選做）：`openspec-converge.js`、P5 fix 插 debate；P3 維持序列。
- **Phase 4｜自我進化**（最後，最謹慎）：先 L1+L2 純 append；L3 預設關閉、全鏈經人類 PR 閘。

**量測紀律**：每 Phase 用 Phase 0 同一把尺比；刪 code 拿一樣結果視為 win；大 log 先導檔再 grep。

**核心洞察**：最高 ROI 單一改動 = Phase 1 把 T3 創造層 Opus `max→xhigh`；**T4 判斷層 effort 一律保留 max 是不可妥協的安全邊界**。
