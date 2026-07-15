// web-viewer-sample/src/console/governance/highlightBridge.test.ts
import { describe, expect, it, vi } from "vitest";
import { HighlightBridge, normalizeSeverity } from "./highlightBridge";
import { MappingCache } from "./mappingCache";
import type { ElementMappingDocument } from "../../types/mapping";
import type { StreamMessage } from "../../types/streamMessages";

type HighlightPrimsPayload = {
  items: Array<{ prim_path: string; ifc_guid?: string; color?: number[] }>;
};

type HighlightPrimsMessage = StreamMessage & {
  payload: HighlightPrimsPayload;
};

// summary 的 source_ifc_entity_count 是 conversion summary 的真實 runtime 欄位，
// 共用型別 ElementMappingSummary 未宣告它，故以 intersection 明確帶入（誠實對映真實資料）。
const DOC: ElementMappingDocument & {
  summary: { mapped_count: number; source_ifc_entity_count: number; fake_mapping_count: number };
} = {
  mock: false,
  model_version_id: "mv_1",
  summary: { mapped_count: 1, source_ifc_entity_count: 1, fake_mapping_count: 0 },
  items: [{ ifc_guid: "GUID_A", usd_prim_path: "/World/IfcWall/_A", ifc_class: "IfcWall", name: "Wall-A" }],
};

describe("HighlightBridge（client 主動拉 → DataChannel，不 server-push）", () => {
  it("有 usd_prim_path 的 failed 構件 → 送出 highlightPrimsRequest（含 prim_path + 顏色 + ifc_guid）", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const sent: HighlightPrimsMessage[] = [];
    const bridge = new HighlightBridge({ cache, sendMessage: (m) => sent.push(m as HighlightPrimsMessage), dataChannelReady: () => true });
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
    expect(res).toEqual({ ok: false, reason: "unmapped" });
    expect(sent).toHaveLength(0); // 不送假 prim
  });

  it("DataChannel 未就緒 → ok:false reason:datachannel_not_ready，不送", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const send = vi.fn();
    const bridge = new HighlightBridge({ cache, sendMessage: send, dataChannelReady: () => false });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res).toEqual({ ok: false, reason: "datachannel_not_ready" });
    expect(send).not.toHaveBeenCalled();
  });

  it("fake mapping cache → 一律 unmapped（不冒充可標示）", () => {
    const fakeCache = MappingCache.fromDocument({ mock: true, items: [{ ifc_guid: "GUID_A", usd_prim_path: "/World/X" }] }, "mv_fake");
    const sent: unknown[] = [];
    const bridge = new HighlightBridge({ cache: fakeCache, sendMessage: (m) => sent.push(m), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res).toEqual({ ok: false, reason: "unmapped" });
    expect(sent).toHaveLength(0);
  });

  // F4：治理 rule engine 可能吐 critical/high/medium/low 等 severityToColor 不特判的標籤；
  // 經 normalizeSeverity 正規化後，"high" 應映到 error 紅 [1,0,0,1]（否則落到預設藍，視覺上誤導）。
  it("severity=high（rule engine 標籤）→ normalizeSeverity → error 紅 [1,0,0,1]", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const sent: HighlightPrimsMessage[] = [];
    const bridge = new HighlightBridge({ cache, sendMessage: (m) => sent.push(m as HighlightPrimsMessage), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "high" });
    expect(res.ok).toBe(true);
    expect(sent[0].payload.items[0].color).toEqual([1, 0, 0, 1]); // critical/high/error → 紅
  });
});

// A2 F2⑥ 批次疊加：多構件必須裝進「一個」highlightPrimsRequest（Kit 端一次 set_selected_prim_paths
// 聯集選取）；逐筆各發 mode:"replace" request 會互相清除（stage_management.py:406-411）。
describe("HighlightBridge.highlightMany（單一批次 request＝聯集選取）", () => {
  const DOC3: ElementMappingDocument = {
    mock: false,
    model_version_id: "mv_3",
    summary: { mapped_count: 3, fake_mapping_count: 0 },
    items: [
      { ifc_guid: "GUID_ADD", usd_prim_path: "/World/Add", ifc_class: "IfcWall", name: "W-add" },
      { ifc_guid: "GUID_DEL", usd_prim_path: "/World/Del", ifc_class: "IfcWall", name: "W-del" },
      { ifc_guid: "GUID_MOD", usd_prim_path: "/World/Mod", ifc_class: "IfcWall", name: "W-mod" },
    ],
  };

  it("三組構件 + 一筆 unmapped → 恰送『一個』request；items 帶各組顏色；unmapped 誠實回列", () => {
    const cache = MappingCache.fromDocument(DOC3, "mv_3");
    const sent: HighlightPrimsMessage[] = [];
    const bridge = new HighlightBridge({ cache, sendMessage: (m) => sent.push(m as HighlightPrimsMessage), dataChannelReady: () => true });
    const res = bridge.highlightMany([
      { ifc_guid: "GUID_ADD", severity: "added" },     // 非 error/warning → 預設藍
      { ifc_guid: "GUID_DEL", severity: "error" },     // 紅
      { ifc_guid: "GUID_MOD", severity: "warning" },   // 橘
      { ifc_guid: "GUID_MISSING", severity: "error" }, // mapping 解不出 → unmapped
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(sent).toHaveLength(1); // 單一 request（聯集）——不是四個 replace request
    expect(sent[0].event_type).toBe("highlightPrimsRequest");
    expect(sent[0].payload.items.map((i) => i.prim_path)).toEqual(["/World/Add", "/World/Del", "/World/Mod"]);
    expect(sent[0].payload.items[0].color).toEqual([0.2, 0.55, 1, 1]); // added → 藍（severityToColor 預設）
    expect(sent[0].payload.items[1].color).toEqual([1, 0, 0, 1]);      // removed(error) → 紅
    expect(sent[0].payload.items[2].color).toEqual([1, 0.75, 0, 1]);   // modified(warning) → 橘
    expect(res.sent.map((s) => s.ifc_guid)).toEqual(["GUID_ADD", "GUID_DEL", "GUID_MOD"]);
    expect(res.unmapped).toEqual(["GUID_MISSING"]); // 誠實列出，不虛報成功
  });

  it("DataChannel 未就緒 → ok:false reason:datachannel_not_ready，不送", () => {
    const cache = MappingCache.fromDocument(DOC3, "mv_3");
    const send = vi.fn();
    const bridge = new HighlightBridge({ cache, sendMessage: send, dataChannelReady: () => false });
    expect(bridge.highlightMany([{ ifc_guid: "GUID_ADD", severity: "added" }]))
      .toEqual({ ok: false, reason: "datachannel_not_ready" });
    expect(send).not.toHaveBeenCalled();
  });

  it("全數未對映 → ok:false reason:unmapped，不送空批次", () => {
    const cache = MappingCache.fromDocument(DOC3, "mv_3");
    const send = vi.fn();
    const bridge = new HighlightBridge({ cache, sendMessage: send, dataChannelReady: () => true });
    expect(bridge.highlightMany([{ ifc_guid: "NOPE_1", severity: "error" }, { ifc_guid: "NOPE_2", severity: "warning" }]))
      .toEqual({ ok: false, reason: "unmapped" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("normalizeSeverity（治理 severity 正規化，大小寫不敏感）", () => {
  it("critical / high / error → error", () => {
    expect(normalizeSeverity("critical")).toBe("error");
    expect(normalizeSeverity("HIGH")).toBe("error");
    expect(normalizeSeverity("Error")).toBe("error");
  });
  it("medium / warning → warning", () => {
    expect(normalizeSeverity("medium")).toBe("warning");
    expect(normalizeSeverity("WARNING")).toBe("warning");
  });
  it("其他（low / info / 未知）→ 原樣透傳（落 severityToColor 預設藍）", () => {
    expect(normalizeSeverity("low")).toBe("low");
    expect(normalizeSeverity("info")).toBe("info");
  });
});
