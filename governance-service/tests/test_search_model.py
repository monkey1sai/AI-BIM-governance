"""A4 POST /api/search/model — deterministic semantic search."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from search.interpreter import interpret_query

# Inline IFC (*.ifc is gitignored) — written to tmp_path per test.
A4_FIRE_DOORS_IFC = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('a4_fire_doors.ifc','2026-07-14T00:00:00',(''),(''),'IfcOpenShell','IfcOpenShell','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0A4Proj000000000000001',$,'A4E2E',$,$,$,$,$,$);
#2=IFCCARTESIANPOINT((0.,0.,0.));
#3=IFCAXIS2PLACEMENT3D(#2,$,$);
#4=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-05,#3,$);
#5=IFCSITE('0A4Site000000000000001',$,'S1',$,$,$,$,$,$,$,$,$,$,$);
#6=IFCBUILDING('0A4Bldg000000000000001',$,'B1',$,$,$,$,$,$,$,$,$);
#7=IFCBUILDINGSTOREY('0A4Sty400000000000001',$,'4F',$,$,$,$,$,$,$);
#8=IFCBUILDINGSTOREY('0A4Sty100000000000001',$,'1F',$,$,$,$,$,$,$);
#10=IFCDOOR('0A4DoorLow000000000001',$,'FireDoor-Low',$,$,$,$,$,$,$,$,$,$);
#11=IFCDOOR('0A4DoorHigh00000000001',$,'FireDoor-High',$,$,$,$,$,$,$,$,$,$);
#12=IFCDOOR('0A4Door1F0000000000001',$,'FireDoor-1F',$,$,$,$,$,$,$,$,$,$);
#20=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('30'),$);
#21=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('90'),$);
#22=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('45'),$);
#30=IFCPROPERTYSET('0A4Pset00000000000001',$,'Pset_DoorCommon',$,(#20));
#31=IFCPROPERTYSET('0A4Pset00000000000002',$,'Pset_DoorCommon',$,(#21));
#32=IFCPROPERTYSET('0A4Pset00000000000003',$,'Pset_DoorCommon',$,(#22));
#40=IFCRELDEFINESBYPROPERTIES('0A4RelP0000000000001',$,$,$,(#10),#30);
#41=IFCRELDEFINESBYPROPERTIES('0A4RelP0000000000002',$,$,$,(#11),#31);
#42=IFCRELDEFINESBYPROPERTIES('0A4RelP0000000000003',$,$,$,(#12),#32);
#50=IFCRELAGGREGATES('0A4RelA0000000000001',$,$,$,#1,(#5));
#51=IFCRELAGGREGATES('0A4RelA0000000000002',$,$,$,#5,(#6));
#52=IFCRELAGGREGATES('0A4RelA0000000000003',$,$,$,#6,(#7,#8));
#60=IFCRELCONTAINEDINSPATIALSTRUCTURE('0A4RelC0000000000001',$,$,$,(#10,#11),#7);
#61=IFCRELCONTAINEDINSPATIALSTRUCTURE('0A4RelC0000000000002',$,$,$,(#12),#8);
ENDSEC;
END-ISO-10303-21;
"""

TINY = Path(__file__).resolve().parents[2] / "storage" / "e2e-a1" / "demo" / "tiny.ifc"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "gov.db"
    monkeypatch.setenv("GOV_DB_PATH", str(db))
    import importlib
    import app as gov_app

    importlib.reload(gov_app)
    return TestClient(gov_app.app)


@pytest.fixture()
def a4_ifc(tmp_path) -> Path:
    path = tmp_path / "a4_fire_doors.ifc"
    path.write_text(A4_FIRE_DOORS_IFC, encoding="utf-8")
    return path


def test_interpret_fire_door_query():
    filters = interpret_query("找 4F 防火門且 FireRating < 60")
    assert filters.interpretable
    assert "IfcDoor" in filters.ifc_classes
    assert any(t in ("4", "4F") for t in filters.storey_tokens)
    assert any(p.name == "FireRating" and p.op == "<" and p.value == 60 for p in filters.property_filters)


def test_search_model_fire_rating_filter(client, a4_ifc):
    res = client.post(
        "/api/search/model",
        json={
            "ifc_source_path": str(a4_ifc),
            "query": "找 4F 防火門且 FireRating < 60",
            "model_version_id": "a4_fixture_v1",
            "limit": 50,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ok"
    assert body["interpreted_filters"]["interpretable"] is True
    guids = {r["ifc_guid"] for r in body["results"]}
    # Low rating door on 4F matches; high rating on 4F and 1F door do not.
    assert "0A4DoorLow000000000001" in guids
    assert "0A4DoorHigh00000000001" not in guids
    assert "0A4Door1F0000000000001" not in guids
    for row in body["results"]:
        assert row["match_status"] == "match"
        assert row["ifc_class"] == "IfcDoor"
        assert "FireRating" in (row.get("properties") or {})
        assert row.get("evidence_refs")


def test_search_model_uninterpreted(client, a4_ifc):
    res = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(a4_ifc), "query": "??? ###"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "uninterpreted"
    assert body["results"] == []
    assert body.get("next_step")


def test_search_model_missing_path(client, a4_ifc):
    res = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(a4_ifc.parent / "nope.ifc"), "query": "IfcDoor"},
    )
    assert res.status_code == 400


def test_search_tiny_door_if_present(client):
    if not TINY.is_file():
        pytest.skip("tiny.ifc not in worktree storage")
    res = client.post(
        "/api/search/model",
        json={"ifc_source_path": str(TINY), "query": "IfcDoor"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["stats"]["matched"] >= 1
