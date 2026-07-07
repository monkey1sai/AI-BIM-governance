# Spec-3：A3 clash 碰撞偵測（ifcclash 官方路線）

> 日期：2026-07-07 · 狀態：使用者已核可設計
> 前置依賴：無硬依賴（可與 Spec-1 平行）；federation（A3 另一半）已建成。
> 現況更正：**clash 是「未開工」不是「阻塞中」**——governance-service 對 `clash`/`has_occ` 零命中，文件「卡 has_occ=False」描述的是 2026-06-23 本機 spike（未 push）。本 spec 從零建立。
> O6 已裁定（本 spec 核可即生效）：**引擎採 IfcOpenShell 官方 `ifcclash`**（PART C 第一候選；鐵律禁自寫 diff/clash 類演算法）。

## §1 Task 0 — 環境能力驗證（先驗再寫，硬 gate）

在 host-native governance Python 環境（`.venv`）驗證，**全部通過才進 §2**；任一失敗→回報並停，不得用降級實作充數：

1. `ifcclash` 可安裝可 import（安裝方式與版本記錄進 PR）。
2. 幾何能力可用：對 `storage/` 兩份真 IFC（270 圖書館等）跑最小 clash smoke，能產出結果或明確錯誤。
3. 若幾何鏈缺 OpenCASCADE 類依賴：記錄精確缺口（哪個 import、哪個 wheel），補依賴後重驗；**補不起來就停在 hard guard 狀態交付**（§3 引擎不可用 UX 仍屬有效交付物）。
4. 已知風險：host Py312 governance runtime 版本未收斂（repo 已知議題）；依賴衝突先回報再動，不擅自升降級既有套件。

## §2 後端（governance-service 新模組）

### 2.1 模組

新增 `governance-service/clash/`（`api.py`、`engine.py`、`store.py`），比照 `diff_engine`/`federation` 現有模式。`app.py` **僅允許 additive 加一行 include_router**（使用者核可本 spec＝該行解凍簽核；`app.py` 其餘禁改）。

### 2.2 引擎約束

- 以 `ifcclash` 官方 API 執行；不自寫 BVH/碰撞演算法。
- **has_occ / 引擎可用性 hard guard**（D-27）：啟動時偵測幾何能力，結果進 `/health`（誠實回報安裝狀態，比照 ifctester 現行做法）；引擎不可用時 clash-run 建立即回 `422`＋機器可讀原因，**絕不靜默回 0 碰撞**。
- **size guard**：輸入檔總大小或構件數超閾值（預設 80MB，可設定）→ 建立回應帶 `size_warning`，UI 需二次確認才跑（89MB 實測 >150s 的教訓）；執行有 timeout 上限，逾時=failed 附原因。
- clash run 為**非同步 job**（比照 rule-run：POST 建 run→輪詢），不可同步阻塞 HTTP。

### 2.3 API（全部 additive，經 coordinator proxy）

```
POST /api/governance/clash-runs
  { federated_set_id, pairs?: [{a_member, b_member}], tolerance? }
  → { clash_run_id, status: "queued", size_warning? }
GET  /api/governance/clash-runs/:id
  → { status: queued|running|succeeded|failed, engine: {available, reason?}, ... }
GET  /api/governance/clash-runs/:id/results?limit=&offset=
  → { items, total, limit, offset }   # 按嚴重度排序；item 含兩構件 ifc_guid、類別、嚴重度、位置
POST /api/governance/issues/from-clash-run/:runId { clash_ids[] }
  → 冪等鍵 = clash_run_id + clash_id（D4 共同出海口，比照 from-rule-run）
```

- 對象=已 build 成功的 federated set（成員 usd/ifc 路徑由 federation store 解出；set 未 build → 400）。
- envelope／enum 慣例照凍結契約（`{items,total,limit,offset}`；status 值域如上，前端逐字 echo）。
- coordinator proxy：若需逐路由註冊，`governanceProxy.ts` 允許 additive 加 clash 路由（比照 Spec-1 §2.4 條件式解凍）；不動任何既有路徑字串。

## §3 前端（`#a3` FederationPage 加 Clash Panel）

- 位置：build 成功的 federated set 詳情區，新增 Clash Panel（取代現行「clash 待建 · blocked-on-OCC」概念標）。
- **引擎不可用態**：顯「碰撞引擎不可用（缺 OCC）」＋`/health` 回報的原因，**禁顯 0 碰撞、禁假按鈕**——此態為一級 UX，不是錯誤頁。
- 執行流：跑 clash（IntentDialog 確認；有 `size_warning` 時對話框內明示預估風險）→輪詢→結果清單（嚴重度 Badge、兩構件 GUID）→勾選轉 Issue（冪等）。
- 未跑過=模式 6 空狀態；失敗顯可讀原因；證據型更新，禁樂觀更新。
- 3D 飛點高亮（點碰撞→viewer 飛至衝突點）屬 M4 之後：本輪 render **disabled · P1.5**＋掛鉤已登記 Spec-0 §2.2；未來沿用 `highlightPrimsRequest`（`source:"a3"`）。
- Prov：實跑出結果後 clash 區翻 `asbuilt`／`artifact`；引擎不可用態標 `asbuilt`（guard 本身是已建功能）。

## §4 明確不做

- 不自研碰撞演算法、不引入 ifcclash 以外的碰撞引擎。
- 不做 clash 規則集管理 UI（pair 選擇即最小版；規則集屬後續輪）。
- 不動 federation 既有 API/行為；不碰 `conversion_authority.py`。
- 不修改 `docs/plans/` 的「blocked-on-OCC」措辭（docs/plans 治理另案處理）；真相以本 spec 檔頭「未開工」記載為準。

## §5 驗收（DoD）

1. Task 0 驗證紀錄（安裝、smoke、能力結論）進 PR body。
2. pytest：engine guard（可用/不可用兩態）、size guard、run 生命週期、from-clash-run 冪等。
3. 真資料 E2E：`storage/` 兩份真 IFC 建 federated set→build→clash run→結果清單；**抽查 10 筆**（腳本輸出兩構件 GUID＋位置，人工可對）落 `artifacts/`；轉 Issue 成功且重跑不重複。
4. Playwright 截圖：結果清單態＋引擎不可用態（若環境可製造）＋size 警告對話框。
5. GitNexus impact／detect_changes；`app.py` diff 僅 include_router 一行。
