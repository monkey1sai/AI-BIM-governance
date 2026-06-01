import { createCoordinatorApp } from "./app.js";

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

const shutdown = async (): Promise<void> => {
  await dispose();
  server.close(() => {
    io.close(() => {
      process.exit(0);
    });
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
