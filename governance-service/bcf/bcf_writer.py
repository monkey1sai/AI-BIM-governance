"""自寫最小 BCF 2.1 .bcfzip 匯出（純 stdlib zipfile + xml）。

**授權**：刻意不依賴 `bcf-client`（GPLv3，會污染專有服務）；BCF 為 buildingSMART
開放標準，以 stdlib 自行 author markup/viewpoint 無授權問題。

對齊 BCF 結合 USD 開發原則：
- 只匯出正式 issue（kind=issue，有 ifc_guid）；annotation 不匯出（rule 10）。
- viewpoint 的 Component 以 IFC GlobalId（IfcGuid）定位（rule 3 跨工具主鍵）。
- BCF issue 綁 model_version（rule 4）寫入 topic 描述/comment。
"""
from __future__ import annotations

import io
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from typing import Any

_NOW_FMT = "%Y-%m-%dT%H:%M:%SZ"
# BCF 2.1 XSD：IfcGuid 為 22 字元 base64-IFC 編碼（0-9 A-Z a-z _ $）
_IFC_GUID_RE = re.compile(r"^[0-9A-Za-z_$]{22}$")

# BCF 2.1 TopicStatus 對映（我們內部狀態 → BCF）
_STATUS_MAP = {
    "open": "Open",
    "assigned": "Open",
    "in_progress": "In Progress",
    "resolved": "Closed",
    "rejected": "Closed",
    "reopened": "ReOpened",
}


def _iso(value: str | None) -> str:
    if value:
        # 內部存 ISO（含 +00:00）；正規化成 BCF 的 Z 結尾
        try:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)  # naive 視為 UTC（bcf-003）
            return dt.astimezone(timezone.utc).strftime(_NOW_FMT)
        except Exception:
            pass
    return datetime.now(timezone.utc).strftime(_NOW_FMT)


def _disp(value: Any) -> str:
    """對外 BCF 文字：缺值輸出 'unbound' 而非 Python None 字面（bcf-005 誠實 provenance）。"""
    return "unbound" if value in (None, "") else str(value)


def _text(parent: ET.Element, tag: str, value: Any) -> ET.Element:
    el = ET.SubElement(parent, tag)
    el.text = "" if value is None else str(value)
    return el


def _markup_xml(issue: dict, topic_guid: str, vp_guid: str) -> bytes:
    markup = ET.Element("Markup")
    topic = ET.SubElement(markup, "Topic", {"Guid": topic_guid, "TopicType": "Issue",
                                            "TopicStatus": _STATUS_MAP.get(issue.get("status"), "Open")})
    _text(topic, "Title", issue.get("title") or "(untitled)")
    _text(topic, "Priority", issue.get("severity") or "medium")
    _text(topic, "CreationDate", _iso(issue.get("created_at")))
    _text(topic, "CreationAuthor", "governance-service")
    if issue.get("assignee"):
        _text(topic, "AssignedTo", issue["assignee"])
    desc = issue.get("description") or ""
    mv = issue.get("model_version_id")
    comment = ET.SubElement(markup, "Comment", {"Guid": str(uuid.uuid4())})
    _text(comment, "Date", _iso(issue.get("created_at")))
    _text(comment, "Author", "governance-service")
    _text(comment, "Comment", f"{desc}\n[model_version={_disp(mv)} · ifc_guid={_disp(issue.get('ifc_guid'))} · source={_disp(issue.get('source_type'))}]".strip())
    vps = ET.SubElement(markup, "Viewpoints", {"Guid": vp_guid})
    _text(vps, "Viewpoint", "viewpoint.bcfv")
    return _serialize(markup)


def _viewpoint_xml(issue: dict, vp_guid: str) -> bytes:
    vi = ET.Element("VisualizationInfo", {"Guid": vp_guid})
    components = ET.SubElement(vi, "Components")
    selection = ET.SubElement(components, "Selection")
    ET.SubElement(selection, "Component", {"IfcGuid": issue["ifc_guid"]})
    return _serialize(vi)


def _serialize(root: ET.Element) -> bytes:
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")


def build_bcfzip(issues: list[dict]) -> tuple[bytes, int]:
    """回傳 (.bcfzip bytes, 匯出 topic 數)。只含 kind=issue 且有 ifc_guid（BCF rule 10）。"""
    buf = io.BytesIO()
    exported = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("bcf.version", b'<?xml version="1.0" encoding="UTF-8"?>\n'
                   b'<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>')
        for issue in issues:
            if issue.get("kind") != "issue" or not issue.get("ifc_guid"):
                continue  # BCF rule 10：annotation / 無 guid 不匯出為正式 BCF issue
            if not _IFC_GUID_RE.fullmatch(issue["ifc_guid"]):
                # bcf-002：非 22 字元合法 IfcGuid 不匯出，避免產出違反 BCF 2.1 XSD 的 .bcfzip。
                # 用 fullmatch 完全錨定：re.match + `$` 會在結尾單一 \n 前匹配，22 字元+尾換行會漏網。
                continue
            topic_guid = str(uuid.uuid4())
            vp_guid = str(uuid.uuid4())
            z.writestr(f"{topic_guid}/markup.bcf", _markup_xml(issue, topic_guid, vp_guid))
            z.writestr(f"{topic_guid}/viewpoint.bcfv", _viewpoint_xml(issue, vp_guid))
            exported += 1
    return buf.getvalue(), exported
