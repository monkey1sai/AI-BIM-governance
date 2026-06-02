# Design — governance-rule-run-service (A1)

## 定位與來源轉述（in-repo authority per 紅隊 R7）

外部設計參考（`C:/Repos/design/bim-desigin-arich/` 的 `roadmap-data.jsx` RM_APPS A1 與 06 redesign spec）**非 repo-tracked**，故將載重部分轉述於此，讓實作與審查對齊 in-repo artifact：

- **RM A1 摘要**：把業主交付要求 / 公司 BIM 規範 / buildingSMART IDS 變成可被電腦執行的規則集，自動跑出 governance score、failed elements、可指派 issue。schema：`rule_sets / rules / rule_runs / rule_results`。API：建 rule set、對 model version 跑規則、讀 failed、把 failed 傳 highlight。MVP：上傳後自動跑、每個 failed 有 `ifc_guid`、completed conversion 時可查 `usd_prim_path`、可在 3D highlight、可一鍵建 issue。
- **誠實 caveat（紅隊整合）**：
  - L4 證據只證明 **parse 基底**（ifcopenshell 枚舉 7011 構件 guid/type/name），**非**規則檢核；規則引擎的 Pset/空間萃取 + 計分為本 change 新建並以 pytest 對真實模型證明。
  - `ifctester` / IDS-XML **未安裝**；MVP 用純 `ifcopenshell` predicate，IDS 匯入為 p1（待 `pip install ifctester` + smoke 證據）。
  - BCF 匯出為 p15（`bcf` 模組未安裝 + LGPL 閘門）。
  - `governance-service` 是**新增 capability**，非既有 `AGENTS.md` 邊界；以本 OpenSpec change 正式提出，UI 在 spec 落地前標 p1。
  - 1-element identity smoke mapping 僅可驗 JSON 形狀，不可當真模型 `guid_exact` 覆蓋率。

## 跨 repo 資料流與控制流

```
瀏覽器 (web-viewer-sample)
  │  只打 :8004
  ▼
bim-review-coordinator (:8004)  ── /api/governance/* proxy（loopback 轉發）──►  governance-service (127.0.0.1:49102)
  │                                                                                │ 唯讀解析真實 IFC（ifcopenshell, CPU）
  │ session / intake / callback（不變）                                            │ 套規則 → rule_runs / rule_results (SQLite)
  ▼                                                                                │ 可選 join element_mapping.json（conversion 產出）
bim-streaming-server (:49101 conversion authority, 不變)  ───────────────────────►  唯讀消費 element_mapping.json
```

- 控制流：瀏覽器 → coordinator proxy → governance-service（POST rule-run 取 `rule_run_id`，poll 狀態，讀 results，匯出 Excel）。
- governance-service 唯讀讀 IFC 與既有 `element_mapping.json`；不轉檔、不寫 USDC。

## Source-of-truth 歸屬

| 資料 | 權威 owner |
|---|---|
| rule_runs / rule_results / score | `governance-service`（SQLite） |
| 規則定義（rule set / rules） | `governance-service`（版本化 `rules/*.yaml`；完整 schema 含 `rule_sets`/`rules` 表，MVP 由檔案來源） |
| `ifc_guid` ↔ `usd_prim_path` mapping | `bim-streaming-server` conversion authority（governance 唯讀消費） |
| session / intake / callback | `bim-review-coordinator`（不變） |
| 真實 IFC 來源 | 外部 IFC Worker / 落地 storage（唯讀） |

## 責任分離

- **runtime state**（Kit/WebRTC）：`bim-streaming-server`，與本服務無關。
- **metadata / 控制面**：`bim-review-coordinator`，本 change 僅 additive proxy。
- **rule-run 持久化**：`governance-service` 自有 SQLite，不污染 coordinator 資料。
- **browser UI**：`web-viewer-sample`（後續 change 2 的 Rule Center / Issues 語意驗收頁）。

## 儲存 schema（目標完整版）

```
rule_sets(id, project_id, name, version, source_type[ifcopenshell_yaml|ids_xml], status, created_at)
rules(id, rule_set_id, rule_code, target_ifc_type, severity, definition_json)
rule_runs(id, model_version_id, ifc_source_path, rule_set, status[queued|running|succeeded|failed], started_at, finished_at, score, summary_json)
rule_results(id, rule_run_id, ifc_guid, usd_prim_path, rule_code, severity, status[pass|fail|error], message, evidence_json)
```

MVP 持久化 `rule_runs` / `rule_results`；規則定義來自版本化 YAML（`rule_sets`/`rules` 表為目標完整 schema，後續以 IDS-XML 匯入時填充）。

## 驗證策略與環境限制

- **單元（合成模型，毫秒級、確定性）**：以 `ifcopenshell` 建 2 門（1 有/1 缺 FireRating）+ 2 牆（1 有名+在樓層/1 無名+未指派），斷言 pass/fail、Pset 值真的被讀到、每個 fail 有可解析 `ifc_guid`。
- **真實 IFC（紅隊 R2 載重證明）**：對 main workspace `storage/fixture-bytes.ifc`（IFC4X3、7126 構件）跑規則，證明真模型 Pset / 空間萃取；CPU-only ~6s，無 GPU。實測 score 99.0、failed 71（含真實玻璃前門缺 FireRating）。
- **API E2E（FastAPI TestClient）**：POST→背景執行→poll→results→Excel；誠實檢查（每個 failed 有 `ifc_guid`、`/health` ifctester=false、BCF 匯出 501）。
- **環境**：必走 host-native `C:\Program Files\Python312\python.exe`（具 ifcopenshell 0.8.5）；不需 WSL/Docker/GPU。
- **evidence**：`docs/evidence/governance-rule-run-pass/2026-06-02/`（summary JSON + sample xlsx；真實 IFC 不 commit）。
