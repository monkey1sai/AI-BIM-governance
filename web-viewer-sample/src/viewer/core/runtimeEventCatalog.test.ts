import { describe, expect, it } from "vitest";
import { isKitToViewerEventType, isRuntimeResponseForRequest, isSimpleRuntimeTerminalEvent, isViewerToKitEventType } from "./runtimeEventCatalog";

const outbound = ["openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage", "loadingStateQuery", "getChildrenRequest"];
const inbound = ["openedStageResult", "loadArtifactGroupResult", "highlightPrimsResult", "focusPrimResult", "selectPrimsResult", "makePrimsPickableResponse", "resetStageResponse", "clearHighlightResult", "loadingStateResponse", "getChildrenResponse", "stageSelectionChanged", "updateProgressAmount", "updateProgressActivity", "bindingApplied", "commandRejected"];
const pairs: Array<[string, string]> = [
    ["openedStageResult", "openStageRequest"], ["openedStageResult", "loadArtifactGroupRequest"],
    ["loadArtifactGroupResult", "loadArtifactGroupRequest"], ["loadArtifactGroupResult", "composeStageRequest"],
    ["bindingApplied", "loadArtifactGroupRequest"], ["bindingApplied", "composeStageRequest"],
    ["highlightPrimsResult", "highlightPrimsRequest"], ["focusPrimResult", "focusPrimRequest"],
    ["clearHighlightResult", "clearHighlightRequest"], ["selectPrimsResult", "selectPrimsRequest"],
    ["makePrimsPickableResponse", "makePrimsPickable"], ["resetStageResponse", "resetStage"],
];
const simple = ["clearHighlightResult", "selectPrimsResult", "makePrimsPickableResponse", "resetStageResponse"];
const unknown = ["", "__proto__", "constructor", "openStageRequest ", "OpenedStageResult", "futureEvent"];
describe("runtime event catalog", () => {
    it("supports only the matching clip-plane response", () => {
        expect(isViewerToKitEventType("clipPlaneRequest")).toBe(true);
        expect(isKitToViewerEventType("clipPlaneResult")).toBe(true);
        expect(isRuntimeResponseForRequest("clipPlaneResult", "clipPlaneRequest")).toBe(true);
        expect(isRuntimeResponseForRequest("clipPlaneResult", "clearHighlightRequest")).toBe(false);
        expect(isSimpleRuntimeTerminalEvent("clipPlaneResult")).toBe(true);
    });
    it.each(outbound)("preserves outbound event %s", event => expect(isViewerToKitEventType(event)).toBe(true));
    it.each(inbound)("preserves inbound event %s", event => expect(isKitToViewerEventType(event)).toBe(true));
    it.each([...inbound, ...unknown])("rejects non-outbound %s", event => expect(isViewerToKitEventType(event)).toBe(false));
    it.each([...outbound, ...unknown])("rejects non-inbound %s", event => expect(isKitToViewerEventType(event)).toBe(false));
    it.each(pairs)("allows exact pair %s/%s", (response, request) => expect(isRuntimeResponseForRequest(response, request)).toBe(true));
    it("rejects every other response/request combination", () => {
        for (const response of [...inbound, ...unknown]) {
            for (const request of [...outbound, ...unknown]) {
                const expected = pairs.some(([r, q]) => r === response && q === request);
                expect(isRuntimeResponseForRequest(response, request), response + "/" + request).toBe(expected);
            }
        }
    });
    it.each(simple)("recognizes simple terminal %s", event => expect(isSimpleRuntimeTerminalEvent(event)).toBe(true));
    it.each([...inbound.filter(event => !simple.includes(event)), ...outbound, ...unknown])("rejects non-simple %s", event => expect(isSimpleRuntimeTerminalEvent(event)).toBe(false));
});
