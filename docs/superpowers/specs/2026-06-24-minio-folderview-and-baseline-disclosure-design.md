# MinIO `#minio` 資料夾展開 ＋ `#conv` baseline 揭露 — Issue Spec

> **狀態：** Issue spec（design，含未決設計決策）。本檔回答兩個現場觀察問題並界定範圍；**因 Q1 仍有 open questions（§7），尚不可直接進逐行實作 plan**，待決策拍板後再用 `superpowers:writing-plans` 產出 `docs/superpowers/plans/` 實作 plan。
>
> **產出方式：** 證據由 ultracode workflow（4 agents 並行讀 4 份 minio spec + 程式碼）＋ live coordinator（`:8004`）實測彙整；所有 spec 引述均附 `file:line`（§8）。

**一句話：** `#minio` 頁應依 MinIO bucket 的 key 規約以「專案 → 種類 → 版本」**資料夾層級展開全部物件**（而非沿用 watcher 的 `/model.ifc` 觸發規約把 527 個葉物件攤平、524 個落「(未知專案)」桶）；同時 `#conv` 頁應**明示既有 3 個 `model.ifc` 因 watcher 首輪 baseline 語意被當基準、刻意不自動轉檔（by-design）**，並提供 spec 認可的下一步指引。

---

## 1. 背景與兩個觀察

使用者在部署中的 console 看到兩個與直覺不符的現象，已用 live coordinator（`:8004`）實測釐清：

- **觀察 A（`#minio` 與真實 MinIO 不符）：** `#minio` 頁把真實 `bim-control` bucket 的 **527 個物件遞迴攤平**回傳、只認 `model.ifc` 規約，導致 **524 個幾何 `.json` 全落「(未知專案)」桶**、**6 個沒有 `model.ifc` 的專案在樹上連專案節點都不出現**。對照真實 MinIO 瀏覽器（`192.168.20.234:9001/browser/bim-control`）的乾淨 **7 個專案資料夾**，兩者長相完全不同。
- **觀察 B（`#conv` 看不出有沒有轉檔）：** bucket 內既有 **3 個 `model.ifc` 從未被轉檔**（`baseline_count=3 / seen_count=3 / triggered_total=0`），畫面上 ledger 與 ifc-ready 皆 0，使用者無法判斷是「畫面壞掉」還是「真的沒轉」。

### 1.1 Live 實測證據（coordinator `:8004`，2026-06-24）

| 端點 | 回傳 | 解讀 |
|---|---|---|
| `GET /api/minio/objects` | `count=527`、`bucket=bim-control`；role = **3 `source_ifc`（.ifc）+ 524 `other`（.json）+ 0 `parsed_usdc`** | 3 個可解析 `model.ifc` 全屬「東勢區許良宇紀念圖書館」 |
| `GET /api/external/minio-watch/status` | `enabled=true`、`baseline_count=3`、`seen_count=3`、`triggered_total=0`、`skipped_malformed_total=0`、`last_triggered=[]`、`poll_count=23`、`last_error=null` | watcher loop 健康在跑，只是無「新增」事件可觸發 |
| `GET /api/conversion/records`（ledger） | `count=0` | 從未 `triggerIntake` → ledger 自然無紀錄 |
| `GET /api/external/ifc-ready` | `count=0` | 無任何轉檔 job |

真實 MinIO 頂層 7 個資料夾（依物件數）：`洲際好宅`(316)、`測試建案0329`(57)、`東勢區許良宇紀念圖書館`(46)、`IOTTEST`(44)、`Demo展示社區-1`(36)、`測試建案0321`(26)、`annotations`(2)。其中**只有「東勢區許良宇紀念圖書館」底下有 `model.ifc`**（3 個，key 形如 `.../root/{main|建築1}/<UUID>/model.ifc`）。

### 1.2 根本症狀：兩條 list 路徑語意不一致

- `#conv` 走 **watcher**：`listAllKeys()` 後立刻 `.filter(o.key.endsWith('/model.ifc'))`，只看 source IFC。
- `#minio` 走 **`listMinioObjects`**：全量列出，但用 `deriveIntakeFromKey`（watcher 的觸發規約）當分組鍵。

兩者把同一個「MinIO」當成不同東西，是兩個觀察的共同根因。

---

## 2. Q1 — `#minio` 應依資料結構以資料夾方式展開

### 2.1 現況（observed）

- `listMinioObjects`（`minioClient.ts:36-39`）用 `ListObjectsV2Command` 帶 `Prefix`/`ContinuationToken` 迴圈但**沒有設 `Delimiter`** → 遞迴列出 bucket 下所有葉物件（527 個）。
- 對每個 `obj` **無條件 `out.push`**、不像 watcher 會 `.filter(endsWith(keySuffix))`（`minioClient.ts:40-61`），所以 524 個非 `model.ifc` 的 `.json` 也被回傳。
- 前端 `buildMinioTree`（`pages.tsx:1157-1170`）直接用回傳物件的 `project_display_name / category / version` 當分組鍵；三者皆 `null` 時 fallback 成 `(未知專案)/(未知種類)/(未知版本)`，且**沒有任何「從 key 路徑切資料夾層級」的邏輯**（`pages.tsx:1237-1273`）。
- **結果：** 樹的節點集合 ＝「能被 `model.ifc` 規約解析的物件集合」，而非「bucket 資料夾集合」。實測樹上只出現 1 個真實專案節點（東勢區許良宇紀念圖書館）＋ 1 個裝 524 個 `.json` 的「(未知專案)」桶；其餘 6 個資料夾整個消失。

### 2.2 spec 對資料結構的權威定義（spec definition）

- 真實 `bim-control` bucket 的 key 規約：去 `prefix` 與 `keySuffix`（預設 `/model.ifc`）後 **SHALL ≥3 段、皆非空、無純點段**——**第一段＝專案（頭）、倒數第二段＝種類、最後一段＝版本**，中間層（專案管理者動態管理、層數可變）識別時忽略（`openspec/changes/minio-watch-key-structure/specs/minio-watch-auto-intake/spec.md:7`；`2026-06-22-minio-watch-key-structure-design.md:24`）。
- 固定錨點只有「頭、倒二、末」三個位置：`projectRaw=segments[0]`、`category=segments[length-2]`、`version=segments[length-1]`，中間 `segments[1..length-3]` 忽略但**保留在原始 key 供顯示**（`2026-06-22-…-design.md:38-41`）。
- 閉環 spec 明列 `#minio` 的期望是「把真實 bucket 三層（專案 → 類別 → 版本）做成只讀瀏覽頁、每物件標角色」「呈現真實 bucket 三層與每物件角色」（`2026-06-23-minio-conversion-closed-loop-observability-design.md:84-88`），且 §1 把「`#minio` 未接真實 bucket list」列為待補、§2.4 要求 `GET /api/minio/objects` 回「結構化樹 ＋ 每物件 role」（同檔 `:24`）。
- UI **須完整顯示 MinIO 原始結構**（整串 key、所有層、中文皆可見）（`2026-06-22-…-design.md:27-28`）。

### 2.3 root cause（三層）

把「為 watcher 觸發 intake 設計的 `model.ifc` 三段規約」**誤用成「瀏覽頁的資料夾分組規約」**：

1. **list 層** — `listMinioObjects` 無 `Delimiter` 且不過濾 `keySuffix`，把全 bucket 527 葉物件攤平回傳（`minioClient.ts:36-61`）。
2. **解析層** — 沿用 `deriveIntakeFromKey` 解 `project/category/version`；它在 `afterPrefix` 不以 `keySuffix` 結尾時直接 `return ok:false`（`minioWatcher.ts:84-86`），524 個 `.json` 對 `/model.ifc`、`/model.usdc` 兩個 probeSuffix 都不結尾 → `d.ok=false` → 三欄全寫 `null`（`minioClient.ts:48-60`）。路由把 `config.minioWatchKeySuffix`（預設 `/model.ifc`，`config.ts:419`）原樣傳入，把瀏覽解析鎖死在 `model.ifc` 規約（`app.ts:1226-1232`）。
3. **呈現層** — `buildMinioTree` 用可能為 `null` 的解析欄位當分組鍵、無 key 路徑切資料夾邏輯（`pages.tsx:1157-1170, 1237-1273`）。

> `deriveIntakeFromKey` 對幾何 `.json` 判 malformed 是**為觸發而設計的設計內行為、不是 bug**；bug 是把它接到瀏覽頁當分組鍵。

### 2.4 提案方向（proposed — 行為層，非逐行 code）

`#minio` 瀏覽頁改為「**依 MinIO bucket 實際 key 路徑、以資料夾層級展開全部物件**」，與 watcher 的 `model.ifc` 觸發規約**解耦**：

- **(a) 列舉用資料夾語意：** 以 `ListObjectsV2` 的 `Delimiter='/'`（`CommonPrefixes`）逐層列資料夾，**或**直接用 `key.split('/')` 的路徑前綴切資料夾層級建樹，使頂層 7 個專案資料夾皆出現，而非只出現可解析的 1 個。（採哪一種屬 §7 open question）
- **(b) 分組鍵改用 key 路徑前綴（資料夾名）** 而非 `deriveIntakeFromKey` 是否 `ok`——非 `model.ifc` 物件（幾何 `.json`）歸到它「實際所在的專案/子資料夾」，不再全部落「(未知專案)」。
- **(c) 保留每物件 role 標記**（`source_ifc / parsed_usdc / other`），但 **role 與「是否能解析成 intake 三段」脫鉤**。
- **(d) 可選：** 在資料夾節點旁疊上 spec 的語意標註（此資料夾是否含 `model.ifc`、是否為 watcher 觸發候選），把「瀏覽真實結構」與「watcher 可觸發子集」兩個視圖並存而非互相覆蓋。

---

## 3. Q2 — 參考 minio spec：為什麼沒轉檔

### 3.1 現況（observed）

bucket 內既有 3 個 `model.ifc`（全屬「東勢區許良宇紀念圖書館」，key 形如 `.../main/<UUID>/model.ifc`）**從未被轉檔**。Live：`baseline_count=3 / seen_count=3 / triggered_total=0 / last_triggered=[] / poll_count=23`；連帶 ledger=0、ifc-ready=0。527 物件中只有這 3 個能通過 `keySuffix=/model.ifc` 過濾並被解析出三段，其餘 524 個 `.json` 連 watcher 候選集都進不去。

### 3.2 spec 的權威解釋：baseline 語意（by-design）

這是 watcher **baseline 語意**的 by-design 結果，明文寫在多份權威 spec：

- watcher 啟用後「**首輪 SHALL 只登記 baseline 不觸發；後續輪的新 key 或同 key 新 etag SHALL 觸發** loopback `POST /api/external/ifc-ready`」（`openspec/specs/minio-watch-auto-intake/spec.md:8`）。
- **首輪 baseline 不爆量 Scenario：** 對既有大量物件的 bucket 首次啟動，首輪 SHALL 只登記 `seen`、**SHALL NOT 對既有物件觸發任何 intake**（同檔 `:18-22`）。
- **新物件自動觸發 Scenario：** 唯有「watcher 已完成 baseline **且 bucket 出現新的** `{專案}/.../{種類}/{版本}/model.ifc`」才在下一輪自動建 intake——「新 `model.ifc`」指 baseline **之後**才出現的新 key 或新 etag，不是 bucket 裡既存的檔（`openspec/changes/minio-watch-key-structure/specs/minio-watch-auto-intake/spec.md:11-16`）。
- 設計文件明文這是**刻意取捨**（成功標準第 2 條）：「首掃 baseline 不觸發…防止對既有 bucket（867 objects）爆量誤觸發」（`2026-06-12-minio-watch-auto-intake-design.md:28, 53-54`）。

**程式碼印證：** `tick()` 第一輪 `if (isFirstRound)` 把所有 objects 寫入 `seen`、設 `baseline_count=seen.size`，整段不呼叫 `triggerIntake`（`minioWatcher.ts:384-387`）；後續輪 `prev === o.etag` 即 `continue`，3 個既存 `model.ifc` 的 etag 從未變過，故每輪命中 `continue`，`triggered_total` 恆為 0（`minioWatcher.ts:388-398, 368`）。

### 3.3 裁決：by-design，不是 bug

`baseline_count=3 / seen_count=3 / triggered_total=0 / last_triggered=[]` 完全是「首輪吸收 3 個既存物件、之後零新增事件」的**預期結果**；`poll_count=23` 證明 loop 仍健康運轉、只是無可觸發的新物件。**需修的不是觸發語意，而是「UI 沒把這個 by-design 事實揭露給操作者」**，讓人誤以為轉檔壞掉。

### 3.4 提案方向（proposed — 揭露，不改觸發語意）

在 `#conv`（watcher 偵測面板）**清楚揭露 baseline 語意並提供下一步**，但**不改 watcher 觸發語意**：

- **(a) 明示「baseline 既有檔不會自動轉檔」：** 把 `baseline_count`（3 個既有 `model.ifc` 在首輪被當基準吸收、刻意不觸發）與 `triggered_total`（自 baseline 後真正觸發的新上傳數）**區分呈現**，避免把 `triggered_total=0` 誤讀成轉檔故障。
- **(b) 說明「什麼動作才會真的觸發既有 IFC 轉檔」**，依 spec 認可的兩條補救路徑：
  1. **重新上傳使 etag 改變** → watcher 視為新事件、下一輪自動觸發（`openspec/specs/minio-watch-auto-intake/spec.md:8`）。
  2. **走既有手動 webhook intake** → 外部 worker/操作者直打 `POST /api/external/ifc-ready`（帶 webhook secret 與 presigned GET URL），繞過 watcher。
- **(c) 誠實註記：** repo 內目前**無對既有物件「一鍵觸發轉檔」的專屬 UI/endpoint**；閉環 spec 非目標明文「不新增手動插隊/優先序佇列 UI」（`2026-06-23-…-design.md:25, 42`；`2026-06-12-…-design.md:101`）。若要新增手動觸發入口，屬擴大範圍、須 spec 另案確認（§7）。
- **(d) 重啟也救不了既存檔：** `seen` 為 in-memory 不持久化，coordinator 重啟後首輪會重建 baseline、既有檔仍不會因重啟觸發（`2026-06-12-…-design.md:101`）。

---

## 4. 範圍

### 4.1 In scope

- `bim-review-coordinator` 的 `GET /api/minio/objects`／`listMinioObjects`（資料夾語意的 list）。
- `web-viewer-sample` console 的 `#minio`（`MinioDataPage` / `buildMinioTree`）資料夾展開。
- `web-viewer-sample` console 的 `#conv`（`ConversionSchedulingPage` 的 MinIO 自動偵測面板）baseline 揭露文案與 `baseline_count` / `triggered_total` 區分呈現。

### 4.2 Out of scope

- **實際做 IFC→USD 轉檔引擎**（geometry/USD 產出由 `bim-streaming-server` 為 conversion authority；本 issue 只動 coordinator list API 與 console UI）。
- **改 watcher baseline 觸發語意**（首輪 baseline 不觸發、後續輪 new key/new etag 才觸發為 by-design，本 issue 不碰）。
- **新增「對既有 MinIO IFC 一鍵觸發轉檔」的專屬 UI/endpoint**（閉環 spec 非目標明文不新增手動插隊/佇列 UI；若要做須 spec 另案）。
- **watcher `seen` 索引持久化／重啟 watermark**（spec 已知限制，屬後續 change）。
- **改 `deriveIntakeFromKey` 本身的三段規約或 sanitize 語意**（它為 watcher 觸發設計、對 `.json` 判 malformed 是設計內行為）。
- **governance-service 的 `local_fs` file-library tree**（`GET /api/files/tree`，兩層 `storage/`）——與本 issue 要展開的真實雲端 `bim-control` bucket 是**不同來源**，不在本 issue 範圍（但見 §7 頁面歸屬釐清）。

---

## 5. 驗收條件（Acceptance Criteria）

> 採誠實鐵律：真資料、非 mock；user-facing 須有 browser E2E 證據（gstack/截圖）。

- [ ] **AC1：** `#minio` 樹頂層出現全部 **7 個專案資料夾**（含 `洲際好宅`/`測試建案0329`/`IOTTEST`/`Demo展示社區-1`/`測試建案0321`/`annotations`/`東勢區許良宇紀念圖書館`），不再只剩 1 個可解析專案 ＋「(未知專案)」桶。
- [ ] **AC2：** 527 個物件全部歸到其 key 路徑**實際所在**的專案/子資料夾，524 個幾何 `.json` 不再落「(未知專案)」桶；UI 不再用 `deriveIntakeFromKey` 是否 `ok` 當分組鍵。
- [ ] **AC3：** 每個物件仍標 role（`source_ifc`/`parsed_usdc`/`other`），且 role 與「能否解析成 intake 三段」**脫鉤**；`.ifc` 標 `source_ifc`、`.json` 標 `other` 不變。
- [ ] **AC4：** `#minio` 完整顯示原始 key（所有層、中文可見），**無寫死/示意樹偽裝真資料**（沿用 `minio-fileserver-source` spec 的 loading/error/empty/populated 四態誠實守門）。
- [ ] **AC5：** `#conv` 面板清楚標示「**baseline 既有檔不會自動轉換**」：分別呈現 `baseline_count` 與 `triggered_total`，並對 baseline 既有 `model.ifc` 標註原因（首輪被當基準吸收）。
- [ ] **AC6：** `#conv` 提供下一步指引文案：列出 spec 認可的兩條補救（重新上傳改 etag 自動觸發／走 `POST /api/external/ifc-ready` 手動 webhook intake），並誠實標明目前無一鍵觸發 UI（`NOT BUILT`）。
- [ ] **AC7：** watcher 觸發語意**零變更**：baseline 不觸發、後續輪新 key/新 etag 才觸發的行為與既有 spec/程式碼一致，不因本 issue 改動。
- [ ] **AC8：** browser E2E 證據：截圖顯示 `#minio` 7 個專案資料夾展開 ＋ `#conv` baseline/triggered 區分文案，符合誠實鐵律。

---

## 6. 既有測試衝擊（先量再改）

- `web-viewer-sample/src/console/MinioDataPage.test.tsx`、`console.test.tsx` — 改 `buildMinioTree` 分組語意會動到既有斷言，須同步更新。
- `bim-review-coordinator/tests/`（`conversion-records-route` 等）— 若改 `listMinioObjects` 回傳形狀須補/改測。
- `web-viewer-sample/e2e/minio-closed-loop.spec.ts` — E2E 斷言要對齊新樹結構與 `#conv` 文案。
- 提交前：coordinator 跑 `npm run verify`（`build && test`）；web-viewer 注意 `npm run build`＝vite **不跑 tsc**，須另跑 `npx tsc --noEmit`。

---

## 7. Open Questions（**進實作 plan 前必須拍板**）

1. **資料夾列舉方式：** 真實 `bim-control` bucket 用 S3 `Delimiter='/'`（`CommonPrefixes`）逐層列資料夾，還是用 `key.split('/')` 前綴切層？四份 spec 對真實 bucket 端只規定 watcher 平掃 ＋ 顯示完整 key 字串/三欄拆解（follow-up），**沒有 delimiter-based folder 列舉的權威定義**——folder 展開屬 spec 之外的新設計，須先決策。
2. **非 IFC 物件如何呈現：** 幾何 `.json`、`geometries_chunks/chunk_*.json` 在 folder 視圖該如何呈現/標註？spec **完全沒定義**這類物件的角色與展示方式；目前只決定 `role=other`，是否要進一步分類/摺疊/隱藏未定。（`洲際好宅` 一個專案就 316 個 chunk，全展開可能很吵）
3. **是否新增「對既有 MinIO IFC 手動觸發轉檔」入口：** spec 現況為「無專屬 UI/endpoint」且閉環 spec 非目標明文不新增手動佇列 UI。若使用者要真的轉既有 3 個 `model.ifc`，需明確指示走「重新上傳改 etag」或「手動打 `POST /api/external/ifc-ready`」，或另案開 spec 加入口。
4. **權威序提醒（兩層/三層規約打架）：** `openspec/changes/minio-watch-key-structure/` 是 **active change delta（尚未 archive）**；live `openspec/specs/minio-watch-auto-intake/spec.md:14` 仍寫舊的「恰兩層」規約。實作資料夾展開時以 active change delta（≥3 段、含動態中間層）為準——**需確認本 issue 落地前該 change 是否已 archive**，以免兩層/三層規約打架。
5. **`#minio` 頁面歸屬釐清：** spec 文字上把 `#minio`（`MinioDataPage`）綁的是 governance-service 的 `local_fs` file-library tree（`/api/files/tree`，兩層 `storage/`）；但 **live `#minio` 實際打的是 #254 新增的真實 bucket raw list（`/api/minio/objects`，count=527）**——這條 raw list **不在那四份 spec 內**。兩來源同頁會語意混淆，需先釐清頁面歸屬（單頁雙來源？拆頁？spec 補述？）。

---

## 8. Spec / 程式碼引用（citations）

**spec（權威定義）**
- `openspec/changes/minio-watch-key-structure/specs/minio-watch-auto-intake/spec.md:7` — 真實 bucket key 規約：≥3 段、頭=專案/倒二=種類/末=版本、中間層動態忽略
- `…/spec.md:11-16` — 新物件自動觸發 Scenario：唯有 baseline 後出現的新 `model.ifc` 才觸發
- `…/spec.md:17-20` — malformed 判定：未湊齊三段/空段/純點段
- `…/spec.md:22-25` — 首輪 baseline 不爆量 Scenario：首輪只登記 seen、不觸發
- `openspec/specs/minio-watch-auto-intake/spec.md:8` — env opt-in、首輪只登記 baseline、後續輪新 key/新 etag 才觸發
- `openspec/specs/minio-watch-auto-intake/spec.md:14` — 被取代的舊「恰兩層」規約（權威序提醒）
- `openspec/specs/minio-watch-auto-intake/spec.md:18-22` — 首輪 SHALL NOT 觸發既有物件
- `docs/superpowers/specs/2026-06-22-minio-watch-key-structure-design.md:24, 27-28, 38-41` — 三段錨點、UI 須完整顯示原始 key、中間層保留供顯示
- `docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md:28, 53-54, 101` — 首掃 baseline 不觸發為刻意取捨；補救=重新上傳改 etag / 手動 webhook intake；無一鍵觸發 UI；seen 不持久化
- `docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md:24, 25, 42, 84-88` — `#minio` 待補真實 bucket list、期望呈現三層+role；觸發唯一路徑=watcher；非目標=不新增手動佇列 UI
- `openspec/specs/minio-fileserver-source/spec.md:6-8, 54-56` — local_fs file-library 兩層 `storage/`；`#minio` 四態誠實守門（另一來源）

**程式碼（現況印證）**
- `bim-review-coordinator/src/services/minioClient.ts:36-39` — `ListObjectsV2` 無 `Delimiter` → 遞迴列全部葉物件
- `bim-review-coordinator/src/services/minioClient.ts:40-61` — 無條件 push 不過濾 keySuffix；role 由副檔名定；`d.ok=false` 時三欄寫 null
- `bim-review-coordinator/src/services/minioWatcher.ts:84-86` — `deriveIntakeFromKey` 不以 keySuffix 結尾即 `ok:false`
- `bim-review-coordinator/src/services/minioWatcher.ts:368, 380, 384-387, 388-398` — 候選 `.filter(endsWith keySuffix)`；首輪全寫 seen 不觸發；後續輪 `prev===etag` continue；`triggered_total` 僅 `triggerIntake` 成功 +1
- `bim-review-coordinator/src/app.ts:1226-1232` — `GET /api/minio/objects` 把 `config.minioWatchKeySuffix` 原樣傳入
- `bim-review-coordinator/src/config.ts:419` — `minioWatchKeySuffix` 預設 `/model.ifc`
- `web-viewer-sample/src/console/pages.tsx:1157-1170, 1237-1273` — `buildMinioTree` 用解析欄位當分組鍵、null fallback「(未知專案)」；無 key 路徑切資料夾邏輯

---

## 9. 下一步

1. **拍板 §7 open questions**（至少 OQ1 列舉方式、OQ2 非 IFC 呈現、OQ4 規約 archive 狀態、OQ5 頁面歸屬）。
2. 決策後用 `superpowers:writing-plans` 產出 `docs/superpowers/plans/2026-06-24-minio-folderview-and-baseline-disclosure.md` 逐 task 實作 plan（TDD、先量 baseline）。
3. 依 `superpowers:subagent-driven-development` 執行；user-facing 變更跑 gstack browser E2E 取證（隔離 branch stack）。

> 若要直接開成 GitHub issue：本檔 §1（背景）+ §2.4/§3.4（提案）+ §5（AC）+ §7（open questions）即為 issue body 主體。
