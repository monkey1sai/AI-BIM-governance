# 鑑識綜整報告：spec-to-done 的 plan checkbox 為何永遠勾不滿——文件疏漏 vs 真實未完成

**日期**：2026-06-23 ｜ **範圍**：PR #233 / #234 / #237 / #238 四份 superpowers plan ｜ **方法**：引擎機制層拆解 + 逐 plan 落地比對 + 雙鏡頭（code-presence / record-honesty）對抗交叉驗證 ｜ **規模**：18 agents、~1.11M tokens、223 tool calls

---

## 1. TL;DR 一句話總答

**幾乎全是「文件疏漏」，不是「真實未完成」。** 四份 plan 合計 **126 個未勾 checkbox（37 + 12 + 25 + 52），全部都是 `- [ ]`（0 勾選）**，但其中 **122 項對應的工作都已實際合入 main 並逐行查實（DOC_GAP）**；只有 **4 項是真實刻意延後（REAL_DEFERRED）**，且這 4 項全部都有白紙黑字的文件依據（PR body / state 檔 / 程式碼註解 / `test.fixme` NOT BUILT 標記）。

**關鍵：沒有任何一項是「靜默缺口」(REAL_INCOMPLETE)——沒有「謊報完成、實際沒交付」的情形。** 雙鏡頭對抗在 refute-by-default 立場下嘗試推翻，**0 個分類被翻案**。

換句話說：checkbox 勾不滿，**是「完成追蹤產物層」的設計性疏漏（plan 的 markdown 從來不是完成的權威來源），不是 bug，更不是工作真的沒做。**

---

## 2. 機制根因：spec-to-done 為什麼從不勾 checkbox

完成狀態**刻意不記在 plan 檔**，這是設計，不是壞掉的回寫邏輯。整條鏈拆解如下：

| 階段 | 對 plan 檔做什麼 | 引用 |
|---|---|---|
| **建立** `- [ ]` | std-plan 指示 plan 作者「每步附 checkbox 步驟」，寫進 `docs/superpowers/plans/<date>-<slug>.md` 並 commit | `std-plan.js:107`(PLAN_PATH)、`std-plan.js:120` |
| **讀取** checkbox | std-implement 的 Parse agent 把每個 `### Task N` 抽成 `fullText`(含全部 checkbox 步驟)，**只當成餵給 implementer 的純文字指令**——implementer 不回讀 plan 檔 | `std-implement.js:214-219` |
| **回寫** `- [x]` | **完全沒有。** 全鏈(std-plan → std-implement → std-evidence → ship-item)沒有任何一處對 plan 檔做 `- [ ]→- [x]` 的 Edit/sed/replace。`.claude` 全樹 grep `- [x]` / `sed.*[x]` / `Edit.*plan` = **0 命中** | `std-implement.js:406-410`、`std-evidence.js:104-105`、`ship-item.js:38-52` |

**完成狀態真正記在哪（durable 跨 session 座標）**：

1. **State 檔散文 + 結尾 `✅ DONE`** — `artifacts/spec-to-done/<slug>-state.md`(例 `sessions-terminate-state.md:53`「✅ DONE」)。**唯一跨 session 的權威完成座標。**
2. **每個 task 的 git commit**，前綴 `task#N:` — `std-implement.js:282`「沒有任何 commit 不得回 DONE」，崩潰可從 git log 重建錨點。
3. **各 phase workflow 回傳的 StructuredOutput 布林**（P1.ok/P3.ok/.../P6.merged）——存在 run 記憶，不落檔。
4. **merged PR**（ship-item GATE → `gh pr merge --squash`，state 檔記 mergeCommit）。

底層 superpowers 的 SDD / executing-plans 同樣**不碰 plan 檔**：它們的「Mark complete」指的是 in-memory `todo([...], status:"completed")` 與 progress ledger(`subagent-driven-development SKILL.md:60,152-156`、`executing-plans SKILL.md:27-30`)，不是勾 markdown。

**判別自動 vs 手動的方法**：有 `<slug>-state.md`(含 `P1/P3.. runId=wf_..` Phase log)+ `task#N:` commit 前綴 = 自動 spec-to-done；只有 plan 檔 + 普通 commit、無 state 檔 = 手動 SDD/executing-plans。**兩條路徑都不勾 plan checkbox**，所以「沒勾」對兩者都不是判別依據。

---

## 3. 逐 plan 比對表

| Plan | PR | 走 spec-to-done? | 未勾/總數 | plan 級裁決 | 文件疏漏 or 真實紀錄 | 一句話理由 |
|---|---|---|---|---|---|---|
| **routing-spine-pr-a** | #233 (`3bfb27b`) | ❌ 手動 subagent-driven(無 state 檔) | 0/37 | **DOC_GAP_ONLY** | **全文件疏漏** | 8 個 Task、routing.json/gen_routing.py/三支 std-*.js wiring/baseline.md/SKILL.md 全合入 main，routing 測試 10/10、pytest 76/76 零回歸，無一項真未完成 |
| **anti-hallucination-pr-b** | #234 (`52aa41a`) | ❌ 手動 subagent-driven(無 state 檔) | 0/12 | **DOC_GAP_ONLY**(含 1 REAL_DEFERRED) | **11 疏漏 + 1 刻意延後** | Task 0/1/2 全落地(VERDICT_SCHEMA evidence-optional、MAX_Q/bad_findings、DACS 註解、openspec archive)；唯一未做的「Task 3 證據閘」在 plan v3 撰寫時即明文砍除 |
| **minio-watch-key-structure** | #237 (`8a36b86`) | ❌ 手動 subagent-driven(無 state 檔) | 0/25 | **DOC_GAP_ONLY**(含 1 PARTIAL) | **24 疏漏 + 1 部分延後** | Task 0–4 全落地(deriveIntakeFromKey ≥3 段、payload 新欄位、fixture 升級、vitest 431/431)；Task 5 唯「live 多層真實觸發 not observed」延後(唯讀 key 不能寫 bucket，待上傳) |
| **viewer-embed-a1-highlight** | #238 (`0401aae`) | ✅ **有 state 檔(P0→P7)** | 0/52 | **DOC_GAP_ONLY**(含 2 REAL_DEFERRED) | **50 疏漏 + 2 刻意延後** | coordinator route+型別鏈、EmbeddedViewer、Window M1/M2/M5 守衛、A1 整合、E2E+3 張截圖全落地；2 延後(ViewerPresentation prov 保持 p1、未對映截圖 `test.fixme` NOT BUILT) |

> **注意**：`viewer-embed-a1-highlight` 是四者中**唯一真正走 spec-to-done 自動流程**的(有完整 `viewer-embed-a1-highlight-state.md`，P0→P7、mergeCommit=0401aae 對得上 `gh pr view 238`)；另外三份是 superpowers 手動 subagent-driven。**但四者的 plan checkbox 全是 0 勾選**——這正好印證機制根因：勾不勾 checkbox 跟走哪條路徑無關，兩條路徑都不回寫。

---

## 4. 對抗交叉結果（雙鏡頭 refute-by-default）

兩個鏡頭(Lens A = 程式落地查證、Lens B = 紀錄誠實查證)都採「預設要推翻比對員」立場，逐 task 嘗試反駁。**結果：0 個分類被翻案，所有 `overallReconciliationAccurate=true`。**

### 4.1 重點查證（直接回答最關心的兩件事）

**PR-B「證據閘延後」是真實刻意延後嗎？ → 是，而且文件依據最紮實。**
Task 3(PreToolUse state-evidence 閘)的延後在**五個獨立位置**白紙黑字記載：plan 標題、plan line 6(附技術理由：freeform append-only state 無法可靠 gate、branch→slug regex 失配)、Tech Stack line 12、Self-Review line 168/176、PR #234 body 範圍裁定段。這是「刻意砍除、延後到先加 machine-marker 的獨立 spec」，**屬 REAL_DEFERRED，不是靜默缺口、也不是假裝做了的 DOC_GAP**(它確實沒建)。兩鏡頭都無法推翻。

**viewer-embed 是否真的接上 route（不是只接 mock）？ → 是，user-facing 鐵律過關。**
獨立查證確認 A1 頁真接線、非 mock：`pages.tsx:458` render `<EmbeddedViewer key={selectedSession} ref={viewerRef}>`；`:472` onFirstFrame **真呼叫** `coordinatorClient.reportFirstFrame`；`:509` `a1-highlight-3d` 是**真按鈕**(取代舊 disabled 占位)，`disabled` 由四條件(firstFrame ∧ selectedSession ∧ stageMatched ∧ rowHighlightable)控制，onClick 真呼 `viewerRef.current?.sendHighlight`；後端 `app.ts:882` POST `/first-frame` route + `nowIso()` 權威時戳 + `firstFrameObserved` eventLog 全在。兩鏡頭**實跑** coordinator 10 tests + web VG-01 61 tests = **71 passed**，非僅看 PR body。

### 4.2 對抗發現的「不影響裁決」瑕疵（誠實標註）

對抗沒翻案，但揪出**比對員 JSON 內幾處引述失準**(均不改變任何 verdict)：

- **#233**：`std-plan.js` 與 `std-implement.js` 的 `+行數`寫反了(plan 實為 +22、implement +33)；do-not-codegen 內聯註解標的行號(286/292/298)與 routing.json 宣告(276/282/287)是 stale line number——但保護由 consistency 測試的**字面字串斷言**強制，非行號，測試通過。
- **#238**：比對員把未對映截圖的標記寫成 `test.skip(true,...)`，**HEAD 實際是更強的 `test.fixme(...NOT BUILT: 列級高亮鈕...)`**，且 spec 內注解明說刻意不用 skip(避免被誤讀為 PASS 等價)。比對員**低估了**誠實標記強度，REAL_DEFERRED 結論仍正確。
- **#238 block-7**：`Task2-Window-selected-guid` 只落地了 viewer 端送出(`Window.tsx:839`)；console A1 端消費(onSelectedGuid→反查高亮)**未建**——但**已在 PR body P5 #4 與 state 檔誠實揭露為「半完成、留 follow-up」**，非隱藏缺口。

### 4.3 誠實鐵律違規

**無。** 每一處「已合併但未完成」都帶明確 `NOT BUILT` / `半完成` / `test.fixme` / `not observed` 標記(在 code、PR body 或 state 檔)。`#234`/`#233` 為純 harness/CI 工具(無 user-facing surface)，`#237` 的 E2E STUB MINIO/STUB CONVERSION 在 evidence README 明標、live 觸發明標 not observed，`#238` 的 A1 整合真接 live route。**沒有「宣稱完成卻有未交付」的情形。**

### 4.4 兩個 sub-repo 的 `tsc --noEmit` exit=2（查證附註）

對抗在本 checkout 跑 tsc 兩 repo 皆 exit=2，但錯誤**全來自缺套件**(coord: `@aws-sdk/s3-request-presigner` 子模組；web: 缺 `@types/node`)，錯誤檔均**非 VG-01 / 本 PR 產物**，屬本機依賴安裝退化，**非 commit 引入的型別錯誤**，不否定 landed。(minio 測試初次失敗亦同因 `@aws-sdk/client-s3` 未裝，`npm install` 後 33/33 綠。)

---

## 5. 結論與建議

### 結論
- **「plan checkbox 勾不滿」= 完成追蹤產物層的設計性疏漏，不是工作沒做、不是 bug。** 機制層從未打算寫 `- [x]`，完成真相刻意改記在 state 檔散文 + `✅ DONE` + `task#N:` commit + merged PR。
- 126 個未勾中 **122 = DOC_GAP(已落地)、4 = REAL_DEFERRED(有文件依據的刻意延後)、0 = 靜默缺口**。
- plan 的 markdown checkbox **本來就不該被當成 single source of truth**；它只是「餵進 implementer prompt 的純文字步驟清單」。

### 建議（可執行、最小變更，二選一即可）

**方案 A（推薦，零程式風險、最小變更）：在文件層明確宣告 plan checkbox 非完成依據。**
- 在 `spec-to-done/SKILL.md` 與 plan 模板頂部各加一行 banner：
  > 「本 plan 的 `- [ ]` checkbox **不會被自動回寫**；完成真相以 `artifacts/spec-to-done/<slug>-state.md` 的 `✅ DONE` + `task#N:` commit + merged PR 為準。checkbox 僅供 implementer 讀取步驟，勿視為完成度指標。」
- 一次 commit、無程式邏輯改動，直接消除「為什麼勾不滿」的認知落差。**符合「刪/標註拿到一樣結果視為 win」的最小變更原則。**

**方案 B（若堅持要 plan 自帶 closeout 痕跡）：在 ship-item GATE 後加一個 closeout 回寫步驟。**
- 在 `ship-item.js`(merge 成功後)新增一步：對 `PLAN_PATH` 做一次性 append 一個 closeout 區塊(不是逐個 `- [x]`，避免行號脆弱)，內容含 `mergeCommit` / `prNumber` / `task#N: commitSha` 對照表 + `closed-out: <ISO>`。
- 比逐 checkbox sed 穩健(不依賴行號 / 字面匹配)；與既有 commit 錨點機制一致。
- **成本/風險**：多一次 Edit + commit，需確保不破壞已 squash 的 PR(建議在 merge 後對 main 直接補一顆 docs commit，或併入下次 PR)。較方案 A 多動程式，YAGNI 角度可延後。

**判斷**：先做方案 A(文件宣告)。它一行解決「使用者誤把 plan checkbox 當完成度」的根本誤解，零回歸風險；方案 B 是「想讓 plan 自我閉環」時才需要的加值，屬非必要的自動化，可等真有需求再做。

---

**已知限制（標不確定）**：本報告的逐行落地證據來自比對員 + 雙鏡頭對抗的查證紀錄，另確認了 merge commit `0401aae` 與 state 檔 `viewer-embed-a1-highlight-state.md` 存在；GitNexus `detect_changes` 在 #237 plan 提及但**無執行 log**(unverifiable，屬程序未留證，非謊報——plan/PR 未宣稱已跑通過)。tsc exit=2 的依賴退化為本機環境問題，未在 CI 重現。
