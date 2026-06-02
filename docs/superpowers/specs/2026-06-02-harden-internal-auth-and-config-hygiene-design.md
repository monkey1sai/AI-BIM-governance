# Design：harden-internal-auth-and-config-hygiene（L4 第一批）

> **執行權威 = OpenSpec change `harden-internal-auth-and-config-hygiene`**。本 design 為 2026-06-02 brainstorming 收斂記錄；實作細節、spec delta、驗證證據以該 OpenSpec change 的 proposal / design / specs / tasks 為準（避免設計權威多源，參見 spec `documentation-source-of-truth` 的 superseded-draft 規範）。

## 背景

2026-06-01 風險報告把 40 風險 triage 成 CH-1~6 + L4。CH-1~5 已 merged（收 27 風險）。L4 是 9 個「需業務/資料拍板」的 items。經 2026-06-02 brainstorming，使用者拍板把 L4 拆三類，先做 **第 1 類（可設定防禦）+ 第 2 類（repo 治理）** 共 6 項為本 change；第 3 類（#21 multi-instance、#33 537 .md）另議。

## 使用者拍板的決策

1. **推進方式**：第 1+2 類一起做成一個 change。
2. **設計 pattern**：第 1 類安全項複用 CH-2 的 `IFC_DOWNLOAD_STRICT` pattern——程式碼提供 enforcement 機制 + **預設 off（不破 demo）** + 部署設環境變數可開 + 文件說明。
3. **#6 unauth**：`/viewer-log` + `/structLog/health` **維持 unauth**（log ingest 不因 auth 丟失、health 給監控探活，是刻意設計），只加註解說明 + test 確認其他 internal 路徑有保護。**不**對這兩條加 token。
4. **#34 branch 清理**：**不納入**本 change（git 操作非 code change）；change merge 後另給「可安全刪 branch」清單供使用者確認。

## Scope（6 項）

### A. 可設定防禦（預設 off 不破 demo）

| # | 現況 | 做法 |
|---|---|---|
| #2 [High] | `conversion_authority.py:55 internal_conversion_token: str \| None = None`（host-native :49101 預設不驗證） | 加 token enforcement：設了 token（非 None）才驗證 internal request；預設 None demo 不破；部署設環境變數啟用。複用 CH-2 strict pattern。 |
| #6 [High] | `app.ts:764 STRUCT_LOG_UNAUTH_PATHS = {/viewer-log, /structLog/health}`（internal middleware 已存在，這兩條白名單 unauth） | 維持 unauth + 加註解說明刻意開放；加 test 驗其他 `/api/internal/*`（conversion-result、conversions/:id/ingest）有 token 保護、只有白名單兩條 unauth。 |
| #23 [M] | `.env.*.example` 可當 active env fallback，缺值仍跑起非預期拓樸 | env 載入偵測到用的是 `.env.*.example`（fallback）時發警告，提示不該當正式 env。 |
| #26 [M] | `kit-manager-api/app/main.py:20 allow_origins=["*"]` + state 純 in-memory | CORS 改可設定 allowlist（環境變數，預設 `*` dev 不破，部署可限）。state in-memory restart 即丟屬既有設計，本輪僅 CORS。 |

### B. repo 治理

| # | 現況 | 做法 |
|---|---|---|
| #29 [L] | 2 個 untracked evidence：`docs/evidence/streaming-server-ifcopenshell-semantic-sidecar-pass/l4-artifact-2026-05-28/` + `docs/verification/2026-05-14-stabilize-demo-runtime-readiness/dev-health-check-evidence.json` | 搬到各自對應的 archive sibling（`openspec/changes/archive/2026-05-28-streaming-server-ifcopenshell-semantic-sidecar-pass/evidence/` + `.../2026-05-14-stabilize-demo-runtime-readiness/evidence/`），符合 `documentation-source-of-truth` spec「archived change 的 evidence 放 archive sibling」。 |
| #36 [L] | 退役 collaboration event log 過濾（highlightRequest/selectionUpdate/annotationCreate 排除）未驗 | 加 test 驗這些退役 event 被過濾排除，固化既有過濾行為。 |

## 不納入

- **#34**（branch git 整理）：另做，change merge 後給可安全刪清單。
- **#21**（callback outbox multi-instance race）、**#33**（537 .md 哪些該 tracked）：第 3 類，需 multi-instance 部署決策 / .md 治理判斷，另議。
- 不改 production 既有行為的預設值（所有防禦預設 off / 寬鬆，部署可收緊）；不新增 production dependency。

## 驗證（baseline 對照）

- bim-streaming-server pytest（#2 token enforce + 預設 None 不破）。
- bim-review-coordinator `npm run verify`（#6 internal auth test + #36 event 過濾 test）。
- services/kit-manager-api（#26 CORS 可設定）。
- env guard（#23 example fallback 警告）。
- #29 evidence 搬移後 `git status` 該 2 個 untracked 消失、archive sibling 下 tracked。
- root pytest 回歸；`openspec validate --strict`。

## 執行

回 OpenSpec workflow：開 worktree → explore（按 6 項/4 sub-repo 分讀）→ apply（按 sub-repo 分 agent）→ 雙層 review（opus + 外部 CI）→ merge → archive → roadmap §1.6。本 design doc 在該 change archive 後標 superseded 指向 archive（依 #40 規範）。
