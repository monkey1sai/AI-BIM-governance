"""F4 BCF 匯出 — 驗證自寫 .bcfzip 結構正確、annotation 被排除、API 端點可用。"""
from __future__ import annotations

import importlib
import io
import xml.etree.ElementTree as ET
import zipfile

import pytest
from fastapi.testclient import TestClient

from bcf.bcf_writer import _iso, build_bcfzip


def _unzip(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist()}


def _sample_issue(**over) -> dict:
    base = {
        "kind": "issue",
        "ifc_guid": "1aB2cD3eF4gH5iJ6kL7mN8",
        "status": "open",
        "title": "牆缺防火時效",
        "severity": "high",
        "description": "IfcWall 缺 FireRating",
        "model_version_id": "mvB",
        "source_type": "rule_result",
        "created_at": "2026-06-01T10:00:00+00:00",
    }
    base.update(over)
    return base


def test_bcfzip_structure_and_version():
    data, count = build_bcfzip([_sample_issue()])
    assert count == 1
    files = _unzip(data)
    # bcf.version 必在，且宣告 2.1
    assert "bcf.version" in files
    ver = ET.fromstring(files["bcf.version"])
    assert ver.get("VersionId") == "2.1"
    # 一個 topic 目錄 → markup.bcf + viewpoint.bcfv
    markups = [n for n in files if n.endswith("/markup.bcf")]
    viewpoints = [n for n in files if n.endswith("/viewpoint.bcfv")]
    assert len(markups) == 1 and len(viewpoints) == 1
    # topic_guid 一致
    topic_dir = markups[0].split("/")[0]
    assert viewpoints[0].split("/")[0] == topic_dir


def test_markup_topic_fields():
    data, _ = build_bcfzip([_sample_issue()])
    files = _unzip(data)
    markup = ET.fromstring(next(v for n, v in files.items() if n.endswith("markup.bcf")))
    topic = markup.find("Topic")
    assert topic is not None
    assert topic.get("TopicStatus") == "Open"  # open → Open
    assert topic.get("Guid")  # topic 必有 guid
    assert topic.findtext("Title") == "牆缺防火時效"
    # comment 帶 model_version + ifc_guid（rule 4 綁版本）
    comment = markup.find("Comment").findtext("Comment")
    assert "model_version=mvB" in comment
    assert "ifc_guid=1aB2cD3eF4gH5iJ6kL7mN8" in comment


def test_viewpoint_component_uses_ifc_guid():
    """rule 3：viewpoint 的 Component 以 IFC GlobalId 定位。"""
    data, _ = build_bcfzip([_sample_issue(ifc_guid="ZZZguid000000000000001")])
    files = _unzip(data)
    vp = ET.fromstring(next(v for n, v in files.items() if n.endswith("viewpoint.bcfv")))
    comp = vp.find("Components/Selection/Component")
    assert comp is not None
    assert comp.get("IfcGuid") == "ZZZguid000000000000001"


def test_annotation_and_missing_guid_excluded():
    """rule 10：annotation / 無 ifc_guid 不匯出為正式 BCF issue。"""
    issues = [
        _sample_issue(),  # 正式 issue → 匯出
        _sample_issue(kind="annotation", ifc_guid="hasGuidButAnnotation00"),  # annotation → 排除
        _sample_issue(kind="issue", ifc_guid=None),  # 無 guid → 排除
        _sample_issue(kind="issue", ifc_guid=""),  # 空 guid → 排除
    ]
    data, count = build_bcfzip(issues)
    assert count == 1
    files = _unzip(data)
    assert len([n for n in files if n.endswith("markup.bcf")]) == 1


def test_status_mapping_resolved_to_closed():
    data, _ = build_bcfzip([_sample_issue(status="resolved")])
    files = _unzip(data)
    markup = ET.fromstring(next(v for n, v in files.items() if n.endswith("markup.bcf")))
    assert markup.find("Topic").get("TopicStatus") == "Closed"


def test_empty_issue_list_yields_zero():
    data, count = build_bcfzip([])
    assert count == 0
    files = _unzip(data)
    assert list(files) == ["bcf.version"]  # 只有 version、無 topic


def test_invalid_ifc_guid_excluded():
    """bcf-002：非 22 字元合法 IfcGuid 不匯出，避免產出違反 BCF 2.1 XSD 的 .bcfzip。"""
    data, count = build_bcfzip([_sample_issue(ifc_guid="TOO_SHORT")])
    assert count == 0
    files = _unzip(data)
    assert len([n for n in files if n.endswith("markup.bcf")]) == 0


def test_none_model_version_renders_unbound():
    """bcf-005：缺 model_version 時 comment 輸出 'unbound'，不得洩漏 Python None 字面。"""
    data, _ = build_bcfzip([_sample_issue(model_version_id=None)])
    files = _unzip(data)
    markup = ET.fromstring(next(v for n, v in files.items() if n.endswith("markup.bcf")))
    comment = markup.find("Comment").findtext("Comment")
    assert "model_version=unbound" in comment
    assert "model_version=None" not in comment


def test_naive_timestamp_treated_as_utc():
    """bcf-003：naive 時間戳視為 UTC，不吃系統本地時區偏移。"""
    assert _iso("2026-06-01T10:00:00") == "2026-06-01T10:00:00Z"


# ---- API 端點（掛載 + 過濾 + 404）----

@pytest.fixture()
def client_and_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "gov.db")
    monkeypatch.setenv("GOV_DB_PATH", db_path)
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app), db_path


def test_api_export_returns_bcfzip(client_and_db):
    client, db_path = client_and_db
    from issues.store import IssueStore

    store = IssueStore(db_path)
    store.create_issue(title="正式", ifc_guid="GUID0001xxxxxxxxxxxxxx", model_version_id="mvB", source_type="rule_result")
    store.create_issue(title="註記", model_version_id="mvB", source_type="manual")  # 無 guid → annotation

    resp = client.get("/api/bcf/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/octet-stream"
    files = _unzip(resp.content)
    assert "bcf.version" in files
    assert len([n for n in files if n.endswith("markup.bcf")]) == 1  # annotation 不計


def test_api_export_404_when_no_formal_issue(client_and_db):
    client, db_path = client_and_db
    from issues.store import IssueStore

    store = IssueStore(db_path)
    store.create_issue(title="只有註記", model_version_id="mvB", source_type="manual")  # 無 guid

    resp = client.get("/api/bcf/export")
    assert resp.status_code == 404


def test_ifc_guid_with_trailing_newline_excluded():
    """bcf-002：22 合法字元 + 尾端換行（共 23）不得通過 guard 洩漏進 .bcfzip。

    re.match + `$` 會在結尾單一換行前匹配；fullmatch 完全錨定才擋得住。
    """
    leaky = _sample_issue(ifc_guid="1aB2cD3eF4gH5iJ6kL7mN8\n")  # 22 合法字元 + \n
    data, count = build_bcfzip([leaky])
    assert count == 0, "尾端換行的 IfcGuid 應被排除，不得產出違反 BCF 2.1 XSD 的 topic"
    files = _unzip(data)
    assert list(files) == ["bcf.version"]  # 只有 version、無 topic
