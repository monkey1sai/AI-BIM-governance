// web-viewer-sample/src/console/governance/highlightBridge.test.ts
import { describe, expect, it, vi } from "vitest";
import { HighlightBridge } from "./highlightBridge";
import { MappingCache } from "./mappingCache";
import type { ElementMappingDocument } from "../../types/mapping";

const DOC: ElementMappingDocument = {
  mock: false,
  model_version_id: "mv_1",
  summary: { mapped_count: 1, source_ifc_entity_count: 1, fake_mapping_count: 0 },
  items: [{ ifc_guid: "GUID_A", usd_prim_path: "/World/IfcWall/_A", ifc_class: "IfcWall", name: "Wall-A" }],
};

describe("HighlightBridge（client 主動拉 → DataChannel，不 server-push）", () => {
  it("有 usd_prim_path 的 failed 構件 → 送出 highlightPrimsRequest（含 prim_path + 顏色 + ifc_guid）", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const sent: { event_type: string; payload: any }[] = [];
    const bridge = new HighlightBridge({ cache, sendMessage: (m) => sent.push(m as any), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].event_type).toBe("highlightPrimsRequest"); // 既有 Kit 消費的指令（非新發明）
    expect(sent[0].payload.items[0].prim_path).toBe("/World/IfcWall/_A");
    expect(sent[0].payload.items[0].ifc_guid).toBe("GUID_A");
    expect(sent[0].payload.items[0].color).toEqual([1, 0, 0, 1]); // severity=error → 紅（severityToColor）
  });

  it("未對映（usd_prim_path 查不到）→ ok:false reason:unmapped，不送、不捏造 prim", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const sent: unknown[] = [];
    const bridge = new HighlightBridge({ cache, sendMessage: (m) => sent.push(m), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_MISSING", severity: "error" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unmapped");
    expect(sent).toHaveLength(0); // 不送假 prim
  });

  it("DataChannel 未就緒 → ok:false reason:datachannel_not_ready，不送", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const send = vi.fn();
    const bridge = new HighlightBridge({ cache, sendMessage: send, dataChannelReady: () => false });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("datachannel_not_ready");
    expect(send).not.toHaveBeenCalled();
  });

  it("fake mapping cache → 一律 unmapped（不冒充可標示）", () => {
    const fakeCache = MappingCache.fromDocument({ mock: true, items: [{ ifc_guid: "GUID_A", usd_prim_path: "/World/X" }] }, "mv_fake");
    const sent: unknown[] = [];
    const bridge = new HighlightBridge({ cache: fakeCache, sendMessage: (m) => sent.push(m), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unmapped");
    expect(sent).toHaveLength(0);
  });
});
