/*
 * triReady.ts 三段 ready 計算的 vitest 覆蓋。
 * 重點:#16 spectator 連上 coordinator 已標記 spectator_ready 的 Kit 後,
 * stageLoadStatus='matched' 應讓 Runtime ready 轉 yes(信任 primary serving stage)。
 */
import { computeFileReady, computeRuntimeReady, computeSemanticReady } from "./triReady";
import type { ReviewStreamConfig, ConversionQualityMetricsSummary } from "../types/review";

describe("computeRuntimeReady", () => {
    it("#16 spectator: started + matched → yes(信任 primary serving stage)", () => {
        expect(computeRuntimeReady("started", "matched")).toBe("yes");
    });
    it("started + pending → incomplete(尚未證明 stage)", () => {
        expect(computeRuntimeReady("started", "pending")).toBe("incomplete");
    });
    it("started + unproven → incomplete", () => {
        expect(computeRuntimeReady("started", "unproven")).toBe("incomplete");
    });
    it("started + mismatch → no", () => {
        expect(computeRuntimeReady("started", "mismatch")).toBe("no");
    });
    it("non-started lifecycle 即使 matched 也 → no", () => {
        expect(computeRuntimeReady("initializing", "matched")).toBe("no");
        expect(computeRuntimeReady("stopped", "matched")).toBe("no");
        expect(computeRuntimeReady("terminated", "matched")).toBe("no");
    });
});

describe("computeFileReady", () => {
    it("model ready + url → yes", () => {
        const cfg = { model: { status: "ready", url: "edge-local://artifacts/model.usdc" } } as ReviewStreamConfig;
        expect(computeFileReady(cfg)).toBe("yes");
    });
    it("model ready 但缺 url → no", () => {
        const cfg = { model: { status: "ready", url: "" } } as ReviewStreamConfig;
        expect(computeFileReady(cfg)).toBe("no");
    });
    it("null streamConfig → no", () => {
        expect(computeFileReady(null)).toBe("no");
    });
});

describe("computeSemanticReady", () => {
    it("fidelity + type + name 全到位 → yes", () => {
        const s = { semantic_mapping_fidelity: "high", mapping_has_ifc_type: true, mapping_has_ifc_name: true } as ConversionQualityMetricsSummary;
        expect(computeSemanticReady(s)).toBe("yes");
    });
    it("僅部分到位 → incomplete(不偽宣告 yes)", () => {
        const s = { semantic_mapping_fidelity: "high", mapping_has_ifc_type: false, mapping_has_ifc_name: false } as ConversionQualityMetricsSummary;
        expect(computeSemanticReady(s)).toBe("incomplete");
    });
    it("null summary → no", () => {
        expect(computeSemanticReady(null)).toBe("no");
    });
});
