import { createCoordinatorApp } from "./app.js";

const { server, config } = createCoordinatorApp();

server.listen(config.port, config.host, () => {
  console.log(`bim-review-coordinator listening on http://${config.host}:${config.port}`);
});
