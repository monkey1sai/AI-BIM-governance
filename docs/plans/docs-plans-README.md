# docs/plans 入口（docs-plans-README）

> v1 · 2026-07-10 · AI-coding 文件體系重設計（依使用者指令，以兩份 prototype 為基準）

## §0 一句話定位

本目錄的唯一目的：驅動 AI coding agent 把產品推進到兩份 prototype HTML（`ai-bim-governance-prototype.html`、`ai-bim-geo-viewer-prototype.html`）所示樣貌；唯一成功標準＝更快、更正確、絕不說謊。

> 2026-07-10 使用者授權全面重建（含原禁重建的互動實作規格）；舊體系見 git history。六份舊檔已於 2026-07-13 刪除（驗證閘五條全過，紀錄見《審批報告-docs-plans-AI-coding重設計-2026-07-10.md》）。

## §1 三類地圖

核心檔按「壽命」分三類加一個佇列，各回答一個問題，結構上無法互相矛盾：

| 類別 | 檔 | 回答什麼問題 | 過期時改哪份 |
|---|---|---|---|
| TRUTH（現況） | `TRUTH.md` | 現在建到哪（全體系唯一可寫建成狀態的檔） | 每次產品 PR 就地改寫；可整檔拋棄重生 |
| TARGET（目標） | `TARGET-contracts.md`、`TARGET-shell.md`、`TARGET-viewer.md` | 要做成什麼樣（永不含現況宣稱） | 改版＝bump 該節凍結點＋明示作廢範圍 |
| PROCESS（紀律） | `PROCESS.md` | 怎麼做才不出事、怎麼驗收 | 罕變；就地改寫 |
| BACKLOG（佇列） | `BACKLOG.md` | 下一個最有價值的格子；哪些決策還開著 | 完成＝刪列（不打勾疊層） |

## §2 讀取路線

| 情境 | 讀什麼 |
|---|---|
| 第一次進 repo | 本檔 → `TRUTH.md`（合計約 200 行） |
| 動任何 code 前 | ＋`TARGET-contracts.md` §1–§5（凍結面/enum/埠/路由/Prov） |
| 做某頁任務 | `BACKLOG.md` 找 gap 列 → `TARGET-shell.md` 對應節（或 `TARGET-viewer.md`）→ 節內標注引用的 contracts 段 → `PROCESS.md` 驗收 → prototype 對應頁錨（視覺錨） |
| 查「X 建了沒」 | `TRUTH.md` 單檔（建成狀態一律查 TRUTH，別處不作答） |
| 選下一件事 / 查 OPEN 決策 | `BACKLOG.md` 單檔 |
| SaaS / A4–A10 願景 | 不在必讀路徑；從本檔 §6 非必讀區起跳 |

任務路徑固定為「BACKLOG 列 → TARGET 節＋prototype 錨 → contracts 引用段 → PROCESS 驗收」。

**動線成本聲明**：首次進 repo 接第一個任務＝本檔→TRUTH→contracts §1–§5→BACKLOG→TARGET 節→PROCESS→prototype 錨，約 6–7 段定向閱讀（一次性成本）；後續任務固定 3 跳（BACKLOG gap 列 → TARGET 節＋prototype 錨 → PROCESS 驗收；全域不變量已由 TARGET 節內 contracts §N 錨帶出，不需另行通讀）。

## §3 效力（全文三條，不再有第四條）

1. **使用者最新明確指令 > 本目錄一切文件。**
2. **三類正交、各唯一**：現況問 TRUTH；需求問 TARGET-*（視覺細節以兩份 prototype HTML 為錨；原型內部不一致以 TARGET-shell §0 裁決為準）；紀律問 PROCESS。同類主題只有一檔，跨檔效力序不存在，「哪份為準」問不出來。發現矛盾＝bug：直接改正本、同 PR 刪被取代文字；**禁止**增補層/禁寫清單/勘誤表/裁決帳四種寫法再現（出現＝review 直接退回）。
3. **repo code＋tests＝現況行為權威**（TRUTH 與 code 不符＝TRUTH 的 bug，改 TRUTH）；TARGET＝目標權威（code 未達 TARGET＝缺口，登 BACKLOG）；saas-*、審批報告-*、已刪舊檔的 git 歷史一律無效力。

## §4 prototype 地位

- 兩份 `.html` 是**產品樣貌的唯一真相基準**：不修改、只引用（TARGET-* 以頁錨指向）。
- 它們是**需求原型，非程式碼範本**：其 canvas 引擎、示意數值、CDN 外連絕不可照抄進產品 code。
- 原型內部不一致之處，以 `TARGET-shell.md` §0.3 裁決表為準（6 裁＋2 OPEN；無 repo 事實者進 BACKLOG OPEN，不偷渡）。

## §5 檔案清單與行數預算

| 檔 | 角色 | 行數上限 |
|---|---|---|
| `docs-plans-README.md` | 入口：讀什麼、怎麼讀 | 200 |
| `TRUTH.md` | 現況帳本 | 260 |
| `TARGET-contracts.md` | 全域凍結契約（一字不差搬運區，改動需使用者授權） | 420 |
| `TARGET-shell.md` | 殼層 22 route 垂直切片規格（route 所屬 IX 21 張全文、API 逐字） | 950 |
| `TARGET-viewer.md` | viewer 七區塊 IA＋M4 驗收＋IX-3D 5 張 | 360 |
| `BACKLOG.md` | prototype-first 缺口排序＋OPEN 決策 | 220 |
| `PROCESS.md` | 工程紀律 / DoD / 驗收 / 防腐三閘 | 320 |

本表為 CI 行數 gate 的**目標依據**（agent-doc-context-budget）；現行 CI 尚未對 docs/plans 7 檔設行數斷言（`test-agent-governance-check.ps1` 僅涵蓋 AGENTS.md/CLAUDE.md），接線為 `BACKLOG.md` OPEN 待授權項。

## §6 非必讀區索引（keep 原地檔）

**SaaS 六檔**——效力聲明：全 PLANNED · tenant zero 為現況 · 效力低於 TARGET-contracts · 不在 AI coder 必讀路徑。11 項待簽核清單見 `ai-bim-governance-saas-架構總覽.md` §8 與 `審批報告-docs-plans-SaaS改版-2026-07-06.md` §5。

| 檔 | 角色 |
|---|---|
| `ai-bim-governance-saas-架構總覽.md` | 雲地混合總綱 |
| `ai-bim-governance-saas-租戶與身分.md` | 租戶模型 / 隔離 / 身分 |
| `ai-bim-governance-saas-GPU經濟與計量計費.md` | GPU 物理×商業模型 |
| `ai-bim-governance-saas-公開API與標準對齊.md` | /v1 物理分離＋標準對齊 |
| `ai-bim-governance-saas-合規資料主權與生命週期.md` | 信任視角主檔 |
| `ai-bim-governance-saas-遷移路線與里程碑.md` | SaaS-M1~M8 唯一詳規源 |

注意：凍結契約唯一效力本＝`TARGET-contracts.md` §1（13 條＋4 筆 approved exceptions；除 session enum 更正外自舊手冊 §1/§1.1 逐字搬運，byte-diff 校對紀錄見《審批報告-docs-plans-AI-coding重設計-2026-07-10.md》）；`ai-bim-governance-saas-公開API與標準對齊.md` §1.3 與舊手冊 §1 的複本均為歷史快照，無效力。

**審批報告**（`審批報告-*.md`，含本輪 AI-coding 重設計報告）：歷史審批紀錄，無效力；活的裁決結論已內化進 TARGET/BACKLOG（原文見各報告與 git history）。

**`nvidia-cosmos-diagram.jpg`**：歷史圖資產（原引用文件《開發軌跡》已刪除，git history 可考）。

## §7 舊檔 → 新歸屬對照（斷鏈救援）

下列六份舊檔已於 2026-07-13 刪除（驗證閘紀錄見《審批報告-docs-plans-AI-coding重設計-2026-07-10.md》）。歷史文件、舊 PR、舊 spec 若引用到舊檔，依本表改讀其去向；原文見 git history。

| 舊檔 | 主要去向 |
|---|---|
| `ai-bim-governance-互動實作規格與標準對齊.md` | `TARGET-contracts.md` §4/§7/§9；route 所屬 IX 21 張 → `TARGET-shell.md`；IX-3D 5 張 → `TARGET-viewer.md` §6；IX-TN 4 張 → `TARGET-contracts.md` §12 |
| `ai-bim-governance-開發軌跡與執行計畫.md` | `TARGET-contracts.md` §6/§7/§10；A1–A3 規格 → `TARGET-shell.md` 對應節；M0–M8 語彙 → `TARGET-viewer.md` §1.3；仍有效的執行缺口排序 → `BACKLOG.md`（舊逐輪軌跡見 git history） |
| `ai-bim-governance-設計規格.md` | `TARGET-contracts.md` §5/§6/§9；per-page 視覺 → `TARGET-shell.md` 各節＋prototype 錨；資料存放事實 → `TRUTH.md` |
| `ai-bim-governance-實作紀律與技術債防線.md` | DoD／長壽紀律／檢查表 → `PROCESS.md` §2/§4/§5；現況事實類防線 → `TRUTH.md` |
| `ai-bim-governance-design-system-對齊矩陣.md` | 現況裁決 → `TRUTH.md`；別名／保留頁 → `TARGET-contracts.md` §4；缺口 → `BACKLOG.md` |
| `ai-bim-governance-前端對齊DS-保留後端-實作手冊.md` | 凍結契約＋enum → `TARGET-contracts.md` §1/§2；per-route API → `TARGET-shell.md` 各節；驗收規約 → `PROCESS.md` §3；OPEN 項 → `BACKLOG.md` |

## §8 守恆規則（防復發）

1. 核心 7 檔行數預算（§5 表）**待接進** CI（沿用 agent-doc-context-budget 機制；接線為 `BACKLOG.md` OPEN 待授權項）；接線後任何 PR 使核心檔超限＝紅燈。
2. 新增第 8 個核心檔＝需使用者明確授權的邊界事件。
3. 增補層／禁寫清單／勘誤表／裁決帳四種寫法在 docs/plans 出現＝review 直接退回。
