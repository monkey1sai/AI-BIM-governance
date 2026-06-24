# MinIO `#minio` 真資料夾瀏覽 ＋ `#conv` baseline 揭露 — Issue Spec

> **狀態：** Issue spec（design）。經兩輪 ultracode 研究 ＋ 一輪 **交叉對抗分析（10 agents，prototype × spec × live × 使用者決定 四方對撞）** 後，**OQ1 / OQ2 / OQ5 已拍板**；剩 **OQ3（手動觸發入口）、`#minio→#conv` 狀態 chip 耦合決策、OQ4（規約 archive gate）** 待使用者/維護者確認（§7）。決策拍板後用 `superpowers:writing-plans` 產 `docs/superpowers/plans/` 實作 plan。
>
> **證據鏈：** 所有 spec/程式碼引述附 `file:line`（§9）；live 由 coordinator `:8004` 實測；prototype 設計來源 `docs/plans/ai-bim-governance-prototype.html`。

**一句話：** `#minio` 拍板做「**真 MinIO 唯讀資料夾導覽**」＝ S3 `Delimiter='/'` raw-folder 逐層 lazy（**像 MinIO 網頁一樣聰明**，使用者 D1）＋ `geometries_chunks` 等末層**摺成單一資料夾節點不攤開**（使用者 D2）；三層「專案/種類/版本」語意從「樹骨架」**降為導到 `model.ifc` 葉層才掛的語意 badge**，`watcher` / `deriveIntakeFromKey` **零改、zero blast radius**。此案正式把 prototype「真 S3/MinIO 三層待接 NOT BUILT」**升為已建**，須同步移除浮水印並改寫三方文件（§8）。

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
6. **`#minio`→`#conv` 唯讀狀態 chip（⚠ 耦合待拍板，見 §7-C）**：`.ifc` 葉物件旁加唯讀狀態 chip，值取自既有 ledger `/api/conversion/records`（`idempotency_key=mw_<hash16>` 對應），顯示 `detected/queued/converting/ready/failed` 或『未偵測(baseline 既有檔)』；查不到誠實標『未進偵測佇列 — 見 #conv 自動偵測面板』。chip **唯讀、不觸發轉檔**，不違反「不新增手動插隊 UI」非目標。
7. **守門全保留**：(a) list 回應**永不夾帶 presigned URL**（已驗證 route 內 0 個 `getSignedUrl`、`MinioObjectView` 無 url 欄；要下載才另引 presign，沿用 watcher 不入 log 規約）；(b) 把 CommonPrefix 當 id/path 前沿用 `deriveIntakeFromKey` 拒空段/`.`/`..` 防穿越；(c) 頁首『唯讀 intake 來源視圖，非 metadata 權威…權威在 `bim-control·MySQL`』保留（`pages.tsx:1214-1215`）；(d) `prov=demo` bucket-layout 規約面板留作純語意參照，不與真實逐層結果混淆。
8. **誠實升級宣告**：本案把 prototype『真 S3/MinIO 三層待接 NOT BUILT』升為已建，**必須同步移除浮水印與「待接」字樣**（§8）——把已建功能還掛 NOT BUILT 才是說謊，移除是誠實鐵律的**要求**。watcher/`deriveIntakeFromKey` 完全不動（zero blast radius）。

---

## 3. Q2（已拍板）— `#conv` baseline 揭露（純增益，不改觸發語意）

### 3.1 為什麼沒轉檔（by-design，不是 bug）

watcher「**首輪 SHALL 只登記 baseline 不觸發；之後才出現的新 key 或新 etag 才觸發**」（`openspec/specs/minio-watch-auto-intake/spec.md:8, 18-22`），刻意防止對既有大 bucket 爆量誤觸發（`2026-06-12-…-design.md:28, 53-54`）。3 個既有 `model.ifc` 在首輪被當 baseline 吸收（`minioWatcher.ts:384-387`），etag 沒變 → 每輪 `prev===etag` continue（`:388-398`）→ `triggered_total` 恆 0。`poll_count=23` 證明 loop 健康、只是無新事件。

### 3.2 `#conv` 揭露設計（逐點）

1. 把現況擠在單一 Field（`pages.tsx:866`）的 baseline/seen/triggered/skipped **拆成獨立 Field + 解釋文案**：`baseline_count`＝「既有 `model.ifc` 在首輪被當基準吸收、**by-design 刻意不自動轉檔**」；`triggered_total`＝「自 baseline 後真正新觸發的上傳數」。避免把 `triggered_total=0` 誤讀成故障。
2. 對 baseline 既有 `model.ifc` 標註原因（首輪被當基準吸收）。
3. 列 spec 認可的兩條補救：(i) **重新上傳改 etag** → watcher 下一輪自動觸發；(ii) **手動 webhook intake** 直打 `POST /api/external/ifc-ready`（帶 webhook secret + presigned GET URL）。
4. 誠實註記：repo 內目前**無一鍵觸發 UI**，明標 `NOT BUILT`；**重啟也救不了**既存檔（`seen` in-memory 不持久化，重啟首輪重建 baseline）。
5. **三視圖一致性基準明示**（避免違反閉環 spec `:95-97`）：`baseline_count=3` **只算 `*/model.ifc` 規約檔、非 bucket 全量 527**；「`#minio` 527 物件 vs watcher 只認 3 個 vs ledger=0」的一致性基準 = **「可解析 IFC 數」非「物件總數」**，文案須講清楚，否則使用者誤以為 watcher 漏看 524 物件。
6. 與 Q1 零交集：Q1 只動 `listMinioObjects`/`buildMinioTree`/`#minio`，與 watcher 觸發語意零交集（AC7）。

---

## 4. 範圍

### 4.1 In scope
- `bim-review-coordinator` `/api/minio/objects`：additive 加 `delimiter` 參數 + `listMinioFolder`（資料夾語意 list），舊簽名/回應欄位不動。
- `web-viewer-sample` `#minio`（`MinioDataPage`）：raw-folder 逐層導覽 + 葉層語意 badge + role/pending 誠實 + 資料夾摺疊。
- `web-viewer-sample` `#conv`（`ConversionSchedulingPage`）：baseline/triggered 區分揭露 + 補救文案 + 一致性基準。
- 文件三方同步（§8）。

### 4.2 Out of scope
- **實際做 IFC→USD 轉檔引擎**（conversion authority 在 `bim-streaming-server`）。
- **改 watcher baseline 觸發語意**（by-design，AC7 零變更）。
- **新增「對既有 MinIO IFC 一鍵觸發轉檔」入口**（OQ3，預設維持非目標；§7-A 待使用者拍板）。
- **`local_fs` `/api/files/tree` API 與 A1/A2 binding**（`spec.md:6-8, 69-95` SHALL **保留不動**；local_fs 只是不再當 `#minio` 顯示來源、原地降格為 A1/A2 頁內檔案選擇器）。
- **watcher `seen` 索引持久化／重啟 watermark**、**改 `deriveIntakeFromKey` 三段規約**。

---

## 5. 驗收條件（Acceptance Criteria）

> 誠實鐵律：真資料、非 mock；user-facing 須 browser E2E 證據（gstack/截圖、隔離 branch stack）。

- [ ] **AC1：** `#minio` 樹頂層出現全部 **7 個專案資料夾**，不再只剩 1 個 ＋「(未知專案)」桶。
- [ ] **AC2：** 逐層導覽下每層物件歸到其 key 路徑**實際所在**的資料夾；524 個 `.json` 不再落「(未知專案)」；UI 不再用 `deriveIntakeFromKey` 是否 `ok` 當分組鍵（改用 CommonPrefix/路徑前綴）。
- [ ] **AC3：** 每物件標 role（`source_ifc`/`parsed_usdc`/`other`），role 由副檔名計算、與 intake 三段脫鉤。
- [ ] **AC-D2：** 點到含大量 chunk 的子樹（如 `…/geometries_chunks/`）時，該層以**單一可點擊資料夾節點**呈現，API 回應 `objects` **不含** chunk 葉物件、`folders[]` 含該 prefix；資料夾節點旁**不顯示寫死的物件數**。
- [ ] **AC-badge：** 導到含 `model.ifc` 的版本層，該物件旁顯示『專案(中文)/種類/版本』語意 badge（`deriveIntakeFromKey`，≥3 段才掛）；非 `model.ifc` 不掛。raw 樹逐層顯示完整中文 key。
- [ ] **AC-honesty：** `#minio` 維持 loading/error/empty/populated 四態，error 顯原因+可重試，無寫死/示意樹偽裝真資料；list 回應不含 presigned URL；頁首誠實字樣保留；pending 標記只掛同層可見 `.ifc` 且無 `.usdc` 的版本層。
- [ ] **AC5：** `#conv` 分別呈現 `baseline_count` 與 `triggered_total`，標註 baseline 既有 `model.ifc` 原因（by-design 不自動轉檔），並明示一致性基準=可解析 IFC 數(3)非物件總數(527)。
- [ ] **AC6：** `#conv` 列兩條補救（重新上傳改 etag / 手動 `POST /api/external/ifc-ready`），誠實標明無一鍵觸發 UI（`NOT BUILT`）。
- [ ] **AC7：** watcher 觸發語意**零變更**（`deriveIntakeFromKey`/`minioWatcher` 不改，`detect_changes` 驗證 scope 不含 watcher 觸發路徑）。
- [ ] **AC8：** browser E2E：截圖顯示 `#minio` 7 個專案資料夾逐層展開 + `geometries_chunks` 摺成單一資料夾不攤開 + `#conv` baseline/triggered 區分；維持「無假 ready / ledger 不出現 ready / `#minio` 不出現假 parsed USDC」不變量。
- [ ] **AC-doc-align：** prototype 移除「真 S3/MinIO 三層待接 NOT BUILT」浮水印與 local_fs `#minio` 渲染；openspec `minio-fileserver-source` `#/minio` requirement 經新 change supersede（A1/A2 binding SHALL 不動）；closed-loop design display_model 改記 raw-folder（§8）。

---

## 6. 既有測試衝擊（先量再改）

- **後端零改**：靠保留 `listMinioObjects` 舊簽名 + 加 `listMinioFolder` 新函式 → `tests/minio-objects-route.test.ts` 零改。
- **前端須重寫斷言（非加測試）**：`MinioDataPage.test.tsx`（8 it）、`console.test.tsx`（`:394-396 / :538-568 / :801-840` 綁三層樹語意）、`e2e/minio-closed-loop.spec.ts:234-247` → 改為 `folders[]` 逐層導覽斷言。
- web-viewer `npm run build`＝vite **不跑 tsc**，須另跑 `npx tsc --noEmit`。
- coordinator 提交前跑 `npm run verify`（`build && test`）。

---

## 7. 待拍板的剩餘決策（交叉對抗後仍真正需人拍板）

> OQ1 / OQ2 / OQ5 已由交叉對抗拍板（§2 / §2.3 / §1.2＋§4.2）。以下三點對抗無法代決：

- **A（OQ3）— 要不要新增「對既有 3 個 `model.ifc` 一鍵觸發轉檔」入口？**
  仲裁建議**維持非目標**（只在 `#conv` 揭露兩條既有補救）。但若你想**真的把既有 IFC 轉出來看結果**，屬擴大範圍、須另案 spec。這是產品意願題。
- **B（OQ4）— 規約 archive gate（事實已查證）：** `openspec/changes/minio-watch-key-structure/` **仍 active（未 archive）**，live `openspec/specs/minio-watch-auto-intake/spec.md:14` 仍寫舊「兩層 `{projectId}/{modelId}`」。**不阻擋主樹**（raw-folder 不依賴三段規約），但**阻擋葉層 badge 的驗收正確性**。動作：維護者在進實作 plan 前 archive 該 change（或明訂 ≥3 段 delta 為 live 權威）。
- **C — `#minio`→`#conv` 唯讀狀態 chip（§2.5 第 6 點）要不要做？**
  做 → 滿足閉環 spec `:95-97`「三視圖一致」＋你「從 `#minio` 看轉了沒」的需求，但 `#minio` 新增對 ledger 的唯讀依賴（現況 `MinioDataPage.test.tsx` 斷言『不呼叫 `getConversionRecords`』，要改）。不做 → `#minio`/`#conv` 完全零耦合，退而求其次=頁首純文字指引『轉檔狀態見 #conv』（較弱、仍要跳頁）。耦合 vs 解耦由你拍板。

---

## 8. 文件三方同步（spec_doc_updates_needed）

1. `docs/plans/ai-bim-governance-prototype.html:534` — 把「真 MinIO 瀏覽」從 NOT BUILT 清單移除。
2. `docs/plans/ai-bim-governance-prototype.html:1107-1165`（MinioPage 整段）— 改寫成 raw-folder 逐層導覽；移除 `:1118` header「真 S3/MinIO 三層結構瀏覽待接 — 不是真 MinIO」、`:1122-1125` 浮水印「真 S3/MinIO 三層待接」、`:1126-1144` local_fs 兩層樹渲染；`:1147-1157` prov=demo 規約面板改標純語意參照；`:1158-1162` deps 改成 coordinator `/api/minio/objects` + 真 MinIO，移除把 `/api/files/tree` 當 `#minio` 來源的 governance dep。
3. `openspec/specs/minio-fileserver-source/spec.md:54-67`（Requirement「#/minio SHALL 顯示真實檔案庫樹」+ 兩 Scenario）— 以**新 change supersede**：`#minio` 改規範為「真 MinIO raw-folder 逐層 list」，local_fs 渲染歸屬從 `#minio` 移走；**`:6-8`（governance file-tree API）與 `:69-95`（A1/A2 binding SHALL）必須保留不動**。
4. `docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md:84-88` — display_model 從 3-level-semantic 改記 raw-folder；`:86`「回傳結構化樹」改「逐層 `folders[]`+當層 `objects`」。
5. 本檔 §2.5 第 5 點（「含 source IFC」badge）已從 optional 升為輕量硬 AC（AC-badge 之外另立）；§7 已標 OQ1/OQ2/OQ5 拍板、OQ4 為 archive gate。

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

1. **使用者拍板 §7-A（手動觸發入口）、§7-C（狀態 chip 耦合）**；維護者處理 §7-B（archive gate）。
2. 拍板後用 `superpowers:writing-plans` 產 `docs/superpowers/plans/2026-06-24-minio-folderview-and-baseline-disclosure.md` 逐 task 實作 plan（TDD、先量 baseline、後端 additive 零改、前端重寫斷言）。
3. 依 `superpowers:subagent-driven-development` 執行；改 symbol 前跑 GitNexus `impact`、commit 前 `detect_changes`（驗 watcher 觸發路徑零變更）；user-facing 跑 gstack browser E2E 取證。
4. 文件三方同步（§8）與實作同 PR，避免再次背離。

> 開成 GitHub issue：§1（背景＋三方矛盾）+ §2（Q1 設計）+ §3（Q2 設計）+ §5（AC）+ §7（待拍板）即為 issue body 主體。
