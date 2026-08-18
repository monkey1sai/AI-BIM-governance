# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NvidiaProprietary
#
# NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
# property and proprietary rights in and to this material, related
# documentation and any modifications thereto. Any use, reproduction,
# disclosure or distribution of this material and related documentation
# without an express license agreement from NVIDIA CORPORATION or
# its affiliates is strictly prohibited.

import asyncio
import hashlib
import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import urlopen

import carb
import carb.events
import carb.tokens
from carb.eventdispatcher import get_eventdispatcher

import omni.client
import omni.kit.app
import omni.kit.livestream.messaging as messaging
import omni.usd
from pxr import Gf, Sdf, Usd, UsdGeom, UsdLux

try:
    from .runtime_authority import (
        DataChannelTraceContext,
        RuntimeAuthorityClient,
        command_rejected_payload,
        correlated_result,
        local_denial,
        payload_dict,
    )
except ImportError:  # pragma: no cover - test modules import this file directly.
    from runtime_authority import (
        DataChannelTraceContext,
        RuntimeAuthorityClient,
        command_rejected_payload,
        correlated_result,
        local_denial,
        payload_dict,
    )


_FALLBACK_LIGHTS_ROOT = "/__BIMFallbackLights"
_HTTP_STAGE_EXTENSIONS = {".usd", ".usda", ".usdc", ".usdz"}
_DEFAULT_HTTP_STAGE_ALLOWED_HOSTS = (
    "127.0.0.1:49101",
    "localhost:49101",
)
_DEFAULT_MAX_HTTP_STAGE_BYTES = 512 * 1024 * 1024
_PUBLIC_STAGE_CONTEXT_FIELDS = (
    "applied_mode",
    "artifact_id",
    "artifact_group_id",
    "load_order",
    "primary_binding",
    "applied_primary",
    "loaded_bindings",
    "failed_bindings",
    "applied_secondary_layers",
    "skipped_secondary_layers",
    "partial_load",
    "missing_paths",
    "fallback_paths",
    "error",
    "binding_revision_id",
    "request_id",
)
_PUBLIC_STAGE_BINDING_FIELDS = (
    "artifact_id",
    "artifact_group_id",
    "role",
    "load_order",
    "url",
    "usdc_url",
    "composition_strategy",
    "error",
)
_PUBLIC_STAGE_BINDING_KEYS = {
    "primary_binding",
    "applied_primary",
}
_PUBLIC_STAGE_BINDING_LIST_KEYS = {
    "loaded_bindings",
    "failed_bindings",
    "applied_secondary_layers",
    "skipped_secondary_layers",
}
_PUBLIC_STAGE_FALLBACK_FIELDS = (
    "requested_path",
    "selected_path",
    "reason",
)


def _stage_has_lights(stage) -> bool:
    for prim in stage.Traverse():
        if (
            prim.IsA(UsdLux.DomeLight)
            or prim.IsA(UsdLux.DistantLight)
            or prim.IsA(UsdLux.RectLight)
            or prim.IsA(UsdLux.SphereLight)
            or prim.IsA(UsdLux.DiskLight)
            or prim.IsA(UsdLux.CylinderLight)
        ):
            return True
    return False


def _ensure_default_lighting(stage) -> None:
    # IFC-derived USDC typically carries no lights. Inject a dome + distant
    # sun into the session layer so the fallback never persists to disk.
    if stage is None or _stage_has_lights(stage):
        return

    session_layer = stage.GetSessionLayer()
    with Usd.EditContext(stage, session_layer):
        UsdGeom.Scope.Define(stage, Sdf.Path(_FALLBACK_LIGHTS_ROOT))

        dome = UsdLux.DomeLight.Define(
            stage, Sdf.Path(f"{_FALLBACK_LIGHTS_ROOT}/Dome")
        )
        dome.CreateIntensityAttr(1500.0)
        dome.CreateColorAttr(Gf.Vec3f(1.0, 1.0, 1.0))

        sun = UsdLux.DistantLight.Define(
            stage, Sdf.Path(f"{_FALLBACK_LIGHTS_ROOT}/Sun")
        )
        sun.CreateIntensityAttr(3000.0)
        sun.CreateAngleAttr(0.53)
        UsdGeom.Xformable(sun.GetPrim()).AddRotateXYZOp().Set(
            Gf.Vec3f(-45.0, 30.0, 0.0)
        )

    carb.log_info(
        f"LoadingManager: added fallback dome+sun lighting under "
        f"{_FALLBACK_LIGHTS_ROOT} (session layer, not persisted)"
    )


def _is_http_stage_url(url: str) -> bool:
    return urlparse(url).scheme.lower() in {"http", "https"}


def _http_stage_allowed_hosts() -> set[str]:
    # strip() 先處理:純空白值("   ")視同未設,走 warn+default,而非靜默產生空 allow-list
    # (對齊 PowerShell 側 IsNullOrWhiteSpace 語意,避免 whitespace-only 繞過告警)。
    raw = os.environ.get("BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS", "").strip()
    if raw:
        values = raw.split(",")
    else:
        carb.log_warn(
            "BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS is not set; using "
            f"localhost-only default allow-list {_DEFAULT_HTTP_STAGE_ALLOWED_HOSTS}. "
            "If the coordinator is not on localhost, set "
            "BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS to the coordinator host:port."
        )
        values = _DEFAULT_HTTP_STAGE_ALLOWED_HOSTS
    return {value.strip().lower() for value in values if value.strip()}


def _http_stage_max_bytes() -> int:
    raw = os.environ.get("BIM_REVIEW_STREAM_MAX_HTTP_STAGE_BYTES", "")
    if raw:
        try:
            value = int(raw)
            if value > 0:
                return value
        except ValueError:
            carb.log_warn(
                f"Invalid BIM_REVIEW_STREAM_MAX_HTTP_STAGE_BYTES='{raw}', "
                f"using default {_DEFAULT_MAX_HTTP_STAGE_BYTES}."
            )
    return _DEFAULT_MAX_HTTP_STAGE_BYTES


def _http_stage_host_key(parsed) -> str:
    host = (parsed.hostname or "").lower()
    if not host:
        return ""
    try:
        port = parsed.port
    except ValueError:
        return ""
    if port is None:
        port = 443 if parsed.scheme.lower() == "https" else 80
    return f"{host}:{port}"


def _ensure_allowed_http_stage_url(parsed, url: str) -> None:
    host_key = _http_stage_host_key(parsed)
    if host_key not in _http_stage_allowed_hosts():
        raise RuntimeError(
            f"HTTP stage URL host is not allowed: '{host_key}' for '{url}'."
        )


@dataclass(frozen=True)
class _AuthorizedStageAttempt:
    event_type: str
    request_id: str
    session_id: str
    trace_id: str
    source_client_id: str
    viewer_lease_token: str = field(repr=False)
    stage_binding_authorization_id: str
    binding_revision_id: str
    requested_stage_url: str
    stage_context_json: str = field(repr=False)

    def stage_context(self) -> dict:
        return json.loads(self.stage_context_json)

    def authority_payload(self) -> dict:
        return {
            "request_id": self.request_id,
            "session_id": self.session_id,
            "trace_id": self.trace_id,
            "source_client_id": self.source_client_id,
            "viewer_lease_token": self.viewer_lease_token,
            "stage_binding_authorization_id": self.stage_binding_authorization_id,
            "binding_revision_id": self.binding_revision_id,
        }


class LoadingManager:
    """Manages the loading of USD stages and sends messages to the client"""
    def __init__(self, runtime_authority=None, trace_context=None):
        self._subscriptions = []  # Holds subscription pointers
        self._runtime_authority = runtime_authority or RuntimeAuthorityClient()
        self._trace_context = trace_context or DataChannelTraceContext()
        self._active_stage_attempt = None
        self._active_terminal_started = False
        self._active_stage_runtime_url = ""
        self._managed_secondary_layer_ids = set()
        self._managed_secondary_layer_owner = None
        self._pending_tasks = set()

        # -- state variables
        # URL of stage load request. Can be used in messaging with client.
        self._requested_stage_url: str = ""
        self._requested_stage_context: dict = {}
        self._stage_is_opening: bool = False

        # URL of loaded stage. Should not be used in messaging with client
        # because it may reveal directory paths in environment where
        # application runs.
        self._opened_stage_url: str = ""
        self._public_opened_stage_url: str = ""
        self._stage_has_opened = False
        self._streaming_manager_is_busy: bool = False

        # States if opened stage is opened from storage as in not a
        # new unsaved stage
        self._persisted_stage: bool = False
        self._is_evaluating_loading_status: bool = False

        # -- register outgoing events/messages
        outgoing = [
            "openedStageResult",  # notify when USD Stage has loaded.
            "loadArtifactGroupResult",  # artifact binding load-order acknowledgement.
            "updateProgressAmount",  # Status bar event denoting progress
            "updateProgressActivity",  # Status bar event denoting activity
            "loadingStateResponse",  # Response to loadingStateQuery
        ]

        for o in outgoing:
            messaging.register_event_type_to_send(o)
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(o),
                o,
            )

        # -- register incoming events/messages
        incoming = {
            'openStageRequest': self._on_open_stage,  # request to open a stage
            'loadArtifactGroupRequest': self._on_load_artifact_group,
            # internal event to capture progress status
            "omni.kit.window.status_bar@progress": self._on_progress,
            # internal event to capture progress activity
            "omni.kit.window.status_bar@activity": self._on_activity,
            "loadingStateQuery": self._on_load_state_query,
        }
        ed = get_eventdispatcher()
        for event_type, handler in incoming.items():
            # Registering event aliases for incoming events that now leverage Events 2.0
            # TODO: Remove this when all clients have migrated to Events 2.0
            # This is a temporary solution to ensure compatibility with existing clients
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(event_type),
                event_type,
            )
            self._subscriptions.append(
                ed.observe_event(
                    observer_name=f"LoadingManager:{event_type}",
                    event_name=event_type,
                    on_event=handler
                )
            )
        usd_context = omni.usd.get_context()
        # -- subscribe to stage events
        self._subscriptions.extend([
            ed.observe_event(
                observer_name="LoadingManager:stage:opening",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.OPENING),
                on_event=self._on_stage_event_opening,
            ),
            ed.observe_event(
                observer_name="LoadingManager:stage:assets_loaded",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.ASSETS_LOADED),
                on_event=self._on_stage_event_assets_loaded,
            ),
        ])

        self._subscriptions.append(
            ed.observe_event(
                observer_name="LoadingManager:stage:streaming_status",
                event_name="omni.streamingstatus:streaming_status",
                on_event=self._on_rxt_streaming_event,
            )
        )

    def _payload_dict(self, value):
        return payload_dict(value)

    def _verify_datachannel_trace(self, event_type, request_payload):
        try:
            trace_id = self._runtime_authority.verify_datachannel_trace(event_type, request_payload)
        except Exception:
            trace_id = None
        # A rejected trace used to drop the command with no record at all, which makes
        # "Kit never received it" and "Kit received it and refused it" indistinguishable
        # from the outside. Record the outcome - never the trace value, it is a carrier.
        if trace_id is None:
            carb.log_warn(f"[runtime-authority] datachannel trace rejected for {event_type}")
        else:
            carb.log_info(f"[runtime-authority] datachannel trace accepted for {event_type}")
        return trace_id

    def _active_output_trace_id(self):
        if self._active_stage_attempt is not None:
            return self._active_stage_attempt.trace_id
        active_stage = self._trace_context.active_stage()
        return active_stage[1] if active_stage is not None else None

    def _payload_list(self, value):
        if value is None:
            return []
        if isinstance(value, carb.dictionary.Item):
            value = value.get_dict()
        if isinstance(value, dict):
            return list(value.values())
        if isinstance(value, (list, tuple)):
            return list(value)
        return []

    def _public_stage_binding(self, value):
        binding = self._payload_dict(value)
        return {
            key: binding[key]
            for key in _PUBLIC_STAGE_BINDING_FIELDS
            if key in binding
        }

    def _public_stage_fallback(self, value):
        if isinstance(value, str):
            return value
        fallback = self._payload_dict(value)
        return {
            key: fallback[key]
            for key in _PUBLIC_STAGE_FALLBACK_FIELDS
            if key in fallback
        }

    def _public_stage_context(self, context):
        public = {}
        for key in _PUBLIC_STAGE_CONTEXT_FIELDS:
            if key not in context:
                continue
            value = context[key]
            if key in _PUBLIC_STAGE_BINDING_KEYS:
                public[key] = None if value is None else self._public_stage_binding(value)
            elif key in _PUBLIC_STAGE_BINDING_LIST_KEYS:
                public[key] = [
                    self._public_stage_binding(item)
                    for item in self._payload_list(value)
                ]
            elif key == "fallback_paths":
                public[key] = [
                    self._public_stage_fallback(item)
                    for item in self._payload_list(value)
                ]
            else:
                public[key] = value
        return public

    def _process_stage_url(self, url):
        if _is_http_stage_url(url):
            return self._download_http_stage(url)

        # Using a single leading `.` to signify that the path is relative to the ${app} token's parent directory
        # Because we've moved the samples out of the app directory, we need to check for that here
        # in the samples extension directory.
        # If that doesn't exist (using older version of the extension), we fall back to old behavior.
        if url.startswith(("./", ".\\")):
            if url.startswith(("./samples", ".\\samples")):
                sample_url = carb.tokens.acquire_tokens_interface().resolve(
                    "${omni.usd_viewer.samples}/" + url[1:].replace("samples", "samples_data")
                )
                if os.path.exists(sample_url):
                    return sample_url
            return carb.tokens.acquire_tokens_interface().resolve(
                "${app}/.." + url[1:]
            )
        return carb.tokens.acquire_tokens_interface().resolve(url)

    def _download_http_stage(self, url: str) -> str:
        parsed = urlparse(url)
        _ensure_allowed_http_stage_url(parsed, url)
        source_path = Path(unquote(parsed.path))
        suffix = source_path.suffix.lower()
        if suffix not in _HTTP_STAGE_EXTENSIONS:
            raise RuntimeError(
                f"Unsupported HTTP stage file extension for '{url}'."
            )

        max_bytes = _http_stage_max_bytes()
        cache_root = Path(
            os.environ.get(
                "BIM_REVIEW_STREAM_STAGE_CACHE",
                Path(tempfile.gettempdir()) / "bim-review-stream" / "stage-cache",
            )
        )
        cache_root.mkdir(parents=True, exist_ok=True)
        cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        cache_path = cache_root / f"{cache_key}{suffix}"
        if cache_path.exists() and cache_path.stat().st_size > 0:
            cached_size = cache_path.stat().st_size
            if cached_size > max_bytes:
                raise RuntimeError(
                    f"Cached HTTP stage exceeds max size: {cached_size} > {max_bytes}."
                )
            carb.log_info("LoadingManager: using an authorized cached HTTP stage.")
            return cache_path.as_posix()

        temp_path = cache_path.with_suffix(f"{suffix}.tmp")
        carb.log_info("LoadingManager: downloading an authorized HTTP stage.")
        try:
            with urlopen(url, timeout=30) as response:
                status = getattr(response, "status", 200)
                if status >= 400:
                    raise RuntimeError(f"HTTP {status}")
                content_length = response.headers.get("Content-Length")
                if content_length:
                    try:
                        expected_size = int(content_length)
                        if expected_size > max_bytes:
                            raise RuntimeError(
                                f"HTTP stage exceeds max size: {expected_size} > {max_bytes}."
                            )
                    except ValueError:
                        carb.log_warn("Authorized HTTP stage returned an invalid Content-Length.")
                bytes_written = 0
                with open(temp_path, "wb") as output:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        bytes_written += len(chunk)
                        if bytes_written > max_bytes:
                            raise RuntimeError(
                                f"HTTP stage exceeds max size: {bytes_written} > {max_bytes}."
                            )
                        output.write(chunk)
            os.replace(temp_path, cache_path)
        except Exception:
            if temp_path.exists():
                temp_path.unlink()
            raise

        carb.log_info("LoadingManager: cached an authorized HTTP stage.")
        return cache_path.as_posix()

    def _resolve_stage_request(self, payload):
        request = self._payload_dict(payload)
        stage_composition = self._payload_dict(request.get("stage_composition"))
        if request.get("url") and not stage_composition:
            return request["url"], {
                "applied_mode": "legacy_single_url",
                "applied_primary": {
                    "url": request["url"],
                    "composition_strategy": "primary_stage",
                },
                "applied_secondary_layers": [],
                "skipped_secondary_layers": [],
                "missing_paths": [],
                "fallback_paths": [],
            }

        if stage_composition:
            raw_primary = stage_composition.get("primary")
            if isinstance(raw_primary, (list, tuple)):
                primary_candidates = [self._payload_dict(item) for item in raw_primary]
            elif raw_primary:
                primary_candidates = [self._payload_dict(raw_primary)]
            else:
                primary_candidates = []

            if len(primary_candidates) != 1:
                return "", {
                    "applied_mode": "stage_composition",
                    "applied_primary": None,
                    "applied_secondary_layers": [],
                    "skipped_secondary_layers": [],
                    "missing_paths": [],
                    "fallback_paths": [],
                    "error": "Expected exactly one stage_composition.primary.",
                }

            primary = primary_candidates[0]
            primary_url = primary.get("url") or primary.get("usdc_url")
            primary_artifact_id = primary.get("artifact_id") or stage_composition.get("primary_artifact_id")
            if not primary_url:
                return "", {
                    "applied_mode": "stage_composition",
                    "applied_primary": None,
                    "applied_secondary_layers": [],
                    "skipped_secondary_layers": [],
                    "missing_paths": [str(primary_artifact_id or "primary")],
                    "fallback_paths": [],
                    "error": "No primary stage_composition.primary URL was provided.",
                }

            secondary_layers = self._payload_list(stage_composition.get("secondary_layers"))
            normalized_secondary = []
            skipped_secondary = []
            for index, raw_layer in enumerate(secondary_layers):
                layer = self._payload_dict(raw_layer)
                layer_url = layer.get("url") or layer.get("usdc_url")
                artifact_id = layer.get("artifact_id") or f"secondary_{index}"
                if not layer_url:
                    skipped_secondary.append({
                        **layer,
                        "artifact_id": artifact_id,
                        "composition_strategy": "session_sublayer",
                        "error": "Missing secondary layer URL.",
                    })
                    continue
                normalized_secondary.append({
                    **layer,
                    "url": layer_url,
                    "artifact_id": artifact_id,
                    "load_order": int(layer.get("load_order") or index),
                })

            normalized_secondary.sort(key=lambda item: item["load_order"])
            primary_binding = {
                **primary,
                "url": primary_url,
                "artifact_id": primary_artifact_id,
                "composition_strategy": "primary_stage",
            }
            return primary_url, {
                "applied_mode": "stage_composition",
                "artifact_id": primary_artifact_id,
                "artifact_group_id": primary.get("artifact_group_id"),
                "load_order": primary.get("load_order", 0),
                "primary_binding": primary_binding,
                "applied_primary": primary_binding,
                "loaded_bindings": [primary_binding],
                "failed_bindings": [],
                "secondary_bindings": normalized_secondary,
                "applied_secondary_layers": [],
                "skipped_secondary_layers": skipped_secondary,
                "partial_load": bool(skipped_secondary),
                "missing_paths": [item["artifact_id"] for item in skipped_secondary],
                "fallback_paths": [],
            }

        bindings = self._payload_list(
            request.get("artifact_bindings")
            or request.get("artifacts")
            or request.get("load_order")
        )
        normalized = []
        missing_paths = []
        for index, raw_binding in enumerate(bindings):
            binding = self._payload_dict(raw_binding)
            url = binding.get("url") or binding.get("usdc_url")
            artifact_id = binding.get("artifact_id") or binding.get("artifact_group_id") or f"binding_{index}"
            if not url:
                missing_paths.append(str(artifact_id))
                continue
            normalized.append({
                "url": url,
                "artifact_id": artifact_id,
                "artifact_group_id": binding.get("artifact_group_id"),
                "load_order": int(binding.get("load_order") or index),
            })

        normalized.sort(key=lambda item: item["load_order"])
        if not normalized:
            return "", {
                "applied_mode": "artifact_bindings",
                "missing_paths": missing_paths,
                "fallback_paths": [],
                "error": "No loadable artifact binding URL was provided.",
            }

        primary = normalized[0]
        applied_mode = "artifact_bindings_single"
        if len(normalized) > 1:
            applied_mode = "artifact_bindings_multi_layer_payload"
        primary_binding = {
            **primary,
            "composition_strategy": "primary_stage",
        }
        return primary["url"], {
            "applied_mode": applied_mode,
            "artifact_id": primary.get("artifact_id"),
            "artifact_group_id": primary.get("artifact_group_id"),
            "load_order": primary.get("load_order"),
            "primary_binding": primary_binding,
            "applied_primary": primary_binding,
            "loaded_bindings": [primary_binding],
            "failed_bindings": [],
            "secondary_bindings": normalized[1:],
            "applied_secondary_layers": [],
            "skipped_secondary_layers": [],
            "partial_load": False,
            "missing_paths": missing_paths,
            "fallback_paths": [],
        }

    def _compose_secondary_artifact_bindings(self, stage, stage_context) -> None:
        secondary_bindings = stage_context.get("secondary_bindings") or []
        if not stage:
            return
        if not secondary_bindings and not self._managed_secondary_layer_ids:
            return

        session_layer = stage.GetSessionLayer()
        if self._managed_secondary_layer_owner is session_layer:
            for identifier in tuple(self._managed_secondary_layer_ids):
                while identifier in session_layer.subLayerPaths:
                    session_layer.subLayerPaths.remove(identifier)
        self._managed_secondary_layer_ids.clear()
        self._managed_secondary_layer_owner = session_layer

        if not secondary_bindings:
            return

        loaded_bindings = list(stage_context.get("loaded_bindings") or [])
        applied_secondary_layers = list(stage_context.get("applied_secondary_layers") or [])
        skipped_secondary_layers = list(stage_context.get("skipped_secondary_layers") or [])
        failed_bindings = []

        for binding in secondary_bindings:
            requested_url = binding.get("url")
            if not requested_url:
                skipped = {
                    **binding,
                    "composition_strategy": "session_sublayer",
                    "error": "Missing secondary binding URL.",
                }
                failed_bindings.append(skipped)
                skipped_secondary_layers.append(skipped)
                continue

            try:
                resolved_url = self._process_stage_url(requested_url)
                layer = Sdf.Layer.FindOrOpen(resolved_url)
                if layer is None:
                    raise RuntimeError("Unable to open secondary layer.")
                if layer.identifier not in session_layer.subLayerPaths:
                    session_layer.subLayerPaths.append(layer.identifier)
                    self._managed_secondary_layer_ids.add(layer.identifier)
                loaded_bindings.append({
                    **binding,
                    "composition_strategy": "session_sublayer",
                })
                applied_secondary_layers.append({
                    **binding,
                    "composition_strategy": "session_sublayer",
                })
                carb.log_info(
                    f"LoadingManager: composed secondary artifact binding "
                    f"{binding.get('artifact_id')} as session sublayer"
                )
            except Exception as exc:
                skipped = {
                    **binding,
                    "composition_strategy": "session_sublayer",
                    "error": "Unable to load secondary layer.",
                }
                failed_bindings.append(skipped)
                skipped_secondary_layers.append(skipped)
                carb.log_warn(
                    f"LoadingManager: failed to compose secondary artifact binding "
                    f"{binding.get('artifact_id')} ({type(exc).__name__})."
                )

        stage_context["loaded_bindings"] = loaded_bindings
        stage_context["failed_bindings"] = failed_bindings
        stage_context["applied_secondary_layers"] = applied_secondary_layers
        stage_context["skipped_secondary_layers"] = skipped_secondary_layers
        stage_context["partial_load"] = bool(failed_bindings or skipped_secondary_layers)

    def _on_load_artifact_group(self, event: carb.events.IEvent) -> None:
        request_payload = self._payload_dict(event.payload)
        if self._verify_datachannel_trace("loadArtifactGroupRequest", request_payload) is None:
            return
        if self._reject_if_stage_attempt_active("loadArtifactGroupRequest", request_payload):
            return
        decision = self._runtime_authority.authorize("loadArtifactGroupRequest", request_payload)
        if not decision.authorized:
            self._dispatch_rejection("loadArtifactGroupRequest", request_payload, decision)
            return

        url, context = self._resolve_stage_request(request_payload)
        binding_revision_id = request_payload.get("binding_revision_id")
        if binding_revision_id:
            context["binding_revision_id"] = binding_revision_id
        context["request_id"] = request_payload.get("request_id")
        if not url:
            confirmation = self._runtime_authority.confirm_stage(request_payload, "failed")
            if not confirmation.authorized:
                self._dispatch_rejection(
                    "loadArtifactGroupRequest",
                    request_payload,
                    confirmation,
                )
                return
            payload = {
                "result": "error",
                "url": "",
                "error": context.get("error", "Missing url."),
                **self._public_stage_context(context),
            }
            get_eventdispatcher().dispatch_event(
                "loadArtifactGroupResult",
                payload=correlated_result(request_payload, payload),
            )
            return

        attempt = self._create_stage_attempt(
            "loadArtifactGroupRequest",
            request_payload,
            url,
            context,
        )
        if attempt is None:
            return
        active_context = self._reserve_stage_attempt(attempt)
        payload = {
            "result": "accepted",
            "url": url,
            **self._public_stage_context(active_context),
        }
        get_eventdispatcher().dispatch_event(
            "loadArtifactGroupResult",
            payload=correlated_result(request_payload, payload),
        )
        self._open_authorized_stage(attempt, active_context)

    def _on_load_state_query(self, event: carb.events.IEvent) -> None:
        request_payload = self._payload_dict(event.payload)
        trace_id = self._verify_datachannel_trace("loadingStateQuery", request_payload)
        if trace_id is None:
            return
        public_url = self._public_opened_stage_url or self._opened_stage_url
        payload = {"loading_state": "idle", "url": public_url, "trace_id": trace_id}
        if self._stage_is_opening:
            payload = {
                "loading_state": "busy",
                "url": self._requested_stage_url,
                "trace_id": trace_id,
            }
        elif self._stage_has_opened:
            payload = {
                "loading_state": "idle",
                "url": self._requested_stage_url,
                "trace_id": trace_id,
            }

        get_eventdispatcher().dispatch_event("loadingStateResponse", payload=payload)


    def _on_open_stage(self, event: carb.events.IEvent) -> None:
        """
        Handler for `openStageRequest` event.

        Starts loading a given URL, will send success if the layer is already
        loaded, and an error on any failure.
        """

        request_payload = self._payload_dict(event.payload)
        if self._verify_datachannel_trace("openStageRequest", request_payload) is None:
            return
        if self._reject_if_stage_attempt_active("openStageRequest", request_payload):
            return
        decision = self._runtime_authority.authorize("openStageRequest", request_payload)
        if not decision.authorized:
            self._dispatch_rejection("openStageRequest", request_payload, decision)
            return

        requested_url, stage_context = self._resolve_stage_request(request_payload)
        binding_revision_id = request_payload.get("binding_revision_id")
        if binding_revision_id:
            stage_context["binding_revision_id"] = binding_revision_id
        stage_context["request_id"] = request_payload.get("request_id")
        if not requested_url:
            carb.log_error("Authorized stage request did not resolve to a loadable URL.")
            confirmation = self._runtime_authority.confirm_stage(request_payload, "failed")
            if not confirmation.authorized:
                self._dispatch_rejection(
                    "openStageRequest",
                    request_payload,
                    confirmation,
                )
                return
            payload = {
                "url": "",
                "result": "error",
                "error": stage_context.get("error", "Missing url."),
                **self._public_stage_context(stage_context),
            }
            get_eventdispatcher().dispatch_event(
                "openedStageResult",
                payload=correlated_result(request_payload, payload),
            )
            return

        attempt = self._create_stage_attempt(
            "openStageRequest",
            request_payload,
            requested_url,
            stage_context,
        )
        if attempt is None:
            return
        active_context = self._reserve_stage_attempt(attempt)
        self._open_authorized_stage(attempt, active_context)

    def _reject_if_stage_attempt_active(self, event_type, request_payload):
        if self._active_stage_attempt is None:
            return False
        decision = local_denial(
            request_payload,
            "session_lifecycle_blocked",
            "stage_load_in_progress",
        )
        self._dispatch_rejection(event_type, request_payload, decision)
        return True

    def _dispatch_rejection(
        self,
        event_type,
        request_payload,
        decision,
        *,
        runtime_state="unchanged",
    ):
        get_eventdispatcher().dispatch_event(
            "commandRejected",
            payload=command_rejected_payload(
                event_type,
                request_payload,
                decision,
                runtime_state=runtime_state,
            ),
        )

    def _create_stage_attempt(self, event_type, request_payload, requested_url, stage_context):
        required = {
            "request_id": request_payload.get("request_id"),
            "session_id": request_payload.get("session_id"),
            "trace_id": request_payload.get("trace_id"),
            "source_client_id": request_payload.get("source_client_id"),
            "viewer_lease_token": request_payload.get("viewer_lease_token")
            or request_payload.get("lease_token"),
            "stage_binding_authorization_id": request_payload.get("stage_binding_authorization_id"),
            "binding_revision_id": request_payload.get("binding_revision_id"),
        }
        if not all(isinstance(value, str) and value for value in required.values()):
            decision = local_denial(
                request_payload,
                "invalid_payload",
                "stage_attempt_context_invalid",
            )
            self._dispatch_rejection(event_type, request_payload, decision)
            return None
        return _AuthorizedStageAttempt(
            event_type=event_type,
            requested_stage_url=requested_url,
            stage_context_json=json.dumps(
                stage_context,
                separators=(",", ":"),
                ensure_ascii=True,
                sort_keys=True,
            ),
            **required,
        )

    def _reserve_stage_attempt(self, attempt):
        stage_context = attempt.stage_context()
        self._active_stage_attempt = attempt
        self._active_terminal_started = False
        self._active_stage_runtime_url = ""
        self._requested_stage_url = attempt.requested_stage_url
        self._requested_stage_context = stage_context
        carb.log_info("Received an authorized stage load request.")
        return stage_context

    def _claim_terminal(self, attempt):
        if self._active_stage_attempt is not attempt or self._active_terminal_started:
            return False
        self._active_terminal_started = True
        return True

    def _finish_runtime_failure(
        self,
        attempt,
        stage_context,
        public_url,
        error,
        *,
        runtime_state=None,
    ):
        if not self._claim_terminal(attempt):
            return
        confirmation = self._runtime_authority.confirm_stage(
            attempt.authority_payload(),
            "failed",
        )
        if not confirmation.authorized:
            self._dispatch_rejection(
                attempt.event_type,
                attempt.authority_payload(),
                confirmation,
                runtime_state=(
                    "changed_unconfirmed"
                    if runtime_state == "changed_failed"
                    else "unchanged"
                ),
            )
            self._reset_state(attempt)
            return
        payload = {
            "url": public_url,
            "result": "error",
            "error": "Stage open failed.",
            **self._public_stage_context(stage_context),
        }
        if runtime_state:
            payload["runtime_state"] = runtime_state
        get_eventdispatcher().dispatch_event(
            "openedStageResult",
            payload=correlated_result(attempt.authority_payload(), payload),
        )
        self._reset_state(attempt)

    def _finish_observed_stage_success(self, attempt, stage_context, public_url):
        if self._active_stage_attempt is not attempt or self._active_terminal_started:
            return
        try:
            self._compose_secondary_artifact_bindings(
                omni.usd.get_context().get_stage(),
                stage_context,
            )
        except Exception as exc:
            carb.log_warn(
                f"Authorized exact stage composition failed ({type(exc).__name__})."
            )
            self._finish_runtime_failure(
                attempt,
                stage_context,
                public_url,
                exc,
                runtime_state="changed_failed",
            )
            return
        if stage_context.get("partial_load"):
            carb.log_warn(
                "Authorized exact stage composition was only partially applied; "
                "the binding remains non-active."
            )
            self._finish_runtime_failure(
                attempt,
                stage_context,
                public_url,
                RuntimeError("Exact stage composition was only partially applied."),
                runtime_state="changed_failed",
            )
            return
        if not self._claim_terminal(attempt):
            return
        decision = self._runtime_authority.confirm_stage(attempt.authority_payload(), "success")
        if decision.authorized:
            if not self._trace_context.bind_active_stage(attempt.session_id, attempt.trace_id):
                self._reset_state(attempt)
                return
            self._public_opened_stage_url = public_url
            payload = {
                "url": public_url,
                "result": "success",
                "error": "",
                **self._public_stage_context(stage_context),
            }
            get_eventdispatcher().dispatch_event(
                "openedStageResult",
                payload=correlated_result(attempt.authority_payload(), payload),
            )
        else:
            self._dispatch_rejection(
                attempt.event_type,
                attempt.authority_payload(),
                decision,
                runtime_state="changed_unconfirmed",
            )
        self._reset_state(attempt)

    def _open_authorized_stage(self, attempt, stage_context):
        # Check to see if we've already loaded the current stage.
        try:
            url = self._process_stage_url(attempt.requested_stage_url)
            self._active_stage_runtime_url = url
            stage = omni.usd.get_context().get_stage()
            current_stage = stage.GetRootLayer().identifier if stage else ""
            already_open = omni.client.utils.equal_urls(url, current_stage)
        except Exception as exc:
            carb.log_warn(
                f"Authorized stage request could not be prepared ({type(exc).__name__})."
            )
            self._finish_runtime_failure(
                attempt,
                stage_context,
                attempt.requested_stage_url or "[obfuscated]",
                exc,
            )
            return

        if already_open:
            carb.log_info("Authorized stage is already open; confirming binding.")
            self._finish_observed_stage_success(
                attempt,
                stage_context,
                attempt.requested_stage_url,
            )
            return

        async def open_stage():
            runtime_changed = False
            try:
                carb.log_info("Opening stage for an authorized request.")
                usd_context = omni.usd.get_context()
                if url:
                    result, error = await usd_context.open_stage_async(
                        url,
                        omni.usd.UsdContextInitialLoadSet.LOAD_ALL,
                    )
                else:
                    result, error = await usd_context.new_stage_async()

                if result is not True:
                    carb.log_warn("Authorized stage request failed to load.")
                    self._finish_runtime_failure(
                        attempt,
                        stage_context,
                        attempt.requested_stage_url or "[obfuscated]",
                        error,
                    )
                    return

                runtime_changed = True

                if self._active_stage_attempt is not attempt:
                    return
                self._stage_is_opening = False
                self._stage_has_opened = True
                self._streaming_manager_is_busy = False

                for _ in range(2):
                    await omni.kit.app.get_app().next_update_async()

                if self._active_stage_attempt is not attempt:
                    return
                _ensure_default_lighting(usd_context.get_stage())

                public_url = attempt.requested_stage_url or "[obfuscated]"
                carb.log_info("Observed authorized stage success; confirming binding.")
                self._finish_observed_stage_success(attempt, stage_context, public_url)
            except Exception as exc:
                carb.log_warn(
                    f"Authorized stage request failed during runtime mutation "
                    f"({type(exc).__name__})."
                )
                self._finish_runtime_failure(
                    attempt,
                    stage_context,
                    attempt.requested_stage_url or "[obfuscated]",
                    exc,
                    runtime_state="changed_failed" if runtime_changed else None,
                )

        self._schedule_background_task(open_stage())

    def _schedule_background_task(self, coroutine):
        task = asyncio.ensure_future(coroutine)
        self._pending_tasks.add(task)
        if hasattr(task, "add_done_callback"):
            task.add_done_callback(self._pending_tasks.discard)
        return task

    def _on_stage_event_opening(self, event) -> None:
        """Manage extension state via the stage event stream.
        When a new stage is open we reload the data model and
        set the state for the UI.

        Args:
            event (carb.events.IEvent): Event type
        """
        self._stage_is_opening = True
        payload: dict = dict(event.payload)
        if 'val' in payload.keys():
            self._opened_stage_url = payload['val']
        else:
            self._opened_stage_url = ''
        self._persisted_stage = True if self._opened_stage_url else False
        return

    def _on_stage_event_assets_loaded(self, event) -> None:
        """Manage extension state via the stage event stream.
        When a new stage is open we reload the data model and
        set the state for the UI.

        Args:
            event (carb.events.IEvent): Event type
        """
        # Check that a stage is opening. Assets can load after stage has opened.
        if not self._stage_is_opening:
            return
        attempt = self._active_stage_attempt
        if attempt is None:
            return
        observed_runtime_url = ""
        try:
            stage = omni.usd.get_context().get_stage()
            observed_runtime_url = stage.GetRootLayer().identifier if stage else ""
            expected_runtime_url = self._active_stage_runtime_url
            matches_attempt = bool(
                expected_runtime_url
                and observed_runtime_url
                and omni.client.utils.equal_urls(expected_runtime_url, observed_runtime_url)
            )
        except Exception:
            matches_attempt = False
        if not matches_attempt:
            # A stale ASSETS_LOADED event from a prior attempt must not advance
            # the current attempt. Keep the opening gate armed for its own event.
            return
        self._stage_is_opening = False
        self._stage_has_opened = True

        # Async call to evaluate opened state for the attempt captured by this
        # callback. A later attempt can never inherit this terminal callback.
        self._schedule_background_task(
            self._evaluate_load_status(attempt, observed_runtime_url)
        )
        return

    def _on_rxt_streaming_event(self, event) -> None:
        """
        Notes streaming manager's busy state

        Args:
            event (carb.events.IEvent): Contains payload sender and type -
            https://docs.omniverse.nvidia.com/kit/docs/kit-manual/105.0/carb.events/carb.events.IEvent.html
        """
        self._streaming_manager_is_busy = event.payload['isBusy']

    async def _evaluate_load_status(self, attempt=None, observed_runtime_url=None):
        """
        If streaming manager is not busy and the stage is loaded from storage,
        notify the client.
        """
        attempt = attempt or self._active_stage_attempt
        if attempt is None or self._active_stage_attempt is not attempt:
            return

        # Only evaluate for stage loaded from storage.
        if not self._persisted_stage:
            return

        if self._is_evaluating_loading_status:
            return
        self._is_evaluating_loading_status = True

        stage_context = self._requested_stage_context
        try:
            # Wait until all dependencies have loaded by streaming manager.
            while self._streaming_manager_is_busy or not self._stage_has_opened:
                if self._active_stage_attempt is not attempt:
                    return
                await omni.kit.app.get_app().next_update_async()

            for _ in range(2):
                await omni.kit.app.get_app().next_update_async()

            if self._active_stage_attempt is not attempt:
                return
            stage = omni.usd.get_context().get_stage()
            current_runtime_url = stage.GetRootLayer().identifier if stage else ""
            expected_runtime_url = self._active_stage_runtime_url
            observed_runtime_url = observed_runtime_url or current_runtime_url
            if (
                not expected_runtime_url
                or not observed_runtime_url
                or not current_runtime_url
                or not omni.client.utils.equal_urls(expected_runtime_url, observed_runtime_url)
                or not omni.client.utils.equal_urls(expected_runtime_url, current_runtime_url)
            ):
                return
            _ensure_default_lighting(stage)

            url = attempt.requested_stage_url or "[obfuscated]"
            carb.log_info("Observed authorized stage load-status success; confirming binding.")
            self._finish_observed_stage_success(attempt, stage_context, url)
        except Exception as exc:
            carb.log_warn(
                f"Authorized stage load-status evaluation failed ({type(exc).__name__})."
            )
            self._finish_runtime_failure(
                attempt,
                stage_context,
                attempt.requested_stage_url or "[obfuscated]",
                exc,
            )
        finally:
            self._is_evaluating_loading_status = False

    def _on_progress(self, event: carb.events.IEvent):
        """
        Handler for `omni.kit.window.status_bar@progress` event.
        This forwards the statusbar progress events to the streaming client.
        """
        # Only notify for stage loaded from storage.
        if not self._persisted_stage:
            return
        trace_id = self._active_output_trace_id()
        if trace_id is None:
            return

        # Send progress message
        carb.log_info('Sending message to client about loading progress.')
        payload = dict(event.payload)
        payload["trace_id"] = trace_id
        get_eventdispatcher().dispatch_event("updateProgressAmount", payload=payload)

    def _on_activity(self, event: carb.events.IEvent):
        """
        Handler for `omni.kit.window.status_bar@activity` event.
        This forwards the statusbar activity events to the streaming client.
        """
        # Only notify for stage loaded from storage.
        if not self._persisted_stage:
            return
        trace_id = self._active_output_trace_id()
        if trace_id is None:
            return

        carb.log_info('Storing message about loading activity.')
        # Send activity message
        carb.log_info('Sending message to client about loading activity.')
        payload = dict(event.payload)
        payload["trace_id"] = trace_id
        get_eventdispatcher().dispatch_event("updateProgressActivity", payload=payload)

    def on_shutdown(self) -> None:
        """
        Clean up subscriptions
        """
        if self._subscriptions:
            self._subscriptions.clear()
        for task in list(self._pending_tasks):
            if hasattr(task, "done") and hasattr(task, "cancel") and not task.done():
                task.cancel()
        self._pending_tasks.clear()
        self._active_stage_attempt = None
        self._active_terminal_started = False
        self._active_stage_runtime_url = ""

    def _reset_state(self, attempt=None):
        """
        Reset the internal state - ready for new stage to be loaded
        """
        if attempt is not None and self._active_stage_attempt is not attempt:
            return
        try:
            stage = omni.usd.get_context().get_stage()
            opened_stage_url = stage.GetRootLayer().identifier if stage else ""
        except Exception:
            opened_stage_url = ""
        self._requested_stage_url = ""
        self._requested_stage_context = {}
        self._opened_stage_url = opened_stage_url
        self._stage_has_opened = False
        self._streaming_manager_is_busy = False
        self._persisted_stage = False
        self._active_stage_attempt = None
        self._active_terminal_started = False
        self._active_stage_runtime_url = ""
