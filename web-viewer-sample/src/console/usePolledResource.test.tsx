// C2：usePolledResource 單元測試。每個案例對應 SharedStatusProvider.tsx 註解裡踩過的一個坑
//（interval 節奏 / 逾時自癒 / stale settle 丟棄 / unmount 不洩漏 / enabled 切換 / refresh 立即刷新 /
// 資料時效 watchdog / immediate:false / backoff），全部用 fake timers 鎖成回歸測試。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolledResource, type PolledResource, type UsePolledResourceOptions } from "./usePolledResource";

describe("usePolledResource", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let captured: PolledResource<unknown> | null;

  function Probe({ fetcher, opts }: { fetcher: (signal: AbortSignal) => Promise<unknown>; opts: UsePolledResourceOptions }) {
    captured = usePolledResource(fetcher, opts);
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container); captured = null; root = null;
  });
  afterEach(async () => {
    // 先 unmount 再還原 timers：effect cleanup 需要在 fake timers 仍在時清掉 watchdog/next-tick 計時器
    //（同 SharedStatusProvider.test.tsx 的順序理由）。
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); vi.useRealTimers();
  });

  const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

  it("掛載立即抓一次，之後每 intervalMs 觸發一輪（settle 驅動），成功時發佈 data/lastUpdatedAt", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => { n += 1; return n; });
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000 }} />); await flush(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(captured?.data).toBe(1);
    expect(captured?.status).toBe("success");
    expect(captured?.error).toBeNull();
    expect(captured?.lastUpdatedAt).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(captured?.data).toBe(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(captured?.data).toBe(3);
  });

  it("逾時 watchdog：永不 settle 的 fetch 在 timeoutMs 後被 abort＋disown、記 error，且迴圈自癒不凍結", async () => {
    // 三段鏈（同 SharedStatusProvider 既有測試的手法）：①成功 → ②永久懸置（觸發逾時）→ ③之後都成功，
    // 驗「復活後真的拿到 fresh 資料」而不只是持續重試。
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      if (fetcher.mock.calls.length === 2) return new Promise<never>(() => {}); // 永不 settle
      return Promise.resolve(`ok-${fetcher.mock.calls.length}`);
    });
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000 }} />); await flush(); });
    expect(captured?.data).toBe("ok-1");

    // t=1000 第二輪懸置；預設 timeoutMs=2×interval → t=3000 逾時。
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(captured?.status).toBe("error");
    expect(String(captured?.error)).toContain("timeoutMs=2000");
    expect(captured?.data).toBe("ok-1");          // 失敗不擦除上一次成功值
    expect(signals[1]?.aborted).toBe(true);       // 卡死請求已被 abort（fetcher 若支援 signal 可真取消）

    // 逾時後照常排下一輪：迴圈存活，且下一次成功要真的把資料換新。
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher.mock.calls.length).toBeGreaterThan(2);
    expect(captured?.status).toBe("success");
    expect(captured?.data).toBe(`ok-${fetcher.mock.calls.length}`);
  });

  it("gen-token：被 refresh 接管後，舊 in-flight poll 遲到的 settle 一律丟棄——不發佈、不多排孤兒 timer", async () => {
    let releaseFirst!: (v: string) => void;
    const fetcher = vi.fn(() => {
      if (fetcher.mock.calls.length === 1) return new Promise<string>((res) => { releaseFirst = res; });
      return Promise.resolve("B");
    });
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000 }} />); await flush(); });
    expect(captured?.status).toBe("loading"); // 第一輪懸置中，尚無資料

    // refresh 接管：disown 第一輪、立即發第二輪並成功。
    await act(async () => { captured!.refresh(); await flush(); });
    expect(captured?.data).toBe("B");
    const timersBefore = vi.getTimerCount(); // 現任世代的 next-tick + watchdog

    // 舊 poll 遲到 settle：結果必須被丟棄（data 不得倒退成 "A"），也不得再排任何孤兒 timer。
    await act(async () => { releaseFirst("A"); await flush(); });
    expect(captured?.data).toBe("B");
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it("unmount 清乾淨：計時器歸零、abort in-flight、之後不再呼叫 fetcher", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<never>(() => {}); });
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000 }} />); await flush(); });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => { root!.unmount(); });
    root = null;
    expect(vi.getTimerCount()).toBe(0);       // next-tick / 逾時 / watchdog 全清，無計時器洩漏
    expect(signals[0]?.aborted).toBe(true);   // in-flight 已 abort
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher).toHaveBeenCalledTimes(1); // unmount 後絕不再抓
  });

  it("enabled 切換：false 完全不輪詢（idle），翻 true 啟動，翻回 false 停止且不再抓", async () => {
    const fetcher = vi.fn(async () => "x");
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000, enabled: false }} />); await flush(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(captured?.status).toBe("idle");

    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000, enabled: true }} />); await flush(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(captured?.status).toBe("success");

    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000, enabled: false }} />); await flush(); });
    const calls = fetcher.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetcher.mock.calls.length).toBe(calls); // 停用後不再抓
    expect(captured?.status).toBe("idle");
    expect(captured?.data).toBe("x"); // 資料保留，只是誠實退 idle
  });

  it("refresh 立即刷新：不等 interval 馬上抓，成功後自 refresh 起重新計 intervalMs", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => { n += 1; return n; });
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000 }} />); await flush(); });
    expect(captured?.data).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); // 半途手動刷新
    await act(async () => { captured!.refresh(); await flush(); });     // 不推進計時器 → 立即
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(captured?.data).toBe(2);

    // 原本 t=1000 的舊排程已被 refresh 清掉：+600ms（原排程時刻）不得再抓，+1000ms（自 refresh 起算）才抓。
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("資料時效 watchdog：後續請求懸置（不 settle）時，成功殘影超過 staleAfterMs 即翻 stale，不冒充新鮮", async () => {
    const fetcher = vi.fn(() => {
      if (fetcher.mock.calls.length === 1) return Promise.resolve("fresh");
      return new Promise<never>(() => {}); // 之後全懸置：不 resolve 不 reject，不會進 catch
    });
    // timeoutMs 拉大讓逾時分支不介入，單獨驗時效翻轉這條路。
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000, timeoutMs: 60_000, staleAfterMs: 1500 }} />); await flush(); });
    expect(captured?.status).toBe("success");

    await act(async () => { await vi.advanceTimersByTimeAsync(2100); }); // 上次成功已 2100ms > 1500ms
    expect(captured?.status).toBe("stale");
    expect(captured?.data).toBe("fresh"); // 資料保留，由呼叫端決定如何誠實呈現「未取得/過期」
  });

  it("immediate:false：掛載不立即抓，第一輪等滿 intervalMs（等價裸 setInterval 節奏）", async () => {
    const fetcher = vi.fn(async () => "x");
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000, immediate: false }} />); await flush(); });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("backoff：連續失敗時延遲按 factor 指數放大（intervalMs×factor^n），成功即重置", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValue("recovered");
    root = createRoot(container);
    await act(async () => { root!.render(<Probe fetcher={fetcher} opts={{ intervalMs: 1000, backoffFactor: 2 }} />); await flush(); });
    expect(fetcher).toHaveBeenCalledTimes(1); // t=0 失敗 → 下一輪 1000×2^1 = 2000ms 後
    expect(captured?.status).toBe("error");

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(1); // 尚未到 backoff 後的時刻
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(2); // t=2000 第二次，仍失敗 → 下一輪 1000×2^2 = 4000ms 後

    await act(async () => { await vi.advanceTimersByTimeAsync(3900); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(fetcher).toHaveBeenCalledTimes(3); // t≈6000 第三次 → 成功，backoff 歸零
    expect(captured?.status).toBe("success");
    expect(captured?.data).toBe("recovered");

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(4); // 回到正常 intervalMs 節奏
  });
});
