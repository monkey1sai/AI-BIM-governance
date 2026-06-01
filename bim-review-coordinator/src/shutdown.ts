// harden-coordinator-ifc-intake #7：可注入 deps 的 graceful shutdown，供 index.ts
// 接 SIGTERM/SIGINT，並讓 test 直接驗證 signal → dispose → exit(0) 路徑。
//
// 順序鐵則：dispose → io.close → server.close → exit(0)。
// io.close MUST 在 server.close 之前——`http.Server.close()` 的 callback 只在所有
// 既有連線關閉後才觸發，而 Socket.IO 的 keep-alive 持久連線不會自己關；若先
// server.close、把 io.close 嵌在其 callback 內，只要有 viewer 連著，callback 就
// 永不觸發、process.exit(0) 永遠到不了（docker stop 卡到 SIGKILL）。先 io.close
// 斷開 Socket.IO 連線後，server.close 才能順利完成。

export interface ShutdownDeps {
  dispose: () => void | Promise<void>;
  io: { close: (cb?: () => void) => void };
  server: { close: (cb?: () => void) => void };
  exit: (code: number) => void;
}

export function createGracefulShutdown(deps: ShutdownDeps): () => Promise<void> {
  return async (): Promise<void> => {
    await deps.dispose();
    deps.io.close(() => {
      deps.server.close(() => {
        deps.exit(0);
      });
    });
  };
}
