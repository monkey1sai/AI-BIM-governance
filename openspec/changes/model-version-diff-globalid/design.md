# Design — model-version-diff-globalid (A2)

## 跨 repo 資料流

```
瀏覽器 (console VersionDiffPage)
  │ 只打 :8004
  ▼
bim-review-coordinator (:8004)  ── /api/governance/diffs* proxy（loopback）──►  governance-service (127.0.0.1:49102)
                                                                                  │ 唯讀開兩份 IFC（ifcopenshell, CPU）
                                                                                  │ 多級對齊 + 分類 → model_diffs/items (SQLite)
```

## 多級對齊演算法（roadmap A2 S1·W1）

1. **IFC GlobalId**（exact）— 主鍵。
2. **Tag**（Revit ElementId 常存於此，作 source element id）。
3. **ifc_type + Name + 取整 placement 位置** hash。
4. geometry hash fallback — **p1，MVP 不做**（需 tessellation）。

比較訊號：
- **moved**：`ifcopenshell.util.placement.get_local_placement` 取世界平移，delta > tol。
- **property_changed**：`get_psets` 正規化後 sha1（排除 internal id）；與幾何/位置 **獨立**（避免 hash 衝突誤判，roadmap risk）。

## Source-of-truth 歸屬

| 資料 | 權威 owner |
|---|---|
| model_diffs / model_diff_items | `governance-service`（SQLite governance.db） |
| ifc_guid（對齊主鍵） | IFC 來源（唯讀） |
| usd_prim_path | conversion authority（未對映 null；本 MVP 不 join） |

## 責任分離

diff 為重 CPU，跑在 governance-service 獨立 process（非 Kit thread）；coordinator 僅 additive proxy；前端只顯示，不保存權威。

## 儲存 schema

```
model_diffs(id, base_model_version_id, target_model_version_id, base_ifc_path, target_ifc_path, status[queued|running|succeeded|failed], started_at, finished_at, summary_json)
model_diff_items(id, model_diff_id, change_type[added|removed|moved|geometry_changed|property_changed], ifc_guid, base_usd_prim_path, target_usd_prim_path, change_summary, evidence_json)
```

## 驗證策略與環境限制

- **單元（合成，確定性）**：base（W-A 在原點、W-B）vs target（W-A 移動 10m + pset 改、W-C 新增、W-B 移除）→ 斷言 added=1 / removed=1 / moved=1 / property_changed=1 / matched=1。
- **真實 identity round-trip（誠實揭露）**：storage 內 `許良宇*.ifc` 13 個變體彼此 **byte 完全相同**（同一 SHA1）。故 `許良宇圖書館建築_2026.ifc` vs `轉檔測試2.ifc` 為 identity 檢查，只證明 GUID 多級對齊在真實 7139 元素規模能找到「全部匹配、0 變更」（matched>7000、removed=added=0、計數一致）。**不是**變更分類測試。
- **真實模型變更分類**：開兩份真實 IFC、把其中一份 **in-memory 修改**（位移 8 元素 + 加屬性 8 元素）→ 斷言 diff 在真實 IFC4X3 模型偵測到 `moved>0` 與 `property_changed>0`（test_real_model_modified_classification）。這才是真模型分類證據。CPU ~26s。
- **合成（確定性，全分類）**：added=1 / removed=1 / moved=1 / property_changed=1 / matched=1。
- **API E2E（TestClient）**：合成 IFC 寫檔 → POST /api/diffs → poll → items → apply-overlay 501。
- **環境**：host-native `C:\Program Files\Python312\python.exe`（ifcopenshell 0.8.5 + numpy）；不需 GPU。
