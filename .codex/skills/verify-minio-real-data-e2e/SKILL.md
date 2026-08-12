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
- 部署主機以 owner SSH config／owner inventory 解析（下文 `<canonical-host>`）；tracked 檔與報告不得印出 host/user 值。
- 真實 bucket 為 production 資料：唯讀操作（list／presigned GET）之外不得寫入、不得刪除。

## 1. Preflight（唯讀）

```bash
ssh -o BatchMode=yes <canonical-host> "curl -s -m 8 http://127.0.0.1:8004/api/external/minio-watch/status"
ssh -o BatchMode=yes <canonical-host> "curl -s -o /dev/null -w '%{http_code}\n' -m 6 http://192.168.20.234:9000/minio/health/live"
ssh -o BatchMode=yes <canonical-host> "curl -s -m 8 http://127.0.0.1:49101/health"
```

- status `enabled:true` 且 `last_error:null` → 憑證已就緒，跳到 §4。
- status note 含「credentials 未完整設定」→ 走 §2。
- MinIO health 非 200 → 網路層先解，不動 env。

## 2. 憑證診斷與 owner 供裝

欄位存在性與字元健康（**不輸出值**）：

```bash
ssh -o BatchMode=yes <canonical-host> "cd ~/AI-bim-geo && for k in MINIO_WATCH_ACCESS_KEY MINIO_WATCH_SECRET_KEY; do v=\$(grep \"^\$k=\" .env.web-plane.host-kit | head -1 | cut -d= -f2-); printf '%s len=%s' \"\$k\" \"\${#v}\"; case \"\$v\" in *\$'\r'*) printf ' has_CR=yes';; *) printf ' has_CR=no';; esac; if printf '%s' \"\$v\" | LC_ALL=C grep -q '[^ -~]'; then printf ' nonascii=yes'; else printf ' nonascii=no'; fi; echo; done"
```

判讀（2026-08-12 實測案例）：

| 症狀 | 意義 | 處置 |
|---|---|---|
| `len=0` | 未填 | 請 owner 以 nano 直接編輯兩行後存檔 |
| `len=4 nonascii=yes` | placeholder（如「你的AK」）被原樣貼入 | 請 owner 重填真值 |
| `has_CR=yes` | Windows 貼上夾帶 `\r` | `sed -i 's/\r$//'` 除 CR（機械修復，不觸值語意） |
| runtime `last_error: Invalid character in header content ["authorization"]` | 值含非 header 合法字元（上兩列的 runtime 症狀） | 同上 |

owner 填法（owner 親自在自己終端機執行；agent 只給指令不代跑）：`nano ~/AI-bim-geo/.env.web-plane.host-kit` → 填 `MINIO_WATCH_ACCESS_KEY=` 與 `MINIO_WATCH_SECRET_KEY=` 兩行。建議使用唯讀 service account 金鑰。

## 3. 生效（recreate，不是 restart）

容器 env 來自 compose `--env-file` 內插；**restart 不會重讀 env**，必須 up -d recreate：

```bash
ssh -o BatchMode=yes <canonical-host> "cd ~/AI-bim-geo && docker compose --env-file .env.web-plane.host-kit -f compose.runtime-manager.yml -f compose.host-kit.yml up -d coordinator"
```

後驗：status 轉 `enabled:true`、`last_error:null`。若 `last_error` 出現 authorization 字元錯誤 → 回 §2 表格。

## 4. 閉環驗收（全部唯讀）

watcher 首輪 tick 會對 bucket 內所有規約 key（`{專案}/root/{種類}/{UUID}/model.ifc`，含中文專案名）自動觸發 intake；之後每 60s 輪詢新物件。逐項驗：

1. **觸發**：status 的 `baseline_count`＝規約 IFC 總數、`triggered_total` 逐步到齊、`last_triggered[].error` 全 null、`skipped_malformed_total=0`。
2. **紀錄**：`GET :8004/api/conversion/records` — 每筆 `detected→queued→converting→ready`；`project_display_name` 保留中文原名、`project_id` 為 sanitize 碼、`category`＝key 倒數第二層。
3. **轉檔**：`GET :49101/api/conversions` — 對應 job `succeeded`；單筆 `GET :49101/api/conversions/{id}` 看 profile 與 artifact 路徑。
4. **產物真實性**（誠實鐵律，缺一不可）：artifact 目錄 `model.usdc` 位元組數合理（非 KB 級空殼）＋sidecar 族齊備；`element_mapping.json` 過 fake 四旗標隔離：`mock=false`、`allow_fake_mapping=false`、`summary.fake_mapping_count=0`、`mapping_provenance="converter_verified"`（`mapping_fidelity` 應為 `guid_exact`）。
5. **RVT 邊界（B 方案）**：`.rvt` 物件絕不出現在 ledger；RVT-only 版本資料夾（無 `model.ifc`）不得產生任何 record；有衍生 IFC 的 RVT 資料夾，其 IFC 轉檔即為 RVT 衍生鏈驗證點。
6. **冪等**：多輪 poll 後 `triggered_total` 不再增長、`seen_count` 穩定＝不重觸發不重建 job。
7. **（可選）live 觸發**：watch 運行中由 owner 上傳一個新規約 key 的 `model.ifc` → 60s 內 `triggered_total` +1。

## 5. Bucket 巡覽（供 census／找 RVT）

- **用資料夾視圖**：`GET :8004/api/minio/objects?delimiter=/&prefix=<urlencoded-prefix>`（單頁快回；CJK prefix 要 URL-encode）。
- **flat（無 delimiter）在真 bucket 上要幾十秒**（2026-08-12：1680 物件 26.4s；mass-intake 高峰期間更久）——curl timeout 至少給 120s，或乾脆別用。
- record／job 欄位名以 `conversionLedger.ts` 與 `/api/conversions` 實回為準（record 主鍵欄位是 `idempotency_key`＋`conversion_job_id`；mapping 陣列在 `items` 不是 `elements`）。

## 6. 報告與 evidence

- 報告四段式：Verified facts / Inferences / Unverified risks / Next actions；IFC 與 RVT 分開陳述，不得以 IFC 結果代替 RVT 宣稱。
- Evidence 落 `docs/evidence/minio-real-data-acceptance-<date>/`：runtime 快照 JSON＋mapping 抽樣（前 ~20 筆）＋報告。不 commit 大型 USDC/IFC；presigned URL 與憑證值不入檔。
- 已知誠實邊界：`coverage_ratio=1` 是自我參照指標（分子分母同源），不得當「IFC 全實體覆蓋率」宣稱。
