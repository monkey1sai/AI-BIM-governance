# NOW — 本週主線（2026-07-22）

> **AI / 人：只聽這份。** 與本檔衝突時，以使用者最新口令為準，其次本檔，再才是 OpenSpec / 設計正本。  
> 維護規則：每完成一個 outcome 就改狀態；禁止同時推進 >2 個 active OpenSpec product change。

## 本週三軌（你已選 1/2/3）

| 序 | 軌 | 目標 | 狀態 |
|---|---|---|---|
| **0** | 治理 WIP（#364） | active ≤2；defer 其餘；採納 throughput 預算 | ✅ #364 MERGED + `governance-throughput-budget` archived |
| **1** | 收口 | 把「code 已 merge、tasks 假開著」的 change archive | **已 archive 7 案**（2026-07-21/22） |
| **2** | A4 | 只走切片 PR（先 #365，再下一刀） | **#365 + #380 MERGED**；S3 viewer trusted handoff = **#382** |

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
| **S3** | viewer 消費 trusted handoff → 單一 focus/highlight + 狀態機 | §6.3–6.5 | ✅ code complete，交付於 **PR #382**；Full completion `no` |
| **S4** | 收斂舊 A4 大 branch 的 §2–§5 可合部分（llm/proxy/issue/UI）成小 PR | §2–§5 子集 | S3 merge 後下一刀；禁止平行重寫 |
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
