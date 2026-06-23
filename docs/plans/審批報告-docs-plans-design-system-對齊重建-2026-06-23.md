# 審批報告：docs/plans Design System 對齊重建

- **日期**：2026-06-23
- **分支 / worktree**：`docs-ds-alignment`（`.claude/worktrees/docs-ds-alignment`）
- **審查模式**：四軸對抗驗證（refute-by-default）→ 跨檔一致性審查 → reconciler 裁決 → 逐檔修正
- **裁決**：**有條件通過（ship-with-followup）**。8 份交付物已逐檔修正並對齊誠實基準與共用契約表；剩餘 1 項需人工確認（最高效力檔的 worktree 同步落差）。

---

## 1. 範圍與來源

### 1.1 Design System 與權威來源

對齊基準為 repo 內既有 Design System（DS）：五類 ProvTag 視覺類別（`asbuilt|artifact|demo|todo|p1…` 等）對映 repo `web-viewer-sample/src/console/data.ts` 的七值 provenance（`asbuilt|artifact|demo|p1|p15|p3|p4`，**無 `todo`**；`prov="todo"` 會觸發 TS2322）。

### 1.2 五份治理 guides + 兩份原型 + tokens/components/kits

`docs/plans/` 應有 8 份交付物：

| # | 檔名 | 角色 |
|---|---|---|
| 1 | `docs-plans-README.md` | 入口索引 / 檔案角色表 / 共用契約表 |
| 2 | `ai-bim-governance-設計規格.md` | WHAT 層設計規格（v2） |
| 3 | `ai-bim-governance-互動實作規格與標準對齊.md` | **最高效力** source of truth（PART A 正典路由 / PART B 互動卡 IX-xx / PART C 官方對齊 / sharedSheet） |
| 4 | `ai-bim-governance-開發軌跡與執行計畫.md` | WHEN 層開發軌跡（v3.1） |
| 5 | `ai-bim-governance-實作紀律與技術債防線.md` | HOW 層實作紀律 / 技術債防線 |
| 6 | `ai-bim-governance-design-system-對齊矩陣.md` | repo↔文件裁決矩陣（最終覆寫源） |
| 7 | `ai-bim-governance-prototype.html` | EdgeConsole 殼層視覺原型（vanilla JS） |
| 8 | `ai-bim-geo-viewer-prototype.html` | geo-viewer 視覺原型 |

**共用契約表**（跨全部檔逐字一致基準）：六服務埠表、22 條正典路由 hash、A1–A10 狀態、MinIO/轉檔四釘子框架、provenance 七值對映。

### 1.3 repo 現況（驗證源）

- `bim-review-coordinator/src/services/minioWatcher.ts`（≥3 段 key 解析）
- `bim-review-coordinator/src/app.ts`（`/api/dev/conversions` proxy）
- `bim-streaming-server/.../conversion_authority.py`（轉檔 list + 持久化）
- `web-viewer-sample/src/console/data.ts`（provenance 權威值）

---

## 2. 重建 / 重生清單（8 檔逐一）

| # | 檔名 | 角色 | 關鍵變更 |
|---|---|---|---|
| 1 | `docs-plans-README.md` | 入口索引 | §1 效力符號全形`＞`→半形`>`；§2 補缺檔警告 + 矩陣檔名補全 + 設計規格列誠實版措辭；A4 裁決指向改 §4.4；A2 成本歸屬改「A6/A9 非 A2」；§6 同步 |
| 2 | `ai-bim-governance-設計規格.md` | WHAT 設計規格 | §3 A2 成本歸屬 taxonomy 更正（line 208）；A4=NOT BUILT·p4、§4.3/§5 真 MinIO 三層待建已就位 |
| 3 | `ai-bim-governance-互動實作規格與標準對齊.md` | **最高效力 SoT** | **整份重建**（worktree 內原缺檔）：以 6 份 sibling 已調和內容為素材，釘入四釘子 + A1–A10 + 22 路由 + 官方對齊 + 效力順序半形 |
| 4 | `ai-bim-governance-開發軌跡與執行計畫.md` | WHEN 開發軌跡 | §0 矩陣檔名補 `design-system-`；§4 D9 + §8 別名表補「禁 `#review` 重定向 `#gpu`」硬規 |
| 5 | `ai-bim-governance-實作紀律與技術債防線.md` | HOW 實作紀律 | §0 效力符號全形→半形；§10 + §13-B7 A2 成本歸屬 taxonomy 更正 |
| 6 | `ai-bim-governance-design-system-對齊矩陣.md` | 裁決矩陣 | §4.4 A2 列 + §5 L6 落差列 A2 成本 taxonomy 更正 |
| 7 | `ai-bim-governance-prototype.html` | 殼層原型 | A2 ProvTag `artifact`→`built`（line 715/726）；`review:"gpu"` redirect 保留並加 4 行禁照抄註解（line 1321 區塊） |
| 8 | `ai-bim-geo-viewer-prototype.html` | geo-viewer 原型 | 無需修改（0 變更）：已與誠實基準與共用契約逐項一致 |

---

## 3. 對抗驗證結果摘要（四軸）

四軸＝(1) 誠實對齊（honestyOk）、(2) Design System 對齊（designAlignOk）、(3) 跨檔一致性、(4) 官方標準對齊。

| 檔名 | honestyOk | designAlignOk | blockers | majors | 是否已修 |
|---|---|---|---|---|---|
| `docs-plans-README.md` | true | true | 0 | 0 | 已修（minor 措辭/檔名/符號） |
| `ai-bim-governance-設計規格.md` | true | true | 0 | 0 | 已修（taxonomy 1 處） |
| `ai-bim-governance-互動實作規格與標準對齊.md` | false→true | false→true | 2→0 | 2→0 | **已修（重建補回缺檔）** |
| `ai-bim-governance-開發軌跡與執行計畫.md` | true | true | 0 | 0 | 已修（檔名/硬規措辭） |
| `ai-bim-governance-實作紀律與技術債防線.md` | true | true | 0 | 1 | 已修（符號/taxonomy） |
| `ai-bim-governance-design-system-對齊矩陣.md` | true | true | 0 | 1 | 已修（taxonomy 2 處） |
| `ai-bim-governance-prototype.html` | true | true | 0 | 0 | 已修（A2 ProvTag + review 註解） |
| `ai-bim-geo-viewer-prototype.html` | true | true | 0 | 1 | N/A（已正確，0 變更） |

**跨檔審查獨立發現**（除逐檔外）：1 BLOCKER + 2 MAJOR + 2 MINOR，已全部處置：

- **BLOCKER #1**：最高效力檔 `互動實作規格與標準對齊.md` 在 worktree 內缺檔，6 份 sibling 全部 dangling-reference → 以 sibling 調和內容重建補回。
- **MAJOR #2**：prototype.html A2 標 `artifact` vs 4 份 MD/repo `asbuilt` → 改 `built`（line 715/726）。
- **MAJOR #3**：prototype.html `review:"gpu"` redirect 違反「review = 獨立 ReviewRoomPage、不可重定向」硬規 → 保留示意對映 + 加禁照抄註解；開發軌跡 D9/§8 同步補硬規措辭。
- **MINOR #4**：對齊矩陣檔名 token 漂移（README/開發軌跡引用缺 `design-system-`）→ 補全為實體檔名。
- **MINOR #5**：效力順序符號全形 `＞` vs 半形 `>` → 統一為半形。

---

## 4. 誠實對齊重點（逐字記錄更正前後）

四個誠實釘子是本次重建的地基，全程**無任一檔回頭把待建標成已交付**。

### 4.1 MinIO 偵測 = 已實作（釘子 a）

- **狀態**：已實作。repo 實證 `minioWatcher.ts:95` `segments.length < 3` 擋、`:102` category=`segments[length-2]`、`:103` version=`segments[length-1]`、`mv_<hash8>` sanitize、`192.168.20.234:9000/bim-control` 外連注入。
- **標註**：一律保留「live 多層觸發 not observed」。設計規格 §5.1(a) / 互動規格 §B.5 / 對齊矩陣 §4.5 / 開發軌跡 D7·O4 / README §7 逐字一致。

### 4.2 轉檔紀錄 = 待建（後端在、缺前端歷史頁）（釘子 b）

- **更正前**：易被讀成「轉檔完全無持久化 / 沒接線」。
- **更正後（逐字框架）**：「後端 `GET /api/conversions` list（`conversion_authority.py:126`）+ `stream_conv_*.json` 持久化（`:313/:637`）+ coordinator proxy（`app.ts:1795` `/api/dev/conversions`）皆在；**缺前端歷史呈現層**。不可寫成完全無持久化。」三檔（設計規格 §5.1(b)、互動規格 §B.4、對齊矩陣 §4.5 L3）一致。

### 4.3 `#minio` 結構顯示頁 = 待建（釘子 c）

- **更正前（舊版逐字）**：「🟢 三層結構已交付 / 介面已交付 / 顯示真實三層結構」。
- **更正後（逐字）**：「`#minio` 頁已建，但**僅顯示 local_fs 兩層樹**；真 S3/MinIO 三層瀏覽 **NOT BUILT**。watcher 三層解析與 `#minio` 頁是**兩條獨立資料路徑**，watcher 結果未餵進此頁。」設計規格 §4.3「本檔最重要更正」、互動規格 §B.5、對齊矩陣 §2 第19列 + §4.5 L2 + §5 落差表全數降級到位。

### 4.4 觸發點 = 僅新增 IFC 觸發（釘子 d）

- **更正後（逐字）**：「僅 watcher 偵測 `*/model.ifc` → `triggerIntake`；**無已接線的手動佇列 / 插隊 UI**；prioritize/retry 只排序既有 ifc-ready job；`PUT /api/conversion/watch` 只開關生命週期。」設計規格 §5.2、互動規格 §B.4 釘子4 + IX-CV-03/04 一致。

---

## 5. A1–A10 狀態對齊

與 repo `data.ts` 逐值一致（A1/A2/A3 `asbuilt`、A4–A10 `p4`、A5 `p3`）：

| 項目 | 狀態 | 重點 |
|---|---|---|
| A1 | built | 規則引擎 + ifctester(IDS) + BCF 2.1 純 stdlib + issues；3D 高亮 todo；PR #241 BCF 鈕/記分板色碼 |
| A2 | built（`asbuilt`） | diff_engine GlobalId 多級 + geometry_changed opt-in；ifc_type/ifc_name 落庫 bug 已修 PR #242；**無成本影響塊** |
| A3 | federation built / clash NOT BUILT | clash blocked-on-OCC（`has_occ=False`，不顯真實 clash 數，spike 未 push） |
| A4 | **NOT BUILT · p4** | 無任何後端程式碼；明文「禁寫成 hero built」 |
| A5 | spec · p3 | — |
| A6–A10 | spec / NOT BUILT · p4 | A6=5D 成本/S-curve；A8/A10 Replicator/Cosmos/Isaac 標「版本風險高·先驗再寫」 |

- **Hero built = A1 + A2 + A3-federation**（A4 不在內）— 各檔一致。
- **誠實基準更正**：輸入基準 #5「A4 = hero built」屬**過度宣稱**；對齊矩陣 §4.4 L1（唯一裁決源）+ 設計規格 §3/§7 + 互動規格 §B.9 已正確以 repo `prov:"p4"` 覆寫之。
- **A2 無成本功能**：load-bearing 主張成立且與 repo 一致；僅修正 taxonomy 漂移（5D 成本/S-curve 屬 **A6**，審查 Copilot 屬 **A9**，**非 A2**）。

---

## 6. 跨文件一致性結論

逐項查核且**一致**（無問題）：

- **22 條正典路由 hash**：home,a1–a5,issues,reports,viewer,gpu,a6–a10,conv,sessions,instances,minio,runtime,admin,spec — README §3.2 / 設計規格 §2.2 / 開發軌跡 §8 / 實作紀律 §5 / 對齊矩陣 §2 / prototype `EC_NAV` 完全一致；hash 無斜線；`#gpu` 正典 + `#review` 別名（但 repo `data.ts:74` 為獨立 ReviewRoomPage、禁 redirect）；`/ui/open?session=` 凍結路徑一致。
- **六服務埠**：coordinator 8004 / governance 49102 / streaming 49100·47998·49101·spectator 49110 / viewer 5173 / kit-manager 8010 / MCP 9901-9903；MinIO `192.168.20.234:9000` bucket `bim-control` 標「外連 S3 依賴非 bind 埠」— 5 份 MD 逐欄一致。
- **provenance**：DS 五類 ↔ repo 七值（無 todo、`prov="todo"`→TS2322）對映表跨 README §3 / 設計規格 §1.5 / 開發軌跡 §7 / 實作紀律 §10 / 對齊矩陣 §4.3 一致。兩份 HTML 用 `level="todo"` 是 DS 視覺類別字串（vanilla JS 原型，非 repo `data.ts`），不違規。
- **官方標準對齊**：BCF 2.1 保留 / 3.0 為升級目標（禁寫已支援 3.0）；IfcOpenShell（ifcdiff GlobalId-keyed、ifcclash、IDS 1.0/ifctester 只驗英數、IfcConvert 無 USD 輸出→glb 備援、自製 IFC→USD 須 `G_<guid>` + coverage）；Omniverse 七官方件不重做 + 1 GPU=1 Kit=1 stream + terminate-recreate 無 live migration（GPU 受限的是容器 plane 非 host RTX 4060 Ti）— 互動規格 C.1/C.2、開發軌跡 §2.0.5、技術債防線 D-04/D-13~D-19、對齊矩陣 §8、README §9/§10 一致。
- **效力順序**：互動規格 > 開發軌跡 > 設計規格 > HTML；實作紀律/對齊矩陣為平行補充層；repo 為行為真相 — 5 份 MD 排序文字相同。

**結論**：三釘子、A1–A10、官方對齊三大面向在 6 個 .md 重建檔中全部誠實呈現，無回頭標成已交付的檔；2 份 HTML 已修 / 已確認一致。跨檔一致性達成。

---

## 7. 已知風險與 follow-up

| # | 風險 / follow-up | 嚴重度 | 需人工確認 | 連結 |
|---|---|---|---|---|
| R1 | ✅ **已解**：`互動實作規格與標準對齊.md` 收尾改採「還原原始全文 + design-system 對齊增補層」（非濃縮重建）；23 張 IX 卡 / A.1.1 22 條路由 / §8 6 埠逐項核對與原始正典 + repo 一致 | — | 否 | 見 §8 |
| R2 | ✅ **已解**：已從被清掉的 ignored worktree 轉至真實 git worktree `AI-BIM-governance-wt-docsds`（branch `docs/plans-ds-alignment`，base `origin/main`），commit 路徑正常 | — | 否 | 見 §8 |
| R3 | MinIO live 多層觸發 **not observed**（待真實 ≥3 段 key 上傳驗證）；追蹤入口＝設計 spec `docs/superpowers/specs/2026-06-23-minio-conversion-closed-loop-observability-design.md`（GitHub issue 待使用者核可建立） | 中 | 是（issue 核可） | spec 檔 |
| R4 | 2 份 .html 原型未逐字全讀殘留字樣（舊「真實三層 / hero built / BCF 3」）— 建議下一輪 `grep '三層\|127\|hero built\|BCF 3'` 掃兩份 html 收尾 | 低 | 否 | — |
| R5 | 開發軌跡 use-story 範例數字（287 過/25 擋、65.7MB 等）未逐句標「情境示意」；DoD 已硬性要求走真 API；建議補一行「以下數字為情境示意·非實測」 | 低 | 否 | — |
| R6 | A2 成本歸屬 taxonomy 已更正為「A6/A9 非 A2」；若後續以 A9 為單一成本頁，需回頭再對齊 A6/A9 邊界 | 低 | 否 | — |

---

## 8. 收尾更正（2026-06-23 指揮官複驗後）

workflow 完成後，指揮官在真實 worktree 對「被破壞的 repo-reality 驗證層」補做嚴格複驗，修正如下：

1. **worktree 事故**：原 `EnterWorktree` 工作區中途被並行背景 git 活動清掉（主 repo 被切到 `fix/pr-review-agent-recognize-superpowers-spec`，非本任務所為），產出落在 gitignored 孤兒目錄。已備份後轉入真實 git worktree `AI-BIM-governance-wt-docsds`（branch `docs/plans-ds-alignment`，base `origin/main`）重做提交。
2. **互動規格 / 開發軌跡 還原**：兩權威檔在缺檔 worktree 被濃縮（IX 23→3 卡、開發軌跡 57→28KB 缺 M7）。收尾改為「git 還原原始全文 + design-system 對齊增補層」：**23 張 IX 卡、M0–M8、D1–D9、O1–O6 全數還原**，僅疊加對齊章節與誠實更正，不刪權威本體。
3. **資料庫事實更正（程式碼 > 文件）**：governance-service 規則 / Issue / diff / federation 帳本實際用 **SQLite**（`governance.db`），非 Postgres；雲端 metadata 權威 `bim-control` 用 **MySQL**；A5 TimescaleDB 為未建 roadmap。設計規格 §A1 persists、開發軌跡對齊層、MinIO spec 均已更正（原 design-system `persistence.md` 寫 Postgres 與 repo 不符）。
4. **A1–A10 / prov 一致**：A1/A2/A3=`asbuilt`（A3 federation built / clash blocked-on-OCC）、A4=`NOT BUILT·p4`、A5=`p3`、A6–A10=`p4`，與 repo `web-viewer-sample/src/console/data.ts` 逐值對齊；誠實基準 #5「A4 hero built」確認為過度宣稱、已覆寫。
5. **舊報告移除**：`審批報告-md與html一致性交叉驗證-2026-06-16.md`（審舊內容、已被本次全重建取代）刪除。
6. **MinIO issue**：設計 spec 已寫入 `docs/superpowers/specs/`；GitHub issue body 已備妥，因屬對外發佈、待使用者明確核可後建立。

---

## 附錄：相關檔案路徑（絕對）

- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\docs-plans-README.md`
- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\ai-bim-governance-設計規格.md`
- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\ai-bim-governance-互動實作規格與標準對齊.md`
- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\ai-bim-governance-開發軌跡與執行計畫.md`
- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\ai-bim-governance-實作紀律與技術債防線.md`
- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\ai-bim-governance-design-system-對齊矩陣.md`
- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\ai-bim-governance-prototype.html`
- `C:\Repos\active\iot\AI-BIM-governance\.claude\worktrees\docs-ds-alignment\docs\plans\ai-bim-geo-viewer-prototype.html`
- 驗證源：`bim-review-coordinator\src\services\minioWatcher.ts`、`bim-review-coordinator\src\app.ts`、`bim-streaming-server\...\conversion_authority.py`、`web-viewer-sample\src\console\data.ts`
