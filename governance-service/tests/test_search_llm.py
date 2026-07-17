"""A4 LLM interpret path — mocked Ornith client (no live key required)."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from search.interpreter import filters_from_structured_dict
from search.engine import SearchRequest, run_model_search
from search.llm_client import CompletionResult, LlmConfig, LlmError, chat_completion, load_llm_config
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
            "consumed_spans": [
                {"start": 0, "end": 1, "field": "ifc_classes", "filter_index": 0},
            ],
        },
        source="llm",
    )
    assert f.interpretable is False
    assert f.ifc_classes == ["IfcDoor", "IfcWall"]
    assert f.property_filters[0].name == "FireRating"
    assert f.interpret_source == "llm"
    assert f.schema_valid is False
    assert f.usable is False


def test_structured_filter_schema_failure_is_not_usable_or_complete():
    f = filters_from_structured_dict(
        "IfcDoor",
        {"ifc_classes": "IfcDoor", "property_filters": [{"name": "FireRating", "op": "!=", "value": 1}]},
        source="llm",
    )
    assert f.schema_valid is False
    assert f.usable is False
    assert f.complete is False


@pytest.mark.parametrize(
    ("query", "payload"),
    [
        (
            "IfcDoor",
            {
                "ifc_classes": ["IfcDoor"],
                "storey_tokens": [],
                "property_filters": [],
                "name_contains": [],
                "consumed_spans": [{"start": 0, "end": 7, "field": "ifc_classes", "filter_index": 0}],
            },
        ),
        (
            "4F",
            {
                "ifc_classes": [],
                "storey_tokens": ["4"],
                "property_filters": [],
                "name_contains": [],
                "consumed_spans": [{"start": 0, "end": 2, "field": "storey_tokens", "filter_index": 0}],
            },
        ),
        (
            "FireRating < 60",
            {
                "ifc_classes": [],
                "storey_tokens": [],
                "property_filters": [{"name": "FireRating", "op": "<", "value": 60}],
                "name_contains": [],
                "consumed_spans": [
                    {"start": 0, "end": 15, "field": "property_filters", "filter_index": 0}
                ],
            },
        ),
        (
            "Entrance",
            {
                "ifc_classes": [],
                "storey_tokens": [],
                "property_filters": [],
                "name_contains": ["Entrance"],
                "consumed_spans": [{"start": 0, "end": 8, "field": "name_contains", "filter_index": 0}],
            },
        ),
    ],
)
def test_structured_filters_validate_each_consumed_span_field(query, payload):
    filters = filters_from_structured_dict(query, payload, source="llm")
    assert filters.schema_valid is True
    assert filters.complete is True


@pytest.mark.parametrize("value", ["NaN", "Infinity", float("nan"), float("inf")])
def test_structured_filters_reject_non_finite_numeric_values(value):
    f = filters_from_structured_dict(
        "FireRating < 60",
        {
            "ifc_classes": [],
            "storey_tokens": [],
            "property_filters": [{"name": "FireRating", "op": "<", "value": value}],
            "name_contains": [],
            "consumed_spans": [{"start": 0, "end": 15, "field": "property_filters", "filter_index": 0}],
        },
        source="llm",
    )
    assert f.schema_valid is False
    assert "invalid_property_value" in f.validation_errors


def test_structured_filters_reject_unknown_ifc_class():
    f = filters_from_structured_dict(
        "IfcBogus",
        {
            "ifc_classes": ["IfcBogus"],
            "storey_tokens": [],
            "property_filters": [],
            "name_contains": [],
            "consumed_spans": [{"start": 0, "end": 8, "field": "ifc_classes", "filter_index": 0}],
        },
        source="llm",
    )
    assert f.schema_valid is False
    assert f.usable is False
    assert "invalid_ifc_class" in f.validation_errors


def test_structured_filters_reject_unbound_extra_normalized_filter():
    f = filters_from_structured_dict(
        "IfcDoor",
        {
            "ifc_classes": ["IfcDoor", "IfcWall"],
            "storey_tokens": [],
            "property_filters": [],
            "name_contains": [],
            "consumed_spans": [{"start": 0, "end": 7, "field": "ifc_classes", "filter_index": 0}],
        },
        source="llm",
    )
    assert f.schema_valid is False
    assert f.complete is False
    assert "unbound_normalized_filter" in f.validation_errors


def test_llm_status_without_key(client):
    res = client.get("/api/search/llm-status")
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is False
    assert body["enabled"] is False
    assert "api_key" not in body
    assert "authorization" not in str(body).lower()
    assert "base_url" not in body
    assert "endpoint" not in body
    assert body["state"] == "disabled"
    assert "http://" not in str(body).lower()
    assert "https://" not in str(body).lower()
    assert "config_source_keys" in body


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
            '"name_contains":[],"consumed_spans":['
            '{"start":2,"end":4,"field":"storey_tokens","filter_index":0},'
            '{"start":5,"end":6,"field":"ifc_classes","filter_index":0},'
            '{"start":6,"end":15,"field":"property_filters","filter_index":0}]}'
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
    assert "mocked" not in str(body)
    guids = {r["ifc_guid"] for r in body["results"]}
    assert "0A4DoorLow000000000001" in guids
    assert any(e.get("kind") == "llm" for e in body["evidence_refs"])


def test_auto_attempts_model_once_before_partial_confirmation_and_never_scans(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    calls = {"llm": 0}

    def fake_chat(**_kwargs):
        calls["llm"] += 1
        return (
            '{"ifc_classes":["IfcDoor"],"storey_tokens":[],"property_filters":[],"name_contains":[],'
            '"consumed_spans":[{"start":0,"end":7,"field":"ifc_classes","filter_index":0}]}'
        )

    def fail_open(_path):
        raise AssertionError("incomplete auto candidate must not scan IFC")

    monkeypatch.setattr(engine_mod, "chat_completion", fake_chat)
    monkeypatch.setattr(engine_mod, "open_model", fail_open)
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

    body = run_model_search(
        SearchRequest(
            ifc_source_path=str(a4_ifc),
            query="IfcDoor within 3m of exit",
            interpret_mode="auto",
        )
    )
    assert calls["llm"] == 1
    assert body["status"] == "partial_fallback_requires_trusted_context"
    assert body["results"] == []
    assert body["stats"]["scanned"] == 0
    assert body["proof_eligible"] is False
    assert body["partial_confirmation_available"] is False


def test_auto_attempts_model_once_for_unusable_deterministic_query(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    calls = {"llm": 0}

    def fake_chat(**_kwargs):
        calls["llm"] += 1
        return '{"ifc_classes":[],"storey_tokens":[],"property_filters":[],"name_contains":[],"consumed_spans":[]}'

    monkeypatch.setattr(engine_mod, "chat_completion", fake_chat)
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig("http://127.0.0.1:9/v1", "test-key-not-real", "Ornith-1.0-35B", 5, True),
    )
    body = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query="??? ###", interpret_mode="auto"))
    assert calls["llm"] == 1
    assert body["status"] == "semantic_error"
    assert body["stats"]["scanned"] == 0


def test_semantic_schema_invalid_candidate_never_scans(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    monkeypatch.setattr(engine_mod, "chat_completion", lambda **_kwargs: '{"ifc_classes":"IfcDoor"}')
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
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
    body = run_model_search(
        SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor", interpret_mode="semantic")
    )
    assert body["status"] == "semantic_error"
    assert body["error_code"] == "semantic_candidate_invalid"
    assert body["stats"]["scanned"] == 0
    assert body["proof_eligible"] is False


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
            base_url="http://127.0.0.1:9/v1",
            api_key="",
                model="Ornith-1.0-35B",
                timeout_s=5,
                enabled=False,
                transport_class="loopback_tunnel",
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
    assert body["status"] == "semantic_error"
    assert body["error_code"] == "llm_disabled"
    assert body.get("next_step")


def test_semantic_llm_omission_of_non_proximity_constraint_never_scans(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    # The model proposes only the class even though the raw property constraint
    # remains outside its consumed span.  Server coverage must reject execution.
    monkeypatch.setattr(
        engine_mod,
        "chat_completion",
        lambda **_kwargs: (
            '{"ifc_classes":["IfcDoor"],"storey_tokens":[],"property_filters":[],"name_contains":[],'
            '"consumed_spans":[{"start":0,"end":7,"field":"ifc_classes","filter_index":0}]}'
        ),
    )
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig("http://127.0.0.1:9/v1", "test-key-not-real", "Ornith-1.0-35B", 5, True),
    )
    body = run_model_search(
        SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor FireRating < 60", interpret_mode="semantic")
    )
    assert body["status"] == "semantic_error"
    assert body["stats"]["scanned"] == 0


def test_semantic_llm_cannot_consume_unsupported_proximity_as_property(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    monkeypatch.setattr(
        engine_mod,
        "chat_completion",
        lambda **_kwargs: (
            '{"ifc_classes":["IfcDoor"],"storey_tokens":[],"property_filters":'
            '[{"name":"FireRating","op":"<","value":60}],"name_contains":[],"consumed_spans":['
            '{"start":0,"end":7,"field":"ifc_classes","filter_index":0},'
            '{"start":8,"end":33,"field":"property_filters","filter_index":0}]}'
        ),
    )
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig("http://127.0.0.1:9/v1", "test-key-not-real", "Ornith-1.0-35B", 5, True),
    )
    body = run_model_search(
        SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor FireRating < 60 within 3m", interpret_mode="semantic")
    )
    assert body["status"] == "semantic_error"
    assert body["stats"]["scanned"] == 0


def test_semantic_llm_cannot_hide_unsupported_text_inside_consumed_span(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    query = "IfcDoor owned by Bob"
    monkeypatch.setattr(
        engine_mod,
        "chat_completion",
        lambda **_kwargs: (
            '{"ifc_classes":["IfcDoor"],"storey_tokens":[],"property_filters":[],"name_contains":[],'
            f'"consumed_spans":[{{"start":0,"end":{len(query)},"field":"ifc_classes","filter_index":0}}]}}'
        ),
    )
    monkeypatch.setattr(engine_mod, "open_model", lambda _path: (_ for _ in ()).throw(AssertionError("must not scan")))
    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig("http://127.0.0.1:9/v1", "test-key-not-real", "Ornith-1.0-35B", 5, True),
    )
    body = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query=query, interpret_mode="semantic"))
    assert body["status"] == "semantic_error"
    assert body["stats"]["scanned"] == 0
    assert "consumed_span_not_exact_field_anchor" in body["interpreted_filters"]["validation_errors"]


def test_llm_config_rejects_alias_conflict_and_untrusted_http_without_outbound(monkeypatch):
    import search.llm_client as llm_mod

    for name in (
        "A4_LLM_BASE_URL", "ORNITH_API_BASE", "A4_LLM_API_KEY", "ORNITH_API_KEY", "A4_LLM_MODEL",
        "ORNITH_MODEL", "A4_LLM_TIMEOUT_S", "ORNITH_TIMEOUT_S", "A4_LLM_ENABLED", "ORNITH_ENABLED",
        "A4_LLM_ALLOW_INSECURE", "A4_LLM_PROFILE", "ORNITH_PROFILE", "A4_LLM_HTTP_ALLOWLIST",
        "A4_LLM_TRANSPORT_MODE", "ORNITH_TRANSPORT_MODE",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("A4_LLM_ENABLED", "true")
    monkeypatch.setenv("A4_LLM_API_KEY", "test-key-not-real")
    monkeypatch.setenv("A4_LLM_BASE_URL", "http://example.invalid/v1")
    calls = {"open": 0}
    monkeypatch.setattr(llm_mod, "_open_request", lambda *_args, **_kwargs: calls.__setitem__("open", calls["open"] + 1))
    cfg = load_llm_config()
    assert cfg.enabled is False
    assert cfg.config_error == "llm_config_invalid"
    with pytest.raises(LlmError, match="invalid") as exc:
        chat_completion(user_content="test", config=cfg)
    assert exc.value.code == "llm_config_invalid"
    assert calls["open"] == 0

    monkeypatch.setenv("ORNITH_API_BASE", "https://different.example.invalid/v1")
    conflict = load_llm_config()
    assert conflict.config_error == "llm_config_invalid"
    assert conflict.enabled is False


def test_llm_config_requires_explicit_profile_mode_and_rejects_localhost(monkeypatch):
    for name in (
        "A4_LLM_BASE_URL", "ORNITH_API_BASE", "A4_LLM_API_KEY", "ORNITH_API_KEY", "A4_LLM_MODEL",
        "ORNITH_MODEL", "A4_LLM_TIMEOUT_S", "ORNITH_TIMEOUT_S", "A4_LLM_ENABLED", "ORNITH_ENABLED",
        "A4_LLM_ALLOW_INSECURE", "A4_LLM_PROFILE", "ORNITH_PROFILE", "A4_LLM_HTTP_ALLOWLIST",
        "A4_LLM_TRANSPORT_MODE", "ORNITH_TRANSPORT_MODE",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("A4_LLM_ENABLED", "true")
    monkeypatch.setenv("A4_LLM_API_KEY", "test-key-not-real")
    monkeypatch.setenv("A4_LLM_MODEL", "Ornith-1.0-35B")
    monkeypatch.setenv("A4_LLM_TIMEOUT_S", "5")
    monkeypatch.setenv("A4_LLM_BASE_URL", "http://127.0.0.1:9/v1")
    missing_explicit = load_llm_config()
    assert missing_explicit.config_error == "llm_config_invalid"

    monkeypatch.setenv("A4_LLM_PROFILE", "local-dev")
    monkeypatch.setenv("A4_LLM_TRANSPORT_MODE", "loopback_tunnel")
    monkeypatch.setenv("A4_LLM_BASE_URL", "http://localhost:9/v1")
    localhost = load_llm_config()
    assert localhost.config_error == "llm_config_invalid"
    assert localhost.enabled is False

    monkeypatch.setenv("A4_LLM_BASE_URL", "http://127.0.0.1:9/v1")
    valid = load_llm_config()
    assert valid.enabled is True
    assert valid.public_status()["state"] == "unknown"

    monkeypatch.setenv("A4_LLM_MODEL", "https://model.internal/v1")
    endpoint_shaped_model = load_llm_config()
    assert endpoint_shaped_model.enabled is False
    assert endpoint_shaped_model.config_error == "llm_config_invalid"


def test_trusted_lab_http_requires_literal_private_allowlisted_address(monkeypatch):
    for name in (
        "A4_LLM_BASE_URL", "ORNITH_API_BASE", "A4_LLM_API_KEY", "ORNITH_API_KEY", "A4_LLM_MODEL",
        "ORNITH_MODEL", "A4_LLM_TIMEOUT_S", "ORNITH_TIMEOUT_S", "A4_LLM_ENABLED", "ORNITH_ENABLED",
        "A4_LLM_ALLOW_INSECURE", "A4_LLM_PROFILE", "ORNITH_PROFILE", "A4_LLM_HTTP_ALLOWLIST",
        "A4_LLM_TRANSPORT_MODE", "ORNITH_TRANSPORT_MODE",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("A4_LLM_ENABLED", "true")
    monkeypatch.setenv("A4_LLM_API_KEY", "test-key-not-real")
    monkeypatch.setenv("A4_LLM_MODEL", "Ornith-1.0-35B")
    monkeypatch.setenv("A4_LLM_TIMEOUT_S", "5")
    monkeypatch.setenv("A4_LLM_PROFILE", "trusted_lab_http")
    monkeypatch.setenv("A4_LLM_TRANSPORT_MODE", "trusted_lab_http")
    monkeypatch.setenv("A4_LLM_ALLOW_INSECURE", "true")

    monkeypatch.setenv("A4_LLM_BASE_URL", "http://lab-gateway.invalid/v1")
    monkeypatch.setenv("A4_LLM_HTTP_ALLOWLIST", "lab-gateway.invalid")
    hostname = load_llm_config()
    assert hostname.enabled is False
    assert hostname.config_error == "llm_config_invalid"

    monkeypatch.setenv("A4_LLM_BASE_URL", "http://192.168.10.248:18080/v1")
    monkeypatch.setenv("A4_LLM_HTTP_ALLOWLIST", "192.168.10.248")
    private_ip = load_llm_config()
    assert private_ip.enabled is True
    assert private_ip.transport_class == "trusted_lab_http"

    monkeypatch.setenv("A4_LLM_BASE_URL", "http://8.8.8.8:18080/v1")
    monkeypatch.setenv("A4_LLM_HTTP_ALLOWLIST", "8.8.8.8")
    public_ip = load_llm_config()
    assert public_ip.enabled is False
    assert public_ip.config_error == "llm_config_invalid"


@pytest.mark.parametrize("timeout", ["NaN", "Infinity", "0", "-1", "121"])
def test_llm_config_rejects_invalid_timeout(monkeypatch, timeout):
    monkeypatch.setenv("A4_LLM_ENABLED", "true")
    monkeypatch.setenv("A4_LLM_API_KEY", "test-key-not-real")
    monkeypatch.setenv("A4_LLM_BASE_URL", "https://model.example.invalid/v1")
    monkeypatch.setenv("A4_LLM_TIMEOUT_S", timeout)
    monkeypatch.delenv("ORNITH_TIMEOUT_S", raising=False)
    cfg = load_llm_config()
    assert cfg.enabled is False
    assert cfg.config_error == "llm_config_invalid"


def test_llm_client_rejects_non_terminal_and_malformed_completion(monkeypatch):
    import search.llm_client as llm_mod

    class Response:
        def __init__(self, body):
            self.body = body
            self.read_once = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _size=-1):
            if self.read_once:
                return b""
            self.read_once = True
            return self.body.encode("utf-8")

    config = LlmConfig(
        "http://127.0.0.1:9/v1",
        "test-key-not-real",
        "Ornith-1.0-35B",
        5,
        True,
        transport_class="loopback_tunnel",
    )
    monkeypatch.setattr(
        llm_mod,
        "_open_request",
        lambda *_args, **_kwargs: Response('{"model":"Ornith-1.0-35B","choices":[{"finish_reason":"length","message":{"content":"{}"}}]}'),
    )
    with pytest.raises(LlmError) as exc:
        chat_completion(user_content="test", config=config)
    assert exc.value.code == "llm_non_terminal"

    monkeypatch.setattr(llm_mod, "_open_request", lambda *_args, **_kwargs: Response("not json"))
    with pytest.raises(LlmError) as exc:
        chat_completion(user_content="test", config=config)
    assert exc.value.code == "llm_bad_json"


def test_llm_client_rejects_declared_and_streamed_oversized_responses(monkeypatch):
    import search.llm_client as llm_mod

    class Response:
        def __init__(self, *, headers=None, chunks=None):
            self.headers = headers or {}
            self.chunks = list(chunks or [])
            self.read_sizes = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, size=-1):
            self.read_sizes.append(size)
            return self.chunks.pop(0) if self.chunks else b""

    config = LlmConfig(
        "http://127.0.0.1:9/v1",
        "test-key-not-real",
        "Ornith-1.0-35B",
        5,
        True,
        transport_class="loopback_tunnel",
    )

    declared = Response(headers={"Content-Length": str(llm_mod.MAX_RESPONSE_BYTES + 1)})
    monkeypatch.setattr(llm_mod, "_open_request", lambda *_args, **_kwargs: declared)
    with pytest.raises(LlmError) as exc:
        chat_completion(user_content="test", config=config)
    assert exc.value.code == "llm_response_too_large"
    assert declared.read_sizes == []

    streamed = Response(chunks=[b"x" * (llm_mod.MAX_RESPONSE_BYTES + 1)])
    monkeypatch.setattr(llm_mod, "_open_request", lambda *_args, **_kwargs: streamed)
    with pytest.raises(LlmError) as exc:
        chat_completion(user_content="test", config=config)
    assert exc.value.code == "llm_response_too_large"
    assert streamed.read_sizes == [llm_mod.RESPONSE_READ_CHUNK_BYTES]


def test_llm_client_rejects_redirect_without_following_it(monkeypatch):
    import search.llm_client as llm_mod

    config = LlmConfig(
        "http://127.0.0.1:9/v1",
        "test-key-not-real",
        "Ornith-1.0-35B",
        5,
        True,
        transport_class="loopback_tunnel",
    )

    def redirect(*_args, **_kwargs):
        raise llm_mod.urllib.error.HTTPError("http://127.0.0.1:9/v1", 302, "Found", {}, None)

    monkeypatch.setattr(llm_mod, "_open_request", redirect)
    with pytest.raises(LlmError) as exc:
        chat_completion(user_content="test", config=config)
    assert exc.value.code == "llm_redirect_rejected"


def test_completion_metadata_is_retained_without_raw_body(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    monkeypatch.setattr(
        engine_mod,
        "chat_completion",
        lambda **_kwargs: CompletionResult(
            content=(
                '{"ifc_classes":["IfcDoor"],"storey_tokens":[],"property_filters":[],"name_contains":[],'
                '"consumed_spans":[{"start":0,"end":7,"field":"ifc_classes","filter_index":0}]}'
            ),
            served_model="Ornith-1.0-35B",
            finish_reason="stop",
            latency_ms=12,
        ),
    )
    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig("http://127.0.0.1:9/v1", "test-key-not-real", "Ornith-1.0-35B", 5, True),
    )
    body = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor", interpret_mode="semantic"))
    assert body["status"] == "ok"
    trace = next(item for item in body["evidence_refs"] if item.get("kind") == "llm_result")
    assert trace["served_model"] == "Ornith-1.0-35B"
    assert trace["finish_reason"] == "stop"
    assert trace["latency_ms"] == 12
    assert body["model_invocation"] == {
        "attempted": True,
        "served_model": "Ornith-1.0-35B",
        "finish_reason": "stop",
        "latency_ms": 12,
        "error_code": None,
    }


def test_model_metadata_rejects_endpoint_shaped_value(a4_ifc, monkeypatch):
    import search.engine as engine_mod
    from search.llm_client import LlmConfig

    monkeypatch.setattr(
        engine_mod,
        "chat_completion",
        lambda **_kwargs: CompletionResult(
            content=(
                '{"ifc_classes":["IfcDoor"],"storey_tokens":[],"property_filters":[],"name_contains":[],'
                '"consumed_spans":[{"start":0,"end":7,"field":"ifc_classes","filter_index":0}]}'
            ),
            served_model="https://model.internal/v1",
            finish_reason="stop",
            latency_ms=12,
        ),
    )
    monkeypatch.setattr(
        engine_mod,
        "load_llm_config",
        lambda: LlmConfig("http://127.0.0.1:9/v1", "test-key-not-real", "Ornith-1.0-35B", 5, True),
    )
    body = run_model_search(SearchRequest(ifc_source_path=str(a4_ifc), query="IfcDoor", interpret_mode="semantic"))
    assert body["status"] == "ok"
    assert body["model_invocation"]["served_model"] is None
    assert "model.internal" not in str(body)
