"""A4 search REST — hung under governance-service; browser reaches via coordinator proxy."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .engine import SearchRequest, run_model_search

router = APIRouter()


class ModelSearchBody(BaseModel):
    ifc_source_path: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1)
    model_version_id: Optional[str] = None
    element_mapping_path: Optional[str] = None
    limit: int = Field(default=200, ge=1, le=1000)


@router.post("/api/search/model")
def search_model(body: ModelSearchBody) -> dict[str, Any]:
    try:
        return run_model_search(
            SearchRequest(
                ifc_source_path=body.ifc_source_path,
                query=body.query,
                model_version_id=body.model_version_id,
                element_mapping_path=body.element_mapping_path,
                limit=body.limit,
            )
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"search_failed: {exc}") from exc
