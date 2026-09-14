"""The stateful live control extension must survive source-file edits."""
from pathlib import Path
import tomllib


def test_messaging_requires_controlled_restart_not_filesystem_hot_reload():
    config = Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/config/extension.toml"
    with config.open("rb") as stream:
        manifest = tomllib.load(stream)
    assert manifest.get("core", {}).get("reloadable", True) is False
