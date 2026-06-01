import { describe, it, expect } from "vitest";
import { createGracefulShutdown } from "../src/shutdown.js";

describe("createGracefulShutdown (#7 SIGTERM/SIGINT → graceful dispose → exit 0)", () => {
  it("依序 dispose → io.close → server.close → exit(0)", async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      dispose: () => {
        calls.push("dispose");
      },
      io: { close: (cb) => { calls.push("io.close"); cb?.(); } },
      server: { close: (cb) => { calls.push("server.close"); cb?.(); } },
      exit: (code) => { calls.push("exit:" + code); },
    });

    await shutdown();

    expect(calls).toEqual(["dispose", "io.close", "server.close", "exit:0"]);
  });

  it("io.close 必須在 server.close 之前（避免 Socket.IO keep-alive 讓 server.close 的 callback 永不觸發）", async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      dispose: () => {},
      io: { close: (cb) => { calls.push("io"); cb?.(); } },
      server: { close: (cb) => { calls.push("server"); cb?.(); } },
      exit: () => {},
    });

    await shutdown();

    expect(calls.indexOf("io")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("io")).toBeLessThan(calls.indexOf("server"));
  });

  it("await dispose 完成後才開始關閉（支援 async dispose，drain 先跑完）", async () => {
    const calls: string[] = [];
    const shutdown = createGracefulShutdown({
      dispose: async () => {
        await Promise.resolve();
        calls.push("dispose");
      },
      io: { close: (cb) => { calls.push("io"); cb?.(); } },
      server: { close: (cb) => { calls.push("server"); cb?.(); } },
      exit: () => { calls.push("exit"); },
    });

    await shutdown();

    expect(calls[0]).toBe("dispose");
    expect(calls).toEqual(["dispose", "io", "server", "exit"]);
  });
});
