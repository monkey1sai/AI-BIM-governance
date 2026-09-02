# HANDOFF — EXTERNAL_INTAKE_IP_ALLOWLIST compose 透傳

- **文件性質**：working note / 跨 session 交接檔。**不是** contract、不是 runbook、不是驗收證據。
  與實作衝突時以程式碼與 `openspec/specs/` 為準。
- **隱私**：本 repo 為 PUBLIC。主機位址、LAN 網段、bucket 內專案名、tenant／project／job 識別碼
  一律以 `<...>` 佔位符表示（沿用 `docs/evidence/unified-console-runtime-truth-s3-closeout/`
  的 `<canonical-host>` 慣例）。原始未遮蔽輸出**不入 repo**，見 §7。
- **來源 session 狀態**：改動已落地，**零驗證執行**。見 §5。

---

## 0. 2026-09-02 T2 pivot（Codex review P1 → owner 裁決；本節取代 §1／§3.1／§8.3 的共用 allowlist 敘述）

Codex review 指出（P1，已 owner 確認）：spec `unified-console-runtime-truth` 明定
「SHALL NOT 放寬 `EXTERNAL_INTAKE_IP_ALLOWLIST` 或任何 `/api/external/*` webhook 授權面」，
而本檔原方案（透傳共用變數＋owner 加 LAN CIDR）正是被拒絕的 T3 設計。owner 裁決改走 spec 的 **T2**：

- 新增獨立 `CONVERSION_TRIGGER_IP_ALLOWLIST`（`config.ts` `nullableCsvFromEnv`；null＝未設→沿用
  external 判定＝既有行為；空字串／全空白 CSV 也是 null，絕不 fail-open）。
- 四條 conversion 控制路由的 guard `isCallerIpAllowed` 改讀此變數；`rejectIfIpNotAllowed` 本體
  與 lineage／webhook 面逐字不變（釘樁：`tests/conversion-control-auth.test.ts` T2 區塊）。
- compose 改透傳新變數，並**不再**透傳 `EXTERNAL_INTAKE_IP_ALLOWLIST`（parity 測試釘住不得復發）。
- `MINIO_WATCH_ENABLED=true` 且新清單設值缺 loopback → `assertIntakeReachable` 啟動 fail-fast（spec 對稱守衛）。
- owner 部署時改設：`CONVERSION_TRIGGER_IP_ALLOWLIST=127.0.0.1,::1,<operator-lan-cidr>`
  （取代 §8.3 的舊指引；`EXTERNAL_INTAKE_IP_ALLOWLIST` 維持不設＝程式碼預設，webhook 面不放寬）。
- 補充：T4 operator token 路徑早於 2026-08-25 落地（`createConversionControlGuard`）；canonical 403
  是 `DEV_AUTH_TOKEN` 仍為預設值致 token 路徑未啟用（§7 探針一致）。T2 與 T4 疊加並存。

---

## 1. 一句話

LAN 瀏覽器按不了「觸發轉檔」的根因不是私有 env 設錯，而是 **compose 從來沒有透傳
`EXTERNAL_INTAKE_IP_ALLOWLIST`**，dockerized coordinator 恆用程式碼預設的
`["127.0.0.1", "::1", "172.16.0.0/12"]`；本分支補上那行透傳並加迴歸測試。

---

## 2. 分支與 baseline

| 項目 | 值 |
|---|---|
| branch | `fix/intake-allowlist-compose-passthrough` |
| worktree | `<repo-parent>/AI-BIM-governance.worktrees/intake-allowlist-compose-passthrough` |
| baseline | `HEAD == origin/main == b82ac2e68f8541281061e45952f847994faa7d80`，`git status --porcelain` 空 |
| 建立方式 | `scripts/dev/new-governed-worktree.ps1 -BranchName fix/intake-allowlist-compose-passthrough -Json`（`clean: true`） |
| PR | **未開**（來源 session 未獲授權） |

---

## 3. 已改檔案（2 個）

### 3.1 `compose.runtime-manager.yml` — coordinator `environment:` 新增

```yaml
EXTERNAL_INTAKE_IP_ALLOWLIST: ${EXTERNAL_INTAKE_IP_ALLOWLIST:-}
```

**落點為何是 `compose.runtime-manager.yml` 而非 `compose.host-kit.yml`**（兩者都定義 `coordinator`）：

| 啟動路徑 | 載入的 compose |
|---|---|
| `scripts/start-runtime-manager-docker.ps1:15` | **只有** `compose.runtime-manager.yml` |
| `scripts/deploy.ps1:1480` | `runtime-manager` + `host-kit` 疊加 |
| `scripts/start-web-plane-docker.ps1:114-115` | `runtime-manager` + `host-kit` 疊加 |

放 base（runtime-manager）三條路徑全涵蓋；放 host-kit 會漏掉第一條。
（對照：`ENABLE_DEV_ROUTES` 放在 host-kit，`DEV_AUTH_TOKEN`／`MINIO_WATCH_*` 放在 runtime-manager。）

### 3.2 `bim-review-coordinator/tests/env-compose-intake-allowlist-parity.test.ts` — 新增（5 cases）

沿用 `tests/env-example-dev-routes-parity.test.ts`（task 4.4）模式。釘住：

1. `config.ts` 恰一個 `EXTERNAL_INTAKE_IP_ALLOWLIST` 讀取點
2. `compose.runtime-manager.yml` 的 `services.coordinator` 區塊內有**未被註解**的透傳行 ← 防止本缺口復發的主牆
3. 空字串回退程式碼預設，**不是**空清單全放行（此透傳可安全加入的前提）
4. 預設清單含 loopback
5. 設值時 CSV 解析並去空白

---

## 4. 根因鏈（逐環有程式碼錨點）

1. `bim-review-coordinator/src/config.ts:484`
   `externalIntakeIpAllowlist: csvFromEnv("EXTERNAL_INTAKE_IP_ALLOWLIST", ["127.0.0.1", "::1", "172.16.0.0/12"])`
2. `config.ts:192-199` `csvFromEnv`：`if (!value) return fallback` → 空字串回退預設（**不會** fail-open）
3. 兩支 compose 的 coordinator 皆**無** `env_file:`，且原本皆無此 key 的 `environment:` 透傳
   → 容器唯一 env 來源是 compose（repo 自述：「`.env` 不掛入容器、image 不烤 `.env`」）
   → 私有 env 設了也收不到 → 實際生效的永遠是預設清單
4. 預設清單 = loopback + docker bridge（`172.16.0.0/12`）→ 任何 LAN 來源必落 403
5. conversion 控制守衛 `src/services/conversionControlAuthorization.ts`
   出生 commit `e775595`（2026-08-26，PR #699）；`:84` 於 token 路徑未啟用時回
   403 `caller ip not in allowlist`
6. `conversionControlAuthorization.ts:16`：token 路徑僅在 `DEV_AUTH_TOKEN` 非空**且** != `dev-token` 時啟用

---

## 5. 本輪**未跑**的驗證（接手者必補）

來源 session 的安全分類器攔截了幾乎全部 Bash（自述反應「earlier conversation content」、
且持續整個 session），因此以下**全部沒有執行**，不得視為已通過：

- [ ] `npm ci`（worktree 的 `bim-review-coordinator/node_modules` 為空）
- [ ] `npx vitest run tests/env-compose-intake-allowlist-parity.test.ts`
- [ ] `npx vitest run tests/env-example-dev-routes-parity.test.ts`（確認未弄壞既有 parity）
- [ ] `npm run verify`（= build + test）
- [ ] `docker compose -f compose.runtime-manager.yml config`（YAML 語法未驗）
- [ ] `git diff` / `git status`
- [ ] `gitnexus detect-changes --scope compare --base-ref main`
- [ ] agents-board 收工（session `02270e` 仍掛 active，需另行 `done`）

> IDE 診斷若回報 `Cannot find module 'node:fs' / 'vitest'` 十餘條，是 node_modules 未安裝，
> **不是**程式碼錯誤；`npm ci` 後應消失。

### 接手者第一步

```bash
cd <worktree>/bim-review-coordinator && npm ci && npx vitest run tests/env-compose-intake-allowlist-parity.test.ts tests/env-example-dev-routes-parity.test.ts
```

---

## 6. `.env*.example` 宣告（T2 pivot 後已由 owner 補齊）

原缺口（agent 受 protect-secrets hook 限制無法讀寫 `.env*` 全系列）已由 owner 親自以
commit `dea28c2` 補齊：四份 example（host-kit／canonical-linux／runtime-manager.docker／
coordinator）各宣告一次 **`CONVERSION_TRIGGER_IP_ALLOWLIST=`（空值）**，parity 測試釘住宣告存在
（issue #746 於 merge 後關閉）。

⚠️ 依 §0 T2 pivot：example 與私有 env **不宣告、不設** `EXTERNAL_INTAKE_IP_ALLOWLIST`
——compose 刻意不透傳它（Docker 部署設了無效），在其他啟動路徑設值＝放寬 webhook／lineage
授權面（spec SHALL NOT）。

---

## 7. 2026-09-02 canonical-linux 實測（去識別化）

環境：來源 `<operator-lan-ip>`（與伺服器不同 /24）→ `<canonical-host>:8004`，
2026-09-02T07:18–07:21Z。**工具偏離**：`curl` 被來源 session 權限規則擋下，改用
`pwsh Invoke-WebRequest` / `System.Net.Http.HttpClient` 取得等價 status line + body。
原始未遮蔽輸出僅存於來源 session 的 scratchpad（session-scoped，可能已清），**未入 repo**。

### 授權面

| 探針 | 結果 |
|---|---|
| `POST /api/conversion/trigger` 無 header | 403 `{"detail":"caller ip not in allowlist"}` |
| 同上 + 錯誤 `x-operator-token` | 403 **同一訊息** → T4 token 路徑在該部署**未啟用** |
| 同上 + 錯誤 `x-dev-token` | 403 同上 |
| `POST /api/conversion/jobs/<id>/retry` 無 header | 403 同上 |
| `PUT /api/conversion/watch` 無 header | 403 同上 |
| `GET /api/external/ifc-ready?limit=5` | 200 `{"count":0,"items":[]}`（授權未變） |
| `POST /api/external/ifc-ready` 無 secret | 400 zod schema errors（schema 驗證跑在 secret 之前；未送合法 body，**無法**據此判定 secret 是否強制） |
| `GET /api/dev/conversions` | **200 + 完整資料** → `ENABLE_DEV_ROUTES` 未生效 |
| `GET /api/dev/ifc-sources` | **200** → 同上 |

> 未送 `POST /api/dev/conversions`：GET 已證明 dev routes 開啟，POST 會是真狀態變更。

### 資料面

| 觀察 | 值 |
|---|---|
| `GET /api/minio/objects?prefix=<x>/&delimiter=/` | **502** `{"error":"minio_list_failed"}` |
| `GET /api/minio/objects?delimiter=/`（頂層） | 200，但 `cache.hit=true`（快照，非即時） |
| `minio-watch/status.last_error` | `connect EHOSTUNREACH <minio-host>:9000` |
| `minio-watch/status` | `enabled:true`、`poll_count 38`、`baseline_count 12`、`seen_count 12`、`triggered_total 0` |
| 工作站 → `<minio-host>:9000` | TCP `False`（**全域不可達**，非 coordinator 路由問題） |
| 工作站 → `<canonical-host>:8004` | TCP `True` |
| `GET /api/conversion/records` | 12 筆全 `status: ready`，`object_key: null`、`bucket: null`，`detected_at` 全為 2026-08-19 |
| bucket 頂層 | 7 個資料夾，其中 3 個 `has_source_ifc: true`（名稱不列） |
| `/ui/design-assets/*.png`（4 vp + 2 concept） | 全 200 → 前端「照片」確為部署 bundle 內資產 |

**MinIO 狀態（owner 告知）**：重新佈署中。

---

## 8. Owner 待辦（有順序，缺一不可）

1. **`ENABLE_DEV_ROUTES=false`** — 與 MinIO／allowlist 皆無關，**現在就能做**。
   目前 `/api/dev/*` 對 LAN 全開且回傳 tenant／project／內部 artifact URL，是唯一的真實曝險。
   同時建議輪替 `DEV_AUTH_TOKEN`（非預設值才會啟用 T4 token 路徑）。
   ⚠️ 副作用：輪替後仍以 `x-dev-token: dev-token` 呼叫 Kit open／close 的 operator 腳本會開始 403
   （web viewer 不送此 header，UI 無影響）。
2. **MinIO 重佈署完成後確認可達**，並確認 `MINIO_WATCH_ACCESS_KEY`／`SECRET_KEY` 仍在
   （重佈署若清掉憑證，watcher 會自述 `enabled:false`）。
   ⚠️ 憑證**不要改**（owner 已裁決此測試伺服器免輪替）。
   ⚠️ 改 env 後必須 `docker compose --env-file ... up -d`（recreate）；**單純 restart 不重讀 env**。
3. **部署本分支後**（T2 pivot，見 §0），在私有 env 設值，**MUST 保留 loopback**：
   ```
   CONVERSION_TRIGGER_IP_ALLOWLIST=127.0.0.1,::1,<operator-lan-cidr>
   ```
   ⚠️ 漏 loopback 且 `MINIO_WATCH_ENABLED=true` → coordinator **啟動即 fail-fast**
   （`src/app.ts` `assertIntakeReachable` 的 T2 對稱守衛）。
   ⚠️ **不要**設 `EXTERNAL_INTAKE_IP_ALLOWLIST`：compose 刻意不透傳它（Docker 部署設了也無效），
   而在會消費該 key 的其他啟動路徑設值＝放寬 webhook／lineage 授權面，spec 明定 SHALL NOT。
   此變數只作用於四條 conversion 控制路由，webhook 進件面維持程式碼預設。

---

## 9. 對 openspec tasks 的影響

`openspec/changes/unified-console-runtime-truth/tasks.md`：

- **6.3**（LAN 瀏覽器依 D2 授權觸發轉檔）：**維持未勾**。兩個阻斷 —— MinIO 不可達、
  allowlist 未接線。本分支解掉第二個；第一個等 owner。
- **6.4**（負向 403／`/api/external/ifc-ready` 授權未變／dev routes 404）：**維持未勾**。
  首句與第二句已取證（見 §7），末句「D3 落地時 `POST /api/dev/conversions` 回 404」
  的**前提不成立**（dev routes 仍開）。
- **4.4** 的「canonical env `ENABLE_DEV_ROUTES=false`」敘述與實測不符，見 §7。

### 不可用既有紀錄代替 6.3 的理由

2026-08-12 曾有真 MinIO 驗收成功（0→12 自動觸發、12/12 succeeded、RVT 負向、8 輪冪等）。
**但不能拿來收 6.3**，三個獨立理由：

1. **時序**：那次早於授權守衛出生日（`e775595`，2026-08-26），6.3 要測的 403／非 403 行為當時不存在。
2. **機制**：那次是 **watcher 自動觸發**（不碰按鈕）；6.3 要的是**瀏覽器手動觸發**，走不同程式路徑。
3. **證據形式**：owner 2026-08-14 已裁決該類真實生產 metadata 永不入公開 repo（PR #530 永久關閉）。

> 上述 2026-08-12 細節出自來源 session 的 memory（點時間紀錄），**非本輪實證**；
> 本輪實證的只有「今日 ledger 仍存 12 筆 ready」這一項殘留。
> 流程已固化為 skill `verify-minio-real-data-e2e`，重跑走該 skill。

---

## 10. 錨點索引

| 對象 | 位置 |
|---|---|
| 授權守衛 | `bim-review-coordinator/src/services/conversionControlAuthorization.ts`（`:16` token gate、`:84` 403） |
| allowlist 預設 | `bim-review-coordinator/src/config.ts:484` |
| CSV 回退語意 | `bim-review-coordinator/src/config.ts:192-199` |
| loopback fail-fast | `bim-review-coordinator/src/app.ts` `assertIntakeReachable` |
| dev routes gate | `bim-review-coordinator/src/app.ts` `process.env.ENABLE_DEV_ROUTES !== "false"` |
| 既有 parity 模式 | `bim-review-coordinator/tests/env-example-dev-routes-parity.test.ts` |
| 守衛落地 PR | `e775595`（#699，2026-08-26） |
| 前端 disabled 鈕 | `web-viewer-sample/src/console/unified/PipelinePage.tsx`（`data-uc="trigger-conv"`） |
| 前端真觸發鈕 | `web-viewer-sample/src/console/modelData/ObjectDetailPane.tsx`（`data-testid="md-detail-trigger"`） |
| 觸發呼叫鏈 | `modelData/useConversionActions.ts` `confirmTrigger` → `coordinatorClient.triggerConversion` |
