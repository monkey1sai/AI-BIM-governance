import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface CoordinatorConfig {
  host: string;
  port: number;
  bimControlApiBase: string;
  conversionApiBase: string;
  kitStreamServer: string;
  kitSignalingPort: number;
  kitMediaServer: string;
  devAuthToken: string;
  sessionStoreDir: string;
  eventLogDir: string;
  corsOrigins: string[];
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csvFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(overrides: Partial<CoordinatorConfig> = {}): CoordinatorConfig {
  const cwd = process.cwd();
  return {
    host: process.env.HOST || "127.0.0.1",
    port: numberFromEnv("PORT", 8004),
    bimControlApiBase: process.env.BIM_CONTROL_API_BASE || "http://127.0.0.1:8001",
    conversionApiBase: process.env.CONVERSION_API_BASE || "http://127.0.0.1:8003",
    kitStreamServer: process.env.KIT_STREAM_SERVER || "127.0.0.1",
    kitSignalingPort: numberFromEnv("KIT_SIGNALING_PORT", 49100),
    kitMediaServer: process.env.KIT_MEDIA_SERVER || "127.0.0.1",
    devAuthToken: process.env.DEV_AUTH_TOKEN || "dev-token",
    sessionStoreDir: process.env.SESSION_STORE_DIR || path.join(cwd, "data", "sessions"),
    eventLogDir: process.env.EVENT_LOG_DIR || path.join(cwd, "data", "events"),
    corsOrigins: csvFromEnv("CORS_ORIGINS", ["http://127.0.0.1:5173", "http://localhost:5173"]),
    ...overrides,
  };
}
