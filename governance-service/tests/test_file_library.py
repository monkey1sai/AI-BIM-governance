"""file_library tree API（FastAPI TestClient，tmp root 造兩層 IFC 結構，CPU-only、毫秒級）。

守 spec §4.1/§7：只列兩層 {projectId}/{modelId}/*.ifc、只收 .ifc（大小寫不敏感）、
防 path traversal（root 外 symlink 不出現）、root 不存在/空 回 200 空 projects、
ver 竣工.ifc 固定排最後。中文路徑（機電/水電/消防、竣工）全程 UTF-8。
"""
from __future__ import annotations

import importlib
import os

import pytest
from fastapi.testclient import TestClient


def _make_tree(root) -> None:
    # 兩層合法結構：2 專案 × 2 模型 × 多版本（含中文檔名 + 竣工）。
    for project in ("270", "889"):
        for model in ("機電", "水電"):
            d = root / project / model
            d.mkdir(parents=True)
            for ver in ("ver 000002.ifc", "ver 000001.ifc", "ver 竣工.ifc"):
                (d / ver).write_text("ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n", encoding="utf-8")
            # 同層非 .ifc 應被忽略
            (d / "notes.txt").write_text("ignore me", encoding="utf-8")
    # 頂層散檔（一層）不入樹
    (root / "fixture-bytes.ifc").write_text("x", encoding="utf-8")
    # 三層（過深）不入樹
    deep = root / "270" / "機電" / "extra"
    deep.mkdir(parents=True, exist_ok=True)
    (deep / "deep.ifc").write_text("x", encoding="utf-8")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    root = tmp_path / "lib"
    root.mkdir()
    _make_tree(root)
    monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(root))
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app), root


def test_tree_lists_two_level_ifc_only(client):
    c, root = client
    resp = c.get("/api/files/tree")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source_kind"] == "local_fs"
    assert os.path.realpath(body["root"]) == os.path.realpath(str(root))
    projects = {p["project_id"]: p for p in body["projects"]}
    assert set(projects) == {"270", "889"}
    models = {m["model_id"]: m for m in projects["270"]["models"]}
    assert set(models) == {"機電", "水電"}
    versions = models["機電"]["versions"]
    names = [v["name"] for v in versions]
    # 只收 .ifc（notes.txt 被忽略）、過深的 extra/deep.ifc 不出現
    assert "notes.txt" not in names
    assert "deep.ifc" not in names
    assert set(names) == {"ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc"}
    # 每個 version 帶 path（絕對、可當 ifc_source_path）/size_bytes/mtime
    v0 = versions[0]
    assert os.path.isabs(v0["path"])
    assert os.path.exists(v0["path"])
    assert isinstance(v0["size_bytes"], int) and v0["size_bytes"] > 0
    assert isinstance(v0["mtime"], str) and v0["mtime"]


def test_top_level_loose_files_excluded(client):
    c, _ = client
    body = c.get("/api/files/tree").json()
    # fixture-bytes.ifc 在 root 一層、不符兩層結構 → 不得出現為 project
    assert "fixture-bytes" not in {p["project_id"] for p in body["projects"]}


def test_version_sort_natural_with_completion_last(client):
    c, _ = client
    body = c.get("/api/files/tree").json()
    projects = {p["project_id"]: p for p in body["projects"]}
    models = {m["model_id"]: m for m in projects["270"]["models"]}
    names = [v["name"] for v in models["機電"]["versions"]]
    # 自然排序 + ver 竣工.ifc 固定排最後（竣工是最終版語意）
    assert names == ["ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc"]


def test_missing_root_returns_empty_200(tmp_path, monkeypatch):
    monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(tmp_path / "does-not-exist"))
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    c = TestClient(app_module.app)
    resp = c.get("/api/files/tree")
    assert resp.status_code == 200
    body = resp.json()
    assert body["projects"] == []
    assert body["source_kind"] == "local_fs"


@pytest.mark.skipif(os.name == "nt" and not os.environ.get("CI"), reason="Windows symlink 需權限；local 跳過，CI/POSIX 驗 traversal")
def test_symlink_escape_excluded(tmp_path, monkeypatch):
    root = tmp_path / "lib"
    (root / "270" / "機電").mkdir(parents=True)
    (root / "270" / "機電" / "ver 000001.ifc").write_text("x", encoding="utf-8")
    # root 外的洩漏目標
    outside = tmp_path / "outside"
    (outside / "機電").mkdir(parents=True)
    (outside / "機電" / "secret.ifc").write_text("x", encoding="utf-8")
    # 在 root 下放一個指向 root 外的 project symlink
    os.symlink(str(outside), str(root / "999"), target_is_directory=True)
    monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(root))
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    c = TestClient(app_module.app)
    body = c.get("/api/files/tree").json()
    # 逃逸到 root 外的 999 不得出現
    assert "999" not in {p["project_id"] for p in body["projects"]}
