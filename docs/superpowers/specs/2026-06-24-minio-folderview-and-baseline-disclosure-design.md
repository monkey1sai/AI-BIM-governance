# MinIO `#minio` 真資料夾瀏覽 ＋ `#conv` baseline 揭露 — Issue Spec

> **狀態：** Issue spec（design）。經兩輪 ultracode 研究 ＋ 一輪 **交叉對抗分析（10 agents，prototype × spec × live × 使用者決定 四方對撞）** 後，**OQ1 / OQ2 / OQ3 / OQ5 ＋ 狀態 chip 已由使用者拍板**；剩 **OQ4（規約 archive gate，維護者動作）＋ 一個 watcher auto-enroll 細節** 待確認（§7）。決策拍板後用 `superpowers:writing-plans` 產 `docs/superpowers/plans/` 實作 plan。
>
> **使用者拍板（2026-06-24 第二輪）：** ① `#minio` 走 raw-folder 逐層導覽（D1）；② `geometries_chunks` 摺成末層目錄（D2）；③ **轉檔狀態以 ledger 為真相來源**，`#minio` `.ifc` 旁顯示**狀態 chip**，並**新增「一鍵觸發轉檔」按鈕**（走既有手動 intake 路徑；watcher 自動語意改動見下方 §7-B'）。
>
> **5-Sonnet 交叉對抗驗證後修訂（2026-06-24）：** 引用真偽關 **PASS**（所有 `file:line` 引用屬實）。修掉 **2 blocker**（`listMinioFolder` 分頁未定義 / `POST /api/conversion/trigger` auth 模型未定義）＋ **9 major**（NOT BUILT 殘留、AC6 拆分、`triggerIntake` 私有不可 import、chip↔ledger 對應採路徑 A、§8.4 整段重寫、empty 態文案、chip 刷新時序、trigger 失敗回饋、中文排序）。
>
> **§7-B' 拍板：全自動 auto-enroll（2026-06-24）：** 使用者選「全自動」。設計＝把 watcher tick 的 dedup 從 in-memory baseline 改為**持久 ledger 去重水印**（`mw_<hash16>=idempotencyKeyFor(bucket,key,etag)`，`minioWatcher.ts:29` 已驗證為確定性、且即 ledger 主鍵；ledger 持久於 `data/conversion-ledger.json`，`app.ts:486`/`config.ts:393`）：既有無紀錄的 `model.ifc` 下一輪自動觸發、重啟因 ledger 持久不重觸發。**AC7 由「零變更」改為「刻意的安全變更」**（動到 watcher tick 核心、非零 blast radius）。詳見 §3.4。
>
> **證據鏈：** 所有 spec/程式碼引述附 `file:line`（§9）；live 由 coordinator `:8004` 實測；prototype 設計來源 `docs/plans/ai-bim-governance-prototype.html`。

**一句話：** `#minio` 拍板做「**真 MinIO 唯讀資料夾導覽**」＝ S3 `Delimiter='/'` raw-folder 逐層 lazy（**像 MinIO 網頁一樣聰明**，使用者 D1）＋ `geometries_chunks` 等末層**摺成單一資料夾節點不攤開**（使用者 D2）；三層「專案/種類/版本」語意從「樹骨架」**降為導到 `model.ifc` 葉層才掛的語意 badge**（`deriveIntakeFromKey` **不改**）。Q2 另含 §7-B' 全自動 auto-enroll：watcher tick dedup 由 baseline **刻意改為持久 ledger 去重**（非零 blast radius，見 §3.4/AC7）。此案正式把 prototype「真 S3/MinIO 三層待接 NOT BUILT」**升為已建**，須同步移除浮水印並改寫三方文件（§8）。

---

## 1. 背景與兩個觀察

使用者在部署中 console 看到兩個與直覺不符的現象，已用 live coordinator（`:8004`）實測釐清：

- **觀察 A（`#minio` 與真實 MinIO 不符）：** 頁面把真實 `bim-control` bucket 的 **527 個物件遞迴攤平**回傳、只認 `model.ifc` 規約，導致 **524 個幾何 `.json` 全落「(未知專案)」桶**、**6 個沒有 `model.ifc` 的專案在樹上連專案節點都不出現**。對照真實 MinIO 瀏覽器（`192.168.20.234:9001/browser/bim-control`）的乾淨 **7 個專案資料夾**，兩者長相完全不同。
- **觀察 B（`#conv` 看不出有沒有轉檔）：** bucket 內既有 **3 個 `model.ifc` 從未被轉檔**（`baseline_count=3 / seen_count=3 / triggered_total=0`），ledger 與 ifc-ready 皆 0，使用者無法判斷是「畫面壞掉」還是「真的沒轉」。

### 1.1 Live 實測證據（coordinator `:8004`，2026-06-24）

| 端點 | 回傳 | 解讀 |
|---|---|---|
| `GET /api/minio/objects` | `count=527`、`bucket=bim-control`；role = **3 `source_ifc` ＋ 524 `other` ＋ 0 `parsed_usdc`** | 3 個可解析 `model.ifc` 全屬「東勢區許良宇紀念圖書館」 |
| `GET /api/external/minio-watch/status` | `enabled=true`、`baseline_count=3`、`seen_count=3`、`triggered_total=0`、`poll_count=23`、`last_error=null` | watcher loop 健康，無「新增」事件可觸發 |
| `GET /api/conversion/records`（ledger） | `count=0` | 從未 `triggerIntake` → 自然無紀錄 |
| `GET /api/external/ifc-ready` | `count=0` | 無任何轉檔 job |

真實 MinIO 頂層 7 個資料夾（依物件數）：`洲際好宅`(316)、`測試建案0329`(57)、`東勢區許良宇紀念圖書館`(46)、`IOTTEST`(44)、`Demo展示社區-1`(36)、`測試建案0321`(26)、`annotations`(2)。**只有「東勢區許良宇紀念圖書館」底下有 `model.ifc`**（3 個）；`洲際好宅` 316 個多為 `geometries_chunks/chunk_*.json`。

### 1.2 三方矛盾（交叉對抗揭露的核心）

| 來源 | 對 `#minio` 的主張 |
|---|---|
| **Prototype HTML**（設計權威，`1107-1165`） | `#minio` = `local_fs` 兩層樹（`/api/files/tree`）；真 MinIO 三層瀏覽**標 NOT BUILT / 待接**（浮水印）；「watcher 與此頁是兩條獨立資料路徑」 |
| **閉環 observability spec**（`84-88`） | 期望 `#minio` 呈現「真實 bucket 三層 ＋ 每物件 role」（display_model=3-level-semantic） |
| **Live #254** | 已把 `#minio` 偷接到真 bucket raw list（`/api/minio/objects`，527）——但接成「攤平＋只認 model.ifc 分組」的**壞掉版** |
| **使用者決定** | 要「像 MinIO 網頁一樣聰明」（raw-folder 逐層）＋ `geometries_chunks` 當末層目錄 |

> **本案的定位：** 不是「新造成 local_fs 退場」，而是**把 #254 的偏離修正成正確的真 MinIO raw-folder 瀏覽**，並把 prototype 標為待接的「真 MinIO 瀏覽」正式做出來。

---

## 2. Q1（已拍板）— `#minio` 做成真 MinIO 資料夾導覽

### 2.1 OQ1 拍板：S3 `Delimiter='/'` 逐層 lazy raw-folder（採 D1，不採全抓自切）

**做法：** 「點一層、問一層」。後端 **additive**：`minioClient.ts` 新增 `listMinioFolder(client, bucket, prefix, delimiter='/')`，回 `{ bucket, prefix, folders: resp.CommonPrefixes.map(c => c.Prefix), objects: 當層直屬檔, count }`；**保留現有 `listMinioObjects` 簽名與 `/api/minio/objects` 既有回應欄位完全不動** → 既有後端路由測試零改。`app.ts:1206` route 已讀 `request.query.prefix` 並透傳，僅 additive 加讀 `request.query.delimiter`、回應多一個 `folders[]`。`@aws-sdk/client-s3` **原生支援 `Delimiter`→`CommonPrefixes`**（型別實證 `models_0.d.ts`），既有 import 即可用、**免新依賴**。中文 prefix 已 `encodeURIComponent`（`coordinatorClient.ts:301`）、既有中文 key 解析在跑，非新風險。

**分頁（blocker 修正）：** `CommonPrefixes` / 當層 `objects` 同受 `MaxKeys`（預設 1000）上限——`listMinioFolder` 對**單層** list 仍須處理 `IsTruncated`：**設計決定＝while-loop 全拉該層**（沿用現有 `listMinioObjects:36-63` 的 `while(token)`），確保超 1000 子前綴/物件的層不截斷。釐清語意：「lazy」指**每層由使用者手動展開**（換 prefix 才打下一次 list），**非**「每層只發一次不分頁的 list call」。

**中文排序（major 修正）：** S3 回 `CommonPrefixes` 依 UTF-8 byte order（非中文 collation）。設計決定＝**前端對資料夾節點以 `localeCompare('zh-TW')` 重排**（對中文使用者直覺），AC1 補排序斷言。

### 2.2 raw-folder 與「三層語意」如何調和（最核心對抗點）

**三層「專案/種類/版本」語意降為葉層 badge、不當樹骨架：**

- **主樹骨架 = raw-folder 逐層**，忠實鏡射 bucket 巢狀結構（`洲際好宅/` → `root/` → `main/` → `<UUID>/` → 檔案）。頂層 **7 個專案資料夾全部出現**，修掉現況 6/7 消失的壞掉版。
- 逐層導到含 `model.ifc` 的版本層時，對該 `model.ifc` 呼 `deriveIntakeFromKey`（`minioWatcher.ts:71-113`，**不改**），把 `project_display_name`（中文原名）/ `category`（倒二）/ `version`（末）當「點到 model.ifc 才附帶的語意 badge」顯示在物件旁。**≥3 段才掛 badge**，否則不掛——malformed 只影響 badge，**不影響資料夾是否顯示**（malformed 是 watcher「要不要觸發轉檔」的判定，非「資料夾要不要顯示」的判定）。
- 此設計**同時滿足** spec R4「完整原始 key 所有層 ＋ 中文可見」（raw 樹本身逐層顯示中文）與三層語意保留（badge）。
- **權威界線（誠實）：** key-structure spec 對 `#minio` 的 display_model **未選邊**（其 UI 落點是 `#/conv` watcher status，全文未規範 `#minio` 頁），故 D1 是「**超出但不違反** spec 的加值」，**不可宣稱「spec 要求逐層導覽」**。

### 2.3 OQ2 拍板：`geometries_chunks` 等末層摺成單一資料夾（採 D2）

- **Delimiter 天然達成、零摺疊邏輯：** 帶 `Delimiter='/'` + `Prefix='洲際好宅/.../'` 時，`geometries_chunks/` 之下所有 key 被 roll-up 成單一 `CommonPrefix.Prefix`，官方語意明載「rolled-up keys are **NOT returned elsewhere**」——幾百個 `chunk_*.json` **完全不入回應、不被展開**。UI 以**資料夾 icon + 名稱**呈現（明示可點擊、非空、非末端檔），點擊以該 prefix 重打 list。
- **誠實標註（不捏造、不誤導）：** **不在資料夾節點旁硬寫死物件數**——CommonPrefix 只回 prefix 字串、不含其下物件數；要顯示「·316 objects」必須對該 prefix 再各發一次 list（與 lazy 模型互斥），硬寫未實查的數字會踩 `minio-fileserver-source/spec.md:56`「SHALL NOT 以寫死示意樹偽裝真資料」。**真實物件數在使用者點入該 prefix 時由下一次 list 自然顯示**。

### 2.4 效能誠實量化（不誇大）

- 現況 flat-list 對 527 物件是 **1 次 round-trip**回 527 筆（S3 一頁上限 1000 > 527）。
- Delimiter lazy 是**每層 1 次 round-trip**回少量 `CommonPrefixes`（頂層僅 7 個 prefix 字串）。
- 對「一次看全 bucket」需求，lazy 反而 round-trip 變多——**不可宣稱「全面效能更優」**。真正好處 = **資料夾語意鏡射**（D1 本質）＋ **對洲際好宅 316 chunk 海量子樹防爆**（D2）。採 D1 的理由是「修正現況壞掉版的正確性」，效能只是 D2 子樹的附帶好處。

### 2.5 `#minio` 最終設計（行為層，逐點）

1. **主樹 = raw-folder 逐層**（§2.1）：`/api/minio/objects?prefix=<層>&delimiter=/` → `{ folders[], objects(當層直屬), prefix, count }`；前端 `MinioDataPage` 用 `useState(currentPrefix)` 點資料夾換 prefix 重打，`buildMinioTree`（`pages.tsx:1157-1171`）**退役**。
2. **資料夾摺疊**（§2.3）：`geometries_chunks/` 等單一 CommonPrefix 可點擊資料夾，chunk 不入回應；不寫死物件數。
3. **三層語意 = 葉層 badge**（§2.2）：導到 `model.ifc` 才掛「專案(中文)/種類/版本」badge（`deriveIntakeFromKey`，≥3 段，不改）。
4. **role 與 pending 誠實**：葉物件 role 由副檔名決定（`.ifc→source_ifc / .usdc→parsed_usdc / else other`，`minioClient.ts:43-47` 不動、與 intake 三段脫鉤）；「有 `.ifc` 無 `.usdc`→pending·待產生 prov=p1」**只掛在同層可見 `.ifc` 且無 `.usdc` 的版本層**，看不到 `.usdc` 不臆測。
5. **「含 source IFC」資料夾 badge**：資料夾（遞迴）直屬有 `.ifc` 葉物件 → 標一枚輕量 badge『含 source IFC』；**不在資料夾層宣稱「已轉/可轉」**（避免逐層下 `.usdc` 不同層看不到時誤標）。
6. **轉檔狀態 chip（使用者拍板：做）**：`.ifc` 葉物件旁顯示狀態 chip，顯示 `detected/queued/converting/ready/failed` 或『未轉(baseline 既有檔)』；查不到誠實標『未進偵測佇列』。`#minio` 因此新增對 ledger `/api/conversion/records` 的**唯讀**依賴（`MinioDataPage.test.tsx` 原斷言「不呼叫 `getConversionRecords`」須改）。
   - **對應機制（blocker/major 修正，採路徑 A）：** Phase 1 `ledger.object_key` 恆 `null`（`conversionLedger.ts:21`）、前端不能算 Node `crypto` sha256，故**不**靠前端比對。改由**後端在 `listMinioFolder`/`listMinioObjects` 回應對每個 `.ifc` 物件附帶預計算的 `idempotency_key`**（後端呼 `idempotencyKeyFor(bucket,key,etag)`，`minioWatcher.ts:29` exported），前端 chip 以該 `idempotency_key` 對 records map lookup。需同步加欄位：`MinioObjectView`（`minioClient.ts`）/ `MinioObject`（`coordinatorClient.ts`）/ `ConversionRecord`。詳見 §3.3。
7. **守門全保留**：(a) list 回應**永不夾帶 presigned URL**（已驗證 route 內 0 個 `getSignedUrl`、`MinioObjectView` 無 url 欄；要下載才另引 presign，沿用 watcher 不入 log 規約）；(b) 把 CommonPrefix 當 id/path 前沿用 `deriveIntakeFromKey` 拒空段/`.`/`..` 防穿越；(c) 頁首『唯讀 intake 來源視圖，非 metadata 權威…權威在 `bim-control·MySQL`』保留（`pages.tsx:1214-1215`）；(d) `prov=demo` bucket-layout 規約面板留作純語意參照，不與真實逐層結果混淆。
8. **誠實升級宣告**：本案把 prototype『真 S3/MinIO 三層待接 NOT BUILT』升為已建，**必須同步移除浮水印與「待接」字樣**（§8）——把已建功能還掛 NOT BUILT 才是說謊，移除是誠實鐵律的**要求**。`#minio` Q1（資料夾導覽）本身 `deriveIntakeFromKey` 不動；watcher tick dedup 的改動屬 Q2 §3.4（§7-B' 全自動），非零 blast radius、見 AC7。

---

## 3. Q2（已拍板）— `#conv` baseline 揭露 ＋ ledger 真相 ＋ 一鍵觸發

### 3.1 為什麼沒轉檔（by-design，不是 bug）

watcher「**首輪 SHALL 只登記 baseline 不觸發；之後才出現的新 key 或新 etag 才觸發**」（`openspec/specs/minio-watch-auto-intake/spec.md:8, 18-22`），刻意防止對既有大 bucket 爆量誤觸發（`2026-06-12-…-design.md:28, 53-54`）。3 個既有 `model.ifc` 在首輪被當 baseline 吸收（`minioWatcher.ts:384-387`），etag 沒變 → 每輪 `prev===etag` continue（`:388-398`）→ `triggered_total` 恆 0。`poll_count=23` 證明 loop 健康、只是無新事件。

### 3.2 `#conv` 揭露設計（逐點）

1. 把現況擠在單一 Field（`pages.tsx:866`）的 baseline/seen/triggered/skipped **拆成獨立 Field + 解釋文案**：`baseline_count`＝「既有 `model.ifc` 在首輪被當基準吸收、**by-design 刻意不自動轉檔**」；`triggered_total`＝「自 baseline 後真正新觸發的上傳數」。避免把 `triggered_total=0` 誤讀成故障。
2. 對 baseline 既有 `model.ifc` 標註原因（首輪被當基準吸收）。
3. 列 spec 認可的兩條補救：(i) **重新上傳改 etag** → watcher 下一輪自動觸發；(ii) **手動 webhook intake** 直打 `POST /api/external/ifc-ready`（帶 webhook secret + presigned GET URL）。
4. 誠實註記（**已被本案 §3.3/§3.4 取代，`#conv` 文案不再標 NOT BUILT**）：原現狀為「repo 內無一鍵觸發 UI」，本案 §3.3 新增一鍵觸發鈕、§3.4 改 watcher 為 ledger 去重自動補轉，故 UI **不**保留「NOT BUILT」字樣。**⚠ spec 矛盾修正（P1 plan reviewer 抓到）：原「重啟也救不了既存自動轉檔」警語在 §3.4 全自動 auto-enroll 下已 FALSE**（watcher 改查持久 ledger、既有未轉檔下一輪自動補轉、重啟命中 ledger 不重觸發），故 `#conv` UI **不得**保留該過時警語——保留＝與 §3.4 自相矛盾的誠實違規。
5. **三視圖一致性基準明示**（避免違反閉環 spec `:95-97`）：`baseline_count=3` **只算 `*/model.ifc` 規約檔、非 bucket 全量 527**；「`#minio` 527 物件 vs watcher 只認 3 個 vs ledger=0」的一致性基準 = **「可解析 IFC 數」非「物件總數」**，文案須講清楚，否則使用者誤以為 watcher 漏看 524 物件。
6. 與 Q1 零交集：Q1 只動 `listMinioObjects`/`buildMinioTree`/`#minio`，與 watcher 觸發語意零交集（AC7）。

### 3.3 轉檔狀態以 ledger 為真相 ＋ 一鍵觸發（使用者拍板新增）

**設計原則（使用者觀點）：** 「是否要轉檔」不只看 watcher 的 in-memory baseline/etag，要看**持久的轉檔紀錄（ledger）**——bucket 內的 `model.ifc` 若 ledger 無成功(`ready`)紀錄，就視為「未轉、可觸發」。

1. **ledger = 轉檔狀態真相來源**：交叉比對「bucket 內 `*/model.ifc`（來自 `#minio` list）」與「ledger 紀錄（`/api/conversion/records`，鍵 `mw_<hash16>`）」。狀態分類：`ready`（已轉）／`detected/queued/converting`（進行中）／`failed`（失敗可重試）／**無紀錄 =「未轉（含 baseline 既有檔）」**。

2. **一鍵觸發轉檔按鈕（in-scope，intent→confirm→audited）**：對「未轉/failed」的 `model.ifc`，於 `#minio` 該物件旁（與/或 `#conv` 列）提供「觸發轉檔」鈕。
   - **機制：** 新增 additive coordinator endpoint `POST /api/conversion/trigger {key}`：(a) 驗 key 為 bucket 下 `*/model.ifc`、過 `deriveIntakeFromKey`（≥3 段、拒空段/`.`/`..` 防穿越）；(b) coordinator **server-side 生 presigned GET URL**（瀏覽器不碰 webhook secret／MinIO 憑證）；(c) **新增獨立函式 `triggerManualIntake(key, bucket, config)`** 寫 ledger——**注意 `triggerIntake` 是 `startMinioWatcher` 內私有 closure、不可 import**（`minioWatcher.ts:290`），故為**獨立實作但重用既有 exported 零件**：`deriveIntakeFromKey`/`idempotencyKeyFor`（`minioWatcher.ts:71,29`）、`createMinioS3Client`（`minioClient.ts:7`）、`getSignedUrl`（`@aws-sdk/s3-request-presigner` 已裝）、loopback `POST /api/external/ifc-ready` 或直呼 `conversionLedger.upsert`（約 50 行，**非 import 重用**）。
   - **auth 模型（blocker 修正）：** 此為**寫入**動作，**不可**用 `/api/external/ifc-ready` 的 IP allowlist（瀏覽器 IP 不在 loopback→403），**亦不可**無 auth（任意訪客可亂觸發）。設計決定＝**沿用 console mutation 既有 `x-dev-token`（dev-auth-token）header**（與 Kit mutation 路由對齊）；前端帶該 header，endpoint **拒無 auth → `401/403`**。
   - **與 watcher 的關係（§7-B' 拍板後更新）**：一鍵鈕 endpoint 本身是 additive、不改 watcher；但 §3.4（§7-B' 全自動）**另行刻意改** watcher tick 的 dedup（baseline→ledger 去重），故既有未轉檔在 auto-enroll 後多半已被自動觸發，**一鍵鈕主要用於 retry `failed` / 強制重轉**。AC7 見更新版（§5）。
   - **冪等**：同一 key 重複觸發走 ledger 既有 `mw_<hash16>` 冪等（有紀錄回既有，不重複建 job）。
   - **成功/失敗回饋（major 修正）：** 成功→trigger response **帶回 `{status, idempotency_key}`**，前端直接 patch 對應 chip 為 `detected/queued`（零額外 round-trip，不靠 polling）；失敗（presign 失敗／key 不符／網路）→ UI 顯 **inline error、chip 維持原狀不變**（注意：chip 的 `failed` 是 converter 失敗、與 trigger call 本身失敗語意不同）。

3. **誠實升級宣告（同 NOT BUILT→built 處理）：** 新增手動觸發 UI **推翻**閉環 spec 非目標「不新增手動插隊/優先序佇列 UI」（`2026-06-23-…-design.md:25, 42`）。註：此為「手動 intake **觸發**」非「佇列插隊」，但仍屬被 spec 排除的手動觸發 UI，故須以新 change supersede 該非目標（§8）。一鍵鈕走的是 spec 已認可的手動 webhook intake 等效路徑，只是包成按鈕。

4. **auto-enroll（§7-B' 使用者拍板：全自動）：** 既有未轉檔自動補轉，設計見 §3.4。

### 3.4 全自動 auto-enroll（§7-B' 使用者拍板：全自動）

**拍板：** §7-B' 選「全自動」——既有未轉的 `model.ifc` 不需手動按鈕，watcher 自動補轉。

**設計＝以持久 ledger 當去重水印（已讀碼驗證可行、非另案）：**

1. **改 watcher tick dedup**（`minioWatcher.ts:384-399`）：移除 `isFirstRound` baseline 特例（原「首輪全寫 `seen` 不觸發」）；改為對每個 `*/model.ifc` 算 `idkey = idempotencyKeyFor(bucket,key,etag)`（=`mw_<hash16>`，`minioWatcher.ts:29`），查**持久 ledger** `conversionLedger.get(idkey)`：**無紀錄→觸發 intake（並落帳）；有紀錄→skip**。
2. **重啟不風暴（關鍵安全性）：** ledger 持久於 `data/conversion-ledger.json`（`config.ts:393`、atomic swap `conversionLedger.ts:81-92`）。重啟後 watcher 重掃、算同一 `idkey`、命中既有 ledger 紀錄→skip；只有**真正新 key 或新 etag**（→ 新 `idkey`）才觸發。`idempotencyKeyFor` docstring 明寫此即設計意圖（「重啟重掃命中既有 idempotencyIndex」`minioWatcher.ts:21`）。**取代**原所慮「須另案做持久化 watermark」——水印已存在（持久 ledger），無需新建。
3. **效果：** 既有 3 個 `model.ifc`（目前 ledger=0）在本案 ship 後**下一輪 tick 自動觸發轉檔**；新上傳自動觸發；重啟不重觸發。
4. **誠實代價（推翻原 AC7「零變更」）：** 這**動到 watcher tick 核心**（baseline→ledger dedup）、**非零 blast radius**。實作前須跑 GitNexus `impact({target:'startMinioWatcher'})`、commit 前 `detect_changes`；`baseline_count`/`seen` 語意調整須同步既有 watcher 測試。in-memory `seen` 可留作**單輪快取**（避免同輪重複查 ledger），但**權威去重以持久 ledger 為準**。
5. **與一鍵手動觸發（§3.3）並存**：auto-enroll 處理常態；一鍵鈕用於 retry `failed` / 強制重轉。兩者都經 `idkey` 冪等、不重複建 job。

---

## 4. 範圍

### 4.1 In scope
- `bim-review-coordinator` `/api/minio/objects`：additive 加 `delimiter` 參數 + `listMinioFolder`（資料夾語意 list），舊簽名/回應欄位不動。
- `bim-review-coordinator` **新增 additive `POST /api/conversion/trigger {key}`**（一鍵觸發：server-side presigned + 重用 watcher intake 寫 ledger；§3.3）。
- `bim-review-coordinator` **watcher auto-enroll（§7-B' 全自動）**：tick dedup 從 in-memory baseline 改持久 ledger 去重（§3.4），既有未轉檔自動補轉、重啟不風暴。
- `web-viewer-sample` `#minio`（`MinioDataPage`）：raw-folder 逐層導覽 + 葉層語意 badge + role/pending 誠實 + 資料夾摺疊 + **ledger 狀態 chip + 一鍵觸發鈕**。
- `web-viewer-sample` `#conv`（`ConversionSchedulingPage`）：baseline/triggered 區分揭露 + 補救文案 + 一致性基準（與/或一鍵觸發鈕）。
- 文件三方同步（§8）。

### 4.2 Out of scope
- **實際做 IFC→USD 轉檔引擎**（conversion authority 在 `bim-streaming-server`）。
- ~~改 watcher baseline 觸發語意 / auto-enroll~~ → **已移進 in-scope**（§7-B' 拍板全自動、§3.4）。仍 out-of-scope：**改 `deriveIntakeFromKey` 三段規約**、**改 ledger schema / `idempotencyKeyFor` 算法**。
- **`local_fs` `/api/files/tree` API 與 A1/A2 binding**（`spec.md:6-8, 69-95` SHALL **保留不動**；local_fs 只是不再當 `#minio` 顯示來源、原地降格為 A1/A2 頁內檔案選擇器）。
- **watcher `seen` 索引持久化／重啟 watermark**、**改 `deriveIntakeFromKey` 三段規約**。

---

## 5. 驗收條件（Acceptance Criteria）

> 誠實鐵律：真資料、非 mock；user-facing 須 browser E2E 證據（gstack/截圖、隔離 branch stack）。

- [ ] **AC1：** `#minio` 樹頂層出現全部 **7 個專案資料夾**（依 `localeCompare('zh-TW')` 排序），不再只剩 1 個 ＋「(未知專案)」桶。
- [ ] **AC2：** 逐層導覽下每層物件歸到其 key 路徑**實際所在**的資料夾；524 個 `.json` 不再落「(未知專案)」；UI 不再用 `deriveIntakeFromKey` 是否 `ok` 當分組鍵（改用 CommonPrefix/路徑前綴）。
- [ ] **AC3：** 每物件標 role（`source_ifc`/`parsed_usdc`/`other`），role 由副檔名計算、與 intake 三段脫鉤。
- [ ] **AC-D2：** 點到含大量 chunk 的子樹（如 `…/geometries_chunks/`）時，該層以**單一可點擊資料夾節點**呈現，API 回應 `objects` **不含** chunk 葉物件、`folders[]` 含該 prefix；資料夾節點旁**不顯示寫死的物件數**。**超 1000 子前綴/物件的層不截斷**（`listMinioFolder` while-loop 全拉、處理 `IsTruncated`）。
- [ ] **AC-badge：** 導到含 `model.ifc` 的版本層，該物件旁顯示『專案(中文)/種類/版本』語意 badge（`deriveIntakeFromKey`，≥3 段才掛）；非 `model.ifc` 不掛。raw 樹逐層顯示完整中文 key。
- [ ] **AC-honesty：** `#minio` 維持 loading/error/empty/populated 四態，error 顯原因+可重試，無寫死/示意樹偽裝真資料；list 回應不含 presigned URL；頁首誠實字樣保留；pending 標記只掛同層可見 `.ifc` 且無 `.usdc` 的版本層。**empty 態分兩種文案**：(a) MinIO 未設定（後端回 `note`，200）；(b) 已設定但當前 prefix 無物件（`folders=[] objects=[]`）——不可混用「MinIO watch 未設定」誤導文案（修現況 `pages.tsx:1234` 兩因混寫）。
- [ ] **AC5：** `#conv` 分別呈現 `baseline_count` 與 `triggered_total`，標註 baseline 既有 `model.ifc` 原因（by-design 不自動轉檔），並明示一致性基準=可解析 IFC 數(3)非物件總數(527)。
- [ ] **AC6：** `#conv` (a) 保留**說明文案**列兩條 spec 認可補救（重新上傳改 etag／手動 webhook `POST /api/external/ifc-ready`，**僅文字說明**）；(b) 實際可點擊入口＝AC-trigger 的一鍵觸發鈕（走 `POST /api/conversion/trigger`）。兩者**不重複實作**：`/api/external/ifc-ready` 僅文字、UI 觸發走 `/api/conversion/trigger`。
- [ ] **AC-chip：** `#minio` `.ifc` 物件旁顯示 ledger 衍生狀態 chip（`ready`/`detected`/`queued`/`converting`/`failed`/`未轉(含 baseline)`/`未進佇列`），值取自 `/api/conversion/records`，無紀錄誠實標『未轉』不臆測。
- [ ] **AC-trigger：** 對「未轉/failed」`model.ifc`，`#minio`（與/或 `#conv`）有「觸發轉檔」鈕，走 intent→confirm→audited；按下打 `POST /api/conversion/trigger`（**帶 `x-dev-token`，拒無 auth → 401/403**），coordinator server-side 生 presigned + 獨立 `triggerManualIntake` 寫 ledger；**成功 response 帶回 `{status, idempotency_key}`**、前端直接 patch chip 為 `detected/queued`；**失敗顯 inline error、chip 不變**；同 key 重觸發冪等不重複建 job；按鈕/回應**不洩漏 presigned URL**。
- [ ] **AC7（改）：** watcher dedup 由 in-memory baseline **刻意改為持久 ledger 去重**（§3.4）——`deriveIntakeFromKey`/`idempotencyKeyFor`/ledger schema **不改**，改的是 tick「要不要觸發」的判定來源。實作前跑 GitNexus `impact`、commit 前 `detect_changes`，確認 blast radius 限於 watcher tick dedup、未波及 intake/dispatch 下游。
- [ ] **AC-autoenroll：** 既有 ledger 無紀錄的 `*/model.ifc`（含原 baseline 3 檔）在 watcher 下一輪 tick **自動觸發 intake**、ledger 落帳；**coordinator 重啟後不重觸發**已落帳者（持久 ledger 命中 `mw_<hash16>`）；只有**新 key/新 etag** 才觸發。可由「重啟 coordinator → ledger count 不暴增、無重複 job」驗證。
- [ ] **AC8：** browser E2E：截圖顯示 `#minio` 7 個專案資料夾逐層展開 + `geometries_chunks` 摺成單一資料夾不攤開 + `#conv` baseline/triggered 區分；維持「無假 ready / ledger 不出現 ready / `#minio` 不出現假 parsed USDC」不變量。
- [ ] **AC-doc-align：** prototype 移除「真 S3/MinIO 三層待接 NOT BUILT」浮水印與 local_fs `#minio` 渲染；openspec `minio-fileserver-source` `#/minio` requirement 經新 change supersede（A1/A2 binding SHALL 不動）；closed-loop design display_model 改記 raw-folder（§8）。

---

## 6. 既有測試衝擊（先量再改）

- **後端既有零改 + 新增測試**：保留 `listMinioObjects` 舊簽名 + 加 `listMinioFolder` → `tests/minio-objects-route.test.ts` 零改；新增 `POST /api/conversion/trigger` 須補新測試（驗 key 規約/防穿越、presigned 不外洩、冪等、重用 intake 寫 ledger）。
- **watcher tick dedup 改動（§3.4 auto-enroll，非 additive）**：`minioWatcher.ts` tick 的 baseline→ledger dedup **會改既有 watcher 測試**（`baseline_count`/首輪不觸發的斷言要改）；新增「既有無紀錄→自動觸發」「重啟命中 ledger→不重觸發」測試。實作前跑 GitNexus `impact({target:'startMinioWatcher'})`。
- **前端須重寫斷言（非加測試）**：`MinioDataPage.test.tsx`（8 it；含原「不呼叫 `getConversionRecords`」斷言改為**會呼叫**以掛狀態 chip）、`console.test.tsx`（`:394-396 / :538-568 / :801-840` 綁三層樹語意）、`e2e/minio-closed-loop.spec.ts:234-247` → 改為 `folders[]` 逐層導覽 + 狀態 chip + 觸發鈕斷言。
- web-viewer `npm run build`＝vite **不跑 tsc**，須另跑 `npx tsc --noEmit`。
- coordinator 提交前跑 `npm run verify`（`build && test`）。

### 6.1 既有符號真實簽名（plan/實作作者**必對齊**，逐字稿勿臆造）

P1 plan reviewer 抓到兩處逐字稿與真實 codebase 不符，列實證簽名供對齊：

- **`ConversionLedger`**：**constructor-based** — `new ConversionLedger(persistencePath)`（`conversionLedger.ts:50,56`）。**無 `createConversionLedger` 工廠 export**；測試/route 一律 `new ConversionLedger(...)`。
- **`IntentDialog` props**（`IntentDialog.tsx:9-21`）：`open` / `title` / `cost` / `onConfirm(reason)` / `onCancel` / `busy` / `actionErr`。**無 `body` / `confirmLabel`**；觸發鈕的「成本說明」放 `cost`、標題放 `title`、確認文字由元件內建。

---

## 7. 拍板紀錄 ＋ 剩餘待確認

**已拍板：**
- **OQ1**（§2.1-2.2）：S3 `Delimiter` 逐層 raw-folder；三層語意降為葉層 badge。
- **OQ2**（§2.3）：`geometries_chunks` 摺成末層目錄、不攤開、不寫死物件數。
- **OQ5**（§1.2＋§4.2）：`#minio` = 真 MinIO 瀏覽單一來源，取代 local_fs；local_fs API/A1/A2 binding 保留。
- **OQ3（使用者 2026-06-24 拍板）**：**新增一鍵觸發轉檔鈕**（§3.3），轉檔可否觸發**依 ledger 紀錄**判定；走既有手動 intake 等效路徑（一鍵鈕本身不改 watcher；watcher dedup 改動見 §7-B'/§3.4）。
- **狀態 chip（使用者拍板）**：`#minio` `.ifc` 旁顯示 ledger 衍生狀態 chip（§2.5 第 6 點、AC-chip）。
- **§7-B'（使用者 2026-06-24 拍板：全自動 auto-enroll）**：watcher tick dedup 改持久 ledger 去重（§3.4）；既有未轉自動補轉、重啟不風暴；AC7 由零變更改為刻意安全變更、AC-autoenroll 驗收。一鍵手動觸發（§3.3）保留作 retry/強制重轉。

**剩餘待確認（不阻擋寫 plan 主體，標為 gate）：**
- **B（OQ4，維護者動作）：** `openspec/changes/minio-watch-key-structure/` **仍 active（未 archive，已查證）**，live `openspec/specs/minio-watch-auto-intake/spec.md:14` 仍寫舊「兩層 `{projectId}/{modelId}`」。不阻擋主樹（raw-folder 不依賴三段），但**阻擋葉層 badge 驗收正確性**。動作：維護者進實作前 archive 該 change（或明訂 ≥3 段 delta 為 live 權威）。
- ~~**B'（auto-enroll）**~~ **已拍板：全自動**（見上「已拍板」§7-B'、§3.4）。水印用既有持久 ledger、非另案；watcher tick dedup 改動須走 GitNexus impact + writing-plans。

---

## 8. 文件三方同步（spec_doc_updates_needed）

1. `docs/plans/ai-bim-governance-prototype.html:534` — 把「真 MinIO 瀏覽」從 NOT BUILT 清單移除。
2. `docs/plans/ai-bim-governance-prototype.html:1107-1165`（MinioPage 整段）— 改寫成 raw-folder 逐層導覽；移除 `:1118` header「真 S3/MinIO 三層結構瀏覽待接 — 不是真 MinIO」、`:1122-1125` 浮水印「真 S3/MinIO 三層待接」、`:1126-1144` local_fs 兩層樹渲染；`:1147-1157` prov=demo 規約面板改標純語意參照；`:1158-1162` deps 改成 coordinator `/api/minio/objects` + 真 MinIO，移除把 `/api/files/tree` 當 `#minio` 來源的 governance dep。
3. `openspec/specs/minio-fileserver-source/spec.md:54-67`（Requirement「#/minio SHALL 顯示真實檔案庫樹」+ 兩 Scenario）— 以**新 change supersede**：`#minio` 改規範為「真 MinIO raw-folder 逐層 list」，local_fs 渲染歸屬從 `#minio` 移走；**`:6-8`（governance file-tree API）與 `:69-95`（A1/A2 binding SHALL）必須保留不動**。
4. `docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md:84-88` — **整段（`:84-88`）重寫**：主樹 = raw-folder 逐層（S3 `Delimiter`，**無三層語意骨架**）；三層語意降為葉層 badge（`model.ifc` 旁附帶）。**不得只改 `:86` 單行而留 `:85`「三層（專案→類別→版本）」舊語意**（否則 `:85`/`:86` 上下文自相矛盾）。
4b. `docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md:25, 42` — 非目標「不新增手動插隊/優先序佇列 UI」須以新 change **supersede**（本案使用者拍板新增「一鍵觸發轉檔」鈕 + `POST /api/conversion/trigger`；明示這是「手動 intake 觸發」非「佇列插隊」）。
5. `openspec/specs/minio-watch-auto-intake/spec.md:18-22`（「首輪 baseline SHALL NOT 觸發」）＋ `docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md:28, 53-54, 101` — §7-B' 全自動 auto-enroll（§3.4）把 watcher dedup 由 baseline 改為持久 ledger 去重，**須以新 change supersede**「首輪 baseline 不觸發」語意（改為「ledger 無紀錄才觸發」）；明示重啟不風暴靠持久 ledger（非新建 watermark）。
6. 本檔 §2.5 第 5 點（「含 source IFC」badge）已從 optional 升為輕量硬 AC（AC-badge 之外另立）；§7 已標 OQ1/OQ2/OQ5 拍板、OQ4 為 archive gate。

---

## 9. Spec / 程式碼引用（citations）

- `docs/plans/ai-bim-governance-prototype.html:534, 1107-1165` — 真 MinIO 瀏覽 NOT BUILT、local_fs 兩層樹 + 待接浮水印
- `openspec/specs/minio-watch-auto-intake/spec.md:8, 18-22` — env opt-in、首輪只登記 baseline 不觸發、後續輪新 key/etag 才觸發
- `openspec/specs/minio-watch-auto-intake/spec.md:14` — **被取代的舊「兩層 `{projectId}/{modelId}`」規約**（OQ4 archive gate 對象）
- `openspec/changes/minio-watch-key-structure/specs/minio-watch-auto-intake/spec.md:7, 11-16` — ≥3 段規約、新物件自動觸發 Scenario（active change，未 archive）
- `openspec/specs/minio-fileserver-source/spec.md:6-8, 54-67, 69-95` — local_fs 兩層 API、`#minio` 四態誠實守門、A1/A2 binding SHALL
- `docs/superpowers/specs/2026-06-22-minio-watch-key-structure-design.md:24, 27-28, 37-41, 77-78` — 三段錨點、中間層保留供顯示、UI 落點 `#/conv`、三欄拆分列 follow-up
- `docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md:24, 84-88, 95-97` — display_model、結構化樹+role、三視圖一致無矛盾數字
- `docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md:28, 53-54, 101` — 首掃 baseline 不觸發為刻意取捨；補救=重新上傳/手動 webhook intake；seen 不持久化
- `bim-review-coordinator/src/services/minioClient.ts:36-39, 40-61` — `ListObjectsV2` 無 Delimiter 遞迴攤平；role 由副檔名；`d.ok=false` 三欄寫 null
- `bim-review-coordinator/src/services/minioWatcher.ts:71-113, 384-398` — `deriveIntakeFromKey` 三段解析；首輪 baseline 不觸發；後續輪 `prev===etag` continue
- `bim-review-coordinator/src/app.ts:1206-1240` — `/api/minio/objects` 已讀 `query.prefix` 透傳、回應無 presigned URL、502 誠實錯誤
- `bim-review-coordinator/src/config.ts:419` — `minioWatchKeySuffix` 預設 `/model.ifc`
- `@aws-sdk/client-s3 …/models/models_0.d.ts`（`Delimiter`/`CommonPrefixes` 原生支援、roll-up keys not returned elsewhere）
- `web-viewer-sample/src/console/pages.tsx:1157-1171, 1214-1215, 1257-1264` — `buildMinioTree` 分組、頁首誠實字樣、pending prov=p1
- `web-viewer-sample/src/console/coordinatorClient.ts:301` — 中文 prefix `encodeURIComponent`

---

## 10. 下一步

1. §7 全部拍板（OQ1/2/3/5＋狀態 chip＋§7-B' 全自動）；維護者處理 §7-B（archive gate）。
2. 拍板後用 `superpowers:writing-plans` 產 `docs/superpowers/plans/2026-06-24-minio-folderview-and-baseline-disclosure.md` 逐 task 實作 plan（TDD、先量 baseline、後端 additive 零改、前端重寫斷言）。
3. 依 `superpowers:subagent-driven-development` 執行；改 symbol 前跑 GitNexus `impact`、commit 前 `detect_changes`（§3.4 刻意改 watcher tick dedup，驗 blast radius 限於預期、未波及 intake/dispatch 下游）；user-facing 跑 gstack browser E2E 取證。
4. 文件三方同步（§8）與實作同 PR，避免再次背離。

> 開成 GitHub issue：§1（背景＋三方矛盾）+ §2（Q1 設計）+ §3（Q2 設計）+ §5（AC）+ §7（待拍板）即為 issue body 主體。
