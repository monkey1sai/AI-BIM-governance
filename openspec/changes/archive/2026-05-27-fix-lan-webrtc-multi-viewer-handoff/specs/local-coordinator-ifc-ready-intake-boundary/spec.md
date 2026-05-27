## MODIFIED Requirements

### Requirement: Coordinator provides /ui/open redirect for viewer entry

The coordinator SHALL provide viewer entry URLs and runtime status that make the host/browser boundary explicit. `GET /ui/open?session=` MAY still redirect to the browser-visible viewer URL, but `/ui/open` MUST NOT hard-code `127.0.0.1` when the viewer is intended for a LAN or remote client. The redirect target SHALL be built from trusted coordinator configuration, not from an arbitrary query-supplied redirect URL.

The coordinator SHALL support a configured `VIEWER_PUBLIC_BASE_URL` for the browser-visible viewer origin. If `VIEWER_PUBLIC_BASE_URL` is unset, the coordinator MAY derive the viewer origin from `PUBLIC_HOST` and `VIEWER_PORT`, falling back to localhost only for local development. The generated viewer URL SHALL include the validated `session` value and enough coordinator endpoint information for `web-viewer-sample` to call the same coordinator host that produced the handoff.

#### Scenario: UI exposes expected viewer handoff

- **WHEN** a conversion-ready job has a review session
- **THEN** `/ui` displays the coordinator URL, the browser-visible viewer URL, the expected stage URL, and the Kit endpoint
- **AND** it warns when the expected stage URL has not yet been proven as loaded by Kit

#### Scenario: LAN handoff does not redirect to client loopback

- **WHEN** `VIEWER_PUBLIC_BASE_URL` is configured as `http://192.168.10.105:5173` and a browser calls `GET /ui/open?session=<review_session_id>`
- **THEN** the coordinator responds with a redirect whose `Location` origin is `http://192.168.10.105:5173`
- **AND** the redirect target MUST NOT contain `http://127.0.0.1:5173` or `http://localhost:5173`

#### Scenario: Handoff carries coordinator endpoint for the viewer

- **WHEN** the coordinator redirects to `web-viewer-sample`
- **THEN** the redirect target includes `session=<review_session_id>`
- **AND** it includes a browser-visible coordinator API base and Socket.IO base derived from trusted coordinator configuration
- **AND** a remote client MUST NOT need to guess or rewrite `127.0.0.1:8004`

#### Scenario: Redirect target is not caller-controlled

- **WHEN** a caller supplies an extra query parameter such as `redirect=http://evil.example`
- **THEN** `/ui/open` ignores that value
- **AND** the redirect target remains the trusted configured viewer origin with the validated session handoff
