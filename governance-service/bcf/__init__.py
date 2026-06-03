"""BCF export package（自寫 BCF 2.1 .bcfzip，純 stdlib，不依賴 GPLv3 bcf-client）。"""
from __future__ import annotations

from .bcf_writer import build_bcfzip

__all__ = ["build_bcfzip"]
