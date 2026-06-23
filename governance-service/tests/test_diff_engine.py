"""A2 diff 引擎驗證 — 合成（確定性）+ 真實版本對（GUID 多級對齊證明）。"""
from __future__ import annotations

import os
import sqlite3
import tempfile

import ifcopenshell
import ifcopenshell.guid
import pytest

from diff_engine import open_model, run_diff, run_diff_on_paths
from diff_engine.store import DiffStore
from diff_engine.models import DiffItem, DiffResult

_GA = ifcopenshell.guid.new()
_GB = ifcopenshell.guid.new()
_GC = ifcopenshell.guid.new()

BASE_IFC = r"C:\Repos\active\iot\AI-BIM-governance\storage\許良宇圖書館建築_2026.ifc"
TGT_IFC = r"C:\Repos\active\iot\AI-BIM-governance\storage\許良宇圖書館建築_2026 - 轉檔測試2.ifc"


def _wall(f, name, xyz, guid, status=None):
    pt = f.create_entity("IfcCartesianPoint", Coordinates=tuple(float(v) for v in xyz))
    ax = f.create_entity("IfcAxis2Placement3D", Location=pt)
    plc = f.create_entity("IfcLocalPlacement", RelativePlacement=ax)
    wall = f.create_entity("IfcWall", GlobalId=guid, Name=name, ObjectPlacement=plc)
    if status is not None:
        prop = f.create_entity("IfcPropertySingleValue", Name="Status", NominalValue=f.create_entity("IfcLabel", status))
        pset = f.create_entity("IfcPropertySet", GlobalId=ifcopenshell.guid.new(), Name="Pset_WallCommon", HasProperties=[prop])
        f.create_entity("IfcRelDefinesByProperties", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[wall], RelatingPropertyDefinition=pset)
    return wall


def _base():
    f = ifcopenshell.file(schema="IFC4")
    _wall(f, "W-A", (0, 0, 0), _GA, status="EXISTING")
    _wall(f, "W-B", (5000, 0, 0), _GB, status="EXISTING")
    return f


def _target():
    f = ifcopenshell.file(schema="IFC4")
    _wall(f, "W-A", (0, 0, 10000), _GA, status="DEMOLISHED")  # moved + pset changed
    _wall(f, "W-C", (9000, 0, 0), _GC, status="NEW")  # added
    # W-B removed
    return f


def test_synthetic_diff_classifies_changes():
    diff = run_diff(_base(), _target(), move_tol=1.0)
    assert diff.matched == 1  # 只有 W-A 以 GUID 對齊
    assert diff.counts.get("added") == 1  # W-C
    assert diff.counts.get("removed") == 1  # W-B
    assert diff.counts.get("moved") == 1  # W-A 移動 10m
    assert diff.counts.get("property_changed") == 1  # W-A Status 改變

    # 誠實：added/removed 帶真實 guid
    added = diff.items_by_type("added")[0]
    assert added.ifc_guid == _GC
    moved = diff.items_by_type("moved")[0]
    assert moved.ifc_guid == _GA
    assert moved.evidence["target_xyz"] == (0.0, 0.0, 10000.0)


def test_no_changes_when_identical():
    diff = run_diff(_base(), _base(), move_tol=1.0)
    assert diff.matched == 2
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    assert diff.counts.get("moved", 0) == 0


# ---- A2-002：退階對齊（Tag / type+name+loc）路徑測試（含 A2-001 型別護欄）----

def _element(f, ifc_type, name, xyz, guid, tag=None, status=None):
    """合成任意型別 IfcElement，可指定 Tag 與 Pset_*Common.Status；風格沿用 _wall。"""
    pt = f.create_entity("IfcCartesianPoint", Coordinates=tuple(float(v) for v in xyz))
    ax = f.create_entity("IfcAxis2Placement3D", Location=pt)
    plc = f.create_entity("IfcLocalPlacement", RelativePlacement=ax)
    el = f.create_entity(ifc_type, GlobalId=guid, Name=name, ObjectPlacement=plc, Tag=tag)
    if status is not None:
        prop = f.create_entity("IfcPropertySingleValue", Name="Status", NominalValue=f.create_entity("IfcLabel", status))
        pset = f.create_entity("IfcPropertySet", GlobalId=ifcopenshell.guid.new(), Name="Pset_Common", HasProperties=[prop])
        f.create_entity("IfcRelDefinesByProperties", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[el], RelatingPropertyDefinition=pset)
    return el


def test_tag_alignment_same_type_different_guid():
    """(a) GUID 不同但 Tag 相同且同型別 → 應以 tag 對齊（evidence.match == 'tag'）。"""
    base = ifcopenshell.file(schema="IFC4")
    _element(base, "IfcWall", "W-A", (0, 0, 0), ifcopenshell.guid.new(), tag="123", status="EXISTING")
    target = ifcopenshell.file(schema="IFC4")
    # 不同 GUID、同 Tag、同型別 → GUID 級不中、Tag 級命中；移動以產生可觀察的 moved 證據
    _element(target, "IfcWall", "W-A", (0, 0, 10000), ifcopenshell.guid.new(), tag="123", status="DEMOLISHED")

    diff = run_diff(base, target, move_tol=1.0)
    assert diff.matched == 1
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    moved = diff.items_by_type("moved")
    assert len(moved) == 1
    assert moved[0].evidence["match"] == "tag"  # 退到 Tag 對齊
    prop = diff.items_by_type("property_changed")
    assert len(prop) == 1 and prop[0].evidence["match"] == "tag"


def test_type_name_loc_alignment_when_guid_and_tag_differ():
    """(b) GUID 與 Tag 都不同，但 type+Name+取整 loc 相同 → 以 type_name_loc 對齊。"""
    base = ifcopenshell.file(schema="IFC4")
    _element(base, "IfcWall", "W-A", (1000, 2000, 3000), ifcopenshell.guid.new(), tag="t-base", status="EXISTING")
    target = ifcopenshell.file(schema="IFC4")
    # 不同 GUID、不同 Tag、同 type+Name+loc → 退到第三級；改 Status 觸發 property_changed 以驗證歸屬
    _element(target, "IfcWall", "W-A", (1000, 2000, 3000), ifcopenshell.guid.new(), tag="t-target", status="DEMOLISHED")

    diff = run_diff(base, target, move_tol=1.0)
    assert diff.matched == 1
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    prop = diff.items_by_type("property_changed")
    assert len(prop) == 1
    assert prop[0].evidence["match"] == "type_name_loc"  # 退到第三級鍵


def test_cross_type_same_tag_not_misaligned():
    """(c) A2-001：被刪的牆與新增的門恰好同 Tag → 應 removed+added，不誤配成 1 配對 0 變更。"""
    base = ifcopenshell.file(schema="IFC4")
    _element(base, "IfcWall", "W-X", (0, 0, 0), ifcopenshell.guid.new(), tag="SHARED-TAG")
    target = ifcopenshell.file(schema="IFC4")
    _element(target, "IfcDoor", "D-Y", (0, 0, 0), ifcopenshell.guid.new(), tag="SHARED-TAG")

    diff = run_diff(base, target, move_tol=1.0)
    # 型別護欄：跨型別同 Tag 不得成對
    assert diff.matched == 0
    assert diff.counts.get("removed") == 1
    assert diff.counts.get("added") == 1
    removed = diff.items_by_type("removed")[0]
    added = diff.items_by_type("added")[0]
    assert removed.ifc_type == "IfcWall"
    assert added.ifc_type == "IfcDoor"


def test_same_type_duplicate_tag_no_phantom_pairing():
    """A2-DUP-TAG：同型別有 2 個相同 Tag 的構件時，不得以 Tag 配對而產生幻影 moved + 假 removed/added。

    先前第二級用 setdefault((is_a, tag), e) 壓平，同 (is_a, Tag) 多構件只留第一個、第二個被丟，
    再依插入序交叉錯配，產生幻影 moved（名稱張冠李戴）+ 假 removed/added，且非確定（隨插入序漂移）。
    修復：先統計每個複合鍵在各側的出現次數，只有「兩側該鍵各恰 1 個」才以 Tag 配對；歧義（任一側 >1）
    時落第三級 type_name_loc 或 removed/added。

    本案例 base/target 各有同型別、同 Tag "DUP" 的 WA/WB 兩牆（GUID 全不中 → 逼到 Tag 級），
    target 以**反向插入序**建立以暴露 setdefault 的插入序依賴；兩牆都沒移動。
    正確結果：WA↔WA、WB↔WB（經第三級 type+name+loc 配對）→ matched=2、0 個 moved/removed/added。
    """
    base = ifcopenshell.file(schema="IFC4")
    target = ifcopenshell.file(schema="IFC4")
    _element(base, "IfcWall", "WA", (0, 0, 0), ifcopenshell.guid.new(), tag="DUP")
    _element(base, "IfcWall", "WB", (5000, 0, 0), ifcopenshell.guid.new(), tag="DUP")
    # target 反向插入（WB 在 WA 前）：插入序 != base，逼出 setdefault 的插入序依賴。
    _element(target, "IfcWall", "WB", (5000, 0, 0), ifcopenshell.guid.new(), tag="DUP")
    _element(target, "IfcWall", "WA", (0, 0, 0), ifcopenshell.guid.new(), tag="DUP")

    diff = run_diff(base, target, move_tol=1.0)
    assert diff.matched == 2, f"歧義 Tag 應落第三級各自配對，實得 matched={diff.matched}"
    assert diff.counts.get("moved", 0) == 0, "不得有幻影 moved"
    assert diff.counts.get("removed", 0) == 0, "不得有假 removed"
    assert diff.counts.get("added", 0) == 0, "不得有假 added"
    # 歧義 Tag 不以 tag 配對 → 落第三級 type_name_loc（不應出現 match==tag）
    assert all(it.evidence.get("match") != "tag" for it in diff.items)


def test_same_key_cluster_pairing_is_stable(monkeypatch):
    """A2-003：同 type+Name+loc 鍵簇內多構件，配對前以 GlobalId 次鍵排序再 zip，
    使 property_changed 證據歸屬穩定可重現、不依插入/迭代序。

    本測試**強制落到第三級**：base 與 target 的 GlobalId 互不相交（→ 第一級 GUID
    全不中）、Tag 皆 None（→ 第二級 (is_a, Tag) 不中），同鍵 = IfcWall|WC|(4000,0,0)。
    base 兩構件 (ga=EXISTING, gb=DEMOLISHED)、target 兩構件 (gc=EXISTING, gd=DEMOLISHED)，
    依 GlobalId 字典序正確配對應為 ga↔gc(同 EXISTING)、gb↔gd(同 DEMOLISHED) → 0 變更。
    target 以**反向插入順序**(先 gd 後 gc)建立：若未排序而按插入序 zip，會交叉錯配成
    ga↔gd、gb↔gc(Status 張冠李戴) → 2 個 property_changed。以此鑑別排序是否生效。
    """
    # 固定可比較的 GlobalId 次鍵；ga<gb（base）、gc<gd（target），四者互不相交。
    ga, gb = "0aaaaaaaaaaaaaaaaaaaa0", "0bbbbbbbbbbbbbbbbbbbb0"
    gc, gd = "0cccccccccccccccccccc0", "0dddddddddddddddddddd0"

    def _build():
        base = ifcopenshell.file(schema="IFC4")
        target = ifcopenshell.file(schema="IFC4")
        _element(base, "IfcWall", "WC", (4000, 0, 0), ga, status="EXISTING")
        _element(base, "IfcWall", "WC", (4000, 0, 0), gb, status="DEMOLISHED")
        # target 反向插入（gd 在 gc 前）：插入序 != GlobalId 排序序，逼出排序的鑑別力。
        _element(target, "IfcWall", "WC", (4000, 0, 0), gd, status="DEMOLISHED")
        _element(target, "IfcWall", "WC", (4000, 0, 0), gc, status="EXISTING")
        return base, target

    # (1) 正常引擎（含 A2-003 排序）：穩定配對 ga↔gc、gb↔gd，Status 各自一致 → 0 變更。
    base, target = _build()
    diff = run_diff(base, target, move_tol=1.0)
    assert diff.matched == 2  # 經第三級 type+name+loc 對齊（GUID/Tag 皆不中）
    assert diff.counts.get("property_changed", 0) == 0  # 穩定配對：Status 正確歸屬，無錯配
    assert diff.counts.get("added", 0) == 0
    assert diff.counts.get("removed", 0) == 0
    assert diff.counts.get("moved", 0) == 0  # 同位置，不應有位移

    # (2) 可重現：同輸入再跑一次，計數一致。
    base2, target2 = _build()
    diff2 = run_diff(base2, target2, move_tol=1.0)
    assert diff2.counts == diff.counts

    # (3) 鑑別力證明：把第三級的穩定排序中性化（模擬移除 A2-003 修正，按插入序 zip）→
    #     交叉錯配 ga↔gd、gb↔gc，Status 張冠李戴 → 恰好 2 個 property_changed。
    #     此斷言確保本測試真的覆蓋排序邏輯：若 engine 不排序，這裡會偵測到錯配。
    import diff_engine.engine as _engine

    # raising=False：sorted 是 builtin、非 engine 模組屬性，注入模組層級同名以遮蔽
    # builtin（Python 名稱解析模組層級優先），等同移除排序；monkeypatch 結束自動還原。
    monkeypatch.setattr(_engine, "sorted", lambda seq, key=None: list(seq), raising=False)
    base3, target3 = _build()
    diff3 = run_diff(base3, target3, move_tol=1.0)
    assert diff3.matched == 2
    assert diff3.counts.get("property_changed", 0) == 2  # 未排序 → 張冠李戴錯配


@pytest.mark.skipif(not (os.path.exists(BASE_IFC) and os.path.exists(TGT_IFC)), reason="real IFC fixture absent")
def test_real_identity_roundtrip_all_matched():
    """誠實揭露：storage 內的 許良宇*.ifc 變體彼此 byte 完全相同（同一 SHA1）。

    本測試是 identity / round-trip 檢查，**不是**變更分類測試：它只證明 GUID 多級對齊
    在真實 7139 元素規模能找到「全部匹配、0 變更」。真實模型的變更分類由
    test_real_model_modified_classification（in-memory 修改真實模型）證明；
    完整 added/removed/moved/property_changed 由合成測試證明。
    """
    diff = run_diff_on_paths(BASE_IFC, TGT_IFC, move_tol=1.0)
    assert diff.base_count > 7000 and diff.target_count > 7000
    assert diff.matched > 7000
    # 計數一致性（identity → removed=added=0）
    assert diff.matched + diff.counts.get("removed", 0) == diff.base_count
    assert diff.matched + diff.counts.get("added", 0) == diff.target_count


def _shift_placements(model, n: int) -> int:
    moved = 0
    for el in model.by_type("IfcElement"):
        if moved >= n:
            break
        plc = getattr(el, "ObjectPlacement", None)
        if plc and plc.is_a("IfcLocalPlacement") and plc.RelativePlacement and plc.RelativePlacement.is_a("IfcAxis2Placement3D"):
            loc = plc.RelativePlacement.Location
            if loc and loc.is_a("IfcCartesianPoint") and loc.Coordinates:
                coords = list(loc.Coordinates)
                coords[0] = float(coords[0]) + 5000.0
                loc.Coordinates = coords
                moved += 1
    return moved


def _add_marker_prop(model, n: int) -> int:
    changed = 0
    for el in model.by_type("IfcElement"):
        if changed >= n:
            break
        for rel in (el.IsDefinedBy or []):
            if rel.is_a("IfcRelDefinesByProperties"):
                pdef = rel.RelatingPropertyDefinition
                if pdef and pdef.is_a("IfcPropertySet"):
                    marker = model.create_entity("IfcPropertySingleValue", Name="DiffTestMarker", NominalValue=model.create_entity("IfcLabel", "X"))
                    pdef.HasProperties = list(pdef.HasProperties) + [marker]
                    changed += 1
                    break
    return changed


@pytest.mark.skipif(not os.path.exists(BASE_IFC), reason="real IFC fixture absent")
def test_real_model_modified_classification():
    """真實模型變更分類：開兩份真實 IFC，把其中一份 in-memory 修改（位移 + 加屬性），
    證明 diff 在真實 IFC4X3 模型上真的偵測到 moved / property_changed（非 identity）。"""
    base = open_model(BASE_IFC)
    modified = open_model(BASE_IFC)  # 獨立 model 物件，修改不影響 base
    moved_n = _shift_placements(modified, 8)
    prop_n = _add_marker_prop(modified, 8)
    assert moved_n > 0 and prop_n > 0, "前置：修改需真的套到真實元素"

    diff = run_diff(base, modified, move_tol=1.0)
    assert diff.matched > 7000  # 同模型 → 幾乎全 GUID 對齊
    assert diff.counts.get("moved", 0) > 0, "真實模型應偵測到位移"
    assert diff.counts.get("property_changed", 0) > 0, "真實模型應偵測到屬性變更"
    moved_item = diff.items_by_type("moved")[0]
    assert moved_item.ifc_guid and moved_item.evidence.get("target_xyz")


# ── A2-W2：DiffStore ifc_type/ifc_name 落庫回歸測試 ──────────────────────────

def _make_result_with_ifc_type() -> DiffResult:
    """建立一筆含 ifc_type/ifc_name 的合成 DiffResult 供 store 測試用。"""
    return DiffResult(
        base_count=1,
        target_count=2,
        matched=1,
        counts={"added": 1, "removed": 0, "moved": 1},
        items=[
            DiffItem(
                change_type="added",
                ifc_guid="guid-add-001",
                ifc_type="IfcBeam",
                ifc_name="B-1",
                change_summary="新增構件",
                evidence={"match": "none"},
            ),
            DiffItem(
                change_type="moved",
                ifc_guid="guid-mov-001",
                ifc_type="IfcWall",
                ifc_name="W-A",
                change_summary="位移 10m",
                evidence={"target_xyz": (0.0, 0.0, 10000.0)},
            ),
        ],
    )


def test_store_roundtrip_ifc_type_ifc_name():
    """A2-W2：store.complete_diff 真的把 ifc_type/ifc_name 存入 DB，get_items 讀回不為空。"""
    tmpdir = tempfile.mkdtemp()
    try:
        db_path = os.path.join(tmpdir, "test_diff.db")
        store = DiffStore(db_path)
        diff_id = store.create_diff("mv-base", "mv-target", "base.ifc", "target.ifc")
        store.mark_running(diff_id)
        result = _make_result_with_ifc_type()
        store.complete_diff(diff_id, result)

        rows = store.get_items(diff_id)
        assert len(rows) == 2, f"應得 2 筆，實得 {len(rows)}"

        added_row = next(r for r in rows if r["change_type"] == "added")
        assert added_row["ifc_type"] == "IfcBeam", f"ifc_type 應落庫 IfcBeam，實得 {added_row['ifc_type']!r}"
        assert added_row["ifc_name"] == "B-1", f"ifc_name 應落庫 B-1，實得 {added_row['ifc_name']!r}"

        moved_row = next(r for r in rows if r["change_type"] == "moved")
        assert moved_row["ifc_type"] == "IfcWall"
        assert moved_row["ifc_name"] == "W-A"
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_store_idempotent_migration_old_db():
    """A2-W2 冪等回歸：對一個無 ifc_type/ifc_name 欄的舊 DB，開 DiffStore 後自動補欄；
    既有列讀回 ifc_type=None（不回填假值）。"""
    import shutil
    tmpdir = tempfile.mkdtemp()
    try:
        db_path = os.path.join(tmpdir, "legacy_diff.db")

        # 1. 用低層 sqlite3 建一個「舊 schema」DB（無 ifc_type/ifc_name）並插一筆舊紀錄。
        legacy_conn = sqlite3.connect(db_path)
        try:
            legacy_conn.executescript("""
CREATE TABLE IF NOT EXISTS model_diffs(
  id TEXT PRIMARY KEY,
  base_model_version_id TEXT,
  target_model_version_id TEXT,
  base_ifc_path TEXT,
  target_ifc_path TEXT,
  status TEXT,
  started_at TEXT,
  finished_at TEXT,
  summary_json TEXT
);
CREATE TABLE IF NOT EXISTS model_diff_items(
  id TEXT PRIMARY KEY,
  model_diff_id TEXT,
  change_type TEXT,
  ifc_guid TEXT,
  base_usd_prim_path TEXT,
  target_usd_prim_path TEXT,
  change_summary TEXT,
  evidence_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_diff_items_diff ON model_diff_items(model_diff_id);
""")
            legacy_conn.execute(
                "INSERT INTO model_diffs(id, status) VALUES(?,?)",
                ("legacy-diff-001", "succeeded"),
            )
            legacy_conn.execute(
                "INSERT INTO model_diff_items(id, model_diff_id, change_type, ifc_guid, change_summary, evidence_json)"
                " VALUES(?,?,?,?,?,?)",
                ("legacy-item-001", "legacy-diff-001", "removed", "guid-legacy", "舊列", "{}"),
            )
            legacy_conn.commit()
        finally:
            legacy_conn.close()

        # 2. 以 DiffStore 開同一個 DB → 應自動補欄而不崩潰。
        store = DiffStore(db_path)

        # 3. 驗證欄位已存在（PRAGMA table_info 應回報 ifc_type / ifc_name）。
        check_conn = sqlite3.connect(db_path)
        try:
            cols = {row[1] for row in check_conn.execute("PRAGMA table_info(model_diff_items)").fetchall()}
        finally:
            check_conn.close()
        assert "ifc_type" in cols, "migration 應補入 ifc_type 欄"
        assert "ifc_name" in cols, "migration 應補入 ifc_name 欄"

        # 4. 舊列讀回 ifc_type=None（不回填假值）。
        rows = store.get_items("legacy-diff-001")
        assert len(rows) == 1
        assert rows[0]["ifc_type"] is None, f"舊列 ifc_type 應為 None，實得 {rows[0]['ifc_type']!r}"
        assert rows[0]["ifc_name"] is None, f"舊列 ifc_name 應為 None，實得 {rows[0]['ifc_name']!r}"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_store_idempotent_migration_new_db():
    """A2-W2 冪等回歸：對新建 DB（已有 ifc_type/ifc_name 欄），重複開 DiffStore 不崩潰。"""
    import shutil
    tmpdir = tempfile.mkdtemp()
    try:
        db_path = os.path.join(tmpdir, "new_diff.db")
        # 第一次建立
        store1 = DiffStore(db_path)
        del store1  # 釋放連接
        # 第二次開同一 DB（冪等：migration 對已存在欄位應被跳過而非拋 OperationalError）
        store2 = DiffStore(db_path)
        # 寫入再讀出確認正常
        diff_id = store2.create_diff("a", "b", "a.ifc", "b.ifc")
        result = _make_result_with_ifc_type()
        store2.complete_diff(diff_id, result)
        rows = store2.get_items(diff_id)
        assert len(rows) == 2
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def test_store_concurrent_first_request_migration_race():
    """A2-F3 並發回歸：對一個「已有 model_diff_items 但缺 ifc_type/ifc_name 欄」的舊 DB，
    多個 thread 同時開 DiffStore（同 db_path）觸發 migration，斷言不拋例外、欄位最終存在、
    舊列讀回 ifc_type=None。模擬 FastAPI threadpool 下 _get_store 無鎖、首次請求並發補欄的
    良性 duplicate-column race。"""
    import shutil
    import threading

    tmpdir = tempfile.mkdtemp()
    try:
        db_path = os.path.join(tmpdir, "legacy_concurrent_diff.db")

        # 1. 用低層 sqlite3 建一個「舊 schema」DB（無 ifc_type/ifc_name）並插一筆舊紀錄。
        legacy_conn = sqlite3.connect(db_path)
        try:
            legacy_conn.executescript("""
CREATE TABLE IF NOT EXISTS model_diffs(
  id TEXT PRIMARY KEY,
  base_model_version_id TEXT,
  target_model_version_id TEXT,
  base_ifc_path TEXT,
  target_ifc_path TEXT,
  status TEXT,
  started_at TEXT,
  finished_at TEXT,
  summary_json TEXT
);
CREATE TABLE IF NOT EXISTS model_diff_items(
  id TEXT PRIMARY KEY,
  model_diff_id TEXT,
  change_type TEXT,
  ifc_guid TEXT,
  base_usd_prim_path TEXT,
  target_usd_prim_path TEXT,
  change_summary TEXT,
  evidence_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_diff_items_diff ON model_diff_items(model_diff_id);
""")
            legacy_conn.execute(
                "INSERT INTO model_diffs(id, status) VALUES(?,?)",
                ("legacy-diff-conc", "succeeded"),
            )
            legacy_conn.execute(
                "INSERT INTO model_diff_items(id, model_diff_id, change_type, ifc_guid, change_summary, evidence_json)"
                " VALUES(?,?,?,?,?,?)",
                ("legacy-item-conc", "legacy-diff-conc", "removed", "guid-legacy", "舊列", "{}"),
            )
            legacy_conn.commit()
        finally:
            legacy_conn.close()

        # 2. 多個 thread 同時 DiffStore(db_path) 觸發 migration；用 barrier 盡量逼出 race。
        n_threads = 8
        barrier = threading.Barrier(n_threads)
        errors: list[BaseException] = []
        stores: list[DiffStore] = []
        lock = threading.Lock()

        def _open():
            try:
                barrier.wait()
                s = DiffStore(db_path)
                with lock:
                    stores.append(s)
            except BaseException as exc:  # noqa: BLE001 — 測試需捕捉所有 thread 例外
                with lock:
                    errors.append(exc)

        threads = [threading.Thread(target=_open) for _ in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # 3. 斷言：沒有任何 thread 拋例外（duplicate-column race 應被良性吞掉）。
        assert not errors, f"並發 migration 不應拋例外，實得：{errors!r}"
        assert len(stores) == n_threads

        # 4. 欄位最終存在。
        check_conn = sqlite3.connect(db_path)
        try:
            cols = {row[1] for row in check_conn.execute("PRAGMA table_info(model_diff_items)").fetchall()}
        finally:
            check_conn.close()
        assert "ifc_type" in cols, "並發 migration 後應有 ifc_type 欄"
        assert "ifc_name" in cols, "並發 migration 後應有 ifc_name 欄"

        # 5. 舊列讀回 ifc_type=None（不回填假值）。
        rows = stores[0].get_items("legacy-diff-conc")
        assert len(rows) == 1
        assert rows[0]["ifc_type"] is None, f"舊列 ifc_type 應為 None，實得 {rows[0]['ifc_type']!r}"
        assert rows[0]["ifc_name"] is None, f"舊列 ifc_name 應為 None，實得 {rows[0]['ifc_name']!r}"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
