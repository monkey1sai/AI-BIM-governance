# NOW — 本週主線（2026-07-23）

> 文件性質：working note；用於本週工作排序，不是 runtime/API contract 或完成證據。
> **AI / 人：只聽這份。** 與本檔衝突時，以使用者最新口令為準，其次本檔，再才是 OpenSpec / 設計正本。  
> 維護規則：每完成一個 outcome 就改狀態；禁止同時推進 >6 個 active OpenSpec product change。

<!-- lifecycle-ledger:start -->
```json
{
  "schema_version": "openspec-now-view/v1",
  "scope": "current",
  "changes": [
    { "id": "autonomous-linux-delivery", "status": "active" },
    { "id": "a4-semantic-search-model-qa", "status": "deferred" },
    { "id": "add-single-gpu-session-ai-review-mvp", "status": "deferred" },
    { "id": "align-frontend-design-system-reference", "status": "deferred" },
    { "id": "gpu-session-baseline-and-idle-reclaim", "status": "active" },
    { "id": "introduce-viewer-app-integration-surface", "status": "deferred" },
    { "id": "rvt-ifc-usdc-lineage", "status": "active" },
    { "id": "unified-console-runtime-truth", "status": "active" }
  ]
}
```
<!-- lifecycle-ledger:end -->

## 本週三軌（你已選 1/2/3）

| 序 | 軌 | 目標 | 狀態 |
|---|---|---|---|
| **0** | 治理 WIP（#364） | active ≤6；defer 其餘；採納 throughput 預算 | ✅ #364 MERGED；2026-07-24 使用者將上限由 2 調整為 6 |
| **1** | 收口 | completed 才 archive；deferred 留在 changes 並 frozen | **5 個近期 completed 維持 archive；4 個 unfinished change 維持 deferred** |
| **2** | A4 | 只走切片 PR（先 #365，再下一刀） | **#365 + #380 + #382 + #383 + #386 MERGED**；current = S4-B PR #384 final gate，next = S4-C |

**並行規則：** 0 可與 1 同天；所有軌與新功能合計不得超過 6 個 active product change；deferred/frozen 不因額度增加自動 thaw。
**本週不做：** A5–A10 全棧、新 OpenSpec（除 archive/defer 註記）、整 repo 重掃。

> **2026-08-19 owner 裁決（R-2026-08-19，lineage thaw）：** 使用者明示採納，`rvt-ifc-usdc-lineage` 由 deferred/frozen thaw 為 active（切片制，「禁止直接 apply」原則保留）。(1) tasks 1.1 的順序前置降級：`align-frontend-design-system-reference` archive 與 `migrate-console-to-hifi-design` closeout 不再擋 lineage coding，align successor 鏈（#649 起）與 lineage 平行進行；lineage 不得重建 align 目錄、不得重複宣告其 delta、不得動 `docs/plans/*.html` 唯一 authority 的衝突面禁令全數保留為 fail-closed 硬約束。(2) 切片：L1 = tasks 2.1–2.7（contract fixtures → `tests/contracts/`，不接 runtime、不動 legacy path）；L2 = tasks 1.2/1.3（compatibility matrix＋五個既有 spec 的 MODIFIED deltas＋strict validate）；**L2 完成前不得進行 3.x runtime 接線**（原 gate 保留）。(3) WIP 記帳：thaw 當日 non-deferred active 5→6，仍在 ≤6 內，未 defer 任何 change。(4) 既有 `/api/external/ifc-ready` 與 callback 路徑不變、cloud-lineage-publication 不得雙 authority、MySQL DDL 維持 REFERENCE ONLY。執行路由：coordinator（Fable）接手原 Codex 分支 `codex/openspec/rvt-ifc-usdc-lineage`。

> **2026-08-20 owner 裁決（R2，終局處置限縮）：** (1) `cross-service-structured-log-baseline` 終局關帳並 archive（93/93；13.11 terminal deferred-this-change；`--skip-specs`，canonical spec 已 byte-identical）；不另開 evidence-only successor。(2) `a4-semantic-search-model-qa` 維持 deferred；ledger `blocked_by` 不再指向已 archived 的 `a4-console-convergence`。真實外部條件（credential rotation／host-native Kit lab／獨立 reviewer）寫在 `current_slice`，不進 `blocked_by`（該欄僅允許既有 change id）。(3) `align-frontend-design-system-reference` 明列 **frozen-historical**、status 維持 deferred；不新增 `abandoned` STATUS enum。(4) `introduce-viewer-app-integration-surface` thaw 僅「使用者明確口令升 active」；deferred/frozen 不因額度增加自動 thaw。

> **2026-08-25 P0 例外揭露（使用者明確口令）：** 使用者在 canonical-linux 181 `:8004/ui` 實測回饋預設殼層（UnifiedConsole）全為 fixture 假數字／假按鈕、無法觸發轉檔，並指示「制定一個 spec-to-done 的 OpenSpec 修復此落差」。依本檔優先序「使用者最新口令 > 本檔」覆寫上方「本週不做：新 OpenSpec」，開立 `unified-console-runtime-truth`（spec-only PR；根因＝`migrate-console-to-hifi-design` 以 pixel parity 為 done、`converge-console-specs-to-shipped-behavior` 把 canonical 措辭收斂成替 fixture 背書、真資料接線散在 deferred change、且無 change 要求 `/ui` 預設入口為真值面）。non-deferred active 由 3 增為 4，仍在 ≤6 上限內，未 defer 任何 change。六個 owner 裁決點（D1 設計閘 P|H、D2 授權、D3 canonical-linux 關閉 dev routes、D4 align thaw 判定、canon 入口、A4 放置）未裁決前實作 §5 HELD；UI task 只憑 181 證據勾選（同 lineage 9.1 裁決）。（同日稍後 owner 已裁決六點：D1=P、D2=T4、D3=關閉 dev routes、D4=carve-out 不 thaw、不加側欄入口、A4 同意；記於 tasks §0。）

> **2026-08-17 P0 例外揭露：** 使用者明確要求建立 `autonomous-linux-delivery` OpenSpec，依本檔優先序「使用者最新口令 > 本檔」覆寫上方「本週不做：新 OpenSpec」。此 change 是目前最高優先治理項目；non-deferred active 由 3 增為 4，仍在 ≤6 上限內，沒有暗中 defer 或取代其他 active change。本次只接受規格，不宣稱 GitHub machine authority、canonical Linux deployment或 live activation 已完成；live truth 維持 `HELD/ACTIVATION_UNATTESTED`。

> **2026-07-29 例外揭露：** 使用者明確要求開立 `isolated-branch-stack-browser-e2e`（A4 tasks 4.x 所需的隔離 stack browser E2E 契約），依本檔優先序「使用者最新口令 > 本檔」採納，偏離上面「本週不做：新 OpenSpec」。non-deferred active 由 4 增為 5，仍在 ≤6 內。

> **2026-07-30 isolated stack progress：** PR #431 已對齊 30/33 tasks；latest-main merge commit `2ed4154` 已納入 #433 merge result。CI-pinned `PSScriptAnalyzer 1.24.0` 安裝後，task 2.5 的 static 與 isolated launcher tests 已通過。fresh P5 run `p5-20260730-163713` 綁定 manifest head `eed43c8a17274a573121fc604fa61aae0f408f29`，6 個 require-real Chromium cases 在 manifest identity／isolated health gate 後一致因現有 A4 沒有 downloaded IFC-ready job 而 fail closed；未產生成功 evidence manifest、PNG screenshot 或 observed runtime ID，只產生失敗 `trace.zip`、video 與 error-context Markdown。stop ownership gate 將兩個 backend 停止，`:8004`／`:49102` 前後均無 listener。該 run 另揭露 launcher `status` result 缺頂層狀態、導致 terminal lifecycle logging 例外；RED／GREEN repair 已補上 `active|degraded|stopped` 狀態、嚴格 process record/canonical entrypoint 驗證、停止前 listener ownership 驗證，以及 kill 後 bounded process＋port exit proof，並確認未證明終止時不釋放 recovery reservation。clean-head launcher run `p5-final-launcher-20260730-181500` 綁定 code subject `634e21ba0f358ce9d4c0b3f1664e0b4625257543`，實測 tsx root→listener descendant lineage、PID-reuse chronology gate 與 pinned process-tree stop；停止後 root/child PID、`:8005`／`:49103` listener 均為 0，`:8004`／`:49102` 前中後均為 0。未勾項仍為：4.3（base-identical governance test 的 GitNexus integrity mismatch）、5.2／5.3（A4 fixture／成功 evidence 缺口）。#433 lifecycle repair 已 merge，Trusted Merge Evidence 已退役；main normal required checks 保留。6.3 依 GitNexus `UNKNOWN / target not found` 記錄既有 sign-off，不宣稱 GitNexus pass。

> **2026-07-30 CI hermetic repair：** fresh Agent Governance run `30536369154` 揭露 mock stop 未注入 `ProcessExistsFn`，因 runner PID `4101/4102` 碰撞而 fail；test-only repair 已封閉 fake process lifecycle，production default 不變。

> **2026-07-30 PR #431 review repair：** source subject `4ee8f3e3b6454d63eb908dba09dba3aaf8e1afae` 已補 portable child wrapper、role-specific argument/environment port fail-fast、host-shared reservation、pre-created state directories、browser evidence default verifier、stale artifact pruning與 malformed/outside fail-closed、isolated A3/A4-only discovery、browser POST `query_id` 證據及合法 empty-result regression；三組失敗且未引用的舊 artifact 已移除。reviewer 最終 `ACCEPT`；`npm run verify` 為 78 files／945 tests，OpenSpec strict 71/71。clean-HEAD run `closeout-20260730-2010-7e99bb1` 為 `active`，manifest-owned stop 後 `8005`／`49103` listener=0，`8004`／`49102` 前後皆為 0。4.3、5.2、5.3 維持未勾：目前仍沒有 downloaded IFC-ready A4 fixture、成功 evidence manifest／PNG／runtime ID，不宣稱 full completion。

> **2026-07-30 PR #431 final hardening：** immutable code subject `ff76e22bcb98c19339dcf82612ffb7a317416997` 已含 `origin/main` `243d9647190d2dbd84c60de6282e9bb15815c2f5`（merge `ba6664a`）與前一 hardening `e3eac6c4510d9fab623dd6661a0480e0fb973169`。final reviewer `ACCEPT`（P1/P2/P3=0）；A3+A4 evidence scope、viewer preflight、cross-process reservation/ABA、strict malformed fail-closed、listener→inventory→listener stale proof、deleted-worktree shared residue reclaim、manifest-first recovery、typed evidence-writer PID/creation identity、deterministic per-lock stale-reclaim claim、ignored Playwright HTML report，以及 PowerShell 7.0–7.4 reservation timestamp string preservation均有回歸測試。PowerShell contract/static/production-boundary、targeted Vitest 64/64、targeted ESLint、viewer verify 78 files／960 tests（含 typecheck、production build、struct-log 23/23）、`git diff --check` 通過；repo-wide ESLint 仍被 18 個既有 `src/console/*` warning 的 `--max-warnings 0` 阻擋，實際 PowerShell 7.0–7.4 binary 未在本機執行。GitNexus index stale at `8b34c8e`，compare detect 為 critical／23 files／99 symbols／264 processes；fresh critical reviewer 已明確接受 residual risk，不宣稱 impact pass。30/33 tasks；4.3、5.2、5.3 與無成功 A4 manifest／PNG／runtime ID 維持 known gap，未在此 code subject 後重跑真實 browser/runtime smoke。

> **2026-07-30 PR #431 review convergence：** immutable code subject `0170c8dfb58b011e87f3d84252bafd21d7045afd` 已合入最新 `origin/main` `8f2ff8b4cb840f1258cc36690f8a13f5f9783a9d`（merge `cdd1f2f0449bc0cb61546bd836d7218256d5b0e1`）。修補項目為 child process inherited-environment allowlist／payload override、manifest-derived 且 realpath containment 驗證的 A3 fixture root，以及 identity-proven abandoned reclaim claim recovery（same-ID、malformed、active、provider failure 皆 fail closed，unlink 前重讀與重驗 canonical lock）。fresh reviewer `ACCEPT`（P1=0、P2=0；P3 僅缺不同 canonical lock ID 的獨立分支測試）；PowerShell contract/static/production-boundary、targeted Vitest 69/69、targeted ESLint、viewer verify 78 files／965 tests（含 typecheck、production build、struct-log 23/23）、verification manifest 22/22＋2/2＋7/7、deploy dry-run、secret scan、security exception、`git diff --check` 均通過。GitNexus linked-worktree health 為 unavailable/UNKNOWN，未宣稱 impact/detect pass，fresh reviewer 接受 residual risk。30/33 tasks；4.3、5.2、5.3 與無成功 A4 manifest／PNG／runtime ID 維持 known gap；A3 fixture seed/root availability 由後續 PR #434 持有，本 subject 未重跑真實 browser/runtime smoke，亦不宣稱 full completion。

> **2026-08-11 isolated stack 4.3 closeout：** replacement PR #500（supersedes #496）以 freshly fetched `origin/main` 重建 canonical LF history，依 2026-08-11 已記錄的 `test-agent-governance-check.ps1` 45 pass／0 fail與前置 skills-sync 11 pass／0 fail證據勾選 4.3；lifecycle ledger 對帳為 31/33，`last_verified`／`subject_commit` 等機器欄位以 `openspec/lifecycle-ledger.json` 為唯一權威，不在 NOW 手工複製。5.2／5.3 仍因既有 A4 downloaded IFC-ready fixture 與成功 evidence manifest／PNG／observed runtime ID 缺口保持未勾；不宣稱 browser/runtime 或 full completion。

> **2026-07-30 例外揭露：** 使用者明確要求套用並合併 `introduce-executable-architecture-contracts`；依同一優先序採納為第 6 個 non-deferred active change。Phase 1 contract/validator 已進 PR #439，後續 tasks 仍由該 change 持有；active WIP 維持 6/6，不得再新增未 deferred change。

> **2026-07-29 design gate 時間線＋三層交叉對抗驗證（摘要；完整版見 `openspec/changes/isolated-branch-stack-browser-e2e/proposal.md`）：** design gate 曾於 `13033cb` 因 `#a4` route IA 遷移（非樣式回歸）而紅，**已由 #429（`2b9573e`）就地重核 A4 golden 轉綠**，現 main（`bfcc433`）success；A4 golden 自此改溯**產品面**（manifest `baseline_provenance.authority = canonical_product_surface`），與其餘 12 screens（canon 投影）形成混合權威，衍生事項記 D-15。pinned origin 23/23 hash MATCH 維持成立（該面從不需要設計側核准）。三層驗證（L1→L2 三視角 refute-by-default→L3，基準 `13033cb`；重跑輪 X1/X2/X3 基準 `bfcc433`）推翻並撤回了多項 L1 裁決（A4 回 dock、擴充 capture 腳本、spectator 預算 1、dashboard 殼先做、Kit extension 否決、多項 owner 指派），逐條紀錄與新缺口 D-14～D-17、待裁決清單見 proposal「三層交叉對抗驗證」節。**重跑輪關鍵更正**：`viewer-viewport`／`embedded-viewer-bridge` 兩份 approved spec 已定案 A1–A4 內嵌 primary viewport 半邊（U-9 據此關閉）；canon 指名的承接 change `embedded-viewport` 不存在＝無主債務。剩餘問題 Q1–Q8 依使用者 2026-07-29 委任由 AI 以三層驗證代答，答案標「AI-裁決（使用者委任）」記於 proposal，可被使用者單方推翻（A1–A8 已落地；U-8/U-9 關閉、U-6/U-12 合併，見 proposal Q&A 節）。

---

## 軌 0 — #364 OQ 裁決建議（請你回「採用建議」或改數字）

| OQ | 題目 | **建議裁決** |
|---|---|---|
| OQ-1 | 收斂後保留哪個 active | ✅ 2026-07-21 原採納上限 2；2026-07-24 使用者調整為 ≤6。`rvt-ifc-usdc-lineage` 的 thaw 條件已由 2026-08-19 owner 裁決 R-2026-08-19 滿足（使用者明確 thaw），轉 active（切片制） |
| OQ-2 | docs+chore ≤30% | ✅ **已採納**：首月 40% → 次月 30% |
| OQ-3 | #364 自身是第 10 個 active | ✅ **已採納**：#364 merge 後 archive `governance-throughput-budget` |

2026-07-24 historical correction：deferred 不再放 completed archive；下列 change 均恢復原 id、保留 `Status: deferred`，未落地 delta 仍不構成 canonical authority。`minio-folderview-and-baseline-disclosure` 已於 2026-07-29 對帳 7/7 task 與 archive 證據後封存：

- `openspec/changes/align-frontend-design-system-reference/`（2026-08-20 R2：frozen-historical；status 維持 deferred；不因額度增加自動 thaw）
- `openspec/changes/rvt-ifc-usdc-lineage/`（1/48；2026-08-19 已依 R-2026-08-19 thaw 為 active 切片制，見「本週三軌」節的裁決揭露）

Archive lexical audit 在本次恢復後仍有 44 個歷史目錄、696 個 unchecked checkbox；三層交叉裁決未把它們判為獨立、可繼續執行的 unfinished owner（主要是已落地但 task bookkeeping 過時、已被 successor 承接，或已退役 service 的歷史工作），因此不批次搬移，也不改寫 archive 歷史。這批屬 legacy audit debt；新增 lifecycle gate 只對本次之後的新 archive fail closed，禁止再產生 unchecked/deferred archive。

---

## 軌 1 — 收口（幾乎是 archive，不是重寫）

> 下列 change 的 product code **多半已在 main**（見相關 PR）。剩的 unchecked 多是 **follow-up / 部署取證**，不應再當「未做功能」擋住 A4。

| Change | 真實狀態 | 本週動作 | 相關 merge 證據 |
|---|---|---|---|
| `viewer-embed-a1-highlight` | ✅ archived `2026-07-21-viewer-embed-a1-highlight` | done | #238 等 |
| `minio-trigger-lifecycle-backend` | ✅ archived `2026-07-21-minio-trigger-lifecycle-backend` | done | #259 |
| `c-m4-runtime-command-bridge` | ✅ archived `2026-07-21-c-m4-runtime-command-bridge`（新建 capability spec） | done | #309 |
| `minio-watch-key-structure` | ✅ archived `2026-07-21-minio-watch-key-structure`（`--skip-specs`；主線 scenario 已在 main） | 選 A deferred-evidence | #237 |
| `cross-service-structured-log-baseline` | ✅ archived `2026-08-20-cross-service-structured-log-baseline`（93/93；13.11 terminal deferred-this-change；`--skip-specs`） | done；evidence 重跑需 owner 另指定範圍與窗口 | #126、R2 2026-08-20 |
| `minio-folderview-and-baseline-disclosure` | ✅ archived `2026-07-29-minio-folderview-and-baseline-disclosure`（7/7 closeout reconciled） | done；archive proposal/tasks 為證據 | #265 |
| `align-frontend-design-system-reference` | ↩ deferred、**frozen-historical**（0/23；不新增 abandoned enum） | 維持 deferred；不 thaw、不平行 design coding | #363、R2 2026-08-20 |
| `rvt-ifc-usdc-lineage` | ⚡ active（切片制；2026-08-19 R-2026-08-19 thaw；1/48） | Slice L1 = tasks 2.1–2.7 contract fixtures；L2 前不得 runtime 接線 | #354、R-2026-08-19 |

### minio-watch task 5

✅ **選 A 已執行**（2026-07-21）：task 5 標 deferred-evidence 後 archive；不擋 A4。

### 收口 DoD（軌 1）

- [x] 5 個近期 completed closeout change 維持 archive；4 個 unfinished change 維持 deferred／frozen；structured-log 等待 fresh final 4-service runtime/P4 evidence 的明確重啟
- [x] lineage / align-frontend / semantic-search / structured-log 保留 `Status: deferred`、frozen/non-owner；minio-folderview 已在 2026-07-29 closeout 後 archive（歷史紀錄；lineage 已於 2026-08-19 依 R-2026-08-19 thaw 為 active，其餘維持 deferred）
- [x] #364 merge + `governance-throughput-budget` archive（OQ-3 出場）
- [x] 本週 WIP focus 保留 **A4 + migrate-console**；structured-log P5 evidence 已 deferred，`implement-runtime-command-authority-and-rejection` 與 `add-single-gpu-session-ai-review-mvp` 的 retain/defer 另案裁決，不在本次 archive 範圍
- [ ] 過期 worktree 刪到 ≤5（人工／下一切可選）— **2026-07-30 report-only 稽核（未執行刪除）**：主 repo 共 21 個 worktree。稽核方法＝`git worktree list --porcelain` ＋ 逐一 `git status --porcelain --ignored`（含 ignored 產物）＋ `git for-each-ref --contains <HEAD>`（reachability）＋ `.agents/board/sessions/*.json`（session 佔用）。結果：**in-use 6**＝main checkout（PR #436）、PR #431／#432／#433／#434 各一、deployment checkout `D:/Users/deploy/AI-bim-geo`。**可安全移除 7**＝`pr428` ＋ 6 個 `.codex/worktrees/*` detached；六個 detached HEAD 分別可由 22–28 個 ref 觸及，移除 worktree 不會產生 unreachable commit，且三項檢查（ignored 產物 0、board 未佔用、reachable）全過。**需先裁決 5**（porcelain 乾淨但帶 ignored 產物，`git worktree remove` 會連同刪除）＝`a4-semantic-search-model-qa-main-convergence`（29 項，含 `.gitnexus/`、`.workflow/`、`artifacts/e2e/design-system-visual*` 設計視覺證據）、`pr-422-a4-baseline-reapproval`（5 項，含 e2e 視覺證據與 `web-viewer-sample/dist/`）、`spec-to-done-cost-guardrails`（5 項，`.gitnexus/`、`logs/`、caches）、`codex+openspec+isolated-branch-stack-browser-e2e`（1 項 `.claude/settings.local.json`）、`pr-422-session-first-contract`（1 項 `node_modules/`）。**dirty 3**＝`ci-boundary-guards`（23 檔）、`.worktrees/cross-service-structured-log-baseline`（8 檔）、`.worktrees/pr-422-risk-loop-validation`（8 檔），含未提交工作。board 目前唯一 `status: active` 的 session 是 `codex--2a3983`（cwd `sign-main-commit-pr`），不屬上述任何一個。只移除那 7 個後仍有 14 個，達不到 ≤5；deployment checkout 與待裁決／dirty 者不列入「過期 worktree」。刪除屬 destructive 動作，維持人工執行，本項保持 unchecked。

---

## 軌 2 — A4（切片制；禁止一次 64 tasks）

### 權威

- OpenSpec：`openspec/changes/archive/2026-08-19-a4-console-convergence/`（**2026-08-19 已 archive，29/29**：前後端收斂為單一 canonical A4 實作；capability spec 已落地為 `openspec/specs/a4-semantic-search/spec.md`）。母版 `openspec/changes/a4-semantic-search-model-qa/` 已於 2026-07-29 標 `Status: deferred`（雙向分岔 126 衝突 + 1.8／7.4／7.5／8.7 受外部條件封鎖），不計入 active WIP，重啟條件見其 proposal 頂部。
- 設計正本：`docs/plans/AI-BIM 前後端設計文件.dc.html` §04 / §08 R2–R4
- 凍結面：不改 `governance-service/app.py` 入口形態、不改 `governanceProxy` 契約形狀亂擴、不改 `conversion_authority.py`
- 既有大 branch = **待收斂資產**，不是本週重做來源。2026-07-29 已保全上 origin：`codex/openspec/a4-semantic-search-model-qa-convergence`（`e0bac06`，前端 live Console 938 行在此）為收斂來源；其前身 `codex/openspec/a4-semantic-search-model-qa`（`9abb4af`）經逐檔比對確認被 superseded，本地已場銷。後端與 3D handoff 以 `origin/main` 為基準（`engine.py` 1160 行、`proofs.py` 623 行、6.3–6.5 已勾）。

### 切片佇列

| Slice | Outcome（一句話） | 對應 tasks（約） | PR / 狀態 |
|---|---|---|---|
| **S1** | governance 能 atomic 驗證 3D handoff proof-set（不碰 coordinator store） | §6 governance 半部 | ✅ **#365 MERGED** `a02f20d` |
| **S2** | coordinator session-scoped handoff create/consume + 權限（principal/lease/binding） | §6.1–6.2 後端 | ✅ **#380 MERGED** `eaf8e11` |
| **S3** | viewer 消費 trusted handoff → 單一 focus/highlight + 狀態機 | §6.3–6.5 | ✅ **#382 MERGED** `add1d9b`；Full completion `no` |
| **S4** | 收斂舊 A4 大 branch 的 §2–§5 可合部分（llm/proxy/issue/UI）成小 PR | §2–§5 子集 | 🟡 S4-A #383 與 UI compatibility prerequisite #386 已 merge；S4-B 由 PR #384 交付（最終狀態以 GitHub machine truth 為準）；S4-C/D pending |
| **S5+** | design/browser/runtime full gate | §7–§8 | 僅當 S1–S4 穩；允許長期 `Full completion claimed: no` |

### S3 local closeout／merge gate

```txt
S2: #380 merged 2026-07-22；coordinator handoff create/consume 與 principal/lease/binding 重驗已進 main。
S3 delivery: PR #382（branch codex/a4-s3-trusted-handoff；base b2cd6d3）。

Outcome observed locally:
  1) viewer strict-consume opaque a4_handoff；response/body tampering fail closed
  2) current session/principal/primary lease/model/artifact/revision + loaded stage + DataChannel gates 全過才送一個 focus/highlight
  3) pending/succeeded/rejected/timed-out 可見；matching terminal 才成功；explicit retry 使用新 request_id + retry_of_request_id
  4) principal/lease/binding drift、local_dev_lab、mounted a4_authentic_lease_unavailable 都 zero-send
Verification: web-viewer-sample typecheck PASS；affected ESLint PASS；unit suite 67 files / 745 tests PASS；production build PASS
Boundary: 未跑 browser dual-gate、design rebaseline 或 host-native Kit；未修改 shared auth/lease authority、Kit producer/schema
Full completion claimed: no
Next after S3 merge: S4，只選擇性收斂舊 A4 大 branch 的 §2–§5 資產，不整支 rebase/cherry-pick
```

### S4-A governance search local closeout／merge gate

```txt
Base: origin/main add1d9b（#382 merged）；branch feat/a4-s4-governance-search；PR #383 已 merge，結果 `84bdf5c`。
Scope: 只收斂 governance §2 interpreter / engine / LLM transport / proof / API + affected tests；保留 main handoff.py。
Outcome:
  1) deterministic / semantic / auto 只執行 governance validator 判定 complete + usable 的 candidate
  2) incomplete deterministic 只發 session-bound opaque partial_fallback_id，另次 exact confirmation 才能 table-only 執行
  3) LLM explicit-enable + transport matrix + bounded response/timeout + secret-safe observed status
  4) opaque query/retry correlation、truthful counts、dedicated rotating proof keyring；search-issued proof 可由既有 handoff verifier 驗證
Verification: targeted search/handoff 131 passed, 1 skipped；governance tests 246 passed, 2 skipped；OpenSpec strict 63 passed
Review fixes: 中文 `靠近` proximity 保持 unresolved 並 zero-scan；Unicode model binding 不再 500；LLM response read 以 remaining socket timeout + read 後 deadline guard 強制 bounded total deadline
Boundary: 未呼叫 live Ornith；未收斂 coordinator proxy、Issue persistence 或 canonical UI；未跑 A4 browser/Kit dual gate
Full completion claimed: no
Next: S4-B coordinator proxy；不得把 S4-C Issue 或 S4-D UI 混入本 PR
```

### S4-B coordinator session search local closeout／merge gate

```txt
Base: origin/main 20ce027（#386 merged）；branch feat/a4-s4b-session-search-proxy；PR #384 的 head／checks／merge state 以 GitHub machine truth 為準。
Scope: 只做 coordinator session／partial-confirmation／IFC-ready search proxy、安全 transport 與 host-kit deploy seam；frozen governanceProxy.ts 不變。
Outcome:
  1) generic browser search 固定停用；session route 先驗 authenticated principal、active primary lease 與 exact active binding，再 server-side resolve model/artifact/source/mapping
  2) browser query controls byte-identical forward；拒絕 identity/authority/host-path override；IFC-ready compatibility route 限 lab 且 table-only
  3) governance transport 預設 loopback；non-loopback 必須 exact origin allowlist + 16–4096 字元 server-only token；redirect、timeout、response size/content type 與 recursive secret/path leak 均 fail closed
  4) mapping 採 coordinator-visible realpath containment + host-native absolute root 雙 namespace；host-kit 只讀 mount，token rotation 以 fingerprint 觸發 governance restart且不保存 raw token
  5) canonical 89 MB IFC 的 cold parse 超過舊 5 秒 proxy budget；deterministic proxy 調整為 12 秒、一般 browser 仍為 15 秒；semantic／auto 採 browser 150 秒 > coordinator default 135 秒（hard max 140 秒）> governance LLM 120 秒 + IFC scan 10 秒，explicit timeout 仍回 classified secret-safe 502
Verification: coordinator npm run verify 64 files / 703 tests PASS（含 build）；viewer npm run verify PASS（typecheck／build／unit-DOM／structured log）；deploy static + dry-run 在 PS7／PS5.1 PASS；compose config PASS；OpenSpec change strict + 全 repo 63 items strict PASS；branch-isolated strict-real Playwright 4/4 PASS（1440×900 + 1920×1080 DPR1，89,394,282-byte IFC 第一筆未預熱 cold search 8.8 秒且 governance 4 POST 皆 200）
Independent review: web-plane repeated reconcile P2 已以 effective-config signature + regression 修正；既有 visible caller compatibility P2 已由 prerequisite PR #386 修正並 merge；timeout 初版 12／15 秒被 current-head review 判定會截斷合法 semantic／auto request，改為上述分層後由兩路 frozen-diff read-only review 確認 Standards／Spec 皆 0 P1/P2
GitNexus: detect_changes 三次 Transport closed，index stale at b2cd6d3；狀態為 UNKNOWN，不宣稱 pass
Boundary: 未跑 live Ornith、真實 Docker coordinator + host-native governance canonical deploy smoke、Kit/design dual gate；本輪 browser 證據是 isolated host-native compatibility flow；未做 S4-C Issue 或 S4-D canonical UI
Full completion claimed: no
```

### S1／S2 結案紀錄

- PR #365 merged 2026-07-21；tasks.md 已註 S1 done。
- PR #380 merged 2026-07-22；S2 runtime change 已在 main，tasks.md 狀態需隨下一個 A4 slice 對帳。
### 給 AI 的固定 prompt（之後每刀都貼）

```txt
Lane: B
只做 docs/plans/NOW.md 的「當前唯一 outcome」，禁止開新 OpenSpec、禁止順手治理重構、禁止一次做完整 a4-semantic-search-model-qa。

讀：docs/plans/NOW.md + 該 slice 列出的檔案/PR
Authority: NOW > 該 slice DoD > openspec a4 tasks 對應小節 > 設計文件 §04/§08
Out of scope: NOW 黑名單 + 其他 active/deferred change
Done: 通過 DoD 所列測試；回報 verified / inferences / risks
```

---

## 明確不做（本週黑名單）

- A5–A10 假後端 / 新 service  
- `align-frontend-design-system-reference` 全線接通（除非 A4 切片明確需要且單獨排期）  
- 「先理解整個 repo」當 session 入口  
- 同時開 >1 個 A4 大 branch 重寫  
- 把 follow-up（#307/#308、viewer-embed #6）塞進收口 PR  

---

## 建議日程（可壓縮）

| 日 | 動作 |
|---|---|
| D0–D3（已完成） | #365／#380 merge；七案 closeout archive；開始清理過期 worktree |
| D4+ | 開 A4 S3，之後才收斂舊 A4 branch 的最小可合子集 |

---

## 變更紀錄

| 日期 | 變更 |
|---|---|
| 2026-07-21 | 初版：使用者選 1 收口 / 2 A4 / 3 #364+NOW |
| 2026-07-21 | 採納建議/A/全做：#365 merge；4 change archive；deferred 三案；S2 成當前 outcome |
| 2026-07-21 | #364 merge；archive governance-throughput-budget；OQ 全落地 |
| 2026-07-22 | 使用者確認 deferred archive：`minio-folderview-and-baseline-disclosure`、`align-frontend-design-system-reference`、`rvt-ifc-usdc-lineage` 均以 `--skip-specs` archive；#380 merged，下一刀改為 S3。 |
| 2026-07-24 | 使用者改採嚴格 terminal rule：archive 僅限 completed／完整 successor；三個 7/22 deferred change 與 structured-log evidence 缺口 historical correction 恢復原 id，維持 frozen/non-owner。 |
| 2026-07-29 | `minio-folderview-and-baseline-disclosure` 完成 frozen closeout reconciliation：7/7 tasks 已有 terminal disposition，更新 lifecycle ledger 與 NOW projection 後 archive。 |
| 2026-07-24 | 使用者將 active OpenSpec WIP 上限由 2 調整為 6；新增額度不自動 thaw deferred/frozen change。 |
| 2026-07-29 | design gate 時間線收斂：`13033cb` 紅（`#a4` route IA 遷移）→ **#429 就地重核 A4 golden 轉綠**（產品面快照，混合權威記 D-15）；「rebaseline 關不掉」的早期斷言被 #429 實證推翻並在 proposal 誠實更正。三層對抗驗證＋重跑輪（X1/X2/X3）完成：缺口 D-1～D-17、Q1–Q8 依使用者委任由 AI 代答（標 AI-裁決、可推翻），全記於 `isolated-branch-stack-browser-e2e` proposal。 |
| 2026-07-23 | #382／#383／#386 merged；#386 先收斂 scoped A4 visible caller compatibility，S4-B coordinator session search proxy、安全 transport、host-kit dual-namespace seam 與 cold-scan timeout regression 由 PR #384 交付（狀態以 GitHub machine truth 為準），S4-C/D 仍 pending。 |
| 2026-08-19 | 使用者採納 R-2026-08-19：`rvt-ifc-usdc-lineage` thaw 為 active（切片制）；tasks 1.1 順序前置降級為衝突面約束（align successor 鏈與 lineage 平行）；Slice L1 = 2.1–2.7 contract fixtures、L2 = 1.2/1.3、L2 前不得 3.x runtime 接線；non-deferred active 5→6 仍在上限內；執行由 coordinator 接手原 Codex 分支。詳見「本週三軌」節 2026-08-19 裁決揭露。 |
| 2026-08-20 | owner R2 終局處置限縮：`cross-service-structured-log-baseline` archive（93/93、`--skip-specs`）；`a4-semantic-search-model-qa` 維持 deferred 且 `blocked_by` 清空（外部條件改記 current_slice）；`align-frontend-design-system-reference` 明列 frozen-historical、status 維持 deferred；`introduce-viewer-app-integration-surface` thaw 僅使用者明確口令。 |
