import { describe, expect, it } from "vitest";
import { buildCameraStateRequest, buildCameraViewRequest, buildFlyNavigationRequest } from "./streamMessages";

describe("camera stream message builders", () => {
    it("builds a preset request with only wire fields", () => {
        expect(buildCameraViewRequest({ action: "preset", view: "iso", scope: "all" }, "req-1")).toEqual({
            event_type: "cameraViewRequest",
            payload: { request_id: "req-1", action: "preset", view: "iso", scope: "all" },
        });
    });
    it("builds a projection request", () => {
        expect(buildCameraViewRequest({ action: "projection", projection: "orthographic" }, "req-2")).toEqual({
            event_type: "cameraViewRequest",
            payload: { request_id: "req-2", action: "projection", projection: "orthographic" },
        });
    });
    it("builds read-only camera state and fly speed requests", () => {
        expect(buildCameraStateRequest("req-3")).toEqual({ event_type: "cameraStateRequest", payload: { request_id: "req-3" } });
        expect(buildFlyNavigationRequest(2.5, "req-4")).toEqual({
            event_type: "flyNavigationRequest",
            payload: { request_id: "req-4", speed: 2.5 },
        });
    });
});
