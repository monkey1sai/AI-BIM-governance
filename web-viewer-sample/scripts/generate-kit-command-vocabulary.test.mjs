import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_RELATIVE_PATH, buildVocabulary, lf, renderAll } from "./generate-kit-command-vocabulary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const loadSchema = () => JSON.parse(readFileSync(path.join(repoRoot, SCHEMA_RELATIVE_PATH), "utf8"));
const names = (vocabulary, predicate) => vocabulary.commands.filter(predicate).map((command) => command.name).sort();

describe("Kit Command Vocabulary generator", () => {
  // 舊的手寫清單就是 oracle：重構前後產出的值必須一模一樣。
  it("reproduces the hand-maintained vocabulary it replaces", () => {
    const vocabulary = buildVocabulary(loadSchema());
    expect(names(vocabulary, (command) => command.mutates)).toEqual([
      "cameraViewRequest", "clearHighlightRequest", "clipPlaneRequest", "composeStageRequest",
      "flyNavigationRequest", "focusPrimRequest", "highlightPrimsRequest", "loadArtifactGroupRequest",
      "makePrimsPickable", "measurementRequest", "openStageRequest", "overlayStyleRequest", "resetStage", "selectPrimsRequest",
    ]);
    expect(names(vocabulary, (command) => !command.mutates)).toEqual([
      "cameraStateRequest", "getChildrenRequest", "loadingStateQuery",
    ]);
    expect(names(vocabulary, (command) => command.stageLoad)).toEqual(["loadArtifactGroupRequest", "openStageRequest"]);
    expect(names(vocabulary, (command) => command.harnessOnly)).toEqual(["composeStageRequest"]);
    expect([...vocabulary.kitEvents].sort()).toEqual([
      "bindingApplied", "cameraFrameResult", "cameraStateResult", "cameraViewResult", "clearHighlightResult",
      "clipPlaneResult", "commandRejected", "flyNavigationResult", "focusPrimResult", "getChildrenResponse",
      "highlightPrimsResult", "loadArtifactGroupResult", "loadingStateResponse", "makePrimsPickableResponse",
      "measurementResult", "openedStageResult", "overlayStyleResult", "resetStageResponse", "selectPrimsResult",
      "stageSelectionChanged", "updateProgressActivity", "updateProgressAmount",
    ]);
    const mutatorPairs = vocabulary.commands
      .filter((command) => command.mutates)
      .flatMap((command) => command.results.map((result) => `${result}<-${command.name}`))
      .sort();
    expect(mutatorPairs).toEqual([
      "bindingApplied<-composeStageRequest", "bindingApplied<-loadArtifactGroupRequest",
      "cameraFrameResult<-resetStage", "cameraViewResult<-cameraViewRequest",
      "clearHighlightResult<-clearHighlightRequest", "clipPlaneResult<-clipPlaneRequest",
      "flyNavigationResult<-flyNavigationRequest", "focusPrimResult<-focusPrimRequest",
      "highlightPrimsResult<-highlightPrimsRequest", "loadArtifactGroupResult<-composeStageRequest",
      "loadArtifactGroupResult<-loadArtifactGroupRequest", "makePrimsPickableResponse<-makePrimsPickable",
      "measurementResult<-measurementRequest", "openedStageResult<-loadArtifactGroupRequest",
      "openedStageResult<-openStageRequest", "overlayStyleResult<-overlayStyleRequest", "resetStageResponse<-resetStage",
      "selectPrimsResult<-selectPrimsRequest",
    ]);
    expect(vocabulary.rejectionReasons).toEqual([
      "spectator_readonly", "lease_invalid", "session_lifecycle_blocked",
      "unauthorized_source_client", "unsupported_command", "invalid_payload",
    ]);
    expect(vocabulary.constants).toEqual([
      { name: "CAMERA_VIEW_PRESETS", kind: "enum", values: ["top", "front", "back", "left", "right", "iso"] },
      { name: "CAMERA_VIEW_SCOPES", kind: "enum", values: ["building", "all"] },
      { name: "CAMERA_PROJECTIONS", kind: "enum", values: ["perspective", "orthographic"] },
      { name: "FLY_SPEED", kind: "range", minimum: 0.01, maximum: 1000 },
      { name: "OVERLAY_DISPLAY_OPACITY", kind: "range", minimum: 0, maximum: 1 },
    ]);
  });

  // Kit's hand-written runtime_authority._command_context is the oracle for the context lists.
  it("reproduces the command context fields Kit forwarded by hand", () => {
    const vocabulary = buildVocabulary(loadSchema());
    const context = Object.fromEntries(vocabulary.commands.filter((command) => command.context).map((command) => [command.name, command.context]));
    expect(context).toEqual({
      measurementRequest: ["action", "measurement_id", "uv"],
      clipPlaneRequest: ["enabled", "axis", "position", "normal"],
      openStageRequest: [],
      loadArtifactGroupRequest: [],
      highlightPrimsRequest: ["mode", "items", "focus_first"],
      focusPrimRequest: ["prim_path", "emphasis"],
      clearHighlightRequest: [],
      selectPrimsRequest: ["paths"],
      makePrimsPickable: ["paths"],
      resetStage: ["scope"],
      cameraViewRequest: ["action", "view", "scope", "projection"],
      flyNavigationRequest: ["speed"],
      overlayStyleRequest: ["prim_path", "display_opacity"],
    });
  });

  it("refuses a context field the payload does not declare, a duplicate field, and context on a read-only command", () => {
    const withContext = (name, context) => {
      const schema = loadSchema();
      schema.$defs[name]["x-kit-command"].context = context;
      return () => buildVocabulary(schema);
    };
    expect(withContext("focusPrimRequest", ["prim_path", "request_id"])).toThrow("context field request_id is not a payload property");
    expect(withContext("focusPrimRequest", ["prim_path", "prim_path"])).toThrow("x-kit-command.context has duplicates");
    expect(withContext("cameraStateRequest", [])).toThrow("x-kit-command.context requires mutates: true");
    expect(withContext("focusPrimRequest", "prim_path")).toThrow("x-kit-command.context must be an array of payload property names");
  });

  it("records the results of read-only commands too", () => {
    const results = Object.fromEntries(buildVocabulary(loadSchema()).commands.map((command) => [command.name, command.results]));
    expect(results.cameraStateRequest).toEqual(["cameraStateResult"]);
    expect(results.loadingStateQuery).toEqual(["loadingStateResponse"]);
    expect(results.getChildrenRequest).toEqual(["getChildrenResponse"]);
  });

  it("refuses a schema whose commandRejected does not name every command", () => {
    const schema = loadSchema();
    const rejected = schema.$defs.commandRejected.properties.payload.properties.rejected_event_type;
    rejected.enum = rejected.enum.filter((name) => name !== "cameraStateRequest");
    expect(() => buildVocabulary(schema)).toThrow(/missing: cameraStateRequest/);
  });

  it("refuses an annotated command that is not listed in oneOf", () => {
    const schema = loadSchema();
    schema.oneOf = schema.oneOf.filter((entry) => entry.$ref !== "#/$defs/cameraStateRequest");
    expect(() => buildVocabulary(schema)).toThrow(/cameraStateRequest has x-kit-command but is not listed in oneOf/);
  });

  it("refuses a result that is not a Kit to viewer event", () => {
    const schema = loadSchema();
    schema.$defs.cameraViewRequest["x-kit-command"].results = ["cameraStateRequest"];
    expect(() => buildVocabulary(schema)).toThrow(/result cameraStateRequest is not a Kit→viewer event/);
  });

  it("refuses a duplicate constant name", () => {
    const schema = loadSchema();
    schema.$defs.cameraViewRequest.properties.payload.properties.action["x-kit-constant"] = "FLY_SPEED";
    expect(() => buildVocabulary(schema)).toThrow(/duplicate x-kit-constant FLY_SPEED/);
  });

  it("refuses a constant name that collides with a generated list name", () => {
    const schema = loadSchema();
    schema.$defs.cameraViewRequest.properties.payload.properties.action["x-kit-constant"] = "KIT_EVENTS";
    expect(() => buildVocabulary(schema)).toThrow(/x-kit-constant KIT_EVENTS collides with generated name KIT_EVENTS/);
  });

  it("refuses a constant name that collides with a range's Python names", () => {
    const schema = loadSchema();
    schema.$defs.cameraViewRequest.properties.payload.properties.action["x-kit-constant"] = "FLY_SPEED_MINIMUM";
    expect(() => buildVocabulary(schema)).toThrow(/collides with generated name FLY_SPEED_MINIMUM/);
  });

  it("keeps every committed output equal to a fresh render", () => {
    for (const output of renderAll()) {
      const committed = lf(readFileSync(path.join(repoRoot, output.relativePath), "utf8"));
      expect(committed, `${output.relativePath} is stale; run: cd web-viewer-sample && npm run generate:kit-command-vocabulary`)
        .toBe(output.content);
    }
  });
});
