---
name: verify-minio-real-data-e2e
description: Run or re-run the real-MinIO IFC/RVT data acceptance loop against the canonical Linux test deployment - owner-supplied read-only credentials, MinIO watch enablement, auto-intake, IFC-to-USDC conversion, ledger idempotency, and the RVT boundary negative test. Use when the user asks to 驗收真 MinIO 資料, 跑 MinIO 閉環測試, verify minio watch end to end, or re-check the bim-control bucket pipeline. Not for local-windows stacks, fixture-only smoke tests, or Kit GPU visual E2E (separate surface).
---

# Verify MinIO Real-Data E2E（真 MinIO IFC/RVT 資料驗收）

對 canonical Linux 測試部署跑「真雲端資料 → watcher 自動 intake → IFC→USDC 轉檔 → ledger 閉環」的完整驗收。2026-08-12 首次實跑通過（0→12 自動觸發、12/12 succeeded、RVT 負向測試通過）；evidence 見 `docs/evidence/minio-real-data-acceptance-2026-08-12/`。

本 skill 是 data-plane 驗收：**不含** Kit GPU / WebRTC 視覺 E2E（另屬 `deploy-linux-test-environment` 之後的視覺驗收面），**不宣稱** RVT→IFC 轉換（B 方案：屬外部 IFC Worker）。

## 0. 邊界（先讀，違反即 HELD）

- **憑證值一律不經手**：`MINIO_WATCH_ACCESS_KEY` / `MINIO_WATCH_SECRET_KEY` 只能由 owner 親自填入部署機 runtime env。agent 只做「不看值」的欄位診斷（見 §2）。值不得進入對話、報告、commit、log。
- 只動部署機 runtime env（`.env.web-plane.host-kit`）；repo 內任何 `.env*` 不讀不改。
- 部署主機與 deploy root 以 owner SSH config／owner inventory 解析（下文 `<canonical-host>` 與 `<deploy-root>`；不得沿用本文件歷史範例路徑硬編碼——inventory 解析出不同 `deploy_root` 時，操作錯 checkout 會改壞無關部署）。tracked 檔與報告不得印出 host/user 值。
- **真實 bucket 為 production 資料：本 skill 全程唯讀（list／presigned GET）。任何對 bucket 的寫入（含 live 觸發補測的上傳）都超出本 skill 邊界——agent MUST NOT 代辦，只能由 owner 自行決定、自行執行，並明知這是對 production 儲存的變更。**

## 1. Preflight（唯讀）

先解析 deploy root（owner inventory／`Get-DeployTarget -Canonical`；或 owner 在本 session 明示），再全部經 `<canonical-host>` 探測：

```bash
ssh -o BatchMode=yes <canonical-host> "curl -s -m 8 http://127.0.0.1:8004/api/external/minio-watch/status"
# MinIO 可達性：endpoint 從部署機 env 檔 server-side 讀出（值不回傳），只回 http code
ssh -o BatchMode=yes <canonical-host> "cd <deploy-root> && ep=\$(grep '^MINIO_WATCH_ENDPOINT=' .env.web-plane.host-kit | cut -d= -f2-); curl -s -o /dev/null -w '%{http_code}\n' -m 6 \"\$ep/minio/health/live\""
ssh -o BatchMode=yes <canonical-host> "curl -s -m 8 http://127.0.0.1:49101/health"
```

- status `enabled:true` 且 `last_error:null` → 憑證已就緒，跳到 §4。
- status note 含「credentials 未完整設定」→ 走 §2。
- MinIO health 非 200 → 網路層先解，不動 env。同時記錄部署 revision（remote checkout 的 `git log -1` 或 deploy tag）供報告與 tip 版差裁決。
- **:49101 探測位址依 owner inventory**：conversion service 綁定 inventory 的 `host_native_bind_host`——非 loopback 綁定時 `127.0.0.1:49101` 會對健康服務誤報不可達。以 inventory 解析出的 bind host 探測，或直接用 deployment-profile 的 `verify-all.ps1 -Profile Deployment`（其本來就按 target 解析）。

## 2. 憑證診斷與 owner 供裝

欄位存在性與字元健康（**不輸出值**）：

```bash
ssh -o BatchMode=yes <canonical-host> "cd <deploy-root> && for k in MINIO_WATCH_ACCESS_KEY MINIO_WATCH_SECRET_KEY; do v=\$(grep \"^\$k=\" .env.web-plane.host-kit | head -1 | cut -d= -f2-); printf '%s len=%s' \"\$k\" \"\${#v}\"; case \"\$v\" in *\$'\r'*) printf ' has_CR=yes';; *) printf ' has_CR=no';; esac; if printf '%s' \"\$v\" | LC_ALL=C grep -q '[^ -~]'; then printf ' nonascii=yes'; else printf ' nonascii=no'; fi; echo; done"
```

判讀（2026-08-12 實測案例）：

| 症狀 | 意義 | 處置 |
|---|---|---|
| `len=0` | 未填 | 請 owner 以 nano 直接編輯兩行後存檔 |
| `len=4 nonascii=yes` | placeholder（如「你的AK」）被原樣貼入 | 請 owner 重填真值 |
| `has_CR=yes` | Windows 貼上夾帶 `\r` | `sed -i 's/\r$//'` 除 CR（機械修復，不觸值語意） |
| runtime `last_error: Invalid character in header content ["authorization"]` | 值含非 header 合法字元（上兩列的 runtime 症狀） | 同上 |

owner 填法（owner 親自在自己終端機執行；agent 只給指令不代跑）：`nano <deploy-root>/.env.web-plane.host-kit` → 填 `MINIO_WATCH_ACCESS_KEY=` 與 `MINIO_WATCH_SECRET_KEY=` 兩行。建議使用唯讀 service account 金鑰。

## 3. 生效（recreate，不是 restart）

容器 env 來自 compose `--env-file` 內插；**restart 不會重讀 env**，必須 up -d recreate：

**recreate 前先拍 ledger 快照**：部署未供給持久 `CONVERSION_LEDGER_STORE_PATH` 時（issue #531），recreate 會清掉容器內 ledger 水印——先 `GET :8004/api/conversion/records?limit=100` 存檔，供 recreate 後對帳（callback-outbox 不受影響：compose 已把它指向掛載的 `/workspace/storage/coordinator/`）。

```bash
ssh -o BatchMode=yes <canonical-host> "cd <deploy-root> && docker compose --env-file .env.web-plane.host-kit -f compose.runtime-manager.yml -f compose.host-kit.yml up -d coordinator"
```

後驗：status 轉 `enabled:true`、`last_error:null`。若 `last_error` 出現 authorization 字元錯誤 → 回 §2 表格。recreate 後的觸發計數判讀依 §4 的「重跑（recreate 後）」情境。

## 4. 閉環驗收（全部唯讀）

watcher 首輪 tick 會對 bucket 內所有規約 key（`{專案}/root/{種類}/{UUID}/model.ifc`，含中文專案名）觸發或跳過；之後每 60s 輪詢。**首跑與重跑的預期不同，先判斷你在哪種情境**：

- **首跑（該部署第一次啟用，records 為空）**：`triggered_total` 逐步到齊至 `baseline_count`、`last_triggered[].error` 全 null、`skipped_malformed_total=0`。
- **重跑（同一 watcher 行程持續運行）**：in-memory seen 快取生效——`poll_count` 遞增而 `triggered_total`／`seen_count` 持平＝正確的同行程冪等。
- **重跑（coordinator recreate／restart 後）**：去重有三層——watcher in-memory seen（行程級）→ coordinator ConversionLedger 水印（`skip_ledgered`）→ streaming request-fingerprint（最深層）。**注意（2026-08-13 實測）**：coordinator 的 **conversion-ledger** store 預設在容器內 `<cwd>/data/`，canonical 部署未以 env 覆寫該路徑時 **recreate 即蒸發**（issue #531；callback-outbox 不同——compose 已將其指向掛載的 `/workspace/storage/coordinator/`，可存活），此時會重觸發 intake（`triggered_total` 重新計到 N）但 streaming 冪等擋住重轉——判準改看 **streaming job 總數不變、record 綁回既有 `conversion_job_id`**。若部署已供給持久 store 路徑，則預期改為 `skip_ledgered`、`triggered_total=0`。兩種都算通過；重轉（job 數增加）才是失敗。

逐項驗：

1. **觸發**：依上表情境判讀 status 計數。
2. **紀錄**：`GET :8004/api/conversion/records` — 每筆 `detected→queued→converting→ready`；`project_display_name` 保留中文原名、`project_id` 為 sanitize 碼、`category`＝key 倒數第二層。
3. **轉檔**：`GET :49101/api/conversions` — 對應 job `succeeded`；單筆 `GET :49101/api/conversions/{id}` 看 profile 與 artifact 路徑。
4. **產物真實性**（誠實鐵律，缺一不可）：artifact 目錄 `model.usdc` 位元組數合理（非 KB 級空殼）＋sidecar 族齊備；`element_mapping.json` 過 fake 四旗標隔離：`mock=false`、`allow_fake_mapping=false`、`summary.fake_mapping_count=0`、`mapping_provenance="converter_verified"`（`mapping_fidelity` 應為 `guid_exact`）。
5. **RVT 邊界（B 方案）**：`.rvt` 物件絕不出現在 ledger；RVT-only 版本資料夾（無 `model.ifc`）不得產生任何 record。同資料夾 RVT＋IFC 共存**只能作為衍生鏈的推論**（derivation 權威在外部雲；無 worker handoff 紀錄不得寫成 verified fact）。
6. **冪等**：依上表三情境驗證；核心不變量＝**streaming 端不重轉、record 不重複建 job**。

## 5. Bucket 巡覽（供 census／找 RVT）

- **用資料夾視圖**：`GET :8004/api/minio/objects?delimiter=/&prefix=<urlencoded-prefix>`（單頁快回；CJK prefix 要 URL-encode）。
- **flat（無 delimiter）在真 bucket 上要幾十秒**（2026-08-12：1680 物件 26.4s；mass-intake 高峰期間更久）——curl timeout 至少給 120s，或乾脆別用。
- **list 端點有預設分頁，逐筆驗證不得依賴無參數呼叫**：`/api/conversion/records` 預設回 20 筆、`?limit=` 上限 100（`count` 欄位恆為全量總數，超過 100 筆時分不到的改用 count 對帳＋抽樣）；streaming `GET :49101/api/conversions` 預設 `limit=50`，支援 `model_version_id`／`status`／`ready` 篩選與 `GET /api/conversions/{id}` 逐筆讀取。
- record／job 欄位名以 `conversionLedger.ts` 與 `/api/conversions` 實回為準（record 主鍵欄位是 `idempotency_key`＋`conversion_job_id`；mapping 陣列在 `items` 不是 `elements`）。

## 6. 報告與 evidence

- 報告四段式：Verified facts / Inferences / Unverified risks / Next actions；IFC 與 RVT 分開陳述，不得以 IFC 結果代替 RVT 宣稱。
- **完成報告必附可再現 metadata**：changed files、逐條實跑的驗證指令與結果（exit／關鍵輸出）、未跑的 gate 及具體原因（缺工具／缺 fixture 不是 pass）、known risks、部署 revision 與 main tip 的版差裁決（file-level：驗收實際執行的模組是否在版差內）。
- Evidence 落 `docs/evidence/minio-real-data-acceptance-<date>/`：runtime 快照 JSON＋mapping 抽樣＋報告，並加註 document type（working note／歷史紀錄，非 runtime 權威）。**Redaction 義務**：不 commit 大型 USDC/IFC；presigned URL 與憑證值不入檔；canonical host 以 `<canonical-host>` 遮蔽；私有模型 metadata 最小化（UUID 截斷、mapping 原始列（完整 GUID＋構件名）撤下只留彙總與去識別樣本）；來源身分綁定用 `idempotency_key`（`(bucket,key,etag)` 指紋）。
- 已知誠實邊界：`coverage_ratio=1` 是自我參照指標（分子分母同源），不得當「IFC 全實體覆蓋率」宣稱。
