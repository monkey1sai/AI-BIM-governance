# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NvidiaProprietary
#
# NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
# property and proprietary rights in and to this material, related
# documentation and any modifications thereto. Any use, reproduction,
# disclosure or distribution of this material and related documentation
# without an express license agreement from NVIDIA CORPORATION or
# its affiliates is strictly prohibited.

from pxr import UsdGeom, Usd

import carb
import carb.dictionary
import carb.events
import omni.usd
import omni.kit.app
import omni.kit.livestream.messaging as messaging

from carb.eventdispatcher import get_eventdispatcher
from omni.kit.viewport.utility import get_active_viewport_camera_string


class StageManager:
    """This class manages the stage and its related events."""
    def __init__(self):
        # Internal messaging state
        self._is_external_update: bool = False
        self._camera_attrs = {}
        self._subscriptions = []

        # -- register outgoing events/messages
        outgoing = [
            # notify when user selects something in the viewport.
            "stageSelectionChanged",
            # response to request for children of a prim
            "getChildrenResponse",
            # response to request for primitive being pickable.
            "makePrimsPickableResponse",
            # response to the request to reset camera attributes
            "resetStageResponse",
            # responses for BIM review issue highlighting requests
            "highlightPrimsResult",
            "clearHighlightResult",
            "focusPrimResult",
        ]

        for o in outgoing:
            messaging.register_event_type_to_send(o)
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(o),
                o,
            )

        # -- register incoming events/messages
        incoming = {
            # request to get children of a prim
            'getChildrenRequest': self._on_get_children,
            # request to select a prim
            'selectPrimsRequest': self._on_select_prims,
            # request to make primitives pickable
            'makePrimsPickable': self._on_make_pickable,
            # request to make primitives pickable
            'resetStage': self._on_reset_camera,
            # request to highlight BIM issue prims; first implementation uses selection fallback
            'highlightPrimsRequest': self._on_highlight_prims,
            # request to clear highlight selection
            'clearHighlightRequest': self._on_clear_highlight,
            # request to focus/select one prim
            'focusPrimRequest': self._on_focus_prim,
        }

        ed = get_eventdispatcher()
        for event_type, handler in incoming.items():
            omni.kit.app.register_event_alias(
                carb.events.type_from_string(event_type),
                event_type,
            )
            self._subscriptions.append(
                ed.observe_event(
                    observer_name=f"StageManager:{event_type}",
                    event_name=event_type,
                    on_event=handler,
                )
            )

        # -- subscribe to stage events
        usd_context = omni.usd.get_context()
        self._subscriptions.append(
            ed.observe_event(
                observer_name="StageManager:StageOpened",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.ASSETS_LOADED),
                on_event=self._on_stage_event_opened,
            )
        )
        self._subscriptions.append(
            ed.observe_event(
                observer_name="StageManager:SelectionChanged",
                event_name=usd_context.stage_event_name(omni.usd.StageEventType.SELECTION_CHANGED),
                on_event=self._on_stage_event_selection_changed,
            )
        )

    def get_children(self, prim_path, filters=None):
        """
        Collect any children of the given `prim_path`, potentially filtered by `filters`
        """
        stage = omni.usd.get_context().get_stage()
        prim = stage.GetPrimAtPath(prim_path)
        if not prim:
            return []

        filter_types = {
            "USDGeom": UsdGeom.Mesh,
            "mesh": UsdGeom.Mesh,
            "xform": UsdGeom.Xform,
            "scope": UsdGeom.Scope,
        }

        children = []
        for child in prim.GetChildren():
            # If a child doesn't pass any filter, we skip it.
            if filters is not None:
                if isinstance(filters, carb.dictionary.Item):
                    filters = filters.get_dict()
                if not any(child.IsA(filter_types[filt]) for filt in filters if filt in filter_types):
                    continue

            child_name = child.GetName()
            child_path = str(prim.GetPath())
            # Skipping over cameras
            if child_name.startswith('OmniverseKit_'):
                continue
            # Also skipping rendering primitives.
            if prim_path == '/' and child_name == 'Render':
                continue
            child_path = child_path if child_path != '/' else ''
            carb.log_info(f'child_path: {child_path}')
            info = {"name": child_name, "path": f'{child_path}/{child_name}'}

            # We return an empty list here to indicate that children are
            # available, but the current app does not support pagination,
            # so we use this to lazy load the stage tree.
            if child.GetChildren():
                info["children"] = []

            children.append(info)

        return children

    def _on_get_children(self, event: carb.events.IEvent) -> None:
        """
        Handler for the `getChildrenRequest` event
        Collects a filtered collection of a given primitives children.
        """

        carb.log_info(
            "Received message to return list of a prim\'s children"
        )
        children = self.get_children(
            prim_path=event.payload["prim_path"],
            filters=event.payload["filters"]
        )
        payload = {
            "prim_path": event.payload["prim_path"],
            "children": children
        }


        get_eventdispatcher().dispatch_event("getChildrenResponse", payload=payload)

    def _on_select_prims(self, event: carb.events.IEvent) -> None:
        """
        Handler for `selectPrimsRequest` event.

        Selects the given primitives.
        """
        new_selection = []
        if "paths" in event.payload:
            if isinstance(event.payload["paths"], carb.dictionary.Item):
                new_selection = list(event.payload["paths"].get_dict())
            else:
                new_selection = list(event.payload["paths"])
            carb.log_info(f"Received message to select '{new_selection}'")
        # Flagging this as an external event because it
        # was initiated by the client.
        self._is_external_update = True
        sel = omni.usd.get_context().get_selection()
        sel.clear_selected_prim_paths()
        sel.set_selected_prim_paths(new_selection, True)

    def _on_stage_event_opened(self, event):
        stage = omni.usd.get_context().get_stage()
        stage_url = stage.GetRootLayer().identifier if stage else ''

        if stage_url:
            # Clear before using, so that we're sure the data is only
            # from the new stage.
            self._camera_attrs.clear()
            # Capture the active camera's camera data, used to reset
            # the scene to a known good state.
            ctx = omni.usd.get_context()
            if (prim := ctx.get_stage().GetPrimAtPath(get_active_viewport_camera_string())):
                for attr in prim.GetAttributes():
                    self._camera_attrs[attr.GetName()] = attr.Get()

    def _on_stage_event_selection_changed(self, event):
        # If the selection changed came from an external event,
        # we don't need to let the streaming client know because it
        # initiated the change and is already aware.
        if self._is_external_update:
            self._is_external_update = False
        else:
            payload = {"prims": omni.usd.get_context().get_selection().
                        get_selected_prim_paths()}

            get_eventdispatcher().dispatch_event("stageSelectionChanged", payload=payload)
            carb.log_info(f"Selection changed: Path to USD prims currently selected = {omni.usd.get_context().get_selection().get_selected_prim_paths()}")

    def _on_reset_camera(self, event: carb.events.IEvent):
        """
        Handler for `resetStage` event.

        Resets the camera back to values collected when the stage was opened.
        A success message is sent if all attributes are succesfully reset, and error message is set otherwise.
        """
        ctx = omni.usd.get_context()
        stage = ctx.get_stage()
        try:
            # Reset the camera.
            # The camera lives on the session layer, which has a higher
            # opinion than the root stage. So we need to explicitly target
            # the session layer when resetting the camera's attributes.
            camera_prim = ctx.get_stage().GetPrimAtPath(
                get_active_viewport_camera_string()
            )
            edit_context = Usd.EditContext(
                stage, Usd.EditTarget(stage.GetSessionLayer())
            )
            with edit_context:
                for name, value in self._camera_attrs.items():
                    attr = camera_prim.GetAttribute(name)
                    attr.Set(value)
        except Exception as e:
            payload = {"result": "error", "error": str(e)}
        else:
            payload = {"result": "success", "error": ""}

        get_eventdispatcher().dispatch_event("resetStageResponse", payload=payload)

    def _on_make_pickable(self, event: carb.events.IEvent):
        """
        Handler for `makePrimsPickable` event.

        Adds the provided primitives to the set of selectable objects in the viewport.
        Sends 'makePrimsPickableResponse' back to streamer with
        current success status.
        """
        # Add the provided paths to the set of pickable prims.
        ctx = omni.usd.get_context()
        try:
            if "paths" in event.payload:
                if isinstance(event.payload["paths"], carb.dictionary.Item):
                    paths = list(event.payload["paths"].get_dict())
                else:
                    paths = list(event.payload["paths"])

            for path in paths:
                ctx.set_pickable(path, True)
        except Exception as e:
            payload = {"result": "error", "error": str(e)}
        else:
            payload = {"result": "success", "error": ""}

        get_eventdispatcher().dispatch_event("makePrimsPickableResponse", payload=payload)

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

    def _payload_dict(self, value):
        if isinstance(value, carb.dictionary.Item):
            value = value.get_dict()
        return value if isinstance(value, dict) else {}

    def _resolve_selectable_prim_path(self, stage, prim_path):
        if stage is None or not prim_path:
            return None

        prim = stage.GetPrimAtPath(prim_path)
        if prim and prim.IsValid():
            return prim_path

        if prim_path != "/World":
            return None

        default_prim = stage.GetDefaultPrim()
        if default_prim and default_prim.IsValid():
            return str(default_prim.GetPath())

        for child in stage.GetPseudoRoot().GetChildren():
            child_name = child.GetName()
            if child_name == "Render" or child_name.startswith("OmniverseKit_"):
                continue
            if child.IsValid():
                return str(child.GetPath())

        return None

    def _on_highlight_prims(self, event: carb.events.IEvent):
        """
        Handler for `highlightPrimsRequest`.

        First MVP uses USD selection as the visual fallback. It still returns
        explicit missing paths so client/coordinator state remains honest.
        """
        request_payload = self._payload_dict(event.payload)
        request_id = request_payload.get("request_id")
        stage = omni.usd.get_context().get_stage()
        if stage is None:
            payload = {
                "result": "error",
                "applied_mode": "selection",
                "selected_paths": [],
                "missing_paths": [],
                "fallback_paths": [],
                "error": "No stage is open.",
            }
            if request_id:
                payload["request_id"] = request_id
            get_eventdispatcher().dispatch_event("highlightPrimsResult", payload=payload)
            return

        items = self._payload_list(request_payload.get("items"))
        selected_paths = []
        missing_paths = []
        fallback_paths = []
        for raw_item in items:
            item = self._payload_dict(raw_item)
            prim_path = item.get("prim_path") or item.get("usd_prim_path")
            if not prim_path:
                continue
            selected_path = self._resolve_selectable_prim_path(stage, prim_path)
            if selected_path:
                if selected_path not in selected_paths:
                    selected_paths.append(selected_path)
                if selected_path != prim_path:
                    fallback_paths.append({
                        "requested_path": prim_path,
                        "selected_path": selected_path,
                        "reason": "stage_root_fallback",
                    })
            else:
                missing_paths.append(prim_path)

        sel = omni.usd.get_context().get_selection()
        mode = request_payload.get("mode", "replace")
        if mode == "replace":
            sel.clear_selected_prim_paths()
        if selected_paths:
            self._is_external_update = True
            sel.set_selected_prim_paths(selected_paths, True)

        payload = {
            "result": "success",
            "applied_mode": "selection",
            "selected_paths": selected_paths,
            "missing_paths": missing_paths,
            "fallback_paths": fallback_paths,
        }
        if request_id:
            payload["request_id"] = request_id
        get_eventdispatcher().dispatch_event("highlightPrimsResult", payload=payload)

    def _on_clear_highlight(self, event: carb.events.IEvent):
        sel = omni.usd.get_context().get_selection()
        self._is_external_update = True
        sel.clear_selected_prim_paths()
        payload = {"result": "success", "applied_mode": "selection"}
        get_eventdispatcher().dispatch_event("clearHighlightResult", payload=payload)

    def _on_focus_prim(self, event: carb.events.IEvent):
        stage = omni.usd.get_context().get_stage()
        request_payload = self._payload_dict(event.payload)
        request_id = request_payload.get("request_id")
        prim_path = request_payload.get("prim_path") or request_payload.get("usd_prim_path")
        selected_path = self._resolve_selectable_prim_path(stage, prim_path)
        if stage is None or not prim_path or not selected_path:
            payload = {"result": "error", "prim_path": prim_path, "error": "Prim not found."}
        else:
            self._is_external_update = True
            omni.usd.get_context().get_selection().set_selected_prim_paths([selected_path], True)
            payload = {
                "result": "success",
                "prim_path": selected_path,
                "requested_prim_path": prim_path,
                "applied_mode": "selection",
            }
            if selected_path != prim_path:
                payload["fallback_path"] = selected_path
        if request_id:
            payload["request_id"] = request_id
        get_eventdispatcher().dispatch_event("focusPrimResult", payload=payload)

    def on_shutdown(self):
        """This is called every time the extension is deactivated. It is used
        to clean up the extension state."""
        # Reseting the state.
        self._subscriptions.clear()
        self._is_external_update: bool = False
        self._camera_attrs.clear()
