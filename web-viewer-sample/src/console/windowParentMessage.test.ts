// VG-01：viewer 端（Window.tsx）parent postMessage 守衛純函式單元測。
// 放 console 旁因 vg01 協定常數 / 守衛邏輯與 console 端（EmbeddedViewer）共用同一套。
import { describe, it, expect } from "vitest";
import { shouldAcceptParentMessage, canHandleHighlight, failedElementsForEmbed } from "../parentMessageGuard";

function ev(data: unknown, origin: string): MessageEvent {
  return { data, origin } as MessageEvent;
}

describe("parent message 守衛", () => {
  const ALLOW = new Set(["http://127.0.0.1:8004"]);

  it("origin 不在白名單 → 拒", () => {
    expect(shouldAcceptParentMessage(ev({ protocol: "vg01", type: "highlight" }, "http://evil"), ALLOW, true)).toBe(false);
  });
  it("缺 protocol → 拒", () => {
    expect(shouldAcceptParentMessage(ev({ type: "highlight" }, "http://127.0.0.1:8004"), ALLOW, true)).toBe(false);
  });
  it("protocol 非 vg01 → 拒", () => {
    expect(shouldAcceptParentMessage(ev({ protocol: "vg00", type: "highlight" }, "http://127.0.0.1:8004"), ALLOW, true)).toBe(false);
  });
  it("非嵌入（無 parent）→ 拒", () => {
    expect(shouldAcceptParentMessage(ev({ protocol: "vg01", type: "highlight" }, "http://127.0.0.1:8004"), ALLOW, false)).toBe(false);
  });
  it("data 為 null → 拒（不可崩潰）", () => {
    expect(shouldAcceptParentMessage(ev(null, "http://127.0.0.1:8004"), ALLOW, true)).toBe(false);
  });
  it("origin 白名單 + vg01 + 嵌入 → 收", () => {
    expect(shouldAcceptParentMessage(ev({ protocol: "vg01", type: "highlight" }, "http://127.0.0.1:8004"), ALLOW, true)).toBe(true);
  });
  it("canOperate=false → highlight 不處理（M2 守 spectator）", () => {
    expect(canHandleHighlight(false)).toBe(false);
  });
  it("canOperate=true → highlight 處理", () => {
    expect(canHandleHighlight(true)).toBe(true);
  });
});

describe("S3：嵌入時失敗清單收合（viewer 僅作高亮引擎）", () => {
  const rows = [{ ifc_guid: "G1", severity: "error" }, { ifc_guid: "G2", severity: "warning" }];

  it("嵌入（isEmbedded=true）→ 餵空陣列（落入「目前無治理失敗構件」分支收合）", () => {
    expect(failedElementsForEmbed(rows, true)).toEqual([]);
  });
  it("非嵌入（isEmbedded=false）→ 原樣透傳（既有單機行為零變更）", () => {
    expect(failedElementsForEmbed(rows, false)).toBe(rows);
  });
});
