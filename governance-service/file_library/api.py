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
_DEFAULT_ROOT = os.path.join(_SERVICE_ROOT, "storage")


def _library_root() -> str:
    # 每次請求讀（而非 import 時固定），讓測試與 deploy 能以 env 覆寫。
    return os.environ.get("BIM_FILE_LIBRARY_ROOT", _DEFAULT_ROOT)


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


def _list_versions(model_dir: str, root_real: str) -> list[dict]:
    versions: list[dict] = []
    for entry in os.scandir(model_dir):
        if not entry.is_file():
            continue
        if not entry.name.lower().endswith(".ifc"):
            continue
        if not _is_within(root_real, entry.path):
            continue
        versions.append(
            {
                "name": entry.name,
                "path": os.path.realpath(entry.path),
                "size_bytes": entry.stat().st_size,
                "mtime": _iso_mtime(entry.path),
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
    for proj_entry in sorted(os.scandir(root), key=lambda e: _natural_key(e.name)):
        if not proj_entry.is_dir():
            continue
        if not _is_within(root_real, proj_entry.path):
            continue
        models: list[dict] = []
        for model_entry in sorted(os.scandir(proj_entry.path), key=lambda e: _natural_key(e.name)):
            if not model_entry.is_dir():
                continue
            if not _is_within(root_real, model_entry.path):
                continue
            versions = _list_versions(model_entry.path, root_real)
            if versions:
                models.append({"model_id": model_entry.name, "versions": versions})
        if models:
            projects.append({"project_id": proj_entry.name, "models": models})
    payload["projects"] = projects
    return payload
