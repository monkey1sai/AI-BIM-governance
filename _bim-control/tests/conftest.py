from pathlib import Path
from uuid import uuid4

import pytest


@pytest.fixture
def case_dir() -> Path:
    root = Path(__file__).resolve().parents[1] / "pytest-cache-files-bim-control"
    path = root / uuid4().hex
    path.mkdir(parents=True, exist_ok=False)
    return path
