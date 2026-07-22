# SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: LicenseRef-NvidiaProprietary
#
# NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
# property and proprietary rights in and to this material, related
# documentation and any modifications thereto. Any use, reproduction,
# disclosure or distribution of this material and related documentation
# without an express license agreement from NVIDIA CORPORATION or
# its affiliates is strictly prohibited.

from typing import Optional

from .stage_loading import LoadingManager
from .stage_management import StageManager
from .runtime_authority import RuntimeAuthorityClient
from . import kit_struct_log
import carb
import carb.events
import omni.ext
import omni.kit.app
import omni.kit.livestream.messaging as messaging


# Any class derived from `omni.ext.IExt` in top level module (defined in
# `python.modules` of `extension.toml`) will be instantiated when extension
# gets enabled and `on_startup(ext_id)` will be called. Later when extension
# gets disabled on_shutdown() is called.
class Extension(omni.ext.IExt):
    """This extension manages creating the loading and stage
    messaging managers"""
    def on_startup(self):
        """This is called every time the extension is activated."""
        # cross-service-structured-log-baseline: emit lifecycle start for the
        # Kit subprocess (additive — `carb.log_*` channels stay).
        kit_struct_log.log_kit_startup_lifecycle()

        self._runtime_authority: Optional[RuntimeAuthorityClient] = RuntimeAuthorityClient.from_env()
        messaging.register_event_type_to_send("commandRejected")
        omni.kit.app.register_event_alias(
            carb.events.type_from_string("commandRejected"),
            "commandRejected",
        )

        # Internal messaging state
        self._loading_manager: Optional[LoadingManager] = LoadingManager(self._runtime_authority)
        self._stage_manager: Optional[StageManager] = StageManager(self._runtime_authority)

    def on_shutdown(self):
        """This is called every time the extension is deactivated. It is used to
        clean up the extension state."""
        # Resetting the state.
        if self._loading_manager:
            self._loading_manager.on_shutdown()
            self._loading_manager = None
        if self._stage_manager:
            self._stage_manager.on_shutdown()
            self._stage_manager = None
        self._runtime_authority = None

        # cross-service-structured-log-baseline: emit lifecycle closed.
        kit_struct_log.log_kit_shutdown_lifecycle()
