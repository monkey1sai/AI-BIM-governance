import type { CoordinatorConfig } from "./config.js";
import type {
  Artifact,
  ArtifactBinding,
  KitInstanceBinding,
  ReviewSession,
  RoutingPolicy,
  StreamConfigResponse,
} from "./types.js";

type ArtifactBindingInput =
  Pick<ArtifactBinding, "artifact_group_id" | "artifact_id" | "artifact_role" | "load_order" | "ready_status">
  & Partial<Omit<ArtifactBinding, "artifact_group_id" | "artifact_id" | "artifact_role" | "load_order" | "ready_status">>;


export function chooseReadyUsdc(artifacts: Artifact[]): Artifact | undefined {
  return artifacts.find((artifact) => artifact.artifact_type === "usdc" && artifact.status === "ready" && artifact.url);
}
function artifactReadyStatus(artifact: Artifact): ArtifactBinding["ready_status"] {
  if (artifact.conversion_authority === "bim-streaming-server") {
    const status = artifact.conversion_status || artifact.status;
    if (status === "queued" || status === "running" || status === "converting") return "converting";
    if (status === "failed") return "failed";
    if (status === "blocked") return "blocked_conversion";
  }
  if (artifact.artifact_type === "usdc" && artifact.status === "ready" && !artifact.mapping_url) return "missing_mapping";
  return artifact.status === "ready" ? "ready" : "missing_model";
}

export function buildArtifactBindings(
  modelVersionId: string,
  artifacts: Artifact[],
  inputBindings: ArtifactBindingInput[],
  routingPolicy: RoutingPolicy,
): ArtifactBinding[] {
  if (inputBindings.length > 0) {
    return inputBindings
      .slice()
      .sort((left, right) => left.load_order - right.load_order)
      .map((binding, index) => ({
        binding_id: binding.binding_id || `binding_${index + 1}`,
        artifact_group_id: binding.artifact_group_id,
        model_version_id: binding.model_version_id || modelVersionId,
        artifact_id: binding.artifact_id,
        display_name: binding.display_name || null,
        source_ifc_filename: binding.source_ifc_filename || null,
        artifact_role: binding.artifact_role,
        url: binding.url || null,
        mapping_url: binding.mapping_url || null,
        load_order: binding.load_order,
        routing_policy: binding.routing_policy || routingPolicy,
        ready_status: binding.ready_status,
        conversion_authority: binding.conversion_authority || null,
        conversion_job_id: binding.conversion_job_id || null,
        conversion_status: binding.conversion_status || null,
        failure_code: binding.failure_code || null,
        diagnostic: binding.diagnostic || null,
      }));
  }

  return artifacts
    .filter((artifact) => (artifact.status === "ready" && artifact.url) || artifact.conversion_authority === "bim-streaming-server")
    .map((artifact, index) => ({
      binding_id: `binding_${index + 1}`,
      artifact_group_id: `ag_${modelVersionId}`,
      model_version_id: modelVersionId,
      artifact_id: artifact.artifact_id,
      artifact_role: artifact.artifact_type === "usdc" ? "derived" : "source",
      url: artifact.url || null,
      mapping_url: artifact.mapping_url || null,
      load_order: index,
      routing_policy: routingPolicy,
      ready_status: artifactReadyStatus(artifact),
      conversion_authority: artifact.conversion_authority || null,
      conversion_job_id: artifact.conversion_job_id || null,
      conversion_status: artifact.conversion_status || artifact.status || null,
      failure_code: artifact.failure_code || null,
      diagnostic: artifact.diagnostic || null,
    }));
}

function chooseReadyBinding(bindings: ArtifactBinding[]): ArtifactBinding | undefined {
  return bindings.find((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && binding.url);
}

function orderedLoadableDerivedBindings(bindings: ArtifactBinding[]): ArtifactBinding[] {
  return bindings
    .filter((binding) => binding.artifact_role === "derived" && binding.ready_status === "ready" && Boolean(binding.url))
    .slice()
    .sort((left, right) => left.load_order - right.load_order);
}

function chooseStreamingStatusBinding(bindings: ArtifactBinding[]): ArtifactBinding | undefined {
  return bindings.find(
    (binding) =>
      binding.artifact_role === "derived" &&
      binding.conversion_authority === "bim-streaming-server" &&
      ["converting", "failed", "blocked_conversion"].includes(binding.ready_status),
  );
}

function modelStatusFromBinding(binding: ArtifactBinding | undefined, readyUsdc: Artifact | undefined): StreamConfigResponse["model"]["status"] {
  if (!binding) return readyUsdc ? "ready" : "missing";
  if (binding.ready_status === "ready") return "ready";
  if (binding.ready_status === "converting") return "converting";
  if (binding.ready_status === "failed") return "failed";
  if (binding.ready_status === "blocked_conversion") return "blocked";
  return readyUsdc ? "ready" : "missing";
}

function isLoopbackHost(host: string | null | undefined): boolean {
  const normalized = (host || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function streamConfigWithRuntimeOverride(
  stored: KitInstanceBinding["stream_config"] | undefined,
  config: CoordinatorConfig,
): KitInstanceBinding["stream_config"] {
  const signalingServer =
    stored?.signalingServer && !(isLoopbackHost(stored.signalingServer) && !isLoopbackHost(config.kitStreamServer))
      ? stored.signalingServer
      : config.kitStreamServer;
  const mediaServer =
    stored?.mediaServer && !(isLoopbackHost(stored.mediaServer) && !isLoopbackHost(config.kitMediaServer))
      ? stored.mediaServer
      : config.kitMediaServer;

  return {
    signalingServer,
    signalingPort: stored?.signalingPort || config.kitSignalingPort,
    mediaServer,
    mediaPort: stored?.mediaPort ?? config.kitMediaPort,
  };
}

function sameStreamEndpoint(
  left: KitInstanceBinding["stream_config"],
  right: KitInstanceBinding["stream_config"],
): boolean {
  return left.signalingServer === right.signalingServer
    && left.signalingPort === right.signalingPort
    && left.mediaServer === right.mediaServer
    && (left.mediaPort ?? null) === (right.mediaPort ?? null);
}

export function runtimeKitInstanceBindings(session: ReviewSession, config: CoordinatorConfig): KitInstanceBinding[] {
  const persisted = session.kit_instance_bindings.map((binding) => ({
    ...binding,
    stream_config: streamConfigWithRuntimeOverride(binding.stream_config, config),
  }));
  const primaryBinding = persisted[0];
  if (!primaryBinding || session.mode !== "single_kit_shared_state") {
    return persisted;
  }

  const existingEndpoints = new Set(persisted.map((binding) => {
    const stream = binding.stream_config;
    return `${stream.signalingServer}:${stream.signalingPort}:${stream.mediaServer}:${stream.mediaPort ?? ""}`;
  }));
  const spectatorEndpoints = config.kitInstanceEndpoints
    .filter((endpoint) => endpoint.id !== primaryBinding.kit_instance_id)
    .map((endpoint) => ({
      id: endpoint.id,
      stream_config: streamConfigWithRuntimeOverride({
        signalingServer: endpoint.signalingServer,
        signalingPort: endpoint.signalingPort,
        mediaServer: endpoint.mediaServer,
        mediaPort: endpoint.mediaPort,
      }, config),
    }))
    .filter((endpoint) => !sameStreamEndpoint(endpoint.stream_config, primaryBinding.stream_config))
    .filter((endpoint) => {
      const stream = endpoint.stream_config;
      const key = `${stream.signalingServer}:${stream.signalingPort}:${stream.mediaServer}:${stream.mediaPort ?? ""}`;
      if (existingEndpoints.has(key)) return false;
      existingEndpoints.add(key);
      return true;
    });

  return [
    ...persisted,
    ...spectatorEndpoints.map((endpoint, index) => ({
      ...primaryBinding,
      kit_instance_id: endpoint.id,
      stream_config: endpoint.stream_config,
      gpu_profile: {
        profile: primaryBinding.gpu_profile.profile,
        capacity_slot: `same-kit-spectator-${index + 1}`,
      },
    })),
  ];
}

export function buildStreamConfig(session: ReviewSession, artifacts: Artifact[], config: CoordinatorConfig): StreamConfigResponse {
  const artifactBindings =
    session.artifact_bindings.length > 0
      ? session.artifact_bindings
      : buildArtifactBindings(session.model_version_id, artifacts, [], "same_instance");
  const readyBinding = chooseReadyBinding(artifactBindings);
  const statusBinding = readyBinding ?? chooseStreamingStatusBinding(artifactBindings);
  const readyUsdc = chooseReadyUsdc(artifacts);
  const kitInstanceBindings = runtimeKitInstanceBindings(session, config);
  const primaryKitBinding = kitInstanceBindings[0];
  const spectatorReady = primaryKitBinding
    ? kitInstanceBindings.some((binding) => !sameStreamEndpoint(binding.stream_config, primaryKitBinding.stream_config))
    : false;
  const modelBinding = statusBinding;
  const loadableDerivedBindings = orderedLoadableDerivedBindings(artifactBindings);
  const primaryStageBinding = loadableDerivedBindings[0] ?? readyBinding ?? null;
  const secondaryStageBindings = loadableDerivedBindings.slice(1);
  return {
    session_id: session.session_id,
    lifecycle_status: session.status,
    source: "local_fixed",
    webrtc: {
      signalingServer: primaryKitBinding?.stream_config.signalingServer || config.kitStreamServer,
      signalingPort: primaryKitBinding?.stream_config.signalingPort || config.kitSignalingPort,
      mediaServer: primaryKitBinding?.stream_config.mediaServer || config.kitMediaServer,
      mediaPort: primaryKitBinding?.stream_config.mediaPort ?? config.kitMediaPort,
    },
    model: {
      status: modelStatusFromBinding(modelBinding, readyUsdc),
      artifact_id: modelBinding?.artifact_id || readyUsdc?.artifact_id || null,
      url: modelBinding?.url || readyUsdc?.url || null,
      mapping_url: modelBinding?.mapping_url || readyUsdc?.mapping_url || null,
      conversion_authority: modelBinding?.conversion_authority || readyUsdc?.conversion_authority || null,
      conversion_job_id: modelBinding?.conversion_job_id || readyUsdc?.conversion_job_id || null,
      conversion_status: modelBinding?.conversion_status || readyUsdc?.conversion_status || null,
      failure_code: modelBinding?.failure_code || readyUsdc?.failure_code || null,
      diagnostic: modelBinding?.diagnostic || readyUsdc?.diagnostic || null,
    },
    artifacts,
    artifact_bindings: artifactBindings,
    kit_instance_bindings: kitInstanceBindings,
    quality_metrics_summary: session.quality_metrics_summary ?? null,
    artifact_health: session.artifact_health ?? null,
    stage_composition: {
      applied_policy: "coordinator_load_order",
      primary_artifact_id: primaryStageBinding?.artifact_id || null,
      secondary_artifact_ids: secondaryStageBindings.map((binding) => binding.artifact_id),
      primary: primaryStageBinding,
      secondary_layers: secondaryStageBindings,
    },
    viewport_sharing: {
      mode: session.mode,
      primary_kit_instance_id: primaryKitBinding?.kit_instance_id || null,
      shared_state: session.mode === "single_kit_shared_state" || kitInstanceBindings.length <= 1,
      spectator_ready: spectatorReady,
    },
  };
}
