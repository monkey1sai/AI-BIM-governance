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
import os
import tempfile
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


_FALLBACK_LIGHTS_ROOT = "/__BIMFallbackLights"
_HTTP_STAGE_EXTENSIONS = {".usd", ".usda", ".usdc", ".usdz"}
_DEFAULT_HTTP_STAGE_ALLOWED_HOSTS = ("127.0.0.1:8005", "localhost:8005")
_DEFAULT_MAX_HTTP_STAGE_BYTES = 512 * 1024 * 1024


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
    raw = os.environ.get("BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS", "")
    values = raw.split(",") if raw else _DEFAULT_HTTP_STAGE_ALLOWED_HOSTS
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


class LoadingManager:
    """Manages the loading of USD stages and sends messages to the client"""
    def __init__(self):
        self._subscriptions = []  # Holds subscription pointers

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
        if isinstance(value, carb.dictionary.Item):
            value = value.get_dict()
        return value if isinstance(value, dict) else {}

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

    def _public_stage_context(self, context):
        return {
            key: value
            for key, value in context.items()
            if key not in {"secondary_bindings"}
        }

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
            carb.log_info(
                f"LoadingManager: using cached HTTP stage for '{url}': {cache_path}"
            )
            return cache_path.as_posix()

        temp_path = cache_path.with_suffix(f"{suffix}.tmp")
        carb.log_info(f"LoadingManager: downloading HTTP stage '{url}' to '{cache_path}'")
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
                        carb.log_warn(
                            f"Invalid HTTP stage Content-Length '{content_length}' for '{url}'."
                        )
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

        carb.log_info(
            f"LoadingManager: cached HTTP stage '{url}' as '{cache_path}'"
        )
        return cache_path.as_posix()

    def _resolve_stage_request(self, payload):
        request = self._payload_dict(payload)
        if request.get("url"):
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

        stage_composition = self._payload_dict(request.get("stage_composition"))
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

    def _compose_secondary_artifact_bindings(self, stage) -> None:
        secondary_bindings = self._requested_stage_context.get("secondary_bindings") or []
        if not stage or not secondary_bindings:
            return

        session_layer = stage.GetSessionLayer()
        loaded_bindings = list(self._requested_stage_context.get("loaded_bindings") or [])
        applied_secondary_layers = list(self._requested_stage_context.get("applied_secondary_layers") or [])
        skipped_secondary_layers = list(self._requested_stage_context.get("skipped_secondary_layers") or [])
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
                    "error": str(exc),
                }
                failed_bindings.append(skipped)
                skipped_secondary_layers.append(skipped)
                carb.log_warn(
                    f"LoadingManager: failed to compose secondary artifact binding "
                    f"{binding.get('artifact_id')}: {exc}"
                )

        self._requested_stage_context["loaded_bindings"] = loaded_bindings
        self._requested_stage_context["failed_bindings"] = failed_bindings
        self._requested_stage_context["applied_secondary_layers"] = applied_secondary_layers
        self._requested_stage_context["skipped_secondary_layers"] = skipped_secondary_layers
        self._requested_stage_context["partial_load"] = bool(failed_bindings or skipped_secondary_layers)

    def _on_load_artifact_group(self, event: carb.events.IEvent) -> None:
        url, context = self._resolve_stage_request(event.payload)
        payload = {
            "result": "accepted" if url else "error",
            "url": url,
            **self._public_stage_context(context),
        }
        get_eventdispatcher().dispatch_event("loadArtifactGroupResult", payload=payload)
        if url:
            request = self._payload_dict(event.payload)
            request["url"] = url
            self._on_open_stage(type("Event", (), {"payload": request})())

    def _on_load_state_query(self, event: carb.events.IEvent) -> None:
        public_url = self._public_opened_stage_url or self._opened_stage_url
        payload = {"loading_state": "idle", "url": public_url}
        if self._stage_is_opening:
            payload = { "loading_state": "busy", "url": self._requested_stage_url }
        elif self._stage_has_opened:
            payload = { "loading_state": "idle", "url": self._requested_stage_url }

        get_eventdispatcher().dispatch_event("loadingStateResponse", payload=payload)


    def _on_open_stage(self, event: carb.events.IEvent) -> None:
        """
        Handler for `openStageRequest` event.

        Starts loading a given URL, will send success if the layer is already
        loaded, and an error on any failure.
        """

        requested_url, stage_context = self._resolve_stage_request(event.payload)
        if not requested_url:
            carb.log_error(
                f"Unexpected message payload: missing loadable \"url\" key. Payload: '{event.payload}'")
            payload = {
                "url": "",
                "result": "error",
                "error": stage_context.get("error", "Missing url."),
                **self._public_stage_context(stage_context),
            }
            get_eventdispatcher().dispatch_event("openedStageResult", payload=payload)
            return

        self._requested_stage_url = requested_url
        self._requested_stage_context = stage_context
        carb.log_info(
            f"Received message to load '{self._requested_stage_url}'"
        )

        # Check to see if we've already loaded the current stage.
        url = self._process_stage_url(self._requested_stage_url)

        stage = omni.usd.get_context().get_stage()
        current_stage = stage.GetRootLayer().identifier if stage else ''

        # If we are, we don't need to reload the file, instead we'll just send the success message.
        if omni.client.utils.equal_urls(url, current_stage):
            carb.log_info(f'Client requested to open a stage that is already open: {url}')
            self._public_opened_stage_url = self._requested_stage_url
            payload = {
                "url": self._requested_stage_url,
                "result": "success",
                "error": '',
                **self._public_stage_context(self._requested_stage_context),
            }
            get_eventdispatcher().dispatch_event("openedStageResult", payload=payload)
            self._reset_state()
            return

        # Asynchronously load the incoming stage
        async def open_stage():
            carb.log_info(f'Opening stage per client request: {url}')
            usd_context = omni.usd.get_context()
            if url:
                result, error = await usd_context.open_stage_async(url, omni.usd.UsdContextInitialLoadSet.LOAD_ALL)
            else:
                result, error = await usd_context.new_stage_async()

            if result is not True:
                # Send message to client that loading failed.
                carb.log_warn(f'The file that the client requested failed to load: {url} (error: {error})')
                payload = {
                    "url": url,
                    "result": "error",
                    "error": error,
                    **self._public_stage_context(self._requested_stage_context),
                }
                get_eventdispatcher().dispatch_event("openedStageResult", payload=payload)
                self._reset_state()
                return

            self._compose_secondary_artifact_bindings(usd_context.get_stage())

        asyncio.ensure_future(open_stage())

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
        self._stage_is_opening = False
        self._stage_has_opened = True

        # Async call to evaluate opened state
        asyncio.ensure_future(self._evaluate_load_status())
        return

    def _on_rxt_streaming_event(self, event) -> None:
        """
        Notes streaming manager's busy state

        Args:
            event (carb.events.IEvent): Contains payload sender and type -
            https://docs.omniverse.nvidia.com/kit/docs/kit-manual/105.0/carb.events/carb.events.IEvent.html
        """
        self._streaming_manager_is_busy = event.payload['isBusy']

    async def _evaluate_load_status(self):
        """
        If streaming manager is not busy and the stage is loaded from storage,
        notify the client.
        """
        # Only evaluate for stage loaded from storage.
        if not self._persisted_stage:
            return

        if self._is_evaluating_loading_status:
            return
        self._is_evaluating_loading_status = True

        # Wait until all dependencies have loaded by streaming manager
        while self._streaming_manager_is_busy or not self._stage_has_opened:
            await omni.kit.app.get_app().next_update_async()

        for _ in range(2):
            await omni.kit.app.get_app().next_update_async()

        _ensure_default_lighting(omni.usd.get_context().get_stage())

        # Stage has loaded with all dependencies. Send message to client.
        url = self._requested_stage_url if self._requested_stage_url  else '[obfuscated]'
        self._public_opened_stage_url = url
        carb.log_info(
            f'Sending message to client that stage has loaded: {url}'
        )
        payload = {
            "url": url,
            "result": "success",
            "error": '',
            **self._public_stage_context(self._requested_stage_context),
        }
        get_eventdispatcher().dispatch_event("openedStageResult", payload=payload)

        # reset
        self._is_evaluating_loading_status = False
        self._reset_state()

    def _on_progress(self, event: carb.events.IEvent):
        """
        Handler for `omni.kit.window.status_bar@progress` event.
        This forwards the statusbar progress events to the streaming client.
        """
        # Only notify for stage loaded from storage.
        if not self._persisted_stage:
            return

        # Send progress message
        carb.log_info('Sending message to client about loading progress.')
        get_eventdispatcher().dispatch_event("updateProgressAmount", payload=dict(event.payload))

    def _on_activity(self, event: carb.events.IEvent):
        """
        Handler for `omni.kit.window.status_bar@activity` event.
        This forwards the statusbar activity events to the streaming client.
        """
        # Only notify for stage loaded from storage.
        if not self._persisted_stage:
            return

        carb.log_info('Storing message about loading activity.')
        # Send activity message
        carb.log_info('Sending message to client about loading activity.')
        get_eventdispatcher().dispatch_event("updateProgressActivity", payload=dict(event.payload))

    def on_shutdown(self) -> None:
        """
        Clean up subscriptions
        """
        if self._subscriptions:
            self._subscriptions.clear()

    def _reset_state(self):
        """
        Reset the internal state - ready for new stage to be loaded
        """
        stage = omni.usd.get_context().get_stage()
        self._requested_stage_url = ""
        self._requested_stage_context = {}
        self._opened_stage_url = stage.GetRootLayer().identifier if stage else ""
        self._stage_has_opened = False
        self._streaming_manager_is_busy = False
        self._persisted_stage = False
