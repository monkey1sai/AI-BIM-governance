import { describe, expect, it } from "vitest";
import {
  KIT_RUNTIME_RESPONSE_DEDUP_CAPACITY,
  KIT_RUNTIME_RESPONSE_DEDUP_WINDOW_MS,
  KitRuntimeResponseDeduper,
  readKitRuntimeResponseIdentity,
} from "./kitRuntimeResponseDedup";

function rejection(requestId: string) {
  return {
    event_type: "commandRejected",
    payload: {
      request_id: requestId,
      rejected_event_type: "openStageRequest",
      reason: "lease_invalid",
      retryable: true,
      runtime_state: "unchanged",
    },
  };
}

describe("readKitRuntimeResponseIdentity", () => {
  it("讀出帶 request_id 的 Kit 回應身分", () => {
    expect(readKitRuntimeResponseIdentity(rejection("req_1"))).toEqual({
      eventType: "commandRejected",
      requestId: "req_1",
    });
  });

  it("解開 streaming library 的 messageRecipient/data 包裝形狀", () => {
    const wrapped = {
      messageRecipient: "kit",
      data: JSON.stringify({
        event_type: "openedStageResult",
        payload: { request_id: "req_wrapped", result: "success" },
      }),
    };
    expect(readKitRuntimeResponseIdentity(wrapped)).toEqual({
      eventType: "openedStageResult",
      requestId: "req_wrapped",
    });
  });

  it.each([
    ["null 事件", null],
    ["undefined 事件", undefined],
    ["缺 event_type", { payload: { request_id: "req_x" } }],
    ["payload 非物件", { event_type: "commandRejected", payload: "req_x" }],
    ["payload 缺 request_id", { event_type: "stageSelectionChanged", payload: { prim_paths: [] } }],
    ["request_id 空字串", { event_type: "commandRejected", payload: { request_id: "" } }],
    ["request_id 非字串", { event_type: "commandRejected", payload: { request_id: 7 } }],
    ["data 非合法 JSON", { messageRecipient: "kit", data: "{not-json" }],
  ])("%s 一律回 null（等同放行）", (_label, message) => {
    expect(readKitRuntimeResponseIdentity(message as never)).toBeNull();
  });
});

describe("KitRuntimeResponseDeduper", () => {
  it("同一 (event_type, request_id) 二連發只放行第一則", () => {
    const deduper = new KitRuntimeResponseDeduper({ now: () => 0 });
    const identity = { eventType: "commandRejected", requestId: "req_dup" };

    expect(deduper.admit(identity)).toBe(true);
    expect(deduper.admit(identity)).toBe(false);
    expect(deduper.admit(identity)).toBe(false);
  });

  it("不同 request_id 互不影響", () => {
    const deduper = new KitRuntimeResponseDeduper({ now: () => 0 });

    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_a" })).toBe(true);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_b" })).toBe(true);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_a" })).toBe(false);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_b" })).toBe(false);
  });

  it("同一 request_id 的不同 event_type 各自獨立", () => {
    const deduper = new KitRuntimeResponseDeduper({ now: () => 0 });

    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_same" })).toBe(true);
    expect(deduper.admit({ eventType: "openedStageResult", requestId: "req_same" })).toBe(true);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_same" })).toBe(false);
  });

  it("時窗過期後同一個 key 重新放行", () => {
    let clock = 0;
    const deduper = new KitRuntimeResponseDeduper({ windowMs: 1_000, now: () => clock });
    const identity = { eventType: "commandRejected", requestId: "req_window" };

    expect(deduper.admit(identity)).toBe(true);
    clock = 999;
    expect(deduper.admit(identity)).toBe(false);
    clock = 1_000;
    expect(deduper.admit(identity)).toBe(true);
  });

  it("重複命中不延長時窗（時窗自首次放行起算）", () => {
    let clock = 0;
    const deduper = new KitRuntimeResponseDeduper({ windowMs: 1_000, now: () => clock });
    const identity = { eventType: "commandRejected", requestId: "req_no_extend" };

    expect(deduper.admit(identity)).toBe(true);
    clock = 900;
    expect(deduper.admit(identity)).toBe(false);
    clock = 1_000;
    expect(deduper.admit(identity)).toBe(true);
  });

  it("LRU 容量淘汰後，被淘汰的舊 key 再來會放行", () => {
    const deduper = new KitRuntimeResponseDeduper({ capacity: 2, now: () => 0 });

    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_1" })).toBe(true);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_2" })).toBe(true);
    // 第三個 key 把最舊的 req_1 擠出去。
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_3" })).toBe(true);
    expect(deduper.size()).toBe(2);

    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_1" })).toBe(true);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_3" })).toBe(false);
  });

  it("命中會刷新 LRU 順位，仍在被重複轟炸的 key 不會先被淘汰", () => {
    const deduper = new KitRuntimeResponseDeduper({ capacity: 2, now: () => 0 });

    deduper.admit({ eventType: "commandRejected", requestId: "req_hot" });
    deduper.admit({ eventType: "commandRejected", requestId: "req_cold" });
    // req_hot 再被命中一次 → 移到 LRU 尾端。
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_hot" })).toBe(false);
    // 新 key 進場，被擠出的應該是 req_cold。
    deduper.admit({ eventType: "commandRejected", requestId: "req_new" });

    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_hot" })).toBe(false);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_cold" })).toBe(true);
  });

  it("過期項目會被清掉，不會無限增長", () => {
    let clock = 0;
    const deduper = new KitRuntimeResponseDeduper({ windowMs: 100, now: () => clock });

    for (let i = 0; i < 10; i += 1) {
      deduper.admit({ eventType: "commandRejected", requestId: `req_${i}` });
    }
    expect(deduper.size()).toBe(10);

    clock = 100;
    deduper.admit({ eventType: "commandRejected", requestId: "req_after_window" });
    expect(deduper.size()).toBe(1);
  });

  it("預設常數維持 #624 緩解的既定值", () => {
    expect(KIT_RUNTIME_RESPONSE_DEDUP_CAPACITY).toBe(256);
    // 需長於 Window.tsx STAGE_LOAD_TIMEOUT_MS（45_000）。
    expect(KIT_RUNTIME_RESPONSE_DEDUP_WINDOW_MS).toBe(60_000);
    expect(KIT_RUNTIME_RESPONSE_DEDUP_WINDOW_MS).toBeGreaterThan(45_000);
  });

  it("預設容量下第 257 個 key 才觸發淘汰", () => {
    const deduper = new KitRuntimeResponseDeduper({ now: () => 0 });

    for (let i = 0; i < KIT_RUNTIME_RESPONSE_DEDUP_CAPACITY; i += 1) {
      deduper.admit({ eventType: "commandRejected", requestId: `req_${i}` });
    }
    expect(deduper.size()).toBe(KIT_RUNTIME_RESPONSE_DEDUP_CAPACITY);
    // 尚未溢位：最舊的 key 仍被記得。
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_0" })).toBe(false);

    // req_0 剛剛被刷新到尾端，溢位時被擠出的是次舊的 req_1。
    deduper.admit({ eventType: "commandRejected", requestId: "req_overflow" });
    expect(deduper.size()).toBe(KIT_RUNTIME_RESPONSE_DEDUP_CAPACITY);
    expect(deduper.admit({ eventType: "commandRejected", requestId: "req_1" })).toBe(true);
  });
});
