"""Kit Command Vocabulary drift guard（決策見 docs/architecture/kit-command-vocabulary-adr.md）。"""
import hashlib
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_DIR = (
    Path(__file__).resolve().parents[1]
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)
sys.path.insert(0, str(MODULE_DIR))

import camera_view  # noqa: E402
import kit_command_vocabulary  # noqa: E402

REGENERATE = "run: cd web-viewer-sample && npm run generate:kit-command-vocabulary"


def _lf_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n")


def test_generated_vocabulary_matches_committed_schema():
    schema = _lf_text(REPO_ROOT / "tests" / "contracts" / "kit-datachannel-v1.schema.json")
    header = _lf_text(MODULE_DIR / "kit_command_vocabulary.py").split("\n")[:8]
    lines = [line for line in header if line.startswith("# source-sha256: ")]
    assert lines, REGENERATE
    assert lines[0].removeprefix("# source-sha256: ") == hashlib.sha256(schema.encode("utf-8")).hexdigest(), REGENERATE


def test_every_contract_camera_preset_has_a_forward_vector():
    assert set(camera_view.PRESET_FORWARD) == set(kit_command_vocabulary.CAMERA_VIEW_PRESETS)
