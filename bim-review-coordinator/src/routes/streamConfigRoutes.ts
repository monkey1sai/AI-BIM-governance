import type { Express, Request, Response } from "express";
import type { CoordinatorConfig } from "../config.js";
import type { StructLogger } from "../lib/structLog.js";

export interface StreamConfigRoutesOptions {
  config: CoordinatorConfig;
  structLog?: StructLogger;
}

export function registerStreamConfigRoutes(app: Express, options: StreamConfigRoutesOptions): void {
  app.get("/api/stream-config/defaults", (_req: Request, res: Response) => {
    res.status(200).json({
      signaling_server: options.config.kitStreamServer,
      signaling_port: options.config.kitSignalingPort,
      media_server: options.config.kitMediaServer,
      media_port: options.config.kitMediaPort,
    });
  });
}
