import { createCoordinatorApp } from "./app.js";
import { createGracefulShutdown } from "./shutdown.js";

const { server, io, config, structLog, dispose } = createCoordinatorApp();

server.listen(config.port, config.host, () => {
  structLog.lifecycle(
    "bootstrap",
    `bim-review-coordinator listening on http://${config.host}:${config.port}`,
    {
      phase: "active",
      subject_kind: "script_run",
      subject_id: structLog.runId,
    },
  );
});

// #7：SIGTERM/SIGINT → graceful dispose(drain queued → dropped_on_restart)→
// io.close → server.close → exit(0)。shutdown 邏輯抽到 createGracefulShutdown
// 供 tests/shutdown.test.ts 直接驗證(順序 + io 先於 server)。
const shutdown = createGracefulShutdown({ dispose, io, server, exit: process.exit });

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
