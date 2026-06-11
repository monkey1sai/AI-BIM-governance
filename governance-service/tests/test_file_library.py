"""file_library tree API（FastAPI TestClient，tmp root 造兩層 IFC 結構，CPU-only、毫秒級）。

守 spec §4.1/§7：兩層 {projectId}/{modelId}/*.ifc（檔名即版本）與三層
{projectId}/{modelId}/{versionDir}/*.ifc（name="{versionDir}/{filename}"）並收、第四層忽略、
只收 .ifc（大小寫不敏感）、
防 path traversal（root 外 symlink 不出現）、root 不存在/空 回 200 空 projects、
ver 竣工.ifc 固定排最後。中文路徑（機電/水電/消防、竣工）全程 UTF-8。
"""
from __future__ import annotations

import importlib
import os
import subprocess

import pytest
from fastapi.testclient import TestClient


def _make_dir_link(target: str, link: str) -> None:
    """在 link 處建一個指向 target 的目錄連結（給 traversal 測試用）。

    優先 os.symlink（POSIX 或 Windows Developer Mode/admin），失敗時退回
    Windows directory junction（mklink /J，免特權）。os.path.realpath 兩者
    都會解析到 target，足以驅動 _is_within 的逃逸防線。兩者皆不可行才 skip，
    避免本機 Windows 讓這條安全測試永遠空跑（CI 也沒有跑 governance pytest）。
    """
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except (OSError, NotImplementedError):
        pass
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", link, target],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return
    pytest.skip("此環境無法建立目錄 symlink 或 junction，略過 traversal 測試")


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
    # 三層版本目錄（新支援）：{project}/{model}/{versionDir}/*.ifc →
    # name = "{versionDir}/{filename}"。在 270/機電 下放 v1/villa.ifc 驗三層入樹。
    v1 = root / "270" / "機電" / "v1"
    v1.mkdir(parents=True, exist_ok=True)
    (v1 / "villa.ifc").write_text("x", encoding="utf-8")
    # 第四層（過深）忽略：270/機電/v1/sub/too_deep.ifc 不入樹。
    too_deep = root / "270" / "機電" / "v1" / "sub"
    too_deep.mkdir(parents=True, exist_ok=True)
    (too_deep / "too_deep.ifc").write_text("x", encoding="utf-8")
    # 空 versionDir（無 .ifc）不產生條目：270/機電/empty_ver/notes.txt。
    empty_ver = root / "270" / "機電" / "empty_ver"
    empty_ver.mkdir(parents=True, exist_ok=True)
    (empty_ver / "notes.txt").write_text("no ifc here", encoding="utf-8")
    # 保留目錄：coordinator IFC 下載暫存 ifc-cache/ifcready_*/source.ifc 雖符兩層
    # {dir}/{dir}/*.ifc 規則，但屬服務內部暫存（非 bim-control 專案），不得污染樹。
    cache = root / "ifc-cache" / "ifcready_1779420878060_46b60df8"
    cache.mkdir(parents=True)
    (cache / "source.ifc").write_text("x", encoding="utf-8")
    # coordinator 也是保留目錄名（未來可能掛 session IFC，預先排除）。
    coord = root / "coordinator" / "session-x"
    coord.mkdir(parents=True)
    (coord / "model.ifc").write_text("x", encoding="utf-8")


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
    # 只收 .ifc（notes.txt 被忽略）；三層 v1/villa.ifc 入樹（name 帶 versionDir 前綴）；
    # 第四層 v1/sub/too_deep.ifc 與空 versionDir(empty_ver) 不出現。
    assert "notes.txt" not in names
    assert "too_deep.ifc" not in names
    assert "v1/sub/too_deep.ifc" not in names
    assert set(names) == {"ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc", "v1/villa.ifc"}
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


def test_reserved_dirs_excluded_from_projects(client):
    # ifc-cache（coordinator IFC 下載暫存 ifcready_*/source.ifc）與 coordinator 雖符兩層
    # {dir}/{dir}/*.ifc 規則，屬服務內部暫存目錄，不得入樹污染 #/minio 與 A1 專案下拉；
    # 真實專案（270/889）不受影響。
    c, _ = client
    body = c.get("/api/files/tree").json()
    project_ids = {p["project_id"] for p in body["projects"]}
    assert "ifc-cache" not in project_ids
    assert "coordinator" not in project_ids
    # 排除為精準保留名單，不誤殺真實專案。
    assert {"270", "889"} <= project_ids


def test_version_sort_natural_with_completion_last(client):
    c, _ = client
    body = c.get("/api/files/tree").json()
    projects = {p["project_id"]: p for p in body["projects"]}
    models = {m["model_id"]: m for m in projects["270"]["models"]}
    names = [v["name"] for v in models["機電"]["versions"]]
    # 自然排序（含 versionDir 形狀混排）+ ver 竣工.ifc 固定排最後（竣工是最終版語意）
    assert names == [
        "v1/villa.ifc",
        "ver 000001.ifc",
        "ver 000002.ifc",
        "ver 竣工.ifc",
    ]


def test_three_level_version_dir_listed_with_prefixed_name(client):
    """三層 {project}/{model}/{versionDir}/*.ifc 入樹，name = "{versionDir}/{filename}"，path 絕對且存在。"""
    c, root = client
    body = c.get("/api/files/tree").json()
    projects = {p["project_id"]: p for p in body["projects"]}
    models = {m["model_id"]: m for m in projects["270"]["models"]}
    versions = {v["name"]: v for v in models["機電"]["versions"]}
    assert "v1/villa.ifc" in versions
    v = versions["v1/villa.ifc"]
    assert os.path.isabs(v["path"]) and os.path.exists(v["path"])
    assert v["path"].endswith(os.path.join("v1", "villa.ifc"))
    assert isinstance(v["size_bytes"], int) and v["size_bytes"] > 0


def test_fourth_level_and_empty_version_dir_ignored(client):
    """第四層（versionDir/sub/*.ifc）忽略；versionDir 內無 .ifc 不產生條目。"""
    c, _ = client
    body = c.get("/api/files/tree").json()
    projects = {p["project_id"]: p for p in body["projects"]}
    names = [
        v["name"] for m in projects["270"]["models"] if m["model_id"] == "機電" for v in m["versions"]
    ]
    assert all("too_deep" not in n for n in names)
    assert all("empty_ver" not in n for n in names)


def test_two_and_three_level_mixed_sort_completion_last(client):
    """同 model 兩形狀混排：兩層檔 + 三層檔走同一把自然排序尺；ver 竣工.ifc 仍固定最後。"""
    c, _ = client
    body = c.get("/api/files/tree").json()
    projects = {p["project_id"]: p for p in body["projects"]}
    names = [
        v["name"] for m in projects["270"]["models"] if m["model_id"] == "機電" for v in m["versions"]
    ]
    # v1/villa.ifc（v 開頭，非數字、非竣工）與兩層檔混排；竣工固定最後。
    assert names[-1] == "ver 竣工.ifc"
    assert "v1/villa.ifc" in names
    assert set(names) == {"ver 000001.ifc", "ver 000002.ifc", "ver 竣工.ifc", "v1/villa.ifc"}


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


def test_runtime_storage_root_fallback(tmp_path, monkeypatch):
    """無 BIM_FILE_LIBRARY_ROOT 時退 RUNTIME_STORAGE_ROOT（deploy .env 的 runtime 資料根權威）。

    部署區 checkout 不含真 IFC，hardcode checkout storage/ 會永遠空樹；
    故 root 解析鏈為 BIM_FILE_LIBRARY_ROOT → RUNTIME_STORAGE_ROOT → checkout 預設。
    """
    runtime_root = tmp_path / "runtime-storage"
    runtime_root.mkdir()
    _make_tree(runtime_root)
    monkeypatch.delenv("BIM_FILE_LIBRARY_ROOT", raising=False)
    monkeypatch.setenv("RUNTIME_STORAGE_ROOT", str(runtime_root))
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    c = TestClient(app_module.app)
    body = c.get("/api/files/tree").json()
    assert os.path.realpath(body["root"]) == os.path.realpath(str(runtime_root))
    assert {"270", "889"} <= {p["project_id"] for p in body["projects"]}


def test_explicit_library_root_overrides_runtime_root(tmp_path, monkeypatch):
    """兩個 env 同時存在時 BIM_FILE_LIBRARY_ROOT 優先（專屬覆寫 > 通用 runtime root）。"""
    lib_root = tmp_path / "lib"
    lib_root.mkdir()
    _make_tree(lib_root)
    other = tmp_path / "other-runtime"
    other.mkdir()
    monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(lib_root))
    monkeypatch.setenv("RUNTIME_STORAGE_ROOT", str(other))
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    c = TestClient(app_module.app)
    body = c.get("/api/files/tree").json()
    assert os.path.realpath(body["root"]) == os.path.realpath(str(lib_root))
    assert {"270", "889"} <= {p["project_id"] for p in body["projects"]}


def test_transient_oserror_skips_entry_not_500(client, monkeypatch):
    """掃描中單檔 stat/mtime 失敗（OSError）→ 跳過該檔仍回 200，不得端點整體 500。"""
    from file_library import api as fl_api

    def _boom(_path: str) -> str:
        raise OSError("transient stat failure")

    monkeypatch.setattr(fl_api, "_iso_mtime", _boom)
    c, _ = client
    resp = c.get("/api/files/tree")
    assert resp.status_code == 200
    # 所有版本的 mtime 都失敗 → 全被跳過 → 空樹（誠實降級，不拋 500）。
    assert resp.json()["projects"] == []


def test_symlink_escape_excluded(tmp_path, monkeypatch):
    root = tmp_path / "lib"
    (root / "270" / "機電").mkdir(parents=True)
    (root / "270" / "機電" / "ver 000001.ifc").write_text("x", encoding="utf-8")
    # root 外的洩漏目標
    outside = tmp_path / "outside"
    (outside / "機電").mkdir(parents=True)
    (outside / "機電" / "secret.ifc").write_text("x", encoding="utf-8")
    # 在 root 下放一個指向 root 外的 project 目錄連結（symlink 或 junction）
    _make_dir_link(str(outside), str(root / "999"))
    monkeypatch.setenv("BIM_FILE_LIBRARY_ROOT", str(root))
    monkeypatch.setenv("GOV_DB_PATH", str(tmp_path / "gov.db"))
    import app as app_module

    importlib.reload(app_module)
    c = TestClient(app_module.app)
    body = c.get("/api/files/tree").json()
    # 逃逸到 root 外的 999 不得出現
    assert "999" not in {p["project_id"] for p in body["projects"]}
