"""A1 IDS-XML 規則匯入驗證 — ifctester 跑 buildingSMART IDS，映射成 RuleRunResult。"""
from __future__ import annotations

import ifcopenshell
import ifcopenshell.guid

from rule_engine.ids_runner import run_ids


def _g():
    return ifcopenshell.guid.new()


def _doors_model():
    f = ifcopenshell.file(schema="IFC4")
    f.create_entity("IfcProject", GlobalId=_g(), Name="P")
    d1 = f.create_entity("IfcDoor", GlobalId=_g(), Name="D1")  # 有 FireRating
    d2 = f.create_entity("IfcDoor", GlobalId=_g(), Name="D2")  # 缺 FireRating
    prop = f.create_entity("IfcPropertySingleValue", Name="FireRating", NominalValue=f.create_entity("IfcLabel", "EI60"))
    pset = f.create_entity("IfcPropertySet", GlobalId=_g(), Name="Pset_DoorCommon", HasProperties=[prop])
    f.create_entity("IfcRelDefinesByProperties", GlobalId=_g(), RelatedObjects=[d1], RelatingPropertyDefinition=pset)
    return f, d1, d2


def _fire_rating_ids():
    from ifctester import facet as F
    from ifctester import ids

    spec = ids.Specification(name="Doors need FireRating")
    spec.applicability.append(F.Entity(name="IFCDOOR"))
    spec.requirements.append(F.Property(propertySet="Pset_DoorCommon", baseName="FireRating", dataType="IFCLABEL"))
    doc = ids.Ids(title="smoke")
    doc.specifications.append(spec)
    return doc


def test_ids_run_classifies_doors_with_real_guids():
    model, d1, d2 = _doors_model()
    run = run_ids(model, _fire_rating_ids())
    assert run.total == 2  # 2 doors applicable × 1 requirement
    by_guid = {r.ifc_guid: r.status for r in run.results}
    assert by_guid[d1.GlobalId] == "pass"  # 有 FireRating
    assert by_guid[d2.GlobalId] == "fail"  # 缺 FireRating
    # 每個結果帶真實 ifc_guid（可串 issue / BCF）
    assert all(r.ifc_guid for r in run.results)
    assert run.passed == 1 and run.failed == 1 and run.score == 50.0
    assert run.warnings and "IDS" in run.warnings[0]


def test_ids_target_summary_unique_for_same_named_specs():
    """ids-001：同名 specification 不得在 target_summary 互相覆寫。"""
    from ifctester import facet as F
    from ifctester import ids

    model, d1, d2 = _doors_model()
    doc = ids.Ids(title="dup")
    for _ in range(2):  # 兩個同名 spec
        spec = ids.Specification(name="Doors need FireRating")
        spec.applicability.append(F.Entity(name="IFCDOOR"))
        spec.requirements.append(
            F.Property(propertySet="Pset_DoorCommon", baseName="FireRating", dataType="IFCLABEL")
        )
        doc.specifications.append(spec)
    run = run_ids(model, doc)
    assert len(run.target_summary) == 2, f"同名 spec 應有唯一 key，實得 {run.target_summary}"
    assert sum(run.target_summary.values()) == 4  # 2 spec × 2 applicable doors


def test_ids_errored_derived_from_results():
    """ids-003：errored 由結果推導（語意正確），非結構性寫死。"""
    model, d1, d2 = _doors_model()
    run = run_ids(model, _fire_rating_ids())
    assert run.errored == sum(1 for r in run.results if r.status == "error")


class _ProhibitedSpec:
    """模擬 prohibited applicability（validate 後 status=False、零 requirement）。"""

    def __init__(self, applicable):
        self.name = "Prohibited entities"
        self.identifier = None
        self.applicable_entities = applicable
        self.requirements = []
        self.status = False


class _FakeSpecs:
    def __init__(self, specs):
        self.specifications = specs

    def validate(self, model):  # 已預先 validate，no-op
        return None


def test_ids_prohibited_spec_emits_fail_not_silent_pass():
    """ids-002：prohibited（spec.status False、零 requirement）不得靜默 pass。"""
    model, d1, d2 = _doors_model()
    run = run_ids(model, _FakeSpecs([_ProhibitedSpec([d1, d2])]))
    assert run.failed == 2, "prohibited 構件應誠實 fail，而非被當乾淨 pass"
    assert run.score == 0.0


class _SameIdSpec:
    """模擬兩個帶相同 @identifier 的 specification。"""

    def __init__(self, applicable):
        self.name = "X"
        self.identifier = "DUP-ID"
        self.applicable_entities = applicable
        self.requirements = []
        self.status = True


def test_ids_target_summary_unique_for_duplicate_identifiers():
    """外部 review P2：兩 spec 帶相同 @identifier 也不得在 target_summary 互相覆寫。"""
    model, d1, d2 = _doors_model()
    run = run_ids(model, _FakeSpecs([_SameIdSpec([d1, d2]), _SameIdSpec([d1])]))
    assert len(run.target_summary) == 2, f"相同 identifier 仍應有唯一 key：{run.target_summary}"
    assert sum(run.target_summary.values()) == 3  # 2 + 1 applicable，未被覆寫


class _Req:
    passed_entities: list = []


class _ProhibitedSpecWithReqs:
    """prohibited（maxOccurs=0）但帶 requirements 的 specification。"""

    def __init__(self, applicable):
        self.name = "No insulation allowed"
        self.identifier = None
        self.maxOccurs = 0
        self.applicable_entities = applicable
        self.requirements = [_Req(), _Req()]  # 2 條 requirement
        self.status = False


def test_ids_prohibited_with_requirements_not_overcounted():
    """外部 review P2：prohibited spec 含 requirements 時不得走 requirement 迴圈過度計數。"""
    model, d1, d2 = _doors_model()
    run = run_ids(model, _FakeSpecs([_ProhibitedSpecWithReqs([d1, d2])]))
    # 2 applicable × specification 級 fail = 2（非 2 requirements × 2 applicable = 4）
    assert run.failed == 2, f"prohibited+requirements 不得過度計數，實得 failed={run.failed}"
    assert all(r.evidence.get("prohibited") for r in run.results)
    assert run.score == 0.0


def _good_door_model():
    """有 FireRating 的單門模型。"""
    f = ifcopenshell.file(schema="IFC4")
    f.create_entity("IfcProject", GlobalId=_g(), Name="P")
    d = f.create_entity("IfcDoor", GlobalId=_g(), Name="GoodDoor")
    prop = f.create_entity("IfcPropertySingleValue", Name="FireRating", NominalValue=f.create_entity("IfcLabel", "EI60"))
    pset = f.create_entity("IfcPropertySet", GlobalId=_g(), Name="Pset_DoorCommon", HasProperties=[prop])
    f.create_entity("IfcRelDefinesByProperties", GlobalId=_g(), RelatedObjects=[d], RelatingPropertyDefinition=pset)
    return f, d


def _bad_door_model():
    """缺 FireRating 的單門模型。"""
    f = ifcopenshell.file(schema="IFC4")
    f.create_entity("IfcProject", GlobalId=_g(), Name="P")
    d = f.create_entity("IfcDoor", GlobalId=_g(), Name="BadDoor")
    return f, d


def test_ids_reused_specs_across_models_no_false_pass():
    """A1-IDS-REUSE-FALSEPASS：同一 specs 物件先後對「有 FireRating 門」再對「缺 FireRating 門」。

    ifctester 0.8.5 不重置 facet.passed_entities，加上 ifcopenshell 跨 model 重用 STEP id，
    第二個 model 的不合規門曾被殘留 pass 洩漏誤判 pass、score=100。修復後第二次必須 failed>=1
    且 score<100。用真實 ifctester（非 fake spec）驗，確保覆蓋實際洩漏路徑。
    """
    from ifctester import facet as F
    from ifctester import ids

    # 單一 specs 物件，跨兩 model 重用
    spec = ids.Specification(name="Doors need FireRating")
    spec.applicability.append(F.Entity(name="IFCDOOR"))
    spec.requirements.append(F.Property(propertySet="Pset_DoorCommon", baseName="FireRating", dataType="IFCLABEL"))
    doc = ids.Ids(title="reuse")
    doc.specifications.append(spec)

    m_good, d_good = _good_door_model()
    m_bad, d_bad = _bad_door_model()
    # ifcopenshell 跨 file 常給相同 .id()（洩漏前提）
    assert d_good.id() == d_bad.id(), "前提：跨 model STEP id 重用（否則無法重現洩漏）"

    run_good = run_ids(m_good, doc)
    assert run_good.passed == 1 and run_good.failed == 0 and run_good.score == 100.0

    run_bad = run_ids(m_bad, doc)  # 重用同一 doc/spec
    assert run_bad.failed >= 1, f"重用 specs 後不合規門必須 fail，實得 {run_bad}"
    assert run_bad.score < 100.0, f"殘留 pass 洩漏導致假通過：score={run_bad.score}"
    assert run_bad.passed == 0


def test_ids_required_spec_zero_applicable_not_false_pass():
    """Required-IDS-零適用誤報：required spec（minOccurs!=0）在模型無該適用構件時不得回 score=100。

    ifctester 對 minOccurs>=1 的 spec、模型無 applicable 構件時回 spec.status=False（required 構件
    缺席）。先前因 applicable 為空而完全不產 result → score=100 掩蓋失敗。修復後補 spec 級 fail、score<100。
    """
    from ifctester import facet as F
    from ifctester import ids

    f = ifcopenshell.file(schema="IFC4")
    f.create_entity("IfcProject", GlobalId=_g(), Name="P")
    f.create_entity("IfcWall", GlobalId=_g(), Name="W1")  # 只有牆，無門

    spec = ids.Specification(name="At least 1 door required", minOccurs=1, maxOccurs="unbounded")
    spec.applicability.append(F.Entity(name="IFCDOOR"))
    spec.requirements.append(
        F.Property(propertySet="Pset_DoorCommon", baseName="FireRating", dataType="IFCLABEL", cardinality="required")
    )
    doc = ids.Ids(title="required-absent")
    doc.specifications.append(spec)

    run = run_ids(f, doc)
    assert run.failed >= 1, f"required 構件缺席必須誠實 fail，實得 {run}"
    assert run.score < 100.0, f"required 零適用不得假通過：score={run.score}"
    # 補的 spec 級 fail 標記為 required_absent，且無捏造構件 guid
    absent = [r for r in run.results if r.evidence.get("required_absent")]
    assert absent and absent[0].ifc_guid is None
