import hashlib
from pathlib import Path
import ifcopenshell
from rule_engine import source_snapshot
from test_api import client  # Reuse the real FastAPI + isolated SQLite fixture.


def test_parse_and_hash_same_bytes_even_when_original_changes(tmp_path, monkeypatch):
    model = ifcopenshell.file(schema="IFC4")
    model.create_entity("IfcWall", GlobalId="0abcdefghijklmnopqrstu", Name="Original")
    source = tmp_path / "model.ifc"; model.write(str(source))
    before = source.read_bytes()
    real_open = source_snapshot.ifcopenshell.open
    seen = []
    def open_copy(path):
        seen.append(Path(path))
        source.write_text("changed after snapshot")
        assert Path(path).read_bytes() == before
        return real_open(path)
    monkeypatch.setattr(source_snapshot.ifcopenshell, "open", open_copy)
    parsed, digest = source_snapshot.load_source_snapshot(str(source))
    assert parsed.by_type("IfcWall")[0].Name == "Original"
    assert digest == hashlib.sha256(before).hexdigest()
    assert not seen[0].exists()


def test_api_persists_snapshot_digest(client, synthetic_ifc_path):
    response = client.post("/api/rule-runs", json={"ifc_source_path": synthetic_ifc_path, "model_version_id": "v1"})
    result = client.get(f"/api/rule-runs/{response.json()['rule_run_id']}").json()
    assert result["status"] == "succeeded"
    assert result["summary"]["source_sha256"] == hashlib.sha256(Path(synthetic_ifc_path).read_bytes()).hexdigest()


def test_private_snapshots_do_not_retain_models_or_evict_stable_source(tmp_path):
    from rule_engine.engine import open_model
    model = ifcopenshell.file(schema="IFC4")
    model.create_entity("IfcWall", GlobalId="0abcdefghijklmnopqrstu", Name="Stable")
    source = tmp_path / "stable.ifc"
    model.write(str(source))
    open_model.cache_clear()
    try:
        stable = open_model(str(source))
        before = open_model.cache_info()
        for _ in range(5):
            snapshot, _digest = source_snapshot.load_source_snapshot(str(source))
            assert snapshot.by_type("IfcWall")[0].Name == "Stable"
        assert open_model.cache_info() == before
        assert open_model(str(source)) is stable
    finally:
        open_model.cache_clear()
