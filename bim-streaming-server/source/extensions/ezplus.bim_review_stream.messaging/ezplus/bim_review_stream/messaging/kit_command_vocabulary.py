# GENERATED FILE - DO NOT EDIT.
# Kit Command Vocabulary，由 tests/contracts/kit-datachannel-v1.schema.json 的 x-kit-command／x-kit-constant 生成。
# 再生成：cd web-viewer-sample && npm run generate:kit-command-vocabulary
# source-sha256: d7b0404c1a2cbb2431a458e47920405e00b89fbddd380b9f3765a627b32c7ae4
"""Kit Command Vocabulary data; see docs/architecture/kit-command-vocabulary-adr.md."""

KIT_COMMANDS = ("openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage", "loadingStateQuery", "getChildrenRequest", "cameraViewRequest", "cameraStateRequest", "flyNavigationRequest", "overlayStyleRequest", "overlayVisibilityRequest", "overlayPlaybackRequest")
KIT_MUTATING_COMMANDS = ("openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage", "cameraViewRequest", "flyNavigationRequest", "overlayStyleRequest", "overlayVisibilityRequest", "overlayPlaybackRequest")
KIT_READONLY_COMMANDS = ("loadingStateQuery", "getChildrenRequest", "cameraStateRequest")
KIT_STAGE_LOAD_COMMANDS = ("openStageRequest", "loadArtifactGroupRequest")
KIT_HARNESS_ONLY_COMMANDS = ("composeStageRequest",)
KIT_EVENTS = ("clipPlaneResult", "measurementResult", "openedStageResult", "loadArtifactGroupResult", "highlightPrimsResult", "focusPrimResult", "selectPrimsResult", "makePrimsPickableResponse", "resetStageResponse", "cameraFrameResult", "clearHighlightResult", "loadingStateResponse", "getChildrenResponse", "stageSelectionChanged", "updateProgressAmount", "updateProgressActivity", "bindingApplied", "commandRejected", "cameraViewResult", "cameraStateResult", "flyNavigationResult", "overlayStyleResult", "overlayVisibilityResult", "overlayPlaybackResult")
KIT_COMMAND_REJECTION_REASONS = ("spectator_readonly", "lease_invalid", "session_lifecycle_blocked", "unauthorized_source_client", "unsupported_command", "invalid_payload")

KIT_COMMAND_RESULTS = {
    "openStageRequest": ("openedStageResult",),
    "loadArtifactGroupRequest": ("openedStageResult", "loadArtifactGroupResult", "bindingApplied"),
    "composeStageRequest": ("loadArtifactGroupResult", "bindingApplied"),
    "highlightPrimsRequest": ("highlightPrimsResult",),
    "focusPrimRequest": ("focusPrimResult",),
    "clearHighlightRequest": ("clearHighlightResult",),
    "clipPlaneRequest": ("clipPlaneResult",),
    "measurementRequest": ("measurementResult",),
    "selectPrimsRequest": ("selectPrimsResult",),
    "makePrimsPickable": ("makePrimsPickableResponse",),
    "resetStage": ("resetStageResponse", "cameraFrameResult"),
    "loadingStateQuery": ("loadingStateResponse",),
    "getChildrenRequest": ("getChildrenResponse",),
    "cameraViewRequest": ("cameraViewResult",),
    "cameraStateRequest": ("cameraStateResult",),
    "flyNavigationRequest": ("flyNavigationResult",),
    "overlayStyleRequest": ("overlayStyleResult",),
    "overlayVisibilityRequest": ("overlayVisibilityResult",),
    "overlayPlaybackRequest": ("overlayPlaybackResult",),
}

KIT_COMMAND_CONTEXT_FIELDS = {
    "openStageRequest": (),
    "loadArtifactGroupRequest": (),
    "highlightPrimsRequest": ("mode", "items", "focus_first"),
    "focusPrimRequest": ("prim_path", "emphasis"),
    "clearHighlightRequest": (),
    "clipPlaneRequest": ("enabled", "axis", "position", "normal"),
    "measurementRequest": ("action", "measurement_id", "uv"),
    "selectPrimsRequest": ("paths",),
    "makePrimsPickable": ("paths",),
    "resetStage": ("scope",),
    "cameraViewRequest": ("action", "view", "scope", "projection"),
    "flyNavigationRequest": ("speed",),
    "overlayStyleRequest": ("prim_path", "display_opacity"),
    "overlayVisibilityRequest": ("items",),
    "overlayPlaybackRequest": ("action", "rate"),
}

CAMERA_VIEW_PRESETS = ("top", "front", "back", "left", "right", "iso")
CAMERA_VIEW_SCOPES = ("building", "all")
CAMERA_PROJECTIONS = ("perspective", "orthographic")
FLY_SPEED_MINIMUM = 0.01
FLY_SPEED_MAXIMUM = 1000.0
OVERLAY_PLAYBACK_ACTIONS = ("play", "pause", "restart", "set_rate")
OVERLAY_PLAYBACK_RATE_MINIMUM = 0.25
OVERLAY_PLAYBACK_RATE_MAXIMUM = 4.0
OVERLAY_DISPLAY_OPACITY_MINIMUM = 0.0
OVERLAY_DISPLAY_OPACITY_MAXIMUM = 1.0
