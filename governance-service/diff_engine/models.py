"""Dataclasses for the A2 model-version diff engine（純資料結構，不依賴 FastAPI）。"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

# 變更類型：added / removed / moved / geometry_changed / property_changed
# （順序對齊下方 CHANGE_TYPES tuple；geometry_changed 為 opt-in，預設關閉，
#  需顯式 include_geometry=True 啟用，已實作）。
CHANGE_TYPES = ("added", "removed", "moved", "geometry_changed", "property_changed")


@dataclass
class DiffItem:
    change_type: str
    ifc_guid: Optional[str]
    ifc_type: str
    ifc_name: Optional[str]
    base_usd_prim_path: Optional[str] = None
    target_usd_prim_path: Optional[str] = None
    change_summary: str = ""
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DiffResult:
    base_count: int
    target_count: int
    matched: int
    counts: dict[str, int]
    items: list[DiffItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def items_by_type(self, change_type: str) -> list[DiffItem]:
        return [i for i in self.items if i.change_type == change_type]

    def summary_dict(self) -> dict[str, Any]:
        return {
            "base_count": self.base_count,
            "target_count": self.target_count,
            "matched": self.matched,
            "counts": self.counts,
            "warnings": self.warnings,
        }
