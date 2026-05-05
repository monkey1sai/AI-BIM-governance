# bim-streaming-server — System Design

A design document for the GPU-backed WebRTC streaming service that hosts
NVIDIA Omniverse Kit BIM sessions for browser clients.

---

## 1. Context and scope

`bim-streaming-server` is one service in a larger BIM remote-collaboration
platform. It is the **runtime tier**: it loads USD scenes onto an RTX GPU,
renders the viewport headlessly, and streams the pixels over WebRTC to a
browser. A bidirectional DataChannel carries 12 JSON commands for stage
ops (open, select, focus, highlight overlay, etc.).

**This service does not own:**

- Source-format conversion (IFC → USD lives in `conversion-service`).
- Analysis results (clash / compliance / carbon live in
  `ai-rule-carbon-service`).
- Session lifecycle, queueing, auth, billing (lives in `coordinator`).
- Persistent business state. Each session is stateless and ephemeral.

**This service does own:**

- USD runtime (Kit + Hydra + RTX renderer).
- GPU session allocation within a single host.
- WebRTC peer connection + DataChannel command routing.
- Translating DataChannel JSON into Kit stage operations.

---

## 2. Functional requirements

| # | Capability |
|---|---|
| F1 | Accept a `start-session` directive from coordinator with a USD URL, session ID, and user ID. |
| F2 | Fetch USD/USDC from object storage via short-lived signed URL. |
| F3 | Open the stage in a Kit process and begin rendering. |
| F4 | Establish a WebRTC peer connection with the browser; negotiate ICE/DTLS. |
| F5 | Stream the viewport as H.264/H.265 video. |
| F6 | Accept and execute the 12 DataChannel command types. |
| F7 | Apply non-destructive highlight overlays sourced from analysis payloads. |
| F8 | Tear down session cleanly on browser disconnect, idle timeout, or coordinator command. |
| F9 | Report health, capacity, and session metrics back to coordinator. |

---

## 3. Non-functional requirements

| Dimension | Target | Notes |
|---|---|---|
| Concurrent sessions | 100–500 peak, headroom to 1k | Derived from "1k–10k users" with 5–10% concurrency typical for design-review workloads. |
| DataChannel round-trip | p95 < 100ms (intra-region) | Camera/select must feel local. |
| Video glass-to-glass | p95 < 250ms | WebRTC budget; depends on TURN path. |
| Stage open latency | p95 < 5s for ≤1GB USD | Cold load. Warm cache <1s. |
| Availability | 99.5% per region | Each session is recoverable, not durable — a crash means reconnect, not data loss. |
| Cost ceiling | GPU hours dominate | Must run >1 session per GPU when scenes allow. |

**Scale math.** Assume:

- Average USD payload ~500MB resident, peak 2GB.
- A10G / L4-class GPU: 24GB VRAM → 4–8 concurrent Kit sessions per GPU.
- 500 peak concurrent sessions ÷ 6 per GPU ≈ **~85 GPU instances at peak**.

This is the budget that drives every other choice below.

---

## 4. Assumptions

1. The coordinator is the single source of truth for who can start a
   session, against which scene, and for how long.
2. USD assets are immutable per `(asset_id, version)` — safe to cache.
3. Highlight overlay payloads are smaller than the USD itself
   (analysis results are metadata + prim paths, not geometry).
4. Browser clients are on reasonable internet (we will not optimize for
   cellular below 5 Mbps).
5. We control deployment of Kit container images; no end-user installs.
6. One Kit process = one stage = one user session.
   (Cleaner failure isolation than multi-stage Kit hosts.)

---

## 5. High-level architecture

```
                        ┌─────────────────────────────────┐
                        │  Browser (web-viewer-sample)    │
                        │  React + WebRTC + DataChannel   │
                        └──────────────┬──────────────────┘
                                       │ WebRTC media + DC
                                       │ (TURN if needed)
                                       ▼
   ┌─────────────────┐         ┌─────────────────────────────┐
   │   Coordinator   │◀───────▶│   bim-streaming-server      │
   │  (REST + WS)    │  ctl    │   (one host)                │
   └────────┬────────┘         │                             │
            │                  │  ┌───────────────────────┐  │
            │                  │  │  Session manager      │  │
            ▼                  │  │  (Node/TS, control)   │  │
   ┌─────────────────┐         │  └─────────┬─────────────┘  │
   │ ai-rule-carbon  │         │            │                │
   │   (overlays)    │         │  ┌─────────▼─────────────┐  │
   └─────────────────┘         │  │  Kit worker pool      │  │
                               │  │  (Python/Kit, N procs)│  │
   ┌─────────────────┐         │  │  WebRTC + USD runtime │  │
   │ conversion-svc  │         │  └─────────┬─────────────┘  │
   │   (IFC → USD)   │         │            │                │
   └────────┬────────┘         │  ┌─────────▼─────────────┐  │
            │                  │  │  USD cache (local SSD)│  │
            ▼                  │  └───────────────────────┘  │
   ┌─────────────────┐         └────────────┬────────────────┘
   │  S3 / MinIO     │                      │
   │  (USD assets)   │◀─────signed URL──────┘
   └─────────────────┘
```

Two processes per host:

- **Session manager** (Node.js / TypeScript). Owns the control plane: REST
  to coordinator, lifecycle, GPU slot bookkeeping, metrics, USD cache
  policy. Light, async, no GPU dependency.
- **Kit workers** (Python via Omniverse Kit). One process per session.
  Spawned by the manager, each binds a GPU slice, opens its stage, runs
  the WebRTC pipeline, and exits when the session ends.

The split keeps the heavy GPU process pure (only renders + streams) and
puts all the orchestration logic in a stack the team can iterate on
quickly.

---

## 6. Component responsibilities

### Session manager (Node.js / TS)

- gRPC or WS to coordinator for `start_session`, `stop_session`, health.
- Maintains an in-memory map of slot → worker PID → session ID.
- Spawns Kit workers via subprocess; restarts on crash within budget.
- Front-runs USD fetch: pulls signed URL, downloads to local cache,
  hands the local path to the worker. Saves the worker from repeating
  the network step.
- Emits OpenTelemetry metrics + structured logs.
- Exposes a /capacity endpoint coordinator polls for routing.

### Kit worker (Python)

- Loads the supplied USD path.
- Initializes Hydra + RTX renderer.
- Establishes the WebRTC peer connection (offer/answer relayed via the
  manager → coordinator → browser, or direct via signaling WS).
- Decodes DataChannel JSON, dispatches to a small command handler
  registry (one function per command type).
- Pushes telemetry (FPS, frame latency, VRAM) to the manager over a
  local Unix socket.

### Coordinator (out of scope but contractually relevant)

- Owns auth, queue, scene resolution.
- Decides which streaming-server host to route a new session to based on
  /capacity.
- Receives lifecycle webhooks: `session_ready`, `session_ended`,
  `session_failed`.

---

## 7. Session lifecycle

```
Browser    Coordinator    SessionMgr     KitWorker     S3
  │             │              │              │           │
  │── start ──▶ │              │              │           │
  │             │── alloc ───▶ │              │           │
  │             │              │── fetch ──────────────▶ │
  │             │              │◀── usd ────────────────│
  │             │              │── spawn ──▶ │           │
  │             │              │             │── load ─▶ │ (cached)
  │             │◀── ready ────│             │           │
  │◀── ice/sdp ─│              │             │           │
  │═══════════ WebRTC offer/answer ════════▶ │           │
  │═══════════ media + DataChannel ═════════ │           │
  │             │              │             │           │
  │── close ──────────────────────────────▶  │           │
  │             │              │◀── ended ── │           │
  │             │◀── ended ────│             │           │
```

Notable choices:

- **USD download is in the manager, not the worker.** Lets the manager
  warm the cache, dedupe parallel requests for the same asset, and bail
  early if the scene is missing without burning a GPU spin-up.
- **Signaling is relayed through coordinator**, not direct browser ↔
  worker. Coordinator already owns auth; this avoids reauthing inside
  the worker and keeps STUN/TURN configuration centralized.

---

## 8. DataChannel protocol

Twelve commands, JSON. Recommended envelope:

```json
{
  "v": 1,
  "id": "c-7f2a",          // client-generated, echoed in ack
  "type": "select.prims",
  "ts": 1714780000123,
  "payload": { "prim_paths": ["/World/Building/Wall_007"] }
}
```

Rules:

- **Versioned envelope (`v`)** so the worker can refuse incompatible
  clients cleanly instead of crashing on an unknown field.
- **Client `id` round-trips** so the browser can correlate
  acknowledgments and tag user-facing actions.
- **Commands are idempotent or naturally last-write-wins.** Camera
  focus, selection, overlay show/hide all collapse cleanly.
- **No fan-out broadcasts inside the worker.** Multi-user sessions, if
  ever needed, belong to a separate "session router" service — keep this
  worker single-tenant.
- **Strict schema validation** on the worker side (pydantic). Reject and
  log; do not let malformed JSON reach Kit's USD APIs.

A small command-handler registry keeps the dispatch loop boring:

```python
HANDLERS = {
  "stage.open":      handle_stage_open,
  "scene.tree":      handle_scene_tree,
  "select.prims":    handle_select_prims,
  "camera.focus":    handle_camera_focus,
  "overlay.apply":   handle_overlay_apply,
  ...
}
```

---

## 9. GPU and capacity

**Slot model.** Each host advertises N slots based on `min(VRAM /
per_session_VRAM, vCPU / per_session_vCPU)`. The manager refuses
allocations beyond N. Coordinator polls `/capacity` for routing; this
is a simple integer, not a load score — keep it dumb.

**Per-session VRAM ceiling.** Reserve a hard cap (e.g. 3GB) and abort
the session with a typed error if Kit exceeds it. This protects
neighbours on the same GPU. This is the most important reliability
control on a multi-tenant GPU host.

**Cold start vs warm pool.** Three options worth weighing:

| Strategy | Pros | Cons |
|---|---|---|
| Spawn worker per request | Simplest. No idle cost. | 2–5s spawn + Kit init on every session start. |
| Warm pool of idle Kit processes | Sub-second session start. | Idle GPU/CPU cost; pool sizing is a tuning headache. |
| Single Kit process, multi-stage | Best GPU utilization. | Crash blast radius = N users. Kit's multi-stage story is fragile. |

**Recommendation.** Start with **spawn-per-request** plus a small
warm pool (2–3 idle workers) per host to absorb burst arrivals. Revisit
once you have real arrival-rate data. Multi-stage-per-Kit is a "year
two" optimization and only if a benchmark shows it's worth the
fault-isolation cost.

---

## 10. WebRTC and networking

- **Codec.** H.264 baseline by default for browser compatibility; HEVC as
  an opt-in flag once you confirm the client side supports it. Don't ship
  AV1 yet — encode cost on RTX is fine but client decode varies.
- **TURN.** Mandatory. ~20–30% of corporate clients will fail
  peer-direct; budget for relay. Provision a dedicated TURN cluster, do
  not piggyback on a shared one.
- **Signaling.** Re-use the coordinator's existing WebSocket; do not
  open a second control channel.
- **ICE restart.** Needed for laptop network changes (wifi ↔ ethernet
  ↔ wifi). Must be supported in the worker; clients in BIM review
  sessions are often in-office and will roam.
- **Bandwidth caps.** Default 5 Mbps target with simulcast at 720p/1080p.
  Don't ship 4K until a customer actually asks; the encode cost is real.

---

## 11. USD loading and caching

- **Local SSD cache** keyed by `(asset_id, version)`. Immutable assets
  → cache forever, evict by LRU when disk is full.
- **Singleflight downloads.** If two sessions land on the same host for
  the same asset within seconds, only one fetch hits S3.
- **Pre-fetch on the manager**, not the worker. Manager streams to disk
  while spawning the Kit worker; by the time Kit needs the file, it's
  local.
- **Layered USD.** Honor USD references; don't try to flatten assets
  client-side. Let Hydra handle composition.
- **Overlay payloads** are fetched lazily on first `overlay.apply`
  command — not at stage open. This keeps cold-start fast and lets the
  user start panning while overlays load.

---

## 12. Reliability and failure modes

| Failure | Detection | Response |
|---|---|---|
| Kit worker crash | SIGCHLD on manager | Tear down session, `session_failed` to coordinator, do **not** auto-restart in place — let coordinator decide whether to retry. |
| GPU OOM | Manager telemetry over Unix socket | Kill worker, free slot, mark session `failed:vram`. |
| USD fetch 404 / signature expired | Manager pre-fetch step | Fast-fail without spawning worker; emit typed error. |
| WebRTC ICE failure | Worker reports timeout | Try ICE restart once, then end session. |
| Idle session (no DC traffic, paused video) | Worker timer | Configurable timeout (default 15min) → graceful end. |
| Host hardware fault | K8s liveness fails | Drain remaining sessions, mark cordoned, replace. |

**Crucial rule:** the worker is the boundary of failure. Manager survives
worker crashes; host survives manager crashes (systemd restart, crashes
are reported as host-degraded to coordinator).

---

## 13. Observability

- **Per-session metrics:** stage open ms, FPS, encoder queue depth,
  DC RTT, VRAM, session duration.
- **Per-host metrics:** active slots, free slots, USD cache hit rate,
  TURN-relay rate, worker crash count.
- **Tracing.** Span session start across coordinator → manager →
  worker; tag with `session_id`, `asset_id`, `user_id`. The vast majority
  of bug reports will be "session X felt slow"; you need to be able to
  load that span and see where the time went.
- **Logs structured JSON, ship to wherever the rest of the platform
  ships.** Don't reinvent.

---

## 14. Scaling strategy

- **Horizontal across hosts.** Each host is independent; coordinator
  picks a host with free slots. Add hosts to add capacity. No shared
  state across hosts.
- **Regional sharding.** TURN/streaming latency dictates this — at
  ~100–500 concurrent global users, run at least US + EU. Coordinator
  picks region by client IP.
- **Auto-scaling signal.** "Slot utilization > 70% for 5 min" → add a
  host. Be conservative scaling **down** — Kit warm-up costs make
  thrashing expensive. 30+ minutes of low utilization before scale-down.

---

## 15. Trade-offs and open questions

- **One Kit process per session vs multi-stage Kit host.** Chose
  per-session for blast-radius isolation; concedes ~1.5–2× GPU cost
  versus a hypothetical multi-stage host. Revisit once you have a
  reliability budget.
- **Manager in Node, workers in Python.** Two languages is friction.
  Justification: the coordinator integration and async I/O is more
  natural in TS, and Kit is Python-only. The boundary is narrow (Unix
  socket + subprocess), so the cost is bounded.
- **Cache USD on local SSD, not a shared object cache.** Simpler,
  faster, and immutable assets make duplication acceptable. If asset
  catalog grows past local SSD budgets, revisit with a CDN edge cache.
- **No multi-user-per-session.** Single-tenant sessions only. If true
  collab (multiple cursors in one stage) is ever required, that is a
  separate "session router" service in front of these workers — do not
  bolt it onto the worker.
- **Open: highlight overlay protocol.** Are overlays shipped as full
  prim-path lists per category, or as deltas? Deltas are smaller but
  add ordering complexity. Default to full snapshots until size hurts.
- **Open: codec strategy.** When/if to enable HEVC or AV1 — needs
  per-client capability detection and a fallback, currently deferred.

---

## 16. What I'd revisit at growth milestones

| Milestone | Revisit |
|---|---|
| 50 concurrent | Validate slot model with real workloads; tune warm-pool size. |
| 200 concurrent | Look at multi-stage Kit feasibility; benchmark vs current. |
| Cross-region | Coordinator routing logic, TURN topology, USD cache regional placement. |
| 1k concurrent | Per-tenant rate limits, fairness scheduling on the coordinator. |
| Long sessions (hours) | Idle frame rate downscaling, encoder bitrate adaptation. |
