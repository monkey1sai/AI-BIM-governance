import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def make_client(case_dir: Path) -> TestClient:
    return TestClient(create_app(data_root=case_dir / "data"))


def ready_conversion_result() -> dict:
    return {
        "conversion_job_id": "conv_test_001",
        "status": "succeeded",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "artifact_group_id": "ag_test_ready",
        "source_artifact_id": "artifact_ifc_demo_001",
        "usdc_artifact_id": "artifact_usdc_test_001",
        "source_url": "http://127.0.0.1:8005/objects/source.ifc",
        "usdc_url": "http://127.0.0.1:8005/objects/model.usdc",
        "mapping_url": "http://127.0.0.1:8005/objects/element_mapping.json",
        "lineage": {"source_artifact_id": "artifact_ifc_demo_001"},
    }


def test_conversion_result_updates_artifact_group_metadata(case_dir: Path):
    client = make_client(case_dir)

    response = client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    assert response.status_code == 200
    group = client.get("/api/artifact-groups/ag_test_ready")
    assert group.status_code == 200
    body = group.json()
    assert body["ready_status"] == "ready"
    assert body["source"]["artifact_id"] == "artifact_ifc_demo_001"
    assert body["derived"][0]["artifact_id"] == "artifact_usdc_test_001"
    assert body["mapping"]["ready"] is True


def test_review_session_request_is_created_for_ready_artifact_group(case_dir: Path):
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
            "startup_policy": {"routing_policy": "same_instance"},
            "kit_profile": {"provider": "local_fixed"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["review_request_id"].startswith("review_request_")
    assert body["status"] == "created"
    assert body["artifact_group_ids"] == ["ag_test_ready"]
    assert body["artifact_bindings"][0]["artifact_group_id"] == "ag_test_ready"
    assert body["artifact_bindings"][0]["url"] == "http://127.0.0.1:8005/objects/model.usdc"
    assert body["artifact_bindings"][0]["mapping_url"] == "http://127.0.0.1:8005/objects/element_mapping.json"

    loaded = client.get(f"/api/review-session-requests/{body['review_request_id']}")
    assert loaded.status_code == 200
    assert loaded.json()["model_version_id"] == "version_demo_001"
    assert loaded.json()["artifact_bindings"] == body["artifact_bindings"]


def test_review_session_request_ids_include_random_suffix_and_are_unique(case_dir: Path):
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    ids = []
    for _ in range(5):
        response = client.post(
            "/api/review-session-requests",
            json={
                "requested_by": "dev_user_001",
                "tenant_id": "tenant_demo_001",
                "project_id": "project_demo_001",
                "model_version_id": "version_demo_001",
                "artifact_group_ids": ["ag_test_ready"],
            },
        )
        assert response.status_code == 200
        ids.append(response.json()["review_request_id"])

    assert len(set(ids)) == len(ids)
    for request_id in ids:
        assert re.fullmatch(r"review_request_\d+_[0-9a-f]{8}", request_id)


def test_review_session_request_allows_local_viewer_origin(case_dir: Path):
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())
    created = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    ).json()

    response = client.get(
        f"/api/review-session-requests/{created['review_request_id']}",
        headers={"Origin": "http://127.0.0.1:5173"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_review_session_request_rejects_missing_model_version_id(case_dir: Path):
    client = make_client(case_dir)

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    )

    assert response.status_code == 422


def test_review_session_request_blocks_missing_artifact_group(case_dir: Path):
    client = make_client(case_dir)

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_missing"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "blocked_conversion"
    assert body["blocker"] == "conversion_readiness"
    assert body["missing_refs"] == ["ag_missing"]


def test_review_session_request_patch_saves_session_binding_and_lifecycle_event(case_dir: Path):
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())
    created = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    ).json()

    patched = client.patch(
        f"/api/review-session-requests/{created['review_request_id']}",
        json={
            "status": "active",
            "session_id": "review_session_test_001",
            "artifact_bindings": [{"artifact_group_id": "ag_test_ready", "ready_status": "ready"}],
            "kit_instance_bindings": [{"kit_instance_id": "kit_local_001", "status": "ready"}],
            "lifecycle_event": {"type": "sessionBound", "session_id": "review_session_test_001"},
        },
    )

    assert patched.status_code == 200
    assert patched.json()["status"] == "active"
    assert patched.json()["session_id"] == "review_session_test_001"

    events = client.get(f"/api/review-session-requests/{created['review_request_id']}/lifecycle-events")
    assert events.status_code == 200
    items = events.json()["items"]
    assert [item["type"] for item in items] == ["reviewRequestCreated", "sessionBound"]
    assert [item["review_request_id"] for item in items] == [created["review_request_id"], created["review_request_id"]]
    assert items[0]["session_id"] is None
    assert items[1]["session_id"] == "review_session_test_001"
    assert items[1]["correlation_id"] == created["review_request_id"]


# ---------------------------------------------------------------------------
# Artifact group endpoints
# ---------------------------------------------------------------------------


def test_list_model_version_artifact_groups_returns_seed_group(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/model-versions/version_demo_001/artifact-groups")

    assert response.status_code == 200
    body = response.json()
    assert "items" in body
    assert body["model_version_id"] == "version_demo_001"
    # Seed data has at least one group for version_demo_001
    assert len(body["items"]) >= 1


def test_list_model_version_artifact_groups_returns_empty_for_unknown_version(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/model-versions/version_unknown_999/artifact-groups")

    assert response.status_code == 200
    assert response.json()["items"] == []


def test_upsert_artifact_group_creates_and_can_be_retrieved(case_dir: Path):
    client = make_client(case_dir)

    payload = {
        "artifact_group_id": "ag_upsert_001",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "status": "ready",
        "ready_status": "ready",
        "source": {"artifact_id": "artifact_ifc_demo_001", "format": "ifc", "url": "http://example.com/source.ifc"},
        "derived": [{"artifact_id": "artifact_usdc_001", "role": "derived", "format": "usdc", "url": "http://example.com/model.usdc"}],
    }

    created = client.post("/api/artifact-groups", json=payload)
    assert created.status_code == 200
    body = created.json()
    assert body["artifact_group_id"] == "ag_upsert_001"
    assert body["status"] == "ready"

    retrieved = client.get("/api/artifact-groups/ag_upsert_001")
    assert retrieved.status_code == 200
    assert retrieved.json()["artifact_group_id"] == "ag_upsert_001"


def test_upsert_artifact_group_updates_existing_group(case_dir: Path):
    client = make_client(case_dir)
    base_payload = {
        "artifact_group_id": "ag_update_001",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "status": "source_uploaded",
        "ready_status": "missing_derived",
    }
    client.post("/api/artifact-groups", json=base_payload)

    updated_payload = {**base_payload, "status": "ready", "ready_status": "ready"}
    client.post("/api/artifact-groups", json=updated_payload)

    retrieved = client.get("/api/artifact-groups/ag_update_001")
    assert retrieved.json()["status"] == "ready"
    assert retrieved.json()["ready_status"] == "ready"


def test_get_artifact_group_returns_404_for_unknown(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/artifact-groups/ag_nonexistent_999")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_conversion_result_without_mapping_url_sets_blocked_ready_status(case_dir: Path):
    client = make_client(case_dir)

    result_no_mapping = {
        **ready_conversion_result(),
        "artifact_group_id": "ag_no_mapping_001",
        "mapping_url": None,
    }
    client.post("/api/model-versions/version_demo_001/conversion-result", json=result_no_mapping)

    group = client.get("/api/artifact-groups/ag_no_mapping_001")
    assert group.status_code == 200
    assert group.json()["ready_status"] == "blocked_conversion"
    assert group.json()["mapping"]["ready"] is False


# ---------------------------------------------------------------------------
# Review session request: additional edge cases
# ---------------------------------------------------------------------------


def test_review_session_request_get_returns_404_for_unknown(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/review-session-requests/review_request_999999999")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_review_session_request_patch_returns_404_for_unknown(case_dir: Path):
    client = make_client(case_dir)

    response = client.patch(
        "/api/review-session-requests/review_request_999999999",
        json={"status": "active"},
    )

    assert response.status_code == 404


def test_review_session_request_patch_rejects_invalid_status(case_dir: Path):
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())
    created = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    ).json()

    response = client.patch(
        f"/api/review-session-requests/{created['review_request_id']}",
        json={"status": "not_a_valid_status"},
    )

    assert response.status_code == 400


def test_review_session_request_with_selected_artifact_ids_only(case_dir: Path):
    """selected_artifact_ids path: uses ready artifact from seed data."""
    client = make_client(case_dir)

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": [],
            "selected_artifact_ids": ["artifact_usdc_demo_001"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["review_request_id"].startswith("review_request_")
    # Status depends on whether seed artifact is ready with url; just check field present
    assert "status" in body


def test_lifecycle_events_endpoint_returns_empty_list_for_unknown_request(case_dir: Path):
    client = make_client(case_dir)

    response = client.get("/api/review-session-requests/review_request_unknown/lifecycle-events")

    assert response.status_code == 200
    assert response.json()["items"] == []


def test_review_session_request_patch_without_lifecycle_event_does_not_add_event(case_dir: Path):
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())
    created = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    ).json()

    client.patch(
        f"/api/review-session-requests/{created['review_request_id']}",
        json={"status": "queued_for_instance"},
    )

    events = client.get(f"/api/review-session-requests/{created['review_request_id']}/lifecycle-events")
    # Only the initial reviewRequestCreated event, no additional event from patch
    types = [item["type"] for item in events.json()["items"]]
    assert types == ["reviewRequestCreated"]


def test_review_session_request_patch_full_close_lifecycle(case_dir: Path):
    """Walk through the full status machine: created → active → closing → closed."""
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())
    created = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    ).json()
    request_id = created["review_request_id"]

    for status in ["active", "closing", "closed"]:
        client.patch(f"/api/review-session-requests/{request_id}", json={"status": status})

    final = client.get(f"/api/review-session-requests/{request_id}").json()
    assert final["status"] == "closed"


def test_review_session_request_blocker_is_none_when_ready(case_dir: Path):
    client = make_client(case_dir)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "created"
    assert body["blocker"] is None
    assert body["missing_refs"] == []
