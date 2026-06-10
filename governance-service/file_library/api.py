"""A1 file-library browse REST（APIRouter，掛入 governance-service app）。

唯讀 local file-server 模擬層（spec §4.1）：掃 BIM_FILE_LIBRARY_ROOT（預設 repo storage/）下
兩層 {projectId}/{modelId}/*.ifc，回 project→model→version 樹，比照真實 MinIO
bim-control/{projectId}/{modelId}/version 語意。source_kind="local_fs" 是誠實標記，未來真
MinIO 接上時改 "s3"，前端文案跟著翻。不做上傳/刪除/改名（唯讀）；不接真 S3 client。
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter()

_SERVICE_ROOT = os.path.dirname(os.path.dirname(__file__))
# 預設 root = repo 根 storage/（spec §4.1）：真實三專案 270/889/990 放在 repo 根層，
# 非 service 層 governance-service/storage/（後者只放 governance.db / federated/）。
# 故由 _SERVICE_ROOT(=governance-service/) 的父層(=repo 根)組 storage/。
_DEFAULT_ROOT = os.path.join(os.path.dirname(_SERVICE_ROOT), "storage")

# 保留目錄名（不視為 bim-control 專案，不入樹）：
# - ifc-cache：coordinator IFC 下載暫存 ifcready_*/source.ifc，符兩層 {dir}/{dir}/*.ifc
#   規則卻是服務內部暫存（部署區會隨 intake 持續增長），列入會生出大量假專案污染
#   #/minio 樹與 A1 專案下拉。
# - coordinator：coordinator 服務工作目錄（callback-outbox 等），未來可能掛 session IFC，
#   預先排除。
_RESERVED_PROJECT_DIRS = frozenset({"ifc-cache", "coordinator"})


def _library_root() -> str:
    # 每次請求讀（而非 import 時固定），讓測試與 deploy 能以 env 覆寫。
    # 優先序：BIM_FILE_LIBRARY_ROOT（本功能專屬覆寫）→ RUNTIME_STORAGE_ROOT
    # （deploy.ps1 寫入 .env 的 runtime 資料根權威，leaf 固定為 storage/）→
    # checkout 相對 _DEFAULT_ROOT。部署區 checkout 不含真 IFC（不 commit），
    # 故 deploy 路徑下應跟著 runtime storage root 走，而非 hardcode checkout storage/。
    explicit = os.environ.get("BIM_FILE_LIBRARY_ROOT")
    if explicit:
        return explicit
    runtime_root = os.environ.get("RUNTIME_STORAGE_ROOT")
    if runtime_root:
        return runtime_root
    return _DEFAULT_ROOT


def _is_within(root_real: str, candidate: str) -> bool:
    """realpath 後仍在 root 內才算合法（防 path traversal / symlink 逃逸）。"""
    cand_real = os.path.realpath(candidate)
    return cand_real == root_real or cand_real.startswith(root_real + os.sep)


# 自然排序 key：把數字段轉 int 比較（ver 000002 < ver 000010）。
def _natural_key(name: str):
    return [int(tok) if tok.isdigit() else tok.lower() for tok in re.split(r"(\d+)", name)]


def _version_sort_key(name: str):
    # ver 竣工.ifc 固定排最後（竣工=最終版語意）：用 (is_completion, natural_key)。
    is_completion = "竣工" in name
    return (1 if is_completion else 0, _natural_key(name))


def _iso_mtime(path: str) -> str:
    ts = os.path.getmtime(path)
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().isoformat()


def _iter_dir(path: str):
    """scandir 防護版：目錄中途消失/權限變動（OSError）→ 當空目錄，不讓整個端點 500。"""
    try:
        with os.scandir(path) as it:
            yield from it
    except OSError:
        return


def _list_versions(model_dir: str, root_real: str) -> list[dict]:
    versions: list[dict] = []
    for entry in _iter_dir(model_dir):
        try:
            if not entry.is_file():
                continue
            if not entry.name.lower().endswith(".ifc"):
                continue
            if not _is_within(root_real, entry.path):
                continue
            # stat / mtime 逐檔防護：單檔中途被刪/鎖（OSError）只跳過該檔，
            # 不讓掃描中斷導致端點整體 500。
            size_bytes = entry.stat().st_size
            mtime = _iso_mtime(entry.path)
        except OSError:
            continue
        versions.append(
            {
                "name": entry.name,
                "path": os.path.realpath(entry.path),
                "size_bytes": size_bytes,
                "mtime": mtime,
            }
        )
    versions.sort(key=lambda v: _version_sort_key(v["name"]))
    return versions


@router.get("/api/files/tree")
def files_tree():
    root = _library_root()
    root_real = os.path.realpath(root)
    payload = {"root": root_real, "source_kind": "local_fs", "projects": []}
    if not os.path.isdir(root):
        # root 不存在/非目錄 → 空樹（200，不丟 500）。
        return payload

    projects: list[dict] = []
    for proj_entry in sorted(_iter_dir(root), key=lambda e: _natural_key(e.name)):
        try:
            if not proj_entry.is_dir():
                continue
            # 保留目錄（服務內部暫存，如 ifc-cache / coordinator）不視為專案，不入樹。
            if proj_entry.name.lower() in _RESERVED_PROJECT_DIRS:
                continue
            if not _is_within(root_real, proj_entry.path):
                continue
        except OSError:
            continue
        models: list[dict] = []
        for model_entry in sorted(_iter_dir(proj_entry.path), key=lambda e: _natural_key(e.name)):
            try:
                if not model_entry.is_dir():
                    continue
                if not _is_within(root_real, model_entry.path):
                    continue
            except OSError:
                continue
            versions = _list_versions(model_entry.path, root_real)
            if versions:
                models.append({"model_id": model_entry.name, "versions": versions})
        if models:
            projects.append({"project_id": proj_entry.name, "models": models})
    payload["projects"] = projects
    return payload
