# GENERATED FILE - DO NOT EDIT.
# Kit Command Vocabulary，由 tests/contracts/kit-datachannel-v1.schema.json 的 x-kit-command／x-kit-constant 生成。
# 再生成：cd web-viewer-sample && npm run generate:kit-command-vocabulary
# source-sha256: dd120726a1a9c6be6a2a92c2818312ce87e9f2b4b44e03333c9bea2b1f29781c
"""Kit Command Vocabulary data; see docs/architecture/kit-command-vocabulary-adr.md."""

KIT_COMMANDS = ("openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage", "loadingStateQuery", "getChildrenRequest", "cameraViewRequest", "cameraStateRequest", "flyNavigationRequest")
KIT_MUTATING_COMMANDS = ("openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage", "cameraViewRequest", "flyNavigationRequest")
KIT_READONLY_COMMANDS = ("loadingStateQuery", "getChildrenRequest", "cameraStateRequest")
KIT_STAGE_LOAD_COMMANDS = ("openStageRequest", "loadArtifactGroupRequest")
KIT_HARNESS_ONLY_COMMANDS = ("composeStageRequest",)
KIT_EVENTS = ("clipPlaneResult", "measurementResult", "openedStageResult", "loadArtifactGroupResult", "highlightPrimsResult", "focusPrimResult", "selectPrimsResult", "makePrimsPickableResponse", "resetStageResponse", "cameraFrameResult", "clearHighlightResult", "loadingStateResponse", "getChildrenResponse", "stageSelectionChanged", "updateProgressAmount", "updateProgressActivity", "bindingApplied", "commandRejected", "cameraViewResult", "cameraStateResult", "flyNavigationResult")
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
}

CAMERA_VIEW_PRESETS = ("top", "front", "back", "left", "right", "iso")
CAMERA_VIEW_SCOPES = ("building", "all")
CAMERA_PROJECTIONS = ("perspective", "orthographic")
FLY_SPEED_MINIMUM = 0.01
FLY_SPEED_MAXIMUM = 1000.0
