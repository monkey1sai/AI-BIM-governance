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
    { "id": "a4-console-convergence", "status": "active" },
    { "id": "a4-semantic-search-model-qa", "status": "deferred" },
    { "id": "add-single-gpu-session-ai-review-mvp", "status": "deferred" },
    { "id": "align-frontend-design-system-reference", "status": "deferred" },
    { "id": "cross-service-structured-log-baseline", "status": "deferred" },
    { "id": "gpu-session-baseline-and-idle-reclaim", "status": "active" },
    { "id": "implement-runtime-command-authority-and-rejection", "status": "active" },
    { "id": "isolated-branch-stack-browser-e2e", "status": "active" },
    { "id": "migrate-console-to-hifi-design", "status": "active" },
    { "id": "rvt-ifc-usdc-lineage", "status": "deferred" }
  ]
}
```
<!-- lifecycle-ledger:end -->

## 本週三軌（你已選 1/2/3）

| 序 | 軌 | 目標 | 狀態 |
|---|---|---|---|
| **0** | 治理 WIP（#364） | active ≤6；defer 其餘；採納 throughput 預算 | ✅ #364 MERGED；2026-07-24 使用者將上限由 2 調整為 6 |
| **1** | 收口 | completed 才 archive；deferred 留在 changes 並 frozen | **5 個近期 completed 維持 archive；3 個 unfinished historical correction 維持 deferred** |
| **2** | A4 | 只走切片 PR（先 #365，再下一刀） | **#365 + #380 + #382 + #383 + #386 MERGED**；current = S4-B PR #384 final gate，next = S4-C |

**並行規則：** 0 可與 1 同天；所有軌與新功能合計不得超過 6 個 active product change；deferred/frozen 不因額度增加自動 thaw。
**本週不做：** A5–A10 全棧、`rvt-ifc-usdc-lineage` 實作、新 OpenSpec（除 archive/defer 註記）、整 repo 重掃。

> **2026-07-29 例外揭露：** 使用者明確要求開立 `isolated-branch-stack-browser-e2e`（A4 tasks 4.x 所需的隔離 stack browser E2E 契約），依本檔優先序「使用者最新口令 > 本檔」採納，偏離上面「本週不做：新 OpenSpec」。non-deferred active 由 4 增為 5，仍在 ≤6 內。

> **2026-07-29 design gate 時間線＋三層交叉對抗驗證（摘要；完整版見 `openspec/changes/isolated-branch-stack-browser-e2e/proposal.md`）：** design gate 曾於 `13033cb` 因 `#a4` route IA 遷移（非樣式回歸）而紅，**已由 #429（`2b9573e`）就地重核 A4 golden 轉綠**，現 main（`bfcc433`）success；A4 golden 自此改溯**產品面**（manifest `baseline_provenance.authority = canonical_product_surface`），與其餘 12 screens（canon 投影）形成混合權威，衍生事項記 D-15。pinned origin 23/23 hash MATCH 維持成立（該面從不需要設計側核准）。三層驗證（L1→L2 三視角 refute-by-default→L3，基準 `13033cb`；重跑輪 X1/X2/X3 基準 `bfcc433`）推翻並撤回了多項 L1 裁決（A4 回 dock、擴充 capture 腳本、spectator 預算 1、dashboard 殼先做、Kit extension 否決、多項 owner 指派），逐條紀錄與新缺口 D-14～D-17、待裁決清單見 proposal「三層交叉對抗驗證」節。**重跑輪關鍵更正**：`viewer-viewport`／`embedded-viewer-bridge` 兩份 approved spec 已定案 A1–A4 內嵌 primary viewport 半邊（U-9 據此關閉）；canon 指名的承接 change `embedded-viewport` 不存在＝無主債務。剩餘問題 Q1–Q8 依使用者 2026-07-29 委任由 AI 以三層驗證代答，答案標「AI-裁決（使用者委任）」記於 proposal，可被使用者單方推翻（A1–A8 已落地；U-8/U-9 關閉、U-6/U-12 合併，見 proposal Q&A 節）。

---

## 軌 0 — #364 OQ 裁決建議（請你回「採用建議」或改數字）

| OQ | 題目 | **建議裁決** |
|---|---|---|
| OQ-1 | 收斂後保留哪個 active | ✅ 2026-07-21 原採納上限 2；2026-07-24 使用者調整為 ≤6。既有 `rvt-ifc-usdc-lineage` 仍為 `Status: deferred`、frozen/non-owner，須另行滿足 thaw 條件 |
| OQ-2 | docs+chore ≤30% | ✅ **已採納**：首月 40% → 次月 30% |
| OQ-3 | #364 自身是第 10 個 active | ✅ **已採納**：#364 merge 後 archive `governance-throughput-budget` |

2026-07-24 historical correction：deferred 不再放 completed archive；下列 change 均恢復原 id、保留 `Status: deferred`，未落地 delta 仍不構成 canonical authority。`minio-folderview-and-baseline-disclosure` 已於 2026-07-29 對帳 7/7 task 與 archive 證據後封存：

- `openspec/changes/align-frontend-design-system-reference/`（與 migrate 的互斥需求完成 crosswalk 前不得 thaw）
- `openspec/changes/rvt-ifc-usdc-lineage/`（1/48；切片與 shared ownership 調和前不得 coding）

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
| `cross-service-structured-log-baseline` | deferred、frozen（92/93；缺 fresh final 4-service runtime/P4 evidence） | 由 `cross-service-observability` 明確重啟後只補該 evidence；不重套 pipeline/code/canonical spec | #126 |
| `minio-folderview-and-baseline-disclosure` | ✅ archived `2026-07-29-minio-folderview-and-baseline-disclosure`（7/7 closeout reconciled） | done；archive proposal/tasks 為證據 | #265 |
| `align-frontend-design-system-reference` | ↩ restored deferred、frozen | 先與 migrate 做 requirement/successor crosswalk；禁止平行 design coding | #363 |
| `rvt-ifc-usdc-lineage` | ↩ restored deferred、frozen（1/48） | 先切片與調和 shared ownership；禁止直接 apply | #354 |

### minio-watch task 5

✅ **選 A 已執行**（2026-07-21）：task 5 標 deferred-evidence 後 archive；不擋 A4。

### 收口 DoD（軌 1）

- [x] 5 個近期 completed closeout change 維持 archive；4 個 unfinished change 維持 deferred／frozen；structured-log 等待 fresh final 4-service runtime/P4 evidence 的明確重啟
- [x] lineage / align-frontend / semantic-search / structured-log 保留 `Status: deferred`、frozen/non-owner；minio-folderview 已在 2026-07-29 closeout 後 archive
- [x] #364 merge + `governance-throughput-budget` archive（OQ-3 出場）
- [x] 本週 WIP focus 保留 **A4 + migrate-console**；structured-log P5 evidence 已 deferred，`implement-runtime-command-authority-and-rejection` 與 `add-single-gpu-session-ai-review-mvp` 的 retain/defer 另案裁決，不在本次 archive 範圍
- [ ] 過期 worktree 刪到 ≤5（人工／下一切可選）— **2026-07-30 report-only 稽核（未執行刪除）**：主 repo 共 21 個 worktree。稽核方法＝`git worktree list --porcelain` ＋ 逐一 `git status --porcelain --ignored`（含 ignored 產物）＋ `git for-each-ref --contains <HEAD>`（reachability）＋ `.agents/board/sessions/*.json`（session 佔用）。結果：**in-use 6**＝main checkout（PR #436）、PR #431／#432／#433／#434 各一、deployment checkout `D:/Users/deploy/AI-bim-geo`。**可安全移除 7**＝`pr428` ＋ 6 個 `.codex/worktrees/*` detached；六個 detached HEAD 分別可由 22–28 個 ref 觸及，移除 worktree 不會產生 unreachable commit，且三項檢查（ignored 產物 0、board 未佔用、reachable）全過。**需先裁決 5**（porcelain 乾淨但帶 ignored 產物，`git worktree remove` 會連同刪除）＝`a4-semantic-search-model-qa-main-convergence`（29 項，含 `.gitnexus/`、`.workflow/`、`artifacts/e2e/design-system-visual*` 設計視覺證據）、`pr-422-a4-baseline-reapproval`（5 項，含 e2e 視覺證據與 `web-viewer-sample/dist/`）、`spec-to-done-cost-guardrails`（5 項，`.gitnexus/`、`logs/`、caches）、`codex+openspec+isolated-branch-stack-browser-e2e`（1 項 `.claude/settings.local.json`）、`pr-422-session-first-contract`（1 項 `node_modules/`）。**dirty 3**＝`ci-boundary-guards`（23 檔）、`.worktrees/cross-service-structured-log-baseline`（8 檔）、`.worktrees/pr-422-risk-loop-validation`（8 檔），含未提交工作。board 目前唯一 `status: active` 的 session 是 `codex--2a3983`（cwd `sign-main-commit-pr`），不屬上述任何一個。只移除那 7 個後仍有 14 個，達不到 ≤5；deployment checkout 與待裁決／dirty 者不列入「過期 worktree」。刪除屬 destructive 動作，維持人工執行，本項保持 unchecked。

---

## 軌 2 — A4（切片制；禁止一次 64 tasks）

### 權威

- OpenSpec：`openspec/changes/a4-console-convergence/`（**當前 active 切片**：前後端收斂為單一 canonical A4 實作）。母版 `openspec/changes/a4-semantic-search-model-qa/` 已於 2026-07-29 標 `Status: deferred`（雙向分岔 126 衝突 + 1.8／7.4／7.5／8.7 受外部條件封鎖），不計入 active WIP，重啟條件見其 proposal 頂部。
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
- `rvt-ifc-usdc-lineage` 實作 PR  
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
