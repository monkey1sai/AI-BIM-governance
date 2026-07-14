"""A4 LLM interpret path — mocked Ornith client (no live key required)."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from search.interpreter import filters_from_structured_dict
from tests.test_search_model import A4_FIRE_DOORS_IFC


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    monkeypatch.delenv("ORNITH_API_KEY", raising=False)
    monkeypatch.delenv("A4_LLM_API_KEY", raising=False)
    monkeypatch.setenv("A4_LLM_ENABLED", "false")
    import importlib
    import app as gov_app

    importlib.reload(gov_app)
    return TestClient(gov_app.app)


@pytest.fixture()
def a4_ifc(tmp_path) -> Path:
    path = tmp_path / "a4.ifc"
    path.write_text(A4_FIRE_DOORS_IFC, encoding="utf-8")
    return path


def test_filters_from_structured_dict_sanitizes():
    f = filters_from_structured_dict(
        "四樓防火門",
        {
            "ifc_classes": ["IfcDoor", "NotAClass", "IfcWall"],
            "storey_tokens": ["4F", "4"],
            "property_filters": [
                {"name": "FireRating", "op": "<", "value": 60},
                {"name": "bad name", "op": "<", "value": 1},
                {"name": "X", "op": "!=", "value": 1},
            ],
            "name_contains": ["Fire"],
            "notes": ["ok"],
        },
        source="llm",
    )
    assert f.interpretable
    assert f.ifc_classes == ["IfcDoor", "IfcWall"]
    assert f.property_filters[0].name == "FireRating"
    assert f.interpret_source == "llm"


def test_llm_status_without_key(client):
    res = client.get("/api/search/llm-status")
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is False
    assert body["enabled"] is False
    assert "api_key" not in body
    assert "fc1fb67" not in str(body).lower()


def test_semantic_mode_uses_mocked_llm(client, a4_ifc, monkeypatch):
    monkeypatch.setenv("A4_LLM_ENABLED", "true")
    monkeypatch.setenv("ORNITH_API_KEY", "test-key-not-real")
    monkeypatch.setenv("A4_LLM_BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setenv("A4_LLM_MODEL", "Ornith-1.0-35B")

    import search.engine as engine_mod
    import search.llm_client as llm_mod

    def fake_chat(**kwargs):
        return (
            '{"ifc_classes":["IfcDoor"],"storey_tokens":["4F","4"],'
            '"property_filters":[{"name":"FireRating","op":"<","value":60}],'
            '"name_contains":[],"notes":["mocked"]}'
        )

    monkeypatch.setattr(engine_mod, "chat_completion", fake_chat)
    monkeypatch.setattr(llm_mod, "chat_completion", fake_chat)
    # reload config path used inside engine via load_llm_config
    from search.llm_client import LlmConfig

    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig(
            base_url="http://127.0.0.1:9/v1",
            api_key="test-key-not-real",
            model="Ornith-1.0-35B",
            timeout_s=5,
            enabled=True,
        ),
    )

    res = client.post(
        "/api/search/model",
        json={
            "ifc_source_path": str(a4_ifc),
            "query": "哪些四樓的門防火時效不到一小時？",
            "interpret_mode": "semantic",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ok"
    assert body["interpret_mode"] == "semantic"
    assert body["interpreted_filters"]["interpret_source"] == "llm"
    guids = {r["ifc_guid"] for r in body["results"]}
    assert "0A4DoorLow000000000001" in guids
    assert any(e.get("kind") == "llm" for e in body["evidence_refs"])


def test_semantic_mode_fails_honestly_without_key(client, a4_ifc, monkeypatch):
    monkeypatch.setenv("A4_LLM_ENABLED", "true")
    monkeypatch.delenv("ORNITH_API_KEY", raising=False)
    monkeypatch.delenv("A4_LLM_API_KEY", raising=False)
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig(
            base_url="http://192.168.10.248:18080/v1",
            api_key="",
            model="Ornith-1.0-35B",
            timeout_s=5,
            enabled=False,
        ),
    )
    res = client.post(
        "/api/search/model",
        json={
            "ifc_source_path": str(a4_ifc),
            "query": "自然語言查四樓防火門",
            "interpret_mode": "semantic",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "uninterpreted"
    assert body.get("next_step")
