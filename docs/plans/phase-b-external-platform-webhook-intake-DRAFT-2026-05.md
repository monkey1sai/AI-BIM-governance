# Phase B 規劃草稿：外部既有平台 webhook intake + 內部 mock 退役

> **文件性質**：planning / pre-OpenSpec **DRAFT**（不是 OpenSpec change，不在 `openspec/changes/`，不開 worktree/PR，不動產品程式碼）。
> **存在理由**：`NoSuccessorWhilePredecessorOpen` gate 目前擋住「升格為正式 OpenSpec change」——在途 change `introduce-ai-bim-runtime-manager-docker-kit-mvp`（PR #59）尚未 merge/archive。本草稿先把 Phase B 想清楚、備齊，gate 清掉後可一鍵 `openspec-propose` 升格。
> **權威來源**：邊界決策以 `AGENTS.md §1.A`（commit `0df76d9`）為準；roadmap 對應 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md §1.1A / §1.1B`；PDF `BIM模型管理平台 系統架構_260514.pdf`（雲地分離）。
> **回覆語言**：繁體中文；API 路徑 / schema 欄位 / status enum / 外部產品名稱保留原文。
> **建議升格 change-id**：`external-platform-webhook-intake-boundary`（候選別名：`retire-internal-mocks-external-webhook-intake`）。

---

## 0. 升格前置（gate 與排序）

```txt
擋路 gate：NoSuccessorWhilePredecessorOpen
predecessor：introduce-ai-bim-runtime-manager-docker-kit-mvp / PR #59 = OPEN（未 merge）
解除條件：PR #59 implementation merge + 對應 archive PR merge
升格步驟（gate 清除後）：
  1. git fetch origin --prune；確認本地 main == origin/main（吸收 PR #59 merge）
  2. 重新跑 change-id-resolve（確認 blockers=[]）
  3. opsx-worktree-guard → opsx-worktree-provision 開 codex/openspec/external-platform-webhook-intake-boundary
  4. 用本草稿內容跑 openspec-propose（§4/§5/§6 直接對應 proposal/design/tasks/spec delta）
  5. apply-and-verify 分批落地（§6 任務切片）
```

**為何現在不直接建**：PR #59 仍會改 `_worker/`、`openspec/specs/worker-artifact-pipeline/spec.md`、`compose.runtime-manager.yml`、scripts。Phase B 重度改同一批檔；平行開 change = 大量 merge 衝突（使用者已指定此為最高關注風險）。必須 rebase-on-clean-main。

---

## 1. Why（背景與動機）

PDF `BIM模型管理平台 系統架構_260514.pdf` 是**雲地分離既有平台**，已部署於公司測試機/正式機（`ppms 192.168.20.238` / `normal 192.168.20.237`），其 pipeline 終點是「客戶落地端 IFC Worker → 產出 .ifc」。

`AGENTS.md §1.A` 決策：
- PDF 平台（公司雲端 Web門戶/MySQL/SSO + 客戶落地端 IFC Worker+Revit）= **外部既有系統，非本 repo 開發範圍**。
- `_bim-control` / `_worker` 自核心開發 repo **降級為「外部既有平台的本地整合 fake」**，本 repo 不再為其新增產品功能。
- 本 repo 對外入口 = **可被外部呼叫的 webhook intake**，收到「.ifc 已就緒」通知後觸發**既有已實作**的 IFC→USDC（`bim-streaming-server`）。

目前程式碼仍是「內部 `_bim-control` → `_worker` → `bim-streaming-server`」三段內部 flow（`AGENTS.md §10` 閉環硬綁這兩個 mock）。Phase B 把入口邊界從「內部 mock 串接」改為「外部既有平台 webhook 驅動」，並把 mock 收斂為**可選 offline 開發用 fake**。

---

## 2. Scope（範圍）

### In scope

```txt
- 在 bim-streaming-server 形式化「外部可呼叫的 IFC-ready webhook intake」契約
  （auth / idempotency / network boundary / payload schema），觸發既有 IFC→USDC。
- 把 _worker / _bim-control 由「核心必跑服務」改為「可選 offline fake profile」
  （明確 flag/profile 開關；預設 readiness 路徑不依賴它們）。
- 改寫 AGENTS.md §2/§3/§4/§5/§10/§11 對 _worker / _bim-control 的核心定位與閉環；
  同步 CLAUDE.md 鏡像、roadmap（§1.6）。
- 收斂 ~14 個 .ps1（start-all / stop-all / *health* / smoke-* / verify-all 等）：
  _worker / _bim-control 啟動移到顯式 -OfflineFake 開關之後，預設不需它們。
- OpenSpec spec delta（§5）：MODIFIED 既有 + ADDED 一個 external intake 邊界 spec。
```

### Out of scope（non-goals）

```txt
- 不重寫 / 不重新驗證 bim-streaming-server 既有 IFC→USDC 轉檔邏輯
  （streaming-ifc-usdc-conversion-authority 已實作，僅換觸發來源）。
- 不開發 PDF 平台本身（Revit plugin / Nuxt 門戶 / MySQL / EZPLUS SSO 全屬外部）。
- 不物理刪除 _worker / _bim-control 目錄（Karpathy：先 reclassify + gate，
  relocate 為可選 follow-up；保留可 git revert）。
- 不在 Phase B 內處理 GPU 採購 / 多 Kit 並行（既有 P0-hold，分開）。
- 不碰 collaboration / annotation / review metadata 既有資料權威語意。
```

---

## 3. Design（設計）

### 3.1 Before / After

```txt
Before（內部 mock 串接，現況）：
  _bim-control(:8001 fake) --rvt_uploaded--> _worker(:8005 fake/blocked)
  _worker --ifc_ready--> bim-streaming-server(:49100) --IFC→USDC--> model.usdc
  bim-streaming-server --conversion_result_ready--> _bim-control

After（外部既有平台驅動，目標）：
  [外部] 客戶落地端 IFC Worker（PDF 平台，非本 repo）產出 .ifc
       │  ifc_ready webhook（intra-LAN，落地端內網）
       ▼
  [本 repo] bim-streaming-server webhook intake
       - 驗證 caller（shared secret / IP allowlist，落地端內網邊界）
       - idempotency key 去重
       - payload：{ ifc_url|ifc_ref, model_version_id, correlation_id, ... }
       │ 觸發既有 conversion authority（程式碼已存在）
       ▼
  IFC→USDC → model.usdc + element_mapping → Kit streaming → BIM 治理
       （coordinator / web-viewer-sample 不變）

  [離線開發] _worker / _bim-control = 可選 offline fake，模擬外部平台；
       behind `-OfflineFake` / profile flag；不在預設 readiness、不再開發新功能。
```

### 3.2 Webhook intake 落點

- **建議**：放在 `bim-streaming-server`。理由：它已是 `streaming-ifc-usdc-conversion-authority` + `conversion-webhook-lifecycle` 的擁有者，既有 `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/.../conversion_authority.py` 已處理 webhook → IFC→USDC。Phase B 主要是「形式化外部 caller 契約」而非新建轉檔。
- 替代：`bim-review-coordinator` 放一個 thin intake 再轉呼 streaming（多一跳、多一個失敗點，不建議；列為 §8 open question）。

### 3.3 與既有 spec 的關係

`conversion-webhook-lifecycle` 已定義 `rvt_uploaded` / `ifc_ready` / `conversion_result_ready` / `conversion_failed` + correlation / idempotency。Phase B 不重造輪子，只是：
- **來源**：`ifc_ready` 由「內部 `_worker`」改為「外部既有平台 IFC Worker」。
- **新增**：external caller 的 auth / network boundary / payload 契約。
- **readiness**：把 `_worker` / `_bim-control` 從 `demo-runtime-readiness-smoke` 核心 tier 移出，新增 `external_webhook_intake` 與 `offline_fake_mode` tier。

---

## 4. OpenSpec proposal 草案（升格時填入 proposal.md）

```txt
## Why
依 AGENTS.md §1.A：PDF 平台為外部既有系統；本 repo 入口改為外部 webhook
intake → 既有 IFC→USDC。內部 _worker / _bim-control 降級為 offline fake。

## What Changes
- ADDED：external-platform-webhook-intake-boundary（外部 caller 契約 + mock 降級邊界）
- MODIFIED：conversion-webhook-lifecycle（ifc_ready 來源 = 外部平台 + auth/network）
- MODIFIED：streaming-ifc-usdc-conversion-authority（觸發來源澄清，邏輯不變）
- MODIFIED：worker-rvt-ifc-bridge（RVT→IFC 屬外部；內部 _worker = 可選 offline fake）
- MODIFIED：bim-control-revit-intake-facade（RVT intake/metadata 屬外部平台；_bim-control = 可選 offline fake）
- MODIFIED：worker-artifact-pipeline（收斂為 offline-fake-only，不在核心 readiness）
- MODIFIED：demo-runtime-readiness-smoke（新增 external_webhook_intake / offline_fake_mode tier；核心不依賴內部 mock）
- MODIFIED：runtime-verification-evidence / runtime-verification-task-status（證據語意對齊）
- MODIFIED：documentation-source-of-truth（AGENTS/CLAUDE/roadmap 分工對齊 §1.A）

## Impact
- Affected specs：見上（1 ADDED + 8 MODIFIED 草案，升格時依實作收斂）
- Affected code：bim-streaming-server（intake 形式化）、~14 個 scripts、AGENTS.md/CLAUDE.md/roadmap
- 不改：bim-streaming-server 既有 IFC→USDC 轉檔核心、coordinator / viewer 既有契約
```

---

## 5. Spec delta 草稿（升格時放 `openspec/changes/<id>/specs/`）

> 以下為**草案語意**，非最終 OpenSpec 格式；升格時依 OpenSpec parser 標頭（`## ADDED Requirements` / `### Requirement:` / `#### Scenario:`）改寫，並依當時 `openspec/specs/` 現況收斂。

### ADDED — `external-platform-webhook-intake-boundary`

```txt
Requirement: 外部既有平台邊界
  PDF 平台（公司雲端 + 客戶落地端 IFC Worker）為外部既有系統；本 repo 不開發、
  不啟動、不健康檢查它。_worker / _bim-control 僅為「模擬外部平台」的可選 offline fake。
  Scenario：預設 readiness 路徑不啟動 _worker / _bim-control 即可成立。
  Scenario：-OfflineFake profile 下，_worker / _bim-control 才作為外部平台替身啟動。

Requirement: 外部 IFC-ready webhook intake 契約
  bim-streaming-server 提供可被外部呼叫的 webhook intake，收到 .ifc-ready 通知後
  觸發既有 IFC→USDC。
  Scenario：合法 caller（通過 auth + 在 network allowlist）送合法 payload
    {ifc_url|ifc_ref, model_version_id, correlation_id} → 建立 conversion job。
  Scenario：未授權 / 不在 allowlist 的 caller → 拒絕，不建立 job。
  Scenario：相同 idempotency key 重送 → 不重複建立 job（沿用既有 idempotency）。
  Scenario：payload 缺 ifc 參照 → 明確 4xx，不進轉檔。
```

### MODIFIED 草案重點

```txt
conversion-webhook-lifecycle：
  - ifc_ready 來源由「內部 _worker」改為「外部既有平台 IFC Worker」。
  - 新增 external caller 的 auth / network boundary 要求；
    correlation / idempotency / conversion_result_ready / conversion_failed 語意保留。

streaming-ifc-usdc-conversion-authority：
  - 觸發來源澄清為「external webhook intake」；轉檔 job/status/result 邏輯不變。

worker-rvt-ifc-bridge / bim-control-revit-intake-facade / worker-artifact-pipeline：
  - 由核心能力改為「offline fake profile only」；非預設 readiness 依賴；
    不再為其新增產品功能。

demo-runtime-readiness-smoke：
  - 核心 tier 移除對內部 _worker / _bim-control 的硬依賴；
  - 新增 tier：external_webhook_intake（外部 stub 觸發 → IFC→USDC）、
    offline_fake_mode（-OfflineFake 下完整閉環仍可跑）。
```

---

## 6. Tasks 草稿（升格時放 `openspec/changes/<id>/tasks.md`；分批、守 repo 邊界）

```txt
T1  spec：撰寫 ADDED external-platform-webhook-intake-boundary + 8 個 MODIFIED delta
    （openspec validate --strict 綠）。純文件。
T2  bim-streaming-server：形式化 external webhook intake（auth / IP allowlist /
    idempotency / payload schema），復用既有 conversion_authority；單元/契約測試
    （含 unauthorized / duplicate / missing-ifc）。最小改動，不改轉檔核心。
T3  readiness：demo-runtime-readiness-smoke 重分層；核心路徑改用「external 觸發 stub」
    取代內部 _worker/_bim-control；新增 offline_fake_mode tier。
T4  scripts：~14 個 .ps1 把 _worker/_bim-control 啟動移到 -OfflineFake 開關後；
    預設 start-all / health / smoke 不需內部 mock；offline profile 仍可完整跑。
T5  治理文件：改寫 AGENTS.md §2/§3/§4/§5/§10/§11（閉環去 mock 化）；CLAUDE.md 鏡像；
    roadmap §1.6 同步（Phase B 狀態、specs 清單、閉環圖）。
T6  verification report：external 觸發路徑 evidence + offline fake profile evidence；
    依 runtime-verification-evidence 分層；GPU/Kit 仍 deferred 不謊報 passed。
T7（可選 follow-up，不阻塞）：物理 relocate _worker/_bim-control → _fakes/，
    或保留原路徑只加文件標記（design 決定；預設不刪）。
```

每批驗證順序：type check → lint → 該服務目錄 affected unit/contract tests → 必要時 smoke；
Python tests 在各自服務目錄跑；不跨服務污染 `app` import cache。

---

## 7. 風險與衝突管理（使用者指定重點）

```txt
R1 與 PR #59 衝突：#59 改 _worker/ + worker-artifact-pipeline spec + scripts + compose。
   緩解：gate 強制 #59 先 merge+archive；Phase B rebase-on-clean-main 才開分支。
R2 閉環暫態不一致：AGENTS.md §1.A 已宣告新邊界，但 §10 閉環在 Phase B 落地前仍綁 mock。
   緩解：§1.A 已標 forward-decision 且優先序最高；T5 收斂；落地前本地 demo 照舊可跑。
R3 external caller 網路/auth 假設未定：caller 究竟是公司測試機 192.168.20.238 還是
   客戶落地端 IFC Worker（intra-LAN）？影響 auth 模型。→ §8 open question，design 收斂。
R4 readiness 退 mock 後可能掩蓋整合破口：用 external-stub + offline_fake_mode 雙 tier
   並存，保留可重現整合驗證。
R5 spec delta 面大（1 ADDED + 8 MODIFIED）：升格時依當時 openspec/specs/ 現況逐一收斂，
   不一次大改；高 impact 的 MODIFIED 先做 impact analysis。
```

---

## 8. Open questions（升格 explore 時必須收斂）

```txt
Q1 webhook caller 身分：公司測試機（192.168.20.238）直接呼叫，還是客戶落地端
   IFC Worker（與本 repo runtime 同落地端內網）呼叫？PDF 顯示重量資料/轉檔都在
   客戶落地端 → 推測 caller = 落地端 IFC Worker、intra-LAN。需使用者確認。
Q2 intake 落點：bim-streaming-server（建議）vs coordinator thin intake。
Q3 auth 模型：shared secret / mTLS / IP allowlist？（落地端內網 → 可能 allowlist 即可）
Q4 _worker/_bim-control 最終處置：原地 reclassify（建議）vs 移到 _fakes/ vs 之後刪。
Q5 conversion_result_ready callback 對象：外部平台是否要接回？還是只留本 repo 內部？
Q6 model_version / artifact metadata：外部平台已是權威，本 repo 是否仍需本地鏡像？
```

---

## 9. 升格 checklist（gate 清除後照這個走）

```txt
[ ] PR #59 implementation merged
[ ] PR #59 對應 archive PR merged（introduce-ai-bim-runtime-manager-docker-kit-mvp 已 archive）
[ ] git fetch origin --prune；本地 main == origin/main
[ ] change-id-resolve 重跑 → blockers=[]
[ ] opsx-worktree-guard → provision codex/openspec/external-platform-webhook-intake-boundary
[ ] openspec-propose：用 §4/§5/§6 產 proposal.md / design.md / tasks.md / specs/
[ ] §8 open questions 在 explore 階段逐一收斂（特別 Q1 caller 身分、Q3 auth）
[ ] apply-and-verify 依 T1–T6 分批；T7 視情況
[ ] 完成後 §1.6 同步 roadmap + AGENTS.md/CLAUDE.md，過渡語意收斂為正式邊界
```
