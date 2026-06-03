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
