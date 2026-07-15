# docs/plans 入口（docs-plans-README）

> v4 · 2026-07-14 · 前端設計權威與 99% dual-gate 對齊

## §0 一句話定位

本目錄的唯一目的：把 `C:\Repos\design\desigin-system` 的前端設計輸入內化成可執行 TARGET 使用情境，並以 repo 內已鎖定的 manifest／golden screenshots 執行 99% design fidelity gate；成功仍必須同時滿足使用者可完成情境任務、runtime 結果可追溯，且絕不把設計示意數字當實測。

> 2026-07-10 使用者授權全面重建（含原禁重建的互動實作規格）；舊體系見 git history。六份舊檔已於 2026-07-13 刪除（驗證閘五條全過，紀錄見《審批報告-docs-plans-AI-coding重設計-2026-07-10.md》）。

## §1 三類地圖

核心檔按「壽命」分三類加一個佇列，各回答一個問題，結構上無法互相矛盾：

| 類別 | 檔 | 回答什麼問題 | 過期時改哪份 |
|---|---|---|---|
| TRUTH（現況） | `TRUTH.md` | 現在建到哪（全體系唯一可寫建成狀態的檔） | 每次產品 PR 就地改寫；可整檔拋棄重生 |
| TARGET（目標） | `TARGET-contracts.md`、`TARGET-shell.md`、`TARGET-viewer.md` | 要做成什麼樣：route 使用情境、行為、資料、3D/runtime 與驗收（永不含現況宣稱） | 改版＝bump 該節凍結點＋明示作廢範圍 |
| PROCESS（紀律） | `PROCESS.md` | 怎麼做才不出事、怎麼驗收 | 罕變；就地改寫 |
| BACKLOG（佇列） | `BACKLOG.md` | 下一個最有價值的格子；哪些決策還開著 | 完成＝刪列（不打勾疊層） |

## §2 讀取路線

| 情境 | 讀什麼 |
|---|---|
| 第一次進 repo | 本檔 → `TRUTH.md`（合計約 200 行） |
| 動任何 code 前 | ＋`TARGET-contracts.md` §1–§5（凍結面/enum/埠/路由/Prov） |
| 做某頁任務 | `BACKLOG.md` 找 gap 列 → `TARGET-shell.md` 對應節 → `TARGET-viewer.md` 的共享 3D/runtime 契約（若有 viewport）→ 節內標注的 contracts 段 → `PROCESS.md` dual-gate 驗收 → `design-system-reference.manifest.json` 的 screen/state golden 比對 |
| 查「X 建了沒」 | `TRUTH.md` 單檔（建成狀態一律查 TRUTH，別處不作答） |
| 選下一件事 / 查 OPEN 決策 | `BACKLOG.md` 單檔 |
| 做 A1–A10 任一情境 | 必讀 `TARGET-shell.md` 該 route；有 3D、overlay、camera、robot 或 runtime 的頁再讀 `TARGET-viewer.md` §8；最後依 manifest 的 `workspace.a<n>.default`／`concept.a<n>.default` screen 驗證 2D fidelity；舊 route PNG 只可補充理解歷史 IA，不是 coding 或 pass/fail 權威 |
| SaaS 願景 | 不在必讀路徑；從本檔 §6 非必讀區起跳 |

任務路徑固定為「BACKLOG 列 → self-contained TARGET 節 → contracts 引用段 → PROCESS 驗收 → tracked design reference visual gate＋獨立 operability/runtime gate」。

**動線成本聲明**：首次進 repo 接第一個任務＝本檔→TRUTH→contracts §1–§5→BACKLOG→TARGET 節→PROCESS→manifest 對應 screen，約 6–7 段定向閱讀（一次性成本）；後續任務固定 3 跳（BACKLOG gap 列 → TARGET 節 → PROCESS 驗收；全域不變量已由 TARGET 節內 contracts §N 錨帶出，不需另行通讀）。

## §3 效力（全文三條，不再有第四條）

1. **使用者最新明確指令 > 本目錄一切文件。**
2. **三類正交、各唯一**：現況問 TRUTH；需求語意與 A1–A10 頁面 IA 問 self-contained TARGET-*；2D UX／視覺／互動位置以上游 `desigin-system` 與其 repo-pinned snapshot 為準（分工見 §4）；紀律問 PROCESS。同類主題只有一檔，跨檔效力序不存在。發現矛盾＝bug：直接改正本、同 PR 刪被取代文字；**禁止**在 7 核心檔或新平行需求源重建增補層／禁寫清單／勘誤表／裁決帳（適用邊界見 PROCESS §3）。
3. **repo code＋tests＝現況行為權威**（TRUTH 與 code 不符＝TRUTH 的 bug，改 TRUTH）；TARGET＝目標權威（code 未達 TARGET＝缺口，登 BACKLOG）；saas-*、審批報告-*、已刪舊檔的 git 歷史一律無效力。

## §4 設計權威、machine snapshot 與 durable 正本分工

- **Authoring authority**：`C:\Repos\design\desigin-system` 是唯讀的上游 2D UX、資訊架構、視覺 token、元件位置與互動狀態標準；不得由本 repo 回寫，也不得讓 CI 或 production runtime 依賴該絕對路徑。
- **Portable gate authority**：`design-system-reference.manifest.json`＋`design-system-baseline/` 是經明確 rebaseline 核准後的 tracked machine snapshot。manifest 綁定來源檔 SHA-256、screen/state、兩個 viewport、golden hash 與 fidelity contract；它們是支援 artifacts，**不是第八份人類需求正本**。
- **Durable behavior authority**：TARGET-* 定義 route、資料、API、enum、安全、權限、fallback 與 runtime lifecycle；上游設計不得覆寫 backend preservation contract。production `--ec-*` token 是上游 primitive→semantic→component 的受控投影，不是平行設計權威。
- **99% 定義**：Windows runner、Chromium、DPR 1、字型載入完成、動畫關閉、`1440×900`＋`1920×1080`；manifest 未宣告遮罩的像素差異率各自 `≤ 1%`，並且 navigation、primary actions、loading／empty／success／warning／failure／disabled／confirmation、i18n 與 runtime-truth 語意為 100%。沒有 approved screen/state 的 route 標 `reference_missing`，不得宣稱 99%。
- **雙閘獨立**：design fidelity pass 不等於功能完成；route/button/fixture/API/runtime ID/trace/network 仍須通過 operability gate。涉及 3D 時，live WebRTC frame 不作設計像素基準，仍須 Kit first-frame＋stage truth＋DataChannel/Kit ack 證據。
- **Legacy companions**：`ai-bim-governance-prototype.html`、`ai-bim-geo-viewer-prototype.html` 與二十張 route PNG 保留作歷史 IA、viewer 七區塊與 OpenUSD/runtime 互動 companion；不再作 production 2D pass/fail 或 coding API 權威。當中的日期、ID、百分比、分數、延遲、FPS、路徑與協定標籤皆為示意。

## §5 檔案清單與行數預算

| 檔 | 角色 | 行數上限 |
|---|---|---|
| `docs-plans-README.md` | 入口：讀什麼、怎麼讀 | 200 |
| `TRUTH.md` | 現況帳本 | 260 |
| `TARGET-contracts.md` | 全域凍結契約（一字不差搬運區，改動需使用者授權） | 420 |
| `TARGET-shell.md` | 殼層 22 route 垂直切片規格（含 A1–A10 情境、route 所屬 IX、API） | 950 |
| `TARGET-viewer.md` | viewer 七區塊 IA＋M4 驗收＋IX-3D＋A1–A10 viewport/runtime 共約 | 360 |
| `BACKLOG.md` | design-system-first 缺口排序＋OPEN 決策 | 220 |
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
| `ai-bim-governance-設計規格.md` | `TARGET-contracts.md` §5/§6/§9；per-page 2D 視覺 → manifest `route_inventory[]`／`screens[]`；TARGET-shell 保存行為與 IA；prototype 僅為 legacy companion；資料存放事實 → `TRUTH.md` |
| `ai-bim-governance-實作紀律與技術債防線.md` | DoD／長壽紀律／檢查表 → `PROCESS.md` §2/§4/§5；現況事實類防線 → `TRUTH.md` |
| `ai-bim-governance-design-system-對齊矩陣.md` | 現況裁決 → `TRUTH.md`；別名／保留頁 → `TARGET-contracts.md` §4；缺口 → `BACKLOG.md` |
| `ai-bim-governance-前端對齊DS-保留後端-實作手冊.md` | 凍結契約＋enum → `TARGET-contracts.md` §1/§2；per-route API → `TARGET-shell.md` 各節；驗收規約 → `PROCESS.md` §3；OPEN 項 → `BACKLOG.md` |

## §8 守恆規則（防復發）

1. 核心 7 檔行數預算（§5 表）**待接進** CI（沿用 agent-doc-context-budget 機制；接線為 `BACKLOG.md` OPEN 待授權項）；接線後任何 PR 使核心檔超限＝紅燈。
2. 新增第 8 個核心檔＝需使用者明確授權的邊界事件。
3. 7 核心檔或新平行需求源新增／延長增補層、禁寫清單、勘誤表、裁決帳＝review 直接退回；§4 的 manifest/baselines 是 machine supporting artifacts，§6 明列的 retained supporting/history、規則說明與移轉引用不因字詞命中誤判。
