import type { CoordinatorConfig } from "../config.js";
import type { KitInstance } from "../types.js";

export function allocateLocalKitInstance(config: CoordinatorConfig): KitInstance {
  return {
    instance_id: "kit_local_001",
    provider: "local_fixed",
    status: "allocated",
    stream_server: config.kitStreamServer,
    signaling_port: config.kitSignalingPort,
    media_server: config.kitMediaServer,
  };
}
