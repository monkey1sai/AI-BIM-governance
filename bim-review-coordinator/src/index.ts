import { createCoordinatorApp } from "./app.js";

const { server, config, structLog } = createCoordinatorApp();

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
