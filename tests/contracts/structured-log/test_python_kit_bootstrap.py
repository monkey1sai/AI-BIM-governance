"""Tests for the Kit-side struct_log bootstrap helper.

This test exercises argv / env parsing and the singleton lifetime of
``kit_struct_log``. The helper itself imports ``struct_log`` lazily; both
modules are loaded directly via file-spec to avoid importing Kit's package
``__init__`` (which pulls ``carb``/``omni``).
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MESSAGING_DIR = (
    REPO_ROOT
    / "bim-streaming-server"
    / "source"
    / "extensions"
    / "ezplus.bim_review_stream.messaging"
    / "ezplus"
    / "bim_review_stream"
    / "messaging"
)


def _load_module(name: str, file_name: str):
    spec = importlib.util.spec_from_file_location(name, MESSAGING_DIR / file_name)
    assert spec and spec.loader, f"could not load {file_name}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# Build a minimal package fixture so kit_struct_log's `from . import struct_log`
# resolves. We register the modules under a synthetic package name to avoid
# colliding with the real Kit-loaded package.
@pytest.fixture(autouse=True)
def kit_struct_log_module(tmp_path, monkeypatch):
    # Remove any previously cached test instances.
    for key in list(sys.modules.keys()):
        if key.startswith("_struct_log_test_pkg"):
            del sys.modules[key]

    pkg_name = "_struct_log_test_pkg"
    pkg = type(sys)(pkg_name)
    pkg.__path__ = [str(MESSAGING_DIR)]
    sys.modules[pkg_name] = pkg

    struct_log_spec = importlib.util.spec_from_file_location(
        f"{pkg_name}.struct_log", MESSAGING_DIR / "struct_log.py"
    )
    struct_log_mod = importlib.util.module_from_spec(struct_log_spec)
    sys.modules[f"{pkg_name}.struct_log"] = struct_log_mod
    struct_log_spec.loader.exec_module(struct_log_mod)
    setattr(pkg, "struct_log", struct_log_mod)

    bootstrap_spec = importlib.util.spec_from_file_location(
        f"{pkg_name}.kit_struct_log", MESSAGING_DIR / "kit_struct_log.py"
    )
    bootstrap_mod = importlib.util.module_from_spec(bootstrap_spec)
    sys.modules[f"{pkg_name}.kit_struct_log"] = bootstrap_mod
    bootstrap_spec.loader.exec_module(bootstrap_mod)

    bootstrap_mod.reset_logger_for_test()

    # Force the logger to write to a tmp path during the test by patching the
    # default log root via env override.
    monkeypatch.setenv("LOG_ROOT", str(tmp_path))
    struct_log_mod.reset_allowlist_cache()

    yield bootstrap_mod, struct_log_mod

    bootstrap_mod.reset_logger_for_test()
    struct_log_mod.reset_allowlist_cache()


def test_parses_trace_id_from_argv_space_form(kit_struct_log_module, monkeypatch):
    bootstrap, _ = kit_struct_log_module
    monkeypatch.setattr(sys, "argv", ["kit", "--trace-id", "ifcready_xyz", "--other"])
    monkeypatch.delenv("BIM_TRACE_ID", raising=False)
    assert bootstrap._parse_trace_id_from_argv() == "ifcready_xyz"
    assert bootstrap._resolve_initial_trace_id() == "ifcready_xyz"


def test_parses_trace_id_from_argv_equals_form(kit_struct_log_module, monkeypatch):
    bootstrap, _ = kit_struct_log_module
    monkeypatch.setattr(sys, "argv", ["kit", "--trace-id=stream_conv_abc"])
    monkeypatch.delenv("BIM_TRACE_ID", raising=False)
    assert bootstrap._parse_trace_id_from_argv() == "stream_conv_abc"


def test_falls_back_to_bim_trace_id_env(kit_struct_log_module, monkeypatch):
    bootstrap, _ = kit_struct_log_module
    monkeypatch.setattr(sys, "argv", ["kit"])
    monkeypatch.setenv("BIM_TRACE_ID", "rev_from_env")
    assert bootstrap._parse_trace_id_from_argv() is None
    assert bootstrap._resolve_initial_trace_id() == "rev_from_env"


def test_returns_none_when_no_trace_anywhere(kit_struct_log_module, monkeypatch):
    bootstrap, _ = kit_struct_log_module
    monkeypatch.setattr(sys, "argv", ["kit", "--ext-folder", "/x"])
    monkeypatch.delenv("BIM_TRACE_ID", raising=False)
    assert bootstrap._resolve_initial_trace_id() is None


def test_get_logger_is_singleton(kit_struct_log_module, monkeypatch):
    bootstrap, _ = kit_struct_log_module
    monkeypatch.setattr(sys, "argv", ["kit"])
    monkeypatch.delenv("BIM_TRACE_ID", raising=False)
    a = bootstrap.get_logger()
    b = bootstrap.get_logger()
    assert a is b


def test_lifecycle_helpers_emit_records(kit_struct_log_module, monkeypatch, tmp_path):
    bootstrap, struct_log_mod = kit_struct_log_module
    monkeypatch.setattr(sys, "argv", ["kit", "--trace-id", "ifcready_unit"])
    monkeypatch.delenv("BIM_TRACE_ID", raising=False)
    bootstrap.log_kit_startup_lifecycle("ezplus.bim_review_stream.messaging")
    bootstrap.log_kit_shutdown_lifecycle("ezplus.bim_review_stream.messaging")

    logger = bootstrap.get_logger()
    # current_file is under tmp_path because LOG_ROOT env is set in the fixture.
    text = Path(logger.current_file).read_text(encoding="utf-8").strip().splitlines()
    # The fixture didn't skip env_snapshot, so the first record is the snapshot.
    records = [json.loads(line) for line in text]
    lifecycle_records = [r for r in records if r["event_type"] == "lifecycle"]
    assert len(lifecycle_records) == 2
    assert lifecycle_records[0]["data"]["phase"] == "start"
    assert lifecycle_records[0]["data"]["subject_kind"] == "kit_subprocess"
    assert lifecycle_records[1]["data"]["phase"] == "closed"
    # All records share the trace_id propagated from --trace-id.
    assert all(r["trace_id"] == "ifcready_unit" for r in records)
