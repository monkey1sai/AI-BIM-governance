"""BCF export package（自寫 BCF 2.1 .bcfzip，匯出模組執行期只用 stdlib、不 import GPLv3 bcf-client；
惟 ifctester 會在環境 transitive 安裝 bcf-client(GPLv3)，匯出產物不含其程式碼）。"""
from __future__ import annotations

from .bcf_writer import build_bcfzip

__all__ = ["build_bcfzip"]
