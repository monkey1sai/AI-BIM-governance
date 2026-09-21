// GENERATED FILE - DO NOT EDIT.
// Kit Command Vocabulary，由 tests/contracts/kit-datachannel-v1.schema.json 的 x-kit-command／x-kit-constant 生成。
// 再生成：cd web-viewer-sample && npm run generate:kit-command-vocabulary
// source-sha256: 2a712a1abdcee562a261eeecac986a46e3a580209b68074c31efd344d5099b97

export const KIT_COMMANDS = ["openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage", "loadingStateQuery", "getChildrenRequest", "cameraViewRequest", "cameraStateRequest", "flyNavigationRequest", "overlayStyleRequest"] as const;
export const KIT_MUTATING_COMMANDS = ["openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "clipPlaneRequest", "measurementRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage", "cameraViewRequest", "flyNavigationRequest", "overlayStyleRequest"] as const;
export const KIT_READONLY_COMMANDS = ["loadingStateQuery", "getChildrenRequest", "cameraStateRequest"] as const;
export const KIT_STAGE_LOAD_COMMANDS = ["openStageRequest", "loadArtifactGroupRequest"] as const;
export const KIT_HARNESS_ONLY_COMMANDS = ["composeStageRequest"] as const;
export const KIT_EVENTS = ["clipPlaneResult", "measurementResult", "openedStageResult", "loadArtifactGroupResult", "highlightPrimsResult", "focusPrimResult", "selectPrimsResult", "makePrimsPickableResponse", "resetStageResponse", "cameraFrameResult", "clearHighlightResult", "loadingStateResponse", "getChildrenResponse", "stageSelectionChanged", "updateProgressAmount", "updateProgressActivity", "bindingApplied", "commandRejected", "cameraViewResult", "cameraStateResult", "flyNavigationResult", "overlayStyleResult"] as const;
export const KIT_COMMAND_REJECTION_REASONS = ["spectator_readonly", "lease_invalid", "session_lifecycle_blocked", "unauthorized_source_client", "unsupported_command", "invalid_payload"] as const;
export type KitCommand = (typeof KIT_COMMANDS)[number];
export type KitEvent = (typeof KIT_EVENTS)[number];

export const KIT_COMMAND_RESULTS: { readonly [C in KitCommand]: readonly KitEvent[] } = {
  openStageRequest: ["openedStageResult"] as const,
  loadArtifactGroupRequest: ["openedStageResult", "loadArtifactGroupResult", "bindingApplied"] as const,
  composeStageRequest: ["loadArtifactGroupResult", "bindingApplied"] as const,
  highlightPrimsRequest: ["highlightPrimsResult"] as const,
  focusPrimRequest: ["focusPrimResult"] as const,
  clearHighlightRequest: ["clearHighlightResult"] as const,
  clipPlaneRequest: ["clipPlaneResult"] as const,
  measurementRequest: ["measurementResult"] as const,
  selectPrimsRequest: ["selectPrimsResult"] as const,
  makePrimsPickable: ["makePrimsPickableResponse"] as const,
  resetStage: ["resetStageResponse", "cameraFrameResult"] as const,
  loadingStateQuery: ["loadingStateResponse"] as const,
  getChildrenRequest: ["getChildrenResponse"] as const,
  cameraViewRequest: ["cameraViewResult"] as const,
  cameraStateRequest: ["cameraStateResult"] as const,
  flyNavigationRequest: ["flyNavigationResult"] as const,
  overlayStyleRequest: ["overlayStyleResult"] as const,
};

export const CAMERA_VIEW_PRESETS = ["top", "front", "back", "left", "right", "iso"] as const;
export const CAMERA_VIEW_SCOPES = ["building", "all"] as const;
export const CAMERA_PROJECTIONS = ["perspective", "orthographic"] as const;
export const FLY_SPEED = { minimum: 0.01, maximum: 1000 } as const;
export const OVERLAY_DISPLAY_OPACITY = { minimum: 0, maximum: 1 } as const;
