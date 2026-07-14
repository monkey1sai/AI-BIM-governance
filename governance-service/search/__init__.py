"""A4 semantic search — deterministic, explainable filters over IFC (CPU-only).

Not an LLM chat endpoint. Interprets a constrained natural-language / structured
query into filters, runs them with ifcopenshell, and returns evidence traces.
"""
from __future__ import annotations

from .engine import SearchRequest, run_model_search
from .interpreter import InterpretedFilters, interpret_query
from .llm_client import load_llm_config

__all__ = [
    "InterpretedFilters",
    "SearchRequest",
    "interpret_query",
    "load_llm_config",
    "run_model_search",
]
