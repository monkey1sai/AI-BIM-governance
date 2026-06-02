"""Host-native IFC->USDC converter adapter (introduce-host-native-conversion-authority-service, D7).

This adapter is the ONLY new conversion execution body added by this change. It is
dependency-injected into the existing ``create_conversion_api_app(converter=...)`` /
``StreamingConversionStore(converter=...)``; the store gate logic
(``_required_output_paths`` / ``_assert_publishable_outputs``) is NOT changed and
NOT bypassed.

Honesty contract (design.md D7 / OQ2, host-native-conversion-authority-service spec
"Missing converter is an honest blocker"):

- ``preflight()`` verifies every real converter prerequisite. Anything missing ->
  ``ConversionAuthorityError("converter_unavailable", <actionable message>)``.
- ``convert()`` runs ``scripts/convert-ifc-to-usdc.ps1`` (which only emits ``.usdc``)
  and is then responsible for producing ``element_mapping.json`` /
  ``entity_index.json`` / ``metadata.json`` + real ``quality_metrics`` from the
  produced USDC. It never fabricates placeholder USDC or fake mapping; on any
  missing prerequisite / failure it raises ``ConversionAuthorityError`` so the
  store fails the job (``model.status="failed"``) instead of publishing a
  fake-ready result.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping
from urllib.parse import unquote, urlparse
import json
import os
import re
import shutil
import subprocess

from conversion_authority import ConversionAuthorityError, _PLACEHOLDER_MARKERS
from ifc_openusd_identity_author import IDENTITY_PROFILE, IfcOpenUsdIdentityAuthor


class Ifc2UsdcPowershellConverterAdapter:
    """Run ``scripts/convert-ifc-to-usdc.ps1`` on the host and normalize outputs.

    Produces the four store-required outputs (``model.usdc``,
    ``element_mapping.json``, ``entity_index.json``, ``metadata.json``) plus
    ``quality_metrics``. Missing prerequisites raise ``converter_unavailable``;
    conversion failures raise a specific ``ConversionAuthorityError`` code.
    """

    def __init__(
        self,
        *,
        repo_root: Path,
        powershell_exe: str = "powershell.exe",
        kit_exe_path: Path | None = None,
        hoops_main_path: Path | None = None,
        config_path: Path | None = None,
        timeout_seconds: int = 600,
        work_dir: Path | None = None,
        storage_root: Path | None = None,
    ) -> None:
        self.repo_root = Path(repo_root)
        self.powershell_exe = powershell_exe
        self.kit_exe_path = Path(kit_exe_path) if kit_exe_path else None
        self.hoops_main_path = Path(hoops_main_path) if hoops_main_path else None
        self.config_path = Path(config_path) if config_path else None
        self.timeout_seconds = int(timeout_seconds)
        self.work_dir = Path(work_dir) if work_dir else self.repo_root
        self.ps1_path = self.repo_root / "scripts" / "convert-ifc-to-usdc.ps1"
        # streaming-server-prefer-local-ifc-path: shared volume sandbox base for
        # dispatch payload host_local_path / local_path. Source = 顯式 storage_root
        # 參數,否則 env STORAGE_ROOT(compose 對齊)。兩者皆缺時不得 fallback
        # Path.cwd()(會把整個 cwd 變成可信沙箱),而是 raise 誠實 blocker。
        # storage_root / STORAGE_ROOT 皆須為非空白值。空字串(strip 後為空)不得
        # 被當成有效來源——否則 Path("").resolve() 會靜默退化成 cwd 沙箱,正是
        # spec「never silently fall back to CWD」明文禁止的。顯式參數優先,其次
        # env STORAGE_ROOT;兩者皆空白即 raise 誠實 blocker。
        explicit_root = str(storage_root).strip() if storage_root is not None else ""
        env_root = (os.environ.get("STORAGE_ROOT") or "").strip()
        chosen_root = explicit_root or env_root
        if not chosen_root:
            raise ConversionAuthorityError(
                "converter_unavailable",
                "STORAGE_ROOT is not configured: refusing to fall back to the "
                "current working directory as the IFC sandbox base. Set the "
                "STORAGE_ROOT environment variable or pass storage_root explicitly.",
            )
        self.storage_root = Path(chosen_root).resolve()

    # -- preflight -----------------------------------------------------------

    def preflight(self) -> None:
        """Fail fast (and honestly) when any real converter prerequisite is missing."""
        missing: list[str] = []
        # storage sandbox base 已由 __init__ 強制(顯式 storage_root 或 env
        # STORAGE_ROOT,空白/缺失即 raise converter_unavailable),self.storage_root
        # 因此恆為非空 Path;不在此重複檢查一個永遠 truthy 的屬性(死碼會給假安全感)。
        if not self.ps1_path.is_file():
            missing.append(f"converter script not found: {self.ps1_path}")
        if not self._powershell_resolvable():
            missing.append(
                f"PowerShell executable not resolvable: {self.powershell_exe} "
                "(host-native conversion must launch the .ps1 from PowerShell, not Git Bash)"
            )
        # kit.exe / hoops_main: when NOT explicitly configured, convert-ifc-to-usdc.ps1
        # resolves its own repo defaults — do not pre-block an otherwise valid
        # default build. Only fail when an explicitly configured path is missing.
        if self.kit_exe_path is not None and not self.kit_exe_path.is_file():
            missing.append(f"configured Kit executable not found: {self.kit_exe_path}")
        if self.hoops_main_path is not None and not self.hoops_main_path.exists():
            missing.append(f"configured HOOPS entrypoint not found: {self.hoops_main_path}")
        if self.config_path is not None and not self.config_path.exists():
            missing.append(f"converter config not found: {self.config_path}")
        # USD runtime is only needed on the enumeration fallback (no converter
        # sidecars). It is checked there, not as a blanket preflight gate, so a
        # converter that emits its own sidecars is not falsely blocked.
        if missing:
            raise ConversionAuthorityError(
                "converter_unavailable",
                "Host-native IFC->USDC converter prerequisites missing: "
                + "; ".join(missing),
            )

    # -- convert -------------------------------------------------------------

    def convert(
        self,
        *,
        job: Mapping[str, Any],
        ifc_ready_event: Mapping[str, Any],
        output_dir: Path,
    ) -> Mapping[str, Any]:
        self.preflight()

        ifc_path = self._resolve_local_ifc(ifc_ready_event)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        conversion_profile = self._conversion_profile(job=job, ifc_ready_event=ifc_ready_event)
        if conversion_profile == IDENTITY_PROFILE:
            authored = IfcOpenUsdIdentityAuthor(
                ifc_path=ifc_path,
                output_dir=output_dir,
                source_model_version_id=str(
                    job.get("model_version_id")
                    or ifc_ready_event.get("model_version_id")
                    or ""
                )
                or None,
            ).author()
            paths = authored["paths"]
            return {
                "model_path": paths["model_path"],
                "mapping_path": paths["mapping_path"],
                "entity_index_path": paths["entity_index_path"],
                "metadata_path": paths["metadata_path"],
                "pset_index_path": paths["pset_index_path"],
                "spatial_index_path": paths["spatial_index_path"],
                "bbox_index_path": paths["bbox_index_path"],
                "quality_metrics_path": paths["quality_metrics_path"],
                "geo_reference_path": paths["geo_reference_path"],
                "quality_metrics": authored["quality_metrics"],
            }
        if conversion_profile:
            raise ConversionAuthorityError(
                "invalid_conversion_profile",
                f"Unsupported conversion_profile: {conversion_profile}",
            )

        try:
            self._run_powershell_conversion(ifc_path=ifc_path, output_dir=output_dir)
        except ConversionAuthorityError as exc:
            if not self._is_primary_ifc_import_failure(exc):
                raise
            self._run_ifcopenshell_openusd_fallback(
                ifc_path=ifc_path,
                output_dir=output_dir,
                primary_error=exc,
            )

        if not model_path.is_file():
            raise ConversionAuthorityError(
                "missing_output",
                f"Converter did not produce model.usdc at {model_path}",
            )
        # placeholder marker 可能落在檔案任何位置(非僅前 4096 bytes),因此掃
        # 全檔 read_bytes();偵測到即拒絕發佈,避免假 ready 的 placeholder USDC。
        body = model_path.read_bytes().lower()
        if any(marker in body for marker in _PLACEHOLDER_MARKERS):
            raise ConversionAuthorityError(
                "placeholder_usdc",
                "Converter produced a placeholder model.usdc; refusing to publish.",
            )

        mapping_path = output_dir / "element_mapping.json"
        entity_index_path = output_dir / "entity_index.json"
        metadata_path = output_dir / "metadata.json"
        quality_metrics = self._materialize_sidecars(
            model_path=model_path,
            ifc_path=ifc_path,
            output_dir=output_dir,
            mapping_path=mapping_path,
            entity_index_path=entity_index_path,
            metadata_path=metadata_path,
        )

        return {
            "model_path": model_path,
            "mapping_path": mapping_path,
            "entity_index_path": entity_index_path,
            "metadata_path": metadata_path,
            "quality_metrics": quality_metrics,
        }

    # -- internals -----------------------------------------------------------

    def _powershell_resolvable(self) -> bool:
        exe = Path(self.powershell_exe)
        if exe.is_file():
            return True
        from shutil import which

        return which(self.powershell_exe) is not None

    def _conversion_profile(
        self,
        *,
        job: Mapping[str, Any],
        ifc_ready_event: Mapping[str, Any],
    ) -> str | None:
        raw = job.get("conversion_profile") or ifc_ready_event.get("conversion_profile")
        if raw is None:
            return None
        value = str(raw).strip()
        return value or None

    def _resolve_local_ifc(self, ifc_ready_event: Mapping[str, Any]) -> Path:
        artifact = ifc_ready_event.get("ifc_artifact")
        if not isinstance(artifact, dict):
            raise ConversionAuthorityError(
                "invalid_ifc_input", "ifc_ready event is missing ifc_artifact."
            )
        # streaming-server-prefer-local-ifc-path: 優先用 coordinator 寫到 shared volume
        # 的 IFC,避免重複 HTTP fetch。host_local_path 是 host-native streaming-server
        # 直接讀的 host fs path;local_path 在共享 fs 場景下與其同值,作為 fallback。
        # 兩者都必須落在 storage_root 之內(防 path traversal)。
        local = self._try_local_path(artifact.get("host_local_path"))
        if local is None:
            local = self._try_local_path(artifact.get("local_path"))
        if local is not None:
            return local
        url = artifact.get("url") or artifact.get("file_url") or artifact.get(
            "signed_upload_reference"
        )
        if not url:
            raise ConversionAuthorityError(
                "invalid_ifc_input", "ifc_artifact has no resolvable url."
            )
        local = self._url_to_local_path(str(url))
        if local is None or not local.is_file():
            raise ConversionAuthorityError(
                "invalid_ifc_input",
                f"IFC source is not a readable local file: {url}",
            )
        return local

    def _try_local_path(self, candidate: Any) -> Path | None:
        """Resolve a dispatch-payload local path inside storage_root sandbox.

        Returns the resolved Path if the file exists and lies inside
        ``self.storage_root``; returns None when the candidate is missing or
        the file does not yet exist (soft fallback). Raises
        ``ConversionAuthorityError("invalid_ifc_input")`` when the resolved
        path escapes ``storage_root`` (security hard-fail).
        """
        if not candidate:
            return None
        raw = str(candidate).strip()
        if not raw:
            return None
        path = Path(raw)
        base = self.storage_root
        resolved = (
            path.resolve()
            if path.is_absolute()
            else (base / path).resolve()
        )
        try:
            resolved.relative_to(base)
        except ValueError as exc:
            raise ConversionAuthorityError(
                "invalid_ifc_input",
                f"local IFC path is outside storage_root: {raw}",
            ) from exc
        if not resolved.is_file():
            return None
        return resolved

    def _url_to_local_path(self, url: str) -> Path | None:
        parsed = urlparse(url)
        scheme = (parsed.scheme or "").lower()
        if scheme in ("", "file"):
            raw = parsed.path or url
            if scheme == "":
                raw = url
            candidate = Path(unquote(raw))
            if not candidate.is_absolute() and parsed.netloc:
                candidate = Path(unquote(parsed.netloc)) / candidate
            return self._anchor(candidate)
        if scheme == "edge-local":
            rel = (parsed.netloc + parsed.path) if parsed.netloc else parsed.path
            return self._anchor(Path(unquote(rel.lstrip("/"))))
        return None

    def _anchor(self, candidate: Path) -> Path:
        # Constrain resolved IFC paths to work_dir so a crafted artifact URL
        # (`..`, absolute path) cannot target arbitrary local files.
        base = self.work_dir.resolve()
        resolved = (
            candidate.resolve()
            if candidate.is_absolute()
            else (base / candidate).resolve()
        )
        try:
            resolved.relative_to(base)
        except ValueError as exc:
            raise ConversionAuthorityError(
                "invalid_ifc_input",
                f"IFC path escapes configured work directory: {resolved}",
            ) from exc
        return resolved

    def _run_powershell_conversion(self, *, ifc_path: Path, output_dir: Path) -> None:
        cmd: list[str] = [
            self.powershell_exe,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(self.ps1_path.resolve()),
            "-IfcPath",
            str(ifc_path.resolve()),
            "-OutputDir",
            str(output_dir.resolve()),
            "-OutputName",
            "model.usdc",
            "-TimeoutSeconds",
            str(self.timeout_seconds),
            "-Force",
        ]
        if self.config_path is not None:
            cmd += ["-ConfigPath", str(self.config_path.resolve())]
        if self.kit_exe_path is not None:
            cmd += ["-KitExePath", str(self.kit_exe_path.resolve())]
        if self.hoops_main_path is not None:
            cmd += ["-HoopsMainPath", str(self.hoops_main_path.resolve())]
        try:
            completed = subprocess.run(
                cmd,
                cwd=str(self.repo_root),
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                shell=False,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ConversionAuthorityError(
                "converter_timeout",
                f"convert-ifc-to-usdc.ps1 exceeded {self.timeout_seconds}s and was killed.",
            ) from exc
        except OSError as exc:
            raise ConversionAuthorityError(
                "converter_unavailable",
                f"Failed to launch PowerShell converter: {exc}",
            ) from exc
        if completed.returncode != 0:
            # streaming-server-capture-kit-conversion-logs §3:ps1 wrapper emit 一行
            # `##CONV_META## {"kit_stdout_log":"<path>","kit_stderr_log":"<path>"}`
            # (見 convert-ifc-to-usdc.ps1 Invoke-KitConversion)。sentinel + JSON 取代
            # 脆弱的 prose regex:用 re.search 抓 JSON payload,json.loads 解析失敗
            # fallback 空 dict 不 crash。kit_stdout_log/kit_stderr_log 放進
            # ConversionAuthorityError.metadata,讓 host_native_conversion_service 寫進
            # result.error 內,operator 可直接 tail 完整 Kit subprocess log。
            metadata: dict = {}
            combined = "\n".join(filter(None, (completed.stderr or "", completed.stdout or "")))
            # 單行 compact JSON(ps1 用 ConvertTo-Json -Compress):用貪婪 (\{.*\})
            # 吃到該行最後一個右括號 + 行錨 $,避免非貪婪在 log path 含字面右括號時
            # 提早截斷;不用 DOTALL 讓 . 不跨行,MULTILINE 讓 $ 對應每一行尾。
            meta_match = re.search(r"##CONV_META##[ \t]*(\{.*\})\s*$", combined, re.MULTILINE)
            if meta_match:
                try:
                    parsed_meta = json.loads(meta_match.group(1))
                except (ValueError, TypeError):
                    parsed_meta = {}
                if isinstance(parsed_meta, dict):
                    for key in ("kit_stdout_log", "kit_stderr_log"):
                        value = parsed_meta.get(key)
                        if value:
                            metadata[key] = str(value).strip()
            # streaming-server-capture-kit-conversion-logs review fix(2026-05-22):
            # 把 log path 與 spec-required "---- stderr tail (last 100 lines) ----"
            # 標頭顯式 prepend 到 message 開頭,再放 tail,避免 truncation 把 spec
            # 要求的 substring 從 message 後段砍掉(spec scenario 1)。tail 額度
            # 提升到 3000 chars 以涵蓋 header + 大部分 tail 內容。
            tail = (completed.stderr or completed.stdout or "").strip()[-3000:]
            message_parts = [f"convert-ifc-to-usdc.ps1 exited {completed.returncode}"]
            if "kit_stdout_log" in metadata:
                message_parts.append(f"kit_stdout_log: {metadata['kit_stdout_log']}")
            if "kit_stderr_log" in metadata:
                message_parts.append(f"kit_stderr_log: {metadata['kit_stderr_log']}")
            message_parts.append(tail)
            raise ConversionAuthorityError(
                "converter_failed",
                "\n".join(message_parts),
                metadata=metadata or None,
            )

    def _is_primary_ifc_import_failure(self, exc: ConversionAuthorityError) -> bool:
        if exc.code != "converter_failed":
            return False
        message = exc.message.lower()
        return any(
            marker in message
            for marker in (
                "a3d_load_cannot_load_model",
                "failed to import model",
                "cannot load model",
            )
        )

    def _run_ifcopenshell_openusd_fallback(
        self,
        *,
        ifc_path: Path,
        output_dir: Path,
        primary_error: ConversionAuthorityError,
    ) -> None:
        """Write a real geometry-bearing USDC when HOOPS cannot import the IFC."""
        try:
            import ifcopenshell
            import ifcopenshell.geom
            from pxr import Gf, Usd, UsdGeom
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "converter_unavailable",
                "Kit/HOOPS could not import the IFC and IfcOpenShell/OpenUSD "
                f"fallback dependencies are unavailable: {exc}",
                metadata=getattr(primary_error, "metadata", None),
            ) from exc

        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / "model.usdc"
        mapping_path = output_dir / "element_mapping.json"
        entity_index_path = output_dir / "entity_index.json"
        metadata_path = output_dir / "metadata.json"
        quality_metrics_path = output_dir / "quality_metrics.json"

        try:
            ifc_model = ifcopenshell.open(str(ifc_path))
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "fallback_ifc_parse_failed",
                f"IfcOpenShell could not parse fallback IFC input {ifc_path}: {exc}",
                metadata=getattr(primary_error, "metadata", None),
            ) from exc

        try:
            settings = ifcopenshell.geom.settings()
            use_world_coords = getattr(settings, "USE_WORLD_COORDS", None)
            if use_world_coords is not None:
                settings.set(use_world_coords, True)
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "fallback_geometry_settings_failed",
                f"IfcOpenShell fallback geometry settings failed: {exc}",
                metadata=getattr(primary_error, "metadata", None),
            ) from exc

        try:
            worker_count = max(os.cpu_count() or 1, 1)
            iterator = ifcopenshell.geom.iterator(settings, ifc_model, worker_count)
        except TypeError:
            iterator = ifcopenshell.geom.iterator(settings, ifc_model)
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "fallback_geometry_iterator_failed",
                f"IfcOpenShell fallback geometry iterator could not start: {exc}",
                metadata=getattr(primary_error, "metadata", None),
            ) from exc

        try:
            initialized = iterator.initialize()
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "fallback_geometry_iterator_failed",
                f"IfcOpenShell fallback geometry iterator initialization failed: {exc}",
                metadata=getattr(primary_error, "metadata", None),
            ) from exc
        if not initialized:
            raise ConversionAuthorityError(
                "fallback_no_renderable_geometry",
                f"IfcOpenShell fallback found no renderable geometry in {ifc_path}",
                metadata=getattr(primary_error, "metadata", None),
            )

        stage = Usd.Stage.CreateNew(str(model_path))
        if stage is None:
            raise ConversionAuthorityError(
                "fallback_usdc_create_failed",
                f"OpenUSD could not create fallback USDC at {model_path}",
                metadata=getattr(primary_error, "metadata", None),
            )
        world = UsdGeom.Xform.Define(stage, "/World")
        stage.SetDefaultPrim(world.GetPrim())
        try:
            UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
            UsdGeom.SetStageMetersPerUnit(stage, 1.0)
        except Exception:
            pass

        mapping_items: list[dict[str, Any]] = []
        entity_items: list[dict[str, Any]] = []
        ifc_class_xforms: set[str] = set()
        shape_count = 0
        skipped_shape_count = 0
        while True:
            try:
                shape = iterator.get()
            except Exception as exc:  # noqa: BLE001
                raise ConversionAuthorityError(
                    "fallback_geometry_iterator_failed",
                    "IfcOpenShell fallback geometry iterator failed while reading "
                    f"a shape: {exc}",
                    metadata=getattr(primary_error, "metadata", None),
                ) from exc

            geometry = getattr(shape, "geometry", None)
            verts_raw = tuple(getattr(geometry, "verts", ()) or ())
            faces_raw = tuple(getattr(geometry, "faces", ()) or ())
            points, face_indices, face_counts = self._usd_mesh_data_from_ifcopenshell(
                verts_raw=verts_raw,
                faces_raw=faces_raw,
                vec3_type=Gf.Vec3f,
            )

            if not points or not face_indices:
                skipped_shape_count += 1
            else:
                shape_count += 1
                ifc_guid = str(getattr(shape, "guid", "") or "")
                ifc_name = str(getattr(shape, "name", "") or "")
                ifc_type = str(getattr(shape, "type", "") or "")

                # streaming-server-fallback-semantic-mapping:IFC-class grouped
                # prim path. Per-class Xform 只 Define 一次;GUID/class 任一含
                # 非 USD-legal 字元時走 _safe_usd_prim_name 做 sanitize。
                # collision suffix 用 while-loop counter:不同原始 GUID
                # (例如 `abc$` / `abc!` / `abc-`)可能 sanitize 成同一 token,
                # 必須以「下一個未使用的 __N 後綴」確保 prim path 在 stage 內
                # 唯一,避免 UsdGeom.Mesh.Define 對既有 prim reapply 而 silently
                # overwrite 前一個 shape 的 mesh attr。
                class_token = self._resolve_ifc_class_token(ifc_type)
                guid_token = self._resolve_guid_token(ifc_guid, shape_count)
                if class_token not in ifc_class_xforms:
                    UsdGeom.Xform.Define(stage, f"/World/{class_token}")
                    ifc_class_xforms.add(class_token)
                candidate = f"/World/{class_token}/{guid_token}"
                suffix = 1
                while stage.GetPrimAtPath(candidate).IsValid():
                    candidate = f"/World/{class_token}/{guid_token}__{suffix}"
                    suffix += 1
                prim_path = candidate

                mesh = UsdGeom.Mesh.Define(stage, prim_path)
                mesh.CreatePointsAttr(points)
                mesh.CreateFaceVertexCountsAttr(face_counts)
                mesh.CreateFaceVertexIndicesAttr(face_indices)
                mesh.CreateExtentAttr(self._mesh_extent(points, vec3_type=Gf.Vec3f))

                prim = mesh.GetPrim()
                if ifc_guid:
                    prim.SetCustomDataByKey("ifcGlobalId", ifc_guid)
                    prim.SetCustomDataByKey("ifc_guid", ifc_guid)
                if ifc_name:
                    prim.SetCustomDataByKey("ifcName", ifc_name)
                if ifc_type:
                    prim.SetCustomDataByKey("ifcType", ifc_type)

                entity_id = f"entity_{shape_count:06d}"
                if ifc_guid:
                    mapping_items.append(
                        {
                            "ifc_guid": ifc_guid,
                            "usd_prim_path": prim_path,
                            "ifc_type": ifc_type or None,
                            "ifc_name": ifc_name or None,
                            "entity_id": entity_id,
                        }
                    )
                entity_items.append(
                    {
                        "ifc_guid": ifc_guid or None,
                        "ifc_type": ifc_type or None,
                        "name": ifc_name or None,
                        "usd_prim_path": prim_path,
                        "entity_id": entity_id,
                    }
                )

            try:
                has_next = iterator.next()
            except Exception as exc:  # noqa: BLE001
                raise ConversionAuthorityError(
                    "fallback_geometry_iterator_failed",
                    f"IfcOpenShell fallback geometry iterator failed advancing: {exc}",
                    metadata=getattr(primary_error, "metadata", None),
                ) from exc
            if not has_next:
                break

        if shape_count == 0:
            raise ConversionAuthorityError(
                "fallback_no_renderable_geometry",
                f"IfcOpenShell fallback produced no renderable meshes for {ifc_path}",
                metadata=getattr(primary_error, "metadata", None),
            )

        try:
            stage.GetRootLayer().Save()
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "fallback_usdc_save_failed",
                f"OpenUSD could not save fallback USDC at {model_path}: {exc}",
                metadata=getattr(primary_error, "metadata", None),
            ) from exc

        reopened = Usd.Stage.Open(str(model_path))
        if reopened is None:
            raise ConversionAuthorityError(
                "usdc_not_openable",
                f"Fallback USDC could not be opened by USD: {model_path}",
                metadata=getattr(primary_error, "metadata", None),
            )
        renderable_count = sum(1 for prim in reopened.Traverse() if UsdGeom.Mesh(prim))
        if renderable_count == 0:
            raise ConversionAuthorityError(
                "fallback_no_renderable_geometry",
                f"Fallback USDC has no renderable mesh prims: {model_path}",
                metadata=getattr(primary_error, "metadata", None),
            )

        schema = str(getattr(ifc_model, "schema", "") or "")
        mapped_count = len(mapping_items)
        source_count = shape_count
        coverage_ratio = (mapped_count / source_count) if source_count else 0.0
        mapping_doc = {
            "mock": False,
            "summary": {
                "mapped_count": mapped_count,
                "fake_mapping_count": 0,
            },
            "items": mapping_items,
        }
        index_doc = {
            "entities": entity_items,
        }
        metadata_doc = {
            "source": "ifcopenshell_openusd_fallback",
            "source_ifc": ifc_path.name,
            "ifc_schema": schema or None,
            "usd_root_layer": model_path.name,
            "mesh_count": shape_count,
            "skipped_shape_count": skipped_shape_count,
            "primary_converter_error": primary_error.message,
        }
        # streaming-server-fallback-semantic-mapping:declare semantic fidelity
        # so coordinator /ui 與 viewer 可不必 re-parse mapping_items 即判定
        # Semantic ready。flags 取 mapping_items 為主而非 entity_items,因為
        # mapping items 才是 viewer 對外消費的 IFC GUID → USD prim 對照表。
        mapping_has_ifc_type = any(item.get("ifc_type") for item in mapping_items)
        mapping_has_ifc_name = any(item.get("ifc_name") for item in mapping_items)
        quality_metrics = {
            "source_ifc_entity_count": source_count,
            "mapped_count": mapped_count,
            "unmapped_count": max(source_count - mapped_count, 0),
            "coverage_ratio": coverage_ratio,
            "coverage_status": "pass" if mapped_count == source_count else "warn",
            "materialization_strategy": "ifcopenshell_openusd_fallback",
            "sidecar_carrier_count": shape_count,
            "minimum_coverage_baseline_locked": False,
            "semantic_mapping_fidelity": "ifc_class_grouped_with_name",
            "mapping_has_ifc_type": mapping_has_ifc_type,
            "mapping_has_ifc_name": mapping_has_ifc_name,
            "hard_quality_gates": {
                "usdc_openable": True,
                "has_renderable_prims": True,
                "placeholder_output": False,
            },
        }

        mapping_path.write_text(
            json.dumps(mapping_doc, ensure_ascii=False), encoding="utf-8"
        )
        entity_index_path.write_text(
            json.dumps(index_doc, ensure_ascii=False), encoding="utf-8"
        )
        metadata_path.write_text(
            json.dumps(metadata_doc, ensure_ascii=False), encoding="utf-8"
        )
        quality_metrics_path.write_text(
            json.dumps(quality_metrics, ensure_ascii=False), encoding="utf-8"
        )

    @staticmethod
    def _safe_usd_prim_name(text: str) -> str | None:
        """Sanitize an arbitrary string into a USD-legal prim name segment.

        USD prim names must match `[A-Za-z_][A-Za-z0-9_]*`. Returns ``None``
        for empty input (callers fall back to a deterministic placeholder).
        """
        if not text:
            return None
        sanitized = "".join(
            ch if ch.isalnum() or ch == "_" else "_" for ch in text
        )
        if not sanitized:
            return None
        if not (sanitized[0].isalpha() or sanitized[0] == "_"):
            sanitized = "_" + sanitized
        return sanitized

    @classmethod
    def _resolve_ifc_class_token(cls, ifc_type: str) -> str:
        """Return USD-legal IFC class token, defaulting to ``Unclassified``."""
        return cls._safe_usd_prim_name(ifc_type) or "Unclassified"

    @classmethod
    def _resolve_guid_token(cls, ifc_guid: str, shape_index: int) -> str:
        """Return USD-legal GUID token, defaulting to ``Shape_NNNNNN``."""
        return cls._safe_usd_prim_name(ifc_guid) or f"Shape_{shape_index:06d}"

    def _usd_mesh_data_from_ifcopenshell(
        self,
        *,
        verts_raw: tuple[Any, ...],
        faces_raw: tuple[Any, ...],
        vec3_type: Any,
    ) -> tuple[list[Any], list[int], list[int]]:
        vertex_count = len(verts_raw) // 3
        points = [
            vec3_type(
                float(verts_raw[offset]),
                float(verts_raw[offset + 1]),
                float(verts_raw[offset + 2]),
            )
            for offset in range(0, vertex_count * 3, 3)
        ]
        face_indices: list[int] = []
        face_counts: list[int] = []
        for offset in range(0, len(faces_raw) - 2, 3):
            triangle = [
                int(faces_raw[offset]),
                int(faces_raw[offset + 1]),
                int(faces_raw[offset + 2]),
            ]
            if all(0 <= index < vertex_count for index in triangle):
                face_indices.extend(triangle)
                face_counts.append(3)
        return points, face_indices, face_counts

    def _mesh_extent(self, points: list[Any], *, vec3_type: Any) -> list[Any]:
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        zs = [float(point[2]) for point in points]
        return [
            vec3_type(min(xs), min(ys), min(zs)),
            vec3_type(max(xs), max(ys), max(zs)),
        ]

    def _materialize_sidecars(
        self,
        *,
        model_path: Path,
        ifc_path: Path,
        output_dir: Path,
        mapping_path: Path,
        entity_index_path: Path,
        metadata_path: Path,
    ) -> Mapping[str, Any]:
        """Derive the three sidecars + quality_metrics from the real produced USDC.

        The converter (HOOPS/Kit) may already emit sidecars next to the USDC. When
        present we adopt them; otherwise we enumerate the produced USD stage.
        We never fabricate fake mapping content (the store would reject it, and
        D7/OQ2 forbid polluting B-scheme evidence).

        streaming-server-ifcopenshell-semantic-sidecar-pass: when adoption misses
        and the IFC source is still on disk, run a serial IfcOpenShell pass to
        write `ifc_semantic_sidecar.json` co-located with model.usdc; the
        enumeration path will read it as a supplement when prim CustomData has
        no IFC keys (HOOPS happy path reality). The pass MUST NOT block ready
        publication on its own failure.
        """
        adopted = self._adopt_converter_sidecars(
            output_dir=output_dir,
            mapping_path=mapping_path,
            entity_index_path=entity_index_path,
            metadata_path=metadata_path,
        )
        # streaming-server-ifcopenshell-semantic-sidecar-pass:adopt 拿到 sidecars
        # 但 semantic 三欄位全 falsy(HOOPS happy path 真實情境:四檔都 emit 但
        # mapping_has_ifc_type / mapping_has_ifc_name 都 false)時,SHALL 仍跑
        # sidecar pass 補語意,對齊 spec scenario「HOOPS success without IFC
        # CustomData triggers sidecar pass」。
        if adopted is not None and (
            bool(adopted.get("mapping_has_ifc_type"))
            or bool(adopted.get("mapping_has_ifc_name"))
        ):
            return adopted
        self._run_ifcopenshell_semantic_sidecar(
            ifc_source_path=ifc_path,
            artifact_dir=output_dir,
        )
        return self._enumerate_usd_stage(
            model_path=model_path,
            ifc_path=ifc_path,
            mapping_path=mapping_path,
            entity_index_path=entity_index_path,
            metadata_path=metadata_path,
        )

    def _adopt_converter_sidecars(
        self,
        *,
        output_dir: Path,
        mapping_path: Path,
        entity_index_path: Path,
        metadata_path: Path,
    ) -> Mapping[str, Any] | None:
        emitted_mapping = output_dir / "element_mapping.json"
        emitted_index = output_dir / "entity_index.json"
        emitted_metadata = output_dir / "metadata.json"
        emitted_quality = output_dir / "quality_metrics.json"
        if not (
            emitted_mapping.is_file()
            and emitted_index.is_file()
            and emitted_metadata.is_file()
            and emitted_quality.is_file()
        ):
            return None
        # Paths already match the required names; just load the converter-owned
        # quality metrics (real gates produced by the converter pipeline).
        try:
            quality = json.loads(emitted_quality.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ConversionAuthorityError(
                "invalid_quality_metrics",
                f"Converter-emitted quality_metrics.json is unreadable: {exc}",
            ) from exc
        if mapping_path != emitted_mapping:  # pragma: no cover - names are fixed
            mapping_path.write_text(
                emitted_mapping.read_text(encoding="utf-8"), encoding="utf-8"
            )
        # streaming-server-enumeration-semantic-mapping:supplement missing
        # semantic fields(non-fabricating)。converter 自己有寫的 keys 不被蓋:
        # 用 `is None`(value 寫成 null)與 `not in`(key 不存在)雙重 guard,
        # 確保 `False` / `""` 之類有意義的 truthy / falsy 值仍視為 converter
        # 已寫,不 supplement。
        if quality.get("semantic_mapping_fidelity") is None or \
                "mapping_has_ifc_type" not in quality or \
                "mapping_has_ifc_name" not in quality:
            try:
                mapping_doc = json.loads(emitted_mapping.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                mapping_doc = None
            if isinstance(mapping_doc, dict):
                items = mapping_doc.get("items")
                if isinstance(items, list):
                    has_type = any(
                        bool(item.get("ifc_type")) for item in items if isinstance(item, dict)
                    )
                    has_name = any(
                        bool(item.get("ifc_name")) for item in items if isinstance(item, dict)
                    )
                    if quality.get("semantic_mapping_fidelity") is None:
                        if has_type and has_name:
                            quality["semantic_mapping_fidelity"] = "ifc_class_grouped_with_name"
                        elif has_type or has_name:
                            quality["semantic_mapping_fidelity"] = "usd_enumeration_with_ifc_custom_data"
                    if "mapping_has_ifc_type" not in quality:
                        quality["mapping_has_ifc_type"] = has_type
                    if "mapping_has_ifc_name" not in quality:
                        quality["mapping_has_ifc_name"] = has_name
        return quality

    def _enumerate_usd_stage(
        self,
        *,
        model_path: Path,
        ifc_path: Path,
        mapping_path: Path,
        entity_index_path: Path,
        metadata_path: Path,
    ) -> Mapping[str, Any]:
        try:  # pragma: no cover - exercised only where Kit/USD runtime exists
            from pxr import Usd, UsdGeom
        except Exception as exc:  # noqa: BLE001
            raise ConversionAuthorityError(
                "converter_unavailable",
                "Converter did not emit sidecars and USD runtime (pxr) is "
                f"unavailable to enumerate {model_path.name}: {exc}",
            ) from exc

        stage = Usd.Stage.Open(str(model_path))
        if stage is None:
            raise ConversionAuthorityError(
                "usdc_not_openable",
                f"Produced USDC could not be opened by USD: {model_path}",
            )

        prims = [p for p in stage.Traverse()]
        imageable = [p for p in prims if UsdGeom.Imageable(p)]
        # streaming-server-enumeration-semantic-mapping:抽 IFC type/name from
        # USD prim CustomData(C1 fallback 與 HOOPS converter 共用 ifcGlobalId
        # / ifcType / ifcName 命名;容忍 `ifc:` prefix 變體)。
        mapping_items: list[dict[str, Any]] = []
        entity_items: list[dict[str, Any]] = []
        for prim_index, prim in enumerate(prims, start=1):
            ifc_guid = self._read_ifc_custom_data(prim, "ifc:guid", "ifcGlobalId", "ifc_guid")
            if not ifc_guid:
                continue
            ifc_type = self._read_ifc_custom_data(prim, "ifc:type", "ifcType", "ifc_type")
            ifc_name = self._read_ifc_custom_data(prim, "ifc:name", "ifcName", "ifc_name")
            entity_id = f"entity_{prim_index:06d}"
            usd_prim_path = str(prim.GetPath())
            mapping_items.append(
                {
                    "ifc_guid": ifc_guid,
                    "usd_prim_path": usd_prim_path,
                    "ifc_type": ifc_type,
                    "ifc_name": ifc_name,
                    "entity_id": entity_id,
                }
            )
            entity_items.append(
                {
                    "ifc_guid": ifc_guid,
                    "ifc_type": ifc_type,
                    "name": ifc_name,
                    "usd_prim_path": usd_prim_path,
                    "entity_id": entity_id,
                }
            )

        # streaming-server-ifcopenshell-semantic-sidecar-pass: 當 prim CustomData
        # 抽不到 IFC 語意(HOOPS happy path 真實情境),改讀 `ifc_semantic_sidecar.json`
        # supplement。對齊策略 v1:enumeration mesh prim 順序 vs sidecar entries
        # 順序 best-effort 1:1。CustomData 已抽到時不 shadow。
        mapping_source = "prim_custom_data" if mapping_items else "none"
        if not mapping_items:
            sidecar_doc = self._load_ifc_semantic_sidecar(mapping_path.parent)
            if isinstance(sidecar_doc, dict):
                mesh_prims = [p for p in prims if UsdGeom.Mesh(p)]
                supplemented = False
                for mesh_index, prim in enumerate(mesh_prims):
                    entry = self._sidecar_entry_for_mesh_index(sidecar_doc, mesh_index)
                    if not isinstance(entry, dict):
                        continue
                    ifc_guid = entry.get("ifc_guid")
                    if not ifc_guid:
                        continue
                    ifc_type = entry.get("ifc_type")
                    ifc_name = entry.get("ifc_name")
                    entity_id = f"entity_{mesh_index + 1:06d}"
                    usd_prim_path = str(prim.GetPath())
                    mapping_items.append(
                        {
                            "ifc_guid": str(ifc_guid),
                            "usd_prim_path": usd_prim_path,
                            "ifc_type": ifc_type,
                            "ifc_name": ifc_name,
                            "entity_id": entity_id,
                        }
                    )
                    entity_items.append(
                        {
                            "ifc_guid": str(ifc_guid),
                            "ifc_type": ifc_type,
                            "name": ifc_name,
                            "usd_prim_path": usd_prim_path,
                            "entity_id": entity_id,
                        }
                    )
                    supplemented = True
                if supplemented:
                    mapping_source = "ifc_semantic_sidecar"

        source_count = len(mapping_items) or len(prims)
        mapped_count = len(mapping_items)

        has_type = any(item.get("ifc_type") for item in mapping_items)
        has_name = any(item.get("ifc_name") for item in mapping_items)
        if mapping_source == "ifc_semantic_sidecar":
            semantic_fidelity: str | None = "usd_enumeration_with_ifc_sidecar_supplement"
            mapping_fidelity: str | None = "sidecar_ordinal"
        elif has_type and has_name:
            semantic_fidelity = "ifc_class_grouped_with_name"
            mapping_fidelity = "usd_custom_data"
        elif has_type or has_name:
            semantic_fidelity = "usd_enumeration_with_ifc_custom_data"
            mapping_fidelity = "usd_custom_data"
        else:
            semantic_fidelity = None
            mapping_fidelity = "unmapped"

        mapping_doc = {
            "mock": False,
            "mapping_fidelity": mapping_fidelity,
            "summary": {
                "mapped_count": mapped_count,
                "fake_mapping_count": 0,
            },
            "items": mapping_items,
        }
        # entity_index 全 prim 仍保留(供 debug / 統計),其中 IFC 對應 entry
        # 含完整語意欄位;裸 mesh prim 仍記在 entities 內但無 IFC 欄位。
        index_doc = {
            "entities": entity_items if entity_items else [
                {"usd_prim_path": str(p.GetPath())} for p in prims
            ],
        }
        metadata_doc = {
            "source": "ifc_ready",
            "source_ifc": ifc_path.name,
            "usd_root_layer": model_path.name,
            "prim_count": len(prims),
            "imageable_prim_count": len(imageable),
        }
        mapping_path.write_text(
            json.dumps(mapping_doc, ensure_ascii=False), encoding="utf-8"
        )
        entity_index_path.write_text(
            json.dumps(index_doc, ensure_ascii=False), encoding="utf-8"
        )
        metadata_path.write_text(
            json.dumps(metadata_doc, ensure_ascii=False), encoding="utf-8"
        )
        return {
            "source_ifc_entity_count": source_count,
            "mapped_count": mapped_count,
            "unmapped_count": max(source_count - mapped_count, 0),
            "coverage_ratio": (mapped_count / source_count) if source_count else 0.0,
            "coverage_status": "pass" if mapped_count == source_count else "warn",
            "materialization_strategy": "usd_stage_enumeration",
            "sidecar_carrier_count": 0,
            "minimum_coverage_baseline_locked": False,
            "mapping_fidelity": mapping_fidelity,
            "semantic_mapping_fidelity": semantic_fidelity,
            "mapping_has_ifc_type": has_type,
            "mapping_has_ifc_name": has_name,
            "hard_quality_gates": {
                "usdc_openable": True,
                "has_renderable_prims": len(imageable) > 0,
                "placeholder_output": False,
            },
        }

    @staticmethod
    def _read_ifc_custom_data(prim: Any, *keys: str) -> str | None:
        """讀 USD prim CustomData,容忍多種 IFC key naming(`ifc:guid` /
        `ifcGlobalId` / `ifc_guid` 等)。回 None when missing / empty。"""
        for key in keys:
            try:
                value = prim.GetCustomDataByKey(key)
            except Exception:  # noqa: BLE001
                continue
            if value in (None, ""):
                continue
            return str(value)
        return None

    def _run_ifcopenshell_semantic_sidecar(
        self,
        *,
        ifc_source_path: Path,
        artifact_dir: Path,
    ) -> Path | None:
        """streaming-server-ifcopenshell-semantic-sidecar-pass.

        Open the IFC source with IfcOpenShell, iterate `IfcProduct`, and write
        `ifc_semantic_sidecar.json` co-located with `model.usdc`. Returns the
        sidecar path on success; returns ``None`` (without raising) when the IFC
        source is missing, ifcopenshell cannot be imported, or parsing fails.
        Never blocks an already-ready HOOPS conversion result.
        """
        ifc_source_path = Path(ifc_source_path)
        if not ifc_source_path.is_file():
            return None
        try:
            import ifcopenshell  # type: ignore[import-not-found]
        except Exception:  # noqa: BLE001
            return None
        if ifcopenshell is None:  # sys.modules["ifcopenshell"] = None case
            return None
        try:
            ifc_file = ifcopenshell.open(str(ifc_source_path))
        except Exception:  # noqa: BLE001
            return None
        entries: list[dict[str, Any]] = []
        try:
            products = ifc_file.by_type("IfcProduct")
        except Exception:  # noqa: BLE001
            # CodeRabbit P0: parse failure SHALL return None without writing
            # an empty sidecar (對齊 helper docstring「never raises」+
            # spec scenario「Missing IFC source or IfcOpenShell unavailable
            # stays honest」)。
            return None
        shape_index = 0
        for product in products:
            # CodeRabbit P2 → P0: 只收 has-Representation 的 IfcProduct(過濾
            # IfcSite / IfcBuilding / IfcBuildingStorey / IfcSpace 等空間 /
            # 容器 product)。HOOPS USD mesh prim 對齊 sidecar entries 走
            # ordinal index,把空間 product 留在 sidecar 會讓 mesh-index ↔
            # sidecar-index 全錯位。
            try:
                representation = getattr(product, "Representation", None)
            except Exception:  # noqa: BLE001
                representation = None
            if representation is None:
                continue
            try:
                guid_raw = getattr(product, "GlobalId", None)
            except Exception:  # noqa: BLE001
                guid_raw = None
            if not guid_raw:
                continue
            try:
                ifc_type_raw = product.is_a() if hasattr(product, "is_a") else None
            except Exception:  # noqa: BLE001
                ifc_type_raw = None
            try:
                name_raw = getattr(product, "Name", None)
            except Exception:  # noqa: BLE001
                name_raw = None
            entries.append(
                {
                    "ifc_guid": str(guid_raw),
                    "ifc_type": str(ifc_type_raw) if ifc_type_raw else None,
                    "ifc_name": str(name_raw) if name_raw else None,
                    "shape_index": shape_index,
                }
            )
            shape_index += 1
        sidecar_doc = {
            "format_version": "1",
            "ifc_source": str(ifc_source_path),
            "entries": entries,
            "summary": {
                "count": len(entries),
                "has_type": any(bool(e.get("ifc_type")) for e in entries),
                "has_name": any(bool(e.get("ifc_name")) for e in entries),
            },
        }
        artifact_dir = Path(artifact_dir)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        sidecar_path = artifact_dir / "ifc_semantic_sidecar.json"
        try:
            sidecar_path.write_text(
                json.dumps(sidecar_doc, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            return None
        return sidecar_path

    @staticmethod
    def _load_ifc_semantic_sidecar(artifact_dir: Path) -> dict[str, Any] | None:
        """Load `ifc_semantic_sidecar.json` from artifact dir; None when absent / invalid."""
        sidecar_path = Path(artifact_dir) / "ifc_semantic_sidecar.json"
        if not sidecar_path.is_file():
            return None
        try:
            doc = json.loads(sidecar_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return doc if isinstance(doc, dict) else None

    @staticmethod
    def _sidecar_entry_for_mesh_index(
        sidecar_doc: Mapping[str, Any], mesh_index: int
    ) -> dict[str, Any] | None:
        """Best-effort ordinal join: mesh prim index ↔ sidecar entry index."""
        entries = sidecar_doc.get("entries") if isinstance(sidecar_doc, dict) else None
        if not isinstance(entries, list):
            return None
        if 0 <= mesh_index < len(entries):
            entry = entries[mesh_index]
            return entry if isinstance(entry, dict) else None
        return None


def _default_powershell_exe() -> str:
    return shutil.which("pwsh") or "powershell.exe"


def adapter_from_env(repo_root: Path, env: Mapping[str, str] | None = None):
    """Build an adapter from STREAMING_CONVERSION_* env vars (None values stay None)."""
    src = dict(os.environ if env is None else env)

    def _path(key: str) -> Path | None:
        value = src.get(key)
        return Path(value) if value else None

    timeout_raw = src.get("STREAMING_CONVERSION_TIMEOUT_SECONDS")
    try:
        timeout = int(timeout_raw) if timeout_raw else 600
    except ValueError:
        timeout = 600
    # STORAGE_ROOT 沙箱基底顯式從環境讀出並傳入 constructor;缺失時由
    # constructor raise converter_unavailable(不得 fallback Path.cwd())。
    storage_root = _path("STORAGE_ROOT")
    return Ifc2UsdcPowershellConverterAdapter(
        repo_root=Path(repo_root),
        powershell_exe=src.get("STREAMING_CONVERSION_POWERSHELL_EXE") or _default_powershell_exe(),
        kit_exe_path=_path("STREAMING_CONVERSION_KIT_EXE"),
        hoops_main_path=_path("STREAMING_CONVERSION_HOOPS_MAIN"),
        config_path=_path("STREAMING_CONVERSION_CONFIG_PATH"),
        timeout_seconds=timeout,
        work_dir=_path("STREAMING_CONVERSION_WORK_DIR"),
        storage_root=storage_root,
    )
