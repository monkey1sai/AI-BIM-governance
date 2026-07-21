# NOW — 本週主線（2026-07-21）

> **AI / 人：只聽這份。** 與本檔衝突時，以使用者最新口令為準，其次本檔，再才是 OpenSpec / 設計正本。  
> 維護規則：每完成一個 outcome 就改狀態；禁止同時推進 >2 個 active OpenSpec product change。

## 本週三軌（你已選 1/2/3）

| 序 | 軌 | 目標 | 狀態 |
|---|---|---|---|
| **0** | 治理 WIP（#364） | active ≤2；defer 其餘；採納 throughput 預算 | 待你拍板 OQ（下方建議） |
| **1** | 收口 | 把「code 已 merge、tasks 假開著」的 change archive | 本檔開寫當日可做完 |
| **2** | A4 | 只走切片 PR（先 #365，再下一刀） | #365 open / MERGEABLE |

**並行規則：** 0 可與 1 同天；**2 與新功能不得再開第 3 條 active product change**。  
**本週不做：** A5–A10 全棧、`rvt-ifc-usdc-lineage` 實作、新 OpenSpec（除 archive/defer 註記）、整 repo 重掃。

---

## 軌 0 — #364 OQ 裁決建議（請你回「採用建議」或改數字）

| OQ | 題目 | **建議裁決** |
|---|---|---|
| OQ-1 | 收斂後保留哪個 ≤2 大 active | **保留 `a4-semantic-search-model-qa` + `migrate-console-to-hifi-design`**；`rvt-ifc-usdc-lineage` → **deferred**（契約可留、不排本週 code） |
| OQ-2 | docs+chore ≤30% | **首月 40% 漸進，次月 30%**（避免一次卡死必要 design-gate 文件） |
| OQ-3 | #364 自身是第 10 個 active | **審過即 merge 並立刻 archive `governance-throughput-budget`**（提案生效＝自身出場） |

已建議 deferred（與 #364 一致）：

- `minio-folderview-and-baseline-disclosure`
- `align-frontend-design-system-reference`（動視覺前再 thaw；本週 A4 切片以 `Full completion claimed: no` 可不綁 full design rebaseline）

---

## 軌 1 — 收口（幾乎是 archive，不是重寫）

> 下列 change 的 product code **多半已在 main**（見相關 PR）。剩的 unchecked 多是 **follow-up / 部署取證**，不應再當「未做功能」擋住 A4。

| Change | 真實狀態 | 本週動作 | 相關 merge 證據 |
|---|---|---|---|
| `viewer-embed-a1-highlight` | tasks 0–5 完成；#6 = **follow-up 範圍外** | **Archive**；follow-up 另開 issue（latch 注解 / A2–A3 / readiness） | #238 等 |
| `minio-trigger-lifecycle-backend` | tasks 0–4 完成；#5 = **follow-up 範圍外** | **Archive**；follow-up 不進本週 | #259 |
| `c-m4-runtime-command-bridge` | Task1–7 完成；剩 #307/#308 follow-up | **Archive**；security/robustness 另 issue | #309 |
| `minio-watch-key-structure` | code 已合；剩 **P7 真 bucket browser E2E** | **二選一**（見下） | #237 |

### minio-watch task 5（唯一可能要人動手的收口）

- **選 A（推薦，配合 A4 優先）：** Archive change，task 5 改記 `deferred-evidence`：`docs/evidence/minio-watch-auto-intake/` 若已有部分證據則引用；缺的標 known gap，不擋 archive。  
- **選 B：** 排半日跑 `rebuild-test-deploy` + 真 `bim-control` 多層 key + `#/pipeline` 截圖，再 archive。

**本檔預設：選 A**（你要 B 就回「minio-watch 選 B」）。

### 收口 DoD（軌 1）

- [ ] 上表 3～4 個 change 進入 `openspec/changes/archive/…` 或 tasks 全勾且 proposal 標 archived  
- [ ] active product change 數 ≤2（理想：只剩 A4 + migrate-console）  
- [ ] 過期 worktree 刪到 ≤5（至少刪掉已 archive 對應路徑）

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
| **S1** | governance 能 atomic 驗證 3D handoff proof-set（不碰 coordinator store） | §6 governance 半部 | **#365** `feat/a4-llm-hardening-slice1` — merge 優先 |
| **S2** | coordinator session-scoped handoff create/consume + 權限（principal/lease/binding） | §6.1–6.2 後端 | 待 S1 merge 後開 |
| **S3** | viewer 消費 trusted handoff → 單一 focus/highlight + 狀態機 | §6.3–6.5 | 待 S2 |
| **S4** | 收斂舊 A4 大 branch 的 §2–§5 可合部分（llm/proxy/issue/UI）成小 PR | §2–§5 子集 | 與 S2/S3 **串行**，禁止平行重寫 |
| **S5+** | design/browser/runtime full gate | §7–§8 | 僅當 S1–S4 穩；允許長期 `Full completion claimed: no` |

### 當前唯一可執行 outcome（S1）

```txt
Outcome: merge PR #365 — governance-service handoff proof-set 驗證權威
In scope: governance-service/search/handoff* + 其 tests（以 PR diff 為準）
Out of scope: coordinator handoff store、A4 UI 重寫、design rebaseline、A5–A10
DoD:
  1) CI governance-service tests 綠（已通過）
  2) CodeRabbit rate-limit 失敗可忽略或重跑；不得為綠而改產品行為
  3) merge 後在 a4 tasks.md 勾選對應 §6 governance 子項（或加「S1 done」註記）
  4) Full completion claimed: no
```

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
| D0（今天） | 你確認 OQ + minio-watch A/B；merge #365；archive 三個已完成 change |
| D1 | 開 A4 S2 branch（coordinator handoff）；#364 merge 後 archive 自身 |
| D2–D3 | S2 測綠 → PR；清理 worktree |
| D4+ | S3 或收斂舊 a4 branch 的最小可合子集 |

---

## 變更紀錄

| 日期 | 變更 |
|---|---|
| 2026-07-21 | 初版：使用者選 1 收口 / 2 A4 / 3 #364+NOW |
