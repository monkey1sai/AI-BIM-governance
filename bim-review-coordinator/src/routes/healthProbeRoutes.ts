import type { Express, Request, Response } from "express";
import type { StructLogger } from "../lib/structLog.js";
import type { ArtifactHealthLedger } from "../services/artifactHealthLedger.js";

export interface HealthProbeRoutesOptions {
  artifactHealthLedger?: ArtifactHealthLedger;
  structLog?: StructLogger;
  startedAt?: number;
}

export function registerHealthProbeRoutes(app: Express, options: HealthProbeRoutesOptions = {}): void {
  app.get("/health", (_req: Request, res: Response) => {
    const uptimeSeconds = options.startedAt ? Math.floor((Date.now() - options.startedAt) / 1000) : 0;
    res.status(200).json({
      status: "healthy",
      service: "bim-review-coordinator",
      uptime_seconds: uptimeSeconds,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/health/summary", (_req: Request, res: Response) => {
    const ledger = options.artifactHealthLedger;
    const records = ledger ? ledger.list() : [];
    res.status(200).json({
      status: "healthy",
      artifacts_monitored: records.length,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ready",
      service: "bim-review-coordinator",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/health/artifacts/:edgeArtifactId", (req: Request, res: Response) => {
    const ledger = options.artifactHealthLedger;
    const targetId = req.params.edgeArtifactId;
    const records = ledger ? ledger.list().filter((r) => r.edge_artifact_id === targetId) : [];
    if (records.length === 0) {
      res.status(404).json({ detail: "Artifact health record not found." });
      return;
    }
    res.status(200).json({
      status: "healthy",
      artifacts: records,
    });
  });
}


