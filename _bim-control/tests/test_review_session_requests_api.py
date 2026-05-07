import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def make_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(data_root=tmp_path / "data"))


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


def test_conversion_result_updates_artifact_group_metadata(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    assert response.status_code == 200
    group = client.get("/api/artifact-groups/ag_test_ready")
    assert group.status_code == 200
    body = group.json()
    assert body["ready_status"] == "ready"
    assert body["source"]["artifact_id"] == "artifact_ifc_demo_001"
    assert body["derived"][0]["artifact_id"] == "artifact_usdc_test_001"
    assert body["mapping"]["ready"] is True


def test_review_session_request_is_created_for_ready_artifact_group(tmp_path: Path):
    client = make_client(tmp_path)
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
    assert body["artifact_bindings"] == [
        {
            "binding_id": "binding_1",
            "artifact_group_id": "ag_test_ready",
            "model_version_id": "version_demo_001",
            "artifact_id": "artifact_usdc_test_001",
            "artifact_role": "derived",
            "url": "http://127.0.0.1:8005/objects/model.usdc",
            "mapping_url": "http://127.0.0.1:8005/objects/element_mapping.json",
            "load_order": 0,
            "routing_policy": "same_instance",
            "ready_status": "ready",
        }
    ]

    loaded = client.get(f"/api/review-session-requests/{body['review_request_id']}")
    assert loaded.status_code == 200
    assert loaded.json()["model_version_id"] == "version_demo_001"
    assert loaded.json()["artifact_bindings"][0]["artifact_id"] == "artifact_usdc_test_001"


def test_review_session_request_ids_include_random_suffix_and_are_unique(tmp_path: Path):
    client = make_client(tmp_path)
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


def test_review_session_request_builds_bindings_from_selected_artifacts(tmp_path: Path):
    client = make_client(tmp_path)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "tenant_id": "tenant_demo_001",
            "project_id": "project_demo_001",
            "model_version_id": "version_demo_001",
            "selected_artifact_ids": ["artifact_usdc_test_001"],
            "startup_policy": {"routing_policy": "dedicated_instance"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "created"
    assert body["artifact_bindings"][0]["artifact_id"] == "artifact_usdc_test_001"
    assert body["artifact_bindings"][0]["artifact_group_id"] == "ag_version_demo_001"
    assert body["artifact_bindings"][0]["routing_policy"] == "dedicated_instance"
    assert body["artifact_bindings"][0]["mapping_url"].endswith("element_mapping.json")


def test_review_session_request_allows_local_viewer_origin(tmp_path: Path):
    client = make_client(tmp_path)
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


def test_review_session_request_rejects_missing_model_version_id(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    )

    assert response.status_code == 422


def test_review_session_request_blocks_missing_artifact_group(tmp_path: Path):
    client = make_client(tmp_path)

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


def test_review_session_request_patch_saves_session_binding_and_lifecycle_event(tmp_path: Path):
    client = make_client(tmp_path)
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
    assert [item["type"] for item in events.json()["items"]] == ["reviewRequestCreated", "sessionBound"]


# ---------------------------------------------------------------------------
# Additional artifact group tests
# ---------------------------------------------------------------------------


def test_artifact_group_upsert_creates_and_retrieves(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post(
        "/api/artifact-groups",
        json={
            "artifact_group_id": "ag_new_001",
            "model_version_id": "version_demo_001",
            "status": "ready",
            "ready_status": "ready",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["artifact_group_id"] == "ag_new_001"

    fetched = client.get("/api/artifact-groups/ag_new_001")
    assert fetched.status_code == 200
    assert fetched.json()["ready_status"] == "ready"


def test_artifact_group_upsert_updates_existing(tmp_path: Path):
    client = make_client(tmp_path)
    client.post(
        "/api/artifact-groups",
        json={"artifact_group_id": "ag_update_001", "model_version_id": "version_demo_001", "status": "source_uploaded", "ready_status": "missing_derived"},
    )

    response = client.post(
        "/api/artifact-groups",
        json={"artifact_group_id": "ag_update_001", "model_version_id": "version_demo_001", "status": "ready", "ready_status": "ready"},
    )

    assert response.status_code == 200
    assert response.json()["ready_status"] == "ready"
    fetched = client.get("/api/artifact-groups/ag_update_001")
    assert fetched.json()["ready_status"] == "ready"


def test_artifact_group_get_returns_404_for_unknown(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/api/artifact-groups/ag_missing_xyz")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_list_model_version_artifact_groups_returns_only_matching(tmp_path: Path):
    client = make_client(tmp_path)
    client.post(
        "/api/artifact-groups",
        json={"artifact_group_id": "ag_v1_001", "model_version_id": "version_001", "status": "ready", "ready_status": "ready"},
    )
    client.post(
        "/api/artifact-groups",
        json={"artifact_group_id": "ag_v2_001", "model_version_id": "version_002", "status": "ready", "ready_status": "ready"},
    )

    response = client.get("/api/model-versions/version_001/artifact-groups")

    assert response.status_code == 200
    items = response.json()["items"]
    assert all(item["model_version_id"] == "version_001" for item in items)
    group_ids = [item["artifact_group_id"] for item in items]
    assert "ag_v1_001" in group_ids
    assert "ag_v2_001" not in group_ids


# ---------------------------------------------------------------------------
# Review session request: additional edge cases
# ---------------------------------------------------------------------------


def test_review_session_request_with_no_refs_creates_blocked(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "blocked_conversion"
    assert body["artifact_bindings"] == []


def test_review_session_request_get_returns_404_for_unknown(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/api/review-session-requests/review_request_nonexistent")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_review_session_request_patch_returns_404_for_unknown(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.patch(
        "/api/review-session-requests/review_request_nonexistent",
        json={"status": "active"},
    )

    assert response.status_code == 404


def test_review_session_request_patch_rejects_invalid_status(tmp_path: Path):
    client = make_client(tmp_path)
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
        json={"status": "invalid_status_xyz"},
    )

    assert response.status_code == 400


def test_review_session_request_patch_allows_closing_status(tmp_path: Path):
    client = make_client(tmp_path)
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
        json={"status": "closing"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "closing"


def test_lifecycle_events_empty_for_nonexistent_request(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.get("/api/review-session-requests/review_request_none/lifecycle-events")

    # Returns empty items list, not 404 (filtering by request id)
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_lifecycle_events_contain_review_request_id_in_response(tmp_path: Path):
    client = make_client(tmp_path)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())
    created = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    ).json()

    events = client.get(f"/api/review-session-requests/{created['review_request_id']}/lifecycle-events")

    assert events.status_code == 200
    body = events.json()
    assert body["review_request_id"] == created["review_request_id"]
    assert len(body["items"]) >= 1
    for event in body["items"]:
        assert event["review_request_id"] == created["review_request_id"]


def test_conversion_result_with_failed_status_does_not_mark_ready(tmp_path: Path):
    client = make_client(tmp_path)
    failed_result = {
        "conversion_job_id": "conv_failed_001",
        "status": "failed",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "artifact_group_id": "ag_failed_001",
        "source_artifact_id": "artifact_ifc_demo_001",
        "usdc_artifact_id": "artifact_usdc_failed_001",
        "source_url": None,
        "usdc_url": None,
        "mapping_url": None,
        "lineage": {},
    }

    response = client.post("/api/model-versions/version_demo_001/conversion-result", json=failed_result)

    assert response.status_code == 200
    group = client.get("/api/artifact-groups/ag_failed_001")
    assert group.status_code == 200
    body = group.json()
    assert body["status"] != "ready"
    assert body["ready_status"] != "ready"


def test_review_request_record_stores_requested_by(tmp_path: Path):
    client = make_client(tmp_path)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "specific_user_007",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requested_by"] == "specific_user_007"
    fetched = client.get(f"/api/review-session-requests/{body['review_request_id']}")
    assert fetched.json()["requested_by"] == "specific_user_007"


def test_review_session_request_stores_startup_policy(tmp_path: Path):
    client = make_client(tmp_path)
    client.post("/api/model-versions/version_demo_001/conversion-result", json=ready_conversion_result())

    response = client.post(
        "/api/review-session-requests",
        json={
            "requested_by": "dev_user_001",
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
            "startup_policy": {"routing_policy": "dedicated_instance", "auto_start": True},
            "kit_profile": {"provider": "gpu_cloud", "tier": "standard"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["startup_policy"]["routing_policy"] == "dedicated_instance"
    assert body["kit_profile"]["provider"] == "gpu_cloud"


def test_review_session_request_missing_requested_by_returns_422(tmp_path: Path):
    client = make_client(tmp_path)

    response = client.post(
        "/api/review-session-requests",
        json={
            "model_version_id": "version_demo_001",
            "artifact_group_ids": ["ag_test_ready"],
        },
    )

    assert response.status_code == 422
