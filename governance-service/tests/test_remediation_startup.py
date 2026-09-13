"""An upgraded service can serve history as its very first request."""
import importlib
import sqlite3
from contextlib import closing

from fastapi.testclient import TestClient
from issues import api
from test_issue_remediation import make_case
from test_issue_remediation_history import grant


def test_startup_migrates_legacy_database_before_first_history_request(tmp_path, monkeypatch):
    case = make_case(tmp_path)
    monkeypatch.setenv("GOV_DB_PATH", case.path)
    monkeypatch.setattr(api, "_store", None)
    with closing(sqlite3.connect(case.path)) as conn:
        conn.execute("DROP TABLE issue_remediation_confirmations")
        conn.commit()
    import app as service
    importlib.reload(service)
    service.app.dependency_overrides[api.get_remediation_history_authorizer] = lambda: lambda context: grant(case)
    try:
        with TestClient(service.app) as client:
            # Startup must migrate; reading history itself must remain read-only.
            with closing(sqlite3.connect(case.path)) as conn:
                assert conn.execute("SELECT name FROM sqlite_master WHERE name='issue_remediation_confirmations'").fetchone()
            monkeypatch.setattr(api, "_get_store", lambda: (_ for _ in ()).throw(AssertionError("GET must not migrate")))
            response = client.get(f"/api/issues/{case.command.issue_id}/remediation-history")
            assert response.status_code == 200
            assert response.json()["items"] == []
            assert response.json()["issue"]["id"] == case.command.issue_id
    finally:
        service.app.dependency_overrides.clear()
