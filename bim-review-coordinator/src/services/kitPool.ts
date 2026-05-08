import type { CoordinatorConfig, KitInstanceEndpointConfig } from "../config.js";
import type { ArtifactBinding, KitInstance, KitInstanceBinding, RoutingPolicy } from "../types.js";
import { nowIso } from "../utils/time.js";

export function allocateLocalKitInstance(config: CoordinatorConfig): KitInstance {
  const endpoint = firstKitEndpoint(config);
  return {
    instance_id: endpoint.id,
    provider: "local_fixed",
    status: "ready",
    stream_server: endpoint.signalingServer,
    signaling_port: endpoint.signalingPort,
    media_server: endpoint.mediaServer,
    media_port: endpoint.mediaPort,
  };
}

export function allocateKitInstanceBindings(
  config: CoordinatorConfig,
  artifactBindings: ArtifactBinding[],
  routingPolicy: RoutingPolicy,
  tenantId: string,
  kitProfile: Record<string, unknown> = {},
): KitInstanceBinding[] {
  const endpoints = kitEndpointPool(config);
  const defaultCapacitySlots = routingPolicy === "dedicated_instance" ? endpoints.length : 1;
  const capacitySlots = resolveCapacitySlots(kitProfile.capacity_slots, defaultCapacitySlots);
  const effectiveCapacitySlots = Math.min(capacitySlots, endpoints.length);
  if (effectiveCapacitySlots <= 0) {
    return [];
  }

  const profile = typeof kitProfile.profile === "string" ? kitProfile.profile : "local_fixed";
  const timestamp = nowIso();
  if (routingPolicy === "dedicated_instance") {
    if (artifactBindings.length > effectiveCapacitySlots) {
      return [];
    }
    return artifactBindings.map((binding, index) =>
      buildBinding(config, {
        endpoint: endpoints[index],
        tenantId,
        assignedArtifactIds: [binding.artifact_id],
        profile,
        capacitySlot: `local-slot-${index + 1}`,
        timestamp,
      }),
    );
  }

  return [
    buildBinding(config, {
      endpoint: endpoints[0],
      tenantId,
      assignedArtifactIds: artifactBindings.map((binding) => binding.artifact_id),
      profile,
      capacitySlot: "local-slot-1",
      timestamp,
    }),
  ];
}

export function legacyKitInstanceFromBinding(binding: KitInstanceBinding | undefined, config: CoordinatorConfig): KitInstance {
  if (!binding) return allocateLocalKitInstance(config);
  return {
    instance_id: binding.kit_instance_id,
    provider: binding.provider,
    status: binding.status === "ready" ? "ready" : binding.status,
    stream_server: binding.stream_config.signalingServer,
    signaling_port: binding.stream_config.signalingPort,
    media_server: binding.stream_config.mediaServer,
    media_port: binding.stream_config.mediaPort,
  };
}

function defaultKitEndpoint(config: CoordinatorConfig): KitInstanceEndpointConfig {
  return {
    id: "kit_local_001",
    signalingServer: config.kitStreamServer,
    signalingPort: config.kitSignalingPort,
    mediaServer: config.kitMediaServer,
    mediaPort: config.kitMediaPort,
  };
}

function kitEndpointPool(config: CoordinatorConfig): KitInstanceEndpointConfig[] {
  return config.kitInstanceEndpoints.length > 0 ? config.kitInstanceEndpoints : [defaultKitEndpoint(config)];
}

function firstKitEndpoint(config: CoordinatorConfig): KitInstanceEndpointConfig {
  return kitEndpointPool(config)[0];
}

function resolveCapacitySlots(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const slots = Number(value);
  if (!Number.isFinite(slots)) return fallback;
  return Math.max(0, Math.floor(slots));
}

export function markKitBindingsDraining(bindings: KitInstanceBinding[]): KitInstanceBinding[] {
  return bindings.map((binding) => ({
    ...binding,
    status: binding.status === "released" ? "released" : "draining",
    last_heartbeat_at: nowIso(),
  }));
}

export function releaseKitBindings(bindings: KitInstanceBinding[]): KitInstanceBinding[] {
  const timestamp = nowIso();
  return bindings.map((binding) => ({
    ...binding,
    status: "released",
    last_heartbeat_at: timestamp,
    released_at: binding.released_at || timestamp,
  }));
}

interface BuildBindingInput {
  endpoint: KitInstanceEndpointConfig;
  tenantId: string;
  assignedArtifactIds: string[];
  profile: string;
  capacitySlot: string;
  timestamp: string;
}

function buildBinding(config: CoordinatorConfig, input: BuildBindingInput): KitInstanceBinding {
  const endpoint = input.endpoint || firstKitEndpoint(config);
  return {
    kit_instance_id: endpoint.id,
    provider: "local_fixed",
    tenant_id: input.tenantId,
    assigned_artifact_ids: input.assignedArtifactIds,
    status: "ready",
    stream_config: {
      signalingServer: endpoint.signalingServer,
      signalingPort: endpoint.signalingPort,
      mediaServer: endpoint.mediaServer,
      mediaPort: endpoint.mediaPort,
    },
    started_at: input.timestamp,
    last_heartbeat_at: input.timestamp,
    released_at: null,
    gpu_profile: {
      profile: input.profile,
      capacity_slot: input.capacitySlot,
    },
  };
}
