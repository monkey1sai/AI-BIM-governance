import { resolveBimControlBase } from "./envHelpers";

describe("resolveBimControlBase", () => {
    it("prefers the query coordinator base when present", () => {
        expect(resolveBimControlBase("q", "e")).toBe("q");
    });

    it("falls back to the env coordinator base when query is empty", () => {
        expect(resolveBimControlBase("", "e")).toBe("e");
    });

    it("falls back to the env coordinator base when query is null", () => {
        expect(resolveBimControlBase(null, "e")).toBe("e");
    });
});
