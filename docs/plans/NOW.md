# NOW — 本週主線（2026-07-23）

> **AI / 人：只聽這份。** 與本檔衝突時，以使用者最新口令為準，其次本檔，再才是 OpenSpec / 設計正本。  
> 維護規則：每完成一個 outcome 就改狀態；禁止同時推進 >2 個 active OpenSpec product change。

## 本週三軌（你已選 1/2/3）

| 序 | 軌 | 目標 | 狀態 |
|---|---|---|---|
| **0** | 治理 WIP（#364） | active ≤2；defer 其餘；採納 throughput 預算 | ✅ #364 MERGED + `governance-throughput-budget` archived |
| **1** | 收口 | 把「code 已 merge、tasks 假開著」的 change archive | **已 archive 7 案**（2026-07-21/22） |
| **2** | A4 | 只走切片 PR（先 #365，再下一刀） | **#365 + #380 + #382 + #383 MERGED**；current = S4-B coordinator session search proxy local-ready |

**並行規則：** 0 可與 1 同天；**2 與新功能不得再開第 3 條 active product change**。  
**本週不做：** A5–A10 全棧、`rvt-ifc-usdc-lineage` 實作、新 OpenSpec（除 archive/defer 註記）、整 repo 重掃。

---

## 軌 0 — #364 OQ 裁決建議（請你回「採用建議」或改數字）

| OQ | 題目 | **建議裁決** |
|---|---|---|
| OQ-1 | 收斂後保留哪個 ≤2 大 active | ✅ **已採納**：保留 `a4-semantic-search-model-qa` + `migrate-console-to-hifi-design`；`rvt-ifc-usdc-lineage` 已 deferred archive |
| OQ-2 | docs+chore ≤30% | ✅ **已採納**：首月 40% → 次月 30% |
| OQ-3 | #364 自身是第 10 個 active | ✅ **已採納**：#364 merge 後 archive `governance-throughput-budget` |

已完成 deferred archive（與 #364 裁決一致；均以 `--skip-specs` 保留未落地 delta，不同步 canonical specs）：

- `minio-folderview-and-baseline-disclosure` → `2026-07-22-minio-folderview-and-baseline-disclosure`
- `align-frontend-design-system-reference` → `2026-07-22-align-frontend-design-system-reference`（動視覺前再 thaw；本週 A4 切片以 `Full completion claimed: no` 可不綁 full design rebaseline）
- `rvt-ifc-usdc-lineage` → `2026-07-22-rvt-ifc-usdc-lineage`

---

## 軌 1 — 收口（幾乎是 archive，不是重寫）

> 下列 change 的 product code **多半已在 main**（見相關 PR）。剩的 unchecked 多是 **follow-up / 部署取證**，不應再當「未做功能」擋住 A4。

| Change | 真實狀態 | 本週動作 | 相關 merge 證據 |
|---|---|---|---|
| `viewer-embed-a1-highlight` | ✅ archived `2026-07-21-viewer-embed-a1-highlight` | done | #238 等 |
| `minio-trigger-lifecycle-backend` | ✅ archived `2026-07-21-minio-trigger-lifecycle-backend` | done | #259 |
| `c-m4-runtime-command-bridge` | ✅ archived `2026-07-21-c-m4-runtime-command-bridge`（新建 capability spec） | done | #309 |
| `minio-watch-key-structure` | ✅ archived `2026-07-21-minio-watch-key-structure`（`--skip-specs`；主線 scenario 已在 main） | 選 A deferred-evidence | #237 |
| `minio-folderview-and-baseline-disclosure` | ✅ deferred archive `2026-07-22-minio-folderview-and-baseline-disclosure`（`--skip-specs`） | 未完成 tasks 保留在 archive，non-canonical | #265 |
| `align-frontend-design-system-reference` | ✅ deferred archive `2026-07-22-align-frontend-design-system-reference`（`--skip-specs`） | 未完成 tasks／delta 保留在 archive，non-canonical | #363 |
| `rvt-ifc-usdc-lineage` | ✅ deferred archive `2026-07-22-rvt-ifc-usdc-lineage`（`--skip-specs`） | 未完成 tasks／6 個 new capability delta 保留在 archive，non-canonical | #354 |

### minio-watch task 5

✅ **選 A 已執行**（2026-07-21）：task 5 標 deferred-evidence 後 archive；不擋 A4。

### 收口 DoD（軌 1）

- [x] 7 個 closeout change 進入 `openspec/changes/archive/2026-07-21-*` 或 `2026-07-22-*`
- [x] deferred archive：lineage / minio-folderview / align-frontend（`--skip-specs`；不計 active WIP）
- [x] #364 merge + `governance-throughput-budget` archive（OQ-3 出場）
- [x] 本週 WIP focus 只保留 **A4 + migrate-console**；`implement-runtime-command-authority-and-rejection` 與 `add-single-gpu-session-ai-review-mvp` 的 retain/defer 另案裁決，不在本次 archive 範圍
- [ ] 過期 worktree 刪到 ≤5（人工／下一切可選）

---

## 軌 2 — A4（切片制；禁止一次 64 tasks）

### 權威

- OpenSpec：`openspec/changes/a4-semantic-search-model-qa/`（**整包仍 active，但只執行當前切片**）
- 設計正本：`docs/plans/AI-BIM 前後端設計文件.dc.html` §04 / §08 R2–R4
- 凍結面：不改 `governance-service/app.py` 入口形態、不改 `governanceProxy` 契約形狀亂擴、不改 `conversion_authority.py`
- 既有大 branch `codex/openspec/a4-semantic-search-model-qa`（~6k 行）= **待收斂資產**，不是本週重做來源

### 切片佇列

| Slice | Outcome（一句話） | 對應 tasks（約） | PR / 狀態 |
|---|---|---|---|
| **S1** | governance 能 atomic 驗證 3D handoff proof-set（不碰 coordinator store） | §6 governance 半部 | ✅ **#365 MERGED** `a02f20d` |
| **S2** | coordinator session-scoped handoff create/consume + 權限（principal/lease/binding） | §6.1–6.2 後端 | ✅ **#380 MERGED** `eaf8e11` |
| **S3** | viewer 消費 trusted handoff → 單一 focus/highlight + 狀態機 | §6.3–6.5 | ✅ **#382 MERGED** `add1d9b`；Full completion `no` |
| **S4** | 收斂舊 A4 大 branch 的 §2–§5 可合部分（llm/proxy/issue/UI）成小 PR | §2–§5 子集 | 🟡 S4-A #383 已 merge（`84bdf5c`）；S4-B local-ready 於 `feat/a4-s4b-session-search-proxy`；S4-C/D pending |
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
Base: origin/main 84bdf5c（#383 merged）；branch feat/a4-s4b-session-search-proxy；目前未 commit／push／開 PR。
Scope: 只做 coordinator session／partial-confirmation／IFC-ready search proxy、安全 transport 與 host-kit deploy seam；frozen governanceProxy.ts 不變。
Outcome:
  1) generic browser search 固定停用；session route 先驗 authenticated principal、active primary lease 與 exact active binding，再 server-side resolve model/artifact/source/mapping
  2) browser query controls byte-identical forward；拒絕 identity/authority/host-path override；IFC-ready compatibility route 限 lab 且 table-only
  3) governance transport 預設 loopback；non-loopback 必須 exact origin allowlist + 16–4096 字元 server-only token；redirect、timeout、response size/content type 與 recursive secret/path leak 均 fail closed
  4) mapping 採 coordinator-visible realpath containment + host-native absolute root 雙 namespace；host-kit 只讀 mount，token rotation 以 fingerprint 觸發 governance restart且不保存 raw token
Verification: coordinator npm run verify 64 files / 697 tests PASS（含 build）；deploy static + dry-run PASS；compose config PASS；OpenSpec change strict + 全 repo 63 items strict PASS；diff／secret／status gates於本切片 closeout重驗
Independent review: correctness/security/repo-hygiene 未發現新的 P1/P2；active binding、response leak、host bridge/token、IFC-ready 越權與雙 OS namespace blockers 已解除
GitNexus: detect_changes 三次 Transport closed，index stale at b2cd6d3；狀態為 UNKNOWN，不宣稱 pass
Boundary: 未跑 live Ornith、真實 Docker coordinator + host-native governance search、browser/Kit/design dual gate；未做 S4-C Issue 或 S4-D UI
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
| 2026-07-23 | #382／#383 merged；S4-B coordinator session search proxy、安全 transport 與 host-kit dual-namespace seam local-ready，S4-C/D 仍 pending。 |
