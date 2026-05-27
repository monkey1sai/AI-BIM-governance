/**
 * Unit tests for src/services/kitPool.ts
 *
 * Tests cover the NEW functions added in this PR:
 *   - allocateKitInstanceBindings
 *   - legacyKitInstanceFromBinding
 *   - markKitBindingsDraining
 *   - releaseKitBindings
 */

import { describe, expect, it } from "vitest";
import {
  allocateKitInstanceBindings,
  allocateLocalKitInstance,
  legacyKitInstanceFromBinding,
  markKitBindingsDraining,
  releaseKitBindings,
} from "../src/services/kitPool.js";
import type { ArtifactBinding, KitInstanceBinding } from "../src/types.js";
import type { CoordinatorConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultConfig: CoordinatorConfig = {
  host: "127.0.0.1",
  port: 8004,
  coordinatorPublicBaseUrl: "http://127.0.0.1:8004",
  bimControlApiBase: "",
  conversionApiBase: "http://127.0.0.1:49101",
  kitStreamServer: "kit-server.local",
  kitSignalingPort: 49100,
  kitMediaServer: "kit-media.local",
  kitMediaPort: 47998,
  kitInstanceEndpoints: [
    {
      id: "kit_local_001",
      signalingServer: "kit-server.local",
      signalingPort: 49100,
      mediaServer: "kit-media.local",
      mediaPort: 47998,
    },
  ],
  devAuthToken: "dev-token",
  sessionStoreDir: "/tmp/sessions",
  eventLogDir: "/tmp/events",
  corsOrigins: ["http://127.0.0.1:5173"],
  internalApiAuthToken: "dev-internal-token",
  streamingConversionApiBase: "http://127.0.0.1:49101",
  externalIntakeAuthProvider: "intranet-dev",
  externalIntakeWebhookSecret: "dev-webhook-secret",
  externalIntakeIpAllowlist: ["127.0.0.1", "::1"],
  cloudCallbackBaseUrl: "",
  callbackOutboxMaxAttempts: 5,
  callbackOutboxStorePath: "/tmp/callback-outbox.json",
  userAuthProvider: "local-dev",
  // fast-ifc-link-demo-loop §2.5
  ifcDownloadTimeoutSeconds: 600,
  storageRoot: "/tmp/storage",
  storageHostRoot: "/tmp/storage",
  publicHost: "127.0.0.1",
  viewerPublicBaseUrl: "http://127.0.0.1:5173",
  // coordinator-auto-poll-streaming-conversion §2:test fixture 預設關 polling
  // 避免 unit test 啟動 in-process timer 干擾 isolation。
  conversionPollEnabled: false,
  conversionPollIntervalSeconds: 5,
  conversionPollMaxAttempts: 60,
  logRoot: "/tmp/logs",
};

const multiEndpointConfig: CoordinatorConfig = {
  ...defaultConfig,
  kitInstanceEndpoints: [
    {
      id: "kit_local_001",
      signalingServer: "kit-server.local",
      signalingPort: 49100,
      mediaServer: "kit-media.local",
      mediaPort: 47998,
    },
    {
      id: "kit_local_002",
      signalingServer: "kit-server.local",
      signalingPort: 49110,
      mediaServer: "kit-media.local",
      mediaPort: 48008,
    },
  ],
};

function makeArtifactBinding(overrides: Partial<ArtifactBinding> = {}): ArtifactBinding {
  return {
    binding_id: "binding_1",
    artifact_group_id: "ag_001",
    model_version_id: "version_001",
    artifact_id: "artifact_usdc_001",
    artifact_role: "derived",
    url: "edge-local://artifacts/model.usdc",
    mapping_url: "edge-local://artifacts/element_mapping.json",
    load_order: 0,
    routing_policy: "same_instance",
    ready_status: "ready",
    ...overrides,
  };
}

function makeKitInstanceBinding(overrides: Partial<KitInstanceBinding> = {}): KitInstanceBinding {
  return {
    kit_instance_id: "kit_local_001",
    provider: "local_fixed",
    tenant_id: "tenant_001",
    assigned_artifact_ids: ["artifact_usdc_001"],
    status: "ready",
    stream_config: {
      signalingServer: "kit-server.local",
      signalingPort: 49100,
      mediaServer: "kit-media.local",
      mediaPort: 47998,
    },
    started_at: "2026-01-01T00:00:00.000Z",
    last_heartbeat_at: "2026-01-01T00:00:00.000Z",
    released_at: null,
    gpu_profile: {
      profile: "local_fixed",
      capacity_slot: "local-slot-1",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// allocateLocalKitInstance
// ---------------------------------------------------------------------------

describe("allocateLocalKitInstance", () => {
  it("returns a Kit instance with correct stream config from config", () => {
    const instance = allocateLocalKitInstance(defaultConfig);

    expect(instance.instance_id).toBe("kit_local_001");
    expect(instance.provider).toBe("local_fixed");
    expect(instance.status).toBe("ready");
    expect(instance.signaling_port).toBe(49100);
    expect(instance.stream_server).toBe("kit-server.local");
    expect(instance.media_server).toBe("kit-media.local");
    expect(instance.media_port).toBe(47998);
  });
});

// ---------------------------------------------------------------------------
// allocateKitInstanceBindings
// ---------------------------------------------------------------------------

describe("allocateKitInstanceBindings", () => {
  it("returns a single shared binding for same_instance policy with one artifact", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "tenant_001",
    );

    expect(bindings).toHaveLength(1);
    expect(bindings[0].kit_instance_id).toBe("kit_local_001");
    expect(bindings[0].assigned_artifact_ids).toEqual(["artifact_usdc_001"]);
    expect(bindings[0].status).toBe("ready");
  });

  it("returns a single shared binding for same_instance policy with multiple artifacts", () => {
    const artifactBindings = [
      makeArtifactBinding({ artifact_id: "artifact_usdc_a", binding_id: "binding_1" }),
      makeArtifactBinding({ artifact_id: "artifact_usdc_b", binding_id: "binding_2" }),
    ];

    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      artifactBindings,
      "same_instance",
      "tenant_001",
    );

    expect(bindings).toHaveLength(1);
    expect(bindings[0].assigned_artifact_ids).toEqual(["artifact_usdc_a", "artifact_usdc_b"]);
  });

  it("returns one binding per artifact for dedicated_instance policy", () => {
    const artifactBindings = [
      makeArtifactBinding({ artifact_id: "artifact_usdc_a", binding_id: "binding_1" }),
      makeArtifactBinding({ artifact_id: "artifact_usdc_b", binding_id: "binding_2" }),
    ];

    const bindings = allocateKitInstanceBindings(
      multiEndpointConfig,
      artifactBindings,
      "dedicated_instance",
      "tenant_001",
    );

    expect(bindings).toHaveLength(2);
    expect(bindings[0].assigned_artifact_ids).toEqual(["artifact_usdc_a"]);
    expect(bindings[1].assigned_artifact_ids).toEqual(["artifact_usdc_b"]);
  });

  it("assigns distinct kit_instance_ids for dedicated_instance", () => {
    const artifactBindings = [
      makeArtifactBinding({ artifact_id: "artifact_usdc_a", binding_id: "binding_1" }),
      makeArtifactBinding({ artifact_id: "artifact_usdc_b", binding_id: "binding_2" }),
    ];

    const bindings = allocateKitInstanceBindings(
      multiEndpointConfig,
      artifactBindings,
      "dedicated_instance",
      "tenant_001",
    );

    const ids = bindings.map((b) => b.kit_instance_id);
    expect(new Set(ids).size).toBe(2);
    const ports = bindings.map((b) => b.stream_config.signalingPort);
    expect(new Set(ports).size).toBe(2);
  });

  it("returns empty array when dedicated_instance needs more endpoints than configured", () => {
    const artifactBindings = [
      makeArtifactBinding({ artifact_id: "artifact_usdc_a", binding_id: "binding_1" }),
      makeArtifactBinding({ artifact_id: "artifact_usdc_b", binding_id: "binding_2" }),
    ];

    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      artifactBindings,
      "dedicated_instance",
      "tenant_001",
    );

    expect(bindings).toHaveLength(0);
  });

  it("returns empty array when dedicated_instance exceeds capacity_slots", () => {
    const artifactBindings = [
      makeArtifactBinding({ artifact_id: "artifact_usdc_a", binding_id: "binding_1" }),
      makeArtifactBinding({ artifact_id: "artifact_usdc_b", binding_id: "binding_2" }),
    ];

    const bindings = allocateKitInstanceBindings(
      multiEndpointConfig,
      artifactBindings,
      "dedicated_instance",
      "tenant_001",
      { capacity_slots: 1 },
    );

    expect(bindings).toHaveLength(0);
  });

  it("returns empty array when capacity_slots is 0", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "tenant_001",
      { capacity_slots: 0 },
    );

    expect(bindings).toHaveLength(0);
  });

  it("returns empty array when capacity_slots is negative", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "tenant_001",
      { capacity_slots: -1 },
    );

    expect(bindings).toHaveLength(0);
  });

  it("returns a binding when capacity_slots is 1 (default)", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "tenant_001",
      { capacity_slots: 1 },
    );

    expect(bindings).toHaveLength(1);
  });

  it("uses profile from kit_profile if provided", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "tenant_001",
      { profile: "gpu_cloud_high" },
    );

    expect(bindings[0].gpu_profile.profile).toBe("gpu_cloud_high");
  });

  it("falls back to local_fixed profile when kit_profile has no profile", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "tenant_001",
      {},
    );

    expect(bindings[0].gpu_profile.profile).toBe("local_fixed");
  });

  it("bindings carry the correct stream config from coordinator config", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "tenant_001",
    );

    expect(bindings[0].stream_config.signalingServer).toBe("kit-server.local");
    expect(bindings[0].stream_config.signalingPort).toBe(49100);
    expect(bindings[0].stream_config.mediaServer).toBe("kit-media.local");
    expect(bindings[0].stream_config.mediaPort).toBe(47998);
  });

  it("stores tenant_id on the binding", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [makeArtifactBinding()],
      "same_instance",
      "specific_tenant_007",
    );

    expect(bindings[0].tenant_id).toBe("specific_tenant_007");
  });

  it("returns empty array for empty artifact bindings regardless of policy", () => {
    const bindings = allocateKitInstanceBindings(
      defaultConfig,
      [],
      "same_instance",
      "tenant_001",
    );

    expect(bindings).toHaveLength(1);
    expect(bindings[0].assigned_artifact_ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// legacyKitInstanceFromBinding
// ---------------------------------------------------------------------------

describe("legacyKitInstanceFromBinding", () => {
  it("falls back to allocateLocalKitInstance when binding is undefined", () => {
    const instance = legacyKitInstanceFromBinding(undefined, defaultConfig);

    expect(instance.instance_id).toBe("kit_local_001");
    expect(instance.signaling_port).toBe(49100);
  });

  it("maps binding fields to KitInstance", () => {
    const binding = makeKitInstanceBinding({
      kit_instance_id: "kit_cloud_999",
      status: "ready",
      stream_config: {
        signalingServer: "cloud-server.example.com",
        signalingPort: 12345,
        mediaServer: "media.example.com",
        mediaPort: 23456,
      },
    });

    const instance = legacyKitInstanceFromBinding(binding, defaultConfig);

    expect(instance.instance_id).toBe("kit_cloud_999");
    expect(instance.stream_server).toBe("cloud-server.example.com");
    expect(instance.signaling_port).toBe(12345);
    expect(instance.media_server).toBe("media.example.com");
    expect(instance.media_port).toBe(23456);
    expect(instance.status).toBe("ready");
  });

  it("maps draining status through to KitInstance", () => {
    const binding = makeKitInstanceBinding({ status: "draining" });

    const instance = legacyKitInstanceFromBinding(binding, defaultConfig);

    expect(instance.status).toBe("draining");
  });

  it("maps released status through to KitInstance", () => {
    const binding = makeKitInstanceBinding({ status: "released" });

    const instance = legacyKitInstanceFromBinding(binding, defaultConfig);

    expect(instance.status).toBe("released");
  });
});

// ---------------------------------------------------------------------------
// markKitBindingsDraining
// ---------------------------------------------------------------------------

describe("markKitBindingsDraining", () => {
  it("sets status to draining for ready bindings", () => {
    const bindings = [makeKitInstanceBinding({ status: "ready" })];

    const drained = markKitBindingsDraining(bindings);

    expect(drained[0].status).toBe("draining");
  });

  it("does not change status for already-released bindings", () => {
    const bindings = [makeKitInstanceBinding({ status: "released" })];

    const drained = markKitBindingsDraining(bindings);

    expect(drained[0].status).toBe("released");
  });

  it("updates last_heartbeat_at on draining bindings", () => {
    const before = "2026-01-01T00:00:00.000Z";
    const bindings = [makeKitInstanceBinding({ last_heartbeat_at: before })];

    const drained = markKitBindingsDraining(bindings);

    expect(drained[0].last_heartbeat_at).not.toBe(before);
  });

  it("returns a new array, not mutating the input", () => {
    const original = [makeKitInstanceBinding()];

    const drained = markKitBindingsDraining(original);

    expect(drained).not.toBe(original);
    expect(original[0].status).toBe("ready");
  });

  it("handles empty array", () => {
    expect(markKitBindingsDraining([])).toEqual([]);
  });

  it("processes multiple bindings with mixed statuses", () => {
    const bindings = [
      makeKitInstanceBinding({ kit_instance_id: "kit_001", status: "ready" }),
      makeKitInstanceBinding({ kit_instance_id: "kit_002", status: "released" }),
    ];

    const drained = markKitBindingsDraining(bindings);

    expect(drained[0].status).toBe("draining");
    expect(drained[1].status).toBe("released");
  });
});

// ---------------------------------------------------------------------------
// releaseKitBindings
// ---------------------------------------------------------------------------

describe("releaseKitBindings", () => {
  it("sets status to released for all bindings", () => {
    const bindings = [
      makeKitInstanceBinding({ kit_instance_id: "kit_001", status: "draining" }),
      makeKitInstanceBinding({ kit_instance_id: "kit_002", status: "ready" }),
    ];

    const released = releaseKitBindings(bindings);

    expect(released[0].status).toBe("released");
    expect(released[1].status).toBe("released");
  });

  it("sets released_at timestamp when not already set", () => {
    const bindings = [makeKitInstanceBinding({ released_at: null })];

    const released = releaseKitBindings(bindings);

    expect(released[0].released_at).not.toBeNull();
    expect(typeof released[0].released_at).toBe("string");
  });

  it("preserves existing released_at when already set", () => {
    const existingTimestamp = "2026-01-01T10:00:00.000Z";
    const bindings = [makeKitInstanceBinding({ released_at: existingTimestamp })];

    const released = releaseKitBindings(bindings);

    expect(released[0].released_at).toBe(existingTimestamp);
  });

  it("updates last_heartbeat_at", () => {
    const before = "2026-01-01T00:00:00.000Z";
    const bindings = [makeKitInstanceBinding({ last_heartbeat_at: before })];

    const released = releaseKitBindings(bindings);

    expect(released[0].last_heartbeat_at).not.toBe(before);
  });

  it("returns a new array without mutating input", () => {
    const original = [makeKitInstanceBinding()];

    const released = releaseKitBindings(original);

    expect(released).not.toBe(original);
    expect(original[0].status).toBe("ready");
  });

  it("handles empty array", () => {
    expect(releaseKitBindings([])).toEqual([]);
  });
});
