# Critical Points

- [ ] CP1: Coordinator `/ui/open?session=` redirects to the configured browser-visible viewer URL and ignores a caller-supplied `redirect=` target.
- [ ] CP2: The viewer handoff URL carries `session`, `coordinatorApiBase`, and `coordinatorSocketUrl` so a LAN client does not have to call its own loopback coordinator.
- [ ] CP3: Two browser pages bootstrap the same `review_session_id` with distinct viewer identities.
- [ ] CP4: Coordinator runtime/session evidence records both viewers as participants on the same session.
- [ ] CP5: Per-viewer screenshots and a structured report are written under `final_runs/run_<id>/`.
- [ ] CP6: WebRTC video readiness is classified separately from handoff/bootstrap evidence, so lack of a live Kit runtime is reported as blocked rather than passed.
