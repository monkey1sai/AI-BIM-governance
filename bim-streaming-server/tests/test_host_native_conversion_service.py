import json
import sys
import types
from pathlib import Path

from fastapi.testclient import TestClient

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

from conversion_authority import ConversionAuthorityError  # noqa: E402
from host_native_conversion_service import (  # noqa: E402
    DEFAULT_HOST,
    DEFAULT_PORT,
    build_app,
    load_config,
)
from ifc2usdc_powershell_adapter import (  # noqa: E402
    Ifc2UsdcPowershellConverterAdapter,
    adapter_from_env,
)


class FakeSuccessfulConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        mapping_path = output_dir / "element_mapping.json"
        entity_index_path = output_dir / "entity_index.json"
        metadata_path = output_dir / "metadata.json"
        model_path.write_bytes(b"PXR-USDC-fake-openable\n")
        mapping_path.write_text(
            '{"mock": false, "summary": {"mapped_count": 2, "fake_mapping_count": 0}, "items": []}',
            encoding="utf-8",
        )
        entity_index_path.write_text('{"entities": []}', encoding="utf-8")
        metadata_path.write_text('{"source": "ifc_ready"}', encoding="utf-8")
        return {
            "model_path": model_path,
            "mapping_path": mapping_path,
            "entity_index_path": entity_index_path,
            "metadata_path": metadata_path,
            "quality_metrics": {
                "source_ifc_entity_count": 2,
                "mapped_count": 2,
                "unmapped_count": 0,
                "coverage_ratio": 1.0,
                "coverage_status": "pass",
                "materialization_strategy": "sidecar",
                "sidecar_carrier_count": 1,
                "minimum_coverage_baseline_locked": True,
                "hard_quality_gates": {
                    "usdc_openable": True,
                    "has_renderable_prims": True,
                    "placeholder_output": False,
                },
            },
        }


class FakeFailedConverter:
    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        raise ConversionAuthorityError("converter_failed", "fixture converter failed")


def _config(tmp_path: Path, token: str | None = None):
    env = {
        "STREAMING_CONVERSION_SERVICE_ROOT": str(tmp_path / "svc"),
        "STREAMING_CONVERSION_ARTIFACTS_ROOT": str(tmp_path / "svc" / "artifacts"),
        "STREAMING_CONVERSION_JOBS_DIR": str(tmp_path / "svc" / "jobs"),
        "STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL": "http://testserver/artifacts",
    }
    if token:
        env["STREAMING_CONVERSION_INTERNAL_TOKEN"] = token
    return load_config(env)


def _client(tmp_path: Path, converter, run_background: bool = True, token: str | None = None):
    app = build_app(
        _config(tmp_path, token=token), converter=converter, run_background=run_background
    )
    return TestClient(app)


def ifc_ready_payload(**overrides):
    payload = {
        "event_type": "ifc_ready",
        "event_id": "evt_ifc_hn_001",
        "correlation_id": "corr_hn_001",
        "tenant_id": "tenant_demo_001",
        "project_id": "project_demo_001",
        "model_version_id": "version_demo_001",
        "export_job_id": "rvt_export_demo_001",
        "source_rvt_artifact_id": "artifact_rvt_demo_001",
        "ifc_artifact": {
            "artifact_id": "artifact_ifc_hn_001",
            "format": "ifc",
            "filename": "demo-model.ifc",
            "url": "edge-local://fixtures/demo-model.ifc",
        },
        "requested_outputs": ["usdc", "element_mapping", "entity_index", "metadata"],
    }
    payload.update(overrides)
    return payload


# --- service contract (load existing factory; conversion-only identity) -----


def test_load_config_defaults_to_local_conversion_port():
    config = load_config({})
    assert config.host == DEFAULT_HOST == "127.0.0.1"
    assert config.port == DEFAULT_PORT == 49101
    assert config.base_url == "http://127.0.0.1:49101"
    assert config.service_root == config.repo_root / "_cache" / "host-native-conversion"
    assert config.internal_conversion_token is None


def test_health_reports_conversion_only_identity(tmp_path: Path):
    client = _client(tmp_path, converter=FakeSuccessfulConverter(), run_background=False)

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["authority"] == "bim-streaming-server"
    assert body["service"] == "host-native-conversion-authority"
    assert body["role"] == "conversion-only"
    # MUST NOT claim WebRTC / Kit launcher / viewport readiness.
    assert body["claims"]["ifc_to_usdc_conversion"] is True
    assert body["claims"]["webrtc_49100"] is False
    assert body["claims"]["kit_launcher"] is False
    assert body["claims"]["viewport_render"] is False


def test_host_native_service_creates_and_completes_job(tmp_path: Path):
    client = _client(tmp_path, converter=FakeSuccessfulConverter())

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    assert create.status_code == 202
    conversion_job_id = create.json()["conversion_job_id"]
    assert conversion_job_id.startswith("stream_conv_")
    assert create.json()["authority"] == "bim-streaming-server"

    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()
    assert result["status"] == "succeeded"
    assert result["model"]["status"] == "ready"
    assert result["artifacts"]["model_usdc"]["url"].endswith("/model.usdc")
    assert result["quality_metrics"]["coverage_status"] == "pass"


def test_host_native_service_enforces_internal_token(tmp_path: Path):
    client = _client(
        tmp_path,
        converter=FakeSuccessfulConverter(),
        run_background=False,
        token="secret-token",
    )

    missing = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    valid = client.post(
        "/api/conversions/ifc-to-usdc",
        json=ifc_ready_payload(),
        headers={"X-Internal-Conversion-Token": "secret-token"},
    )

    assert missing.status_code == 401
    assert valid.status_code == 202


def test_host_native_service_failed_conversion_is_not_ready(tmp_path: Path):
    client = _client(tmp_path, converter=FakeFailedConverter())

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    assert result["model"]["status"] != "ready"


# --- adapter D7 contract: honest blocker + correct PowerShell invocation ----


def test_adapter_preflight_missing_prereqs_raises_converter_unavailable(tmp_path: Path):
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,  # no scripts/convert-ifc-to-usdc.ps1 here
        kit_exe_path=None,
        hoops_main_path=None,
    )

    try:
        adapter.preflight()
        raised = None
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"
    # Honest blocker message must name what is missing (script + kit prereqs).
    assert "converter script not found" in raised.message


def test_adapter_convert_blocks_instead_of_faking_when_prereqs_missing(tmp_path: Path):
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=tmp_path)

    try:
        adapter.convert(
            job={"conversion_job_id": "stream_conv_x"},
            ifc_ready_event=ifc_ready_payload(),
            output_dir=tmp_path / "out",
        )
        raised = None
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"
    # MUST NOT have produced any fake-ready artifacts.
    assert not (tmp_path / "out" / "model.usdc").exists()


def test_adapter_builds_powershell_command_and_confirms_usdc(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    ps1 = repo_root / "scripts" / "convert-ifc-to-usdc.ps1"
    ps1.write_text("# fake ps1", encoding="utf-8")
    kit_exe = repo_root / "kit.exe"
    kit_exe.write_text("", encoding="utf-8")
    hoops_main = repo_root / "hoops_main.py"
    hoops_main.write_text("", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "demo-model.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("IFC", encoding="utf-8")

    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        kit_exe_path=kit_exe,
        hoops_main_path=hoops_main,
        timeout_seconds=42,
        work_dir=repo_root,
    )
    # The fake subprocess emits converter-owned sidecars, so the adopt path
    # returns real metrics with no USD runtime needed (pxr is only required on
    # the enumeration fallback, not in preflight).

    captured = {}

    class _Completed:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        # emulate the ps1 producing only model.usdc
        out_dir = Path(cmd[cmd.index("-OutputDir") + 1])
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "model.usdc").write_bytes(b"PXR-USDC-real\n")
        # also emit converter-owned sidecars so _adopt path returns real metrics
        (out_dir / "element_mapping.json").write_text(
            '{"mock": false, "summary": {"mapped_count": 1, "fake_mapping_count": 0}}',
            encoding="utf-8",
        )
        (out_dir / "entity_index.json").write_text('{"entities": []}', encoding="utf-8")
        (out_dir / "metadata.json").write_text('{"source": "ifc_ready"}', encoding="utf-8")
        (out_dir / "quality_metrics.json").write_text(
            '{"coverage_status": "pass", "hard_quality_gates": '
            '{"usdc_openable": true, "has_renderable_prims": true}}',
            encoding="utf-8",
        )
        return _Completed()

    monkeypatch.setattr("subprocess.run", fake_run)

    result = adapter.convert(
        job={"conversion_job_id": "stream_conv_real"},
        ifc_ready_event=ifc_ready_payload(),
        output_dir=tmp_path / "out",
    )

    cmd = captured["cmd"]
    assert cmd[0] == "powershell.exe"
    assert "-NoProfile" in cmd
    assert "-ExecutionPolicy" in cmd and cmd[cmd.index("-ExecutionPolicy") + 1] == "Bypass"
    assert "-File" in cmd and cmd[cmd.index("-File") + 1] == str(ps1.resolve())
    assert cmd[cmd.index("-OutputName") + 1] == "model.usdc"
    assert cmd[cmd.index("-TimeoutSeconds") + 1] == "42"
    assert "-Force" in cmd
    assert captured["kwargs"]["shell"] is False
    assert captured["kwargs"]["cwd"] == str(repo_root)
    assert Path(result["model_path"]).name == "model.usdc"
    assert result["quality_metrics"]["coverage_status"] == "pass"


def test_adapter_from_env_keeps_unset_paths_none(tmp_path: Path):
    adapter = adapter_from_env(tmp_path, env={})
    assert adapter.kit_exe_path is None
    assert adapter.hoops_main_path is None
    assert adapter.timeout_seconds == 600


def test_adapter_from_env_prefers_pwsh_when_available(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "shutil.which",
        lambda name: "C:/Program Files/PowerShell/7/pwsh.exe" if name == "pwsh" else None,
    )

    adapter = adapter_from_env(tmp_path, env={})

    assert adapter.powershell_exe == "C:/Program Files/PowerShell/7/pwsh.exe"


def test_adapter_from_env_explicit_powershell_wins(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "shutil.which",
        lambda name: "C:/Program Files/PowerShell/7/pwsh.exe" if name == "pwsh" else None,
    )

    adapter = adapter_from_env(
        tmp_path,
        env={"STREAMING_CONVERSION_POWERSHELL_EXE": "powershell.exe"},
    )

    assert adapter.powershell_exe == "powershell.exe"


# --- streaming-server-prefer-local-ifc-path:dispatch payload local path resolution -----


def _adapter_with_storage(tmp_path: Path, *, storage_root: Path | None = None) -> Ifc2UsdcPowershellConverterAdapter:
    return Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=storage_root,
    )


def test_adapter_resolve_prefers_host_local_path_inside_storage_root(tmp_path: Path):
    storage = tmp_path / "storage"
    ifc = storage / "ifc-cache" / "job_a" / "source.ifc"
    ifc.parent.mkdir(parents=True)
    ifc.write_bytes(b"IFC")
    adapter = _adapter_with_storage(tmp_path, storage_root=storage)
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_001",
            "format": "ifc",
            "filename": "source.ifc",
            "url": "http://127.0.0.1:9000/should-not-be-fetched.ifc",
            "host_local_path": str(ifc),
        }
    )

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()


def test_adapter_resolve_falls_back_to_local_path_when_host_local_path_missing(tmp_path: Path):
    storage = tmp_path / "storage"
    ifc = storage / "ifc-cache" / "job_b" / "source.ifc"
    ifc.parent.mkdir(parents=True)
    ifc.write_bytes(b"IFC")
    adapter = _adapter_with_storage(tmp_path, storage_root=storage)
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_002",
            "format": "ifc",
            "filename": "source.ifc",
            "url": "http://127.0.0.1:9000/should-not-be-fetched.ifc",
            "local_path": str(ifc),
        }
    )

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()


def test_adapter_resolve_falls_back_to_url_when_local_paths_unreadable(tmp_path: Path):
    """host_local_path/local_path 在 storage_root 內但檔案還沒寫好 → soft fallback url。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    # url 走 edge-local:// 解析(既有 _url_to_local_path 路徑)
    fixture_root = tmp_path / "fixtures"
    fixture_root.mkdir()
    ifc = fixture_root / "fallback.ifc"
    ifc.write_bytes(b"IFC")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=storage,
        work_dir=tmp_path,
    )
    missing_local = storage / "ifc-cache" / "job_c" / "source.ifc"  # 不存在
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_003",
            "format": "ifc",
            "filename": "fallback.ifc",
            "url": "edge-local://fixtures/fallback.ifc",
            "host_local_path": str(missing_local),
        }
    )

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()


def test_adapter_resolve_rejects_local_path_outside_storage_root(tmp_path: Path):
    storage = tmp_path / "storage"
    storage.mkdir()
    outside = tmp_path / "outside" / "secret.ifc"
    outside.parent.mkdir()
    outside.write_bytes(b"OUT")
    adapter = _adapter_with_storage(tmp_path, storage_root=storage)
    event = ifc_ready_payload(
        ifc_artifact={
            "artifact_id": "artifact_local_004",
            "format": "ifc",
            "filename": "secret.ifc",
            "url": "edge-local://fixtures/demo-model.ifc",
            "host_local_path": str(outside),
        }
    )

    try:
        adapter._resolve_local_ifc(event)
        raised = None
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "invalid_ifc_input"
    assert "outside storage_root" in raised.message


def test_adapter_resolve_existing_edge_local_url_still_works(tmp_path: Path):
    """Regression guard:legacy edge-local:// url-only payload(無 local_path/host_local_path)仍能解析。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    ifc = tmp_path / "fixtures" / "demo-model.ifc"
    ifc.parent.mkdir()
    ifc.write_bytes(b"IFC")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=tmp_path,
        storage_root=storage,
        work_dir=tmp_path,
    )
    event = ifc_ready_payload()  # url=edge-local://fixtures/demo-model.ifc,無 local paths

    resolved = adapter._resolve_local_ifc(event)

    assert resolved == ifc.resolve()


# --- streaming-server-capture-kit-conversion-logs:ConversionAuthorityError.metadata
#     propagates through _fail_job into result.error so callers can read Kit
#     subprocess stdout/stderr log paths without re-running the conversion.


class FakeConverterWithLogPaths:
    """Fixture converter that raises with kit_stdout_log / kit_stderr_log metadata."""

    def __init__(self, stdout_log: str, stderr_log: str):
        self._stdout_log = stdout_log
        self._stderr_log = stderr_log

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> dict:
        raise ConversionAuthorityError(
            "converter_failed",
            "convert-ifc-to-usdc.ps1 exited 1: ...stderr tail...",
            metadata={
                "kit_stdout_log": self._stdout_log,
                "kit_stderr_log": self._stderr_log,
            },
        )


def test_failed_conversion_surfaces_kit_log_paths_in_result_error(tmp_path: Path):
    stdout_log = str(tmp_path / "artifacts" / "demo" / "kit-stdout.log")
    stderr_log = str(tmp_path / "artifacts" / "demo" / "kit-stderr.log")
    client = _client(
        tmp_path,
        converter=FakeConverterWithLogPaths(stdout_log=stdout_log, stderr_log=stderr_log),
    )

    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    assert result["ready"] is False
    error = result["error"]
    assert error["code"] == "converter_failed"
    assert error["kit_stdout_log"] == stdout_log
    assert error["kit_stderr_log"] == stderr_log


def test_failed_conversion_without_metadata_still_works(tmp_path: Path):
    """Regression guard:既有 ConversionAuthorityError 不帶 metadata 不應破。"""
    client = _client(tmp_path, converter=FakeFailedConverter())
    create = client.post("/api/conversions/ifc-to-usdc", json=ifc_ready_payload())
    conversion_job_id = create.json()["conversion_job_id"]
    result = client.get(f"/api/conversions/{conversion_job_id}/result").json()

    assert result["status"] == "failed"
    error = result["error"]
    assert error["code"] == "converter_failed"
    # 沒 metadata 時不該硬加 keys
    assert "kit_stdout_log" not in error
    assert "kit_stderr_log" not in error


def test_run_powershell_conversion_regex_extracts_log_paths_from_ps1_throw(tmp_path: Path, monkeypatch):
    """Review Important #2:lock in ps1 throw shape ↔ Python regex 契約。
    monkeypatch subprocess.run 返回 ps1 真實 throw heredoc 形狀,assert
    `_run_powershell_conversion` 拋出 ConversionAuthorityError 且 metadata 含兩個 path。
    包含 Windows path 內的冒號(`C:\\...`)與空格,測 regex 不會被 drive-letter colon 截斷。
    """
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root)

    # 真實 ps1 throw shape(對齊 convert-ifc-to-usdc.ps1::Invoke-KitConversion line ~360 throw heredoc)
    stdout_log_path = r"C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_cache\host-native-conversion\artifacts\stream_conv_demo\kit-stdout.log"
    stderr_log_path = r"C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server\_cache\host-native-conversion\artifacts\stream_conv_demo\kit-stderr.log"
    ps1_throw = (
        "Kit CAD conversion completed but output was not created: C:\\foo\\model.usdc\n"
        f"  kit_stdout_log: {stdout_log_path}\n"
        f"  kit_stderr_log: {stderr_log_path}\n"
        "  ---- stderr tail (last 100 lines) ----\n"
        "<fake stderr lines>\n"
        "  ---- stdout tail (last 50 lines) ----\n"
        "<fake stdout lines>\n"
    )

    class _FakeCompleted:
        returncode = 1
        stderr = ps1_throw
        stdout = ""

    def _fake_run(*args, **kwargs):
        return _FakeCompleted()

    monkeypatch.setattr("subprocess.run", _fake_run)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_powershell_conversion(ifc_path=tmp_path / "fake.ifc", output_dir=tmp_path / "out")
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_failed"
    assert raised.metadata.get("kit_stdout_log") == stdout_log_path
    assert raised.metadata.get("kit_stderr_log") == stderr_log_path
    # spec scenario 1:message MUST contain the tail header substring + log paths
    assert "kit_stdout_log:" in raised.message
    assert "kit_stderr_log:" in raised.message
    assert "---- stderr tail (last 100 lines) ----" in raised.message


# --- fix-ifc-usdc-hoops-load-failure:HOOPS import failure uses real fallback ----


def _write_minimal_converter_sidecars(output_dir: Path) -> None:
    (output_dir / "model.usdc").write_bytes(b"PXR-USDC-real-fallback\n")
    (output_dir / "element_mapping.json").write_text(
        json.dumps(
            {
                "mock": False,
                "summary": {"mapped_count": 1, "fake_mapping_count": 0},
                "items": [{"ifc_guid": "2abc", "usd_prim_path": "/World/IfcShape_000001"}],
            }
        ),
        encoding="utf-8",
    )
    (output_dir / "entity_index.json").write_text(
        json.dumps({"entities": [{"usd_prim_path": "/World/IfcShape_000001"}]}),
        encoding="utf-8",
    )
    (output_dir / "metadata.json").write_text(
        json.dumps({"source": "ifcopenshell_openusd_fallback"}),
        encoding="utf-8",
    )
    (output_dir / "quality_metrics.json").write_text(
        json.dumps(
            {
                "source_ifc_entity_count": 1,
                "mapped_count": 1,
                "unmapped_count": 0,
                "coverage_ratio": 1.0,
                "coverage_status": "pass",
                "materialization_strategy": "ifcopenshell_openusd_fallback",
                "sidecar_carrier_count": 1,
                "minimum_coverage_baseline_locked": False,
                "hard_quality_gates": {
                    "usdc_openable": True,
                    "has_renderable_prims": True,
                    "placeholder_output": False,
                },
            }
        ),
        encoding="utf-8",
    )


def _clear_pxr_test_stubs(monkeypatch) -> None:
    for name in ("pxr", "pxr.Gf", "pxr.Sdf", "pxr.Usd", "pxr.UsdGeom", "pxr.UsdLux"):
        monkeypatch.delitem(sys.modules, name, raising=False)


def test_adapter_falls_back_when_hoops_cannot_load_parseable_ifc(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        work_dir=repo_root,
    )

    def fake_primary_failure(*, ifc_path: Path, output_dir: Path) -> None:
        raise ConversionAuthorityError(
            "converter_failed",
            "Failed to import model C:/source.ifc. Error Code -10007 (A3D_LOAD_CANNOT_LOAD_MODEL)",
        )

    fallback_called = {}

    def fake_fallback(*, ifc_path: Path, output_dir: Path, primary_error: ConversionAuthorityError) -> None:
        fallback_called["ifc_path"] = ifc_path
        fallback_called["primary_error"] = primary_error.message
        output_dir.mkdir(parents=True, exist_ok=True)
        _write_minimal_converter_sidecars(output_dir)

    monkeypatch.setattr(adapter, "_run_powershell_conversion", fake_primary_failure)
    monkeypatch.setattr(adapter, "_run_ifcopenshell_openusd_fallback", fake_fallback, raising=False)

    result = adapter.convert(
        job={"conversion_job_id": "stream_conv_fallback"},
        ifc_ready_event=ifc_ready_payload(
            ifc_artifact={
                "artifact_id": "artifact_ifc_fallback",
                "format": "ifc",
                "filename": "source.ifc",
                "url": "edge-local://fixtures/source.ifc",
            }
        ),
        output_dir=tmp_path / "out",
    )

    assert fallback_called["ifc_path"] == ifc_file.resolve()
    assert "A3D_LOAD_CANNOT_LOAD_MODEL" in fallback_called["primary_error"]
    assert Path(result["model_path"]).name == "model.usdc"
    assert result["quality_metrics"]["materialization_strategy"] == "ifcopenshell_openusd_fallback"


def test_adapter_does_not_fallback_for_non_import_converter_failure(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        work_dir=repo_root,
    )

    def fake_primary_failure(*, ifc_path: Path, output_dir: Path) -> None:
        raise ConversionAuthorityError("converter_failed", "license checkout failed")

    def fallback_must_not_run(**_kwargs) -> None:
        raise AssertionError("fallback should only run for primary IFC import failures")

    monkeypatch.setattr(adapter, "_run_powershell_conversion", fake_primary_failure)
    monkeypatch.setattr(adapter, "_run_ifcopenshell_openusd_fallback", fallback_must_not_run, raising=False)

    raised: ConversionAuthorityError | None = None
    try:
        adapter.convert(
            job={"conversion_job_id": "stream_conv_no_fallback"},
            ifc_ready_event=ifc_ready_payload(
                ifc_artifact={
                    "artifact_id": "artifact_ifc_no_fallback",
                    "format": "ifc",
                    "filename": "source.ifc",
                    "url": "edge-local://fixtures/source.ifc",
                }
            ),
            output_dir=tmp_path / "out",
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_failed"
    assert raised.message == "license checkout failed"


def test_adapter_rejects_placeholder_written_by_fallback(tmp_path: Path, monkeypatch):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(
        repo_root=repo_root,
        powershell_exe="powershell.exe",
        work_dir=repo_root,
    )

    def fake_primary_failure(*, ifc_path: Path, output_dir: Path) -> None:
        raise ConversionAuthorityError(
            "converter_failed",
            "Failed to import model C:/source.ifc. Error Code -10007 (A3D_LOAD_CANNOT_LOAD_MODEL)",
        )

    def fake_placeholder_fallback(**kwargs) -> None:
        output_dir = kwargs["output_dir"]
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "model.usdc").write_bytes(b"worker adapter usdc placeholder\n")

    monkeypatch.setattr(adapter, "_run_powershell_conversion", fake_primary_failure)
    monkeypatch.setattr(
        adapter,
        "_run_ifcopenshell_openusd_fallback",
        fake_placeholder_fallback,
        raising=False,
    )

    raised: ConversionAuthorityError | None = None
    try:
        adapter.convert(
            job={"conversion_job_id": "stream_conv_placeholder"},
            ifc_ready_event=ifc_ready_payload(
                ifc_artifact={
                    "artifact_id": "artifact_ifc_placeholder",
                    "format": "ifc",
                    "filename": "source.ifc",
                    "url": "edge-local://fixtures/source.ifc",
                }
            ),
            output_dir=tmp_path / "out",
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "placeholder_usdc"


def test_ifcopenshell_openusd_fallback_writes_openable_usdc_and_sidecars(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

        def by_type(self, name: str):
            return [object(), object()] if name == "IfcProduct" else []

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = (0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        faces = (0, 1, 2)

    class FakeShape:
        guid = "2abc"
        name = "Demo element"
        type = "IfcBuildingElementProxy"
        geometry = FakeGeometry()

    class FakeIterator:
        def __init__(self):
            self.done = False

        def initialize(self) -> bool:
            return True

        def get(self):
            return FakeShape()

        def next(self) -> bool:
            if self.done:
                return False
            self.done = True
            return False

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator()
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    output_dir = tmp_path / "out"
    adapter._run_ifcopenshell_openusd_fallback(
        ifc_path=ifc_file,
        output_dir=output_dir,
        primary_error=ConversionAuthorityError("converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"),
    )

    from pxr import Usd

    assert Usd.Stage.Open(str(output_dir / "model.usdc")) is not None
    mapping = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    metrics = json.loads((output_dir / "quality_metrics.json").read_text(encoding="utf-8"))
    assert mapping["mock"] is False
    assert mapping["summary"]["mapped_count"] == 1
    assert mapping["summary"]["fake_mapping_count"] == 0
    assert metrics["materialization_strategy"] == "ifcopenshell_openusd_fallback"
    assert metrics["hard_quality_gates"]["usdc_openable"] is True
    assert metrics["hard_quality_gates"]["has_renderable_prims"] is True


def test_ifcopenshell_openusd_fallback_missing_dependency_remains_unavailable(
    tmp_path: Path, monkeypatch
):
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)
    monkeypatch.setitem(sys.modules, "ifcopenshell", None)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_ifcopenshell_openusd_fallback(
            ifc_path=ifc_file,
            output_dir=tmp_path / "out",
            primary_error=ConversionAuthorityError(
                "converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"
            ),
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "converter_unavailable"


def test_ifcopenshell_openusd_fallback_rejects_no_renderable_geometry(
    tmp_path: Path, monkeypatch
):
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = ()
        faces = ()

    class FakeShape:
        guid = "2abc"
        geometry = FakeGeometry()

    class FakeIterator:
        def initialize(self) -> bool:
            return True

        def get(self):
            return FakeShape()

        def next(self) -> bool:
            return False

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator()
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    raised: ConversionAuthorityError | None = None
    try:
        adapter._run_ifcopenshell_openusd_fallback(
            ifc_path=ifc_file,
            output_dir=tmp_path / "out",
            primary_error=ConversionAuthorityError(
                "converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"
            ),
        )
    except ConversionAuthorityError as exc:
        raised = exc

    assert raised is not None
    assert raised.code == "fallback_no_renderable_geometry"


# --- streaming-server-fallback-semantic-mapping:fallback semantic mapping fidelity ---


def _run_fallback_with_single_shape(
    tmp_path: Path,
    monkeypatch,
    *,
    ifc_guid: str,
    ifc_name: str,
    ifc_type: str,
) -> tuple[dict, dict, dict]:
    """Run `_run_ifcopenshell_openusd_fallback` against a single mocked shape and
    return parsed (mapping_doc, entity_index_doc, quality_metrics_doc)."""
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

        def by_type(self, name: str):
            return [object()] if name == "IfcProduct" else []

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = (0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        faces = (0, 1, 2)

    class FakeShape:
        guid = ifc_guid
        name = ifc_name
        type = ifc_type
        geometry = FakeGeometry()

    class FakeIterator:
        def __init__(self):
            self.done = False

        def initialize(self) -> bool:
            return True

        def get(self):
            return FakeShape()

        def next(self) -> bool:
            if self.done:
                return False
            self.done = True
            return False

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator()
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    output_dir = tmp_path / "out"
    adapter._run_ifcopenshell_openusd_fallback(
        ifc_path=ifc_file,
        output_dir=output_dir,
        primary_error=ConversionAuthorityError(
            "converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"
        ),
    )

    mapping_doc = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    entity_index_doc = json.loads((output_dir / "entity_index.json").read_text(encoding="utf-8"))
    metrics_doc = json.loads((output_dir / "quality_metrics.json").read_text(encoding="utf-8"))
    return mapping_doc, entity_index_doc, metrics_doc


def test_fallback_mapping_carries_ifc_type_and_name(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_A",
        ifc_name="樓梯1",
        ifc_type="IfcStair",
    )
    assert mapping_doc["items"], "fallback mapping must have at least one item"
    item = mapping_doc["items"][0]
    assert item["ifc_type"] == "IfcStair"
    assert item["ifc_name"] == "樓梯1"
    assert isinstance(item["entity_id"], str) and item["entity_id"]


def test_fallback_prim_paths_are_ifc_class_grouped(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_B",
        ifc_name="梁1",
        ifc_type="IfcBeam",
    )
    item = mapping_doc["items"][0]
    assert item["usd_prim_path"].startswith("/World/IfcBeam/"), item["usd_prim_path"]


def test_fallback_unclassified_grouping(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_C",
        ifc_name="",
        ifc_type="",
    )
    item = mapping_doc["items"][0]
    assert item["usd_prim_path"].startswith("/World/Unclassified/"), item["usd_prim_path"]
    # ifc_type / ifc_name keys MUST still be present (may be null)
    assert "ifc_type" in item and item["ifc_type"] in (None, "")
    assert "ifc_name" in item and item["ifc_name"] in (None, "")


def test_fallback_prim_path_sanitization(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="abc$def-XYZ!",
        ifc_name="Demo",
        ifc_type="IfcBuildingElementProxy",
    )
    item = mapping_doc["items"][0]
    path = item["usd_prim_path"]
    assert path.startswith("/World/IfcBuildingElementProxy/"), path
    assert "$" not in path
    assert "!" not in path
    assert "-" not in path
    # path segments must be USD-legal: each /-separated segment is [A-Za-z_][A-Za-z0-9_]*
    import re

    for segment in path.split("/")[1:]:
        assert re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", segment), f"illegal USD segment: {segment!r}"


def test_fallback_quality_metrics_semantic_fields(tmp_path: Path, monkeypatch):
    _mapping_doc, _entity_doc, metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_D",
        ifc_name="梁2",
        ifc_type="IfcBeam",
    )
    assert metrics["semantic_mapping_fidelity"] == "ifc_class_grouped_with_name"
    assert metrics["mapping_has_ifc_type"] is True
    assert metrics["mapping_has_ifc_name"] is True
    # legacy quality fields must still be present
    assert metrics["materialization_strategy"] == "ifcopenshell_openusd_fallback"
    assert metrics["hard_quality_gates"]["usdc_openable"] is True


def test_fallback_entity_id_alignment(tmp_path: Path, monkeypatch):
    mapping_doc, entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_E",
        ifc_name="柱1",
        ifc_type="IfcColumn",
    )
    items = mapping_doc["items"]
    entities = entity_doc["entities"]
    assert len(items) == len(entities) == 1
    mapping_ids = {item["entity_id"] for item in items}
    entity_ids = {ent["entity_id"] for ent in entities}
    assert mapping_ids == entity_ids
    # cross-reference: matching entity record carries same ifc_guid + usd_prim_path
    item = items[0]
    matching = next(ent for ent in entities if ent["entity_id"] == item["entity_id"])
    assert matching["ifc_guid"] == item["ifc_guid"]
    assert matching["usd_prim_path"] == item["usd_prim_path"]


def test_fallback_mapping_backward_compat_keys(tmp_path: Path, monkeypatch):
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_single_shape(
        tmp_path,
        monkeypatch,
        ifc_guid="GUID_F",
        ifc_name="牆1",
        ifc_type="IfcWall",
    )
    item = mapping_doc["items"][0]
    # legacy schema keys retained for backward-compatible consumers
    assert "ifc_guid" in item
    assert "usd_prim_path" in item
    assert item["ifc_guid"] == "GUID_F"


def _run_fallback_with_multiple_shapes(
    tmp_path: Path,
    monkeypatch,
    *,
    shapes: list[dict[str, str]],
) -> tuple[dict, dict, dict]:
    """Multi-shape variant of `_run_fallback_with_single_shape`,用於驗證
    multi-shape invariant(prim path uniqueness、entity_id 對齊、跨 class 衝突)。"""
    _clear_pxr_test_stubs(monkeypatch)
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    ifc_file = repo_root / "fixtures" / "source.ifc"
    ifc_file.parent.mkdir(parents=True)
    ifc_file.write_text("ISO-10303-21;", encoding="utf-8")
    adapter = Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)

    fake_ifcopenshell = types.ModuleType("ifcopenshell")
    fake_geom = types.ModuleType("ifcopenshell.geom")

    class FakeModel:
        schema = "IFC4"

    class FakeSettings:
        USE_WORLD_COORDS = "USE_WORLD_COORDS"

        def set(self, *_args):
            return None

    class FakeGeometry:
        verts = (0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        faces = (0, 1, 2)

    class FakeShape:
        def __init__(self, *, guid: str, name: str, ifc_type: str):
            self.guid = guid
            self.name = name
            self.type = ifc_type
            self.geometry = FakeGeometry()

    class FakeIterator:
        def __init__(self, shape_specs: list[dict[str, str]]):
            self._shapes = [
                FakeShape(guid=s["guid"], name=s["name"], ifc_type=s["ifc_type"])
                for s in shape_specs
            ]
            self._index = 0

        def initialize(self) -> bool:
            return len(self._shapes) > 0

        def get(self):
            return self._shapes[self._index]

        def next(self) -> bool:
            self._index += 1
            return self._index < len(self._shapes)

    fake_ifcopenshell.open = lambda _path: FakeModel()
    fake_geom.settings = FakeSettings
    fake_geom.iterator = lambda *_args: FakeIterator(shapes)
    fake_ifcopenshell.geom = fake_geom
    monkeypatch.setitem(sys.modules, "ifcopenshell", fake_ifcopenshell)
    monkeypatch.setitem(sys.modules, "ifcopenshell.geom", fake_geom)

    output_dir = tmp_path / "out"
    adapter._run_ifcopenshell_openusd_fallback(
        ifc_path=ifc_file,
        output_dir=output_dir,
        primary_error=ConversionAuthorityError("converter_failed", "A3D_LOAD_CANNOT_LOAD_MODEL"),
    )

    mapping_doc = json.loads((output_dir / "element_mapping.json").read_text(encoding="utf-8"))
    entity_index_doc = json.loads((output_dir / "entity_index.json").read_text(encoding="utf-8"))
    metrics_doc = json.loads((output_dir / "quality_metrics.json").read_text(encoding="utf-8"))
    return mapping_doc, entity_index_doc, metrics_doc


def test_fallback_sanitized_clash_does_not_overwrite_prim(tmp_path: Path, monkeypatch):
    """不同原始 GUID 但 sanitize 成同 token,prim path 必須 unique。"""
    mapping_doc, _entity_doc, _metrics = _run_fallback_with_multiple_shapes(
        tmp_path,
        monkeypatch,
        shapes=[
            {"guid": "abc$", "name": "牆 A", "ifc_type": "IfcWall"},
            {"guid": "abc!", "name": "牆 B", "ifc_type": "IfcWall"},
            {"guid": "abc-", "name": "牆 C", "ifc_type": "IfcWall"},
        ],
    )
    items = mapping_doc["items"]
    paths = [item["usd_prim_path"] for item in items]
    assert len(items) == 3, "三個 shape 都應該有對應 mapping item"
    assert len(set(paths)) == 3, f"prim path 必須 unique:{paths}"
    assert all(p.startswith("/World/IfcWall/abc_") for p in paths)


def test_fallback_entity_id_one_to_one_with_entity_index_multi_shape(tmp_path: Path, monkeypatch):
    """multi-shape 場景下 mapping items 與 entity_index entry 1:1 對齊。"""
    mapping_doc, entity_doc, _metrics = _run_fallback_with_multiple_shapes(
        tmp_path,
        monkeypatch,
        shapes=[
            {"guid": "GUID_AA", "name": "梁 1", "ifc_type": "IfcBeam"},
            {"guid": "GUID_BB", "name": "柱 1", "ifc_type": "IfcColumn"},
            {"guid": "GUID_CC", "name": "牆 1", "ifc_type": "IfcWall"},
        ],
    )
    items = mapping_doc["items"]
    entities = entity_doc["entities"]
    assert len(items) == len(entities) == 3
    mapping_ids = {item["entity_id"] for item in items}
    entity_ids = {ent["entity_id"] for ent in entities}
    assert mapping_ids == entity_ids
    for item in items:
        matching = next(ent for ent in entities if ent["entity_id"] == item["entity_id"])
        assert matching["ifc_guid"] == item["ifc_guid"]
        assert matching["usd_prim_path"] == item["usd_prim_path"]


# --- streaming-server-enumeration-semantic-mapping ----------------------------


def _make_enumeration_adapter(tmp_path: Path) -> Ifc2UsdcPowershellConverterAdapter:
    repo_root = tmp_path / "repo"
    (repo_root / "scripts").mkdir(parents=True)
    (repo_root / "scripts" / "convert-ifc-to-usdc.ps1").write_text("# fake", encoding="utf-8")
    return Ifc2UsdcPowershellConverterAdapter(repo_root=repo_root, work_dir=repo_root)


def _write_usd_stage_with_ifc_prims(usdc_path: Path, prims_spec: list[dict[str, str]]) -> None:
    """寫一個 USD stage with CustomData 模擬 HOOPS / C1 fallback 產出的 prim。"""
    from pxr import Sdf, Usd, UsdGeom

    usdc_path.parent.mkdir(parents=True, exist_ok=True)
    stage = Usd.Stage.CreateNew(str(usdc_path))
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    for idx, spec in enumerate(prims_spec, start=1):
        path = spec.get("path") or f"/World/Prim_{idx:06d}"
        mesh = UsdGeom.Mesh.Define(stage, path)
        prim = mesh.GetPrim()
        if spec.get("ifc_guid"):
            prim.SetCustomDataByKey("ifcGlobalId", spec["ifc_guid"])
        if spec.get("ifc_type"):
            prim.SetCustomDataByKey("ifcType", spec["ifc_type"])
        if spec.get("ifc_name"):
            prim.SetCustomDataByKey("ifcName", spec["ifc_name"])
    stage.GetRootLayer().Save()


def test_enumeration_path_writes_semantic_fields(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/IfcWall/wall_001", "ifc_guid": "GUID_A1", "ifc_type": "IfcWall", "ifc_name": "外牆 1"},
            {"path": "/World/IfcBeam/beam_001", "ifc_guid": "GUID_B1", "ifc_type": "IfcBeam", "ifc_name": "梁 1"},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    assert quality["materialization_strategy"] == "usd_stage_enumeration"
    assert quality["semantic_mapping_fidelity"] == "ifc_class_grouped_with_name"
    assert quality["mapping_has_ifc_type"] is True
    assert quality["mapping_has_ifc_name"] is True

    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    items = mapping_doc["items"]
    assert len(items) == 2
    for item in items:
        for key in ("ifc_guid", "usd_prim_path", "ifc_type", "ifc_name", "entity_id"):
            assert key in item
    assert {item["ifc_type"] for item in items} == {"IfcWall", "IfcBeam"}

    index_doc = json.loads((out_dir / "entity_index.json").read_text(encoding="utf-8"))
    entities = index_doc["entities"]
    assert isinstance(entities, list) and len(entities) == 2
    # entity_id alignment
    mapping_ids = {item["entity_id"] for item in items}
    entity_ids = {ent["entity_id"] for ent in entities}
    assert mapping_ids == entity_ids


def test_enumeration_path_empty_custom_data_stays_honest(tmp_path: Path, monkeypatch):
    _clear_pxr_test_stubs(monkeypatch)
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    usdc = out_dir / "model.usdc"
    # 兩個純 mesh prim 完全沒 IFC custom data
    _write_usd_stage_with_ifc_prims(
        usdc,
        [
            {"path": "/World/Naked_1"},
            {"path": "/World/Naked_2"},
        ],
    )
    ifc_source = tmp_path / "source.ifc"
    ifc_source.write_text("ISO-10303-21;", encoding="utf-8")

    quality = adapter._enumerate_usd_stage(
        model_path=usdc,
        ifc_path=ifc_source,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )

    # 誠實:沒 IFC data 就是 None / False,不偽宣告
    assert quality["semantic_mapping_fidelity"] is None
    assert quality["mapping_has_ifc_type"] is False
    assert quality["mapping_has_ifc_name"] is False
    mapping_doc = json.loads((out_dir / "element_mapping.json").read_text(encoding="utf-8"))
    assert mapping_doc["items"] == []


def test_adopt_path_supplements_missing_semantic_fields(tmp_path: Path):
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    # converter emit 完整 sidecars,但 quality 沒寫 semantic 欄位
    (out_dir / "element_mapping.json").write_text(
        json.dumps(
            {
                "mock": False,
                "summary": {"mapped_count": 2, "fake_mapping_count": 0},
                "items": [
                    {"ifc_guid": "GUID_X", "usd_prim_path": "/World/IfcWall/x",
                     "ifc_type": "IfcWall", "ifc_name": "牆"},
                    {"ifc_guid": "GUID_Y", "usd_prim_path": "/World/IfcBeam/y",
                     "ifc_type": "IfcBeam", "ifc_name": "梁"},
                ],
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "entity_index.json").write_text(json.dumps({"entities": []}), encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps({"source": "converter"}), encoding="utf-8")
    (out_dir / "quality_metrics.json").write_text(
        json.dumps(
            {
                "source_ifc_entity_count": 2,
                "mapped_count": 2,
                "materialization_strategy": "converter_native",
                "coverage_status": "pass",
            }
        ),
        encoding="utf-8",
    )

    quality = adapter._adopt_converter_sidecars(
        output_dir=out_dir,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )
    assert quality is not None
    assert quality["semantic_mapping_fidelity"] == "ifc_class_grouped_with_name"
    assert quality["mapping_has_ifc_type"] is True
    assert quality["mapping_has_ifc_name"] is True
    # converter native 既有欄位不被蓋
    assert quality["materialization_strategy"] == "converter_native"
    assert quality["coverage_status"] == "pass"


def test_adopt_path_does_not_overwrite_existing_semantic(tmp_path: Path):
    adapter = _make_enumeration_adapter(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "element_mapping.json").write_text(
        json.dumps(
            {
                "mock": False,
                "summary": {"mapped_count": 1, "fake_mapping_count": 0},
                "items": [
                    {"ifc_guid": "GUID_Z", "usd_prim_path": "/World/x",
                     "ifc_type": "IfcDoor", "ifc_name": "門"},
                ],
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "entity_index.json").write_text(json.dumps({"entities": []}), encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps({"source": "converter"}), encoding="utf-8")
    # converter 自己已寫 semantic_mapping_fidelity:adopt 不可蓋
    (out_dir / "quality_metrics.json").write_text(
        json.dumps(
            {
                "source_ifc_entity_count": 1,
                "materialization_strategy": "converter_native",
                "semantic_mapping_fidelity": "converter_native_high_fidelity",
                "mapping_has_ifc_type": True,
                "mapping_has_ifc_name": False,
            }
        ),
        encoding="utf-8",
    )

    quality = adapter._adopt_converter_sidecars(
        output_dir=out_dir,
        mapping_path=out_dir / "element_mapping.json",
        entity_index_path=out_dir / "entity_index.json",
        metadata_path=out_dir / "metadata.json",
    )
    assert quality is not None
    # 既有值不被蓋
    assert quality["semantic_mapping_fidelity"] == "converter_native_high_fidelity"
    assert quality["mapping_has_ifc_type"] is True
    # converter 寫 False 也保留,不被 mapping 推導蓋掉
    assert quality["mapping_has_ifc_name"] is False
