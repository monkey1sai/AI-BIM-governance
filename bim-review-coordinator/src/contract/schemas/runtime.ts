// Coordinator Browser Contract — GET /api/runtime/status (read-only runtime observations).
import { z } from "zod/v4";
import type { KitRuntimeHealthEntry } from "../../services/kitRuntimeHealth.js";
import type { Equal, Expect } from "../typecheck.js";
import { isoTimestamp, named, sessionStatus } from "../primitives.js";
import { ifcReadySummary } from "./ifcReady.js";
import { artifactHealthSnapshot, kitStreamConfig } from "./sessions.js";
import { publicViewerLease } from "./viewerLeases.js";

export const kitRuntimeHealthEntry = named("KitRuntimeHealthEntry", z.strictObject({
  kit_instance_id: z.string(),
  media_state: z.enum(["ok", "suspect", "unknown"]),
  source: z.literal("viewer_lease_evidence"),
  detail: z.string(),
  no_first_frame_streak: z.number(),
  qualifying_lease_count: z.number(),
  last_first_frame_at: isoTimestamp.nullable(),
  evidence_lease_ids: z.array(z.string()),
}));
export type _KitRuntimeHealthEntry = Expect<Equal<z.output<typeof kitRuntimeHealthEntry>, KitRuntimeHealthEntry>>;

export const stageOpenEvidence = named("StageOpenEvidence", z.strictObject({
  state: z.enum(["not_requested", "open", "blocked", "requested", "not_observed"]),
  source: z.enum(["coordinator", "viewer_lease"]),
  detail: z.string(),
  expected_stage_url: z.string().nullable(),
  loaded_stage_url: z.string().nullable(),
  datachannel_ready: z.boolean(),
  first_frame_at: isoTimestamp.nullable(),
}));

export const runtimeSessionSummary = named("RuntimeSessionSummary", z.strictObject({
  session_id: z.string(),
  status: sessionStatus,
  ready_model_id: z.string().nullable(),
  project_id: z.string(),
  model_version_id: z.string(),
  participant_count: z.number(),
  participants: z.array(z.strictObject({
    user_id: z.string(),
    display_name: z.string().nullable(),
    last_seen_at: isoTimestamp,
  })),
  expected_stage_url: z.string().nullable(),
  expected_mapping_url: z.string().nullable(),
  conversion_job_id: z.string().nullable(),
  conversion_status: z.string().nullable(),
  kit_instance_ids: z.array(z.string()),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
  first_frame_at: isoTimestamp.nullable(),
  stage_open_state: z.enum(["not_requested", "open", "blocked", "requested", "not_observed"]),
  stage_open_evidence: stageOpenEvidence,
  artifact_health: artifactHealthSnapshot.nullable(),
  primary_viewer_lease_id: z.string().nullable(),
  primary_viewer_user_id: z.string().nullable(),
  viewer_leases: z.array(publicViewerLease),
}));

export const runtimeStatusResponse = named("RuntimeStatusResponse", z.strictObject({
  service: z.strictObject({
    status: z.literal("ok"),
    name: z.literal("bim-review-coordinator"),
    uptime_seconds: z.number(),
    generated_at: isoTimestamp,
  }),
  configured_endpoints: z.strictObject({
    coordinator: z.strictObject({
      host: z.string(),
      port: z.number(),
      public_host: z.string(),
      public_base_url: z.string(),
    }),
    viewer: z.strictObject({
      browser_url_base: z.string(),
      handoff_path: z.literal("/ui/open?session=<review_session_id>"),
      coordinator_api_base: z.string(),
      coordinator_socket_url: z.string(),
    }),
    conversion_authority: z.strictObject({
      base_url: z.string(),
      authority: z.literal("bim-streaming-server"),
    }),
    kit: z.array(z.strictObject({
      id: z.string(),
      signalingServer: z.string(),
      signalingPort: z.number(),
      mediaServer: z.string(),
      mediaPort: z.number().nullable(),
    })),
  }),
  sessions: z.strictObject({
    count: z.number(),
    active_count: z.number(),
    participant_count: z.number(),
    items: z.array(runtimeSessionSummary),
  }),
  kit_runtime_health: z.array(kitRuntimeHealthEntry),
  kit_instance_bindings: z.array(z.strictObject({
    session_id: z.string(),
    kit_instance_id: z.string(),
    status: z.enum(["allocated", "starting", "ready", "draining", "released", "failed"]),
    binding_intent: z.literal("capacity_allocated"),
    assigned_artifact_ids: z.array(z.string()),
    stream_config: kitStreamConfig,
    started_at: isoTimestamp,
    last_heartbeat_at: isoTimestamp,
    released_at: isoTimestamp.nullable(),
  })),
  ifc_ready_jobs: z.strictObject({
    count: z.number(),
    recent: z.array(ifcReadySummary),
  }),
  observations: z.strictObject({
    classification: z.literal("coordinator_visible_runtime_summary"),
    note: z.string(),
    web_plane: z.strictObject({
      coordinator_port: z.number(),
      viewer_port: z.number(),
    }),
    host_native_plane: z.strictObject({
      conversion_api_base: z.string(),
      kit_signal_ports: z.array(z.number()),
      kit_media_ports: z.array(z.number()),
    }),
  }),
}), "GET /api/runtime/status — coordinator-visible runtime summary; Kit-internal state needs DataChannel evidence.");
